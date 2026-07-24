

'use strict';

function debounce(fn, wait) {
  let timer;
  return function(...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), wait);
  };
}

const API = (window.__ADMIN_CONFIG__ && window.__ADMIN_CONFIG__.apiBase) || '/admin/api';
let currentTab = 'dashboard';
let refreshInterval = null;
let currentLogFile = null;
let currentRole = 'viewer';
let rawConfigData = {};
let pv2PendingReviewItems = [];
const tabLoaded = new Set(); // tracks which tabs have loaded data at least once

// ─── Init ─────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Check if already logged in
  checkAuth();

  // Login form
  document.getElementById('login-form').addEventListener('submit', handleLogin);

  // Navigation
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchTab(item.dataset.tab);
    });
  });

  // Logout
  document.getElementById('logout-btn').addEventListener('click', handleLogout);

  // Refresh
  document.getElementById('refresh-btn').addEventListener('click', () => {
    tabLoaded.delete(currentTab); // force reload even if already visited
    refreshCurrentTab();
  });

  // Config save
  document.getElementById('save-config-btn').addEventListener('click', saveConfig);
  document.getElementById('refresh-backups-btn').addEventListener('click', loadConfigBackups);

  // Block IP
  document.getElementById('block-ip-btn').addEventListener('click', blockIp);
  document.getElementById('block-ip-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') blockIp();
  });

  // Verify Edit Key
  document.getElementById('verify-key-btn').addEventListener('click', verifyEditKey);

  // Log search
  document.getElementById('log-search').addEventListener('input', filterLogs);

  // IP search
  document.getElementById('ip-search').addEventListener('input', filterIpTable);

  // Log lines selector
  document.getElementById('log-lines').addEventListener('change', () => {
    if (currentLogFile) viewLogFile(currentLogFile);
  });

  // Date Filters
  document.getElementById('apply-filter-btn').addEventListener('click', applyDateFilter);
  document.getElementById('clear-filter-btn').addEventListener('click', clearDateFilter);

  // SDUI Config
  document.getElementById('sdui-refresh-btn').addEventListener('click', loadSdui);
  document.getElementById('sdui-modal-close').addEventListener('click', closeSduiModal);
  document.getElementById('sdui-modal-cancel').addEventListener('click', closeSduiModal);
  document.getElementById('sdui-rollback-btn').addEventListener('click', sduiRollback);
  document.getElementById('sdui-history-close').addEventListener('click', () => {
    document.getElementById('sdui-history-modal').classList.add('hidden');
  });
  document.getElementById('sdui-modal-save').addEventListener('click', sduiOpenReview);
  document.getElementById('sdui-modal-body').addEventListener('click', sduiModalBodyClick);
  document.getElementById('sdui-type-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('.sdui-type-btn');
    if (!btn) return;
    document.querySelectorAll('.sdui-type-btn').forEach(b => {
      b.classList.remove('active', 'btn-primary');
      b.classList.add('btn-ghost');
    });
    btn.classList.add('active', 'btn-primary');
    btn.classList.remove('btn-ghost');
    sduiFilter = btn.dataset.type;
    renderSduiDocs();
  });
  document.getElementById('sdui-edit-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sdui-edit-modal')) closeSduiModal();
  });
  // modal tabs
  document.getElementById('sdui-edit-modal').addEventListener('click', (e) => {
    const tab = e.target.closest('.sdui-mtab');
    if (!tab) return;
    document.querySelectorAll('.sdui-mtab').forEach(t => t.classList.remove('active'));
    tab.classList.add('active');
    sduiEditMTab = tab.dataset.mtab;
    sduiRenderModalBody();
  });
  // delete modal
  document.getElementById('sdui-delete-cancel').addEventListener('click', () => {
    document.getElementById('sdui-delete-modal').classList.add('hidden');
    sduiDeleteId = null;
  });
  document.getElementById('sdui-delete-confirm').addEventListener('click', sduiDoDelete);
  // review modal
  document.getElementById('sdui-review-cancel').addEventListener('click', () => {
    document.getElementById('sdui-review-modal').classList.add('hidden');
  });
  document.getElementById('sdui-review-confirm').addEventListener('click', sduiDoSave);
  // create modal — close on backdrop click
  document.getElementById('sdui-create-modal').addEventListener('click', (e) => {
    if (e.target === document.getElementById('sdui-create-modal'))
      document.getElementById('sdui-create-modal').classList.add('hidden');
  });

  // Set max dates to today
  const today = new Date().toISOString().split('T')[0];
  document.getElementById('filter-start').setAttribute('max', today);
  document.getElementById('filter-end').setAttribute('max', today);
});

let filterStartDate = '';
let filterEndDate = '';

function applyDateFilter() {
  const start = document.getElementById('filter-start').value;
  const end = document.getElementById('filter-end').value;
  if (!start || !end) {
    showToast('Please select both start and end dates', 'warning');
    return;
  }
  if (new Date(start) > new Date(end)) {
    showToast('Start date cannot be after end date', 'warning');
    return;
  }
  filterStartDate = start;
  filterEndDate = end;
  refreshCurrentTab();
}

function clearDateFilter() {
  document.getElementById('filter-start').value = '';
  document.getElementById('filter-end').value = '';
  filterStartDate = '';
  filterEndDate = '';
  refreshCurrentTab();
}

function getDateQueryParams() {
  return (filterStartDate && filterEndDate) ? ('?startDate=' + filterStartDate + '&endDate=' + filterEndDate) : '';
}

// ─── Auth ─────────────────────────────────────────────────
async function checkAuth() {
  try {
    const res = await fetch(`${API}/session`, {
      credentials: 'include' 
    });
    if (res.ok) {
      const { data } = await res.json();
      currentRole = data.role || 'viewer';
      updateRoleUI();
      showDashboard();
    }
  } catch (e) {
    // Not authenticated, show login
  }
}

function updateRoleUI() {
  const isEditor = currentRole === 'editor';

  // ── Config tab ──────────────────────────────────────────
  const badge = document.getElementById('config-role-badge');
  const unlockPanel = document.getElementById('unlock-edit-panel');
  const saveBtn = document.getElementById('save-config-btn');
  badge.textContent = isEditor ? 'Viewing as: Editor' : 'Viewing as: Viewer';
  badge.style.color = isEditor ? 'var(--success)' : 'var(--text-muted)';
  unlockPanel.classList.toggle('hidden', isEditor);
  saveBtn.classList.toggle('hidden', !isEditor);
  if (Object.keys(rawConfigData).length > 0) renderDynamicConfig(rawConfigData);

  // ── SDUI tab ────────────────────────────────────────────
  const sduiLock = document.getElementById('sdui-lock-notice');
  const sduiBadge = document.getElementById('sdui-role-badge');
  if (sduiLock) sduiLock.classList.toggle('hidden', isEditor);
  if (sduiBadge) {
    sduiBadge.textContent = isEditor ? 'Viewing as: Editor' : 'Viewing as: Viewer';
    sduiBadge.style.color = isEditor ? 'var(--success)' : 'var(--text-muted)';
  }
  const sduiCreateBtn = document.getElementById('sdui-create-btn');
  if (sduiCreateBtn) sduiCreateBtn.classList.toggle('hidden', !isEditor);
  // Re-render SDUI cards so toggle/delete buttons reflect new role
  if (sduiDocs.length > 0) renderSduiDocs();

  // ── Plan Access tab ────────────────────────────────────
  document.querySelectorAll('#tab-plan-access button').forEach((button) => {
    if (button.dataset.planRead !== 'true') button.disabled = !isEditor;
  });
  pv2RenderMode();
  pv2RenderSource();
  // Capability selects and draft actions are rendered from role state. Refresh
  // them immediately after unlock so the user does not need another reload.
  if (currentTab === 'plan-access' && pvCatalog?.capabilities?.length) {
    pvLoadDrafts().catch(() => {});
    if (pv2SelectedFamilyId) pvLoadPlanEditor();
  }
}

async function handleLogin(e) {
  e.preventDefault();
  const username = document.getElementById('username').value;
  const password = document.getElementById('password').value;
  const errorEl = document.getElementById('login-error');
  const btn = document.getElementById('login-btn');

  btn.textContent = 'Signing in...';
  btn.disabled = true;
  errorEl.textContent = '';

  try {
    const res = await fetch(`${API}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include'
    });

    const data = await res.json();

    if (res.ok && data.code === 200) {
      currentRole = data.data.role || 'viewer';
      updateRoleUI();
      showDashboard();
    } else {
      errorEl.textContent = data.message || 'Login failed';
    }
  } catch (err) {
    errorEl.textContent = 'Connection failed. Is the server running?';
  }

  btn.textContent = 'Sign In';
  btn.disabled = false;
}

async function handleLogout() {
  try {
    await fetch(`${API}/logout`, { method: 'POST',credentials: 'include' });
  } catch (e) {}
  
  clearInterval(refreshInterval);
  document.getElementById('dashboard').classList.add('hidden');
  document.getElementById('login-screen').classList.remove('hidden');
}

function showDashboard() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('dashboard').classList.remove('hidden');
  // Restore last active tab from localStorage (or default to dashboard)
  const savedTab = localStorage.getItem('pas_admin_tab') || 'dashboard';
  switchTab(savedTab);
  loadPAReviewCount();
  // Auto-refresh every 10 seconds
  refreshInterval = setInterval(() => {
    if (currentTab === 'dashboard') loadMetrics();
  }, 10000);
}

async function loadPAReviewCount() {
  try {
    const res = await fetch(API + '/plan-control/coverage', { credentials: 'same-origin' });
    if (!res.ok) return;
    const json = await res.json();
    const needsReview = json.data?.needsReview || [];
    pv2PendingReviewItems = json.data?.reviewItems || [];
    const badge = document.getElementById('pa-review-badge');
    const strip = document.getElementById('pa-review-strip');
    const text = document.getElementById('pa-review-strip-text');
    if (badge) {
      badge.textContent = needsReview.length;
      badge.style.display = needsReview.length ? 'inline-block' : 'none';
    }
    if (strip && sessionStorage.getItem('pa-review-dismissed') !== '1') {
      strip.style.display = needsReview.length ? 'flex' : 'none';
    }
    if (text) {
      const labels = [...new Set(pv2PendingReviewItems.map((item) => item.capabilityLabel).filter(Boolean))];
      text.textContent = labels.length
        ? `${labels.length} new feature(s) need a plan decision: ${labels.join(', ')}`
        : `${needsReview.length} plan-controlled feature(s) need an admin decision before publish.`;
    }
  } catch (e) { /* silent — non-critical */ }
}

// ─── Tab Navigation ───────────────────────────────────────
async function paGoToReview() {
  switchTab('plan-access');
  await pvLoadInit();
  const item = pv2PendingReviewItems[0];
  if (!item) {
    showToast?.('No pending plan decisions remain.', 'success');
    return;
  }
  if (item.draftId && pv2Dirty && pvCurrentDraft?.draftId !== item.draftId) {
    showToast?.('Save or discard the current unsaved edits before opening the review draft.', 'error');
    return;
  }
  if (item.draftId && pvCurrentDraft?.draftId !== item.draftId) {
    await pvSelectDraft(item.draftId);
  }
  const generation = document.getElementById('pv2-generation');
  if (generation && item.generationId) generation.value = item.generationId;
  pv2SelectedFamilyId = item.familyId;
  pvRenderFamilies();
  pvLoadPlanEditor();
  const filter = document.getElementById('pv2-filter');
  if (filter) filter.value = 'needs_review';
  pvRenderCapabilities();
  const row = document.querySelector(`[data-pv-capability="${CSS.escape(item.capabilityId)}"]`);
  row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row?.animate(
    [{ backgroundColor: 'rgba(245,158,11,.28)' }, { backgroundColor: 'transparent' }],
    { duration: 1800 },
  );
  if (!item.draftId) {
    showToast?.('This decision is in the live policy. Create a safe draft first, then use Review decision.', 'error');
  } else {
    showToast?.(`Opened ${item.capabilityLabel} for ${item.familyLabel}. Choose Allow or Restrict, then save the draft.`, 'success');
  }
}

function paDismissReviewStrip() {
  sessionStorage.setItem('pa-review-dismissed', '1');
  const strip = document.getElementById('pa-review-strip');
  if (strip) strip.style.display = 'none';
}

function switchTab(tab) {
  currentTab = tab;
  localStorage.setItem('pas_admin_tab', tab);

  // Update nav
  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tab}"]`).classList.add('active');

  // Update content
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tab}`).classList.add('active');

  // Update title
  const titles = {
    dashboard: 'Dashboard',
    logs: 'Server Logs',
    config: 'Configuration',
    ips: 'IP Manager',
    database: 'Database Status',
    nas: 'NAS Storage',
    sdui: 'SDUI Config',
    'plan-access': 'Plan Validation',
  };
  document.getElementById('page-title').textContent = titles[tab] || tab;

  // Toggle Date Filter visibility (only for Dashboard and IP Manager)
  const df = document.getElementById('global-date-filter');
  if (tab === 'dashboard' || tab === 'ips') {
    df.classList.remove('hidden');
  } else {
    df.classList.add('hidden');
  }

  // Hide Connected status and Refresh button on Plan Validation tab
  const isPlanAccess = tab === 'plan-access';
  document.getElementById('server-status').style.display = isPlanAccess ? 'none' : '';
  document.getElementById('refresh-btn').style.display   = isPlanAccess ? 'none' : '';

  // Only load data on first visit — Refresh button handles explicit reloads
  if (!tabLoaded.has(tab)) {
    tabLoaded.add(tab);
    refreshCurrentTab();
  }
}

function refreshCurrentTab() {
  switch (currentTab) {
    case 'dashboard': loadMetrics(); break;
    case 'logs': loadLogs(); break;
    case 'config': loadConfig(); break;
    case 'ips': loadIps(); break;
    case 'database': loadDbStatus(); break;
    case 'nas': loadNasStorage(); break;
    case 'sdui': loadSdui(); break;
    case 'plan-access': pvLoadInit(); break;
  }
}

// ─── Dashboard / Metrics ──────────────────────────────────
async function loadMetrics() {
  try {
    const res = await fetch(API + '/metrics' + getDateQueryParams(), {
      credentials: 'include'
    });
    if (!res.ok) return;
    const { data } = await res.json();

    // Update metric cards
    setText('m-uptime', data.server.uptimeHuman);
    setText('m-started', `Started: ${formatDate(data.server.startedAt)}`);
    setText('m-total-req', data.requests.total.toLocaleString());
    setText('m-rps', `${data.requests.rps} req/s`);
    setText('m-memory', data.memory.heapUsed);
    setText('m-rss', `RSS: ${data.memory.rss}`);
    setText('m-avg-resp', `${data.responseTimes.avg} ms`);
    setText('m-p95', `P95: ${data.responseTimes.p95} ms · P99: ${data.responseTimes.p99} ms`);
    setText('m-active-conn', data.requests.activeConnections);
    setText('m-errors', `Errors: ${data.errors.total}`);
    setText('m-cpu', data.server.loadAvg[0]);
    setText('m-cpus', `${data.server.cpuCount} cores`);

    // Status charts
    renderBarChart('status-chart', data.requests.byStatus, getStatusColor);
    renderBarChart('method-chart', data.requests.byMethod);

    // Top endpoints
    renderTopEndpoints(data.topEndpoints);

    // Recent errors
    renderRecentErrors(data.errors.recent);

    // Server status
    const statusEl = document.getElementById('server-status');
    statusEl.textContent = '● Connected';
    statusEl.classList.remove('error');
  } catch (err) {
    const statusEl = document.getElementById('server-status');
    statusEl.textContent = '● Disconnected';
    statusEl.classList.add('error');
  }
}

function renderBarChart(containerId, data, colorFn) {
  const container = document.getElementById(containerId);
  const entries = Object.entries(data || {}).sort((a, b) => b[1] - a[1]);
  const max = entries.length > 0 ? entries[0][1] : 1;

  container.innerHTML = entries.map(([label, count]) => {
    const pct = Math.max(5, (count / max) * 100);
    const colorClass = colorFn ? colorFn(label) : '';
    return `
      <div class="bar-row">
        <span class="bar-label">${label}</span>
        <div class="bar-track">
          <div class="bar-fill ${colorClass}" style="width:${pct}%">${count.toLocaleString()}</div>
        </div>
      </div>
    `;
  }).join('') || '<p class="muted">No data yet</p>';
}

function getStatusColor(code) {
  const c = parseInt(code);
  if (c >= 200 && c < 300) return 'success';
  if (c >= 300 && c < 400) return 'info';
  if (c >= 400 && c < 500) return 'warning';
  return 'danger';
}

function renderTopEndpoints(endpoints) {
  const tbody = document.getElementById('top-endpoints');
  tbody.innerHTML = (endpoints || []).map(ep => `
    <tr>
      <td class="mono">${escapeHtml(ep.endpoint)}</td>
      <td>${ep.count.toLocaleString()}</td>
      <td>${ep.avgTime} ms</td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="muted">No data yet</td></tr>';
}

function renderRecentErrors(errors) {
  const el = document.getElementById('recent-errors');
  if (!errors || errors.length === 0) {
    el.textContent = 'No errors recorded ✓';
    return;
  }
  el.textContent = errors.map(e =>
    `[${e.timestamp}] ${e.status} ${e.method} ${e.url} (${e.ip})`
  ).join('\n');
}

// ─── Logs ─────────────────────────────────────────────────
async function loadLogs() {
  try {
    const res = await fetch(`${API}/logs`, {
      credentials: 'include'
    });
    const { data } = await res.json();

    const tbody = document.getElementById('log-files');
    tbody.innerHTML = (data || []).map(f => `
      <tr>
        <td class="mono">${escapeHtml(f.name)}</td>
        <td>${f.sizeHuman}</td>
        <td>${formatDate(f.modified)}</td>
        <td>
          <button class="btn btn-ghost btn-sm" onclick="viewLogFile('${escapeHtml(f.name)}')">👁 View</button>
          <button class="btn btn-ghost btn-sm" onclick="downloadLog('${escapeHtml(f.name)}')">⬇ Download</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="muted">No log files found</td></tr>';
  } catch (err) {
    showToast('Failed to load logs', 'error');
  }
}

async function viewLogFile(filename) {
  currentLogFile = filename;
  const lines = document.getElementById('log-lines').value;

  try {
    const res = await fetch(`${API}/logs/${encodeURIComponent(filename)}?lines=${lines}`, {
      credentials: 'include'
    });
    const { data } = await res.json();

    document.getElementById('log-viewer-card').style.display = '';
    document.getElementById('log-viewer-title').textContent = `${data.filename} (${data.returnedLines}/${data.totalLines} lines)`;
    document.getElementById('log-content').textContent = data.content;
    document.getElementById('log-download-btn').onclick = () => downloadLog(filename);

    // Scroll to bottom
    const viewer = document.getElementById('log-content');
    viewer.scrollTop = viewer.scrollHeight;
  } catch (err) {
    showToast('Failed to load log file', 'error');
  }
}

function downloadLog(filename) {
  window.open(`${API}/logs/${encodeURIComponent(filename)}/download`, '_blank');
}

function filterLogs() {
  const search = document.getElementById('log-search').value.toLowerCase();
  const content = document.getElementById('log-content');
  if (!content.dataset.original) {
    content.dataset.original = content.textContent;
  }

  if (!search) {
    content.textContent = content.dataset.original;
    return;
  }

  const lines = content.dataset.original.split('\n');
  const filtered = lines.filter(line => line.toLowerCase().includes(search));
  content.textContent = filtered.join('\n') || 'No matching lines found';
}

// ─── Config ───────────────────────────────────────────────
async function loadConfig() {
  try {
    const res = await fetch(`${API}/config`, {
      credentials: 'include'
    });
    const { data } = await res.json();
    rawConfigData = data;
    renderDynamicConfig(data);
    document.getElementById('config-status').textContent = '';
    
    // Also load backups when config tab is opened
    await loadConfigBackups();
  } catch (err) {
    showToast('Failed to load config', 'error');
  }
}

function renderDynamicConfig(config) {
  const container = document.getElementById('dynamic-config-form');
  container.innerHTML = '';
  const isReadonly = currentRole !== 'editor';

  for (const [sectionKey, sectionValue] of Object.entries(config)) {
    if (sectionKey.startsWith('_') || typeof sectionValue !== 'object' || sectionValue === null) continue;

    const sectionDiv = document.createElement('div');
    sectionDiv.className = 'config-section';
    
    const desc = sectionValue._description || '';
    
    sectionDiv.innerHTML = `
      <div class="config-section-title">${sectionKey}</div>
      ${desc ? `<div class="config-section-desc">${desc}</div>` : ''}
      <div class="config-fields-container" id="cfg-sec-${sectionKey}"></div>
    `;
    
    container.appendChild(sectionDiv);
    
    const fieldsContainer = sectionDiv.querySelector('.config-fields-container');

    for (const [key, value] of Object.entries(sectionValue)) {
      if (key.startsWith('_') || (typeof value === 'object' && !Array.isArray(value))) continue;
      
      const fieldDesc = sectionValue[`_${key}_description`] || '';
      const inputId = `cfg-${sectionKey}-${key}`;
      
      const fieldDiv = document.createElement('div');
      fieldDiv.className = 'config-field';
      
      let inputHtml = '';
      if (typeof value === 'boolean') {
        inputHtml = `
          <div class="config-toggle">
            <input type="checkbox" id="${inputId}" data-section="${sectionKey}" data-key="${key}" ${value ? 'checked' : ''} ${isReadonly ? 'disabled' : ''}>
            <label for="${inputId}">Enabled</label>
          </div>
        `;
      } else if (Array.isArray(value)) {
        inputHtml = `<input type="text" class="config-input config-input-array" id="${inputId}" data-section="${sectionKey}" data-key="${key}" value="${escapeHtml(value.join(', '))}" placeholder="comma-separated values" ${isReadonly ? 'disabled' : ''}>`;
      } else {
        inputHtml = `<input type="text" class="config-input" id="${inputId}" data-section="${sectionKey}" data-key="${key}" value="${escapeHtml(String(value))}" ${isReadonly ? 'disabled' : ''}>`;
      }

      fieldDiv.innerHTML = `
        <div class="config-field-header">
          <div class="config-field-label">${key}</div>
          <div class="config-field-desc">${fieldDesc}</div>
        </div>
        ${inputHtml}
      `;
      fieldsContainer.appendChild(fieldDiv);
    }
  }
}

async function verifyEditKey() {
  const input = document.getElementById('edit-key-input');
  const statusEl = document.getElementById('unlock-status');
  const key = input.value.trim();
  
  if (!key) return;

  try {
    const res = await fetch(`${API}/verify-edit-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key }),
      credentials: 'include'
    });
    const data = await res.json();

    if (res.ok) {
      currentRole = data.data.role;
      updateRoleUI();
      showToast('Edit Access Unlocked!', 'success');
      input.value = '';
    } else {
      statusEl.textContent = `✗ ${data.message}`;
      statusEl.className = 'status-text error';
    }
  } catch (err) {
    statusEl.textContent = `✗ Failed to verify key`;
    statusEl.className = 'status-text error';
  }
}

async function saveConfig() {
  if (currentRole !== 'editor') return;
  const statusEl = document.getElementById('config-status');

  try {
    // Rebuild config object from DOM
    const newConfig = JSON.parse(JSON.stringify(rawConfigData)); // Deep clone
    
    document.querySelectorAll('.config-input').forEach(input => {
      const sec = input.getAttribute('data-section');
      const key = input.getAttribute('data-key');
      if (input.classList.contains('config-input-array')) {
        const arr = input.value.split(',').map(s => s.trim()).filter(s => s !== '');
        if (newConfig[sec]) newConfig[sec][key] = arr;
        return;
      }
      let val = input.value;
      if (!isNaN(val) && val.trim() !== '') val = Number(val);
      if (newConfig[sec]) newConfig[sec][key] = val;
    });

    document.querySelectorAll('.config-toggle input[type="checkbox"]').forEach(input => {
      const sec = input.getAttribute('data-section');
      const key = input.getAttribute('data-key');
      if (newConfig[sec]) newConfig[sec][key] = input.checked;
    });

    const res = await fetch(`${API}/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
      credentials: 'include'
    });

    const data = await res.json();

    if (res.ok) {
      statusEl.textContent = '✓ Config saved, reloaded, and Telegram alert sent';
      statusEl.className = 'status-text success';
      showToast('Config saved successfully!', 'success');
      loadConfigBackups(); // Refresh backups table to show the new fallback
    } else {
      statusEl.textContent = `✗ ${data.message}`;
      statusEl.className = 'status-text error';
    }
  } catch (err) {
    statusEl.textContent = `✗ ${err.message}`;
    statusEl.className = 'status-text error';
  }
}

async function loadConfigBackups() {
  try {
    const res = await fetch(`${API}/config/backups`, {
      credentials: 'include'
    });
    const { data } = await res.json();
    
    const tbody = document.getElementById('config-backups-table');
    if (!data || data.length === 0) {
      tbody.innerHTML = '<tr><td colspan="4" class="text-center muted" style="text-align: center;">No backups available yet</td></tr>';
      return;
    }

    const isReadonly = currentRole !== 'editor';

    tbody.innerHTML = data.map(b => `
      <tr>
        <td class="mono">${escapeHtml(b.filename)}</td>
        <td>${formatDate(b.timestamp)}</td>
        <td>${b.sizeBody}</td>
        <td>
          <button class="btn btn-warning btn-sm" onclick="restoreConfig('${escapeHtml(b.filename)}')" ${isReadonly ? 'disabled' : ''}>Restore</button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    showToast('Failed to load config backups', 'error');
  }
}

async function restoreConfig(filename) {
  if (currentRole !== 'editor') return;
  if (!confirm(`Are you sure you want to rollback the server configuration to ${filename}?\n\nThis will immediately overwrite the active settings.`)) return;

  try {
    const res = await fetch(`${API}/config/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename }),
      credentials: 'include'
    });

    const data = await res.json();

    if (res.ok) {
      showToast('Configuration successfully rolled back!', 'success');
      loadConfig(); // Reload the UI to show the new active config
    } else {
      showToast(`Rollback failed: ${data.message}`, 'error');
    }
  } catch (err) {
    showToast(`Rollback failed: ${err.message}`, 'error');
  }
}

// ─── IP Manager ───────────────────────────────────────────
async function loadIps() {
  await loadBlockedIps();
  await loadIpStats();
}

async function loadBlockedIps() {
  try {
    const res = await fetch(`${API}/blocked-ips`, {
      credentials: 'include'
    });
    const { data } = await res.json();

    const container = document.getElementById('blocked-ips-list');
    if (!data || data.length === 0) {
      container.innerHTML = '<p class="muted">No blocked IPs</p>';
      return;
    }

    container.innerHTML = data.map(ip => `
      <span class="blocked-ip-tag">
        ${escapeHtml(ip)}
        <button onclick="unblockIp('${escapeHtml(ip)}')" title="Unblock">✕</button>
      </span>
    `).join('');
  } catch (err) {
    showToast('Failed to load blocked IPs', 'error');
  }
}

async function loadIpStats() {
  try {
    const res = await fetch(API + '/metrics/ips' + getDateQueryParams(), {
      credentials: 'include'
    });
    const { data } = await res.json();

    const tbody = document.getElementById('ip-stats-table');
    tbody.innerHTML = (data || []).slice(0, 100).map(ip => `
      <tr data-ip="${escapeHtml(ip.ip)}">
        <td class="mono">${escapeHtml(ip.ip)}</td>
        <td>${ip.requests.toLocaleString()}</td>
        <td>${formatDate(ip.firstSeen)}</td>
        <td>${formatDate(ip.lastSeen)}</td>
        <td>
          <ul class="ip-endpoints-list">
            ${Object.entries(ip.endpoints || {}).map(([ep, count]) => `<li><span class="mono">${escapeHtml(ep)}</span>: ${count}</li>`).join('')}
          </ul>
        </td>
        <td>
          <button class="btn btn-danger btn-sm" onclick="blockIpDirect('${escapeHtml(ip.ip)}')">🚫 Block</button>
        </td>
      </tr>
    `).join('') || '<tr><td colspan="6" class="muted">No IP data yet</td></tr>';
  } catch (err) {
    showToast('Failed to load IP stats', 'error');
  }
}

async function blockIp() {
  const input = document.getElementById('block-ip-input');
  const ip = input.value.trim();
  if (!ip) return;

  await blockIpDirect(ip);
  input.value = '';
}

async function blockIpDirect(ip) {
  try {
    await fetch(`${API}/blocked-ips`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ip }),
      credentials: 'include'
    });
    showToast(`IP ${ip} blocked`, 'success');
    loadBlockedIps();
  } catch (err) {
    showToast('Failed to block IP', 'error');
  }
}

async function unblockIp(ip) {
  try {
    await fetch(`${API}/blocked-ips/${encodeURIComponent(ip)}`, {
      method: 'DELETE',
      credentials: 'include'
    });
    showToast(`IP ${ip} unblocked`, 'success');
    loadBlockedIps();
  } catch (err) {
    showToast('Failed to unblock IP', 'error');
  }
}

function filterIpTable() {
  const search = document.getElementById('ip-search').value.toLowerCase();
  document.querySelectorAll('#ip-stats-table tr').forEach(row => {
    const ip = row.getAttribute('data-ip') || '';
    row.style.display = ip.toLowerCase().includes(search) ? '' : 'none';
  });
}

// ─── Database Status ──────────────────────────────────────
async function loadDbStatus() {
  try {
    const res = await fetch(`${API}/db-status`, {
      credentials: 'include'
    });
    const { data } = await res.json();

    const container = document.getElementById('db-status-content');
    const networks = Object.keys(data.health || {});

    if (networks.length === 0) {
      container.innerHTML = '<p class="muted">No database connections configured</p>';
      return;
    }

    container.innerHTML = networks.map(network => {
      const health = data.health[network];
      const pool = data.poolStats?.[network] || {};

      return `
        <div class="db-network">
          <div class="db-network-title">${escapeHtml(network)}</div>
          <div class="db-connections">
            ${renderDbConn('SQL', health.sql, pool.sql)}
            ${renderDbConn('MongoDB', health.mongo, pool.mongo)}
            ${renderDbConn('Elasticsearch', health.elastic, pool.elastic)}
          </div>
        </div>
      `;
    }).join('');
  } catch (err) {
    showToast('Failed to load database status', 'error');
  }
}

function renderDbConn(type, health, pool) {
  const isConnected = health?.status === 'connected';
  const statusClass = isConnected ? 'connected' : 'disconnected';
  const statusText = health?.status || 'unknown';

  let poolInfo = '';
  if (isConnected && pool && pool.totalConnections !== undefined) {
    poolInfo = `
      <div class="pool-stats">
        active: ${pool.totalConnections - pool.freeConnections} / ${pool.totalConnections}
        ${pool.pendingRequests > 0 ? ` · queued: ${pool.pendingRequests}` : ''}
      </div>
    `;
  }

  return `
    <div class="db-conn-card">
      <div class="type">${type}</div>
      <div class="status ${statusClass}">● ${statusText}</div>
      ${poolInfo}
    </div>
  `;
}

// ─── NAS Storage ──────────────────────────────────────────
function nasFmtBytes(n) {
  if (n == null || isNaN(n)) return '—';
  const neg = n < 0;
  let v = Math.abs(n);
  const u = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  let i = 0;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (neg ? '-' : '') + (v >= 100 || i === 0 ? v.toFixed(0) : v.toFixed(1)) + ' ' + u[i];
}

async function loadNasStorage() {
  try {
    const res = await fetch(`${API}/nas-storage?days=30`, { credentials: 'include' });
    const { data } = await res.json();
    const s = data.storage;
    if (s) {
      setText('nas-total', nasFmtBytes(s.totalBytes));
      setText('nas-mount', `${s.mount} · as of ${formatDate(s.at)}`);
      setText('nas-free', nasFmtBytes(s.freeBytes));
      setText('nas-free-pct', `${(100 - s.pctUsed).toFixed(1)}% free`);
      setText('nas-used', nasFmtBytes(s.usedBytes));
      setText('nas-used-pct', `${s.pctUsed}% used`);
      const bar = document.getElementById('nas-usage-bar');
      bar.style.width = `${Math.max(3, s.pctUsed)}%`;
      bar.textContent = `${s.pctUsed}%`;
      bar.className = 'bar-fill ' + (s.pctUsed >= 90 ? 'danger' : s.pctUsed >= 75 ? 'warning' : 'success');
      setText('nas-usage-note', `${nasFmtBytes(s.usedBytes)} used of ${nasFmtBytes(s.totalBytes)} · ${nasFmtBytes(s.freeBytes)} free`);
    } else {
      setText('nas-total', 'unavailable');
      setText('nas-mount', data.storageError || 'NAS df unavailable');
    }
    setText('nas-last-growth', data.lastDayGrowthBytes != null ? nasFmtBytes(data.lastDayGrowthBytes) : '—');
    setText('nas-as-of', `${data.points} daily snapshot${data.points === 1 ? '' : 's'} recorded`);

    renderNasGrowthChart('nas-daily-chart', (data.daily || []).filter((d) => d.growthBytes != null));

    const tbody = document.getElementById('nas-daily-table');
    tbody.innerHTML = (data.daily || []).slice().reverse().map((d) => `
      <tr>
        <td>${d.date}</td>
        <td>${nasFmtBytes(d.usedBytes)}</td>
        <td>${nasFmtBytes(d.freeBytes)}</td>
        <td>${d.growthBytes == null ? '<span class="muted">—</span>' : nasFmtBytes(d.growthBytes)}</td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="muted">No snapshots yet</td></tr>';

    const statusEl = document.getElementById('server-status');
    statusEl.textContent = '● Connected';
    statusEl.classList.remove('error');
  } catch (err) {
    showToast('Failed to load NAS storage', 'error');
  }
}

function renderNasGrowthChart(containerId, series) {
  const el = document.getElementById(containerId);
  if (!series.length) {
    el.innerHTML = '<p class="muted">Day-over-day growth appears after the second daily snapshot (≈ tomorrow).</p>';
    return;
  }
  const max = Math.max(1, ...series.map((d) => Math.abs(d.growthBytes)));
  el.innerHTML = series.map((d) => {
    const pct = Math.max(3, (Math.abs(d.growthBytes) / max) * 100);
    const cls = d.growthBytes < 0 ? 'info' : 'success';
    return `
      <div class="bar-row">
        <span class="bar-label">${d.date.slice(5)}</span>
        <div class="bar-track">
          <div class="bar-fill ${cls}" style="width:${pct}%">${nasFmtBytes(d.growthBytes)}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ─── Helpers ──────────────────────────────────────────────
function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  const d = new Date(isoStr);
  return d.toLocaleString();
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function showToast(message, type = 'info') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 4000);
}

// ═══════════════════════════════════════════════════════════
// SDUI Config — proper form UI (ported from Go SDUI-Backend)
// ═══════════════════════════════════════════════════════════

// ─── Constants ────────────────────────────────────────────
const SDUI_FILTER_TYPES = [
  'icon_toggle','checkbox','radio','segmented_control',
  'dropdown_single','dropdown_multi','chip_multi_select','nested_select',
  'range_slider','date_preset','date_range_custom',
  'toggle_switch','text_input','autocomplete','combobox','number_stepper',
];
const SDUI_DISPLAY_MODES = ['input','tab_toggle','icon_pill','dropdown','accordion','inline'];
const SDUI_ICON_TYPES    = ['svg','url','none'];
const SDUI_PLATFORMS     = ['facebook','instagram','youtube','google','gdn','native','linkedin','reddit','quora','pinterest','tiktok'];
const SDUI_TYPES_WITH_OPTS = ['icon_toggle','checkbox','radio','segmented_control','dropdown_single','dropdown_multi','chip_multi_select','nested_select','date_preset','combobox'];
const SDUI_INPUT_TYPES   = ['text_input','autocomplete'];
const SDUI_MODE_COLORS   = {
  accordion: 'background:rgba(100,116,139,.2);color:#94a3b8',
  dropdown:  'background:rgba(6,182,212,.15);color:#67e8f9',
  icon_pill: 'background:rgba(20,184,166,.15);color:#5eead4',
  input:     'background:rgba(99,102,241,.2);color:#a5b4fc',
  tab_toggle:'background:rgba(236,72,153,.15);color:#f9a8d4',
  inline:    'background:rgba(234,179,8,.15);color:#fcd34d',
};

// ─── State ────────────────────────────────────────────────
let sduiDocs        = [];
let sduiFilter      = 'all';
let sduiEditDoc     = null;   // deep copy being edited
let sduiEditOrig    = null;   // pristine snapshot for rollback/diff
let sduiEditMTab    = 'document';
let sduiDeleteId    = null;
let sduiPendingSave = null;

// ─── Helpers ──────────────────────────────────────────────
function sduiDeep(o) { return JSON.parse(JSON.stringify(o)); }
function sduiIsPosInt(v) { return /^\d+$/.test(String(v)) && parseInt(v) >= 1; }
function sduiIsCamel(v)  { return /^[a-z][a-zA-Z0-9]*$/.test(v); }
function sduiIsSnake(v)  { return /^[a-z][a-z0-9_]*$/.test(v); }
function sduiNvl(v, d)   { return (v === null || v === undefined) ? d : v; }
function sduiFArr(v) {
  if (!v || v === 'all') return 'all';
  if (Array.isArray(v)) return v;
  return 'all';
}
function sduiSelectHtml(id, opts, cur) {
  return `<select id="${id}" class="sfi">${opts.map(o =>
    `<option value="${escapeHtml(o)}"${o === cur ? ' selected' : ''}>${escapeHtml(o)}</option>`
  ).join('')}</select>`;
}

// ─── Load & render cards ──────────────────────────────────
async function loadSdui() {
  const grid = document.getElementById('sdui-docs-grid');
  grid.innerHTML = '<p class="muted">Loading...</p>';
  try {
    const res = await fetch(`${API}/sdui/docs`, {
      credentials: 'include'
    });
    const { data } = await res.json();
    sduiDocs = data || [];
    renderSduiDocs();
  } catch (err) {
    grid.innerHTML = '<p class="muted">Failed to load documents</p>';
    showToast('Failed to load SDUI documents', 'error');
  }
}

function renderSduiDocs() {
  const grid = document.getElementById('sdui-docs-grid');
  const filtered = sduiFilter === 'all' ? sduiDocs : sduiDocs.filter(d => d.config_type === sduiFilter);
  if (!filtered.length) { grid.innerHTML = '<p class="muted">No documents found</p>'; return; }

  const isEditor = currentRole === 'editor';
  const sorted = [...filtered].sort((a, b) => (a.rank || 0) - (b.rank || 0));

  grid.innerHTML = sorted.map(doc => {
    const id  = escapeHtml(String(doc._id));
    const typ = escapeHtml(doc.config_type || '');
    const mode = escapeHtml(doc.display_mode || '');
    const modeStyle = SDUI_MODE_COLORS[doc.display_mode] || 'background:rgba(100,116,139,.2);color:#94a3b8';
    const fl  = (doc.filters || []).length;
    return `
      <div class="sdui-doc-card">
        <div>
          <div class="sdui-doc-badges">
            <span class="sdui-type-badge sdui-type-${typ}">${typ}</span>
            <span class="sdui-mode-badge" style="${modeStyle}">${mode}</span>
            <span style="font-size:10px;color:var(--text-muted)">#${doc.rank || '?'}</span>
            ${!doc.flag ? '<span class="sdui-inactive-badge">inactive</span>' : ''}
            ${!doc.visible ? '<span class="sdui-hidden-badge">hidden</span>' : ''}
          </div>
          <div class="sdui-doc-title">${escapeHtml(doc.title || doc.name || id)}</div>
          <div class="sdui-doc-id">${id}</div>
        </div>
        ${doc.meta ? `<div class="sdui-doc-meta">${escapeHtml(doc.meta)}</div>` : ''}
        <div class="sdui-doc-footer">
          <label class="sdui-toggle">
            <input type="checkbox" ${doc.visible ? 'checked' : ''} ${isEditor ? '' : 'disabled'} onchange="sduiToggle('${id}','visible',this.checked)">
            <span>Visible</span>
          </label>
          <label class="sdui-toggle">
            <input type="checkbox" ${doc.flag ? 'checked' : ''} ${isEditor ? '' : 'disabled'} onchange="sduiToggle('${id}','flag',this.checked)">
            <span>Active</span>
          </label>
          <span style="margin-left:auto;color:var(--text-muted)">${fl} filter${fl !== 1 ? 's' : ''}</span>
          <div class="sdui-doc-btns">
            <button class="sdui-icon-btn sdui-btn-history" data-tip="Version history" onclick="openSduiHistory('${id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.95"/></svg>
            </button>
            <button class="sdui-icon-btn sdui-btn-edit" data-tip="Edit document" onclick="openSduiEdit('${id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            </button>
            ${isEditor ? `<button class="sdui-icon-btn sdui-btn-delete" data-tip="Delete document" onclick="openSduiDelete('${id}')">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
            </button>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ─── Toggle visible / flag (quick patch) ─────────────────
async function sduiToggle(id, field, value) {
  try {
    const res = await fetch(`${API}/sdui/docs/${encodeURIComponent(id)}/${field}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: value }),
      credentials: 'include'

    });
    if (!res.ok) throw new Error('Failed');
    const doc = sduiDocs.find(d => String(d._id) === id);
    if (doc) doc[field] = value;
    showToast(`${field} updated`, 'success');
  } catch {
    showToast(`Failed to update ${field}`, 'error');
    loadSdui();
  }
}

// ─── Open edit modal ──────────────────────────────────────
function openSduiEdit(id) {
  const doc = sduiDocs.find(d => String(d._id) === id);
  if (!doc) return;
  sduiEditDoc  = sduiDeep(doc);
  sduiEditOrig = sduiDeep(doc);
  sduiEditMTab = 'document';

  // header
  const badge = document.getElementById('sdui-modal-badge');
  badge.className = `sdui-type-badge sdui-type-${doc.config_type || ''}`;
  badge.textContent = doc.config_type || '';
  document.getElementById('sdui-modal-title').textContent = doc.title || doc.name || id;
  document.getElementById('sdui-modal-subtitle').textContent = id;

  // reset tabs
  document.querySelectorAll('.sdui-mtab').forEach(t => {
    t.classList.toggle('active', t.dataset.mtab === 'document');
  });
  document.getElementById('sdui-modal-err-summary').classList.add('hidden');

  sduiRenderModalBody();

  // Show/hide edit controls based on role
  const isEditor = currentRole === 'editor';
  document.getElementById('sdui-rollback-btn').classList.toggle('hidden', !isEditor);
  document.getElementById('sdui-modal-save').classList.toggle('hidden', !isEditor);

  document.getElementById('sdui-edit-modal').classList.remove('hidden');
}

function closeSduiModal() {
  document.getElementById('sdui-edit-modal').classList.add('hidden');
  sduiEditDoc = null; sduiEditOrig = null;
}

function sduiRollback() {
  if (!sduiEditOrig) return;
  if (!confirm('Discard ALL your edits and restore the original values?\n\nThis cannot be undone.')) return;
  sduiEditDoc = sduiDeep(sduiEditOrig);
  document.getElementById('sdui-modal-err-summary').classList.add('hidden');
  sduiRenderModalBody();
  showToast('All edits rolled back to original', 'info');
}

// ─── Modal body rendering (3 tabs) ───────────────────────
function sduiRenderModalBody() {
  const body = document.getElementById('sdui-modal-body');
  if (sduiEditMTab === 'document') body.innerHTML = sduiRenderDocTab();
  else if (sduiEditMTab === 'filters') body.innerHTML = sduiRenderFiltersTab();
  else body.innerHTML = sduiRenderJsonTab();
  sduiBindDocEvents();

  // Disable all inputs when viewer (read-only mode)
  if (currentRole !== 'editor') {
    body.querySelectorAll('input, select, textarea, button').forEach(el => {
      el.disabled = true;
    });
  }
}

// ─── Document tab ─────────────────────────────────────────
function sduiRenderDocTab() {
  const d  = sduiEditDoc;
  const iv = (d.icon && d.icon.value) ? d.icon.value : '';
  const it = (d.icon && d.icon.type)  ? d.icon.type  : 'none';
  return `
    <div class="sg2">
      <div class="sfg">
        <label class="sfl">_id (read-only)</label>
        <input class="sfi" value="${escapeHtml(d._id)}" readonly>
      </div>
      <div class="sfg">
        <label class="sfl">Config Type (read-only)</label>
        <input class="sfi" value="${escapeHtml(d.config_type)}" readonly>
      </div>
      <div class="sfg">
        <label class="sfl">Title <span style="color:#ef4444">*</span></label>
        <input id="e-title" class="sfi" value="${escapeHtml(d.title || '')}" placeholder="CAPS e.g. CATEGORY">
        <span class="sfe" id="e-title-err"></span>
        <span class="sfh">Must be all-caps</span>
      </div>
      <div class="sfg">
        <label class="sfl">Rank <span style="color:#ef4444">*</span></label>
        <input id="e-rank" class="sfi" type="number" min="1" value="${sduiNvl(d.rank, 1)}">
        <span class="sfe" id="e-rank-err"></span>
      </div>
      <div class="sfg" style="grid-column:1/-1">
        <label class="sfl">Display Mode <span style="color:#ef4444">*</span></label>
        ${sduiSelectHtml('e-dmode', SDUI_DISPLAY_MODES, d.display_mode)}
        <span class="sfe" id="e-dmode-err"></span>
      </div>
    </div>
    <div class="sdui-check-row">
      <label class="sdui-check-item">
        <input type="checkbox" id="e-visible" ${d.visible ? 'checked' : ''}>
        <div><span>Visible</span><small>Show in UI</small></div>
      </label>
      <label class="sdui-check-item">
        <input type="checkbox" id="e-collapsed" ${d.collapsed_by_default ? 'checked' : ''}>
        <div><span>Collapsed</span><small>Start collapsed</small></div>
      </label>
      <label class="sdui-check-item">
        <input type="checkbox" id="e-flag" ${d.flag ? 'checked' : ''}>
        <div><span>Active (flag)</span><small>Enable feature</small></div>
      </label>
    </div>
    <div class="sdui-cpanel" style="margin-top:12px">
      <div class="sdui-cpanel-title">Icon</div>
      <div class="sg2">
        <div class="sfg">
          <label class="sfl">Icon Type <span style="color:#ef4444">*</span></label>
          ${sduiSelectHtml('e-itype', SDUI_ICON_TYPES, it)}
        </div>
        <div class="sfg" id="e-ivalue-wrap" ${it === 'none' ? 'style="display:none"' : ''}>
          <label class="sfl">Icon Value <span style="color:#ef4444">*</span></label>
          <textarea id="e-ivalue" class="sfi sfi-ta" rows="3" placeholder="Inline SVG or absolute URL...">${escapeHtml(iv)}</textarea>
          <span class="sfe" id="e-ivalue-err"></span>
          <span class="sfh">SVG string or https:// URL</span>
        </div>
      </div>
    </div>
    <div class="sfg" style="margin-top:12px">
      <label class="sfl">Meta Description <span style="color:#ef4444">*</span></label>
      <textarea id="e-meta" class="sfi sfi-ta" rows="3" placeholder="Describe what this filter group does...">${escapeHtml(d.meta || '')}</textarea>
      <span class="sfe" id="e-meta-err"></span>
      <span class="sfh">Used for tooltips and accessibility labels</span>
    </div>`;
}

function sduiBindDocEvents() {
  const itSel = document.getElementById('e-itype');
  if (itSel) {
    itSel.onchange = () => {
      const wrap = document.getElementById('e-ivalue-wrap');
      wrap.style.display = itSel.value === 'none' ? 'none' : '';
    };
  }
  const titleIn = document.getElementById('e-title');
  if (titleIn) titleIn.oninput = () => { titleIn.value = titleIn.value.toUpperCase(); };
}

// ─── Filters tab ─────────────────────────────────────────
function sduiRenderFiltersTab() {
  const filters = sduiEditDoc.filters || [];
  const isEditor = currentRole === 'editor';
  const addBtn = isEditor
    ? `<div style="display:flex;justify-content:flex-end;margin-bottom:10px">
        <button class="btn btn-ghost btn-sm" style="color:var(--accent)" onclick="sduiAddFilter()">
          + Add Filter
        </button>
       </div>`
    : '';
  if (!filters.length) {
    return addBtn + '<div style="text-align:center;color:var(--text-muted);padding:30px 0;font-size:13px">No filters yet. Click "+ Add Filter" to add one.</div>';
  }
  return addBtn + filters.map((f, fi) => sduiRenderFilterAcc(f, fi)).join('');
}

function sduiRenderFilterAcc(f, fi) {
  const tColors = {
    range_slider:'background:rgba(139,92,246,.15);color:#c4b5fd', toggle_switch:'background:rgba(34,197,94,.15);color:#86efac',
    text_input:'background:rgba(59,130,246,.15);color:#93c5fd',   autocomplete:'background:rgba(6,182,212,.15);color:#67e8f9',
    date_preset:'background:rgba(245,158,11,.15);color:#fcd34d',  date_range_custom:'background:rgba(249,115,22,.15);color:#fdba74',
    checkbox:'background:rgba(99,102,241,.2);color:#a5b4fc',      radio:'background:rgba(236,72,153,.15);color:#f9a8d4',
    icon_toggle:'background:rgba(20,184,166,.15);color:#5eead4',  chip_multi_select:'background:rgba(167,139,250,.15);color:#c4b5fd',
    nested_select:'background:rgba(244,63,94,.15);color:#fda4af',
  };
  const tc = tColors[f.type] || 'background:rgba(100,116,139,.2);color:#94a3b8';
  const dotColor = f.visible ? '#4ade80' : '#475569';
  const isEditor = currentRole === 'editor';
  const removeBtn = isEditor
    ? `<button onclick="event.stopPropagation();sduiRemoveFilter(${fi})" style="background:none;border:none;cursor:pointer;color:#f87171;padding:2px 6px;border-radius:4px;font-size:11px;flex-shrink:0" title="Remove filter">✕</button>`
    : '';
  return `
    <div class="sacc" id="facc-${fi}">
      <div class="sacc-hdr" onclick="sduiToggleAcc(${fi})">
        <span class="sacc-arrow" id="farrow-${fi}">▼</span>
        <span style="font-size:11px;font-weight:600;font-family:var(--font-mono);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(f._id || '(new filter)')}</span>
        <span style="font-size:10px;font-weight:600;padding:2px 7px;border-radius:4px;${tc}">${escapeHtml(f.type)}</span>
        <span style="font-size:10px;color:var(--text-muted)">rank ${f.rank}</span>
        <span style="width:8px;height:8px;border-radius:50%;background:${dotColor};flex-shrink:0"></span>
        ${removeBtn}
      </div>
      <div class="sacc-body" id="fbody-${fi}">${sduiRenderFilterBody(f, fi)}</div>
    </div>`;
}

function sduiRenderFilterBody(f, fi) {
  const p = `fi${fi}`;
  const pa = sduiFArr(f.platform_applicability);
  const hasOpts = SDUI_TYPES_WITH_OPTS.includes(f.type);

  let html = `
    <div class="sg2">
      <div class="sfg">
        <label class="sfl">Filter _id <span style="color:#ef4444">*</span></label>
        <input id="${p}-fid" class="sfi" value="${escapeHtml(f._id)}" style="font-family:var(--font-mono);font-size:11px" placeholder="snake_case e.g. ad_type">
        <span class="sfh">snake_case, unique within this doc</span>
      </div>
      <div class="sfg">
        <label class="sfl">Type <span style="color:#ef4444">*</span></label>
        <select id="${p}-ftype" class="sfi" onchange="sduiChangeFilterType(${fi}, this.value)">${
          SDUI_FILTER_TYPES.map(t => `<option value="${t}"${t === f.type ? ' selected' : ''}>${t}</option>`).join('')
        }</select>
      </div>
      <div class="sfg">
        <label class="sfl">Label <span style="color:#ef4444">*</span></label>
        <input id="${p}-label" class="sfi" value="${escapeHtml(f.label || '')}">
        <span class="sfe" id="${p}-label-err"></span>
      </div>
      <div class="sfg">
        <label class="sfl">Rank <span style="color:#ef4444">*</span></label>
        <input id="${p}-rank" class="sfi" type="number" min="1" value="${f.rank || 1}">
        <span class="sfe" id="${p}-rank-err"></span>
      </div>
      <div class="sfg">
        <label class="sfl">Query Param <span style="color:#ef4444">*</span></label>
        <input id="${p}-qp" class="sfi" style="font-family:var(--font-mono);font-size:11px" value="${escapeHtml(f.query_param || '')}" placeholder="camelCase">
        <span class="sfe" id="${p}-qp-err"></span>
        <span class="sfh">camelCase e.g. sortBy</span>
      </div>
    </div>
    <div style="display:flex;gap:16px;margin:10px 0">
      <label class="sdui-toggle"><input type="checkbox" id="${p}-vis" ${f.visible ? 'checked' : ''}><span style="font-size:12px">Visible</span></label>
      <label class="sdui-toggle"><input type="checkbox" id="${p}-ms" ${f.multi_select ? 'checked' : ''}><span style="font-size:12px">Multi-select</span></label>
    </div>
    <div style="margin-bottom:10px">
      <label class="sfl">Platform Applicability <span style="color:#ef4444">*</span></label>
      ${sduiPlatformChipsHtml(p, pa)}
      <span class="sfe" id="${p}-pa-err"></span>
    </div>`;

  // range_slider
  if (f.type === 'range_slider') {
    html += `
      <div class="sdui-cpanel" style="border-color:rgba(139,92,246,.3)">
        <div class="sdui-cpanel-title" style="color:#c4b5fd">Range Slider Config</div>
        <div class="sg3">
          <div class="sfg"><label class="sfl">Min <span style="color:#ef4444">*</span></label><input id="${p}-min" class="sfi" type="number" value="${sduiNvl(f.min, 0)}"><span class="sfe" id="${p}-min-err"></span></div>
          <div class="sfg"><label class="sfl">Max <span style="color:#ef4444">*</span></label><input id="${p}-max" class="sfi" type="number" value="${sduiNvl(f.max, 100)}"><span class="sfe" id="${p}-max-err"></span></div>
          <div class="sfg"><label class="sfl">Step <span style="color:#ef4444">*</span></label><input id="${p}-step" class="sfi" type="number" min="0.001" value="${sduiNvl(f.step, 1)}"><span class="sfe" id="${p}-step-err"></span></div>
          <div class="sfg"><label class="sfl">Default Min</label><input id="${p}-dmin" class="sfi" type="number" value="${sduiNvl(f.default_min, 0)}"></div>
          <div class="sfg"><label class="sfl">Default Max</label><input id="${p}-dmax" class="sfi" type="number" value="${sduiNvl(f.default_max, 100)}"></div>
          <div class="sfg"><label class="sfl">Unit</label><input id="${p}-unit" class="sfi" value="${escapeHtml(f.unit || '')}" placeholder="USD, days…"></div>
        </div>
        <div class="sg3" style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border)">
          <div class="sfg">
            <label class="sfl">Slider Scale</label>
            <select id="${p}-scale" class="sfi">
              <option value="exponential" ${(f.slider_scale||'exponential')==='exponential'?'selected':''}>Exponential</option>
              <option value="linear" ${f.slider_scale==='linear'?'selected':''}>Linear</option>
            </select>
            <span class="sfh">Exponential = more resolution at low values.</span>
          </div>
          <div class="sfg">
            <label class="sfl">Pin Mode</label>
            <select id="${p}-pin" class="sfi">
              <option value="single" ${(f.pin_mode||'single')==='single'?'selected':''}>Single Pin</option>
              <option value="double" ${f.pin_mode==='double'?'selected':''}>Double Pin</option>
            </select>
            <span class="sfh">Double = two thumbs for a sub-range.</span>
          </div>
          <div class="sfg">
            <label class="sfl">Loose Ends</label>
            <select id="${p}-loose" class="sfi">
              <option value="none"  ${(f.loose_ends||'none')==='none'?'selected':''}>None (capped)</option>
              <option value="left"  ${f.loose_ends==='left'?'selected':''}>Left (no min)</option>
              <option value="right" ${f.loose_ends==='right'?'selected':''}>Right (no max)</option>
              <option value="both"  ${f.loose_ends==='both'?'selected':''}>Both (uncapped)</option>
            </select>
          </div>
        </div>
      </div>`;
  }

  // text_input / autocomplete
  if (SDUI_INPUT_TYPES.includes(f.type)) {
    html += `
      <div class="sdui-cpanel" style="border-color:rgba(59,130,246,.3)">
        <div class="sdui-cpanel-title" style="color:#93c5fd">Input Config</div>
        <div class="sg2">
          <div class="sfg"><label class="sfl">Placeholder <span style="color:#ef4444">*</span></label><input id="${p}-ph" class="sfi" value="${escapeHtml(f.placeholder||'')}"><span class="sfe" id="${p}-ph-err"></span></div>
          <div class="sfg"><label class="sfl">Debounce (ms)</label><input id="${p}-db" class="sfi" type="number" min="0" value="${sduiNvl(f.debounce_ms, 300)}"></div>
          <div class="sfg"><label class="sfl">Min Length</label><input id="${p}-minl" class="sfi" type="number" min="0" value="${sduiNvl(f.min_length, 2)}"></div>
          <div class="sfg"><label class="sfl">Max Length</label><input id="${p}-maxl" class="sfi" type="number" min="1" value="${sduiNvl(f.max_length, 120)}"></div>
        </div>
      </div>`;
  }

  // date_range_custom
  if (f.type === 'date_range_custom') {
    html += `
      <div class="sdui-cpanel" style="border-color:rgba(249,115,22,.3)">
        <div class="sdui-cpanel-title" style="color:#fdba74">Date Range Config</div>
        <div class="sg2">
          <div class="sfg"><label class="sfl">Min Field <span style="color:#ef4444">*</span></label><input id="${p}-mf" class="sfi" style="font-family:var(--font-mono);font-size:11px" value="${escapeHtml(f.min_field||'startDate')}"><span class="sfe" id="${p}-mf-err"></span></div>
          <div class="sfg"><label class="sfl">Max Field <span style="color:#ef4444">*</span></label><input id="${p}-xf" class="sfi" style="font-family:var(--font-mono);font-size:11px" value="${escapeHtml(f.max_field||'endDate')}"><span class="sfe" id="${p}-xf-err"></span></div>
          <div class="sfg"><label class="sfl">Format</label><input id="${p}-fmt" class="sfi" value="${escapeHtml(f.format||'YYYY-MM-DD')}"></div>
          <div class="sfg"><label class="sfl">Default Mode</label><input id="${p}-dm" class="sfi" value="${escapeHtml(f.default_mode||'current_date')}"></div>
        </div>
      </div>`;
  }

  // options table
  if (hasOpts) html += sduiRenderOptsTable(f, fi);

  return html;
}

// ─── Options table ────────────────────────────────────────
function sduiRenderOptsTable(f, fi) {
  const isIcon = (f.type === 'icon_toggle');
  const opts   = f.options || [];
  const gridCls = isIcon ? 'sopt-grid-icon' : 'sopt-grid-std';
  const rows = opts.map((o, oi) => sduiRenderOptRow(o, fi, oi, isIcon, f.platform_applicability)).join('');
  return `
    <div style="border-top:1px solid var(--border);padding-top:14px;margin-top:6px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <span style="font-size:11px;font-weight:600;color:var(--text-secondary)">Options (${opts.length})</span>
        <button onclick="sduiAddOption(${fi})" class="btn btn-ghost btn-sm" style="font-size:11px;color:var(--accent)">+ Add Option</button>
      </div>
      <div class="${gridCls}" style="font-size:10px;font-weight:600;color:var(--text-muted);margin-bottom:4px;padding:0 2px">
        <span>_id</span><span>Label</span><span>Value</span><span style="text-align:center">Rank</span>
        ${isIcon ? '<span>Icon URL</span>' : ''}
        <span style="text-align:center">Default</span><span></span>
      </div>
      <div id="opts-${fi}">${rows}</div>
    </div>`;
}

function sduiRenderOptRow(o, fi, oi, isIcon, filterPlatforms) {
  const gc      = isIcon ? 'sopt-grid-icon' : 'sopt-grid-std';
  const pfx     = `opt${fi}-${oi}`;
  // Restrict option chips to only the platforms the parent filter supports
  const allowed = (Array.isArray(filterPlatforms) && filterPlatforms.length) ? filterPlatforms : null;
  // If option has platforms outside filter's allowed set, clamp to allowed
  const curPlat = (() => {
    if (!allowed) return o.platform_applicability || 'all';
    if (!Array.isArray(o.platform_applicability)) return 'all';
    const clamped = o.platform_applicability.filter(p => allowed.includes(p));
    return clamped.length ? clamped : 'all';
  })();
  return `
    <div style="margin-bottom:6px;border:1px solid rgba(255,255,255,0.07);border-radius:6px;padding:6px 8px" id="optrow-${fi}-${oi}">
      <div class="${gc}" style="margin-bottom:6px">
        <input class="sfi" style="font-size:11px;font-family:var(--font-mono)" id="oid-${fi}-${oi}" value="${escapeHtml(o._id||'')}" placeholder="_id">
        <input class="sfi" style="font-size:11px" id="olbl-${fi}-${oi}" value="${escapeHtml(o.label||'')}" placeholder="Label">
        <input class="sfi" style="font-size:11px;font-family:var(--font-mono)" id="oval-${fi}-${oi}" value="${escapeHtml(o.value||'')}" placeholder="value">
        <input class="sfi" style="font-size:11px;text-align:center" id="ork-${fi}-${oi}" type="number" min="1" value="${o.rank||oi+1}">
        ${isIcon ? `<input class="sfi" style="font-size:11px" id="oicu-${fi}-${oi}" value="${escapeHtml(o.icon_url||'')}" placeholder="https://...">` : ''}
        <div style="display:flex;justify-content:center"><input type="checkbox" id="odef-${fi}-${oi}" style="accent-color:var(--accent);width:14px;height:14px" ${o.selected_by_default?'checked':''}></div>
        <button onclick="sduiRemoveOpt(${fi},${oi})" class="btn btn-danger btn-sm" style="padding:4px 6px;font-size:11px">✕</button>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:10px;color:var(--text-muted);white-space:nowrap;flex-shrink:0">Platforms:</span>
        ${sduiPlatformChipsHtml(pfx, curPlat, allowed)}
      </div>
    </div>`;
}

// ─── Platform chips ───────────────────────────────────────
// allowed: optional array — restricts which platform chips are rendered (for option-level chips)
function sduiPlatformChipsHtml(pfx, cur, allowed) {
  const platforms = (Array.isArray(allowed) && allowed.length) ? allowed : SDUI_PLATFORMS;
  const isAll  = (cur === 'all' || !Array.isArray(cur));
  const arr    = isAll ? [] : cur;
  const allCls = isAll ? 'sel' : 'unsel';
  const chips  = platforms.map(pl => {
    const cls = (!isAll && arr.includes(pl)) ? 'sel' : 'unsel';
    return `<span class="sdui-chip ${cls}" data-p="${pl}" onclick="sduiToggleChip('${pfx}','${pl}')">${pl}</span>`;
  }).join('');
  return `<div class="sdui-chips" id="${pfx}-pchips">
    <span class="sdui-chip ${allCls}" data-p="all" onclick="sduiToggleChip('${pfx}','all')">✓ All</span>
    ${chips}
  </div>`;
}

function sduiToggleChip(pfx, val) {
  const cont = document.getElementById(`${pfx}-pchips`);
  if (!cont) return;
  const chips = cont.querySelectorAll('[data-p]');
  if (val === 'all') {
    chips.forEach(c => { c.classList.toggle('sel', c.dataset.p === 'all'); c.classList.toggle('unsel', c.dataset.p !== 'all'); });
  } else {
    const allChip = cont.querySelector('[data-p="all"]');
    if (allChip) { allChip.classList.remove('sel'); allChip.classList.add('unsel'); }
    const el = cont.querySelector(`[data-p="${val}"]`);
    if (el) { el.classList.toggle('sel'); el.classList.toggle('unsel'); }
  }
}

function sduiReadChips(pfx) {
  const cont = document.getElementById(`${pfx}-pchips`);
  if (!cont) return 'all';
  const allChip = cont.querySelector('[data-p="all"]');
  if (allChip && allChip.classList.contains('sel')) return 'all';
  const sel = [];
  cont.querySelectorAll('[data-p]').forEach(c => { if (c.dataset.p !== 'all' && c.classList.contains('sel')) sel.push(c.dataset.p); });
  return sel.length ? sel : 'all';
}

// ─── JSON tab (editable) ──────────────────────────────────
function sduiRenderJsonTab() {
  const isEditor = currentRole === 'editor';
  const json = JSON.stringify(sduiEditDoc, null, 2);
  if (!isEditor) {
    return `<div class="sdui-json-view">${escapeHtml(json)}</div>`;
  }
  return `
    <div>
      <textarea id="sdui-json-editor" class="sdui-json-view" style="width:100%;resize:vertical;outline:none;cursor:text;min-height:400px;max-height:600px" spellcheck="false">${escapeHtml(json)}</textarea>
      <div id="sdui-json-err" style="display:none;color:#f87171;font-size:11px;margin-top:6px;padding:4px 8px;background:rgba(239,68,68,.1);border-radius:4px"></div>
      <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:10px">
        <button class="btn btn-ghost btn-sm" onclick="sduiResetJson()">Reset</button>
        <button class="btn btn-primary btn-sm" onclick="sduiApplyJson()">Apply JSON →</button>
      </div>
    </div>`;
}

function sduiApplyJson() {
  const el = document.getElementById('sdui-json-editor');
  const errEl = document.getElementById('sdui-json-err');
  if (!el) return;
  try {
    const parsed = JSON.parse(el.value);
    parsed._id = sduiEditDoc._id;
    parsed.config_type = sduiEditDoc.config_type;
    sduiEditDoc = parsed;
    errEl.style.display = 'none';
    showToast('JSON applied — switch tabs to see reflected values', 'success');
  } catch (e) {
    errEl.textContent = 'Invalid JSON: ' + e.message;
    errEl.style.display = 'block';
  }
}

function sduiResetJson() {
  const el = document.getElementById('sdui-json-editor');
  const errEl = document.getElementById('sdui-json-err');
  if (!el) return;
  el.value = JSON.stringify(sduiEditDoc, null, 2);
  errEl.style.display = 'none';
  showToast('JSON reset to current state', 'info');
}

// ─── Add / remove / retype filters ───────────────────────
function sduiAddFilter() {
  if (currentRole !== 'editor') return;
  if (!sduiEditDoc.filters) sduiEditDoc.filters = [];
  // Collect current form state first so we don't lose edits
  const cur = sduiCollectDoc();
  sduiEditDoc.filters = cur.filters || sduiEditDoc.filters;
  const newFi = sduiEditDoc.filters.length;
  sduiEditDoc.filters.push({
    _id: '', group_id: sduiEditDoc._id, label: '', type: 'checkbox',
    rank: newFi + 1, query_param: '', multi_select: false,
    visible: true, platform_applicability: 'all', options: [],
  });
  const openSet = (sduiEditDoc.filters || []).map((_, i) => i < newFi ? i : -1).filter(i => i >= 0);
  document.getElementById('sdui-modal-body').innerHTML = sduiRenderFiltersTab();
  openSet.forEach(i => sduiToggleAcc(i));
  // Auto-open new filter accordion
  sduiToggleAcc(newFi);
}

function sduiRemoveFilter(fi) {
  if (!confirm('Remove this filter and all its options?')) return;
  const cur = sduiCollectDoc();
  sduiEditDoc.filters = cur.filters || sduiEditDoc.filters;
  sduiEditDoc.filters.splice(fi, 1);
  sduiReRenderFilters();
}

function sduiChangeFilterType(fi, type) {
  // Collect current form before re-render so values aren't lost
  const cur = sduiCollectDoc();
  sduiEditDoc.filters = cur.filters || sduiEditDoc.filters;
  sduiEditDoc.filters[fi].type = type;
  if (!SDUI_TYPES_WITH_OPTS.includes(type)) {
    sduiEditDoc.filters[fi].options = [];
  }
  const openSet = (sduiEditDoc.filters || []).map((_, i) => i).filter(i => {
    const b = document.getElementById(`fbody-${i}`);
    return b && b.classList.contains('open');
  });
  document.getElementById('sdui-modal-body').innerHTML = sduiRenderFiltersTab();
  openSet.forEach(i => sduiToggleAcc(i));
  // Keep this filter open
  if (!openSet.includes(fi)) sduiToggleAcc(fi);
}

// ─── Add / remove options ─────────────────────────────────
function sduiAddOption(fi) {
  const f = sduiEditDoc.filters[fi];
  if (!f.options) f.options = [];
  f.options.push({ _id: '', filter_id: f._id, label: '', value: '', rank: f.options.length + 1, selected_by_default: false, platform_applicability: 'all' });
  sduiReRenderFilters();
}

function sduiRemoveOpt(fi, oi) {
  sduiEditDoc.filters[fi].options.splice(oi, 1);
  sduiReRenderFilters();
}

function sduiReRenderFilters() {
  const openSet = [];
  (sduiEditDoc.filters || []).forEach((_, i) => {
    const b = document.getElementById(`fbody-${i}`);
    if (b && b.classList.contains('open')) openSet.push(i);
  });
  document.getElementById('sdui-modal-body').innerHTML = sduiRenderFiltersTab();
  openSet.forEach(i => sduiToggleAcc(i));
}

// ─── Toggle accordion ─────────────────────────────────────
function sduiToggleAcc(fi) {
  const body  = document.getElementById(`fbody-${fi}`);
  const arrow = document.getElementById(`farrow-${fi}`);
  if (!body) return;
  body.classList.toggle('open');
  if (arrow) arrow.classList.toggle('open', body.classList.contains('open'));
}

// ─── Modal body click delegation ─────────────────────────
// NOTE: accordion (.sacc-hdr) is handled by inline onclick — do NOT also
// handle it here or it will double-toggle and appear broken.
function sduiModalBodyClick(_e) {
  // reserved for future delegation needs
}

// ─── Version History ──────────────────────────────────────
async function openSduiHistory(id) {
  const modal = document.getElementById('sdui-history-modal');
  const body  = document.getElementById('sdui-history-body');
  const sub   = document.getElementById('sdui-history-subtitle');
  sub.textContent = id;
  body.innerHTML  = '<p class="muted">Loading…</p>';
  modal.classList.remove('hidden');

  try {
    const res   = await fetch(`${API}/sdui/docs/${encodeURIComponent(id)}/snapshots`, {
      credentials: 'include'
    });
    const json  = await res.json();
    const snaps = json.data || [];

    if (!snaps.length) {
      body.innerHTML = '<p class="muted">No snapshots yet. Snapshots are created automatically before each save or delete.</p>';
      return;
    }

    const isEditor = currentRole === 'editor';
    body.innerHTML = snaps.map(s => {
      const sid   = escapeHtml(String(s._id));
      const oid   = escapeHtml(String(s.originalId));
      const saved = new Date(s.savedAt).toLocaleString();
      const title = escapeHtml(s.snapshot?.title || s.snapshot?.name || oid);
      return `
        <div style="display:flex;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:12px;font-weight:600;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</div>
            <div style="font-size:10px;color:var(--text-muted);margin-top:2px">${saved}</div>
          </div>
          ${isEditor ? `<button class="btn btn-ghost btn-sm" style="flex-shrink:0" onclick="sduiRestoreSnap('${sid}','${oid}')">↩ Restore</button>` : '<span style="font-size:10px;color:var(--text-muted)">read-only</span>'}
        </div>`;
    }).join('');
  } catch (err) {
    body.innerHTML = `<p class="muted">Failed to load history: ${escapeHtml(err.message)}</p>`;
  }
}

async function sduiRestoreSnap(snapshotId, originalId) {
  if (!confirm('Restore this snapshot? The current document state will be saved as a new snapshot first.')) return;
  try {
    const res = await fetch(`${API}/sdui/docs/${encodeURIComponent(originalId)}/restore/${encodeURIComponent(snapshotId)}`, {
      method: 'POST',
      credentials: 'include'
    });
    if (!res.ok) throw new Error((await res.json()).message || 'Failed');
    const { data } = await res.json();
    const idx = sduiDocs.findIndex(d => String(d._id) === originalId);
    if (idx !== -1) sduiDocs[idx] = data; else sduiDocs.push(data);
    renderSduiDocs();
    document.getElementById('sdui-history-modal').classList.add('hidden');
    showToast('Document restored from snapshot', 'success');
  } catch (err) {
    showToast(`Restore failed: ${err.message}`, 'error');
  }
}

// ─── Collect form data ────────────────────────────────────
function sduiCollectDoc() {
  const d = sduiDeep(sduiEditDoc);
  const g = id => document.getElementById(id);

  if (g('e-title'))    d.title               = g('e-title').value.trim().toUpperCase();
  if (g('e-rank'))     d.rank                = parseInt(g('e-rank').value) || 1;
  if (g('e-dmode'))    d.display_mode        = g('e-dmode').value;
  if (g('e-visible'))  d.visible             = g('e-visible').checked;
  if (g('e-collapsed'))d.collapsed_by_default= g('e-collapsed').checked;
  if (g('e-flag'))     d.flag                = g('e-flag').checked;
  if (g('e-meta'))     d.meta                = g('e-meta').value.trim();
  if (g('e-itype'))    d.icon                = { type: g('e-itype').value, value: g('e-ivalue') ? (g('e-ivalue').value.trim() || null) : null };

  d.filters = (d.filters || []).map((f, fi) => {
    const p  = `fi${fi}`;
    if (g(`${p}-fid`))   f._id         = g(`${p}-fid`).value.trim();
    if (g(`${p}-ftype`)) f.type        = g(`${p}-ftype`).value;
    if (g(`${p}-label`)) f.label       = g(`${p}-label`).value.trim();
    if (g(`${p}-rank`))  f.rank        = parseInt(g(`${p}-rank`).value) || f.rank;
    if (g(`${p}-qp`))    f.query_param = g(`${p}-qp`).value.trim();
    if (g(`${p}-vis`))   f.visible     = g(`${p}-vis`).checked;
    if (g(`${p}-ms`))    f.multi_select= g(`${p}-ms`).checked;
    f.platform_applicability = sduiReadChips(p);

    if (f.type === 'range_slider') {
      if (g(`${p}-min`))   f.min          = parseFloat(g(`${p}-min`).value);
      if (g(`${p}-max`))   f.max          = parseFloat(g(`${p}-max`).value);
      if (g(`${p}-step`))  f.step         = parseFloat(g(`${p}-step`).value);
      if (g(`${p}-dmin`))  f.default_min  = parseFloat(g(`${p}-dmin`).value);
      if (g(`${p}-dmax`))  f.default_max  = parseFloat(g(`${p}-dmax`).value);
      if (g(`${p}-unit`))  f.unit         = g(`${p}-unit`).value.trim() || undefined;
      if (g(`${p}-scale`)) f.slider_scale = g(`${p}-scale`).value;
      if (g(`${p}-pin`))   f.pin_mode     = g(`${p}-pin`).value;
      if (g(`${p}-loose`)) f.loose_ends   = g(`${p}-loose`).value;
    }
    if (SDUI_INPUT_TYPES.includes(f.type)) {
      if (g(`${p}-ph`))   f.placeholder = g(`${p}-ph`).value.trim();
      if (g(`${p}-db`))   f.debounce_ms = parseInt(g(`${p}-db`).value) || 300;
      if (g(`${p}-minl`)) f.min_length  = parseInt(g(`${p}-minl`).value) || 2;
      if (g(`${p}-maxl`)) f.max_length  = parseInt(g(`${p}-maxl`).value) || 120;
    }
    if (f.type === 'date_range_custom') {
      if (g(`${p}-mf`))  f.min_field   = g(`${p}-mf`).value.trim();
      if (g(`${p}-xf`))  f.max_field   = g(`${p}-xf`).value.trim();
      if (g(`${p}-fmt`)) f.format      = g(`${p}-fmt`).value.trim();
      if (g(`${p}-dm`))  f.default_mode= g(`${p}-dm`).value.trim();
    }
    if (f.options) {
      const isIcon = (f.type === 'icon_toggle');
      f.options = f.options.map((o, oi) => {
        if (g(`oid-${fi}-${oi}`))  o._id              = g(`oid-${fi}-${oi}`).value.trim();
        if (g(`olbl-${fi}-${oi}`)) o.label            = g(`olbl-${fi}-${oi}`).value.trim();
        if (g(`oval-${fi}-${oi}`)) o.value            = g(`oval-${fi}-${oi}`).value.trim();
        if (g(`ork-${fi}-${oi}`))  o.rank             = parseInt(g(`ork-${fi}-${oi}`).value) || oi + 1;
        if (g(`odef-${fi}-${oi}`)) o.selected_by_default = g(`odef-${fi}-${oi}`).checked;
        if (isIcon && g(`oicu-${fi}-${oi}`)) o.icon_url = g(`oicu-${fi}-${oi}`).value.trim() || undefined;
        o.platform_applicability = sduiReadChips(`opt${fi}-${oi}`);
        return o;
      });
    }
    return f;
  });
  return d;
}

// ─── Validation ───────────────────────────────────────────
function sduiValidate(d) {
  const errs = {};
  if (!d.title || !d.title.trim())                             errs['title'] = 'Title is required';
  else if (!/^[A-Z][A-Z0-9\s&\/\-\.]*$/.test(d.title))       errs['title'] = 'Must be CAPS (e.g. CATEGORY, SORT BY)';
  if (!sduiIsPosInt(d.rank))                                   errs['rank']  = 'Rank must be ≥ 1';
  if (!d.display_mode)                                         errs['dmode'] = 'Display mode is required';
  if (!d.meta || !d.meta.trim())                               errs['meta']  = 'Meta description is required';
  if (d.icon && d.icon.type !== 'none' && !d.icon.value)      errs['ivalue']= 'Icon value is required';

  (d.filters || []).forEach((f, fi) => {
    const p = `fi${fi}`;
    if (!f._id || !sduiIsSnake(f._id))                         errs[`${p}-fid`]   = 'Filter _id must be snake_case (e.g. ad_type)';
    if (!f.label || !f.label.trim())                           errs[`${p}-label`] = 'Label is required';
    if (!sduiIsPosInt(f.rank))                                 errs[`${p}-rank`]  = 'Rank must be ≥ 1';
    if (!f.query_param || !sduiIsCamel(f.query_param))         errs[`${p}-qp`]    = 'Must be camelCase (e.g. sortBy)';
    const pa = f.platform_applicability;
    if (pa !== 'all' && (!Array.isArray(pa) || !pa.length))   errs[`${p}-pa`]    = 'Select at least one platform or "All"';

    if (f.type === 'range_slider') {
      if (f.min === undefined && f.min !== 0)                  errs[`${p}-min`]   = 'Min is required';
      if (f.max === undefined && f.max !== 0)                  errs[`${p}-max`]   = 'Max is required';
      if (!f.step || f.step <= 0)                              errs[`${p}-step`]  = 'Step must be > 0';
      if (f.min !== undefined && f.max !== undefined && parseFloat(f.min) >= parseFloat(f.max)) errs[`${p}-max`] = 'Max must be > min';
    }
    if (SDUI_INPUT_TYPES.includes(f.type) && !f.placeholder)  errs[`${p}-ph`]    = 'Placeholder is required';
    if (f.type === 'date_range_custom') {
      if (!f.min_field) errs[`${p}-mf`] = 'Min field is required';
      if (!f.max_field) errs[`${p}-xf`] = 'Max field is required';
    }
    (f.options || []).forEach((o, oi) => {
      if (!o._id || !sduiIsSnake(o._id))   errs[`oid-${fi}-${oi}`]  = 'Must be snake_case';
      if (!o.label || !o.label.trim())      errs[`olbl-${fi}-${oi}`] = 'Label required';
      if (!o.value || !o.value.trim())      errs[`oval-${fi}-${oi}`] = 'Value required';
      if (!sduiIsPosInt(o.rank))            errs[`ork-${fi}-${oi}`]  = 'Rank ≥ 1';
    });
  });
  return errs;
}

function sduiApplyErrors(errs) {
  document.querySelectorAll('.sfi.err').forEach(el => el.classList.remove('err'));
  document.querySelectorAll('.sfe.show').forEach(el => { el.textContent = ''; el.classList.remove('show'); });
  const keys = Object.keys(errs);
  if (!keys.length) { document.getElementById('sdui-modal-err-summary').classList.add('hidden'); return false; }
  keys.forEach(k => {
    const input = document.getElementById(k) || document.getElementById(`e-${k}`);
    if (input) input.classList.add('err');
    const errEl = document.getElementById(`${k}-err`) || document.getElementById(`e-${k}-err`);
    if (errEl) { errEl.textContent = errs[k]; errEl.classList.add('show'); }
  });
  document.getElementById('sdui-modal-err-summary').classList.remove('hidden');
  return true;
}

// ─── Review & Submit flow ─────────────────────────────────
function sduiOpenReview() {
  const doc  = sduiCollectDoc();
  const errs = sduiValidate(doc);
  if (sduiApplyErrors(errs)) return;
  sduiPendingSave = doc;
  const changes = sduiDiff(sduiEditOrig, doc);
  document.getElementById('sdui-review-body').innerHTML = sduiRenderReview(doc, changes);
  document.getElementById('sdui-review-modal').classList.remove('hidden');
}

async function sduiDoSave() {
  const doc = sduiPendingSave;
  if (!doc) return;
  const btn = document.getElementById('sdui-review-confirm');
  btn.disabled = true; btn.textContent = '⏳ Saving...';
  try {
    const res = await fetch(`${API}/sdui/docs/${encodeURIComponent(String(doc._id))}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
      credentials: 'include'
    });
    const data = await res.json();
    if (res.ok) {
      const idx = sduiDocs.findIndex(d => String(d._id) === String(doc._id));
      if (idx !== -1) sduiDocs[idx] = doc; else sduiDocs.push(doc);
      renderSduiDocs();
      document.getElementById('sdui-review-modal').classList.add('hidden');
      closeSduiModal();
      showToast('Document saved successfully', 'success');
    } else {
      showToast(`Save failed: ${data.message}`, 'error');
    }
  } catch (err) {
    showToast(`Save failed: ${err.message}`, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✓ Confirm & Save';
    sduiPendingSave = null;
  }
}

// ─── Create Document flow ────────────────────────────────
function openSduiCreate() {
  if (currentRole !== 'editor') return;
  // Reset form fields
  ['sdui-create-id','sdui-create-title','sdui-create-rank','sdui-create-meta','sdui-create-ivalue'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const rankEl = document.getElementById('sdui-create-rank');
  if (rankEl) rankEl.value = '1';
  const visEl = document.getElementById('sdui-create-visible');
  if (visEl) visEl.checked = true;
  const flagEl = document.getElementById('sdui-create-flag');
  if (flagEl) flagEl.checked = true;
  const collEl = document.getElementById('sdui-create-collapsed');
  if (collEl) collEl.checked = false;
  const itypeEl = document.getElementById('sdui-create-itype');
  if (itypeEl) { itypeEl.value = 'none'; document.getElementById('sdui-create-ivalue-wrap').style.display = 'none'; }
  document.getElementById('sdui-create-err').textContent = '';
  document.getElementById('sdui-create-modal').classList.remove('hidden');
  document.getElementById('sdui-create-id').focus();
}

async function sduiDoCreate() {
  const g = id => document.getElementById(id);
  const errEl = g('sdui-create-err');
  errEl.textContent = '';

  const _id          = (g('sdui-create-id').value || '').trim();
  const config_type  = g('sdui-create-type').value;
  const title        = (g('sdui-create-title').value || '').trim().toUpperCase();
  const rank         = parseInt(g('sdui-create-rank').value) || 1;
  const display_mode = g('sdui-create-dmode').value;
  const visible      = g('sdui-create-visible').checked;
  const flag         = g('sdui-create-flag').checked;
  const collapsed_by_default = g('sdui-create-collapsed').checked;
  const meta         = (g('sdui-create-meta').value || '').trim();
  const iconType     = g('sdui-create-itype').value;
  const iconValue    = (g('sdui-create-ivalue').value || '').trim();

  // Validate
  if (!_id)           { errEl.textContent = '_id is required'; return; }
  if (!/^[a-z0-9_-]+$/.test(_id)) { errEl.textContent = '_id must be lowercase alphanumeric, underscores, or hyphens'; return; }
  if (!title)         { errEl.textContent = 'Title is required'; return; }
  if (!meta)          { errEl.textContent = 'Meta description is required'; return; }
  if (iconType !== 'none' && !iconValue) { errEl.textContent = 'Icon value is required when icon type is set'; return; }

  const doc = {
    _id, config_type, title, rank, display_mode,
    visible, flag, collapsed_by_default, meta,
    icon: { type: iconType, value: iconType !== 'none' ? iconValue : null },
    filters: [],
    created_at: new Date().toISOString(),
  };

  const btn = g('sdui-create-confirm');
  btn.disabled = true; btn.textContent = '⏳ Creating...';
  try {
    const res = await fetch(`${API}/sdui/docs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
      credentials: 'include'
    });
    const json = await res.json();
    if (res.ok) {
      const created = json.data || doc;
      sduiDocs.push(created);
      renderSduiDocs();
      document.getElementById('sdui-create-modal').classList.add('hidden');
      showToast(`Document "${_id}" created — opening editor to add filters`, 'success');
      // Auto-open edit modal so user can add filters immediately
      setTimeout(() => openSduiEdit(String(created._id)), 300);
    } else {
      errEl.textContent = json.message || 'Create failed';
    }
  } catch (err) {
    errEl.textContent = 'Network error: ' + err.message;
  } finally {
    btn.disabled = false; btn.textContent = '✦ Create Document';
  }
}

// ─── Delete flow ──────────────────────────────────────────
function openSduiDelete(id) {
  const doc = sduiDocs.find(d => String(d._id) === id);
  sduiDeleteId = id;
  document.getElementById('sdui-delete-label').textContent = doc ? `${id} (${doc.title || ''})` : id;
  document.getElementById('sdui-delete-modal').classList.remove('hidden');
}

async function sduiDoDelete() {
  if (!sduiDeleteId) return;
  const btn = document.getElementById('sdui-delete-confirm');
  btn.disabled = true; btn.textContent = '⏳ Deleting...';
  try {
    const res = await fetch(`${API}/sdui/docs/${encodeURIComponent(sduiDeleteId)}`, { method: 'DELETE', credentials: 'include' });
    if (res.ok) {
      sduiDocs = sduiDocs.filter(d => String(d._id) !== sduiDeleteId);
      renderSduiDocs();
      document.getElementById('sdui-delete-modal').classList.add('hidden');
      showToast('Document deleted', 'success');
    } else {
      showToast('Delete failed', 'error');
    }
  } catch {
    showToast('Delete failed', 'error');
  } finally {
    btn.disabled = false; btn.textContent = 'Delete';
    sduiDeleteId = null;
  }
}

// ─── Diff helpers ─────────────────────────────────────────
function sduiDiff(orig, cur) {
  if (!orig) return [{ field: '(new)', from: '—', to: JSON.stringify(cur).substring(0, 80) + '…' }];
  const changes = [];
  sduiDiffObj('', orig, cur, changes);
  return changes;
}
function sduiDiffObj(prefix, a, b, out) {
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  keys.forEach(k => {
    const path = prefix ? `${prefix}.${k}` : k;
    const va = a ? a[k] : undefined, vb = b ? b[k] : undefined;
    if (JSON.stringify(va) === JSON.stringify(vb)) return;
    if (typeof va === 'object' && typeof vb === 'object' && va && vb && !Array.isArray(va) && !Array.isArray(vb)) {
      sduiDiffObj(path, va, vb, out);
    } else {
      out.push({ field: path, from: sduiFmtDiff(va), to: sduiFmtDiff(vb) });
    }
  });
}
function sduiFmtDiff(v) {
  if (v === undefined) return '<em style="color:var(--text-muted)">undefined</em>';
  if (v === null)      return '<em style="color:var(--text-muted)">null</em>';
  let s = JSON.stringify(v);
  if (s.length > 100) s = s.substring(0, 100) + '…';
  return `<code class="sdui-diff-code">${escapeHtml(s)}</code>`;
}

function sduiRenderReview(doc, changes) {
  let html = `<div style="margin-bottom:14px">
    <p style="font-size:11px;color:var(--text-muted);margin-bottom:4px">Document</p>
    <p style="font-size:13px;font-weight:600;font-family:var(--font-mono)">${escapeHtml(String(doc._id))} <span style="color:var(--text-muted)">/ ${escapeHtml(doc.config_type)}</span></p>
  </div>`;
  if (!changes.length) {
    return html + `<div style="background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.3);border-radius:8px;padding:16px;text-align:center;font-size:13px;color:#86efac">✓ No changes detected — document is identical to the saved version.</div>`;
  }
  html += `<p style="font-size:11px;color:var(--text-muted);margin-bottom:8px">${changes.length} change${changes.length !== 1 ? 's' : ''} detected:</p>`;
  html += `<table class="sdui-review-tbl"><thead><tr><th>Field</th><th>Before</th><th>After</th></tr></thead><tbody>`;
  html += changes.map(c => `
    <tr>
      <td style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">${escapeHtml(c.field)}</td>
      <td class="sdui-diff-old">${c.from}</td>
      <td class="sdui-diff-new">${c.to}</td>
    </tr>`).join('');
  html += '</tbody></table>';
  return html;
}

// Expose to global for onclick handlers in HTML
window.viewLogFile    = viewLogFile;
window.downloadLog    = downloadLog;
window.blockIpDirect  = blockIpDirect;
window.unblockIp      = unblockIp;
window.restoreConfig  = restoreConfig;
window.sduiToggle     = sduiToggle;
window.openSduiEdit   = openSduiEdit;
window.openSduiDelete = openSduiDelete;
window.sduiToggleChip = sduiToggleChip;
window.sduiToggleAcc  = sduiToggleAcc;
window.sduiAddOption  = sduiAddOption;
window.sduiRemoveOpt  = sduiRemoveOpt;
window.openSduiHistory = openSduiHistory;
window.sduiRestoreSnap = sduiRestoreSnap;
window.openSduiCreate      = openSduiCreate;
window.sduiDoCreate        = sduiDoCreate;
window.sduiApplyJson       = sduiApplyJson;
window.sduiResetJson       = sduiResetJson;
window.sduiAddFilter       = sduiAddFilter;
window.sduiRemoveFilter    = sduiRemoveFilter;
window.sduiChangeFilterType = sduiChangeFilterType;

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN ACCESS TAB — read-only, data from planAccessSeed.js
// ═══════════════════════════════════════════════════════════════════════════════

let pvCurrentDraft = null;
let pvLivePolicy = null;
let pvCatalog = { capabilities: [], networks: [] };

// Plan Control v2 UI. Kept in this existing admin bundle so unrelated admin
// sections and their loading behavior remain untouched.
let pv2FamiliesData = { generations: [], families: [], snapshot: null, source: 'bootstrap_preview', storage: null };
let pv2SelectedFamilyId = null;
let pv2Dirty = false;
let pv2PreviewContext = null;
let pv2ReadOnlyFamily = null;
let pv2ReadOnlyPolicy = null;
const pv2VariantSelection = {};

function pv2Escape(value) { return escapeHtml(String(value ?? '')); }
async function pv2Api(path, options = {}) {
  const write = options.method && options.method !== 'GET';
  const response = await fetch(`${API}/plan-control${path}`, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(write ? { 'x-admin-action': 'plan-control' } : {}),
      ...(options.headers || {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.message || payload.conflict || `Request failed (${response.status})`);
    error.status = response.status; error.payload = payload; throw error;
  }
  return payload;
}

function pv2Snapshot() {
  return pvCurrentDraft?.snapshot || pvLivePolicy?.snapshot || pv2FamiliesData.snapshot || {};
}
function pv2Families() { return pv2Snapshot().planFamilies || pv2FamiliesData.families || []; }
function pv2Generations() { return pv2Snapshot().generations || pv2FamiliesData.generations || []; }
function pv2SetDirty(dirty = true) {
  pv2Dirty = dirty;
  const el = document.getElementById('pv2-dirty');
  if (el) el.textContent = dirty ? 'Unsaved changes' : '';
  if (dirty) {
    const validation = document.getElementById('pv2-validation');
    if (validation?.style.display !== 'none') {
      validation.innerHTML = '<div class="pv2-kicker">Validation result outdated</div><p style="font-size:11px;color:#fde68a;margin-bottom:0">The draft changed after the last validation. Run “Validate & diff” again to see the current result.</p>';
    }
  }
}

async function pvLoadInit() {
  try {
    const [catalog, active, families, drafts, versions] = await Promise.all([
      pv2Api('/catalog'), pv2Api('/versions/active'), pv2Api('/families'), pv2Api('/drafts'), pv2Api('/versions'),
    ]);
    pvCatalog = catalog.data;
    pvLivePolicy = active.data;
    pv2FamiliesData = families.data;
    pv2RenderLive();
    pv2RenderMode();
    pv2RenderSource();
    pv2RenderGenerationSelector();
    pv2RenderDrafts(drafts.data || []);
    pv2RenderHistory(versions.data || []);
    pv2RenderCategoryOptions();
    pvRenderFamilies();
  } catch (error) {
    showToast?.(`Plan Control failed to load: ${error.message}`, 'error');
  }
}

function pv2RenderLive() {
  const el = document.getElementById('pv2-live');
  if (!el) return;
  el.innerHTML = pvLivePolicy
    ? `<span class="pv2-live-badge">LIVE</span> Policy revision ${Number(pvLivePolicy.revision) || 0} · <code>${pv2Escape(pvLivePolicy.versionId)}</code>`
    : '<span class="pv2-not-live-badge">NOT PUBLISHED</span> Viewing legacy access or backend defaults';
}

function pv2RenderMode() {
  const el = document.getElementById('pv2-mode');
  if (!el) return;
  if (currentRole !== 'editor') {
    el.className = 'pv2-mode viewer';
    el.innerHTML = '<b>View-only mode</b><span>Dropdowns are intentionally locked. Unlock editor access before changing any plan.</span><span style="flex:1"></span><button class="btn btn-ghost btn-sm" data-plan-read="true" onclick="pvGoUnlockEditing()">Unlock editing</button>';
    return;
  }
  el.className = 'pv2-mode editor';
  el.innerHTML = pvCurrentDraft
    ? `<b>Editing enabled</b><span>You are changing safe draft <code>${pv2Escape(pvCurrentDraft.draftId)}</code>. Customers are unaffected until Publish.</span>`
    : '<b>Editor unlocked</b><span>Select an existing draft or create a safe draft. Live policy controls remain read-only.</span>';
}

function pv2RenderSource() {
  const el = document.getElementById('pv2-source');
  if (!el) return;
  if (pvCurrentDraft) {
    el.className = 'pv2-source draft';
    const draftMode = currentRole === 'editor' ? 'EDITABLE' : 'READ ONLY — EDITOR LOCKED';
    el.innerHTML = `<b>WORKING DRAFT — ${draftMode}</b><span>MongoDB <code>plan_policy_drafts</code> · record <code>${pv2Escape(pvCurrentDraft.draftId)}</code> · revision ${Number(pvCurrentDraft.draftRevision) || 0}. This is not live; customers are unaffected until Publish.</span><span style="flex:1"></span><button type="button" class="btn btn-ghost btn-sm" data-plan-read="true" onclick="pvExitDraft()">Exit draft & view current access</button>`;
    return;
  }
  if (pvLivePolicy) {
    el.className = 'pv2-source live';
    el.innerHTML = `<b>LIVE PUBLISHED POLICY — READ ONLY</b><span>MongoDB <code>plan_policy_versions</code> · record <code>${pv2Escape(pvLivePolicy.versionId)}</code> · revision ${Number(pvLivePolicy.revision) || 0}. Select a safe working draft to edit.</span>`;
    return;
  }
  if (pv2FamiliesData.source === 'legacy_config_preview') {
    el.className = 'pv2-source legacy';
    el.innerHTML = '<b>CURRENT LEGACY ACCESS — READ ONLY</b><span>Read from MongoDB <code>plan_access_config</code> and converted in memory for this preview. Nothing was migrated, saved, or published. Create a safe working draft to edit these rules.</span>';
    return;
  }
  el.className = 'pv2-source bootstrap';
  el.innerHTML = '<b>BOOTSTRAP PREVIEW — READ ONLY</b><span>Generated from backend plan code defaults; it is not a draft file, not stored in MongoDB, and not a published live policy. Create or select a safe working draft to edit.</span>';
}

function pvGoUnlockEditing() {
  switchTab('config');
  const panel = document.getElementById('unlock-edit-panel');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  document.getElementById('edit-key-input')?.focus();
  showToast?.('Enter the editor hardware key, then return to Plan Validation.', 'success');
}

function pv2RenderGenerationSelector() {
  const select = document.getElementById('pv2-generation');
  if (!select) return;
  const current = select.value;
  select.innerHTML = pv2Generations().map((generation) =>
    `<option value="${pv2Escape(generation.generationId)}">${pv2Escape(generation.adminLabel)} · ${pv2Escape(generation.status)}</option>`
  ).join('');
  if (current && [...select.options].some((option) => option.value === current)) select.value = current;
}

function pvGenerationChanged() {
  pv2SelectedFamilyId = null;
  pvRenderFamilies();
  document.getElementById('pv2-editor').style.display = 'none';
  document.getElementById('pv2-empty').style.display = 'block';
}

function pvRenderFamilies() {
  const container = document.getElementById('pv2-families');
  if (!container) return;
  const generation = document.getElementById('pv2-generation')?.value;
  const query = (document.getElementById('pv2-family-search')?.value || '').trim().toLowerCase();
  const rows = pv2Families().filter((family) => {
    if (generation && family.generation !== generation) return false;
    const haystack = `${family.familyId} ${family.label} ${family.adminLabel} ${(family.variants || []).map((v) => `${v.planId} ${v.billingCycle}`).join(' ')}`.toLowerCase();
    return !query || haystack.includes(query);
  });
  container.innerHTML = rows.length ? rows.map((family) => `
    <button type="button" data-plan-read="true" class="pv2-item pv2-family-button ${family.familyId === pv2SelectedFamilyId ? 'active' : ''}" aria-pressed="${family.familyId === pv2SelectedFamilyId}" onclick="pv2SelectFamily('${pv2Escape(family.familyId)}')">
      <div style="display:flex;justify-content:space-between;gap:8px"><b style="font-size:12px">${pv2Escape(family.adminLabel)}</b><span style="font-size:9px;color:var(--text-muted)">${!pvCurrentDraft && pvLivePolicy ? '<span class="pv2-live-badge">LIVE POLICY</span>' : pv2Escape(family.status)}</span></div>
      <div style="font-size:10px;color:var(--text-muted);margin-top:5px">${(family.variants || []).map((variant) => `${pv2Escape(variant.billingCycle)} #${pv2Escape(variant.planId || 'unmapped')}`).join(' · ') || 'No billing variants'}</div>
      <span class="pv2-family-open">View plan →</span>
    </button>`).join('') : `<div style="font-size:11px;color:var(--text-muted);padding:10px">No matching families.</div>${pvCurrentDraft && generation ? '<button class="btn btn-primary btn-sm" style="width:100%" onclick="pvAddFamily()">+ Add plan family</button>' : ''}`;
}

async function pv2SelectFamily(familyId) {
  pv2SelectedFamilyId = familyId;
  pvRenderFamilies();
  if (!pvCurrentDraft) {
    document.getElementById('pv2-title').textContent = 'Loading plan…';
    try {
      const result = await pv2Api(`/families/${encodeURIComponent(familyId)}`);
      // A direct read makes family viewing independent from draft state and
      // from any stale list snapshot already held by the browser.
      pv2ReadOnlyFamily = result.data?.family || null;
      pv2ReadOnlyPolicy = result.data?.policy || null;
    } catch (error) {
      // The list endpoint already delivered a complete read-only snapshot.
      // Use it as a resilient fallback instead of leaving a clickable family
      // card that appears to do nothing during a transient detail request.
      pv2ReadOnlyFamily = pv2Families().find((item) => item.familyId === familyId) || null;
      pv2ReadOnlyPolicy = pv2FamiliesData.snapshot?.policies?.[familyId] || null;
      if (!pv2ReadOnlyFamily) {
        showToast?.(`Could not open this read-only plan: ${error.message}`, 'error');
        return;
      }
    }
  } else {
    pv2ReadOnlyFamily = null;
    pv2ReadOnlyPolicy = null;
  }
  if (!pvLoadPlanEditor()) {
    showToast?.('This plan family could not be loaded from the selected source. Refresh Plan Validation and try again.', 'error');
    return;
  }
  requestAnimationFrame(() => {
    const title = document.getElementById('pv2-title');
    title?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    title?.classList.add('pv2-selection-flash');
    setTimeout(() => title?.classList.remove('pv2-selection-flash'), 900);
  });
}

function pvLoadPlanEditor() {
  const family = (!pvCurrentDraft && pv2ReadOnlyFamily?.familyId === pv2SelectedFamilyId)
    ? pv2ReadOnlyFamily
    : pv2Families().find((item) => item.familyId === pv2SelectedFamilyId);
  if (!family) return false;
  const editable = Boolean(pvCurrentDraft) && currentRole === 'editor';
  document.getElementById('pv2-empty').style.display = 'none';
  document.getElementById('pv2-editor').style.display = 'flex';
  document.getElementById('pv2-title').innerHTML = `${pv2Escape(family.adminLabel)}${!pvCurrentDraft && pvLivePolicy ? ' <span class="pv2-live-badge">LIVE</span>' : ''}`;
  const sourceLabel = pvCurrentDraft
    ? editable
      ? `Editing working draft ${pvCurrentDraft.draftId} revision ${pvCurrentDraft.draftRevision}`
      : `Viewing working draft ${pvCurrentDraft.draftId} revision ${pvCurrentDraft.draftRevision} (read only)`
    : pvLivePolicy
      ? `Viewing live policy revision ${pvLivePolicy.revision} (read only)`
      : pv2FamiliesData.source === 'legacy_config_preview'
        ? 'Viewing current legacy MongoDB access (read only; converted preview)'
        : 'Viewing backend bootstrap defaults (read only; not stored)';
  document.getElementById('pv2-subtitle').textContent = `${family.familyId} · ${family.generation} · ${sourceLabel}`;
  const variants = family.variants || [];
  const familyPolicy = pv2FamilyPolicy();
  const selectedVariant = pv2VariantSelection[family.familyId] || '__family__';
  const overriddenVariantCount = variants.filter((variant) => (
    Boolean(familyPolicy.variantOverrides?.[String(variant.planId)])
  )).length;
  const salesSource = pvCurrentDraft
    ? `Stored in working draft ${pvCurrentDraft.draftId}.`
    : pvLivePolicy
      ? `Stored in live policy revision ${pvLivePolicy.revision}.`
      : pv2FamiliesData.source === 'legacy_config_preview'
        ? family.openForNewSignupsKnown === false
          ? 'Not explicitly set in legacy plan_groups; Closed is the safe default.'
          : `Read from plan_access_config → plan_groups → ${family.adminLabel} → openForNewSignups.`
        : 'Defined by the backend plan-family default.';
  document.getElementById('pv2-summary').innerHTML = `
    <div class="pv2-stat"><span class="pv2-kicker">Name customers see <span class="pv2-info" title="The friendly plan name shown in customer-facing screens.">?</span></span><div style="margin-top:6px"><b>${pv2Escape(family.label)}</b></div><div class="pv2-explain">Display name only. Changing it does not change access.</div></div>
    <div class="pv2-stat"><span class="pv2-kicker">Plan display order <span class="pv2-info" title="Previously called Tier Rank. A higher number places a plan higher in comparisons; it does not automatically grant features.">?</span></span><div style="margin-top:6px"><b>${pv2Escape(family.tierRank)}</b></div><div class="pv2-explain">Higher number = higher plan in UI ordering. Feature access is still controlled below.</div></div>
    <div class="pv2-stat"><span class="pv2-kicker">Rule scope / billing option <span class="pv2-info" title="Family default normally controls every billing ID. Select one ID to inspect or edit a billing-specific override.">?</span></span><div style="margin-top:6px"><b>${variants.length} billing option${variants.length === 1 ? '' : 's'}</b></div><select id="pv2-variant" class="pv2-input" title="Choose family defaults or a specific billing ID" style="width:100%;margin-top:6px" onchange="pv2VariantChanged()"><option value="__family__" ${selectedVariant === '__family__' ? 'selected' : ''}>Family default · normally all billing IDs</option>${variants.map((v) => { const hasOverride = Boolean(familyPolicy.variantOverrides?.[String(v.planId)]); return `<option value="${pv2Escape(v.planId)}" ${String(selectedVariant) === String(v.planId) ? 'selected' : ''}>${pv2Escape(v.billingCycle)} #${pv2Escape(v.planId)}${hasOverride ? ' · HAS OVERRIDE' : ' · follows family'}</option>`; }).join('')}</select><div id="pv2-variant-note" class="pv2-explain"></div>${overriddenVariantCount ? `<div class="pv2-source-note"><b>${overriddenVariantCount} billing ID${overriddenVariantCount === 1 ? '' : 's'} currently override family defaults.</b>${editable ? ` <button type="button" class="btn btn-ghost btn-sm" style="margin-top:7px" onclick="pv2MakeAllVariantsFollowFamily()">Make all ${variants.length} IDs follow family</button>` : ''}</div>` : '<div class="pv2-source-note"><b>All billing IDs follow this family.</b></div>'}</div>
    <div class="pv2-stat"><span class="pv2-kicker">Available for new purchases <span class="pv2-info" title="Open means billing may sell this family to new customers. Closed keeps existing customers but prevents new signups.">?</span></span><div style="margin-top:6px"><b style="color:${family.openForNewSignups ? '#22c55e' : '#f59e0b'}">${family.openForNewSignups ? 'Yes, open' : 'No, closed'}</b></div><div class="pv2-explain">${family.openForNewSignups ? 'New customers may buy this plan.' : 'Existing plan IDs remain valid, but new sales are closed.'}</div><div class="pv2-source-note"><b>How this is known:</b> ${pv2Escape(salesSource)}</div>${editable ? '<button class="btn btn-ghost btn-sm" style="margin-top:8px" onclick="pvEditFamily()">Edit plan details</button>' : ''}</div>`;
  pv2RenderNetworks();
  pvRenderCapabilities();
  pv2RenderVariantNote();
  return true;
}

function pv2FamilyPolicy() {
  if (!pvCurrentDraft && pv2ReadOnlyFamily?.familyId === pv2SelectedFamilyId && pv2ReadOnlyPolicy) {
    return pv2ReadOnlyPolicy;
  }
  const snapshot = pv2Snapshot();
  const existing = snapshot.policies?.[pv2SelectedFamilyId];
  if (existing) return existing;
  if (pvCurrentDraft) {
    pvCurrentDraft.snapshot.policies ||= {};
    pvCurrentDraft.snapshot.policies[pv2SelectedFamilyId] = { generalNetworks: [], capabilities: {}, variantOverrides: {} };
    return pvCurrentDraft.snapshot.policies[pv2SelectedFamilyId];
  }
  return { generalNetworks: [], capabilities: {}, variantOverrides: {} };
}

function pv2SelectedVariantKey() {
  const value = document.getElementById('pv2-variant')?.value
    || pv2VariantSelection[pv2SelectedFamilyId]
    || '__family__';
  return value === '__family__' ? null : String(value);
}

function pv2VariantChanged() {
  const value = document.getElementById('pv2-variant')?.value || '__family__';
  pv2VariantSelection[pv2SelectedFamilyId] = value;
  pv2RenderVariantNote();
  pv2RenderNetworks();
  pvRenderCapabilities();
}

function pv2RenderVariantNote() {
  const note = document.getElementById('pv2-variant-note');
  if (!note) return;
  const variantKey = pv2SelectedVariantKey();
  if (!variantKey) {
    note.innerHTML = '<b>Editing family defaults.</b> Billing IDs without an override inherit these rules.';
    return;
  }
  const override = pv2FamilyPolicy().variantOverrides?.[variantKey];
  note.innerHTML = override
    ? `<b style="color:#f59e0b">Billing override active for plan #${pv2Escape(variantKey)}.</b> Its hidden overrides take priority over the family defaults below.`
    : `<b>Plan #${pv2Escape(variantKey)} follows family defaults.</b> Changing a control while this option is selected creates an explicit billing override.`;
}

function pv2MakeAllVariantsFollowFamily() {
  if (!pvCurrentDraft || currentRole !== 'editor') {
    showToast?.('Open a safe working draft before changing billing overrides.', 'error');
    return;
  }
  const family = pv2Families().find((item) => item.familyId === pv2SelectedFamilyId);
  const policy = pv2FamilyPolicy();
  const overrideCount = Object.keys(policy.variantOverrides || {}).length;
  if (!overrideCount) return;
  pv2ConfirmAction({
    title: `Apply ${family?.label || 'family'} defaults to every billing ID`,
    message: `This clears all billing-specific feature, network and limit overrides for ${overrideCount} billing IDs in this draft. Every existing and future billing ID in this family will then use the family defaults. Live customers do not change until you Save, Validate and Publish.`,
    confirmLabel: 'Make every ID follow family',
    onConfirm: () => {
      policy.variantOverrides = {};
      pv2VariantSelection[pv2SelectedFamilyId] = '__family__';
      pv2SetDirty();
      pvLoadPlanEditor();
      showToast?.(`All ${family?.variants?.length || 0} billing IDs now follow ${family?.label || 'the family'} in this draft.`, 'success');
    },
  });
}

function pv2RenderNetworks() {
  const policy = pv2FamilyPolicy();
  const editable = Boolean(pvCurrentDraft) && currentRole === 'editor';
  const variantKey = pv2SelectedVariantKey();
  const variantPolicy = variantKey ? policy.variantOverrides?.[variantKey] : null;
  const networkOverrideActive = variantKey && Array.isArray(variantPolicy?.generalNetworks);
  const allowed = new Set(networkOverrideActive ? variantPolicy.generalNetworks : (policy.generalNetworks || []));
  const allowedLabels = (pvCatalog.networks || [])
    .filter((network) => allowed.has(network.id))
    .map((network) => network.label || network.id);
  const summary = document.getElementById('pv2-network-summary');
  if (summary) {
    const currentPolicy = pvLivePolicy?.snapshot?.policies?.[pv2SelectedFamilyId]
      || pv2FamiliesData.snapshot?.policies?.[pv2SelectedFamilyId];
    const currentAllowed = currentPolicy?.generalNetworks || [];
    const canCopyCurrent = editable && !variantKey && allowedLabels.length === 0 && currentAllowed.length > 0;
    summary.className = `pv2-network-summary ${allowedLabels.length ? 'has-access' : 'no-access'}`;
    summary.innerHTML = allowedLabels.length
      ? `<b>${allowedLabels.length} ${variantKey ? `network${allowedLabels.length === 1 ? '' : 's'} effective for billing #${pv2Escape(variantKey)}` : `general network${allowedLabels.length === 1 ? '' : 's'} allowed`}:</b> ${allowedLabels.map(pv2Escape).join(', ')}${networkOverrideActive && editable ? ` <button type="button" class="btn btn-ghost btn-sm" onclick="pv2ResetVariantNetworks()">Remove billing network override</button>` : ''}`
      : `<b>No general networks allowed in this ${pvCurrentDraft ? 'draft' : 'plan'}.</b> Network-aware features using the family default will be unavailable.${canCopyCurrent ? ` <button type="button" class="btn btn-ghost btn-sm" onclick="pv2CopyCurrentNetworks()">Copy ${currentAllowed.length} current network${currentAllowed.length === 1 ? '' : 's'} into this draft</button>` : ''}`;
  }
  document.getElementById('pv2-networks').innerHTML = (pvCatalog.networks || []).map((network) => {
    const checked = allowed.has(network.id);
    return `<label class="pv2-network"><input type="checkbox" ${checked ? 'checked' : ''} ${editable ? '' : 'disabled'} onchange="pv2ToggleNetwork('${pv2Escape(network.id)}',this.checked)">${pv2Escape(network.label)}</label>`;
  }).join('');
}
function pv2CopyCurrentNetworks() {
  if (!pvCurrentDraft || currentRole !== 'editor') return;
  const sourcePolicy = pvLivePolicy?.snapshot?.policies?.[pv2SelectedFamilyId]
    || pv2FamiliesData.snapshot?.policies?.[pv2SelectedFamilyId];
  if (!sourcePolicy?.generalNetworks?.length) {
    showToast?.('No current network access is available to copy.', 'error');
    return;
  }
  pv2FamilyPolicy().generalNetworks = [...sourcePolicy.generalNetworks];
  pv2SetDirty();
  pv2RenderNetworks();
  pvRenderCapabilities();
  showToast?.('Current network access copied into this browser draft. Save draft when ready.', 'success');
}
function pv2ToggleNetwork(networkId, checked) {
  const policy = pv2FamilyPolicy();
  const variantKey = pv2SelectedVariantKey();
  let target = policy;
  if (variantKey) {
    policy.variantOverrides ||= {};
    target = (policy.variantOverrides[variantKey] ||= { capabilities: {} });
    target.generalNetworks ||= [...(policy.generalNetworks || [])];
  }
  const set = new Set(target.generalNetworks || []);
  if (checked) set.add(networkId); else set.delete(networkId);
  target.generalNetworks = [...set];
  pv2SetDirty(); pv2RenderVariantNote(); pv2RenderNetworks(); pvRenderCapabilities();
}

function pv2ResetVariantNetworks() {
  if (!pvCurrentDraft || currentRole !== 'editor') return;
  const variantKey = pv2SelectedVariantKey();
  const override = variantKey && pv2FamilyPolicy().variantOverrides?.[variantKey];
  if (!override) return;
  delete override.generalNetworks;
  pv2SetDirty(); pv2RenderVariantNote(); pv2RenderNetworks(); pvRenderCapabilities();
}

function pv2RenderCategoryOptions() {
  const select = document.getElementById('pv2-category');
  if (!select) return;
  select.innerHTML = '<option value="">All categories</option>' + (pvCatalog.categories || []).map((category) => `<option>${pv2Escape(category)}</option>`).join('');
}

function pv2Humanize(value) {
  return String(value || '')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function pv2RuleForDisplay(policy, cap) {
  let baseRule = policy.capabilities?.[cap.id];
  if (!baseRule && cap.status === 'needs_review') {
    const family = pv2Families().find((item) => item.familyId === pv2SelectedFamilyId);
    const generation = pv2Generations().find((item) => item.generationId === family?.generation);
    baseRule = {
      effect: generation?.newCapabilityDefault === 'deny' ? 'deny' : 'allow',
      reviewed: false,
      networks: { mode: cap.networkAware ? 'inherit_general' : 'not_applicable' },
      pendingDefault: true,
    };
  }
  baseRule ||= { effect: 'inherit', networks: { mode: cap.networkAware ? 'inherit_general' : 'not_applicable' } };
  const variantKey = pv2SelectedVariantKey();
  const variantRule = variantKey ? policy.variantOverrides?.[variantKey]?.capabilities?.[cap.id] : null;
  if (!variantRule) return baseRule;
  return {
    ...baseRule,
    ...variantRule,
    networks: { ...(baseRule.networks || {}), ...(variantRule.networks || {}) },
    limits: { ...(baseRule.limits || {}), ...(variantRule.limits || {}) },
    variantOverride: true,
  };
}

function pv2RuleForEdit(capId) {
  const policy = pv2FamilyPolicy();
  policy.capabilities ||= {};
  const cap = (pvCatalog.capabilities || []).find((item) => item.id === capId) || {
    id: capId,
    networkAware: false,
  };
  const variantKey = pv2SelectedVariantKey();
  if (!variantKey) {
    return (policy.capabilities[capId] ||= {
      effect: 'inherit',
      networks: { mode: cap.networkAware ? 'inherit_general' : 'not_applicable' },
    });
  }
  policy.variantOverrides ||= {};
  const variantPolicy = (policy.variantOverrides[variantKey] ||= { capabilities: {} });
  variantPolicy.capabilities ||= {};
  if (!variantPolicy.capabilities[capId]) {
    const effective = pv2RuleForDisplay(policy, cap);
    variantPolicy.capabilities[capId] = {
      effect: effective.effect || 'inherit',
      networks: { ...(effective.networks || {}) },
      ...(effective.limits ? { limits: { ...effective.limits } } : {}),
    };
  }
  return variantPolicy.capabilities[capId];
}

function pv2ApplyCapabilityTree(parentId, action) {
  if (!pvCurrentDraft || currentRole !== 'editor') {
    showToast?.('Open a safe working draft before changing a feature group.', 'error');
    return;
  }
  const policy = pv2FamilyPolicy();
  policy.capabilities ||= {};
  const parent = (pvCatalog.capabilities || []).find((cap) => cap.id === parentId);
  const children = (pvCatalog.capabilities || []).filter((cap) => cap.parentCapability === parentId);
  if (!parent || !children.length) return;
  const ensureRule = (cap) => {
    policy.capabilities[cap.id] ||= {
      effect: 'inherit',
      reviewed: cap.status !== 'needs_review',
      networks: { mode: cap.networkAware ? 'inherit_general' : 'not_applicable' },
    };
    return policy.capabilities[cap.id];
  };
  if (action === 'allow_tree') ensureRule(parent).effect = 'allow';
  if (action === 'deny_tree') ensureRule(parent).effect = 'deny';
  for (const child of children) ensureRule(child).effect = 'inherit';
  pv2SetDirty();
  pvRenderCapabilities();
  const message = action === 'allow_tree'
    ? `${parent.label} allowed; ${children.length} children now follow the parent.`
    : action === 'deny_tree'
      ? `${parent.label} restricted; all ${children.length} children are blocked by the parent.`
      : `${children.length} children now follow ${parent.label}; individual child overrides were cleared.`;
  showToast?.(message, 'success');
}

function pvRenderCapabilities() {
  const body = document.getElementById('pv2-capabilities');
  if (!body || !pv2SelectedFamilyId) return;
  const policy = pv2FamilyPolicy();
  const editable = Boolean(pvCurrentDraft) && currentRole === 'editor';
  const query = (document.getElementById('pv2-cap-search')?.value || '').toLowerCase();
  const category = document.getElementById('pv2-category')?.value || '';
  const state = document.getElementById('pv2-filter')?.value || '';
  const caps = (pvCatalog.capabilities || []).filter((cap) => {
    const rule = pv2RuleForDisplay(policy, cap);
    const liveRule = pvLivePolicy?.snapshot?.policies?.[pv2SelectedFamilyId]?.capabilities?.[cap.id];
    if (query && !`${cap.id} ${cap.label} ${cap.description}`.toLowerCase().includes(query)) return false;
    if (category && cap.category !== category) return false;
    if (state === 'needs_review' && cap.status !== 'needs_review') return false;
    if ((state === 'allow' || state === 'deny') && rule.effect !== state) return false;
    if (state === 'changed' && JSON.stringify(rule) === JSON.stringify(liveRule)) return false;
    return true;
  });
  body.innerHTML = caps.map((cap) => {
    const rule = pv2RuleForDisplay(policy, cap);
    const variantKey = pv2SelectedVariantKey();
    const explicitVariantRule = variantKey
      ? policy.variantOverrides?.[variantKey]?.capabilities?.[cap.id]
      : null;
    const capabilityOverrideIds = !variantKey
      ? Object.entries(policy.variantOverrides || {})
        .filter(([, variantPolicy]) => Boolean(variantPolicy?.capabilities?.[cap.id]))
        .map(([planId]) => planId)
      : [];
    const ruleScope = variantKey
      ? explicitVariantRule
        ? `<div class="pv2-variant-rule-badge override">BILLING #${pv2Escape(variantKey)} OVERRIDE</div>`
        : `<div class="pv2-variant-rule-badge inherited">BILLING #${pv2Escape(variantKey)} FOLLOWS FAMILY</div>`
      : '<div class="pv2-variant-rule-badge family">FAMILY DEFAULT RULE</div>';
    const parent = cap.parentCapability
      ? (pvCatalog.capabilities || []).find((item) => item.id === cap.parentCapability)
      : null;
    const children = (pvCatalog.capabilities || []).filter((item) => item.parentCapability === cap.id);
    const relation = parent
      ? `<div class="pv2-child-of">↳ Child of <b>${pv2Escape(parent.label)}</b>${rule.effect === 'inherit' ? ' · automatically follows parent access' : ' · individual override'}</div>`
      : children.length
        ? `<div class="pv2-parent-label">PARENT FEATURE · ${children.length} child${children.length === 1 ? '' : 'ren'}</div>`
        : '<div class="pv2-standalone-label">STANDALONE FEATURE</div>';
    const treeActions = children.length && !variantKey
      ? `<div class="pv2-tree-actions">
          <span>Apply to this feature group:</span>
          <button type="button" class="btn btn-ghost btn-sm" ${editable ? '' : 'disabled'} onclick="pv2ApplyCapabilityTree('${pv2Escape(cap.id)}','allow_tree')">Allow parent + children</button>
          <button type="button" class="btn btn-ghost btn-sm" ${editable ? '' : 'disabled'} onclick="pv2ApplyCapabilityTree('${pv2Escape(cap.id)}','deny_tree')">Restrict whole group</button>
          <button type="button" class="btn btn-ghost btn-sm" ${editable ? '' : 'disabled'} onclick="pv2ApplyCapabilityTree('${pv2Escape(cap.id)}','follow')">Children follow parent</button>
        </div>`
      : children.length
        ? '<div class="pv2-tree-actions"><span>Billing scope selected. Switch to Family default to change the whole parent group.</span></div>'
        : '';
    const accessMeaning = parent
      ? rule.effect === 'inherit'
        ? `Effective access follows ${pv2Escape(parent.label)}.`
        : rule.effect === 'allow'
          ? `Child explicitly allowed, but ${pv2Escape(parent.label)} must also be allowed.`
          : `Child explicitly restricted even if ${pv2Escape(parent.label)} is allowed.`
      : children.length
        ? 'Restricting this parent blocks every child. Inheriting children automatically follow it.'
        : 'This feature has no parent or children.';
    const limits = (cap.limitTypes || []).map((name) => `<label style="display:block;margin:3px 0" title="Maximum allowed usage for ${pv2Escape(cap.label)}"><span style="display:block;font-size:9px;color:var(--text-muted)">${pv2Escape(pv2Humanize(name))}</span><input class="pv2-input" type="number" min="0" style="width:78px;padding:4px" value="${pv2Escape(rule.limits?.[name] ?? '')}" placeholder="No limit" ${editable ? '' : 'disabled'} onchange="pv2SetLimit('${pv2Escape(cap.id)}','${pv2Escape(name)}',this.value)"></label>`).join('') || '<span style="color:var(--text-muted)" title="This feature has no registered usage limit">No limit</span>';
    const review = cap.status === 'needs_review'
      ? `<div style="margin-top:5px;color:${rule.reviewed ? '#22c55e' : '#f59e0b'}">${rule.reviewed ? 'This plan reviewed' : rule.pendingDefault && rule.effect === 'allow' ? 'Temporarily allowed · review needed' : 'Choose a plan decision'}</div>${editable ? `<button class="btn btn-ghost btn-sm" onclick="pv2ReviewCap('${pv2Escape(cap.id)}')">${rule.reviewed ? 'Review across plans' : 'Review decision'}</button>` : ''}`
      : '';
    const accessOptions = variantKey
      ? `<option value="__use_family__" ${explicitVariantRule ? '' : 'selected'}>Use family default</option><option value="allow" ${explicitVariantRule?.effect === 'allow' ? 'selected' : ''}>Override: allow feature</option><option value="deny" ${explicitVariantRule?.effect === 'deny' ? 'selected' : ''}>Override: restrict feature</option>${explicitVariantRule?.effect === 'inherit' ? '<option value="inherit" selected>Existing inherited override</option>' : ''}`
      : `<option value="inherit" ${rule.effect === 'inherit' ? 'selected' : ''}>${parent ? 'Follow parent' : 'Use default'}</option><option value="allow" ${rule.effect === 'allow' ? 'selected' : ''}>Allow feature</option><option value="deny" ${rule.effect === 'deny' ? 'selected' : ''}>Restrict feature</option>`;
    const applyToAllBillingIds = capabilityOverrideIds.length
      ? `<button type="button" class="btn btn-ghost btn-sm" style="margin-top:7px" ${editable ? '' : 'disabled'} onclick="pv2ApplyFeatureToAllVariants('${pv2Escape(cap.id)}')">Apply family rule to all billing IDs</button><div class="pv2-access-meaning">${capabilityOverrideIds.length} billing override${capabilityOverrideIds.length === 1 ? '' : 's'} will be removed.</div>`
      : '';
    return `<tr class="${parent ? 'pv2-child-row' : children.length ? 'pv2-parent-row' : ''}" data-pv-capability="${pv2Escape(cap.id)}"><td>${relation}${ruleScope}<div class="pv2-feature-name"><b>${pv2Escape(cap.label)}</b><div style="font-size:9px;color:var(--text-muted)">${pv2Escape(cap.description)}</div><code style="font-size:8px;color:#64748b">${pv2Escape(cap.id)}</code>${treeActions}</div></td><td><span style="font-size:10px">${cap.status === 'needs_review' ? 'New feature' : pv2Escape(pv2Humanize(cap.status))}</span>${review}</td><td><select class="pv2-input" title="Family default normally controls every billing ID; billing overrides take priority" ${editable ? '' : 'disabled'} onchange="pvUpdateCap('${pv2Escape(cap.id)}','effect',this.value)">${accessOptions}</select><div class="pv2-access-meaning">${variantKey && explicitVariantRule ? `This billing-specific decision overrides the family rule. Effective result: ${rule.effect === 'deny' ? 'Restricted' : 'Allowed'}.` : accessMeaning}</div>${applyToAllBillingIds}</td><td>${cap.networkAware ? `<select class="pv2-input" title="Use general networks or choose a smaller custom list only for this feature" ${editable ? '' : 'disabled'} onchange="pvUpdateCap('${pv2Escape(cap.id)}','networkMode',this.value)"><option value="inherit_general" ${rule.networks?.mode !== 'custom' ? 'selected' : ''}>Use general networks</option><option value="custom" ${rule.networks?.mode === 'custom' ? 'selected' : ''}>Choose custom networks</option></select>${rule.networks?.mode === 'custom' ? `<button class="btn btn-ghost btn-sm" ${editable ? '' : 'disabled'} onclick="pv2EditCapabilityNetworks('${pv2Escape(cap.id)}')">${(rule.networks.allowed || []).length} selected</button>` : ''}` : '<span style="color:var(--text-muted)" title="This feature does not receive network context, so a network rule would never be enforced">Same for every network</span>'}</td><td>${limits}</td><td><button class="btn btn-ghost btn-sm" data-plan-read="true" onclick="pvOpenPreview('${pv2Escape(cap.id)}')">View frontend</button></td></tr>`;
  }).join('');
}

function pv2ApplyFeatureToAllVariants(capId) {
  if (!pvCurrentDraft || currentRole !== 'editor') {
    showToast?.('Open a safe working draft before changing billing overrides.', 'error');
    return;
  }
  const cap = (pvCatalog.capabilities || []).find((item) => item.id === capId);
  const policy = pv2FamilyPolicy();
  const affectedIds = Object.entries(policy.variantOverrides || {})
    .filter(([, variantPolicy]) => Boolean(variantPolicy?.capabilities?.[capId]))
    .map(([planId]) => planId);
  if (!affectedIds.length) return;
  pv2ConfirmAction({
    title: `Apply ${cap?.label || capId} family rule to every billing ID`,
    message: `This removes the ${cap?.label || capId} override from billing IDs ${affectedIds.join(', ')} in this draft. They will follow the family access, networks and limits shown in this row. Live customers do not change until Publish.`,
    confirmLabel: `Apply to all ${affectedIds.length} overridden IDs`,
    onConfirm: () => {
      for (const planId of affectedIds) {
        const variantPolicy = policy.variantOverrides?.[planId];
        if (!variantPolicy?.capabilities) continue;
        delete variantPolicy.capabilities[capId];
        if (!Object.keys(variantPolicy.capabilities).length && !Array.isArray(variantPolicy.generalNetworks)) {
          delete policy.variantOverrides[planId];
        }
      }
      pv2SetDirty();
      pvLoadPlanEditor();
      showToast?.(`${cap?.label || capId} now follows the family rule for every billing ID in this draft.`, 'success');
    },
  });
}

function pvUpdateCap(capId, field, value) {
  if (!pvCurrentDraft) return;
  const policy = pv2FamilyPolicy();
  policy.capabilities ||= {};
  const variantKey = pv2SelectedVariantKey();
  let targetCapabilities = policy.capabilities;
  if (variantKey) {
    policy.variantOverrides ||= {};
    const variantPolicy = (policy.variantOverrides[variantKey] ||= { capabilities: {} });
    variantPolicy.capabilities ||= {};
    if (field === 'effect' && value === '__use_family__') {
      delete variantPolicy.capabilities[capId];
      if (!Object.keys(variantPolicy.capabilities).length && !Array.isArray(variantPolicy.generalNetworks)) {
        delete policy.variantOverrides[variantKey];
      }
      pv2SetDirty(); pv2RenderVariantNote(); pvRenderCapabilities();
      return;
    }
    targetCapabilities = variantPolicy.capabilities;
  }
  if (!targetCapabilities[capId]) {
    const effective = pv2RuleForDisplay(policy, (pvCatalog.capabilities || []).find((cap) => cap.id === capId) || {});
    targetCapabilities[capId] = {
      effect: effective.effect || 'inherit',
      networks: { ...(effective.networks || {}) },
      ...(effective.limits ? { limits: { ...effective.limits } } : {}),
    };
  }
  if (field === 'effect') targetCapabilities[capId].effect = value;
  if (field === 'networkMode') {
    targetCapabilities[capId].networks = targetCapabilities[capId].networks || {};
    targetCapabilities[capId].networks.mode = value;
    if (value === 'custom') targetCapabilities[capId].networks.allowed ||= [];
  }
  pv2SetDirty(); pv2RenderVariantNote(); pvRenderCapabilities();
}
function pv2SetLimit(capId, name, value) {
  if (!pvCurrentDraft || currentRole !== 'editor') return;
  const rule = pv2RuleForEdit(capId);
  rule.limits ||= {};
  if (value === '') delete rule.limits[name];
  else rule.limits[name] = Number(value);
  pv2SetDirty(); pv2RenderVariantNote(); pvRenderCapabilities();
}
function pv2ReviewCap(capId) {
  if (!pvCurrentDraft || currentRole !== 'editor') {
    showToast?.('Create or select a safe draft before reviewing a new feature.', 'error');
    return;
  }
  const cap = (pvCatalog.capabilities || []).find((item) => item.id === capId);
  const policy = pv2FamilyPolicy();
  policy.capabilities ||= {};
  const defaultRule = pv2RuleForDisplay(policy, cap);
  const rule = (policy.capabilities[capId] ||= {
    effect: defaultRule.effect,
    reviewed: false,
    networks: { mode: cap?.networkAware ? 'inherit_general' : 'not_applicable' },
  });
  const allFamilies = pv2Families();
  const reviewedCount = allFamilies.filter((family) => (
    pvCurrentDraft.snapshot.policies?.[family.familyId]?.capabilities?.[capId]?.reviewed === true
  )).length;
  pv2OpenForm(`Review: ${cap?.label || capId}`, `
    <div style="grid-column:1/-1;padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg-secondary)">
      <b>${pv2Escape(cap?.description || '')}</b>
      <div class="pv2-explain" style="margin-top:7px">Frontend: ${pv2Escape(cap?.frontend?.location || 'Backend only')}</div>
      <div class="pv2-explain">Affected APIs: ${pv2Escape((cap?.impact?.routes || []).join(', ') || 'See feature preview')}</div>
      <div class="pv2-explain"><b>${reviewedCount} of ${allFamilies.length} plan families reviewed.</b></div>
    </div>
    <label style="grid-column:1/-1;display:flex;flex-direction:column;gap:7px;font-size:11px"><span><b>Where should this review apply?</b></span><select class="pv2-input" name="scope">
      <option value="all_keep">All plan families — keep each plan’s current Allow/Restrict decision</option>
      <option value="current">Only ${pv2Escape(pv2Families().find((item) => item.familyId === pv2SelectedFamilyId)?.adminLabel || 'this plan')}</option>
      <option value="all_same">All plan families — apply the same decision selected below</option>
    </select><small style="color:var(--text-muted)">“Keep current decisions” clears review warnings without flattening different plan access rules.</small></label>
    <label style="grid-column:1/-1;display:flex;flex-direction:column;gap:7px;font-size:11px"><span><b>Decision for this plan / same-decision mode</b></span><select class="pv2-input" name="effect">
      <option value="allow" ${rule.effect === 'allow' ? 'selected' : ''}>Allow — customers on this plan can use it</option>
      <option value="deny" ${rule.effect !== 'allow' ? 'selected' : ''}>Restrict — show locked/upgrade state</option>
    </select></label>
    <p style="grid-column:1/-1;font-size:10px;color:var(--text-muted);margin:0">This only updates the current draft. Save, Preview, and Validate before publishing.</p>
  `, (form) => {
    const scope = String(form.get('scope') || 'all_keep');
    const selectedEffect = String(form.get('effect')) === 'allow' ? 'allow' : 'deny';
    const targets = scope === 'current'
      ? allFamilies.filter((family) => family.familyId === pv2SelectedFamilyId)
      : allFamilies;
    pvCurrentDraft.snapshot.policies ||= {};
    for (const family of targets) {
      const familyPolicy = (pvCurrentDraft.snapshot.policies[family.familyId] ||= {
        generalNetworks: [],
        capabilities: {},
        variantOverrides: {},
      });
      familyPolicy.capabilities ||= {};
      const generation = pv2Generations().find((item) => item.generationId === family.generation);
      const familyRule = (familyPolicy.capabilities[capId] ||= {
        effect: generation?.newCapabilityDefault === 'deny' ? 'deny' : 'allow',
        networks: { mode: cap?.networkAware ? 'inherit_general' : 'not_applicable' },
      });
      if (scope === 'all_same' || scope === 'current') familyRule.effect = selectedEffect;
      familyRule.reviewed = true;
      familyRule.networks ||= { mode: cap?.networkAware ? 'inherit_general' : 'not_applicable' };
    }
    pv2SetDirty();
    pvRenderCapabilities();
    showToast?.(`${cap?.label || capId}: ${targets.length} plan ${targets.length === 1 ? 'family' : 'families'} reviewed in this draft. Save and validate to refresh warnings.`, 'success');
    return true;
  }, { submitLabel: 'Save review decision' });
}
function pv2EditCapabilityNetworks(capId) {
  if (!pvCurrentDraft || currentRole !== 'editor') {
    showToast?.('Select a safe working draft before changing custom networks.', 'error');
    return;
  }
  const rule = pv2RuleForEdit(capId);
  rule.networks ||= { mode: 'custom', allowed: [] };
  rule.networks.mode = 'custom';
  const current = new Set(rule.networks?.allowed || []);
  pv2OpenForm('Select feature networks', `
    <p style="grid-column:1/-1;font-size:10px;color:var(--text-muted)">Only this feature uses this override. Unselected networks remain unavailable even when the family has general access.</p>
    ${(pvCatalog.networks || []).map((network) => `<label class="pv2-network"><input type="checkbox" name="networks" value="${pv2Escape(network.id)}" ${current.has(network.id) ? 'checked' : ''}> ${pv2Escape(network.label || network.id)}</label>`).join('')}
  `, (form) => {
    rule.networks.allowed = form.getAll('networks').map(String);
    pv2SetDirty(); pv2RenderVariantNote(); pvRenderCapabilities();
    return true;
  }, { submitLabel: 'Use selected networks' });
}

function pv2RenderDrafts(drafts) {
  const el = document.getElementById('pv2-drafts');
  el.innerHTML = drafts.length ? drafts.map((draft) => `
    <div class="pv2-item ${pvCurrentDraft?.draftId === draft.draftId ? 'active' : ''}" onclick="pvSelectDraft('${pv2Escape(draft.draftId)}')">
      <div class="pv2-draft-actions">
        <div style="min-width:0">
          <b style="font-size:11px;display:block;overflow:hidden;text-overflow:ellipsis">${pv2Escape(draft.draftId)}</b>
          <div style="font-size:9px;color:var(--text-muted);margin-top:4px">Complete-policy draft · revision ${draft.draftRevision}</div>
          <div style="font-size:8px;color:#f59e0b;margin-top:3px">Contains every plan family, not only one plan</div>
          <div style="font-size:8px;color:#64748b;margin-top:3px">Started from live revision ${draft.baseRevision}</div>
        </div>
        ${currentRole === 'editor' ? `<button class="pv2-icon-danger" title="Delete this unpublished draft" onclick="event.stopPropagation();pvDeleteDraft('${pv2Escape(draft.draftId)}',${Number(draft.draftRevision)})">Delete</button>` : ''}
      </div>
    </div>`).join('') : '<div style="font-size:10px;color:var(--text-muted)">No drafts. Create one before changing plans.</div>';
}
async function pvLoadDrafts() { const result = await pv2Api('/drafts'); pv2RenderDrafts(result.data || []); }
function pv2RenderHistory(versions) {
  document.getElementById('pv2-history').innerHTML = versions.length ? versions.map((version) => `<div class="pv2-item"><div style="display:flex;justify-content:space-between"><b style="font-size:11px">Revision ${version.revision}</b>${version.isActive ? '<span class="pv2-live-badge">LIVE</span>' : '<span style="font-size:9px;color:var(--text-muted)">HISTORICAL</span>'}</div><div style="font-size:9px;color:var(--text-muted);margin-top:4px">${pv2Escape(version.reason || '')}</div>${version.sourceDraftId ? `<div style="font-size:8px;color:#64748b;margin-top:3px">Published from draft: ${pv2Escape(version.sourceDraftId)}</div>` : ''}${version.isActive ? '' : `<button class="btn btn-ghost btn-sm" style="margin-top:5px" onclick="pvRestoreVersion('${pv2Escape(version.versionId)}')">Create rollback draft</button>`}</div>`).join('') : '<div style="font-size:10px;color:var(--text-muted)">No published versions.</div>';
}
async function pvLoadVersions() { const result = await pv2Api('/versions'); pv2RenderHistory(result.data || []); }

function pvCreateDraft(familyId = pv2SelectedFamilyId) {
  if (currentRole !== 'editor') return;
  const family = pv2Families().find((item) => item.familyId === familyId);
  const suggestedId = `plan-${familyId || 'update'}-${new Date().toISOString().slice(0, 10)}`;
  pv2OpenForm('Create isolated draft', `
    <div style="grid-column:1/-1">${pv2Field('Draft name', 'draftId', suggestedId, 'text', 'required pattern="[a-z0-9._-]+"')}</div>
    <p style="grid-column:1/-1;font-size:10px;color:var(--text-muted)">Starting work on <b>${pv2Escape(family?.adminLabel || 'the selected plan')}</b>. The complete live policy is copied—not only this family. Nothing changes for customers until validation and publish both succeed.</p>
    <p style="grid-column:1/-1;font-size:10px;color:#f59e0b">Parallel drafts from the same live revision cannot both publish independently. After one publishes, the other must be rebased.</p>
  `, async (form) => {
    try {
      const draftId = String(form.get('draftId') || '').trim();
      const result = await pv2Api('/drafts', { method: 'POST', body: JSON.stringify({ draftId }) });
      await pvLoadDrafts(); await pvSelectDraft(result.draft.draftId);
      return true;
    } catch (error) { showToast?.(error.message, 'error'); return false; }
  }, { submitLabel: 'Create safe draft' });
}
async function pvSelectDraft(draftId) {
  if (pv2Dirty) {
    pv2ConfirmAction({
      title: 'Discard unsaved edits?',
      message: `You have changes that are not saved in ${pvCurrentDraft?.draftId || 'the current draft'}. Opening another draft will discard only those unsaved browser edits.`,
      confirmLabel: 'Discard and open draft',
      danger: true,
      onConfirm: async () => {
        pv2SetDirty(false);
        await pvSelectDraft(draftId);
      },
    });
    return;
  }
  try {
    const result = await pv2Api(`/drafts/${encodeURIComponent(draftId)}`);
    pvCurrentDraft = result.data; pv2SetDirty(false);
    pv2ReadOnlyFamily = null;
    pv2ReadOnlyPolicy = null;
    pv2RenderMode();
    pv2RenderSource();
    document.getElementById('pv2-save').disabled = false;
    document.getElementById('pv2-validate').disabled = false;
    document.getElementById('pv2-publish').disabled = false;
    pv2RenderGenerationSelector(); pvRenderFamilies(); await pvLoadDrafts();
    if (pv2SelectedFamilyId && pv2Families().some((family) => family.familyId === pv2SelectedFamilyId)) pvLoadPlanEditor();
  } catch (error) { showToast?.(error.message, 'error'); }
}
function pvExitDraft() {
  if (pv2Dirty) {
    pv2ConfirmAction({
      title: 'Exit without saving browser edits?',
      message: `Unsaved browser edits in ${pvCurrentDraft?.draftId || 'this draft'} will be discarded. The saved MongoDB draft itself will not be deleted or changed.`,
      confirmLabel: 'Discard browser edits & exit',
      danger: true,
      onConfirm: () => {
        pv2SetDirty(false);
        pvExitDraft();
      },
    });
    return;
  }
  pvCurrentDraft = null;
  document.getElementById('pv2-save').disabled = true;
  document.getElementById('pv2-validate').disabled = true;
  document.getElementById('pv2-publish').disabled = true;
  pv2RenderMode();
  pv2RenderSource();
  pv2RenderGenerationSelector();
  pvRenderFamilies();
  pvLoadDrafts().catch(() => {});
  if (pv2SelectedFamilyId && pv2Families().some((family) => family.familyId === pv2SelectedFamilyId)) {
    pv2SelectFamily(pv2SelectedFamilyId);
  }
}
function pvDeleteDraft(draftId, draftRevision) {
  if (currentRole !== 'editor') return;
  const isCurrent = pvCurrentDraft?.draftId === draftId;
  pv2ConfirmAction({
    title: 'Delete unpublished draft?',
    message: `"${draftId}" is only a working copy and is not live. Deleting it will not change customer access, but its unpublished edits cannot be recovered.`,
    confirmLabel: 'Delete draft',
    danger: true,
    onConfirm: async () => {
      try {
        await pv2Api(`/drafts/${encodeURIComponent(draftId)}`, {
          method: 'DELETE',
          body: JSON.stringify({ expectedDraftRevision: draftRevision }),
        });
        if (isCurrent) {
          pvCurrentDraft = null;
          pv2SetDirty(false);
          document.getElementById('pv2-save').disabled = true;
          document.getElementById('pv2-validate').disabled = true;
          document.getElementById('pv2-publish').disabled = true;
          pv2RenderMode();
          pv2RenderSource();
          pv2RenderGenerationSelector();
          pvRenderFamilies();
          if (pv2SelectedFamilyId && pv2Families().some((family) => family.familyId === pv2SelectedFamilyId)) {
            pvLoadPlanEditor();
          } else {
            document.getElementById('pv2-editor').style.display = 'none';
            document.getElementById('pv2-empty').style.display = 'block';
          }
        }
        await pvLoadDrafts();
        await loadPAReviewCount();
        showToast?.(`Draft "${draftId}" deleted. Live plans were not changed.`, 'success');
      } catch (error) {
        showToast?.(error.status === 409 ? 'Draft changed in another tab. Reload before deleting it.' : error.message, 'error');
      }
    },
  });
}
async function pvSaveDraft() {
  if (!pvCurrentDraft) return false;
  try {
    const result = await pv2Api(`/drafts/${encodeURIComponent(pvCurrentDraft.draftId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ snapshot: pvCurrentDraft.snapshot, expectedDraftRevision: pvCurrentDraft.draftRevision }),
    });
    pvCurrentDraft = result.draft; pv2SetDirty(false); await pvLoadDrafts();
    document.getElementById('pv2-subtitle').textContent = `Editing ${pvCurrentDraft.draftId} revision ${pvCurrentDraft.draftRevision}`;
    showToast?.('Draft saved safely.', 'success');
    await loadPAReviewCount();
    return true;
  } catch (error) {
    if (error.status === 409) showToast?.(`This draft changed in another tab (latest revision ${error.payload.latestDraftRevision}). Reload before editing.`, 'error');
    else showToast?.(error.message, 'error');
    return false;
  }
}
async function pvValidateDraft() {
  if (pv2Dirty && !(await pvSaveDraft())) return false;
  try {
    const result = await pv2Api(`/drafts/${encodeURIComponent(pvCurrentDraft.draftId)}/validate`, { method: 'POST' });
    const data = result.data;
    const panel = document.getElementById('pv2-validation'); panel.style.display = 'block';
    const errorRows = (data.errors || []).map((issue) => `<p style="font-size:11px;border-left:3px solid #ef4444;padding-left:8px"><span style="color:#fca5a5;font-size:9px;font-weight:800">BLOCKING</span><br><b>${pv2Escape(issue.code)}</b> · ${pv2Escape(issue.path)}<br>${pv2Escape(issue.message)}</p>`).join('');
    const warningRows = (data.warnings || []).map((issue) => `<p style="font-size:11px;border-left:3px solid #f59e0b;padding-left:8px"><span style="color:#fde68a;font-size:9px;font-weight:800">REVIEW WARNING</span><br><b>${pv2Escape(issue.code)}</b> · ${pv2Escape(issue.path)}<br>${pv2Escape(issue.message)}</p>`).join('');
    panel.innerHTML = `<div class="pv2-kicker">Validation & exact diff</div><h3 style="color:${data.valid ? '#22c55e' : '#f87171'}">${data.valid ? `Ready for publish · ${(data.warnings || []).length} warning(s)` : `${data.errors.length} blocking issue(s) · ${(data.warnings || []).length} warning(s)`}</h3>${data.staleBase ? '<p style="color:#f59e0b">Live policy changed since this draft was created. Publishing will be blocked until rebased.</p>' : ''}${(data.warnings || []).some((issue) => issue.code === 'CAPABILITY_NEEDS_REVIEW') ? '<button type="button" class="btn btn-ghost btn-sm" onclick="pv2ShowNeedsReview()">Show new features to review</button>' : ''}<div style="max-height:260px;overflow:auto">${errorRows}${warningRows || (!errorRows ? '<p style="font-size:11px">No schema or policy errors.</p>' : '')}</div><details><summary style="font-size:11px;cursor:pointer">${data.diff.length} changed fields</summary><pre style="font-size:9px;white-space:pre-wrap">${pv2Escape(JSON.stringify(data.diff, null, 2))}</pre></details>`;
    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    return data.valid;
  } catch (error) { showToast?.(error.message, 'error'); return false; }
}
function pv2ShowNeedsReview() {
  const filter = document.getElementById('pv2-filter');
  if (filter) filter.value = 'needs_review';
  pvRenderCapabilities();
  document.querySelector('.pv2-table-wrap')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
async function pvPublishDraft() {
  if (!pvCurrentDraft) return;
  if (pv2Dirty && !(await pvSaveDraft())) return;
  if (!(await pvValidateDraft())) return;
  const draft = pvCurrentDraft;
  pv2OpenForm('Publish plan changes', `
    <div style="grid-column:1/-1;padding:12px;border:1px solid rgba(245,158,11,.35);border-radius:8px;background:rgba(245,158,11,.08)">
      <b style="color:#fbbf24">This changes live customer access</b>
      <div class="pv2-explain" style="margin-top:6px">Draft: ${pv2Escape(draft.draftId)} · base revision ${draft.baseRevision} · draft revision ${draft.draftRevision}</div>
      <div class="pv2-explain">Publishing is atomic. If another tab changed the draft or live policy, it will be blocked safely.</div>
    </div>
    <label style="grid-column:1/-1;display:flex;flex-direction:column;gap:6px;font-size:11px"><span><b>Why are you making this change?</b></span><textarea class="pv2-input" name="reason" rows="3" required placeholder="Example: Enable AI Search for Platinum monthly and yearly plans"></textarea><small style="color:var(--text-muted)">This reason appears in audit history and helps future rollback decisions.</small></label>
    <label style="grid-column:1/-1;display:flex;gap:8px;align-items:flex-start;font-size:11px"><input type="checkbox" name="confirmed" required style="margin-top:2px"><span>I reviewed the highlighted frontend preview and exact diff, and I understand this will become the live plan policy.</span></label>
  `, async (form) => {
    try {
      const reason = String(form.get('reason') || '').trim();
      if (!reason) return showToast?.('A clear publish reason is required.', 'error'), false;
      const result = await pv2Api(`/drafts/${encodeURIComponent(draft.draftId)}/publish`, {
        method: 'POST',
        body: JSON.stringify({ expectedBaseRevision: draft.baseRevision, expectedDraftRevision: draft.draftRevision, reason }),
      });
      showToast?.(`Policy revision ${result.revision} published.`, 'success');
      pvCurrentDraft = null;
      pv2SetDirty(false);
      await pvLoadInit();
      await loadPAReviewCount();
      return true;
    } catch (error) {
      showToast?.(error.status === 409 ? 'Live policy or draft changed. Nothing was published; reload and compare.' : error.message, 'error');
      return false;
    }
  }, { submitLabel: 'Publish live policy', danger: true });
}
async function pvRestoreVersion(versionId) {
  pv2OpenForm('Create rollback draft', `
    <div style="grid-column:1/-1">${pv2Field('Rollback draft name', 'draftId', `rollback-${Date.now()}`, 'text', 'required pattern="[a-z0-9._-]+"')}</div>
    <p style="grid-column:1/-1;font-size:10px;color:var(--text-muted)">This does not roll back live access immediately. It creates a safe draft from the selected historical version so you can preview, validate and publish it deliberately.</p>
  `, async (form) => {
    try {
      const draftId = String(form.get('draftId') || '').trim();
      const result = await pv2Api(`/versions/${encodeURIComponent(versionId)}/restore-draft`, { method: 'POST', body: JSON.stringify({ draftId }) });
      await pvLoadDrafts();
      await pvSelectDraft(result.draft.draftId);
      return true;
    } catch (error) {
      showToast?.(error.message, 'error');
      return false;
    }
  }, { submitLabel: 'Create rollback draft' });
}

async function pvOpenPreview(capabilityId) {
  const cap = (pvCatalog.capabilities || []).find((item) => item.id === capabilityId);
  if (!cap) return;
  document.getElementById('pv2-preview').classList.add('open');
  document.getElementById('pv2-preview').setAttribute('aria-hidden', 'false');
  document.getElementById('pv2-preview-title').textContent = cap.label;
  document.getElementById('pv2-preview-body').innerHTML = '<p style="color:var(--text-muted)">Calculating before/after impact…</p>';
  let simulation = null;
  if (pvCurrentDraft) {
    const family = pv2Families().find((item) => item.familyId === pv2SelectedFamilyId);
    const selectedVariant = pv2SelectedVariantKey();
    const planId = selectedVariant
      ? Number(selectedVariant)
      : Number(family?.variants?.[0]?.planId);
    try {
      const result = await pv2Api(`/drafts/${encodeURIComponent(pvCurrentDraft.draftId)}/preview`, { method: 'POST', body: JSON.stringify({ capabilityId, familyId: pv2SelectedFamilyId, planId }) });
      simulation = result.data;
    } catch (error) { showToast?.(error.message, 'error'); }
  }
  const details = simulation?.capability || cap;
  pv2PreviewContext = { details, simulation, state: simulation ? 'after' : 'feature' };
  const decision = (item) => item ? `<div class="pv2-stat"><b style="color:${item.allowed ? '#22c55e' : '#f87171'}">${item.allowed ? 'Allowed' : 'Restricted'}</b><div style="font-size:10px;margin-top:6px">${pv2Escape(item.reasonCode)}</div><div style="font-size:9px;color:var(--text-muted);margin-top:5px">Networks: ${pv2Escape((item.allowedNetworks || []).join(', ') || 'none')}</div></div>` : '<div class="pv2-stat">Select a draft and family to simulate.</div>';
  document.getElementById('pv2-preview-body').innerHTML = `
    <section style="margin-bottom:20px;padding:13px;border:1px solid rgba(245,158,11,.28);border-radius:10px;background:rgba(245,158,11,.035)">
      <div style="display:flex;align-items:flex-start;gap:10px"><div><div class="pv2-kicker" style="color:#fbbf24">Frontend screen — exact location</div><p style="font-size:10px;color:var(--text-muted);margin:5px 0 0">This is a safe simulated screenshot using mock data. Yellow highlights the feature; red shows its locked position.</p></div><span style="flex:1"></span><span style="font-size:9px;border:1px solid #fbbf24;color:#fbbf24;border-radius:99px;padding:4px 8px">SCREEN PREVIEW</span></div>
      <div id="pv2-visual-preview">${pv2BuildVisualPreview(details, simulation, pv2PreviewContext.state)}</div>
    </section>
    <section style="margin-bottom:18px"><div class="pv2-kicker">What is this?</div><p style="font-size:12px;line-height:1.55">${pv2Escape(details.description)}</p><span style="font-size:10px">Section: ${pv2Escape(details.category)} · Parent feature: ${pv2Escape(details.parentCapability || 'Top-level feature')} · Owner: ${pv2Escape(details.owner)} · Status: ${pv2Escape(details.status)}</span></section>
    <section style="margin-bottom:18px"><div class="pv2-kicker">Where users see it</div><p style="font-size:12px"><b>${pv2Escape(details.frontend?.location)}</b><br>Frontend route: <code>${pv2Escape(details.frontend?.route || 'backend only')}</code></p><div style="font-size:10px;color:var(--text-muted)">Controls: ${(details.frontend?.controls || []).map((control) => pv2Escape(control.label || control.id)).join(', ') || 'No visible control'}</div></section>
    <section style="margin-bottom:18px"><div class="pv2-kicker">What gets restricted</div><p style="font-size:12px">${pv2Escape(details.impact?.message || details.lockedExperience?.message)}</p><ul>${(details.impact?.routes || (details.routes || []).map((r) => `${r.method} ${r.path}`)).map((route) => `<li style="font-size:11px"><code>${pv2Escape(route)}</code></li>`).join('')}</ul></section>
    <section><div class="pv2-kicker">Customer before / after simulation</div><p style="font-size:10px;color:var(--text-muted)">Simulation only; backend enforcement remains authoritative.</p><div class="pv2-decision-grid">${decision(simulation?.before)}${decision(simulation?.after)}</div></section>`;
  document.getElementById('pv2-preview-body').scrollTop = 0;
}

function pv2BuildVisualPreview(details, simulation, state) {
  const route = details.frontend?.route || '/';
  const location = details.frontend?.location || details.label;
  const controls = details.frontend?.controls || [];
  const controlLabel = controls[0]?.label || details.label;
  const decision = state === 'before' ? simulation?.before : state === 'after' ? simulation?.after : null;
  const restricted = decision && !decision.allowed;
  const tabs = simulation ? `<div class="pv2-preview-tabs"><button class="pv2-preview-tab ${state === 'before' ? 'active' : ''}" onclick="pv2SwitchPreviewState('before')">Before · Live</button><button class="pv2-preview-tab ${state === 'after' ? 'active' : ''}" onclick="pv2SwitchPreviewState('after')">After · Draft</button></div>` : '';
  let activeNav = 'Ads Library';
  let page = '';

  if (route === '/projects') {
    activeNav = 'All Projects';
    if (details.id === 'projects.analytics') {
      page = `<div class="pv2-shot-title">Competitor Analytics</div><div class="pv2-shot-sub">Compare performance across your tracked brands</div><div class="pv2-shot-grid"><div class="pv2-shot-card pv2-target"><div class="pv2-shot-line short"></div><div class="pv2-shot-line"></div>${restricted ? '<span class="pv2-shot-lock">🔒 Upgrade to view analytics</span>' : ''}</div><div class="pv2-shot-card"><div class="pv2-shot-line short"></div><div class="pv2-shot-line"></div></div><div class="pv2-shot-card"><div class="pv2-shot-line short"></div><div class="pv2-shot-line"></div></div></div>`;
    } else if (details.id === 'projects.members' || details.id === 'projects.brand_cc') {
      page = `<div class="pv2-shot-title">Project Members</div><div class="pv2-shot-sub">Manage teammates and brand notifications</div><div class="pv2-shot-control pv2-target"><b>${pv2Escape(controlLabel)}</b><div class="pv2-shot-line" style="margin-top:7px"></div>${restricted ? '<span class="pv2-shot-lock">🔒 Member management locked</span>' : ''}</div><div class="pv2-shot-control">Brand notification recipients</div>`;
    } else if (details.id === 'projects.alerts' || details.id === 'projects.activity_feed') {
      page = `<div class="pv2-shot-title">All Projects</div><div class="pv2-shot-sub">Alerts and recent project changes</div><div class="pv2-shot-control pv2-target"><b>${pv2Escape(details.label)}</b><div class="pv2-shot-line" style="margin-top:7px"></div>${restricted ? '<span class="pv2-shot-lock">🔒 This section will be restricted</span>' : ''}</div><div class="pv2-shot-control">Recent competitor changes</div>`;
    } else {
      page = `<div class="pv2-shot-title">All Projects</div><div class="pv2-shot-sub">Track brands and discover their competitors</div><div class="pv2-shot-tools"><div class="pv2-shot-control pv2-target"><b>${pv2Escape(controlLabel)}</b>${restricted ? '<span class="pv2-shot-lock">🔒 Upgrade required</span>' : '<div style="color:#86efac;margin-top:5px;font-size:7px">Available on this plan</div>'}</div></div><div class="pv2-shot-grid"><div class="pv2-shot-card"><div class="pv2-shot-line"></div></div><div class="pv2-shot-card"><div class="pv2-shot-line"></div></div></div>`;
    }
  } else if (route === '/market-trends') {
    activeNav = 'Market Trends';
    page = `<div class="pv2-shot-title">Market Trends</div><div class="pv2-shot-sub">Explore winning categories, regions and keywords</div><div class="pv2-shot-control">Network · Facebook</div><div class="pv2-shot-grid"><div class="pv2-shot-card pv2-target"><div class="pv2-shot-line short"></div><div class="pv2-shot-line"></div>${restricted ? '<span class="pv2-shot-lock">🔒 Trends locked</span>' : ''}</div><div class="pv2-shot-card"><div class="pv2-shot-line"></div></div><div class="pv2-shot-card"><div class="pv2-shot-line"></div></div></div>`;
  } else if (route === '/keywords-explorer') {
    activeNav = 'Keyword Explorer';
    page = `<div class="pv2-shot-title">Keyword Explorer</div><div class="pv2-shot-sub">Find keyword volume and competitive opportunities</div><div class="pv2-shot-control pv2-target"><b>Search keywords</b><div class="pv2-shot-line" style="margin-top:7px"></div>${restricted ? '<span class="pv2-shot-lock">🔒 Keyword Explorer locked</span>' : ''}</div><div class="pv2-shot-card" style="height:72px"><div class="pv2-shot-line"></div><div class="pv2-shot-line"></div><div class="pv2-shot-line short"></div></div>`;
  } else {
    activeNav = 'Ads Library';
    page = `<div class="pv2-shot-title">Ads Library</div><div class="pv2-shot-sub">Search ads and narrow results with filters</div><div style="display:grid;grid-template-columns:115px 1fr;gap:7px"><div><div class="pv2-shot-control">Network</div><div class="pv2-shot-control pv2-target"><b>${pv2Escape(controlLabel)}</b>${restricted ? '<span class="pv2-shot-lock">🔒 Upgrade</span>' : '<div style="font-size:7px;color:#86efac;margin-top:5px">Enabled</div>'}</div><div class="pv2-shot-control">Date range</div></div><div class="pv2-shot-grid" style="grid-template-columns:repeat(2,1fr)"><div class="pv2-shot-card" style="height:78px"><div class="pv2-shot-line"></div></div><div class="pv2-shot-card" style="height:78px"><div class="pv2-shot-line"></div></div></div></div>`;
  }

  const navItems = ['Ads Library', 'Market Trends', 'Keyword Explorer', 'All Projects'];
  return `${tabs}<div class="pv2-shot ${restricted ? 'pv2-shot-restricted' : ''}"><div class="pv2-shot-bar"><span class="pv2-shot-dot"></span><span class="pv2-shot-dot"></span><span class="pv2-shot-dot"></span><span class="pv2-shot-url">poweradspy.com${pv2Escape(route)}</span></div><div class="pv2-shot-app"><div class="pv2-shot-nav"><div class="pv2-shot-logo"></div>${navItems.map((item) => `<div class="pv2-shot-navitem ${item === activeNav ? 'active' : ''}">${item}</div>`).join('')}</div><div class="pv2-shot-page">${page}</div></div></div><div class="pv2-shot-caption"><b>Highlighted:</b> ${pv2Escape(location)}<br>${restricted ? 'Draft ke baad ye highlighted control locked/upgrade state mein dikhega.' : 'Yellow highlight exact frontend location dikhata hai jise ye capability control karti hai.'}</div>`;
}

function pv2SwitchPreviewState(state) {
  if (!pv2PreviewContext) return;
  pv2PreviewContext.state = state;
  const target = document.getElementById('pv2-visual-preview');
  if (target) target.innerHTML = pv2BuildVisualPreview(pv2PreviewContext.details, pv2PreviewContext.simulation, state);
}
function pvClosePreview() { document.getElementById('pv2-preview').classList.remove('open'); document.getElementById('pv2-preview').setAttribute('aria-hidden', 'true'); }

let pv2FormHandler = null;
function pv2OpenForm(title, body, handler, options = {}) {
  document.getElementById('pv2-form-title').textContent = title;
  document.getElementById('pv2-form-body').innerHTML = body;
  pv2FormHandler = handler;
  const submit = document.getElementById('pv2-form-submit');
  const cancel = document.getElementById('pv2-form-cancel');
  submit.textContent = options.submitLabel || 'Apply changes';
  submit.style.background = options.danger ? '#b91c1c' : '';
  submit.style.borderColor = options.danger ? '#ef4444' : '';
  submit.disabled = currentRole !== 'editor' && options.readOnly !== true;
  cancel.style.display = options.hideCancel ? 'none' : '';
  document.getElementById('pv2-form-modal').classList.remove('hidden');
}
function pv2CloseForm() {
  document.getElementById('pv2-form-modal').classList.add('hidden');
  pv2FormHandler = null;
}
async function pv2SubmitForm(event) {
  event.preventDefault();
  const submit = event.currentTarget.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    if (await pv2FormHandler?.(new FormData(event.currentTarget)) !== false) pv2CloseForm();
  } finally {
    if (submit) submit.disabled = false;
  }
}
function pv2Field(label, name, value = '', type = 'text', extra = '') {
  return `<label style="display:flex;flex-direction:column;gap:6px;font-size:11px"><span>${pv2Escape(label)}</span><input class="pv2-input" name="${pv2Escape(name)}" type="${type}" value="${pv2Escape(value)}" ${extra}></label>`;
}
function pv2ExplainedField(label, help, name, value = '', type = 'text', extra = '') {
  return `<label style="display:flex;flex-direction:column;gap:5px;font-size:11px"><span><b>${pv2Escape(label)}</b></span><small style="color:var(--text-muted);line-height:1.35">${pv2Escape(help)}</small><input class="pv2-input" name="${pv2Escape(name)}" type="${type}" value="${pv2Escape(value)}" ${extra}></label>`;
}

function pv2ConfirmAction({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  pv2OpenForm(title, `
    <div style="grid-column:1/-1;padding:13px;border:1px solid ${danger ? 'rgba(248,113,113,.32)' : 'var(--border)'};border-radius:8px;background:${danger ? 'rgba(248,113,113,.07)' : 'var(--bg-secondary)'}">
      <p style="font-size:12px;line-height:1.55;margin:0;color:var(--text)">${pv2Escape(message)}</p>
    </div>
  `, async () => {
    await onConfirm?.();
    return true;
  }, { submitLabel: confirmLabel, danger });
}

function pvOpenHowToUse() {
  pv2OpenForm('How to use Plan Control safely', `
    <div class="pv2-help" style="grid-column:1/-1">
      <div style="padding:12px;border:1px solid rgba(99,102,241,.3);background:rgba(99,102,241,.08);border-radius:9px;margin-bottom:8px"><b style="color:#c7d2fe">Simple rule:</b> customers change only after Publish. Everything before that is a safe draft.</div>
      ${[
        ['1', 'View any plan without a draft', 'Click Basic, Standard, Palladium or another family to open its current policy immediately in read-only mode. Creating a draft is never required just to inspect networks, features, limits or previews.'],
        ['2', 'Check the source banner first', 'The banner says exactly what you are viewing: LIVE policy, CURRENT LEGACY ACCESS converted read-only, backend bootstrap preview, or an editable WORKING DRAFT. It also shows the MongoDB collection, record and revision when applicable.'],
        ['3', 'Understand generation, family and billing options', 'A generation is a complete model such as Legacy or 2026 Plans. A family is one product tier. Family default normally controls every monthly, yearly, trial and legacy billing ID. For one feature, use Apply family rule to all billing IDs. To remove every feature/network/limit exception at once, use Make all IDs follow family. Both actions change only the safe draft until Publish.'],
        ['4', 'Open one complete-policy draft to edit', 'A working draft contains every plan family, not only the family visible when it was created. While that draft is selected, switch Basic, Standard and Palladium directly—your unsaved browser edits remain in the same draft snapshot.'],
        ['5', 'Set and verify general networks', 'The green/amber summary lists the exact family-default networks in plain text. Checkboxes edit them only inside a safe draft. For an older blank migration draft, “Copy current networks into this draft” deliberately imports the current access without silently overwriting anything.'],
        ['6', 'Use parent and child feature controls', 'A restricted parent blocks every child. A child set to Follow parent automatically uses the parent decision. Parent actions can allow the group, restrict the group, or reset all children to follow; an individual child may still use a stricter/custom decision.'],
        ['7', 'Choose feature-specific networks where applicable', 'Network-aware rows can use the family’s general networks or a smaller custom list. “Same for every network” means that feature does not receive network context, so a custom network rule would not be enforced.'],
        ['8', 'Set limits only where registered', 'Brand Limit, Token Limit, Member Limit and similar fields appear only when runtime code registered that limit type. Empty means no configured limit; 0 means zero usage allowed.'],
        ['9', 'Review a new feature at the right scope', 'Review only this family, review all families while preserving each existing Allow/Restrict decision (safest bulk option), or explicitly apply one decision to all families. Pending compatibility reviews are warnings, not blockers; strict-deny unreviewed allows remain blocked.'],
        ['10', 'Use the highlighted frontend preview', 'View frontend opens a browser-like screen. Yellow marks the exact customer control; red shows where it becomes locked. The drawer also lists affected APIs and the simulated before/after result.'],
        ['11', 'Save, then Validate & diff', 'Save increments the draft revision. Any edit marks old validation results as outdated. Validate separates BLOCKING errors from REVIEW WARNINGS and shows every changed field before publish.'],
        ['12', 'Publish once, with a reason', 'Publish is the only live action. It creates immutable history and a LIVE badge, records the source draft and deletes that published draft. Another tab holding an older revision cannot overwrite it.'],
      ].map(([number, title, text]) => `<div class="pv2-help-step"><span class="pv2-help-num">${number}</span><div><h4>${title}</h4><p>${text}</p></div></div>`).join('')}
      <div style="margin-top:14px;padding:12px;border:1px solid var(--border);border-radius:9px">
        <h4>Quick glossary</h4>
        <p><b>Complete-policy draft:</b> one unpublished snapshot containing all generations, families and rules. It is not a Basic-only or Palladium-only draft.</p>
        <p><b>Plan display order:</b> sorting/position only; it does not automatically grant access.</p>
        <p><b>Billing option:</b> provider product ID for monthly, yearly, trial, legacy or a future billing cycle.</p>
        <p><b>Family default:</b> the normal feature, network and limit rules shared by every billing ID that does not have an exception.</p>
        <p><b>HAS OVERRIDE:</b> this billing ID has at least one explicit feature, network or limit exception. It does not necessarily mean the feature currently visible in the table is overridden.</p>
        <p><b>Follows family:</b> this billing ID has no explicit exception and automatically receives the family defaults.</p>
        <p><b>Available for new purchases:</b> whether new customers may buy it. The plan card explains whether this value came from live policy, the draft, legacy plan_groups or a safe missing-value default.</p>
        <p><b>Blocking error:</b> invalid or unsafe policy that cannot publish. <b>Review warning:</b> visible follow-up work that does not block an unrelated compatibility-mode change.</p>
        <p><b>Lifecycle:</b> draft, active, legacy or archived state of the plan definition.</p>
      </div>
      <div style="margin-top:10px;padding:12px;border:1px solid rgba(99,102,241,.3);background:rgba(99,102,241,.07);border-radius:9px">
        <h4>Family defaults and billing IDs — exact behavior</h4>
        <p><b>Changing Family default:</b> immediately changes every billing ID marked <i>follows family</i> in the current draft. A billing ID marked <i>HAS OVERRIDE</i> keeps its explicit exception until you deliberately remove it.</p>
        <p style="margin-top:8px"><b>Apply one feature to every billing ID:</b> stay on Family default, set that feature to Allow/Restrict and click <i>Apply family rule to all billing IDs</i> in the same feature row. Only that feature's billing-specific access, feature-network and limit overrides are removed. Other feature exceptions remain untouched.</p>
        <p style="margin-top:8px"><b>Apply the complete family to every billing ID:</b> click <i>Make all N IDs follow family</i> in the Rule scope / billing option card. This removes every billing-specific feature, network and limit override for the family. Use this only when monthly, yearly, trial, platform and legacy IDs should be identical.</p>
        <p style="margin-top:8px"><b>Why HAS OVERRIDE may remain after fixing one feature:</b> that billing ID can still have an exception for another feature, general networks or a limit. Select the billing ID to inspect its remaining orange override badges, or use the whole-family action if no exceptions should remain.</p>
        <p style="margin-top:8px"><b>Future billing IDs:</b> a newly added monthly/yearly/custom billing ID follows the family automatically unless an admin deliberately creates a billing-specific override for it.</p>
        <p style="margin-top:8px"><b>Safety:</b> both bulk actions only modify the selected safe draft. Check Validate &amp; diff before Publish. Until Publish succeeds, active customers and the LIVE policy do not change.</p>
      </div>
      <div style="margin-top:10px;padding:12px;border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.06);border-radius:9px">
        <h4>Example: allow Market Trends for every Palladium billing ID</h4>
        <p>Open Palladium in a safe draft → keep <b>Family default</b> selected → search <b>Market Trends</b> → choose <b>Allow feature</b> → click <b>Apply family rule to all billing IDs</b> in that row → confirm → Save Draft → Validate &amp; diff → Publish. The diff should remove or replace every Market Trends billing override, so IDs such as yearly #69 can no longer return <code>VARIANT_DENY</code> for this feature.</p>
      </div>
      <div style="margin-top:10px;padding:12px;border:1px solid rgba(245,158,11,.3);background:rgba(245,158,11,.07);border-radius:9px">
        <h4>Two browser tabs editing the same draft</h4>
        <p>Both tabs start at the same draft revision. The first successful Save increments it. A later Save from the stale tab receives <code>DRAFT_CHANGED</code>; if the first tab already published, the stale tab receives <code>Draft not found</code>. It cannot overwrite the published data. Reload and create a fresh draft from the latest LIVE revision to continue.</p>
      </div>
      <div style="margin-top:10px;padding:12px;border:1px solid rgba(34,197,94,.25);background:rgba(34,197,94,.06);border-radius:9px">
        <h4>When developers add a future feature</h4>
        <p>Register its parent, frontend location, protected APIs, locked behavior, network applicability and supported limit names in the capability registry. It then appears automatically in the correct category and review queue. Compatibility mode temporarily allows an unreviewed feature to avoid a surprise 403 and reports a non-blocking warning; a generation can deliberately choose strict deny. The system never invents business meaning, a network rule or token enforcement—the developer must wire the runtime context and limit consumption.</p>
      </div>
    </div>
  `, () => true, { submitLabel: 'Got it', hideCancel: true, readOnly: true });
}

function pvOpenGenerationWizard(forceClone = false) {
  if (!pvCurrentDraft || currentRole !== 'editor') return showToast?.('Create or select a draft first. Generations never change live policy directly.', 'error');
  const source = document.getElementById('pv2-generation')?.value || '';
  pv2OpenForm('Create plan generation', `
    ${pv2ExplainedField('Internal generation ID', 'Permanent technical key, for example 2027-growth.', 'generationId', '', 'text', 'required placeholder="2027-growth" pattern="[a-z0-9._-]+"')}
    ${pv2ExplainedField('Name admins see', 'Friendly name that distinguishes this complete plan model.', 'adminLabel', '', 'text', 'required placeholder="2027 Growth Plans"')}
    <label style="display:flex;flex-direction:column;gap:5px;font-size:11px"><span><b>How should it start?</b></span><small style="color:var(--text-muted)">Clone copies plan rules but removes billing IDs. Blank starts every feature safely restricted.</small><select class="pv2-input" name="sourceMode"><option value="clone" ${forceClone ? 'selected' : ''}>Copy selected generation’s rules</option><option value="blank">Start blank with features restricted</option></select></label>
    <label style="display:flex;flex-direction:column;gap:5px;font-size:11px"><span><b>Design status</b></span><small style="color:var(--text-muted)">Draft is still being designed. Validated means its structure has already been reviewed.</small><select class="pv2-input" name="status"><option value="draft">Draft — still designing</option><option value="validated">Validated — structure reviewed</option></select></label>
    <label style="display:flex;flex-direction:column;gap:5px;font-size:11px"><span><b>Who may buy it initially?</b></span><small style="color:var(--text-muted)">New generations should not be publicly sold until billing IDs and policies are verified.</small><select class="pv2-input" name="salesStatus"><option value="not_live">Nobody — not live</option><option value="internal">Internal/testing only</option></select></label>
    <label style="display:flex;flex-direction:column;gap:5px;font-size:11px"><span><b>When a future feature is registered</b></span><small style="color:var(--text-muted)">Compatibility mode avoids surprise 403 errors but still keeps the feature visible in the review queue.</small><select class="pv2-input" name="newCapabilityDefault"><option value="needs_review">Temporarily allow everyone + ask admin to review</option><option value="deny">Strict mode: restrict until reviewed</option></select></label>
    <p style="grid-column:1/-1;font-size:10px;color:var(--text-muted)">Monthly, yearly, legacy, trial, or any future billing variant is configured inside each family. New capabilities always appear in this generation's review queue.</p>
  `, (form) => {
    const generationId = String(form.get('generationId') || '').trim();
    const adminLabel = String(form.get('adminLabel') || '').trim();
    const sourceMode = String(form.get('sourceMode'));
    pvCurrentDraft.snapshot.generations ||= [];
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(generationId)) return showToast?.('Invalid generation ID.', 'error'), false;
    if (pvCurrentDraft.snapshot.generations.some((item) => item.generationId === generationId)) return showToast?.('Generation ID already exists.', 'error'), false;
    pvCurrentDraft.snapshot.generations.push({
      generationId, adminLabel, customerLabel: adminLabel, description: '',
      status: String(form.get('status')), salesStatus: String(form.get('salesStatus')),
      basedOnGenerationId: sourceMode === 'clone' ? source || null : null,
      newCapabilityDefault: String(form.get('newCapabilityDefault')), createdAt: new Date().toISOString(),
    });
    if (sourceMode === 'clone' && source) {
      const suffix = generationId.split('-').at(-1);
      for (const original of pv2Families().filter((family) => family.generation === source)) {
        let familyId = `${original.familyId.replace(/-[^-]+$/, '')}-${suffix}`;
        if (pv2Families().some((family) => family.familyId === familyId)) familyId = `${original.familyId}-${generationId}`;
        const copy = JSON.parse(JSON.stringify(original));
        Object.assign(copy, { familyId, generation: generationId, adminLabel: `${copy.label} (${adminLabel})`, status: 'draft', openForNewSignups: false, variants: [] });
        pvCurrentDraft.snapshot.planFamilies.push(copy);
        const sourcePolicy = pvCurrentDraft.snapshot.policies?.[original.familyId] || { generalNetworks: [], capabilities: {}, variantOverrides: {} };
        pvCurrentDraft.snapshot.policies[familyId] = JSON.parse(JSON.stringify(sourcePolicy));
      }
    }
    pv2SetDirty(); pv2RenderGenerationSelector();
    document.getElementById('pv2-generation').value = generationId; pvGenerationChanged();
    showToast?.('Generation added to this draft. Add verified billing variants before publishing.', 'success');
    return true;
  }, { submitLabel: 'Add generation to draft' });
}
function pvDuplicateGeneration() { pvOpenGenerationWizard(true); }

function pv2OpenFamilyForm(family = null) {
  if (!pvCurrentDraft || currentRole !== 'editor') return;
  const generation = family?.generation || document.getElementById('pv2-generation')?.value;
  const variants = (family?.variants || []).map((variant) =>
    `${variant.billingCycle}:${variant.planId}:${variant.billingProvider || 'amember'}:${variant.status || 'active'}`
  ).join('\n');
  pv2OpenForm(family ? 'Edit plan family' : 'Add plan family', `
    ${pv2ExplainedField('Internal family ID', 'Permanent technical key used by policy history. It cannot be renamed later.', 'familyId', family?.familyId || '', 'text', `required pattern="[a-z0-9._-]+" ${family ? 'readonly' : ''}`)}
    ${pv2ExplainedField('Name customers see', 'Friendly plan name shown in customer-facing screens.', 'label', family?.label || '', 'text', 'required')}
    ${pv2ExplainedField('Name admins see', 'Include the generation/year so current and legacy plans are never confused.', 'adminLabel', family?.adminLabel || '', 'text', 'required')}
    ${pv2ExplainedField('Plan display order', 'Higher number places the plan higher in comparisons. It does not grant features automatically.', 'tierRank', family?.tierRank ?? 10, 'number', 'min="0" required')}
    <label style="display:flex;flex-direction:column;gap:5px;font-size:11px"><span><b>Plan lifecycle</b></span><small style="color:var(--text-muted);line-height:1.35">Draft = being designed, Active = current, Legacy = existing customers, Archived = history only.</small><select class="pv2-input" name="status">${['draft','active','legacy','custom','archived','deleted'].map((status) => `<option value="${status}" ${family?.status === status ? 'selected' : ''}>${pv2Humanize(status)}</option>`).join('')}</select></label>
    <label style="display:flex;flex-direction:column;gap:6px;font-size:11px"><span><b>Available for new purchases</b></span><small style="color:var(--text-muted);line-height:1.35">Turn off to stop new sales while keeping existing customers and billing IDs valid.</small><span><input name="openForNewSignups" type="checkbox" ${family?.openForNewSignups ? 'checked' : ''}> Allow new customers to buy this plan</span></label>
    <label style="grid-column:1/-1;display:flex;flex-direction:column;gap:6px;font-size:11px"><span><b>Billing options</b> — one per line: cycle : billing ID : provider : status</span><small style="color:var(--text-muted)">Monthly and yearly IDs listed here share this family’s rules. Supports legacy, trial, custom or future cycles. Duplicate IDs are blocked across every generation.</small><textarea class="pv2-input" name="variants" rows="5" placeholder="monthly:101:amember:active&#10;yearly:102:amember:active">${pv2Escape(variants)}</textarea></label>
  `, (form) => {
    const familyId = String(form.get('familyId') || '').trim();
    if (!/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(familyId)) return showToast?.('Invalid family ID.', 'error'), false;
    if (!family && pv2Families().some((item) => item.familyId === familyId)) return showToast?.('Family ID already exists.', 'error'), false;
    const parsed = String(form.get('variants') || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
      const [billingCycle, rawPlanId, billingProvider = 'amember', status = 'active'] = line.split(':').map((part) => part.trim());
      return { planId: Number(rawPlanId), billingCycle, billingProvider, status, verified: true };
    });
    if (parsed.some((variant) => !variant.billingCycle || !Number.isInteger(variant.planId) || variant.planId <= 0)) return showToast?.('Each billing line needs a cycle and positive numeric plan ID.', 'error'), false;
    if (new Set(parsed.map((variant) => variant.planId)).size !== parsed.length) return showToast?.('Billing IDs must be unique.', 'error'), false;
    const requested = new Set(parsed.map((variant) => variant.planId));
    const collision = pv2Families().flatMap((item) => item.familyId === familyId ? [] : (item.variants || []).map((variant) => ({ planId: Number(variant.planId), family: item.adminLabel }))).find((entry) => requested.has(entry.planId));
    if (collision) return showToast?.(`Billing ID ${collision.planId} already belongs to ${collision.family}.`, 'error'), false;
    const target = family || { familyId, generation, description: '' };
    Object.assign(target, {
      label: String(form.get('label')).trim(), adminLabel: String(form.get('adminLabel')).trim(),
      tierRank: Number(form.get('tierRank')), status: String(form.get('status')),
      openForNewSignups: form.get('openForNewSignups') === 'on', variants: parsed,
    });
    if (!family) {
      pvCurrentDraft.snapshot.planFamilies.push(target);
      pvCurrentDraft.snapshot.policies[familyId] = {
        generalNetworks: [],
        capabilities: Object.fromEntries((pvCatalog.capabilities || []).map((cap) => [cap.id, { effect: 'deny', reviewed: cap.status !== 'needs_review', networks: { mode: cap.networkAware ? 'inherit_general' : 'not_applicable' } }])),
        variantOverrides: {},
      };
      pv2SelectedFamilyId = familyId;
    }
    pv2SetDirty(); pvRenderFamilies(); pvLoadPlanEditor();
    return true;
  }, { submitLabel: family ? 'Save plan details' : 'Add plan family' });
}
function pvAddFamily() { pv2OpenFamilyForm(); }
function pvEditFamily() {
  const family = pv2Families().find((item) => item.familyId === pv2SelectedFamilyId);
  if (family) pv2OpenFamilyForm(family);
}

window.addEventListener('beforeunload', (event) => { if (pv2Dirty) { event.preventDefault(); event.returnValue = ''; } });
Object.assign(window, { pvLoadInit, pvCreateDraft, pvSelectDraft, pvExitDraft, pvDeleteDraft, pvSaveDraft, pvPublishDraft, pvLoadPlanEditor, pvUpdateCap, pvRenderFamilies, pvRenderCapabilities, pvGenerationChanged, pvOpenGenerationWizard, pvDuplicateGeneration, pvAddFamily, pvEditFamily, pvValidateDraft, pv2ShowNeedsReview, pvRestoreVersion, pvOpenPreview, pvClosePreview, pvOpenHowToUse, pvGoUnlockEditing, pv2SwitchPreviewState, pv2SelectFamily, pv2VariantChanged, pv2MakeAllVariantsFollowFamily, pv2ApplyFeatureToAllVariants, pv2ToggleNetwork, pv2ResetVariantNetworks, pv2CopyCurrentNetworks, pv2ApplyCapabilityTree, pv2SetLimit, pv2ReviewCap, pv2EditCapabilityNetworks, pv2SubmitForm, pv2CloseForm });
