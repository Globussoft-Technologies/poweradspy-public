'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const config = require('../config');
const metrics = require('../metrics/MetricsCollector');
const databaseManager = require('../database/DatabaseManager');
const { adminAuthMiddleware, requireEditorRole, login, logout, verifyEditKey } = require('./adminAuth');
const { blockIp, unblockIp, getBlockedIps } = require('../middleware/rateLimiter');
const { sendTelegramAlert } = require('../utils/telegram');
const {
  getAllDocs, getDoc, createDoc, updateDoc, patchField, deleteDoc,
  addFilter, updateFilter, deleteFilter,
  addOption, updateOption, deleteOption,
  saveSnapshot, getSnapshots, restoreSnapshot,
} = require('../services/sdui/services/adminService');
// const planAccessService = require('../services/planAccess/planAccessService'); // plan access now reads/writes MongoDB directly
const { invalidateConfigCache } = require('../services/planAccess/planAccessService');
const { getDB } = require('../services/sdui/db');
const logger = require('../logger');
const log = logger.createChild('admin-plan-access');

// Enterprise (plan 71) isn't modeled as its own plan_groups group (it currently sits
// inside the "Basic" group in DEFAULT_PLAN_GROUPS — a pre-existing data quirk, not
// something this change attempts to fix). Kept explicit here so new-feature auto-seeding
// keeps covering it until Enterprise gets a proper topTier group of its own.
const ADDITIONAL_TOP_TIER_PLAN_IDS = [71];

/**
 * New SDUI filters are auto-assigned access to every plan ID in a `topTier: true`
 * plan_groups group (Palladium, Palladium (2026), and any future top tier) — config-driven,
 * so a new pricing generation never needs a code change to be covered by this default.
 * Admin is notified via the "needs_review" banner to extend access to lower tiers as needed.
 * Falls back to DEFAULT_PLAN_GROUPS (and finally to just ADDITIONAL_TOP_TIER_PLAN_IDS) if
 * MongoDB's plan_groups doc is unreachable or missing.
 */
async function getTopTierPlanIds(col) {
  try {
    const doc = await col.findOne({ _id: 'plan_groups' });
    const { DEFAULT_PLAN_GROUPS } = require('../services/planAccess/planAccessSeed');
    const groups = (doc && doc.groups) || DEFAULT_PLAN_GROUPS.groups;
    const ids = new Set(ADDITIONAL_TOP_TIER_PLAN_IDS);
    for (const g of Object.values(groups)) {
      if (g && g.topTier) (g.plans || []).forEach((id) => ids.add(id));
    }
    return [...ids];
  } catch (e) {
    log.warn('getTopTierPlanIds failed, using static fallback', { error: e.message });
    return [...ADDITIONAL_TOP_TIER_PLAN_IDS];
  }
}

async function getPlanAccessCollection() {
  // Reuse the shared getDB() singleton instead of opening a new MongoClient on every call.
  // A fresh MongoClient per-request bypasses the authenticated connection pool and fails
  // with "not authorized" when MongoDB requires credentials.
  // const { MongoClient } = require('mongodb');
  // const mongoConfig = config.databases && config.databases.mongo;
  // const uri = (mongoConfig && mongoConfig.uri) || 'mongodb://localhost:27017/';
  // const client = new MongoClient(uri);
  // await client.connect();
  // return { col: client.db('pas_dev').collection('plan_access_config'), client };
  const db = await getDB();
  // Return no-op client stub — callers call client.close() in finally blocks,
  // but we must not close the shared getDB() connection pool.
  return { col: db.collection('plan_access_config'), client: { close: async () => {} } };
}

const router = express.Router();

// ─── Serve static admin UI files ──────────────────────────
router.use('/ui', (req, res, next) => {
  if (req.path.endsWith('.js') || req.path.endsWith('.css')) {
    const dest = req.headers['sec-fetch-dest'];
    const referer = req.headers.referer;
    // Prevent direct address-bar navigation to source files
    if (dest === 'document' || (!dest && !referer)) {
      return res.status(403).send('Direct access to application source files is forbidden for security reasons.');
    }
  }
  next();
}, express.static(path.join(__dirname, 'public')));

// Redirect /admin to /admin/ui/
router.get('/', (req, res) => {
  res.redirect('/admin/ui/');
});

// ─── Public routes (no auth) ──────────────────────────────
router.post('/api/login', express.json(), login);

// Serves window.__ADMIN_CONFIG__ so the frontend JS can read config values.
// No auth needed — only exposes non-sensitive public fields.
router.get('/client-config.js', (_req, res) => {
  const domain = config.server?.domain || '';
  const apiBase = domain ? `${domain}/admin/api` : '/admin/api';
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-store');
  res.send(`window.__ADMIN_CONFIG__ = ${JSON.stringify({ apiBase, domain })};`);
});

// ─── Protected routes (require admin auth) ─────────────────
router.use('/api', adminAuthMiddleware);

router.get('/api/session', (req, res) => {
  res.json({ code: 200, data: req.adminSession });
});

router.post('/api/logout', logout);
router.post('/api/verify-edit-key', express.json(), verifyEditKey);

// ─── Metrics ──────────────────────────────────────────────────
router.get('/api/metrics', async (req, res) => {
  const { startDate, endDate } = req.query;
  const metricsData = await metrics.getMetrics(startDate, endDate);
  res.json({
    success: true,
    data: metricsData,
  });
});

router.get('/api/metrics/ips', async (req, res) => {
  const { startDate, endDate } = req.query;
  const ips = await metrics.getIpStats(startDate, endDate);
  res.json({
    success: true,
    data: ips,
  });
});

// ─── NAS Storage (read-only report) ───────────────────────
const nasAdminClient = require('../insertion/helpers/nasAdminClient');
const nasStorageHistory = require('../insertion/helpers/nasStorageHistory');

router.get('/api/nas-storage', async (req, res) => {
  try {
    const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 150);
    // Current filesystem totals via a cached `df` (admin SSH). Each successful read is also
    // snapshotted to the on-disk history so the per-day series builds over time (a 6-hourly cron
    // guarantees daily points even if nobody opens the page). There is no Redis on this box, so the
    // "data stored / day" metric is the day-over-day growth of `used` (net of any deletions).
    let storage = null;
    let storageError = null;
    if (nasAdminClient.isConfigured()) {
      try {
        storage = await nasAdminClient.getStorage(req.query.refresh === '1');
        nasStorageHistory.recordSnapshot(storage);
      } catch (e) { storageError = e.message; log.warn('NAS df failed', { error: e.message }); }
    } else {
      storageError = 'NAS admin SSH not configured (insertion.nas.adminHost/User/Pass)';
    }
    const daily = nasStorageHistory.getSeries(days);
    const lastGrowth = [...daily].reverse().find((d) => d.growthBytes != null);
    res.json({
      code: 200,
      data: {
        storage,
        storageError,
        daily,
        points: daily.length,
        windowDays: days,
        lastDayGrowthBytes: lastGrowth ? lastGrowth.growthBytes : null,
      },
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── Database Status ──────────────────────────────────────
router.get('/api/db-status', (req, res) => {
  const health = databaseManager.getHealth();
  const poolStats = databaseManager.getPoolStats();
  res.json({ code: 200, data: { health, poolStats } });
});

// ─── Logs ─────────────────────────────────────────────────
router.get('/api/logs', (req, res) => {
  try {
    const logDir = path.resolve(config.log.dir || 'logs');
    if (!fs.existsSync(logDir)) {
      return res.json({ code: 200, data: [] });
    }
    const files = fs.readdirSync(logDir)
      .filter(f => f.endsWith('.log') || f.endsWith('.log.gz'))
      .map(f => {
        const stat = fs.statSync(path.join(logDir, f));
        return {
          name: f,
          size: stat.size,
          sizeHuman: formatBytes(stat.size),
          modified: stat.mtime.toISOString(),
        };
      })
      .sort((a, b) => new Date(b.modified) - new Date(a.modified));
    
    res.json({ code: 200, data: files });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/api/logs/:filename', (req, res) => {
  try {
    const logDir = path.resolve(config.log.dir || 'logs');
    const filePath = path.join(logDir, req.params.filename);
    
    // Security check
    if (!filePath.startsWith(logDir)) {
      return res.status(403).json({ code: 403, message: 'Access denied' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 404, message: 'Log file not found' });
    }
    
    const stat = fs.statSync(filePath);
    if (stat.size === 0) {
      return res.json({
        code: 200,
        data: {
          filename: req.params.filename,
          totalLines: 0,
          returnedLines: 0,
          content: 'File is empty.',
        }
      });
    }

    // Read last N lines (default 200, max 1000)
    const lines = parseInt(req.query.lines) || 200;
    const maxLines = Math.min(lines, 1000);
    
    const content = fs.readFileSync(filePath, 'utf-8');
    const allLines = content.split('\n');
    const lastN = allLines.slice(-maxLines);
    
    res.json({
      code: 200,
      data: {
        filename: req.params.filename,
        totalLines: allLines.length,
        returnedLines: lastN.length,
        content: lastN.join('\n'),
      }
    });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.get('/api/logs/:filename/download', (req, res) => {
  try {
    const logDir = path.resolve(config.log.dir || 'logs');
    const filePath = path.join(logDir, req.params.filename);
    
    if (!filePath.startsWith(logDir)) {
      return res.status(403).json({ code: 403, message: 'Access denied' });
    }
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ code: 404, message: 'Log file not found' });
    }
    
    res.download(filePath);
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── Config Management ────────────────────────────────────
router.get('/api/config', (req, res) => {
  const rawConfig = config.getRawFileConfig();
  res.json({ code: 200, data: rawConfig });
});

router.put('/api/config', express.json(), requireEditorRole, (req, res) => {
  try {
    const newConfig = req.body;
    if (!newConfig || typeof newConfig !== 'object') {
      return res.status(400).json({ code: 400, message: 'Invalid config object' });
    }
    
    // Check what changed for the summary
    const oldConfig = config.getRawFileConfig();
    const changedKeys = [];
    for (const key of Object.keys(newConfig)) {
      if (JSON.stringify(newConfig[key]) !== JSON.stringify(oldConfig[key])) {
        if (!key.startsWith('_')) changedKeys.push(key);
      }
    }
    
    const success = config.writeConfigFile(newConfig);
    if (success) {
      if (changedKeys.length > 0) {
        const sys = req.adminSession.systemAuth;
        const editorInfo = sys ? `\n\n🛡️ <b>Audit Log:</b>\n- System: <code>${sys.hostname}</code>\n- OS: <code>${sys.platform} (${sys.arch})</code>\n- User: <code>${sys.username}</code>\n- IP: <code>${req.ip || req.connection?.remoteAddress || 'unknown'}</code>\n- Time: <code>${new Date().toISOString()}</code>` : '';
        sendTelegramAlert(`⚙️ <b>Config Updated</b>\n\nThe following settings were modified (values hidden for security):\n${changedKeys.map(k => `• <code>${k}</code>`).join('\n')}${editorInfo}`);
      }
      res.json({ code: 200, message: 'Config updated and reloaded successfully' });
    } else {
      res.status(500).json({ code: 500, message: 'Failed to write config file' });
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── Config Backups & Restores ──────────────────────────────
router.get('/api/config/backups', (req, res) => {
  try {
    const backupDir = path.resolve(process.cwd(), 'data', 'config_backups');
    if (!fs.existsSync(backupDir)) {
      return res.json({ code: 200, data: [] });
    }
    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('config_') && f.endsWith('.json'))
      .map(f => {
        const stat = fs.statSync(path.join(backupDir, f));
        return {
          filename: f,
          sizeBody: formatBytes(stat.size),
          timestamp: stat.mtime.getTime()
        };
      })
      .sort((a, b) => b.timestamp - a.timestamp);
    res.json({ code: 200, data: files });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/api/config/restore', express.json(), requireEditorRole, (req, res) => {
  try {
    const { filename } = req.body;
    if (!filename || !filename.startsWith('config_') || !filename.endsWith('.json') || filename.includes('..')) {
      return res.status(400).json({ code: 400, message: 'Invalid backup filename' });
    }

    const backupPath = path.resolve(process.cwd(), 'data', 'config_backups', filename);
    if (!fs.existsSync(backupPath)) {
      return res.status(404).json({ code: 404, message: 'Backup file not found' });
    }

    const backupContent = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    
    // Applying the backup mathematically writes the currently active config into the archives
    // meaning no state is ever truly lost during a rollback natively
    const success = config.writeConfigFile(backupContent);
    
    if (success) {
      const sys = req.adminSession.systemAuth;
      const editorInfo = sys ? `\n\n🛡️ <b>Audit Log:</b>\n- System: <code>${sys.hostname}</code>\n- OS: <code>${sys.platform} (${sys.arch})</code>\n- User: <code>${sys.username}</code>\n- IP: <code>${req.ip || req.connection?.remoteAddress || 'unknown'}</code>\n- Time: <code>${new Date().toISOString()}</code>` : '';
      sendTelegramAlert(`⏪ <b>Config Rollback Triggered!</b>\n\nAn admin has successfully restored the configuration to backup <code>${filename}</code>.${editorInfo}`);
      
      res.json({ code: 200, message: 'Configuration successfully rolled back' });
    } else {
      res.status(500).json({ code: 500, message: 'Failed to restore configuration backup' });
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── IP Blocklist ─────────────────────────────────────────
router.get('/api/blocked-ips', (req, res) => {
  res.json({ code: 200, data: getBlockedIps() });
});

router.post('/api/blocked-ips', express.json(), (req, res) => {
  const { ip } = req.body;
  if (!ip) {
    return res.status(400).json({ code: 400, message: 'IP address is required' });
  }
  blockIp(ip);
  res.json({ code: 200, message: `IP ${ip} has been blocked` });
});

router.delete('/api/blocked-ips/:ip', (req, res) => {
  const ip = req.params.ip;
  unblockIp(ip);
  res.json({ code: 200, message: `IP ${ip} has been unblocked` });
});

// ─── SDUI Config ──────────────────────────────────────────

// List all docs
router.get('/api/sdui/docs', async (req, res) => {
  try {
    const docs = await getAllDocs();
    res.json({ code: 200, data: docs });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Get single doc
router.get('/api/sdui/docs/:id', async (req, res) => {
  try {
    const doc = await getDoc(req.params.id);
    if (!doc) return res.status(404).json({ code: 404, message: 'Document not found' });
    res.json({ code: 200, data: doc });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Auto-seed plan_access_config with Palladium IDs when a new sidebar SDUI doc is created.
// Fire-and-forget — GET /api/plan-access/config is a safety-net fallback if this fails.
async function autoSeedPlanAccessForSduiDoc(docId, docTitle, configType) {
  if (configType !== 'sidebar') return;
  try {
    const SDUI_TO_PA_ID = { cta: 'call_to_action', source: 'traffic_source', sidebar_budget: 'ad_budget_sort' };
    const paId = SDUI_TO_PA_ID[docId] || docId;
    const { col, client } = await getPlanAccessCollection();
    const existing = await col.findOne({ _id: paId });
    if (!existing) {
      const now = new Date().toISOString();
      const topTierPlanIds = await getTopTierPlanIds(col);
      await col.insertOne({ _id: paId, label: docTitle, category: 'sidebar', allowed_plan_ids: topTierPlanIds, needs_review: true, created_at: now, updated_at: now });
      log.info('Auto-seeded plan_access_config for new SDUI doc', { paId, docId });
    }
    await client.close();
  } catch (e) {
    log.warn('autoSeedPlanAccessForSduiDoc failed', { docId, error: e.message });
  }
}

// Create new doc
router.post('/api/sdui/docs', express.json(), requireEditorRole, async (req, res) => {
  try {
    const doc = req.body;
    if (!doc || !doc._id || !doc.config_type || !doc.title) {
      return res.status(400).json({ code: 400, message: '_id, config_type, and title are required' });
    }
    const created = await createDoc(doc);
    autoSeedPlanAccessForSduiDoc(created._id, created.title, created.config_type);
    sendTelegramAlert(`📄 <b>SDUI Document Created</b>\n\n- ID: <code>${created._id}</code>\n- Title: <code>${created.title}</code>\n- Type: <code>${created.config_type}</code>`);
    res.status(201).json({ code: 201, message: 'Created', data: created });
  } catch (err) {
    const status = err.message.includes('already exists') ? 409 : 500;
    res.status(status).json({ code: status, message: err.message });
  }
});

router.put('/api/sdui/docs/:id', express.json(), requireEditorRole, async (req, res) => {
  try {
    const doc = req.body;
    if (!doc) return res.status(400).json({ code: 400, message: 'Invalid JSON' });
    await saveSnapshot(req.params.id);
    await updateDoc(req.params.id, doc);
    const sys = req.adminSession.systemAuth;
    const audit = sys ? `\n\n🛡️ <b>Audit Log:</b>\n- System: <code>${sys.hostname}</code>\n- OS: <code>${sys.platform} (${sys.arch})</code>\n- User: <code>${sys.username}</code>\n- IP: <code>${req.ip || req.connection?.remoteAddress || 'unknown'}</code>\n- Time: <code>${new Date().toISOString()}</code>` : '';
    sendTelegramAlert(`✏️ <b>SDUI Document Updated</b>\n\n- ID: <code>${req.params.id}</code>\n- Title: <code>${doc.title || ''}</code>\n- Type: <code>${doc.config_type || ''}</code>${audit}`);
    res.json({ code: 200, message: 'Updated' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.patch('/api/sdui/docs/:id/flag', express.json(), requireEditorRole, async (req, res) => {
  try {
    const { flag } = req.body || {};
    if (flag === undefined) return res.status(400).json({ code: 400, message: 'Invalid JSON' });
    await patchField(req.params.id, 'flag', flag);
    const sys = req.adminSession.systemAuth;
    const audit = sys ? `\n\n🛡️ <b>Audit Log:</b>\n- User: <code>${sys.username}</code>\n- IP: <code>${req.ip || req.connection?.remoteAddress || 'unknown'}</code>\n- Time: <code>${new Date().toISOString()}</code>` : '';
    sendTelegramAlert(`🔘 <b>SDUI Flag Changed</b>\n\n- ID: <code>${req.params.id}</code>\n- Active: <code>${flag}</code>${audit}`);
    res.json({ code: 200, message: 'Updated' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.patch('/api/sdui/docs/:id/visible', express.json(), requireEditorRole, async (req, res) => {
  try {
    const { visible } = req.body || {};
    if (visible === undefined) return res.status(400).json({ code: 400, message: 'Invalid JSON' });
    await patchField(req.params.id, 'visible', visible);
    const sys = req.adminSession.systemAuth;
    const audit = sys ? `\n\n🛡️ <b>Audit Log:</b>\n- User: <code>${sys.username}</code>\n- IP: <code>${req.ip || req.connection?.remoteAddress || 'unknown'}</code>\n- Time: <code>${new Date().toISOString()}</code>` : '';
    sendTelegramAlert(`👁️ <b>SDUI Visibility Changed</b>\n\n- ID: <code>${req.params.id}</code>\n- Visible: <code>${visible}</code>${audit}`);
    res.json({ code: 200, message: 'Updated' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.delete('/api/sdui/docs/:id', requireEditorRole, async (req, res) => {
  try {
    await saveSnapshot(req.params.id);
    await deleteDoc(req.params.id);
    const sys = req.adminSession.systemAuth;
    const audit = sys ? `\n\n🛡️ <b>Audit Log:</b>\n- System: <code>${sys.hostname}</code>\n- OS: <code>${sys.platform} (${sys.arch})</code>\n- User: <code>${sys.username}</code>\n- IP: <code>${req.ip || req.connection?.remoteAddress || 'unknown'}</code>\n- Time: <code>${new Date().toISOString()}</code>` : '';
    sendTelegramAlert(`🗑️ <b>SDUI Document Deleted</b>\n\n- ID: <code>${req.params.id}</code>${audit}`);
    res.json({ code: 200, message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── SDUI Snapshots ───────────────────────────────────────
router.get('/api/sdui/docs/:id/snapshots', async (req, res) => {
  try {
    const snaps = await getSnapshots(req.params.id);
    res.json({ code: 200, data: snaps });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

router.post('/api/sdui/docs/:id/restore/:snapshotId', requireEditorRole, async (req, res) => {
  try {
    const doc = await restoreSnapshot(req.params.snapshotId);
    const sys = req.adminSession.systemAuth;
    const audit = sys ? `\n\n🛡️ <b>Audit Log:</b>\n- User: <code>${sys.username}</code>\n- IP: <code>${req.ip || req.connection?.remoteAddress || 'unknown'}</code>\n- Time: <code>${new Date().toISOString()}</code>` : '';
    sendTelegramAlert(`⏪ <b>SDUI Document Restored</b>\n\n- ID: <code>${req.params.id}</code>\n- Snapshot: <code>${req.params.snapshotId}</code>${audit}`);
    res.json({ code: 200, message: 'Restored', data: doc });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── SDUI Filter CRUD (within a doc) ─────────────────────

// Add filter to a doc
router.post('/api/sdui/docs/:id/filters', express.json(), requireEditorRole, async (req, res) => {
  try {
    const filter = req.body;
    if (!filter || !filter._id) return res.status(400).json({ code: 400, message: 'filter._id is required' });
    await saveSnapshot(req.params.id);
    await addFilter(req.params.id, filter);
    sendTelegramAlert(`➕ <b>SDUI Filter Added</b>\n\n- Doc: <code>${req.params.id}</code>\n- Filter: <code>${filter._id}</code> (${filter.label || ''})`);
    res.status(201).json({ code: 201, message: 'Filter added' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Update filter in a doc
router.put('/api/sdui/docs/:id/filters/:filterId', express.json(), requireEditorRole, async (req, res) => {
  try {
    await saveSnapshot(req.params.id);
    await updateFilter(req.params.id, req.params.filterId, req.body);
    res.json({ code: 200, message: 'Filter updated' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Delete filter from a doc
router.delete('/api/sdui/docs/:id/filters/:filterId', requireEditorRole, async (req, res) => {
  try {
    await saveSnapshot(req.params.id);
    await deleteFilter(req.params.id, req.params.filterId);
    sendTelegramAlert(`🗑️ <b>SDUI Filter Deleted</b>\n\n- Doc: <code>${req.params.id}</code>\n- Filter: <code>${req.params.filterId}</code>`);
    res.json({ code: 200, message: 'Filter deleted' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── SDUI Option CRUD (within a filter) ──────────────────

// Add option to a filter
router.post('/api/sdui/docs/:id/filters/:filterId/options', express.json(), requireEditorRole, async (req, res) => {
  try {
    const option = req.body;
    if (!option || !option._id) return res.status(400).json({ code: 400, message: 'option._id is required' });
    await saveSnapshot(req.params.id);
    await addOption(req.params.id, req.params.filterId, option);
    res.status(201).json({ code: 201, message: 'Option added' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Update option in a filter
router.put('/api/sdui/docs/:id/filters/:filterId/options/:optionId', express.json(), requireEditorRole, async (req, res) => {
  try {
    await saveSnapshot(req.params.id);
    await updateOption(req.params.id, req.params.filterId, req.params.optionId, req.body);
    res.json({ code: 200, message: 'Option updated' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Delete option from a filter
router.delete('/api/sdui/docs/:id/filters/:filterId/options/:optionId', requireEditorRole, async (req, res) => {
  try {
    await saveSnapshot(req.params.id);
    await deleteOption(req.params.id, req.params.filterId, req.params.optionId);
    res.json({ code: 200, message: 'Option deleted' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── Plan Access Config ───────────────────────────────────────────────────────
// GET/PUT now read and write MongoDB `plan_access_config` collection.
// planBillingMetadata is static display data — always served from planAccessSeed.js.

router.get('/api/plan-access/config', async (req, res) => {
  try {
    const { planBillingMetadata, DEFAULT_PLAN_GROUPS } = require('../services/planAccess/planAccessSeed');
    let allDocs = [];

    // Primary: read from MongoDB pas_dev.plan_access_config (direct connection)
    let paClient = null;
    try {
      const { col, client: c } = await getPlanAccessCollection();
      paClient = c;
      allDocs = await col.find({}).toArray();
    } catch (dbErr) {
      // DB unavailable — fall through to JSON fallback below
    } finally {
      if (paClient) await paClient.close();
    }

    // Fallback: if MongoDB collection is empty or missing, read from plan_config.json
    if (allDocs.length === 0) {
      const configPath = path.resolve(__dirname, '../services/planAccess/plan_config.json');
      if (fs.existsSync(configPath)) {
        allDocs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      }
    }

    // ─── NEW: Fetch SDUI docs to merge into plan access dashboard ─────────────────
    let sduiDocs = [];
    try {
      const db = await getDB();
      sduiDocs = await db.collection('sdui_config').find({}).toArray();
    } catch (e) {
      log.error('plan-access GET: failed to fetch sdui_config', { error: e.message });
    }

    // Merge SDUI items into the filterDocs list
    // Existing filters are kept; SDUI items are added or update metadata of existing ones
    // ─── Resolve plan_groups — seed to MongoDB if missing ─────────────────────
    let planGroupsDoc = allDocs.find(d => d._id === 'plan_groups') || null;
    if (!planGroupsDoc) {
      const now = new Date().toISOString();
      planGroupsDoc = { ...DEFAULT_PLAN_GROUPS, created_at: now, updated_at: now };
      try {
        const { col: seedCol, client: seedClient } = await getPlanAccessCollection();
        await seedCol.insertOne(planGroupsDoc);
        await seedClient.close();
        log.info('plan_groups document seeded to MongoDB');
      } catch (seedErr) {
        log.warn('Failed to seed plan_groups to MongoDB', { error: seedErr.message });
      }
    }

    const paMap = new Map();
    // ad_budget_sort must remain in paMap so the SDUI merge (sidebar_budget → ad_budget_sort)
    // can read the actual allowed_plan_ids from MongoDB. Hiding it before the merge caused
    // the admin panel to always show Budget as NEW/empty even after saving.
    allDocs.forEach(d => {
      if (!['platform_access', 'competitor_limits', 'plan_billing_metadata', 'plan_groups'].includes(d._id)) {
        paMap.set(d._id, d);
      }
    });

    // Maps SDUI sidebar doc _id → existing plan_access_config _id when they differ.
    // Prevents duplicate admin dashboard entries when the SDUI doc _id differs from the
    // plan_config entry _id (e.g. SDUI 'cta' → plan_config 'call_to_action',
    // SDUI 'source' → plan_config 'traffic_source').
    const SDUI_DOC_TO_PLAN_ACCESS_ID = {
      cta:            'call_to_action',
      source:         'traffic_source',
      sidebar_budget: 'ad_budget_sort',  // SDUI sidebar_budget doc → ad_budget_sort plan_access entry
    };

    sduiDocs.forEach(s => {
      // Only merge sidebar SDUI docs into plan validation — navbar/searchbar docs
      // are UI controls (platform selector, date, sort) that don't need per-plan access config
      if (s.config_type !== 'sidebar') return;

      const paId = SDUI_DOC_TO_PLAN_ACCESS_ID[s._id] || s._id;
      const existing = paMap.get(paId) || { allowed_plan_ids: [], platform_support: {} };
      // Mark as new only when no plan IDs have been configured (newly added, unassigned filter)
      const hasConfiguredPlanIds = !!(existing.allowed_plan_ids && existing.allowed_plan_ids.length > 0);
      paMap.set(paId, {
        ...existing,
        _id: paId,
        label: s.title,           // UI label reflects SDUI Title
        category: 'sidebar',      // SDUI is source of truth for section placement
        is_new: !hasConfiguredPlanIds  // NEW badge only for filters without plan IDs assigned
      });
    });

    // Remove orphaned plan_config entries whose _id was remapped above (e.g. 'source' was
    // absorbed into 'traffic_source'). Without this they'd show as a second row in the dashboard.
    Object.keys(SDUI_DOC_TO_PLAN_ACCESS_ID).forEach(sduiId => paMap.delete(sduiId));

    // Auto-seed any brand-new (is_new) features with Palladium plan IDs and mark needs_review.
    // Collect all features already seeded but not yet reviewed by admin.
    let needsReviewFilters = [];
    try {
      const { col: seedCol, client: seedClient } = await getPlanAccessCollection();
      const now = new Date().toISOString();
      const topTierPlanIds = await getTopTierPlanIds(seedCol);
      for (const [paId, doc] of paMap.entries()) {
        if (doc.is_new) {
          await seedCol.updateOne(
            { _id: paId },
            { $set: { allowed_plan_ids: topTierPlanIds, needs_review: true, label: doc.label, category: doc.category || 'sidebar', updated_at: now }, $setOnInsert: { created_at: now } },
            { upsert: true }
          );
          paMap.set(paId, { ...doc, allowed_plan_ids: topTierPlanIds, is_new: false, needs_review: true });
        }
        if (paMap.get(paId)?.needs_review) {
          needsReviewFilters.push({ _id: paId, label: doc.label || paId });
        }
      }
      await seedClient.close();
    } catch (seedErr) {
      log.warn('Failed to auto-seed new features with Palladium IDs', { error: seedErr.message });
    }

    const filterDocs = Array.from(paMap.values());
    const platformAccessDoc = allDocs.find(d => d._id === 'platform_access') || null;
    const competitorLimitsDoc = allDocs.find(d => d._id === 'competitor_limits') || null;
    res.json({ code: 200, data: { filterDocs, platformAccessDoc, competitorLimitsDoc, planBillingMetadata, planGroupsDoc, needsReviewFilters } });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Lightweight endpoint — called on every dashboard load to show the global review badge/strip.
// Does NOT trigger auto-seeding; just reads needs_review docs from MongoDB.
router.get('/api/plan-access/review-count', async (req, res) => {
  try {
    const { col, client } = await getPlanAccessCollection();
    const docs = await col.find({ needs_review: true }, { projection: { _id: 1, label: 1 } }).toArray();
    await client.close();
    res.json({ code: 200, data: { count: docs.length, filters: docs.map(d => ({ _id: d._id, label: d.label || d._id })) } });
  } catch (err) {
    res.json({ code: 200, data: { count: 0, filters: [] } });
  }
});

router.put('/api/plan-access/config', express.json(), requireEditorRole, async (req, res) => {
  let paClient = null;
  try {
    const { planId, platforms, limits, filters, filterPlatforms, mtNetworks } = req.body;
    if (!planId) return res.status(400).json({ code: 400, message: 'planId required' });

    const { col, client: c } = await getPlanAccessCollection();
    paClient = c;
    const pid = Number(planId);
    if (isNaN(pid) || !Number.isInteger(pid) || pid <= 0) {
      return res.status(400).json({ code: 400, message: 'planId must be a positive integer' });
    }
    const pidStr = String(pid);
    const timestamp = new Date().toISOString();

    // Load seed JSON once — used as fallback base when a filter doc doesn't exist in MongoDB yet.
    // This prevents revoking a plan from a non-existent doc from writing allowed_plan_ids:[]
    // which would block every plan (not just the revoked one).
    let seedConfig = [];
    try {
      const seedPath = path.resolve(__dirname, '../services/planAccess/plan_config.json');
      if (fs.existsSync(seedPath)) seedConfig = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
    } catch (_) {}

    // Auto-seed from plan_config.json if collection is empty
    const count = await col.countDocuments();
    if (count === 0) {
      const configPath = path.resolve(__dirname, '../services/planAccess/plan_config.json');
      if (fs.existsSync(configPath)) {
        const seedDocs = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        // Also seed plan_billing_metadata from seed if present
        try {
          const seed = require('../services/planAccess/planAccessSeed');
          if (seed.planBillingMetadata && !seedDocs.find(d => d._id === 'plan_billing_metadata')) {
            seedDocs.push(seed.planBillingMetadata);
          }
        } catch (_) {}
        for (const doc of seedDocs) {
          await col.replaceOne({ _id: doc._id }, doc, { upsert: true });
        }
      }
    }

    // Update platform_access doc
    if (platforms) {
      const platDoc = await col.findOne({ _id: 'platform_access' });
      log.info('plan-access PUT', { planId, pid, platforms, platDocFound: !!platDoc });
      if (platDoc) {
        for (const plat of Object.keys(platDoc.platform_plans)) {
          const arr = platDoc.platform_plans[plat];
          const hasIt = arr.includes(pid);
          const shouldHave = platforms.includes(plat);
          if (shouldHave && !hasIt) { arr.push(pid); log.info('platform access granted', { pid, platform: plat }); }
          if (!shouldHave && hasIt) { platDoc.platform_plans[plat] = arr.filter(p => p !== pid); log.info('platform access revoked', { pid, platform: plat }); }
        }
        platDoc.updated_at = timestamp;
        await col.replaceOne({ _id: 'platform_access' }, platDoc);
        log.info('platform_access doc saved', { pid });
      }
    }

    // Update competitor_limits doc
    if (limits) {
      await col.updateOne(
        { _id: 'competitor_limits' },
        { $set: {
          [`plan_limits.${pidStr}`]: { brandLimit: Number(limits.brandLimit), competitorLimit: Number(limits.competitorLimit) },
          updated_at: timestamp,
        }}
      );
    }

    // Update filter allowed_plan_ids and platform_support
    if (filters || filterPlatforms) {
      const allTargetIds = new Set([...Object.keys(filters || {}), ...Object.keys(filterPlatforms || {})]);

      for (const tid of allTargetIds) {
        const setFields = {};
        const doc = await col.findOne({ _id: tid });

        if (filters && filters[tid] !== undefined) {
          // If no MongoDB doc exists yet, use seed JSON as base so we don't clobber the full
          // allowed_plan_ids list with [] just because one plan is being revoked.
          const seedDoc = !doc ? seedConfig.find(s => s._id === tid) : null;
          const arr = (doc && doc.allowed_plan_ids) || (seedDoc && seedDoc.allowed_plan_ids) || [];
          const hasIt = arr.includes(pid);
          const shouldHave = filters[tid];
          if (shouldHave && !hasIt) {
            setFields.allowed_plan_ids = [...arr, pid];
          } else if (!shouldHave && hasIt) {
            setFields.allowed_plan_ids = arr.filter(p => p !== pid);
          } else if (!shouldHave && !doc && !seedDoc) {
            // No doc and no seed default — explicit empty array to deny all (new filter, never had defaults)
            setFields.allowed_plan_ids = [];
          }
        }

        if (filterPlatforms && filterPlatforms[tid]) {
          setFields.platform_support = filterPlatforms[tid];
        }

        if (Object.keys(setFields).length > 0) {
          setFields.updated_at = timestamp;
          setFields.needs_review = false; // admin has explicitly reviewed this filter
          await col.updateOne({ _id: tid }, { $set: setFields }, { upsert: true });
        }
      }
    }

    // Market Trends' per-PLAN network scope — independent of platform_access (the
    // general "can this plan search this network at all" toggle). Lets an admin
    // give a plan a different network set in Market Trends analytics than it has
    // for ad search, without touching platform_access. undefined = leave whatever
    // is already saved untouched; [] is a valid explicit "no networks" value.
    if (mtNetworks !== undefined) {
      await col.updateOne(
        { _id: 'market_trends' },
        { $set: { [`network_overrides.${pidStr}`]: mtNetworks, updated_at: timestamp } },
        { upsert: true }
      );
    }

    invalidateConfigCache();
    res.json({ code: 200, message: 'Plan access config updated' });
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  } finally {
    if (paClient) await paClient.close();
  }
});

// ─── Add new plan ID — copy all access from a reference plan in same group ────
router.post('/api/plan-access/add-plan', express.json(), requireEditorRole, async (req, res) => {
  try {
    const { newPlanId, refPlanId, group } = req.body;
    if (!newPlanId || !refPlanId) return res.status(400).json({ code: 400, message: 'newPlanId and refPlanId required' });
    if (!group) return res.status(400).json({ code: 400, message: 'group is required' });

    const { col, client: paClient } = await getPlanAccessCollection();
    const newPid = Number(newPlanId);
    const refPid = Number(refPlanId);
    const timestamp = new Date().toISOString();

    try {
      // 1. Copy platform access — add newPid to same platforms as refPid
      const platDoc = await col.findOne({ _id: 'platform_access' });
      if (platDoc) {
        for (const [, arr] of Object.entries(platDoc.platform_plans)) {
          if (arr.includes(refPid) && !arr.includes(newPid)) arr.push(newPid);
        }
        platDoc.updated_at = timestamp;
        await col.replaceOne({ _id: 'platform_access' }, platDoc);
      }

      // 2. Copy competitor limits
      const limDoc = await col.findOne({ _id: 'competitor_limits' });
      if (limDoc && limDoc.plan_limits) {
        const refLimits = limDoc.plan_limits[String(refPid)] || { brandLimit: 0, competitorLimit: 0 };
        await col.updateOne(
          { _id: 'competitor_limits' },
          { $set: { [`plan_limits.${newPid}`]: refLimits, updated_at: timestamp } }
        );
      }

      // 3. Copy filter access — add newPid to allowed_plan_ids wherever refPid is present
      const filterDocs = await col.find({ _id: { $nin: ['platform_access', 'competitor_limits', 'plan_billing_metadata'] } }).toArray();
      for (const doc of filterDocs) {
        const arr = doc.allowed_plan_ids || [];
        if (arr.includes(refPid) && !arr.includes(newPid)) {
          await col.updateOne({ _id: doc._id }, { $set: { allowed_plan_ids: [...arr, newPid], updated_at: timestamp } });
        }
      }

      // 4. Persist group membership in plan_groups doc
      const pgDoc = await col.findOne({ _id: 'plan_groups' });
      if (pgDoc && pgDoc.groups) {
        if (!pgDoc.groups[group]) {
          // Group doesn't exist yet — create it with a default color
          const DEFAULT_COLORS = {
            Free:'#94a3b8', Basic:'#6366f1', Standard:'#3b82f6', Premium:'#f59e0b', Platinum:'#ef4444', Titanium:'#8b5cf6', Palladium:'#10b981', Custom:'#f97316',
            'Basic (2026)':'#4f46e5', 'Standard (2026)':'#2563eb', 'Platinum (2026)':'#dc2626', 'Palladium (2026)':'#059669',
          };
          pgDoc.groups[group] = { color: DEFAULT_COLORS[group] || '#94a3b8', plans: [] };
        }
        if (!pgDoc.groups[group].plans.includes(newPid)) {
          pgDoc.groups[group].plans.push(newPid);
        }
        pgDoc.updated_at = timestamp;
        await col.replaceOne({ _id: 'plan_groups' }, pgDoc);
      }

      res.json({ code: 200, message: `Plan ${newPid} added with access copied from plan ${refPid}` });
    } finally {
      await paClient.close();
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Check if a Plan ID already exists in the system
router.get('/api/plan-access/check-id/:id', async (req, res) => {
  try {
    const pid = Number(req.params.id);
    if (isNaN(pid)) return res.json({ code: 400, message: 'Invalid ID' });

    const { col, client } = await getPlanAccessCollection();
    try {
      // Check in platform_access
      const platDoc = await col.findOne({ _id: 'platform_access' });
      let exists = false;
      if (platDoc) {
        for (const arr of Object.values(platDoc.platform_plans)) {
          if (arr.includes(pid)) { exists = true; break; }
        }
      }

      // If not found, check in competitor_limits
      if (!exists) {
        const limDoc = await col.findOne({ _id: 'competitor_limits' });
        if (limDoc && limDoc.plan_limits && limDoc.plan_limits[String(pid)]) {
          exists = true;
        }
      }

      // If still not found, check in filter docs
      if (!exists) {
        const filterDoc = await col.findOne({
          _id: { $nin: ['platform_access', 'competitor_limits', 'plan_billing_metadata'] },
          allowed_plan_ids: pid
        });
        if (filterDoc) exists = true;
      }

      res.json({ code: 200, exists });
    } finally {
      await client.close();
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Soft-delete a plan — marks it in plan_groups.deleted_plan_ids.
// All filter/platform/limit mapping is preserved for restore.
// planAccessService will deny all access for deleted plan IDs.
router.delete('/api/plan-access/plan/:id', requireEditorRole, async (req, res) => {
  try {
    const pid = Number(req.params.id);
    if (isNaN(pid)) return res.status(400).json({ code: 400, message: 'Invalid plan ID' });

    const { col, client } = await getPlanAccessCollection();
    try {
      const pgDoc = await col.findOne({ _id: 'plan_groups' });
      if (!pgDoc) return res.status(404).json({ code: 404, message: 'plan_groups document not found' });

      // Find which group this plan belongs to
      let planGroup = null;
      for (const [groupName, g] of Object.entries(pgDoc.groups || {})) {
        if ((g.plans || []).includes(pid)) { planGroup = groupName; break; }
      }
      if (!planGroup) return res.status(404).json({ code: 404, message: `Plan ${pid} not found in any group` });

      const alreadyDeleted = (pgDoc.deleted_plan_ids || []).some(d => d.plan_id === pid);
      if (alreadyDeleted) return res.status(409).json({ code: 409, message: `Plan ${pid} is already soft-deleted` });

      await col.updateOne(
        { _id: 'plan_groups' },
        {
          $push: { deleted_plan_ids: { plan_id: pid, group: planGroup, deleted_at: new Date().toISOString() } },
          $set:  { updated_at: new Date().toISOString() },
        }
      );

      log.info(`Plan ${pid} soft-deleted from group ${planGroup}`);
      res.json({ code: 200, message: `Plan ${pid} soft-deleted. Users on this plan will lose access.` });
    } finally {
      await client.close();
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// Restore a soft-deleted plan — removes it from plan_groups.deleted_plan_ids.
// All access is immediately restored for users on this plan.
router.post('/api/plan-access/restore-plan/:id', requireEditorRole, async (req, res) => {
  try {
    const pid = Number(req.params.id);
    if (isNaN(pid)) return res.status(400).json({ code: 400, message: 'Invalid plan ID' });

    const { col, client } = await getPlanAccessCollection();
    try {
      const pgDoc = await col.findOne({ _id: 'plan_groups' });
      if (!pgDoc) return res.status(404).json({ code: 404, message: 'plan_groups document not found' });

      const entry = (pgDoc.deleted_plan_ids || []).find(d => d.plan_id === pid);
      if (!entry) return res.status(404).json({ code: 404, message: `Plan ${pid} is not soft-deleted` });

      await col.updateOne(
        { _id: 'plan_groups' },
        {
          $pull: { deleted_plan_ids: { plan_id: pid } },
          $set:  { updated_at: new Date().toISOString() },
        }
      );

      log.info(`Plan ${pid} restored to group ${entry.group}`);
      res.json({ code: 200, message: `Plan ${pid} restored to group ${entry.group}. User access is re-enabled.` });
    } finally {
      await client.close();
    }
  } catch (err) {
    res.status(500).json({ code: 500, message: err.message });
  }
});

// ─── Helper ───────────────────────────────────────────────
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}

module.exports = router;
