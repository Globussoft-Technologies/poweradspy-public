

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

  // Plan ID Validation
  const paNewIdInput = document.getElementById('pa-new-plan-id');
  if (paNewIdInput) {
    paNewIdInput.addEventListener('input', debounce(paValidateNewId, 400));
  }

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
  const paBadge = document.getElementById('pa-role-badge');
  if (paBadge) {
    paBadge.textContent = isEditor ? 'Viewing as: Editor' : 'Viewing as: Viewer';
    paBadge.style.color = isEditor ? 'var(--success)' : 'var(--text-muted)';
  }
  
  const paAddPlanContainer = document.getElementById('pa-add-plan-container');
  if (paAddPlanContainer) {
    paAddPlanContainer.style.display = isEditor ? 'flex' : 'none';
  }

  // Ensure buttons on the plan access tab reflect the current role
  if (paSelectedPlan) renderPADetail(paSelectedPlan);
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
    const res = await fetch(API + '/plan-access/review-count');
    if (!res.ok) return;
    const json = await res.json();
    renderPANewFeatureBanner(json.data?.filters || []);
  } catch (e) { /* silent — non-critical */ }
}

// ─── Tab Navigation ───────────────────────────────────────
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
    case 'plan-access': loadPlanAccessDocs(); break;
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

let paFilterDocs = [];
let paPlatformDoc = null;
let paLimitsDoc = null;
let paSelectedPlan = null;
let paCatFilter = 'all';
let paCollapsedGroups = {}; // populated dynamically from MongoDB plan_groups doc
let paDeletedPlanIds = [];  // { plan_id, group, deleted_at } — from MongoDB plan_groups doc

const PA_PLATFORMS = ['facebook','instagram','youtube','google','gdn','linkedin','reddit','quora','pinterest','tiktok','native'];
const PA_PLAT_LABEL = { facebook:'FA', instagram:'IN', youtube:'YT', google:'GO', gdn:'GD', linkedin:'LI', reddit:'RE', quora:'QU', pinterest:'PI', tiktok:'TI', native:'NA' };

// PA_PLAN_GROUPS is no longer hardcoded — populated dynamically from MongoDB plan_groups doc
// const PA_PLAN_GROUPS = {
//   'Free':      { plans: [20], color: '#94a3b8' },
//   'Basic':     { plans: [2,5,9,14,15,25,40,49,52,59,64,71], color: '#6366f1' },
//   'Standard':  { plans: [58,53,65,3,6,10,13,16,26,41], color: '#3b82f6' },
//   'Premium':   { plans: [60,54,66,4,7,11,12,17,27,42], color: '#f59e0b' },
//   'Platinum':  { plans: [61,55,67,22,34,23,24,28,37,43], color: '#ef4444' },
//   'Titanium':  { plans: [29,35,44,56,62,68,31], color: '#8b5cf6' },
//   'Palladium': { plans: [63,57,32,36,30,39,45,69], color: '#10b981' },
//   'Custom':    { plans: [33,70,46], color: '#f97316' },
// };
let PA_PLAN_GROUPS = {};

const PA_CAT_COLORS = {
  search_by: '#3b82f6', filter: '#8b5cf6', demographics: '#ec4899', ad_properties: '#f59e0b',
  lander: '#10b981', sort_by: '#06b6d4', dates: '#6366f1', engagement: '#f97316',
  ai: '#a855f7', platform: '#ef4444', limits: '#14b8a6', sidebar: '#0ea5e9',
};

async function loadPlanAccessDocs(showToastMsg = false) {
  const btn = document.querySelector('#tab-plan-access .btn[onclick="loadPlanAccessDocs(true)"]');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Refreshing…'; }
  try {
    const res = await fetch(API + '/plan-access/config');
    if (!res.ok) { showToast('Refresh failed: server returned ' + res.status, 'error'); return; }
    const json = await res.json();
    paFilterDocs   = json.data.filterDocs        || [];
    paPlatformDoc  = json.data.platformAccessDoc || null;
    paLimitsDoc    = json.data.competitorLimitsDoc || null;
    renderPANewFeatureBanner(json.data.needsReviewFilters || []);
    paEditMode     = false;
    paEditSnapshot = { filters: {}, filterPlatforms: {}, platforms: [], limits: { brandLimit: 0, competitorLimit: 0 } };

    // Populate PA_PLAN_GROUPS and paDeletedPlanIds from MongoDB plan_groups doc
    const pgDoc = json.data.planGroupsDoc;
    if (pgDoc && pgDoc.groups) {
      PA_PLAN_GROUPS = pgDoc.groups;
      paDeletedPlanIds = pgDoc.deleted_plan_ids || [];
      // Initialise collapse state for any new groups; preserve existing user state
      const groupKeys = Object.keys(PA_PLAN_GROUPS);
      groupKeys.forEach((key, idx) => {
        if (!(key in paCollapsedGroups)) {
          paCollapsedGroups[key] = idx !== 0; // first group expanded, rest collapsed
        }
      });
      // Remove stale keys that no longer exist in MongoDB
      for (const key of Object.keys(paCollapsedGroups)) {
        if (!PA_PLAN_GROUPS[key]) delete paCollapsedGroups[key];
      }
    }

    // Default to Basic plan 2 on initial load
    if (!paSelectedPlan) {
      paSelectedPlan = 2;
    }
    renderPAGroups();
    renderPADetail(paSelectedPlan);
    if (showToastMsg) showToast('Plan access config refreshed', 'success');
  } catch (e) {
    console.error('Failed to load plan access config', e);
    if (showToastMsg) showToast('Refresh failed: ' + e.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 Refresh'; }
  }
}

function renderPAPlaceholder() {
  const nameEl = document.getElementById('pa-plan-name');
  const badgeEl = document.getElementById('pa-plan-group-badge');
  const platEl = document.getElementById('pa-platforms');
  const limEl = document.getElementById('pa-limits');
  const catTabsEl = document.getElementById('pa-cat-tabs');
  const tbody = document.getElementById('pa-filter-rows');
  const editBtn = document.getElementById('pa-edit-btn');
  const saveBtn = document.getElementById('pa-save-btn');

  if (nameEl) nameEl.textContent = 'Select a plan';
  if (badgeEl) badgeEl.textContent = '';
  if (platEl) platEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px">—</span>';
  if (limEl) limEl.innerHTML = '<span style="color:var(--text-muted);font-size:12px">—</span>';
  if (catTabsEl) catTabsEl.innerHTML = '<button class="btn btn-primary btn-sm pa-cat-btn" style="font-size:10px;padding:2px 8px" data-cat="all" onclick="paSwitchCat(\'all\')">All</button>';
  if (tbody) tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-muted)">Select a plan from the sidebar to view filter access</td></tr>';
  if (editBtn) editBtn.style.display = 'none';
  if (saveBtn) saveBtn.style.display = 'none';
}

function renderPAGroups() {
  const container = document.getElementById('pa-plan-groups');
  if (!container) return;
  let html = '';
  for (const [groupName, group] of Object.entries(PA_PLAN_GROUPS)) {
    if (groupName === 'Free') continue;
    const isCollapsed = paCollapsedGroups[groupName];
    html += `<div style="margin-bottom:12px">
      <div onclick="paToogleGroupCollapse('${groupName}')" style="cursor:pointer;display:flex;align-items:center;gap:6px;padding:4px 0;user-select:none">
        <span style="font-size:10px;color:${group.color};width:12px;text-align:center">${isCollapsed ? '▶' : '▼'}</span>
        <p style="font-size:9px;font-weight:700;color:${group.color};text-transform:uppercase;letter-spacing:.08em;margin:0;flex:1">${groupName}</p>
      </div>`;

    if (!isCollapsed) {
      // Active plans
      const activePlans = group.plans.filter(pid => !paDeletedPlanIds.some(d => d.plan_id === pid));
      for (const pid of activePlans) {
        const isSelected = paSelectedPlan === pid;
        html += `<div style="display:flex;align-items:center;gap:2px;margin-top:2px" class="pa-plan-row">
          <button onclick="paSelectPlan(${pid})" style="flex:1;text-align:left;padding:4px 8px;border-radius:5px;font-size:11px;font-family:var(--font-mono);cursor:pointer;border:none;
            background:${isSelected ? group.color : 'transparent'};
            color:${isSelected ? '#fff' : 'var(--text)'};
            font-weight:${isSelected ? '600' : '400'}">${pid}</button>
          ${currentRole === 'editor' ? `<button onclick="paDeletePlan(${pid},'${groupName}')" title="Soft-delete plan ${pid}" style="opacity:0;padding:2px 5px;border-radius:4px;border:none;background:transparent;color:#ef4444;cursor:pointer;font-size:11px;transition:opacity .15s" class="pa-del-btn">🗑</button>` : ''}
        </div>`;
      }

      // Deleted plans for this group
      const deletedInGroup = paDeletedPlanIds.filter(d => d.group === groupName);
      if (deletedInGroup.length > 0) {
        html += `<div style="margin-top:6px;padding-top:6px;border-top:1px solid var(--border)">
          <p style="font-size:9px;color:var(--text-muted);margin:0 0 4px 8px;letter-spacing:.05em">DELETED (${deletedInGroup.length})</p>`;
        for (const d of deletedInGroup) {
          const isSelected = paSelectedPlan === d.plan_id;
          html += `<div style="display:flex;align-items:center;gap:2px;margin-top:2px">
            <button onclick="paSelectPlan(${d.plan_id})" style="flex:1;text-align:left;padding:4px 8px;border-radius:5px;font-size:11px;font-family:var(--font-mono);cursor:pointer;border:none;
              background:${isSelected ? 'rgba(239,68,68,.2)' : 'transparent'};
              color:#ef4444;text-decoration:line-through;opacity:.7">${d.plan_id}</button>
            ${currentRole === 'editor' ? `<button onclick="paRestorePlan(${d.plan_id},'${groupName}')" title="Restore plan ${d.plan_id}" style="padding:2px 5px;border-radius:4px;border:none;background:transparent;color:#22c55e;cursor:pointer;font-size:11px">↩</button>` : ''}
          </div>`;
        }
        html += '</div>';
      }
    }
    html += '</div>';
  }
  container.innerHTML = html;

  // Show trash icon only on row hover
  container.querySelectorAll('.pa-plan-row').forEach(row => {
    const btn = row.querySelector('.pa-del-btn');
    if (!btn) return;
    row.addEventListener('mouseenter', () => { btn.style.opacity = '1'; });
    row.addEventListener('mouseleave', () => { btn.style.opacity = '0'; });
  });
}

function paToogleGroupCollapse(groupName) {
  const wasCollapsed = paCollapsedGroups[groupName];
  // Close all groups first (accordion behaviour)
  for (const key of Object.keys(paCollapsedGroups)) {
    paCollapsedGroups[key] = true;
  }
  // Toggle the clicked group — if it was open, leave it collapsed; if closed, expand it
  paCollapsedGroups[groupName] = !wasCollapsed;
  renderPAGroups();
}

function paSelectPlan(planId) {
  paSelectedPlan = planId;
  paEditMode = false;
  renderPAGroups();
  renderPADetail(planId);
}

async function paValidateNewId() {
  const newId = document.getElementById('pa-new-plan-id').value.trim();
  const statusEl = document.getElementById('pa-id-val-status');
  if (!newId) { statusEl.textContent = ''; return; }

  try {
    const res = await fetch(`${API}/plan-access/check-id/${newId}`);
    const json = await res.json();
    if (json.exists) {
      statusEl.textContent = '✕';
      statusEl.style.color = '#ef4444';
      statusEl.title = 'ID already exists in database';
    } else {
      statusEl.textContent = '✓';
      statusEl.style.color = '#22c55e';
      statusEl.title = 'ID available';
    }
  } catch (e) {
    console.warn('ID validation failed:', e);
  }
}

async function paAddNewPlan() {
  if (currentRole !== 'editor') {
    showToast('Edit access required to add plans', 'error');
    return;
  }
  const newIdRaw = document.getElementById('pa-new-plan-id').value;
  const newId = parseInt(newIdRaw);
  const group = document.getElementById('pa-new-plan-group').value;
  const statusEl = document.getElementById('pa-add-status');
  const valStatus = document.getElementById('pa-id-val-status');

  if (!newId || newId < 1) { statusEl.style.color = '#ef4444'; statusEl.textContent = 'Enter a valid plan ID'; return; }

  // Check if plan already exists in any group (UI side)
  for (const g of Object.values(PA_PLAN_GROUPS)) {
    if (g.plans.includes(newId)) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `Plan ${newId} already in sidebar`;
      return;
    }
  }

  // Server-side existence check
  try {
    const checkRes = await fetch(`${API}/plan-access/check-id/${newId}`);
    const checkJson = await checkRes.json();
    if (checkJson.exists) {
      statusEl.style.color = '#ef4444';
      statusEl.textContent = `Plan ${newId} already present in DB`;
      return;
    }
  } catch (e) {}

  // Pick a reference plan from same group to copy access from
  const groupPlans = PA_PLAN_GROUPS[group].plans;
  if (!groupPlans || !groupPlans.length) {
    statusEl.style.color = '#ef4444';
    statusEl.textContent = `No reference plan in group ${group}`;
    return;
  }
  const refPid = groupPlans[0];

  statusEl.style.color = 'var(--text-muted)';
  statusEl.textContent = 'Adding...';

  try {
    const res = await fetch(API + '/plan-access/add-plan', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ newPlanId: newId, refPlanId: refPid, group }),
    });
    const json = await res.json();
    if (!res.ok) { statusEl.style.color = '#ef4444'; statusEl.textContent = json.message || 'Failed'; return; }

    // Add to local PA_PLAN_GROUPS so sidebar updates immediately
    PA_PLAN_GROUPS[group].plans.push(newId);
    document.getElementById('pa-new-plan-id').value = '';
    valStatus.textContent = '';
    statusEl.style.color = '#22c55e';
    statusEl.textContent = `Plan ${newId} added to ${group}`;

    await loadPlanAccessDocs();
    paSelectPlan(newId);
  } catch (e) {
    statusEl.style.color = '#ef4444';
    statusEl.textContent = 'Error: ' + e.message;
  }
}

function paSwitchCat(cat) {
  // Flush current category checkboxes into snapshot before switching
  if (paEditMode) paFlushDomToSnapshot();
  paCatFilter = cat;
  document.querySelectorAll('.pa-cat-btn').forEach(b => {
    b.classList.toggle('btn-primary', b.dataset.cat === cat);
    b.classList.toggle('btn-ghost', b.dataset.cat !== cat);
  });
  if (paSelectedPlan) renderPAFilterRows(paSelectedPlan);
}

function renderPADetail(planId) {
  const pid = Number(planId);

  // Header
  let groupName = 'Unknown', groupColor = '#94a3b8';
  for (const [name, g] of Object.entries(PA_PLAN_GROUPS)) {
    if (g.plans.includes(pid)) { groupName = name; groupColor = g.color; break; }
  }
  const nameEl = document.getElementById('pa-plan-name');
  const badgeEl = document.getElementById('pa-plan-group-badge');
  if (nameEl) nameEl.textContent = 'Plan ' + pid;
  if (badgeEl) {
    badgeEl.textContent = groupName;
    badgeEl.style.background = groupColor + '22';
    badgeEl.style.color = groupColor;
    badgeEl.style.border = '1px solid ' + groupColor + '55';
  }

  // Deleted badge + restore button
  const isDeleted = paDeletedPlanIds.some(d => d.plan_id === pid);
  const deletedEntry = paDeletedPlanIds.find(d => d.plan_id === pid);
  let deletedBadgeEl = document.getElementById('pa-deleted-badge');
  let restoreBtnEl   = document.getElementById('pa-restore-btn');
  if (!deletedBadgeEl) {
    deletedBadgeEl = document.createElement('span');
    deletedBadgeEl.id = 'pa-deleted-badge';
    deletedBadgeEl.style.cssText = 'font-size:10px;padding:2px 8px;border-radius:99px;font-weight:600;margin-left:8px;background:rgba(239,68,68,.15);color:#ef4444;border:1px solid #ef444444';
    if (badgeEl) badgeEl.after(deletedBadgeEl);
  }
  if (!restoreBtnEl) {
    restoreBtnEl = document.createElement('button');
    restoreBtnEl.id = 'pa-restore-btn';
    restoreBtnEl.className = 'btn btn-ghost btn-sm';
    restoreBtnEl.style.cssText = 'color:#22c55e;border-color:#22c55e44';
    restoreBtnEl.textContent = '↩ Restore';
    const headerActions = document.querySelector('#tab-plan-access .btn[onclick="loadPlanAccessDocs()"]')?.parentElement;
    if (headerActions) headerActions.prepend(restoreBtnEl);
  }
  deletedBadgeEl.textContent  = isDeleted ? '● Deleted' : '';
  deletedBadgeEl.style.display = isDeleted ? '' : 'none';
  restoreBtnEl.style.display   = (isDeleted && currentRole === 'editor') ? '' : 'none';
  restoreBtnEl.onclick = () => paRestorePlan(pid, deletedEntry?.group);

  // Edit/Save buttons — hidden for deleted plans
  const editBtn = document.getElementById('pa-edit-btn');
  const saveBtn = document.getElementById('pa-save-btn');
  if (editBtn) {
    editBtn.style.display = (currentRole === 'editor' && !isDeleted) ? '' : 'none';
    editBtn.textContent = paEditMode ? '✕ Cancel' : '✏️ Edit';
  }
  if (saveBtn) {
    saveBtn.style.display = (paEditMode && currentRole === 'editor' && !isDeleted) ? '' : 'none';
  }

  // Platforms
  const platEl = document.getElementById('pa-platforms');
  if (platEl && paPlatformDoc && paPlatformDoc.platform_plans) {
    platEl.innerHTML = PA_PLATFORMS.map(p => {
      const allowed = (paPlatformDoc.platform_plans[p] || []).includes(pid);
      if (paEditMode) {
        return `<label style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600;cursor:pointer;
          background:var(--bg-secondary);border:1px solid var(--border);color:var(--text)">
          <input type="checkbox" id="pa-plat-cb-${p}" data-plat="${p}" ${allowed ? 'checked' : ''} style="cursor:pointer"> ${p}
        </label>`;
      }
      return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:99px;font-size:10px;font-weight:600;
        background:${allowed ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)'};
        color:${allowed ? '#22c55e' : '#ef4444'};
        border:1px solid ${allowed ? '#22c55e44' : '#ef444444'}">
        ${allowed ? '✓' : '✗'} ${p}
      </span>`;
    }).join('');
  }

  // Limits
  const limEl = document.getElementById('pa-limits');
  if (limEl && paLimitsDoc && paLimitsDoc.plan_limits) {
    const lim = paLimitsDoc.plan_limits[String(pid)] || { brandLimit: 0, competitorLimit: 0 };
    if (paEditMode) {
      limEl.innerHTML = `
        <div style="text-align:center;padding:8px 20px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border)">
          <input type="number" id="pa-edit-brand" value="${lim.brandLimit}" min="0" style="width:60px;font-size:16px;font-weight:700;text-align:center;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:2px;cursor:pointer">
          <p style="font-size:10px;color:var(--text-muted);margin:4px 0 0 0">Brand Limit</p>
        </div>
        <div style="text-align:center;padding:8px 20px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border)">
          <input type="number" id="pa-edit-comp" value="${lim.competitorLimit}" min="0" style="width:60px;font-size:16px;font-weight:700;text-align:center;background:var(--bg-secondary);border:1px solid var(--border);border-radius:4px;color:var(--text);padding:2px;cursor:pointer">
          <p style="font-size:10px;color:var(--text-muted);margin:4px 0 0 0">Competitor Limit</p>
        </div>`;
    } else {
      limEl.innerHTML = `
        <div style="text-align:center;padding:8px 20px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border)">
          <p style="font-size:18px;font-weight:700;color:var(--text)">${lim.brandLimit}</p>
          <p style="font-size:10px;color:var(--text-muted)">Brand Limit</p>
        </div>
        <div style="text-align:center;padding:8px 20px;background:var(--bg-secondary);border-radius:8px;border:1px solid var(--border)">
          <p style="font-size:18px;font-weight:700;color:var(--text)">${lim.competitorLimit}</p>
          <p style="font-size:10px;color:var(--text-muted)">Competitor Limit</p>
        </div>`;
    }
  }

  // Category tabs
  const cats = [...new Set(paFilterDocs.map(f => f.category).filter(Boolean))];
  const catTabsEl = document.getElementById('pa-cat-tabs');
  if (catTabsEl) {
    catTabsEl.innerHTML = `<button class="btn btn-primary btn-sm pa-cat-btn" style="font-size:10px;padding:2px 8px" data-cat="all" onclick="paSwitchCat('all')">All</button>` +
      cats.map(c => `<button class="btn btn-ghost btn-sm pa-cat-btn" style="font-size:10px;padding:2px 8px" data-cat="${c}" onclick="paSwitchCat('${c}')">${c.replace(/_/g,' ')}</button>`).join('');
  }

  renderPAFilterRows(planId);
}

function renderPAFilterRows(planId) {
  const pid = Number(planId);
  const tbody = document.getElementById('pa-filter-rows');
  if (!tbody) return;

  const filtered = (paCatFilter === 'all' ? paFilterDocs : paFilterDocs.filter(f => f.category === paCatFilter))
    .sort((a, b) => {
      const aPri = a.needs_review ? 2 : a.is_new ? 1 : 0;
      const bPri = b.needs_review ? 2 : b.is_new ? 1 : 0;
      if (bPri !== aPri) return bPri - aPri;
      return (a.label || a._id || '').localeCompare(b.label || b._id || '');
    });

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="padding:20px;text-align:center;color:var(--text-muted)">No filters in this category</td></tr>';
    return;
  }

  tbody.innerHTML = filtered.map(f => {
    // In edit mode use snapshot so category switches don't reset unsaved changes
    // Match planAccessService.js semantics: null/undefined = allow all; [] = deny all; [ids] = check list
    const allowed = paEditMode
      ? (paEditSnapshot.filters[f._id] !== undefined ? paEditSnapshot.filters[f._id] : (!f.allowed_plan_ids || (f.allowed_plan_ids.length > 0 && f.allowed_plan_ids.includes(pid))))
      : (!f.allowed_plan_ids || (f.allowed_plan_ids.length > 0 && f.allowed_plan_ids.includes(pid)));
    const catColor = PA_CAT_COLORS[f.category] || '#6b7280';

    // Show all 11 platforms — green if supported, dim if not; clickable in edit mode
    const platCells = PA_PLATFORMS.map(p => {
      // snapshotPlats is the in-memory edit state for this filter's platforms.
      // undefined = filter not in snapshot yet (fall back to MongoDB).
      // {} = all allowed (admin reset via "Allowed" checkbox — missing key means unrestricted).
      // { youtube: false } = youtube restricted, others unrestricted.
      const snapshotPlats = paEditMode && paEditSnapshot.filterPlatforms
        ? paEditSnapshot.filterPlatforms[f._id]
        : undefined;
      const platEnabled = paEditMode
        ? (snapshotPlats !== undefined
            ? snapshotPlats[p] !== false          // in snapshot: false=restricted, missing/true=allowed
            : (f.platform_support || {})[p] !== false)  // not in snapshot: read from MongoDB doc
        : (f.platform_support || {})[p] !== false;
      // If filter is restricted for this plan, don't highlight any platform pill
      const supported = allowed && platEnabled;
      const baseStyle = `font-size:9px;padding:2px 6px;border-radius:4px;font-weight:600;transition:all .15s;
        background:${supported ? 'rgba(34,197,94,.15)' : 'rgba(100,100,100,.1)'};
        color:${supported ? '#22c55e' : 'var(--text-muted)'};border:1px solid ${supported ? 'rgba(34,197,94,.3)' : 'transparent'};`;
      if (paEditMode) {
        return `<span data-filter-plat="${f._id}:${p}" onclick="paToggleFilterPlat(this,'${f._id}','${p}')"
          style="${baseStyle}cursor:pointer;" title="${p}">${PA_PLAT_LABEL[p]||p}</span>`;
      }
      return `<span style="${baseStyle}" title="${p}">${PA_PLAT_LABEL[p]||p}</span>`;
    }).join('');

    return `<tr data-needs-review="${f.needs_review ? 'true' : 'false'}" style="border-bottom:1px solid var(--border);transition:background .1s${f.needs_review ? ';border-left:2px solid rgba(245,158,11,0.6)' : ''}" onmouseenter="this.style.background='var(--bg-secondary)'" onmouseleave="this.style.background=''">
      <td style="padding:7px 8px;font-weight:500">
        ${f.label || f._id}
        ${f.needs_review ? '<span style="font-size:8px;font-weight:700;background:rgba(245,158,11,0.15);color:#fbbf24;border:1px solid rgba(245,158,11,0.35);padding:1px 5px;border-radius:3px;margin-left:6px;vertical-align:middle">REVIEW</span>' : f.is_new ? '<span style="font-size:8px;font-weight:700;background:rgba(59,130,246,0.15);color:#60a5fa;border:1px solid rgba(59,130,246,0.3);padding:1px 5px;border-radius:3px;margin-left:6px;vertical-align:middle">NEW</span>' : ''}
      </td>
      <td style="padding:7px 8px">
        <span style="font-size:9px;padding:1px 6px;border-radius:4px;font-weight:600;background:${catColor}22;color:${catColor}">${f.category || '—'}</span>
      </td>
      <td style="padding:7px 8px"><div style="display:flex;flex-wrap:wrap;gap:3px">${platCells}</div></td>
      <td style="padding:7px 8px;text-align:center">
        <span id="pa-filter-status-${f._id}" style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:600;padding:2px 8px;border-radius:99px;
          background:${allowed ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)'};
          color:${allowed ? '#22c55e' : '#ef4444'}">
          ${allowed ? '✓ Allowed' : '✗ Restricted'}
        </span>
      </td>
      <td style="padding:7px 8px;text-align:center;display:${paEditMode ? 'table-cell' : 'none'}">
        <input type="checkbox" id="pa-filter-cb-${f._id}" data-filter="${f._id}" ${allowed ? 'checked' : ''} onchange="paFilterAllowedChanged(this,'${f._id}')" style="width:14px;height:14px;cursor:pointer">
      </td>
    </tr>`;
  }).join('');
}

function paToggleEditMode() {
  paEditMode = !paEditMode;
  const editBtn = document.getElementById('pa-edit-btn');
  const saveBtn = document.getElementById('pa-save-btn');
  if (editBtn) editBtn.textContent = paEditMode ? '✕ Cancel' : '✏️ Edit';
  if (saveBtn) saveBtn.style.display = paEditMode ? '' : 'none';
  renderPADetail(paSelectedPlan);
}

// Called when admin checks/unchecks the "Allowed" checkbox for a filter.
// Checking → reset platform_support to all-allowed ({}) so the next save clears old restrictions.
// Unchecking → no platform change needed (restriction is enforced via allowed_plan_ids).
function paFilterAllowedChanged(el, filterId) {
  paEditSnapshot.filters[filterId] = el.checked;

  if (el.checked) {
    // Reset platform_support to all-allowed: {} means no restrictions (missing key = unrestricted).
    if (!paEditSnapshot.filterPlatforms) paEditSnapshot.filterPlatforms = {};
    paEditSnapshot.filterPlatforms[filterId] = {};
    paExplicitlyChangedPlatforms.add(filterId);
  }

  // Re-render so the corrected platEnabled logic picks up the snapshot change.
  renderPADetail(paSelectedPlan);
}

// Toggle a filter's platform support when admin clicks a platform pill in edit mode
function paToggleFilterPlat(el, filterId, plat) {
  if (!paEditSnapshot.filterPlatforms) paEditSnapshot.filterPlatforms = {};
  if (!paEditSnapshot.filterPlatforms[filterId]) {
    // seed from current doc
    const doc = paFilterDocs.find(f => f._id === filterId);
    paEditSnapshot.filterPlatforms[filterId] = Object.assign({}, doc ? doc.platform_support : {});
  }
  const cur = paEditSnapshot.filterPlatforms[filterId][plat] !== false;
  paEditSnapshot.filterPlatforms[filterId][plat] = !cur;
  paExplicitlyChangedPlatforms.add(filterId);
  // Update pill appearance immediately without full re-render
  const now = !cur;
  el.style.background = now ? 'rgba(34,197,94,.15)' : 'rgba(100,100,100,.1)';
  el.style.color       = now ? '#22c55e' : 'var(--text-muted)';
  el.style.border      = now ? '1px solid rgba(34,197,94,.3)' : '1px solid transparent';

  // Auto-toggle "Allowed" checkbox + badge when all platforms are on or all are off
  const platMap = paEditSnapshot.filterPlatforms[filterId];
  const allOn  = PA_PLATFORMS.every(p => platMap[p] !== false);
  const allOff = PA_PLATFORMS.every(p => platMap[p] === false);
  if (allOn || allOff) {
    const isAllowed = allOn;
    paEditSnapshot.filters[filterId] = isAllowed;
    const cb = document.getElementById('pa-filter-cb-' + filterId);
    if (cb) cb.checked = isAllowed;
    const badge = document.getElementById('pa-filter-status-' + filterId);
    if (badge) {
      badge.textContent  = isAllowed ? '✓ Allowed' : '✗ Restricted';
      badge.style.background = isAllowed ? 'rgba(34,197,94,.12)' : 'rgba(239,68,68,.1)';
      badge.style.color      = isAllowed ? '#22c55e' : '#ef4444';
    }
  }
}

function renderPANewFeatureBanner(needsReviewFilters) {
  const strip = document.getElementById('pa-review-strip');
  const badge = document.getElementById('pa-review-badge');
  const count = needsReviewFilters.length;
  if (!count) {
    if (strip) strip.style.display = 'none';
    if (badge) { badge.style.display = 'none'; badge.textContent = ''; }
    return;
  }
  const names = needsReviewFilters.map(f => f.label || f._id).join(', ');
  const textEl = document.getElementById('pa-review-strip-text');
  if (textEl) textEl.textContent = `${count} new feature${count > 1 ? 's' : ''} auto-assigned to Palladium — review plan access: ${names}`;
  if (strip) strip.style.display = 'flex';
  if (badge) { badge.style.display = 'inline-block'; badge.textContent = count; }
}

function paGoToReview() {
  switchTab('plan-access');
  setTimeout(() => {
    const firstReview = document.querySelector('tr[data-needs-review="true"]');
    if (firstReview) firstReview.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, 150);
}

function paDismissReviewStrip() {
  const strip = document.getElementById('pa-review-strip');
  if (strip) strip.style.display = 'none';
}

async function paSavePlanAccess() {
  const pid = paSelectedPlan;
  if (!pid) return;

  // Collect platform checkboxes
  const platforms = Array.from(document.querySelectorAll('#pa-platforms input[type=checkbox]'))
    .filter(cb => cb.checked).map(cb => cb.dataset.plat);

  // Collect limits
  const brandLimit = parseInt(document.getElementById('pa-edit-brand')?.value || 0);
  const competitorLimit = parseInt(document.getElementById('pa-edit-comp')?.value || 0);

  // Collect filter toggles
  const filters = {};
  document.querySelectorAll('#pa-filter-rows input[type=checkbox]').forEach(cb => {
    filters[cb.dataset.filter] = cb.checked;
  });

  // Only send platform_support for filters where the admin explicitly toggled a platform pill.
  // Omitting a filter here means its platform_support in MongoDB stays untouched.
  const changedFilterPlatforms = {};
  for (const fid of paExplicitlyChangedPlatforms) {
    if (paEditSnapshot.filterPlatforms[fid]) changedFilterPlatforms[fid] = paEditSnapshot.filterPlatforms[fid];
  }

  try {
    const res = await fetch(API + '/plan-access/config', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ planId: pid, platforms, limits: { brandLimit, competitorLimit }, filters, filterPlatforms: changedFilterPlatforms }),
    });
    const json = await res.json();
    if (res.ok) {
      paEditMode = false;
      await loadPlanAccessDocs();
      paSelectedPlan = pid;
      renderPADetail(pid);
      showToast('Plan access saved', 'success');
    } else {
      showToast('Save failed: ' + json.message, 'error');
    }
  } catch (e) {
    showToast('Save failed: ' + e.message, 'error');
  }
}

// [DEPRECATED 2026-04-01] Old filter-centric render functions removed.
// Plan access is now plan-centric view with edit capability.

// function filterPACategory(cat) { ... }
// function renderPADocs() {
// [DEPRECATED 2026-04-01] Old savePADoc, deletePADoc, invalidatePACache removed.
// Plan access now saves via API to plan_config.json
// async function savePADoc() { ... }
// async function deletePADoc(id) { ... }
// async function invalidatePACache() { ... }

// ── Edit / Save ────────────────────────────────────────────────────────────────

let paEditMode = false;
let paEditSnapshot = { filters: {}, platforms: [], limits: { brandLimit: 0, competitorLimit: 0 } };
// Tracks which filters had platform pills explicitly toggled by the admin in this edit session.
// Only these filters get their platform_support sent on save — others keep whatever is in MongoDB.
let paExplicitlyChangedPlatforms = new Set();

// Flush current DOM checkbox states into the in-memory snapshot.
// Called before each category switch so no changes are lost when rows re-render.
function paFlushDomToSnapshot() {
  paFilterDocs.forEach(f => {
    const cb = document.getElementById('pa-filter-cb-' + f._id);
    if (cb) paEditSnapshot.filters[f._id] = cb.checked;
  });
  paEditSnapshot.platforms = PA_PLATFORMS.filter(p => {
    const cb = document.getElementById('pa-plat-cb-' + p);
    return cb && cb.checked;
  });
}

function paToggleEdit() {
  if (!paSelectedPlan) {
    document.getElementById('pa-save-status').textContent = 'Select a plan first';
    return;
  }
  const pid = Number(paSelectedPlan);

  // Snapshot current data state for ALL filters (all categories) up-front
  paEditSnapshot.filters = {};
  paEditSnapshot.filterPlatforms = {};
  paExplicitlyChangedPlatforms = new Set(); // reset — only track pills clicked in this session
  paFilterDocs.forEach(f => {
    // Match planAccessService.js semantics: null/undefined = allow all; [] = deny all; [ids] = check list
    const allowed = !f.allowed_plan_ids || (f.allowed_plan_ids.length > 0 && f.allowed_plan_ids.includes(pid));
    paEditSnapshot.filters[f._id] = allowed;
    paEditSnapshot.filterPlatforms[f._id] = Object.assign({}, f.platform_support || {});
  });
  paEditSnapshot.platforms = paPlatformDoc
    ? PA_PLATFORMS.filter(p => (paPlatformDoc.platform_plans[p] || []).includes(pid))
    : [];
  const lim = paLimitsDoc && paLimitsDoc.plan_limits ? (paLimitsDoc.plan_limits[String(pid)] || { brandLimit: 0, competitorLimit: 0 }) : { brandLimit: 0, competitorLimit: 0 };
  paEditSnapshot.limits = { brandLimit: lim.brandLimit, competitorLimit: lim.competitorLimit };

  paEditMode = true;
  document.getElementById('pa-edit-btn').style.display   = 'none';
  document.getElementById('pa-save-btn').style.display   = '';
  document.getElementById('pa-cancel-btn').style.display = '';
  document.getElementById('pa-th-toggle').style.display  = '';
  document.getElementById('pa-save-status').textContent  = 'Edit mode — changes not saved yet';
  document.getElementById('pa-limits').style.display      = 'none';
  document.getElementById('pa-limits-edit').style.display = 'flex';
  document.getElementById('pa-brand-limit').value      = lim.brandLimit;
  document.getElementById('pa-competitor-limit').value = lim.competitorLimit;
  renderPADetail(paSelectedPlan);
}

function paCancelEdit() {
  paEditMode = false;
  paEditSnapshot = { filters: {}, filterPlatforms: {}, platforms: [], limits: { brandLimit: 0, competitorLimit: 0 } };
  paExplicitlyChangedPlatforms = new Set();
  document.getElementById('pa-edit-btn').style.display   = '';
  document.getElementById('pa-save-btn').style.display   = 'none';
  document.getElementById('pa-cancel-btn').style.display = 'none';
  document.getElementById('pa-th-toggle').style.display  = 'none';
  document.getElementById('pa-save-status').textContent  = '';
  document.getElementById('pa-limits').style.display      = 'flex';
  document.getElementById('pa-limits-edit').style.display = 'none';
  if (paSelectedPlan) renderPADetail(paSelectedPlan);
}

async function paSave() {
  if (!paSelectedPlan) return;
  const pid = Number(paSelectedPlan);

  // Flush any visible DOM checkboxes into snapshot before sending
  paFlushDomToSnapshot();

  // Read limits from inputs
  paEditSnapshot.limits = {
    brandLimit:      Number(document.getElementById('pa-brand-limit').value)      || 0,
    competitorLimit: Number(document.getElementById('pa-competitor-limit').value) || 0,
  };

  const statusEl = document.getElementById('pa-save-status');
  statusEl.textContent = 'Saving...';

  try {
    const token = typeof getAdminToken === 'function' ? getAdminToken() : (localStorage.getItem('adminToken') || '');
    const res = await fetch(API + '/plan-access/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
      body: JSON.stringify({ planId: pid, platforms: paEditSnapshot.platforms, limits: paEditSnapshot.limits, filters: paEditSnapshot.filters }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.message || 'Save failed');
    statusEl.textContent = '✓ Saved';
    await loadPlanAccessDocs();
    paCancelEdit();
  } catch (e) {
    statusEl.textContent = '✗ ' + e.message;
  }
}

async function paDeletePlan(planId, group) {
  if (!confirm(`Soft-delete plan ${planId}?\n\nUsers on this plan will immediately lose all access.\nThe plan mapping is preserved and can be restored anytime.`)) return;
  try {
    const res = await fetch(`${API}/plan-access/plan/${planId}`, { method: 'DELETE', credentials: 'include' });
    const json = await res.json();
    if (!res.ok) { showToast(json.message || 'Delete failed', 'error'); return; }
    showToast(json.message, 'success');
    await loadPlanAccessDocs();
    if (paSelectedPlan === planId) renderPADetail(planId);
  } catch (e) {
    showToast('Delete failed: ' + e.message, 'error');
  }
}

async function paRestorePlan(planId, group) {
  try {
    const res = await fetch(`${API}/plan-access/restore-plan/${planId}`, { method: 'POST', credentials: 'include' });
    const json = await res.json();
    if (!res.ok) { showToast(json.message || 'Restore failed', 'error'); return; }
    showToast(json.message, 'success');
    await loadPlanAccessDocs();
    if (paSelectedPlan === planId) renderPADetail(planId);
  } catch (e) {
    showToast('Restore failed: ' + e.message, 'error');
  }
}

// Expose to window for inline onclick handlers
window.loadPlanAccessDocs        = loadPlanAccessDocs;
window.paSelectPlan              = paSelectPlan;
window.paSwitchCat               = paSwitchCat;
window.paToggleEdit              = paToggleEdit;
window.paCancelEdit              = paCancelEdit;
window.paSave                    = paSave;
window.paFlushDomToSnapshot      = paFlushDomToSnapshot;
window.paToggleFilterPlat        = paToggleFilterPlat;
window.paFilterAllowedChanged    = paFilterAllowedChanged;
window.paDeletePlan              = paDeletePlan;
window.paRestorePlan             = paRestorePlan;
