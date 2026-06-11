'use strict';

// Admin HTML panel (ported from Go SDUI-Backend)
// Login endpoint: /api/admin/sdui-login | Logout: /api/admin/sdui-logout
const adminHTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SDUI Admin · PowerAdSpy</title>
<script src="https://cdn.tailwindcss.com"></script>
<style>
  *{box-sizing:border-box}
  body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
  .form-input{width:100%;padding:.5rem .75rem;border:1px solid #e2e8f0;border-radius:.5rem;font-size:.875rem;line-height:1.5;outline:none;transition:border-color .15s,box-shadow .15s;background:#fff}
  .form-input:focus{border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.15)}
  .form-input.err{border-color:#ef4444;box-shadow:0 0 0 3px rgba(239,68,68,.12)}
  .form-input.ok{border-color:#10b981}
  select.form-input{cursor:pointer}
  textarea.form-input{resize:vertical;min-height:80px}
  .label{display:block;font-size:.8125rem;font-weight:500;color:#475569;margin-bottom:.375rem}
  .err-msg{font-size:.75rem;color:#ef4444;margin-top:.25rem}
  .badge{display:inline-flex;align-items:center;padding:.125rem .5rem;border-radius:9999px;font-size:.6875rem;font-weight:600}
  .tab-pill{padding:.5rem 1rem;font-size:.875rem;font-weight:500;border-bottom:2px solid transparent;color:#64748b;cursor:pointer;transition:color .15s,border-color .15s;white-space:nowrap}
  .tab-pill.active{color:#6366f1;border-bottom-color:#6366f1}
  .modal-tab{padding:.5rem 1rem;font-size:.8125rem;font-weight:500;border-radius:.5rem;color:#64748b;cursor:pointer;transition:background .15s,color .15s}
  .modal-tab.active{background:#6366f1;color:#fff}
  .acc-header{display:flex;align-items:center;gap:.75rem;padding:.875rem 1rem;cursor:pointer;user-select:none;background:#f8fafc;border:1px solid #e2e8f0;border-radius:.75rem;transition:background .15s}
  .acc-header:hover{background:#f1f5f9}
  .acc-body{display:none;padding:1rem;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 .75rem .75rem;background:#fff}
  .acc-body.open{display:block}
  .opt-row{display:grid;grid-template-columns:1fr 1fr 1fr 60px auto auto auto;gap:.5rem;align-items:start}
  .opt-row-icon{display:grid;grid-template-columns:1fr 1fr 1fr 60px 1fr auto auto;gap:.5rem;align-items:start}
  .opt-pa-wrap{display:flex;flex-wrap:wrap;gap:2px;max-width:260px}
  .opt-pa-chip{display:inline-block;padding:1px 5px;border-radius:4px;font-size:.6rem;font-weight:600;cursor:pointer;border:1px solid;transition:all .12s;line-height:1.4;user-select:none}
  .opt-pa-chip.sel{background:#eef2ff;border-color:#818cf8;color:#4f46e5}
  .opt-pa-chip.unsel{background:#f8fafc;border-color:#e2e8f0;color:#cbd5e1}
  .type-badge{padding:.125rem .5rem;border-radius:.375rem;font-size:.7rem;font-weight:600;letter-spacing:.025em}
  .btn{display:inline-flex;align-items:center;gap:.375rem;padding:.5rem 1rem;border-radius:.5rem;font-size:.875rem;font-weight:500;cursor:pointer;transition:background .15s,color .15s,opacity .15s;border:none;outline:none}
  .btn:disabled{opacity:.5;cursor:not-allowed}
  .btn-primary{background:#6366f1;color:#fff}.btn-primary:hover:not(:disabled){background:#4f46e5}
  .btn-ghost{background:transparent;color:#64748b;border:1px solid #e2e8f0}.btn-ghost:hover{background:#f1f5f9}
  .btn-danger{background:#fef2f2;color:#ef4444;border:1px solid #fecaca}.btn-danger:hover{background:#fee2e2}
  .btn-sm{padding:.375rem .625rem;font-size:.8125rem}
  .btn-icon{padding:.375rem;border-radius:.5rem;background:transparent;border:none;cursor:pointer;color:#94a3b8;transition:color .15s,background .15s}
  .btn-icon:hover{background:#f1f5f9;color:#6366f1}
  .btn-icon.danger:hover{background:#fef2f2;color:#ef4444}
  .toast{padding:.75rem 1rem;border-radius:.75rem;font-size:.875rem;font-weight:500;color:#fff;box-shadow:0 4px 12px rgba(0,0,0,.15);animation:slideUp .25s ease}
  @keyframes slideUp{from{transform:translateY(1rem);opacity:0}to{transform:translateY(0);opacity:1}}
  .platform-chip{display:inline-flex;align-items:center;gap:.25rem;padding:.25rem .5rem;border-radius:.375rem;font-size:.75rem;font-weight:500;cursor:pointer;border:1px solid;transition:all .15s}
  .platform-chip.sel{background:#eef2ff;border-color:#818cf8;color:#4f46e5}
  .platform-chip.unsel{background:#f8fafc;border-color:#e2e8f0;color:#94a3b8}
  .spinner{display:inline-block;width:1rem;height:1rem;border:2px solid rgba(255,255,255,.3);border-top-color:#fff;border-radius:50%;animation:spin .6s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
  .line-clamp-2{overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
</style>
</head>
<body class="bg-slate-50 min-h-screen">

<!-- ═══════════════════════ LOGIN ═══════════════════════ -->
<div id="loginScreen" class="min-h-screen bg-gradient-to-br from-slate-900 to-indigo-950 flex items-center justify-center p-4">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-8">
    <div class="text-center mb-8">
      <div class="w-14 h-14 bg-indigo-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
        <svg class="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>
      </div>
      <h1 class="text-xl font-bold text-slate-900">SDUI Admin</h1>
      <p class="text-sm text-slate-500 mt-1">PowerAdSpy · Filter Configuration</p>
    </div>
    <div class="space-y-4">
      <div>
        <label class="label" for="passkeyInput">Admin Passkey</label>
        <input type="password" id="passkeyInput" class="form-input" placeholder="Enter passkey..." autocomplete="current-password">
        <p id="loginError" class="err-msg hidden">Incorrect passkey. Please try again.</p>
      </div>
      <button id="loginBtn" class="btn btn-primary w-full justify-center">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg>
        Sign In
      </button>
    </div>
  </div>
</div>

<!-- ═══════════════════════ APP ═══════════════════════ -->
<div id="app" class="hidden flex flex-col" style="height:100vh">

  <!-- Header -->
  <header class="bg-slate-900 text-white h-14 flex items-center px-6 gap-4 shrink-0 shadow-lg">
    <div class="w-8 h-8 bg-indigo-500 rounded-lg flex items-center justify-center">
      <svg class="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"/></svg>
    </div>
    <span class="font-semibold text-sm">SDUI Admin</span>
    <span class="text-slate-500 text-xs">PowerAdSpy</span>
    <div class="flex-1"></div>
    <span id="headerDocCount" class="text-slate-400 text-xs mr-2"></span>
    <button id="logoutBtn" class="btn btn-ghost btn-sm text-slate-300 border-slate-700 hover:border-slate-500">
      <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"/></svg>
      Logout
    </button>
  </header>

  <!-- Tab bar -->
  <div class="bg-white border-b border-slate-200 px-6 flex gap-1 shrink-0">
    <button class="tab-pill active" data-tab="navbar">Navbar <span id="cnt-navbar" class="ml-1 text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5"></span></button>
    <button class="tab-pill" data-tab="sidebar">Sidebar <span id="cnt-sidebar" class="ml-1 text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5"></span></button>
    <button class="tab-pill" data-tab="searchbar">Searchbar <span id="cnt-searchbar" class="ml-1 text-xs bg-slate-100 text-slate-500 rounded-full px-1.5 py-0.5"></span></button>
  </div>

  <!-- Content -->
  <main class="flex-1 overflow-auto p-6">
    <div id="loadingState" class="flex items-center justify-center h-40 text-slate-400 text-sm gap-2">
      <div class="w-5 h-5 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin"></div>
      Loading...
    </div>
    <div id="docsGrid" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 hidden"></div>
  </main>
</div>

<!-- ═══════════════════════ EDIT MODAL ═══════════════════════ -->
<div id="editModal" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" style="backdrop-filter:blur(4px)">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-4xl flex flex-col" style="max-height:92vh">

    <!-- Modal header -->
    <div class="flex items-center gap-3 px-6 py-4 border-b border-slate-200 shrink-0">
      <div id="modalDocBadge" class="badge"></div>
      <div class="flex-1">
        <h2 id="modalTitle" class="font-semibold text-slate-900 text-sm"></h2>
        <p id="modalSubtitle" class="text-xs text-slate-400 font-mono"></p>
      </div>
      <button id="closeModal" class="btn-icon">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
    </div>

    <!-- Modal tabs -->
    <div class="flex gap-1 px-6 py-3 border-b border-slate-100 shrink-0">
      <button class="modal-tab active" data-mtab="document">Document</button>
      <button class="modal-tab" data-mtab="filters">Filters</button>
      <button class="modal-tab" data-mtab="json">JSON</button>
    </div>

    <!-- Modal body (scrollable) -->
    <div id="modalBody" class="flex-1 overflow-auto p-6"></div>

    <!-- Modal footer -->
    <div class="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl shrink-0">
      <div class="flex items-center gap-2">
        <button id="rollbackEdit" class="btn btn-ghost text-orange-600 hover:bg-orange-50 border-orange-200" title="Discard ALL edits and restore the original values">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 10h10a5 5 0 010 10H9m-6-10l4-4m-4 4l4 4"/></svg>
          Rollback All Edits
        </button>
        <p id="modalErrSummary" class="text-xs text-red-500 hidden">Please fix the errors above before saving.</p>
      </div>
      <div class="flex gap-2">
        <button id="cancelEdit" class="btn btn-ghost">Cancel</button>
        <button id="saveEdit" class="btn btn-primary">
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
          Review &amp; Submit
        </button>
      </div>
    </div>
  </div>
</div>

<!-- ═══════════════════════ DELETE CONFIRM ═══════════════════════ -->
<div id="deleteModal" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" style="backdrop-filter:blur(4px)">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-center">
    <div class="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
      <svg class="w-6 h-6 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg>
    </div>
    <h3 class="font-semibold text-slate-900 mb-1">Delete document?</h3>
    <p id="deleteDocLabel" class="text-sm text-slate-500 mb-5 font-mono"></p>
    <div class="flex gap-2 justify-center">
      <button id="cancelDelete" class="btn btn-ghost flex-1">Cancel</button>
      <button id="confirmDelete" class="btn btn-danger flex-1">Delete</button>
    </div>
  </div>
</div>

<!-- ═══════════════════════ REVIEW & CONFIRM SUBMIT ═══════════════════════ -->
<div id="reviewModal" class="hidden fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" style="backdrop-filter:blur(4px)">
  <div class="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col" style="max-height:80vh">
    <div class="flex items-center gap-3 px-6 py-4 border-b border-slate-200">
      <div class="w-10 h-10 bg-amber-100 rounded-full flex items-center justify-center">
        <svg class="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      </div>
      <div class="flex-1">
        <h3 class="font-semibold text-slate-900 text-sm">Review Changes Before Saving</h3>
        <p class="text-xs text-slate-400">Please verify the changes below are correct.</p>
      </div>
    </div>
    <div id="reviewBody" class="flex-1 overflow-auto p-6 text-sm"></div>
    <div class="flex items-center justify-between px-6 py-4 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
      <button id="cancelReview" class="btn btn-ghost">Go Back &amp; Edit</button>
      <button id="confirmSave" class="btn btn-primary bg-emerald-600 hover:bg-emerald-700">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>
        Confirm &amp; Save
      </button>
    </div>
  </div>
</div>

<!-- Toast container -->
<div id="toastContainer" class="fixed bottom-5 right-5 z-[100] flex flex-col gap-2"></div>

<!-- ════════════════════════ JAVASCRIPT ════════════════════════ -->
<script>
// ── helpers ──────────────────────────────────────────────────────────────────
var $ = function(id){ return document.getElementById(id); };
function esc(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }
function deep(o){ return JSON.parse(JSON.stringify(o)); }
function show(el){ el.classList.remove('hidden'); }
function hide(el){ el.classList.add('hidden'); }
function isset(v){ return v !== null && v !== undefined && String(v).trim() !== ''; }

// ── constants ─────────────────────────────────────────────────────────────────
var FILTER_TYPES = [
  'icon_toggle','checkbox','radio','segmented_control',
  'dropdown_single','dropdown_multi','chip_multi_select','nested_select',
  'range_slider','date_preset','date_range_custom',
  'toggle_switch','text_input','autocomplete','combobox','number_stepper'
];
var DISPLAY_MODES = ['input','tab_toggle','icon_pill','dropdown','accordion','inline'];
var ICON_TYPES    = ['svg','url','none'];
var CONFIG_TYPES  = ['searchbar','navbar','sidebar'];
var PLATFORMS     = ['facebook','instagram','youtube','google','gdn','native','linkedin','reddit','quora','pinterest','tiktok'];
var TYPES_WITH_OPTS = ['icon_toggle','checkbox','radio','segmented_control','dropdown_single','dropdown_multi','chip_multi_select','nested_select','date_preset','combobox'];
var RANGE_TYPES   = ['range_slider'];
var INPUT_TYPES   = ['text_input','autocomplete'];
var DATE_RANGE_T  = ['date_range_custom'];
var TYPE_COLORS   = {
  searchbar:'bg-purple-100 text-purple-700', navbar:'bg-blue-100 text-blue-700',
  sidebar:'bg-orange-100 text-orange-700'
};
var MODE_COLORS = {
  accordion:'bg-slate-100 text-slate-600', dropdown:'bg-cyan-100 text-cyan-700',
  icon_pill:'bg-teal-100 text-teal-700', input:'bg-indigo-100 text-indigo-700',
  tab_toggle:'bg-pink-100 text-pink-700', inline:'bg-yellow-100 text-yellow-700'
};

// ── state ─────────────────────────────────────────────────────────────────────
var S = {
  token: localStorage.getItem('sdui_admin_tok') || '',
  docs: [],
  tab: 'navbar',
  edit: null,        // deep copy of doc being edited
  editOriginal: null, // pristine snapshot for rollback & diff
  editMTab: 'document',
  deleteId: null,
  saving: false
};

// ── API layer ─────────────────────────────────────────────────────────────────
function apiFetch(method, path, body){
  return fetch('/api/admin/' + path, {
    method: method,
    headers: {'Content-Type':'application/json','Authorization':'Bearer '+S.token},
    body: body ? JSON.stringify(body) : undefined
  }).then(function(r){
    if(r.status === 401){ doLogout(); return null; }
    if(!r.ok) return r.text().then(function(t){ throw new Error(t||'Request failed'); });
    return r.json();
  });
}

// ── toast ─────────────────────────────────────────────────────────────────────
function toast(msg, type){
  type = type || 'success';
  var el = document.createElement('div');
  el.className = 'toast ' + (type==='success' ? 'bg-emerald-500' : type==='info' ? 'bg-blue-500' : type==='warn' ? 'bg-amber-500' : 'bg-red-500');
  el.textContent = msg;
  $('toastContainer').appendChild(el);
  setTimeout(function(){ el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(function(){ el.remove(); }, 300); }, 3200);
}

// ── auth ──────────────────────────────────────────────────────────────────────
function doLogin(){
  var pk = $('passkeyInput').value.trim();
  if(!pk){ $('passkeyInput').classList.add('err'); return; }
  var btn = $('loginBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Signing in...';
  fetch('/api/admin/sdui-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({passkey:pk})})
    .then(function(r){ return r.json().then(function(d){ return {ok:r.ok,d:d}; }); })
    .then(function(res){
      if(!res.ok){ show($('loginError')); $('passkeyInput').classList.add('err'); }
      else {
        S.token = res.d.token;
        localStorage.setItem('sdui_admin_tok', S.token);
        showApp();
      }
    }).catch(function(){ show($('loginError')); })
    .finally(function(){ btn.disabled=false; btn.innerHTML='<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"/></svg> Sign In'; });
}

function doLogout(){
  apiFetch('POST','sdui-logout').catch(function(){});
  S.token = '';
  localStorage.removeItem('sdui_admin_tok');
  hide($('app'));
  show($('loginScreen'));
  $('passkeyInput').value='';
  hide($('loginError'));
}

// ── app bootstrap ─────────────────────────────────────────────────────────────
function showApp(){
  hide($('loginScreen'));
  show($('app'));
  loadDocs();
}

function loadDocs(){
  show($('loadingState'));
  hide($('docsGrid'));
  apiFetch('GET','sdui').then(function(data){
    S.docs = data || [];
    updateCounts();
    renderGrid();
    hide($('loadingState'));
    show($('docsGrid'));
    $('headerDocCount').textContent = S.docs.length + ' documents';
  }).catch(function(e){ toast('Failed to load: '+e.message,'error'); });
}

function updateCounts(){
  ['navbar','sidebar','searchbar'].forEach(function(t){
    var n = S.docs.filter(function(d){ return d.config_type===t; }).length;
    $('cnt-'+t).textContent = n;
  });
}

// ── tab switching ─────────────────────────────────────────────────────────────
document.querySelectorAll('.tab-pill').forEach(function(btn){
  btn.addEventListener('click', function(){
    document.querySelectorAll('.tab-pill').forEach(function(b){ b.classList.remove('active'); });
    btn.classList.add('active');
    S.tab = btn.dataset.tab;
    renderGrid();
  });
});

// ── grid rendering ────────────────────────────────────────────────────────────
function renderGrid(){
  var docs = S.docs.filter(function(d){ return d.config_type===S.tab; })
    .sort(function(a,b){ return a.rank-b.rank; });
  if(!docs.length){
    $('docsGrid').innerHTML = '<div class="col-span-3 flex flex-col items-center justify-center py-20 text-slate-400"><svg class="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg><span class="text-sm">No documents in this section</span></div>';
    return;
  }
  $('docsGrid').innerHTML = docs.map(cardHTML).join('');
  docs.forEach(function(doc){
    $('e-'+doc._id).onclick = function(){ openEdit(doc); };
    $('d-'+doc._id).onclick = function(){ openDelete(doc._id); };
    $('v-'+doc._id).onchange = function(e){ quickPatch(doc._id,'visible',e.target.checked,'Visibility updated'); };
    $('f-'+doc._id).onchange = function(e){ quickPatch(doc._id,'flag',e.target.checked, e.target.checked ? 'Document activated' : 'Document deactivated'); };
  });
}

function cardHTML(doc){
  var mc = MODE_COLORS[doc.display_mode] || 'bg-slate-100 text-slate-600';
  var fl = (doc.filters||[]).length;
  return '<div class="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex flex-col gap-3 hover:shadow-md transition-shadow">' +
    '<div class="flex items-start gap-2">' +
      '<div class="flex-1 min-w-0">' +
        '<div class="flex items-center gap-1.5 flex-wrap mb-1">' +
          '<span class="type-badge ' + mc + '">' + esc(doc.display_mode) + '</span>' +
          '<span class="text-xs text-slate-400">#' + doc.rank + '</span>' +
          (!doc.flag ? '<span class="type-badge bg-red-50 text-red-400">inactive</span>' : '') +
          (!doc.visible ? '<span class="type-badge bg-amber-50 text-amber-500">hidden</span>' : '') +
        '</div>' +
        '<h3 class="font-semibold text-slate-800 text-sm truncate">' + esc(doc.title) + '</h3>' +
        '<p class="text-xs text-slate-400 font-mono truncate">' + esc(doc._id) + '</p>' +
      '</div>' +
      '<div class="flex gap-0.5 shrink-0">' +
        '<button id="e-' + doc._id + '" class="btn-icon" title="Edit"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg></button>' +
        '<button id="d-' + doc._id + '" class="btn-icon danger" title="Delete"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/></svg></button>' +
      '</div>' +
    '</div>' +
    '<p class="text-xs text-slate-500 line-clamp-2">' + esc(doc.meta||'') + '</p>' +
    '<div class="flex items-center gap-4 pt-2.5 border-t border-slate-100 text-xs text-slate-600">' +
      '<label class="flex items-center gap-1.5 cursor-pointer">' +
        '<input type="checkbox" id="v-' + doc._id + '" class="w-3.5 h-3.5 accent-indigo-600 cursor-pointer"' + (doc.visible?' checked':'') + '>' +
        'Visible' +
      '</label>' +
      '<label class="flex items-center gap-1.5 cursor-pointer">' +
        '<input type="checkbox" id="f-' + doc._id + '" class="w-3.5 h-3.5 accent-emerald-600 cursor-pointer"' + (doc.flag?' checked':'') + '>' +
        'Active' +
      '</label>' +
      '<span class="ml-auto text-slate-400">' + fl + ' filter' + (fl!==1?'s':'') + '</span>' +
    '</div>' +
  '</div>';
}

// ── quick PATCH (visible / flag) ──────────────────────────────────────────────
function quickPatch(id, field, value, msg){
  var body = {};
  body[field] = value;
  apiFetch('PATCH','sdui/'+id+'/'+field, body)
    .then(function(){
      var doc = S.docs.find(function(d){ return d._id===id; });
      if(doc) doc[field] = value;
      toast(msg);
    })
    .catch(function(e){ toast('Error: '+e.message,'error'); loadDocs(); });
}

// ── delete flow ───────────────────────────────────────────────────────────────
function openDelete(id){
  S.deleteId = id;
  var doc = S.docs.find(function(d){ return d._id===id; });
  $('deleteDocLabel').textContent = doc ? doc._id+' ('+doc.title+')' : id;
  show($('deleteModal'));
}

$('cancelDelete').onclick = function(){ hide($('deleteModal')); S.deleteId=null; };
$('confirmDelete').onclick = function(){
  if(!S.deleteId) return;
  apiFetch('DELETE','sdui/'+S.deleteId)
    .then(function(){
      S.docs = S.docs.filter(function(d){ return d._id!==S.deleteId; });
      updateCounts();
      renderGrid();
      hide($('deleteModal'));
      toast('Document deleted');
      S.deleteId=null;
    })
    .catch(function(e){ toast('Delete failed: '+e.message,'error'); });
};

// ══════════════════════════════════════════════════════════════════════════════
// EDIT MODAL
// ══════════════════════════════════════════════════════════════════════════════
function openEdit(doc){
  S.edit = deep(doc);
  S.editOriginal = deep(doc); // pristine snapshot — never mutated
  S.editMTab = 'document';
  updateModalHeader();
  setActiveModalTab('document');
  renderModalBody();
  show($('editModal'));
}

$('closeModal').onclick = function(){ hide($('editModal')); };
$('cancelEdit').onclick = function(){ hide($('editModal')); };

// ── Rollback all edits: restore pristine snapshot ────────────────────────────
$('rollbackEdit').onclick = function(){
  if(!S.editOriginal) return;
  if(!confirm('Discard ALL your edits and restore the original values?\n\nThis cannot be undone.')) return;
  S.edit = deep(S.editOriginal);
  updateModalHeader();
  setActiveModalTab(S.editMTab);
  renderModalBody();
  toast('All edits rolled back to original','info');
};
document.querySelectorAll('.modal-tab').forEach(function(btn){
  btn.addEventListener('click', function(){
    setActiveModalTab(btn.dataset.mtab);
  });
});

function setActiveModalTab(t){
  S.editMTab = t;
  document.querySelectorAll('.modal-tab').forEach(function(b){
    b.classList.toggle('active', b.dataset.mtab===t);
  });
  renderModalBody();
}

function updateModalHeader(){
  var doc = S.edit;
  var tc = TYPE_COLORS[doc.config_type]||'bg-slate-100 text-slate-600';
  $('modalDocBadge').className = 'badge '+tc;
  $('modalDocBadge').textContent = doc.config_type;
  $('modalTitle').textContent = doc.title;
  $('modalSubtitle').textContent = doc._id;
}

function renderModalBody(){
  var body = $('modalBody');
  if(S.editMTab==='document')  body.innerHTML = renderDocTab();
  else if(S.editMTab==='filters') body.innerHTML = renderFiltersTab();
  else body.innerHTML = renderJsonTab();
  bindDocTabEvents();
  if(S.editMTab==='filters') bindFiltersTabEvents();
}

// ── Document tab ─────────────────────────────────────────────────────────────
function renderDocTab(){
  var d = S.edit;
  var iv = (d.icon && d.icon.value) ? d.icon.value : '';
  var it = (d.icon && d.icon.type) ? d.icon.type : 'none';
  return '<div class="grid grid-cols-2 gap-4">' +
    fRow('_id (read-only)', '<input class="form-input bg-slate-50 cursor-not-allowed" value="'+esc(d._id)+'" readonly>') +
    fRow('Config Type (read-only)', '<input class="form-input bg-slate-50 cursor-not-allowed" value="'+esc(d.config_type)+'" readonly>') +
    fRow('Title <span class="text-red-400">*</span>', '<input id="e-title" class="form-input" value="'+esc(d.title)+'" placeholder="CAPS TITLE"><p id="e-title-err" class="err-msg hidden"></p>', 'Must be all-caps. e.g. CATEGORY') +
    fRow('Rank <span class="text-red-400">*</span>', '<input id="e-rank" type="number" min="1" class="form-input" value="'+d.rank+'"><p id="e-rank-err" class="err-msg hidden"></p>', 'Positive integer, scoped to config_type') +
    fRow('Display Mode <span class="text-red-400">*</span>', selectHTML('e-dmode', DISPLAY_MODES, d.display_mode)+'<p id="e-dmode-err" class="err-msg hidden"></p>') +
    '</div>' +
    '<div class="mt-4 grid grid-cols-3 gap-4">' +
    '<label class="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50"><input type="checkbox" id="e-visible" class="w-4 h-4 accent-indigo-600"'+(d.visible?' checked':'')+'><div><div class="text-sm font-medium text-slate-700">Visible</div><div class="text-xs text-slate-400">Show in UI</div></div></label>' +
    '<label class="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50"><input type="checkbox" id="e-collapsed" class="w-4 h-4 accent-indigo-600"'+(d.collapsed_by_default?' checked':'')+'><div><div class="text-sm font-medium text-slate-700">Collapsed</div><div class="text-xs text-slate-400">Start collapsed</div></div></label>' +
    '<label class="flex items-center gap-2.5 p-3 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-50"><input type="checkbox" id="e-flag" class="w-4 h-4 accent-emerald-500"'+(d.flag?' checked':'')+'><div><div class="text-sm font-medium text-slate-700">Active (flag)</div><div class="text-xs text-slate-400">Enable feature</div></div></label>' +
    '</div>' +
    '<div class="mt-4 p-4 rounded-xl border border-slate-200 bg-slate-50">' +
    '<p class="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">Icon</p>' +
    '<div class="grid grid-cols-2 gap-3">' +
    fRow('Icon Type <span class="text-red-400">*</span>', selectHTML('e-itype', ICON_TYPES, it)) +
    '<div id="e-ivalue-wrap" class="'+(it==='none'?'hidden':'')+'">' +
    fRow('Icon Value <span class="text-red-400">*</span>', '<textarea id="e-ivalue" class="form-input text-xs font-mono" rows="3" placeholder="Inline SVG or absolute URL...">'+esc(iv)+'</textarea><p id="e-ivalue-err" class="err-msg hidden"></p>','SVG string or https:// URL') +
    '</div>' +
    '</div></div>' +
    '<div class="mt-4">' +
    fRow('Meta Description <span class="text-red-400">*</span>', '<textarea id="e-meta" class="form-input" rows="3" placeholder="Describe what this filter group does...">'+esc(d.meta||'')+'</textarea><p id="e-meta-err" class="err-msg hidden"></p>', 'Used for tooltips and accessibility labels') +
    '</div>';
}

function bindDocTabEvents(){
  var it = $('e-itype');
  if(!it) return;
  it.onchange = function(){
    var wrap = $('e-ivalue-wrap');
    if(it.value==='none') wrap.classList.add('hidden');
    else wrap.classList.remove('hidden');
  };
  var titleIn = $('e-title');
  if(titleIn) titleIn.oninput = function(){ titleIn.value = titleIn.value.toUpperCase(); };
}

// ── Filters tab ───────────────────────────────────────────────────────────────
function renderFiltersTab(){
  var filters = S.edit.filters || [];
  if(!filters.length) return '<div class="text-center text-slate-400 py-10 text-sm">No filters in this document.</div>';
  return filters.map(function(f, fi){ return renderFilterAccordion(f, fi); }).join('<div class="h-2"></div>');
}

function renderFilterAccordion(f, fi){
  var hasOpts = TYPES_WITH_OPTS.indexOf(f.type) !== -1;
  var tcolor = {
    range_slider:'bg-purple-50 text-purple-600', toggle_switch:'bg-green-50 text-green-600',
    text_input:'bg-blue-50 text-blue-600', autocomplete:'bg-cyan-50 text-cyan-600',
    date_preset:'bg-amber-50 text-amber-600', date_range_custom:'bg-orange-50 text-orange-600',
    checkbox:'bg-indigo-50 text-indigo-600', radio:'bg-pink-50 text-pink-600',
    icon_toggle:'bg-teal-50 text-teal-600', chip_multi_select:'bg-violet-50 text-violet-600',
    nested_select:'bg-rose-50 text-rose-600'
  }[f.type] || 'bg-slate-100 text-slate-600';

  return '<div class="rounded-xl overflow-hidden border border-slate-200" id="facc-'+fi+'">' +
    '<div class="acc-header" onclick="toggleAcc('+fi+')">' +
      '<svg id="farrow-'+fi+'" class="w-4 h-4 text-slate-400 shrink-0 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/></svg>' +
      '<span class="text-xs font-semibold text-slate-800 flex-1 font-mono">' + esc(f._id) + '</span>' +
      '<span class="type-badge '+tcolor+'">' + esc(f.type) + '</span>' +
      (f.type==='range_slider' ? '<span class="type-badge bg-violet-50 text-violet-500">'+(f.slider_scale||'exp')+'</span><span class="type-badge bg-fuchsia-50 text-fuchsia-500">'+(f.pin_mode||'single')+'</span>'+(f.loose_ends&&f.loose_ends!=='none'?'<span class="type-badge bg-amber-50 text-amber-600">loose:'+f.loose_ends+'</span>':'') : '') +
      '<span class="text-xs text-slate-400">rank '+f.rank+'</span>' +
      '<span class="ml-2 w-2 h-2 rounded-full shrink-0 '+(f.visible?'bg-emerald-400':'bg-slate-300')+'"></span>' +
    '</div>' +
    '<div class="acc-body" id="fbody-'+fi+'">' + renderFilterBody(f, fi, hasOpts) + '</div>' +
  '</div>';
}

function renderFilterBody(f, fi, hasOpts){
  var p = 'fi'+fi;
  var pa = fArr2Str(f.platform_applicability);

  // common fields
  var html = '<div class="grid grid-cols-2 gap-3 mb-4">' +
    fRow('_id (read-only)', '<input class="form-input bg-slate-50 cursor-not-allowed text-xs font-mono" value="'+esc(f._id)+'" readonly>') +
    fRow('Label <span class="text-red-400">*</span>', '<input id="'+p+'-label" class="form-input" value="'+esc(f.label)+'"><p id="'+p+'-label-err" class="err-msg hidden"></p>') +
    fRow('Rank <span class="text-red-400">*</span>', '<input id="'+p+'-rank" type="number" min="1" class="form-input" value="'+f.rank+'"><p id="'+p+'-rank-err" class="err-msg hidden"></p>') +
    fRow('Query Param <span class="text-red-400">*</span>', '<input id="'+p+'-qp" class="form-input font-mono text-xs" value="'+esc(f.query_param)+'" placeholder="camelCase"><p id="'+p+'-qp-err" class="err-msg hidden"></p>', 'camelCase e.g. sortBy') +
    '</div>' +
    '<div class="flex items-center gap-4 mb-4">' +
      '<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" id="'+p+'-vis" class="w-3.5 h-3.5 accent-indigo-600"'+(f.visible?' checked':'')+'> <span class="text-slate-700">Visible</span></label>' +
      '<label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" id="'+p+'-ms" class="w-3.5 h-3.5 accent-indigo-600"'+(f.multi_select?' checked':'')+'> <span class="text-slate-700">Multi-select</span></label>' +
    '</div>' +
    '<div class="mb-4">' +
      '<label class="label">Platform Applicability <span class="text-red-400">*</span></label>' +
      platformChipsHTML(p, pa) +
      '<p id="'+p+'-pa-err" class="err-msg hidden"></p>' +
    '</div>';

  // Conditional: range_slider
  if(f.type === 'range_slider'){
    var curScale = f.slider_scale || 'exponential';
    var curPin   = f.pin_mode     || 'single';
    var curLoose = f.loose_ends   || 'none';
    html += '<div class="p-3 rounded-lg bg-purple-50 border border-purple-100 mb-4">' +
      '<p class="text-xs font-semibold text-purple-600 mb-3">Range Slider Config</p>' +
      '<div class="grid grid-cols-3 gap-3">' +
      fRow('Min <span class="text-red-400">*</span>', '<input id="'+p+'-min" type="number" class="form-input" value="'+nvl(f.min,0)+'"><p id="'+p+'-min-err" class="err-msg hidden"></p>') +
      fRow('Max <span class="text-red-400">*</span>', '<input id="'+p+'-max" type="number" class="form-input" value="'+nvl(f.max,100)+'"><p id="'+p+'-max-err" class="err-msg hidden"></p>') +
      fRow('Step <span class="text-red-400">*</span>', '<input id="'+p+'-step" type="number" min="0.001" class="form-input" value="'+nvl(f.step,1)+'"><p id="'+p+'-step-err" class="err-msg hidden"></p>') +
      fRow('Default Min', '<input id="'+p+'-dmin" type="number" class="form-input" value="'+nvl(f.default_min,0)+'">') +
      fRow('Default Max', '<input id="'+p+'-dmax" type="number" class="form-input" value="'+nvl(f.default_max,100)+'">') +
      fRow('Unit', '<input id="'+p+'-unit" class="form-input" value="'+esc(f.unit||'')+'" placeholder="USD, days …">') +
      '</div>' +
      '<div class="grid grid-cols-3 gap-3 mt-3 pt-3 border-t border-purple-200">' +
      fRow('Slider Scale', '<select id="'+p+'-scale" class="form-input"><option value="exponential"'+(curScale==='exponential'?' selected':'')+'>Exponential</option><option value="linear"'+(curScale==='linear'?' selected':'')+'>Linear</option></select>' +
        '<p class="text-xs text-slate-400 mt-1">Exponential = more resolution at low values (good for 0–10M). Linear = uniform distribution.</p>') +
      fRow('Pin Mode', '<select id="'+p+'-pin" class="form-input"><option value="single"'+(curPin==='single'?' selected':'')+'>Single Pin</option><option value="double"'+(curPin==='double'?' selected':'')+'>Double Pin</option></select>' +
        '<p class="text-xs text-slate-400 mt-1">Single = one thumb (min→value). Double = two thumbs (custom [low, high] sub-range).</p>') +
      fRow('Loose Ends', '<select id="'+p+'-loose" class="form-input"><option value="none"'+(curLoose==='none'?' selected':'')+'>None (both capped)</option><option value="left"'+(curLoose==='left'?' selected':'')+'>Left (no minimum)</option><option value="right"'+(curLoose==='right'?' selected':'')+'>Right (no maximum)</option><option value="both"'+(curLoose==='both'?' selected':'')+'>Both (uncapped)</option></select>' +
        '<p class="text-xs text-slate-400 mt-1">Loose ends let users select "no minimum" or "no maximum".</p>') +
      '</div></div>';
  }

  // Conditional: text_input / autocomplete
  if(INPUT_TYPES.indexOf(f.type)!==-1){
    html += '<div class="p-3 rounded-lg bg-blue-50 border border-blue-100 mb-4">' +
      '<p class="text-xs font-semibold text-blue-600 mb-3">Input Config</p>' +
      '<div class="grid grid-cols-2 gap-3">' +
      fRow('Placeholder <span class="text-red-400">*</span>', '<input id="'+p+'-ph" class="form-input" value="'+esc(f.placeholder||'')+'"><p id="'+p+'-ph-err" class="err-msg hidden"></p>') +
      fRow('Debounce (ms)', '<input id="'+p+'-db" type="number" min="0" class="form-input" value="'+nvl(f.debounce_ms,300)+'">') +
      fRow('Min Length', '<input id="'+p+'-minl" type="number" min="0" class="form-input" value="'+nvl(f.min_length,2)+'">') +
      fRow('Max Length', '<input id="'+p+'-maxl" type="number" min="1" class="form-input" value="'+nvl(f.max_length,120)+'">') +
      '</div></div>';
  }

  // Conditional: autocomplete suggestion sources
  if(f.type === 'autocomplete' && (f.suggestion_sources||[]).length){
    html += renderSuggestionSources(f, fi);
  }

  // Conditional: date_range_custom
  if(f.type==='date_range_custom'){
    html += '<div class="p-3 rounded-lg bg-orange-50 border border-orange-100 mb-4">' +
      '<p class="text-xs font-semibold text-orange-600 mb-3">Date Range Config</p>' +
      '<div class="grid grid-cols-2 gap-3">' +
      fRow('Min Field <span class="text-red-400">*</span>', '<input id="'+p+'-mf" class="form-input font-mono text-xs" value="'+esc(f.min_field||'startDate')+'"><p id="'+p+'-mf-err" class="err-msg hidden"></p>') +
      fRow('Max Field <span class="text-red-400">*</span>', '<input id="'+p+'-xf" class="form-input font-mono text-xs" value="'+esc(f.max_field||'endDate')+'"><p id="'+p+'-xf-err" class="err-msg hidden"></p>') +
      fRow('Format', '<input id="'+p+'-fmt" class="form-input font-mono text-xs" value="'+esc(f.format||'YYYY-MM-DD')+'">') +
      fRow('Default Mode', '<input id="'+p+'-dm" class="form-input" value="'+esc(f.default_mode||'current_date')+'">') +
      '</div></div>';
  }

  // Options table
  if(hasOpts){
    html += renderOptionsTable(f, fi, p);
  }

  return html;
}

function renderOptionsTable(f, fi, p){
  var isIconToggle = (f.type === 'icon_toggle');
  var opts = f.options || [];
  var rows = opts.map(function(o, oi){ return renderOptRow(o, fi, oi, isIconToggle); }).join('');
  var gridCls = isIconToggle ? 'opt-row-icon' : 'opt-row';
  var head = '<div class="'+gridCls+' text-xs font-semibold text-slate-500 mb-1 px-1">' +
    '<span>_id</span><span>Label</span><span>Value</span><span class="text-center">Rank</span>' +
    (isIconToggle ? '<span>Icon URL</span>' : '') + '<span class="text-center">Default</span><span>Platforms</span><span></span></div>';
  return '<div class="border-t border-slate-100 pt-4 mt-2">' +
    '<div class="flex items-center justify-between mb-2">' +
      '<p class="text-xs font-semibold text-slate-600">Options (' + opts.length + ')</p>' +
      '<button onclick="addOption('+fi+')" class="btn btn-ghost btn-sm text-indigo-600 border-indigo-200 hover:bg-indigo-50">' +
        '<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/></svg> Add Option' +
      '</button>' +
    '</div>' +
    head +
    '<div id="opts-'+fi+'">' + rows + '</div>' +
  '</div>';
}

function renderOptRow(o, fi, oi, isIconToggle){
  var gridCls = isIconToggle ? 'opt-row-icon' : 'opt-row';
  var opaPfx = 'opa-'+fi+'-'+oi;
  return '<div class="'+gridCls+' mb-1.5" id="optrow-'+fi+'-'+oi+'">' +
    '<input class="form-input text-xs font-mono" id="oid-'+fi+'-'+oi+'" value="'+esc(o._id||'')+'" placeholder="_id">' +
    '<input class="form-input text-xs" id="olbl-'+fi+'-'+oi+'" value="'+esc(o.label||'')+'" placeholder="Label">' +
    '<input class="form-input text-xs font-mono" id="oval-'+fi+'-'+oi+'" value="'+esc(o.value||'')+'" placeholder="value">' +
    '<input class="form-input text-xs text-center" id="ork-'+fi+'-'+oi+'" type="number" min="1" value="'+(o.rank||oi+1)+'">' +
    (isIconToggle ? '<input class="form-input text-xs" id="oicu-'+fi+'-'+oi+'" value="'+esc(o.icon_url||'')+'" placeholder="https://...">' : '') +
    '<div class="flex justify-center"><input type="checkbox" id="odef-'+fi+'-'+oi+'" class="w-4 h-4 accent-indigo-600"'+(o.selected_by_default?' checked':'')+'></div>' +
    optPlatformChipsHTML(opaPfx, o.platform_applicability) +
    '<button onclick="removeOpt('+fi+','+oi+')" class="btn-icon danger justify-self-center"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg></button>' +
  '</div>';
}

// ── option-level platform chips (compact) ────────────────────────────────────
function optPlatformChipsHTML(prefix, pa){
  var isAll = (!pa || pa === 'all' || !Array.isArray(pa));
  var arr = isAll ? [] : pa;
  return '<div class="opt-pa-wrap" id="'+prefix+'-chips">' +
    '<span class="opt-pa-chip '+(isAll?'sel':'unsel')+'" data-op="all" onclick="toggleOptPaChip(\''+prefix+'\',\'all\')">All</span>' +
    PLATFORMS.map(function(pl){
      var sel = !isAll && arr.indexOf(pl)!==-1;
      return '<span class="opt-pa-chip '+(sel?'sel':'unsel')+'" data-op="'+pl+'" onclick="toggleOptPaChip(\''+prefix+'\',\''+pl+'\')">' +
        pl.substring(0,2).toUpperCase() +
      '</span>';
    }).join('') +
  '</div>';
}

function toggleOptPaChip(prefix, val){
  var container = $(prefix+'-chips');
  if(!container) return;
  var chips = container.querySelectorAll('[data-op]');
  if(val === 'all'){
    chips.forEach(function(c){ c.classList.toggle('sel', c.dataset.op==='all'); c.classList.toggle('unsel', c.dataset.op!=='all'); });
  } else {
    var allChip = container.querySelector('[data-op="all"]');
    if(allChip){ allChip.classList.remove('sel'); allChip.classList.add('unsel'); }
    var el = container.querySelector('[data-op="'+val+'"]');
    if(el){ el.classList.toggle('sel'); el.classList.toggle('unsel'); }
  }
}

function readOptPaChips(prefix){
  var container = $(prefix+'-chips');
  if(!container) return undefined; // no chips rendered = leave as-is
  var allChip = container.querySelector('[data-op="all"]');
  if(allChip && allChip.classList.contains('sel')) return undefined; // 'All' = common = no field
  var sel = [];
  container.querySelectorAll('[data-op]').forEach(function(c){
    if(c.dataset.op!=='all' && c.classList.contains('sel')) sel.push(c.dataset.op);
  });
  return sel.length ? sel : undefined; // empty = treat as all
}

// ── Suggestion Sources panel (autocomplete only) ─────────────────────────────
function renderSuggestionSources(f, fi){
  var sources = (f.suggestion_sources||[]).slice().sort(function(a,b){ return (a.rank||0)-(b.rank||0); });
  var rows = sources.map(function(s,si){ return renderSuggestionSourceRow(s,fi,si); }).join('');
  return '<div class="p-3 rounded-lg bg-indigo-50 border border-indigo-200 mb-4">' +
    '<div class="flex items-center justify-between mb-3">' +
      '<p class="text-xs font-semibold text-indigo-700">Suggestion Sources (' + sources.length + ')</p>' +
      '<span class="text-[10px] text-indigo-400 font-mono">ordered by rank · lower rank shown first</span>' +
    '</div>' +
    '<div class="space-y-3" id="ss-list-'+fi+'">' + rows + '</div>' +
  '</div>';
}

function renderSuggestionSourceRow(s, fi, si){
  var rankBadge = si===0
    ? 'bg-indigo-600 text-white'
    : 'bg-purple-100 text-purple-700';
  var methodBadge = (s.method||'GET')==='GET'
    ? 'bg-emerald-100 text-emerald-700'
    : 'bg-amber-100 text-amber-700';
  return '<div class="bg-white rounded-lg border border-indigo-100 p-3" id="ssrow-'+fi+'-'+si+'">' +
    // header row: rank badge + id (read-only) + method pill
    '<div class="flex items-center gap-2 mb-3">' +
      '<span class="text-[10px] font-black px-2 py-0.5 rounded-full '+rankBadge+'">#'+(s.rank||si+1)+'</span>' +
      '<span class="text-xs font-mono font-semibold text-slate-700 flex-1">'+esc(s.id||'')+'</span>' +
      '<span class="text-[10px] px-2 py-0.5 rounded font-mono font-bold '+methodBadge+'">'+esc(s.method||'GET')+'</span>' +
    '</div>' +
    // row 1: rank · label · min chars
    '<div class="grid grid-cols-3 gap-2 mb-2">' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Rank <span class="text-red-400">*</span></label>' +
        '<input id="ss-'+fi+'-'+si+'-rank" type="number" min="1" class="form-input text-xs" value="'+(s.rank||si+1)+'">' +
      '</div>' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Label</label>' +
        '<input id="ss-'+fi+'-'+si+'-label" class="form-input text-xs" value="'+esc(s.label||'')+'">' +
      '</div>' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Min Chars</label>' +
        '<input id="ss-'+fi+'-'+si+'-minc" type="number" min="1" class="form-input text-xs" value="'+(s.min_chars_to_trigger||3)+'">' +
      '</div>' +
    '</div>' +
    // row 2: endpoint · env key (highlighted)
    '<div class="grid grid-cols-2 gap-2 mb-2">' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Endpoint</label>' +
        '<input id="ss-'+fi+'-'+si+'-ep" class="form-input text-xs font-mono" value="'+esc(s.endpoint||'')+'" placeholder="/suggest">' +
      '</div>' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-indigo-600 uppercase tracking-wide block mb-1">ENV Key <span class="text-slate-400 normal-case font-normal">(frontend base URL var)</span></label>' +
        '<input id="ss-'+fi+'-'+si+'-envkey" class="form-input text-xs font-mono bg-indigo-50 border-indigo-300" value="'+esc(s.env_key||'')+'" placeholder="VITE_SUGGEST_API_BASE_URL">' +
      '</div>' +
    '</div>' +
    // row 3: response key · display field · on-select action
    '<div class="grid grid-cols-3 gap-2 mb-2">' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Response Key</label>' +
        '<input id="ss-'+fi+'-'+si+'-rk" class="form-input text-xs font-mono" value="'+esc(s.response_key||'')+'" placeholder="suggestions">' +
      '</div>' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Display Field</label>' +
        '<input id="ss-'+fi+'-'+si+'-df" class="form-input text-xs font-mono" value="'+esc(s.display_field||'')+'">' +
      '</div>' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">On Select Action</label>' +
        '<select id="ss-'+fi+'-'+si+'-osa" class="form-input text-xs">' +
          '<option value="replacePartialWord"'+(s.on_select_action==='replacePartialWord'?' selected':'')+'>replacePartialWord</option>' +
          '<option value="setSelCategories"'+(s.on_select_action==='setSelCategories'?' selected':'')+'>setSelCategories</option>' +
        '</select>' +
      '</div>' +
    '</div>' +
    // row 4: query param config (if present)
    renderQueryParamConfig(s, fi, si) +
  '</div>';
}

// ── Query Param Config panel inside a suggestion source ──────────────────────
function renderQueryParamConfig(s, fi, si){
  var configs = s.query_param_config || [];
  if(!configs.length) return '';
  var rows = configs.map(function(p, pi){
    var reqBadge = p.required
      ? '<span class="text-[9px] px-1.5 py-0.5 rounded bg-red-100 text-red-600 font-bold">REQUIRED</span>'
      : '<span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-500 font-bold">OPTIONAL</span>';
    var typeBadge = '<span class="text-[9px] px-1.5 py-0.5 rounded bg-cyan-50 text-cyan-700 font-mono font-bold">'+esc(p.type||'string')+'</span>';
    var defVal = p['default'];
    if(typeof defVal === 'boolean') defVal = defVal ? 'true' : 'false';
    if(defVal === null || defVal === undefined) defVal = '';
    return '<div class="grid grid-cols-[1fr_80px_80px_1fr_auto] gap-2 items-center">' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Name</label>' +
        '<input id="ss-'+fi+'-'+si+'-qpc-'+pi+'-name" class="form-input text-xs font-mono" value="'+esc(p.name||'')+'">' +
      '</div>' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Type</label>' +
        '<select id="ss-'+fi+'-'+si+'-qpc-'+pi+'-type" class="form-input text-xs">' +
          '<option value="string"'+(p.type==='string'?' selected':'')+'>string</option>' +
          '<option value="number"'+(p.type==='number'?' selected':'')+'>number</option>' +
          '<option value="boolean"'+(p.type==='boolean'?' selected':'')+'>boolean</option>' +
        '</select>' +
      '</div>' +
      '<div class="text-center">' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Required</label>' +
        '<input id="ss-'+fi+'-'+si+'-qpc-'+pi+'-req" type="checkbox" class="form-checkbox"'+(p.required?' checked':'')+'>' +
      '</div>' +
      '<div>' +
        '<label class="text-[10px] font-semibold text-slate-500 uppercase tracking-wide block mb-1">Default</label>' +
        '<input id="ss-'+fi+'-'+si+'-qpc-'+pi+'-def" class="form-input text-xs font-mono" value="'+esc(''+defVal)+'" title="'+(p.hint?esc(p.hint):'')+'">' +
      '</div>' +
      '<div class="pt-3">' + reqBadge + ' ' + typeBadge + '</div>' +
    '</div>';
  }).join('');
  return '<div class="mt-2 p-2 rounded bg-teal-50 border border-teal-200">' +
    '<p class="text-[10px] font-semibold text-teal-700 mb-2">Query Param Config (' + configs.length + ')</p>' +
    '<div class="space-y-2">' + rows + '</div>' +
    '<button onclick="addQueryParamConfig('+fi+','+si+')" class="mt-2 text-[10px] text-teal-600 hover:text-teal-800 font-semibold">+ Add param</button>' +
  '</div>';
}

function toggleAcc(fi){
  var body = $('fbody-'+fi);
  var arrow = $('farrow-'+fi);
  body.classList.toggle('open');
  arrow.style.transform = body.classList.contains('open') ? 'rotate(180deg)' : '';
}

function bindFiltersTabEvents(){
  // nothing extra needed — all events are inline onclick
}

function addOption(fi){
  var f = S.edit.filters[fi];
  if(!f.options) f.options = [];
  f.options.push({ _id:'', filter_id:f._id, label:'', value:'', rank:f.options.length+1, selected_by_default:false });
  // re-render just the filters tab preserving which accordions are open
  var openSet = [];
  S.edit.filters.forEach(function(_,i){
    var b = $('fbody-'+i);
    if(b && b.classList.contains('open')) openSet.push(i);
  });
  $('modalBody').innerHTML = renderFiltersTab();
  openSet.forEach(function(i){ toggleAcc(i); });
}

function removeOpt(fi, oi){
  S.edit.filters[fi].options.splice(oi, 1);
  var openSet = [];
  S.edit.filters.forEach(function(_,i){
    var b = $('fbody-'+i);
    if(b && b.classList.contains('open')) openSet.push(i);
  });
  $('modalBody').innerHTML = renderFiltersTab();
  openSet.forEach(function(i){ toggleAcc(i); });
}

function addQueryParamConfig(fi, si){
  var f = S.edit.filters[fi];
  if(!f.suggestion_sources || !f.suggestion_sources[si]) return;
  var s = f.suggestion_sources[si];
  if(!s.query_param_config) s.query_param_config = [];
  s.query_param_config.push({ name:'', type:'string', required:false, 'default':'', label:'', hint:'' });
  var openSet = [];
  S.edit.filters.forEach(function(_,i){
    var b = $('fbody-'+i);
    if(b && b.classList.contains('open')) openSet.push(i);
  });
  $('modalBody').innerHTML = renderFiltersTab();
  openSet.forEach(function(i){ toggleAcc(i); });
}

// ── JSON tab ──────────────────────────────────────────────────────────────────
function renderJsonTab(){
  return '<div class="relative">' +
    '<textarea id="jsonEditor" class="w-full text-xs font-mono bg-slate-900 text-emerald-300 p-4 rounded-xl leading-relaxed border-none outline-none resize-vertical" style="min-height:400px" spellcheck="false">' +
    esc(JSON.stringify(S.edit, null, 2)) + '</textarea>' +
    '<div id="jsonError" class="hidden text-xs text-red-400 mt-2 px-2"></div>' +
    '<div class="flex justify-end mt-3 gap-2">' +
      '<button type="button" class="btn btn-ghost btn-sm" onclick="resetJson()">Reset</button>' +
      '<button type="button" class="btn btn-primary btn-sm" onclick="applyJson()">Apply JSON</button>' +
    '</div>' +
  '</div>';
}

function applyJson(){
  var el = $('jsonEditor');
  if(!el) return;
  try {
    var parsed = JSON.parse(el.value);
    parsed._id = S.edit._id;
    parsed.config_type = S.edit.config_type;
    S.edit = parsed;
    $('jsonError').classList.add('hidden');
    toast('JSON applied successfully','success');
  } catch(e) {
    $('jsonError').textContent = 'Invalid JSON: ' + e.message;
    $('jsonError').classList.remove('hidden');
  }
}

function resetJson(){
  var el = $('jsonEditor');
  if(!el) return;
  el.value = JSON.stringify(S.edit, null, 2);
  $('jsonError').classList.add('hidden');
  toast('JSON reset to current state','info');
}

// ── platform chips ────────────────────────────────────────────────────────────
function platformChipsHTML(p, current){
  var isAll = (current === 'all' || !Array.isArray(current));
  var arr = isAll ? [] : current;
  return '<div class="flex flex-wrap gap-1.5 mb-1" id="'+p+'-pchips">' +
    '<div class="platform-chip '+(isAll?'sel':'unsel')+'" data-p="all" onclick="togglePlatformChip(\''+p+'\',\'all\')">' +
      '<svg class="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clip-rule="evenodd"/></svg>' +
      'All' +
    '</div>' +
    PLATFORMS.map(function(pl){
      var sel = !isAll && arr.indexOf(pl)!==-1;
      return '<div class="platform-chip '+(sel?'sel':'unsel')+'" data-p="'+pl+'" onclick="togglePlatformChip(\''+p+'\',\''+pl+'\')">'+pl+'</div>';
    }).join('') +
  '</div>';
}

function togglePlatformChip(prefix, val){
  var container = $(prefix+'-pchips');
  if(!container) return;
  var chips = container.querySelectorAll('[data-p]');
  if(val === 'all'){
    chips.forEach(function(c){ c.classList.toggle('sel', c.dataset.p==='all'); c.classList.toggle('unsel', c.dataset.p!=='all'); });
  } else {
    var allChip = container.querySelector('[data-p="all"]');
    if(allChip){ allChip.classList.remove('sel'); allChip.classList.add('unsel'); }
    var el = container.querySelector('[data-p="'+val+'"]');
    if(el){ el.classList.toggle('sel'); el.classList.toggle('unsel'); }
  }
}

function readPlatformChips(prefix){
  var container = $(prefix+'-pchips');
  if(!container) return 'all';
  var allChip = container.querySelector('[data-p="all"]');
  if(allChip && allChip.classList.contains('sel')) return 'all';
  var sel = [];
  container.querySelectorAll('[data-p]').forEach(function(c){
    if(c.dataset.p!=='all' && c.classList.contains('sel')) sel.push(c.dataset.p);
  });
  return sel.length ? sel : 'all';
}

// ── collect form data ─────────────────────────────────────────────────────────
function collectDoc(){
  var d = deep(S.edit);

  // Document tab
  if($('e-title'))  d.title              = $('e-title').value.trim().toUpperCase();
  if($('e-rank'))   d.rank               = parseInt($('e-rank').value) || 1;
  if($('e-dmode'))  d.display_mode       = $('e-dmode').value;
  if($('e-visible'))d.visible            = $('e-visible').checked;
  if($('e-collapsed')) d.collapsed_by_default = $('e-collapsed').checked;
  if($('e-flag'))   d.flag               = $('e-flag').checked;
  if($('e-meta'))   d.meta               = $('e-meta').value.trim();
  if($('e-itype')){ d.icon = { type: $('e-itype').value, value: $('e-ivalue') ? $('e-ivalue').value.trim() || null : null }; }

  // Filters tab
  d.filters = (d.filters||[]).map(function(f, fi){
    var p = 'fi'+fi;
    if($( p+'-label')) f.label       = $(p+'-label').value.trim();
    if($(p+'-rank'))   f.rank        = parseInt($(p+'-rank').value) || f.rank;
    if($(p+'-qp'))     f.query_param = $(p+'-qp').value.trim();
    if($(p+'-vis'))    f.visible     = $(p+'-vis').checked;
    if($(p+'-ms'))     f.multi_select= $(p+'-ms').checked;
    f.platform_applicability = readPlatformChips(p);

    // range_slider
    if(f.type==='range_slider'){
      if($(p+'-min'))   f.min          = parseFloat($(p+'-min').value);
      if($(p+'-max'))   f.max          = parseFloat($(p+'-max').value);
      if($(p+'-step'))  f.step         = parseFloat($(p+'-step').value);
      if($(p+'-dmin'))  f.default_min  = parseFloat($(p+'-dmin').value);
      if($(p+'-dmax'))  f.default_max  = parseFloat($(p+'-dmax').value);
      if($(p+'-unit'))  f.unit         = $(p+'-unit').value.trim() || undefined;
      if($(p+'-scale')) f.slider_scale = $(p+'-scale').value;
      if($(p+'-pin'))   f.pin_mode     = $(p+'-pin').value;
      if($(p+'-loose')) f.loose_ends   = $(p+'-loose').value;
    }
    // text_input / autocomplete
    if(INPUT_TYPES.indexOf(f.type)!==-1){
      if($(p+'-ph'))   f.placeholder = $(p+'-ph').value.trim();
      if($(p+'-db'))   f.debounce_ms = parseInt($(p+'-db').value)||300;
      if($(p+'-minl')) f.min_length  = parseInt($(p+'-minl').value)||2;
      if($(p+'-maxl')) f.max_length  = parseInt($(p+'-maxl').value)||120;
    }
    // autocomplete: suggestion sources (rank, env_key, endpoint, etc.)
    if(f.type === 'autocomplete' && f.suggestion_sources){
      f.suggestion_sources = f.suggestion_sources.map(function(s, si){
        if($('ss-'+fi+'-'+si+'-rank'))   s.rank                 = parseInt($('ss-'+fi+'-'+si+'-rank').value)  || si+1;
        if($('ss-'+fi+'-'+si+'-label'))  s.label                = $('ss-'+fi+'-'+si+'-label').value.trim();
        if($('ss-'+fi+'-'+si+'-minc'))   s.min_chars_to_trigger = parseInt($('ss-'+fi+'-'+si+'-minc').value) || 3;
        if($('ss-'+fi+'-'+si+'-ep'))     s.endpoint             = $('ss-'+fi+'-'+si+'-ep').value.trim();
        if($('ss-'+fi+'-'+si+'-envkey')) s.env_key              = $('ss-'+fi+'-'+si+'-envkey').value.trim();
        if($('ss-'+fi+'-'+si+'-rk'))     s.response_key         = $('ss-'+fi+'-'+si+'-rk').value.trim();
        if($('ss-'+fi+'-'+si+'-df'))     s.display_field        = $('ss-'+fi+'-'+si+'-df').value.trim();
        if($('ss-'+fi+'-'+si+'-osa'))    s.on_select_action     = $('ss-'+fi+'-'+si+'-osa').value;
        // query param config
        if(s.query_param_config){
          s.query_param_config = s.query_param_config.map(function(pc, pi){
            var pfx = 'ss-'+fi+'-'+si+'-qpc-'+pi;
            if($(pfx+'-name')) pc.name     = $(pfx+'-name').value.trim();
            if($(pfx+'-type')) pc.type     = $(pfx+'-type').value;
            if($(pfx+'-req'))  pc.required = $(pfx+'-req').checked;
            if($(pfx+'-def')){
              var raw = $(pfx+'-def').value.trim();
              if(pc.type==='number')       pc['default'] = parseFloat(raw)||0;
              else if(pc.type==='boolean') pc['default'] = (raw==='true');
              else                          pc['default'] = raw;
            }
            return pc;
          });
          // also sync query_params map from config defaults
          s.query_params = {};
          s.query_param_config.forEach(function(pc){
            s.query_params[pc.name] = pc['default'];
          });
        }
        return s;
      });
      // keep sorted by rank so JSON / DB always reflect display order
      f.suggestion_sources.sort(function(a,b){ return (a.rank||0)-(b.rank||0); });
    }
    // date_range_custom
    if(f.type==='date_range_custom'){
      if($(p+'-mf'))   f.min_field   = $(p+'-mf').value.trim();
      if($(p+'-xf'))   f.max_field   = $(p+'-xf').value.trim();
      if($(p+'-fmt'))  f.format      = $(p+'-fmt').value.trim();
      if($(p+'-dm'))   f.default_mode= $(p+'-dm').value.trim();
    }
    // options
    if(f.options){
      var isIconToggle = (f.type==='icon_toggle');
      f.options = f.options.map(function(o, oi){
        if($('oid-'+fi+'-'+oi))  o._id              = $('oid-'+fi+'-'+oi).value.trim();
        if($('olbl-'+fi+'-'+oi)) o.label            = $('olbl-'+fi+'-'+oi).value.trim();
        if($('oval-'+fi+'-'+oi)) o.value            = $('oval-'+fi+'-'+oi).value.trim();
        if($('ork-'+fi+'-'+oi))  o.rank             = parseInt($('ork-'+fi+'-'+oi).value)||oi+1;
        if($('odef-'+fi+'-'+oi)) o.selected_by_default = $('odef-'+fi+'-'+oi).checked;
        if(isIconToggle && $('oicu-'+fi+'-'+oi)) o.icon_url = $('oicu-'+fi+'-'+oi).value.trim()||undefined;
        // Option-level platform applicability
        var opaPfx = 'opa-'+fi+'-'+oi;
        var optPa = readOptPaChips(opaPfx);
        if(optPa !== undefined) { o.platform_applicability = optPa; }
        else { delete o.platform_applicability; } // 'All' = common, remove field
        return o;
      });
    }
    return f;
  });

  return d;
}

// ── validation ────────────────────────────────────────────────────────────────
function isCamelCase(v){ return /^[a-z][a-zA-Z0-9]*$/.test(v); }
function isSnakeCase(v){ return /^[a-z][a-z0-9_]*$/.test(v); }
function isPosInt(v){ return /^\d+$/.test(String(v)) && parseInt(v)>=1; }

function validateDoc(d){
  var errs = {};
  if(!d.title || !d.title.trim())           errs['title']         = 'Title is required';
  else if(!/^[A-Z][A-Z0-9\s&\/\-\.]*$/.test(d.title)) errs['title'] = 'Title must be CAPS (e.g. CATEGORY, SORT BY)';
  if(!isPosInt(d.rank))                     errs['rank']          = 'Rank must be a positive integer (≥ 1)';
  if(!d.display_mode)                       errs['dmode']         = 'Display mode is required';
  if(!d.meta || !d.meta.trim())             errs['meta']          = 'Meta description is required';
  if(d.icon && d.icon.type !== 'none' && !isset(d.icon.value)) errs['ivalue'] = 'Icon value is required when type is svg or url';

  (d.filters||[]).forEach(function(f, fi){
    var p = 'fi'+fi;
    if(!f.label||!f.label.trim())           errs[p+'-label']      = 'Label is required';
    if(!isPosInt(f.rank))                   errs[p+'-rank']       = 'Rank must be ≥ 1';
    if(!f.query_param||!isCamelCase(f.query_param)) errs[p+'-qp'] = 'Must be camelCase (e.g. sortBy, adTypes)';
    var pa = f.platform_applicability;
    if(pa!=='all' && (!Array.isArray(pa)||!pa.length)) errs[p+'-pa'] = 'Select at least one platform or "All"';

    if(f.type==='range_slider'){
      if(!isset(f.min)&&f.min!==0)          errs[p+'-min']        = 'Min is required';
      if(!isset(f.max)&&f.max!==0)          errs[p+'-max']        = 'Max is required';
      if(!isset(f.step)||f.step<=0)         errs[p+'-step']       = 'Step must be > 0';
      if(isset(f.min)&&isset(f.max)&&parseFloat(f.min)>=parseFloat(f.max)) errs[p+'-max'] = 'Max must be greater than min';
    }
    if(INPUT_TYPES.indexOf(f.type)!==-1){
      if(!f.placeholder||!f.placeholder.trim()) errs[p+'-ph']     = 'Placeholder is required for input types';
    }
    if(f.type==='date_range_custom'){
      if(!f.min_field) errs[p+'-mf'] = 'Min field is required';
      if(!f.max_field) errs[p+'-xf'] = 'Max field is required';
    }
    (f.options||[]).forEach(function(o, oi){
      if(!o._id||!isSnakeCase(o._id))       errs['oid-'+fi+'-'+oi]  = 'Must be snake_case';
      if(!o.label||!o.label.trim())          errs['olbl-'+fi+'-'+oi] = 'Label required';
      if(!o.value||!o.value.trim())          errs['oval-'+fi+'-'+oi] = 'Value required';
      if(!isPosInt(o.rank))                  errs['ork-'+fi+'-'+oi]  = 'Rank ≥ 1';
    });
  });
  return errs;
}

function applyErrors(errs){
  // clear all existing errors
  document.querySelectorAll('.form-input.err').forEach(function(el){ el.classList.remove('err'); });
  document.querySelectorAll('.err-msg').forEach(function(el){ el.textContent=''; el.classList.add('hidden'); });
  var keys = Object.keys(errs);
  if(!keys.length){ hide($('modalErrSummary')); return false; }
  keys.forEach(function(k){
    var input = $(k) || $('e-'+k);
    if(input){ input.classList.add('err'); }
    var errEl = $(k+'-err') || $('e-'+k+'-err');
    if(errEl){ errEl.textContent=errs[k]; errEl.classList.remove('hidden'); }
  });
  show($('modalErrSummary'));
  return true;
}

// ── Review & Submit: collect, validate, show diff, then confirm ──────────────
$('saveEdit').onclick = function(){
  var doc = collectDoc();
  var errs = validateDoc(doc);
  var hasErr = applyErrors(errs);
  if(hasErr) return;

  // Build diff summary between original and current
  S._pendingSave = doc;
  var changes = diffDocs(S.editOriginal, doc);
  $('reviewBody').innerHTML = renderReviewSummary(doc, changes);
  show($('reviewModal'));
};

$('cancelReview').onclick = function(){ hide($('reviewModal')); };
$('confirmSave').onclick  = function(){
  var doc = S._pendingSave;
  if(!doc) return;

  $('confirmSave').disabled = true;
  $('confirmSave').innerHTML = '<span class="spinner"></span> Saving...';

  apiFetch('PUT','sdui/'+doc._id, doc)
    .then(function(){
      var idx = S.docs.findIndex(function(d){ return d._id===doc._id; });
      if(idx!==-1) S.docs[idx]=doc;
      else S.docs.push(doc);
      updateCounts();
      renderGrid();
      hide($('reviewModal'));
      hide($('editModal'));
      toast('Document saved successfully');
    })
    .catch(function(e){ toast('Save failed: '+e.message,'error'); })
    .finally(function(){
      $('confirmSave').disabled=false;
      $('confirmSave').innerHTML='<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg> Confirm &amp; Save';
      S._pendingSave = null;
    });
};

// ── diff helpers ──────────────────────────────────────────────────────────────
function diffDocs(original, current){
  if(!original) return [{field:'(new document)', from:'—', to:JSON.stringify(current).substring(0,80)+'...'}];
  var changes = [];
  diffObj('', original, current, changes);
  return changes;
}
function diffObj(prefix, a, b, out){
  var allKeys = {};
  Object.keys(a||{}).forEach(function(k){ allKeys[k]=true; });
  Object.keys(b||{}).forEach(function(k){ allKeys[k]=true; });
  Object.keys(allKeys).forEach(function(k){
    var path = prefix ? prefix+'.'+k : k;
    var va = a ? a[k] : undefined;
    var vb = b ? b[k] : undefined;
    if(va === vb) return;
    var sa = JSON.stringify(va);
    var sb = JSON.stringify(vb);
    if(sa === sb) return;
    if(typeof va === 'object' && typeof vb === 'object' && va !== null && vb !== null && !Array.isArray(va) && !Array.isArray(vb)){
      diffObj(path, va, vb, out);
    } else {
      out.push({field:path, from:fmtDiff(va), to:fmtDiff(vb)});
    }
  });
}
function fmtDiff(v){
  if(v===undefined) return '<em class="text-slate-400">undefined</em>';
  if(v===null)      return '<em class="text-slate-400">null</em>';
  var s = JSON.stringify(v);
  if(s.length>120) s = s.substring(0,120)+'...';
  return '<code class="text-xs bg-slate-100 px-1 rounded break-all">'+esc(s)+'</code>';
}

function renderReviewSummary(doc, changes){
  var html = '<div class="mb-4">' +
    '<p class="text-xs text-slate-500 mb-1">Document</p>' +
    '<p class="font-semibold text-sm text-slate-800 font-mono">'+esc(doc._id)+' <span class="text-slate-400">/ '+esc(doc.config_type)+'</span></p>' +
  '</div>';
  if(!changes.length){
    html += '<div class="bg-green-50 border border-green-200 rounded-lg p-4 text-center text-sm text-green-700">' +
      '<svg class="w-5 h-5 inline-block mr-1 -mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>' +
      'No changes detected — document is identical to the saved version.' +
    '</div>';
    return html;
  }
  html += '<p class="text-xs text-slate-500 mb-2">'+changes.length+' change'+(changes.length>1?'s':'')+' detected:</p>';
  html += '<div class="border border-slate-200 rounded-lg overflow-hidden">';
  html += '<table class="w-full text-xs"><thead class="bg-slate-50"><tr>' +
    '<th class="text-left px-3 py-2 text-slate-500 font-semibold">Field</th>' +
    '<th class="text-left px-3 py-2 text-red-400 font-semibold">Before</th>' +
    '<th class="text-left px-3 py-2 text-emerald-500 font-semibold">After</th>' +
  '</tr></thead><tbody>';
  changes.forEach(function(c, i){
    var stripe = i%2===0 ? 'bg-white' : 'bg-slate-50';
    html += '<tr class="'+stripe+' border-t border-slate-100">' +
      '<td class="px-3 py-2 font-mono text-slate-700 align-top whitespace-nowrap">'+esc(c.field)+'</td>' +
      '<td class="px-3 py-2 text-red-600 align-top">'+c.from+'</td>' +
      '<td class="px-3 py-2 text-emerald-600 align-top">'+c.to+'</td>' +
    '</tr>';
  });
  html += '</tbody></table></div>';
  html += '<div class="mt-4 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-700">' +
    '<strong>Warning:</strong> This will overwrite the live configuration. Please double-check all values above before confirming.' +
  '</div>';
  return html;
}

// ── form helpers ──────────────────────────────────────────────────────────────
function fRow(labelHtml, inputHtml, hint){
  return '<div>' +
    '<label class="label">'+labelHtml+'</label>' +
    inputHtml +
    (hint ? '<p class="text-xs text-slate-400 mt-0.5">'+hint+'</p>' : '') +
  '</div>';
}

function selectHTML(id, options, selected){
  return '<select id="'+id+'" class="form-input">' +
    options.map(function(o){ return '<option value="'+o+'"'+(o===selected?' selected':'')+'>'+o+'</option>'; }).join('') +
  '</select>';
}

function fArr2Str(v){
  if(!v) return 'all';
  if(v==='all') return 'all';
  if(Array.isArray(v)) return v;
  return 'all';
}

function nvl(v, def){ return (v===null||v===undefined) ? def : v; }

// ── init ──────────────────────────────────────────────────────────────────────
$('loginBtn').onclick = doLogin;
$('passkeyInput').onkeydown = function(e){ if(e.key==='Enter') doLogin(); };
$('logoutBtn').onclick = doLogout;

// Close modal on backdrop click
$('editModal').addEventListener('click', function(e){ if(e.target===$('editModal')) hide($('editModal')); });
$('deleteModal').addEventListener('click', function(e){ if(e.target===$('deleteModal')){ hide($('deleteModal')); S.deleteId=null; } });

// Auto-login if token present
if(S.token){ showApp(); }
</script>
</body>
</html>`;

module.exports = adminHTML;
