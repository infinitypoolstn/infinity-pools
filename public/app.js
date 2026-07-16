/* Infinity Pools — admin SPA */
'use strict';

let S = null; // bootstrap state
// Dashboard Projects list: current filter / search / sort (persists across re-renders)
const dashUI = { filter: 'all', q: '', sortKey: 'address', sortDir: 1 };
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
const fmtDateTime = d => d ? new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—';
const ago = d => { const m = (Date.now() - new Date(d)) / 60000; if (m < 60) return Math.max(1, m | 0) + 'm ago'; if (m < 1440) return (m / 60 | 0) + 'h ago'; return (m / 1440 | 0) + 'd ago'; };

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || ('HTTP ' + res.status));
  return json;
}

async function reload() { S = await api('GET', '/api/bootstrap'); }

function toast(msg, err = false) {
  const t = document.createElement('div');
  t.className = 'toast' + (err ? ' err' : '');
  t.textContent = msg;
  $('#toastRoot').appendChild(t);
  setTimeout(() => t.remove(), err ? 6500 : 3500);
}

function modal(html, onMount) {
  const root = $('#modalRoot');
  root.innerHTML = `<div class="modal-bg"><div class="modal">${html}</div></div>`;
  root.querySelector('.modal-bg').addEventListener('click', e => { if (e.target.classList.contains('modal-bg')) closeModal(); });
  if (onMount) onMount(root);
}
function closeModal() { $('#modalRoot').innerHTML = ''; }

const client = id => S.clients.find(c => c.id === id);
const phasePct = c => Math.round(100 * c.phases.filter(p => p.status === 'complete').length / c.phases.length);
const statusLabel = { prospect: 'Prospect', contract_sent: 'Contract Sent', active: 'In Build', completed: 'Completed', lost: 'Lost' };

/* ============================== ROUTER ============================== */
async function route() {
  if (!S) await reload();
  const hash = location.hash.slice(2) || '';
  const [view, id, tab] = hash.split('/');
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('active', (a.dataset.view === (view || 'dashboard')) || (view === 'client' && a.dataset.view === 'clients')));
  const unread = S.alerts.filter(a => !a.read).length;
  const badge = $('#alertBadge');
  badge.style.display = unread ? '' : 'none';
  badge.textContent = unread;
  const views = { '': vDashboard, clients: vClients, client: () => vClient(id, tab), tasks: vTasks, employees: vEmployees, contractors: vContractors, design: vDesign, alerts: vAlerts, settings: vSettings, eula: vEula, privacy: vPrivacy };
  (views[view || ''] || vDashboard)();
}
window.addEventListener('hashchange', route);

/* ============================== DASHBOARD ============================== */
function vDashboard() {
  // Test jobs are excluded from the metric totals below (they still show in the Projects list).
  const real = S.clients.filter(c => !c.testMode);
  const active = real.filter(c => c.status === 'active');
  const prospects = real.filter(c => ['prospect', 'contract_sent'].includes(c.status));
  const signed = real.filter(c => ['active', 'completed'].includes(c.status));
  const pipeline = prospects.reduce((a, c) => a + c._quote, 0);
  const contracted = signed.reduce((a, c) => a + c._quote + c._coTotal, 0);
  const collectedTotal = signed.reduce((a, c) => a + c._collected, 0);
  const outstanding = active.reduce((a, c) => a + c.phases.filter(p => p.paymentRequestedAt && !p.paymentReceivedAt).reduce((x, p) => x + c._quote * p.drawPct / 100, 0), 0);
  const costs = signed.reduce((a, c) => a + c._costs, 0);
  const profit = contracted - costs;
  const today = new Date().toISOString().slice(0, 10);
  const testIds = new Set(S.clients.filter(c => c.testMode).map(c => c.id));
  const overdueTasks = S.tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today && !testIds.has(t.clientId));
  const soon = new Date(); soon.setDate(soon.getDate() + 7);
  const phasesDueSoon = active.flatMap(c => c.phases.filter(p => p.status === 'active' && p.dueDate && p.dueDate <= soon.toISOString().slice(0, 10)).map(p => ({ c, p })))
    .sort((a, b) => String(a.p.dueDate).localeCompare(String(b.p.dueDate)));
  const coTotal = signed.reduce((a, c) => a + c._coTotal, 0);
  const completed = real.filter(c => c.status === 'completed');
  const overdueSorted = overdueTasks.slice().sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
  const cById = Object.fromEntries(S.clients.map(c => [c.id, c]));

  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <h1 style="margin:0">Dashboard</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary" onclick="createTestJob()" title="Create a sample project you can step through end to end — no QuickBooks invoice is ever created">🧪 Create Test Job</button>
        <a class="btn secondary" href="/api/forms/pool-spec-intake.pdf" target="_blank" title="Blank, fillable Pool Specs form to send to a sales rep">⬇ Sales Rep Form</a>
        <button class="btn" onclick="addProspect()">＋ Add New Prospect</button>
      </div>
    </div>
    ${!S.gmailConfigured ? '<div class="banner warn" style="margin-top:14px">📧 Gmail is not connected yet — emails are logged but not sent. Set it up in <a href="#/settings">Settings → Email</a>.</div>' : ''}
    <div class="row" style="margin-top:16px;align-items:flex-start">
    <div class="card grow" style="background:var(--blue-pale);min-width:330px;margin-bottom:0">
      <h2>Builds &amp; Prospects</h2>
      <div class="row">
        <div class="metric"><div class="v">${active.length}</div><div class="l">Active Builds</div></div>
        <div class="metric"><div class="v">${prospects.length}</div><div class="l">Prospects</div></div>
        <div class="metric"><div class="v">${completed.length}</div><div class="l">Completed</div></div>
        <div class="metric"><div class="v">${real.length}</div><div class="l">Total Projects</div></div>
      </div>
    </div>
    <div class="card grow" style="background:var(--blue-pale);min-width:330px;margin-bottom:0">
      <h2>Financials</h2>
      <div class="row">
        <div class="metric"><div class="v">${money(pipeline)}</div><div class="l">Pipeline Value</div></div>
        <div class="metric"><div class="v">${money(contracted)}</div><div class="l">Contracted + COs</div></div>
        <div class="metric good"><div class="v">${money(collectedTotal)}</div><div class="l">Collected</div></div>
        <div class="metric warn"><div class="v">${money(outstanding)}</div><div class="l">Outstanding Draws</div></div>
        <div class="metric"><div class="v">${money(coTotal)}</div><div class="l">Change Orders</div></div>
        <div class="metric ${profit >= 0 ? 'good' : 'bad'}"><div class="v">${money(profit)}</div><div class="l">Est. Profit (signed jobs)</div></div>
      </div>
    </div>
    <div class="card grow" style="background:var(--blue-pale);min-width:330px;margin-bottom:0">
      <h2>Tasks &amp; Deadlines</h2>
      <div class="row">
        <div class="metric ${overdueTasks.length ? 'bad' : ''}"><div class="v">${overdueTasks.length}</div><div class="l">Overdue Tasks</div></div>
        <div class="metric ${phasesDueSoon.length ? 'warn' : ''}"><div class="v">${phasesDueSoon.length}</div><div class="l">Phases Due ≤ 7d</div></div>
      </div>
      <div class="row" style="margin-top:14px">
        <div class="card grow" style="margin:0;min-width:200px">
          <h3 style="margin-top:0">⚠ Overdue Tasks</h3>
          ${overdueSorted.length ? `<ul style="margin:0;padding-left:18px;font-size:13px">${overdueSorted.slice(0, 6).map(t => {
            const cl = cById[t.clientId];
            return `<li style="margin:3px 0">${cl ? `<a href="#/client/${t.clientId}">${esc(t.title)}</a>` : esc(t.title)} <span class="muted">· ${cl ? esc(cl.address || cl.name) + ' · ' : ''}due ${fmtDate(t.dueDate)}</span></li>`;
          }).join('')}</ul>${overdueSorted.length > 6 ? `<p class="muted" style="margin:6px 0 0">+ ${overdueSorted.length - 6} more — see <a href="#/tasks">Tasks</a></p>` : ''}` : '<p class="muted" style="margin:0">Nothing overdue 🎉</p>'}
        </div>
        <div class="card grow" style="margin:0;min-width:200px">
          <h3 style="margin-top:0">📅 Phases Due ≤ 7 Days</h3>
          ${phasesDueSoon.length ? `<ul style="margin:0;padding-left:18px;font-size:13px">${phasesDueSoon.slice(0, 6).map(({ c, p }) =>
            `<li style="margin:3px 0"><a href="#/client/${c.id}">${esc(c.address || c.name)}</a> <span class="muted">· ${esc(p.name)} · due ${fmtDate(p.dueDate)}</span></li>`).join('')}</ul>${phasesDueSoon.length > 6 ? `<p class="muted" style="margin:6px 0 0">+ ${phasesDueSoon.length - 6} more</p>` : ''}` : '<p class="muted" style="margin:0">Nothing due this week.</p>'}
        </div>
      </div>
    </div>
    </div>
    <div class="row">
      <div class="card grow" style="min-width:380px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap">
          <h2 style="margin:0">Projects</h2>
          ${S.clients.length ? `<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input class="input" id="dashSearch" placeholder="Search address or name…" value="${esc(dashUI.q)}" oninput="dashSearch(this.value)" style="max-width:200px">
            <select class="input" id="dashFilter" onchange="dashSetFilter(this.value)" style="max-width:150px">
              ${DASH_FILTERS.map(([v, l]) => `<option value="${v}" ${dashUI.filter === v ? 'selected' : ''}>${l}</option>`).join('')}
            </select>
          </div>` : ''}
        </div>
        <div id="dashProjects" style="margin-top:10px">${S.clients.length ? dashProjectsHTML() : '<p class="muted">No clients yet — click <b>Add New Prospect</b> to create your first one.</p>'}</div>
      </div>
    </div>`;
}

// Dashboard Projects — filter options and sortable columns.
const DASH_FILTERS = [['all', 'All statuses'], ['prospect', 'Prospect'], ['contract_sent', 'Contract Sent'], ['active', 'In Build'], ['completed', 'Completed'], ['lost', 'Lost']];
const DASH_STATUS_ORDER = { prospect: 0, contract_sent: 1, active: 2, completed: 3, lost: 4 };
// [sortKey, header label, alignment]
const DASH_COLS = [
  ['address', 'Address', ''], ['status', 'Status', ''], ['phase', 'Current Phase', ''], ['progress', 'Progress', ''],
  ['quote', 'Quote', 'right'], ['co', 'Change Orders', 'right'], ['costs', 'Costs', 'right'], ['profit', 'Profit', 'right'],
];
function dashSortVal(c, key) {
  switch (key) {
    case 'address': return (c.address || c.name || '').toLowerCase();
    case 'status': return DASH_STATUS_ORDER[c.status] ?? 99;
    case 'phase': return (c._currentPhase ? c._currentPhase.name : '').toLowerCase();
    case 'progress': return phasePct(c);
    case 'quote': return c._quote;
    case 'co': return c._coTotal;
    case 'costs': return c._costs;
    case 'profit': return c._quote + c._coTotal - c._costs;
    default: return 0;
  }
}
function dashProjectsHTML() {
  const q = dashUI.q.trim().toLowerCase();
  let list = S.clients.filter(c =>
    (dashUI.filter === 'all' || c.status === dashUI.filter) &&
    (!q || (c.address || '').toLowerCase().includes(q) || (c.name || '').toLowerCase().includes(q)));
  const dir = dashUI.sortDir;
  list = list.slice().sort((a, b) => {
    const va = dashSortVal(a, dashUI.sortKey), vb = dashSortVal(b, dashUI.sortKey);
    const cmp = typeof va === 'string' ? va.localeCompare(vb) : (va - vb);
    return cmp * dir || (a.address || '').localeCompare(b.address || '');
  });
  const arrow = k => dashUI.sortKey === k ? (dashUI.sortDir > 0 ? ' ▲' : ' ▼') : '';
  const head = DASH_COLS.map(([k, label, align]) =>
    `<th class="${align}" style="cursor:pointer;white-space:nowrap" onclick="dashSort('${k}')" title="Sort by ${label}">${label}${arrow(k)}</th>`).join('');
  if (!list.length) return `<table class="tbl"><thead><tr>${head}</tr></thead></table><p class="muted" style="margin-top:8px">No projects match this filter.</p>`;
  const rows = list.map(c => {
    const profit = c._quote + c._coTotal - c._costs;
    return `<tr style="cursor:pointer" onclick="location.hash='#/client/${c.id}'">
      <td>${c.testMode ? '<span class="chip" style="background:#fde8c8;color:#8a5a10;margin-right:6px">🧪 TEST</span>' : ''}<b>${esc(c.address) || '<i>no address</i>'}</b><div class="muted">${esc(c.name)}</div></td>
      <td><span class="chip ${c.status}">${statusLabel[c.status]}</span>${c.targetFinishDate ? `<div class="muted">🎯 finish ${fmtDate(c.targetFinishDate)}</div>` : ''}</td>
      <td>${c._currentPhase ? `<span class="chip phase">${esc(c._currentPhase.name)}</span>${c._currentPhase.dueDate ? `<div class="muted">due ${fmtDate(c._currentPhase.dueDate)}</div>` : ''}` : c.status === 'completed' ? '🏁 Done' : '—'}</td>
      <td><div class="progress"><div style="width:${phasePct(c)}%"></div></div></td>
      <td class="right money">${money(c._quote)}</td>
      <td class="right money">${c._coTotal ? money(c._coTotal) : '—'}</td>
      <td class="right money">${c._costs ? money(c._costs) : '—'}</td>
      <td class="right money" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${money(profit)}</td>
    </tr>`;
  }).join('');
  return `<table class="tbl"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>
    <p class="muted" style="margin-top:8px;font-size:12px">Showing ${list.length} of ${S.clients.length} project${S.clients.length === 1 ? '' : 's'}.</p>`;
}
function renderDashProjects() { const el = $('#dashProjects'); if (el) el.innerHTML = dashProjectsHTML(); }
window.dashSearch = function (v) { dashUI.q = v; renderDashProjects(); };
window.dashSetFilter = function (v) { dashUI.filter = v; renderDashProjects(); };
window.dashSort = function (key) {
  if (dashUI.sortKey === key) dashUI.sortDir *= -1;
  else { dashUI.sortKey = key; dashUI.sortDir = 1; }
  renderDashProjects();
};

window.createTestJob = async function () {
  if (!confirm('Create a TEST job?\n\nIt comes pre-filled with sample specs so you can step through the whole workflow — send/sign the contract, run phases, request payments. No QuickBooks invoice is ever created for a test job. Emails go to your company address. Delete it any time.')) return;
  try {
    const c = await api('POST', '/api/clients/test-job', {});
    await reload();
    location.hash = '#/client/' + c.id;
    toast('🧪 Test job created — invoicing is disabled for it');
  } catch (e) { toast(e.message, true); }
};

window.addProspect = function () {
  modal(`<h2>Add New Prospect</h2>
    <div class="card" style="background:var(--blue-pale);margin-bottom:14px">
      <b>Have a filled Sales Rep Form?</b>
      <p class="muted" style="margin:4px 0 8px">Upload the completed PDF to create the project with its contact info and Pool Specs pre-filled — you can review and edit everything after.</p>
      <div class="row" style="align-items:center;gap:8px">
        <input type="file" id="pIntake" accept="application/pdf" class="grow">
        <button class="btn secondary small" id="pIntakeBtn">⬆ Upload &amp; Create</button>
      </div>
    </div>
    <p class="muted" style="margin:0 0 8px">…or enter the details manually:</p>
    <label class="fld">Client Name<input type="text" id="pName" placeholder="John & Jane Smith"></label>
    <label class="fld">Address<input type="text" id="pAddr" placeholder="1533 Harding Pl, Nashville TN"></label>
    <label class="fld">Email<input type="email" id="pEmail"></label>
    <label class="fld">Phone<input type="tel" id="pPhone"></label>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
      <button class="btn" id="pSave">Save & Open Client Page</button>
    </div>`, root => {
    root.querySelector('#pIntakeBtn').onclick = async () => {
      const f = $('#pIntake').files[0];
      if (!f) return toast('Choose a completed PDF first', true);
      const btn = root.querySelector('#pIntakeBtn');
      btn.disabled = true; btn.textContent = 'Reading form…';
      try {
        const fd = new FormData(); fd.append('file', f);
        const c = await api('POST', '/api/prospects/from-intake', fd);
        await reload(); closeModal();
        location.hash = '#/client/' + c.id;
        toast('Project created from form — review the Pool Specs');
      } catch (e) { toast(e.message, true); btn.disabled = false; btn.textContent = '⬆ Upload & Create'; }
    };
    root.querySelector('#pSave').onclick = async () => {
      const name = $('#pName').value.trim();
      if (!name) return toast('Client name is required', true);
      try {
        const c = await api('POST', '/api/clients', { name, address: $('#pAddr').value.trim(), email: $('#pEmail').value.trim(), phone: $('#pPhone').value.trim() });
        await reload(); closeModal();
        location.hash = '#/client/' + c.id;
        toast('Prospect created');
      } catch (e) { toast(e.message, true); }
    };
    $('#pName').focus();
  });
};

/* ============================== CLIENTS LIST ============================== */
function vClients() {
  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h1 style="margin:0">Clients</h1>
      <button class="btn" onclick="addProspect()">＋ Add New Prospect</button>
    </div>
    <div class="card" style="margin-top:16px">
      <table class="tbl"><thead><tr><th>Client</th><th>Address</th><th>Email / Phone</th><th>Status</th><th class="right">Quote + COs</th><th></th></tr></thead><tbody>
      ${S.clients.map(c => `<tr>
        <td><b>${esc(c.name)}</b></td><td>${esc(c.address)}</td>
        <td>${esc(c.email)}<div class="muted">${esc(c.phone)}</div></td>
        <td><span class="chip ${c.status}">${statusLabel[c.status]}</span></td>
        <td class="right money">${money(c._quote + c._coTotal)}</td>
        <td class="right"><a class="btn small" href="#/client/${c.id}">Open</a></td>
      </tr>`).join('') || '<tr><td colspan="6" class="muted">No clients yet.</td></tr>'}
      </tbody></table>
    </div>`;
}

/* ============================== CLIENT DETAIL ============================== */
const TABS = [['specs', 'Pool Specs'], ['scope', 'Scope of Work'], ['design', 'Design'], ['finance', 'Finance'], ['files', 'Files'], ['contract', 'Contract & Phases'], ['tasks', 'Tasks'], ['changes', 'Change Orders'], ['costs', 'Costs (Internal)'], ['portal', 'Client Portal']];

function vClient(id, tab = 'specs') {
  const c = client(id);
  if (!c) { $('#main').innerHTML = '<p>Client not found. <a href="#/clients">Back</a></p>'; return; }
  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:10px">
      <div>
        <h1 style="margin:0 0 2px">${c.testMode ? '<span class="chip" style="background:#fde8c8;color:#8a5a10;vertical-align:middle;margin-right:8px">🧪 TEST</span>' : ''}${esc(c.address) || esc(c.name)}</h1>
        <div class="muted">${esc(c.name)} · ${esc(c.email)} · ${esc(c.phone)} &nbsp; <span class="chip ${c.status}">${statusLabel[c.status]}</span>
        ${c._currentPhase ? ` <span class="chip phase">${esc(c._currentPhase.name)}</span>` : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary small" onclick="editClientInfo('${c.id}')">✏️ Edit Info</button>
        <a class="btn secondary small" href="/api/clients/${c.id}/contract.pdf" target="_blank">⬇ Contract PDF</a>
      </div>
    </div>
    ${c.testMode ? '<div class="banner" style="margin-top:12px;background:#fef4dc;border:1px solid #f3e3b5;color:#8a5a10">🧪 <b>Test job.</b> Step through any part of the workflow freely — <b>no QuickBooks invoice is ever created</b> for this project. Delete it when you\'re done.</div>' : ''}
    ${c.specsLocked ? '<div class="banner lock" style="margin-top:12px">🔒 Contract signed — pool specs and pricing are locked. All changes must be entered as <a href="#/client/' + c.id + '/changes">Change Orders</a>.</div>' : ''}
    <div class="tabs" style="margin-top:14px">
      ${TABS.map(([k, l]) => `<button class="${k === tab ? 'active' : ''}" onclick="location.hash='#/client/${c.id}/${k}'">${l}</button>`).join('')}
    </div>
    <div id="tabBody"></div>`;
  ({ specs: tSpecs, scope: tScope, design: tDesign, finance: tFinance, files: tFiles, contract: tContract, tasks: tTasks, changes: tChanges, costs: tCosts, portal: tPortal }[tab] || tSpecs)(c);
}

window.editClientInfo = function (id) {
  const c = client(id);
  modal(`<h2>Edit Client Info</h2>
    <label class="fld">Client Name<input type="text" id="eName" value="${esc(c.name)}"></label>
    <label class="fld">Address<input type="text" id="eAddr" value="${esc(c.address)}"></label>
    <label class="fld">Email<input type="email" id="eEmail" value="${esc(c.email)}"></label>
    <label class="fld">Phone<input type="tel" id="ePhone" value="${esc(c.phone)}"></label>
    <label class="fld">Status<select id="eStatus">${Object.entries(statusLabel).map(([k, v]) => `<option value="${k}" ${c.status === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
    <label class="fld">Target Finish Date<input type="date" id="eFinish" value="${c.targetFinishDate || ''}"></label>
    <div style="display:flex;gap:10px;justify-content:space-between;margin-top:14px">
      <span><button class="btn danger" onclick="deleteClient('${c.id}')">Delete</button>
      <button class="btn secondary" onclick="startOverProject('${c.id}')">Cancel / Start Over</button></span>
      <span><button class="btn secondary" onclick="closeModal()">Close</button>
      <button class="btn" onclick="saveClientInfo('${c.id}')">Save</button></span>
    </div>`);
};
window.saveClientInfo = async function (id) {
  try {
    await api('PUT', '/api/clients/' + id, { name: $('#eName').value, address: $('#eAddr').value, email: $('#eEmail').value, phone: $('#ePhone').value, status: $('#eStatus').value, targetFinishDate: $('#eFinish').value || null });
    await reload(); closeModal(); route(); toast('Saved');
  } catch (e) { toast(e.message, true); }
};
window.deleteClient = async function (id) {
  if (!confirm('Delete this client and all their data? This cannot be undone.')) return;
  await api('DELETE', '/api/clients/' + id); await reload(); closeModal(); location.hash = '#/clients';
};
window.startOverProject = async function (id) {
  if (!confirm('Cancel / Start Over this build?\n\nClears: all phases, the contract (un-signs it), payments, change orders, and QuickBooks links.\nKeeps: the client, contact info, address, quote/pricing, specs, finishes, and files.\n\nThis cannot be undone. Note: any QuickBooks estimate or invoices already created are NOT deleted — void those in QuickBooks if needed.')) return;
  try {
    await api('POST', '/api/clients/' + id + '/reset');
    await reload(); closeModal(); route(); toast('Build reset — ready to start over');
  } catch (e) { toast(e.message, true); }
};

/* ---------- Specs tab ---------- */
function tSpecs(c) {
  const s = c.specs, dis = c.specsLocked ? 'disabled' : '';
  const pb = s.poolBase || {}, spa = s.spaBase || {}, fl = s.fireLounge || {}, wf = s.waterFeature || {}, cp = s.coldPlunge || {}, ff = s.fireFeature || {};
  const ss = pb.sunShelf || {}, ls = pb.ledgeSeating || {}, sp = pb.spillover || {};
  const sumItems = arr => (arr || []).reduce((a, x) => a + (Number(x.price) || 0), 0);
  // live running total of every priced section that's included (plus its line items)
  const initial = (Number(pb.price) || 0)
    + (spa.included ? (Number(spa.price) || 0) + sumItems(spa.items) : 0)
    + (fl.included ? (Number(fl.price) || 0) + sumItems(fl.items) : 0)
    + (wf.included ? (Number(wf.price) || 0) : 0)
    + (cp.included ? (Number(cp.price) || 0) + sumItems(cp.items) : 0)
    + (ff.included ? (Number(ff.price) || 0) : 0)
    + sumItems(s.addOns);
  const price = (idAttr, val) => `<label class="fld" style="max-width:170px">Price ($)<input type="number" step="0.01" min="0" id="${idAttr}" value="${val || ''}" ${dis} oninput="spQuote()"></label>`;
  const incHead = (incId, label, priceId, inc, val) => `
    <div class="row" style="justify-content:space-between;align-items:center">
      <label class="check" style="margin:0"><input type="checkbox" id="${incId}" ${inc ? 'checked' : ''} ${dis} onchange="spQuote()"> Include ${label}</label>
      ${price(priceId, val)}
    </div>`;
  const detailSection = (incId, label, priceId, inc, val, detId, det) => `
    <div class="card">
      ${incHead(incId, label, priceId, inc, val)}
      <div class="row"><label class="fld grow">Size and Details<input type="text" id="${detId}" value="${esc(det)}" ${dis}></label></div>
    </div>`;
  // A section's extra priced line items (label + details + price) that roll into the
  // quote. `secKey` prefixes the container id (spa_items / fl_items / cp_items).
  const subItemRow = it => `
    <div class="row" data-subitem style="align-items:flex-end">
      <label class="fld grow">Item<input type="text" class="subitem-label" value="${esc(it.label)}" placeholder="e.g. Heater" ${dis}></label>
      <label class="fld grow">Details<input type="text" class="subitem-value" value="${esc(it.value)}" ${dis}></label>
      <label class="fld" style="max-width:160px">Price ($)<input type="number" step="0.01" min="0" class="subitem-price" value="${it.price || ''}" ${dis} oninput="spQuote()"></label>
      ${!c.specsLocked ? '<button class="btn danger small" style="margin-bottom:12px" onclick="this.closest(\'[data-subitem]\').remove();spQuote()">✕</button>' : ''}
    </div>`;
  const subItemsBlock = (secKey, items) => `
    <div style="margin-top:6px">
      <div id="${secKey}_items">${(items || []).map(subItemRow).join('')}</div>
      ${!c.specsLocked ? `<button class="btn secondary small" onclick="addSubItemRow('${secKey}_items')">＋ Add priced item</button>` : ''}
    </div>`;
  $('#tabBody').innerHTML = `
    <div class="card" style="display:flex;justify-content:space-between;align-items:center;background:var(--blue-soft)">
      <h2 style="margin:0">Price Quote</h2>
      <span class="total-line" id="spQuoteEl">${money(initial)}</span>
    </div>

    <div class="card">
      <div class="row" style="justify-content:space-between;align-items:center">
        <h2 style="margin:0">Pool Base</h2>
        ${price('pb_price', pb.price)}
      </div>
      <div class="row">
        <label class="fld" style="max-width:200px">Shape<select id="pb_shape" ${dis} onchange="document.getElementById('pb_freeformWrap').style.display=this.value==='freeform'?'':'none'">
          <option value="geometric" ${pb.shape === 'geometric' ? 'selected' : ''}>Geometric</option>
          <option value="freeform" ${pb.shape === 'freeform' ? 'selected' : ''}>Freeform</option></select></label>
        <label class="fld grow" id="pb_freeformWrap" style="${pb.shape === 'freeform' ? '' : 'display:none'}">Freeform details<input type="text" id="pb_freeform" value="${esc(pb.freeform)}" ${dis}></label>
      </div>
      <div class="row">
        <label class="fld grow">Size<input type="text" id="pb_size" value="${esc(pb.size)}" ${dis}></label>
      </div>
      <div class="row">
        <label class="fld grow">Depth<input type="text" id="pb_depth" value="${esc(pb.depth)}" ${dis}></label>
      </div>
      <div class="row">
        <label class="fld grow">Number of Jets<input type="text" id="pb_jets" value="${esc(pb.jets)}" ${dis}></label>
        <label class="fld grow">Hayward Colorlogic 320 LED Lights<input type="text" id="pb_led" value="${esc(pb.ledLights)}" ${dis}></label>
      </div>
      <div class="row">
        <label class="fld grow">Equipment pad location<input type="text" id="pb_equippad" value="${esc(s.equipmentPad)}" ${dis}></label>
      </div>
      <div style="margin-top:6px">
        <label class="check"><input type="checkbox" id="pb_sunshelf_inc" ${ss.included ? 'checked' : ''} ${dis} onchange="document.getElementById('pb_sunshelf_wrap').style.display=this.checked?'':'none'"> Sun Shelf</label>
        <div id="pb_sunshelf_wrap" class="row" style="${ss.included ? '' : 'display:none'}"><label class="fld grow">Sun Shelf details<input type="text" id="pb_sunshelf_det" value="${esc(ss.details)}" ${dis}></label></div>
      </div>
      <div style="margin-top:6px">
        <label class="check"><input type="checkbox" id="pb_spillover_inc" ${sp.included ? 'checked' : ''} ${dis} onchange="document.getElementById('pb_spillover_wrap').style.display=this.checked?'':'none'"> Spillover</label>
        <div id="pb_spillover_wrap" class="row" style="${sp.included ? '' : 'display:none'}"><label class="fld grow">Spillover details<input type="text" id="pb_spillover_det" value="${esc(sp.details)}" ${dis}></label></div>
      </div>
      <div style="margin-top:6px">
        <label class="check"><input type="checkbox" id="pb_ledge_inc" ${ls.included ? 'checked' : ''} ${dis} onchange="document.getElementById('pb_ledge_wrap').style.display=this.checked?'':'none'"> Ledge / Seating</label>
        <div id="pb_ledge_wrap" class="row" style="${ls.included ? '' : 'display:none'}"><label class="fld grow">Ledge / Seating details<input type="text" id="pb_ledge_det" value="${esc(ls.details)}" ${dis}></label></div>
      </div>
    </div>

    <div class="card">
      ${incHead('spa_inc', 'Spa Base', 'spa_price', spa.included, spa.price)}
      <div class="row">
        <label class="fld grow">Size<input type="text" id="spa_size" value="${esc(spa.size)}" ${dis}></label>
        <label class="fld grow">Number of Jets<input type="text" id="spa_jets" value="${esc(spa.jets)}" ${dis}></label>
        <label class="fld grow">Hayward Colorlogic 320 LED Lights<input type="text" id="spa_led" value="${esc(spa.ledLights)}" ${dis}></label>
      </div>
      <div class="row"><label class="fld grow">Additional Details<input type="text" id="spa_det" value="${esc(spa.details)}" ${dis}></label></div>
      ${subItemsBlock('spa', spa.items)}
    </div>

    <div class="card">
      ${incHead('fl_inc', 'Fire Lounge', 'fl_price', fl.included, fl.price)}
      <div class="row">
        <label class="fld grow">Size<input type="text" id="fl_size" value="${esc(fl.size)}" ${dis}></label>
      </div>
      <div class="row"><label class="fld grow">Additional Details<input type="text" id="fl_det" value="${esc(fl.details)}" ${dis}></label></div>
      ${subItemsBlock('fl', fl.items)}
    </div>

    ${detailSection('wf_inc', 'Water Feature', 'wf_price', wf.included, wf.price, 'wf_det', wf.details)}
    <div class="card">
      ${incHead('cp_inc', 'Cold Plunge', 'cp_price', cp.included, cp.price)}
      <div class="row">
        <label class="fld grow">Size and Details<input type="text" id="cp_det" value="${esc(cp.details)}" ${dis}></label>
        <label class="fld grow">Hayward Colorlogic 320 LED Lights<input type="text" id="cp_led" value="${esc(cp.ledLights)}" ${dis}></label>
      </div>
      <div class="row"><label class="fld grow">Additional Details<input type="text" id="cp_addl" value="${esc(cp.additionalDetails)}" ${dis}></label></div>
      ${subItemsBlock('cp', cp.items)}
    </div>
    ${detailSection('ff_inc', 'Fire Feature', 'ff_price', ff.included, ff.price, 'ff_det', ff.details)}

    <div class="card">
      <h2>Add-Ons</h2>
      <div id="addOnList">${(s.addOns || []).map(a => `
        <div class="row" data-addon style="align-items:flex-end">
          <label class="fld grow">Add-on<input type="text" class="ao-label" value="${esc(a.label)}" ${dis}></label>
          <label class="fld grow">Details<input type="text" class="ao-value" value="${esc(a.value)}" ${dis}></label>
          <label class="fld" style="max-width:160px">Price ($)<input type="number" step="0.01" min="0" class="ao-price" value="${a.price || ''}" ${dis} oninput="spQuote()"></label>
          ${!c.specsLocked ? '<button class="btn danger small" style="margin-bottom:12px" onclick="this.closest(\'[data-addon]\').remove();spQuote()">✕</button>' : ''}
        </div>`).join('')}</div>
      ${!c.specsLocked ? '<button class="btn secondary small" onclick="addAddonRow()">＋ Add new field</button>' : ''}
    </div>
    ${!c.specsLocked ? `<button class="btn" onclick="saveSpecs('${c.id}')">💾 Save Pool Specs</button>` : '<p class="muted">🔒 Locked — contract signed. Use Change Orders for modifications.</p>'}`;
}
window.spQuote = function () {
  const v = i => { const el = document.getElementById(i); return el ? Number(el.value) || 0 : 0; };
  const on = i => { const el = document.getElementById(i); return el ? el.checked : false; };
  const sub = id => { const el = document.getElementById(id); return el ? [...el.querySelectorAll('.subitem-price')].reduce((a, i) => a + (Number(i.value) || 0), 0) : 0; };
  let t = v('pb_price');
  if (on('spa_inc')) t += v('spa_price') + sub('spa_items');
  if (on('fl_inc')) t += v('fl_price') + sub('fl_items');
  if (on('wf_inc')) t += v('wf_price');
  if (on('cp_inc')) t += v('cp_price') + sub('cp_items');
  if (on('ff_inc')) t += v('ff_price');
  t += [...document.querySelectorAll('.ao-price')].reduce((a, i) => a + (Number(i.value) || 0), 0);
  const el = document.getElementById('spQuoteEl'); if (el) el.textContent = money(t);
};
window.addSubItemRow = function (containerId) {
  const el = document.getElementById(containerId); if (!el) return;
  el.insertAdjacentHTML('beforeend', `
    <div class="row" data-subitem style="align-items:flex-end">
      <label class="fld grow">Item<input type="text" class="subitem-label" placeholder="e.g. Heater"></label>
      <label class="fld grow">Details<input type="text" class="subitem-value"></label>
      <label class="fld" style="max-width:160px">Price ($)<input type="number" step="0.01" min="0" class="subitem-price" oninput="spQuote()"></label>
      <button class="btn danger small" style="margin-bottom:12px" onclick="this.closest('[data-subitem]').remove();spQuote()">✕</button>
    </div>`);
};
window.addAddonRow = function () {
  $('#addOnList').insertAdjacentHTML('beforeend', `
    <div class="row" data-addon style="align-items:flex-end">
      <label class="fld grow">Add-on<input type="text" class="ao-label" placeholder="e.g. Automatic cover"></label>
      <label class="fld grow">Details<input type="text" class="ao-value"></label>
      <label class="fld" style="max-width:160px">Price ($)<input type="number" step="0.01" min="0" class="ao-price" oninput="spQuote()"></label>
      <button class="btn danger small" style="margin-bottom:12px" onclick="this.closest('[data-addon]').remove();spQuote()">✕</button>
    </div>`);
};
window.saveSpecs = async function (id) {
  const val = i => { const el = document.getElementById(i); return el ? el.value : ''; };
  const num = i => Number(val(i)) || 0;
  const chk = i => { const el = document.getElementById(i); return el ? el.checked : false; };
  const subItems = containerId => {
    const el = document.getElementById(containerId); if (!el) return [];
    return [...el.querySelectorAll('[data-subitem]')]
      .map(r => ({ label: r.querySelector('.subitem-label').value, value: r.querySelector('.subitem-value').value, price: Number(r.querySelector('.subitem-price').value) || 0 }))
      .filter(x => x.label.trim());
  };
  const specs = {
    poolBase: {
      price: num('pb_price'), shape: val('pb_shape'), freeform: val('pb_freeform'),
      size: val('pb_size'), depth: val('pb_depth'),
      jets: val('pb_jets'), ledLights: val('pb_led'),
      sunShelf: { included: chk('pb_sunshelf_inc'), details: val('pb_sunshelf_det') },
      spillover: { included: chk('pb_spillover_inc'), details: val('pb_spillover_det') },
      ledgeSeating: { included: chk('pb_ledge_inc'), details: val('pb_ledge_det') },
    },
    spaBase: { included: chk('spa_inc'), price: num('spa_price'), size: val('spa_size'), jets: val('spa_jets'), ledLights: val('spa_led'), details: val('spa_det'), items: subItems('spa_items') },
    fireLounge: { included: chk('fl_inc'), price: num('fl_price'), size: val('fl_size'), details: val('fl_det'), items: subItems('fl_items') },
    waterFeature: { included: chk('wf_inc'), price: num('wf_price'), details: val('wf_det') },
    coldPlunge: { included: chk('cp_inc'), price: num('cp_price'), details: val('cp_det'), ledLights: val('cp_led'), additionalDetails: val('cp_addl'), items: subItems('cp_items') },
    fireFeature: { included: chk('ff_inc'), price: num('ff_price'), details: val('ff_det') },
    equipmentPad: val('pb_equippad'),
    addOns: [...document.querySelectorAll('[data-addon]')].map(r => ({ label: r.querySelector('.ao-label').value, value: r.querySelector('.ao-value').value, price: Number(r.querySelector('.ao-price').value) || 0 })).filter(a => a.label.trim()),
  };
  try { await api('PUT', '/api/clients/' + id, { specs }); await reload(); toast('Pool specs saved — quote updated on Finance'); route(); }
  catch (e) { toast(e.message, true); }
};

/* ---------- Scope tab ---------- */
// A scope item is a plain string, or { text, indent } for indented sub-lines.
const scopeText = it => typeof it === 'string' ? it : (it && it.text) || '';
const scopeIndentOf = it => typeof it === 'string' ? 0 : ((it && it.indent) || 0);
const SCOPE_MAX_INDENT = 2;
function tScope(c) {
  $('#tabBody').innerHTML = `
    <div class="banner info">Pre-populated from your standard contract. General descriptions only — sizes and dollar values live in Pool Specs and Finance. ${c.specsLocked ? 'Contract is signed: log substantive changes as Change Orders.' : 'Editable until the contract is signed.'} Use ⇥ to indent a line as a sub-item.</div>
    ${c.scope.map((sec, i) => `
      <div class="card">
        <div class="row" style="align-items:center;margin-bottom:8px">
          <input class="input grow scope-title" data-scopetitle="${i}" value="${esc(sec.title)}" style="font-size:18px;font-weight:700">
          <button class="btn danger small" onclick="scopeSecDel('${c.id}',${i})">Delete Section</button>
        </div>
        ${sec.items.map((it, j) => { const ind = scopeIndentOf(it); return `<div class="row" style="align-items:center;margin-bottom:6px;padding-left:${ind * 28}px">
          ${ind ? '<span style="color:var(--mid)">↳</span>' : ''}
          <input class="input grow" data-scope="${i}:${j}" data-indent="${ind}" value="${esc(scopeText(it))}">
          <button class="btn secondary small" title="Outdent" onclick="scopeIndent('${c.id}',${i},${j},-1)" ${ind === 0 ? 'disabled' : ''}>⇤</button>
          <button class="btn secondary small" title="Indent as sub-item" onclick="scopeIndent('${c.id}',${i},${j},1)" ${ind >= SCOPE_MAX_INDENT ? 'disabled' : ''}>⇥</button>
          <button class="btn secondary small" title="Move up" onclick="scopeMoveLine('${c.id}',${i},${j},-1)" ${j === 0 ? 'disabled' : ''}>↑</button>
          <button class="btn secondary small" title="Move down" onclick="scopeMoveLine('${c.id}',${i},${j},1)" ${j === sec.items.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="btn danger small" onclick="scopeDel('${c.id}',${i},${j})">✕</button></div>`; }).join('')}
        <button class="btn secondary small" onclick="scopeAdd('${c.id}',${i})">＋ Add line</button>
      </div>`).join('')}
    <div class="card">
      <h2>Project Overview</h2>
      <p class="muted" style="margin-top:0">This paragraph appears on the contract, below the pool sections. Edit it for this client, or leave the standard text.</p>
      <textarea class="input" id="scopeOverview" style="min-height:150px">${esc(c.projectOverview || '')}</textarea>
    </div>
    <div class="row" style="gap:10px">
      <button class="btn secondary" onclick="scopeSecAdd('${c.id}')">＋ Add Section</button>
      <button class="btn" onclick="scopeSave('${c.id}')">💾 Save Scope of Work</button>
    </div>`;
}
window.scopeSave = async function (id, thenRoute = true) {
  const c = client(id);
  const scope = JSON.parse(JSON.stringify(c.scope));
  document.querySelectorAll('[data-scopetitle]').forEach(inp => {
    const i = Number(inp.dataset.scopetitle);
    if (scope[i]) scope[i].title = inp.value;
  });
  document.querySelectorAll('[data-scope]').forEach(inp => {
    const [i, j] = inp.dataset.scope.split(':').map(Number);
    const indent = Number(inp.dataset.indent) || 0;
    scope[i].items[j] = indent ? { text: inp.value, indent } : inp.value;
  });
  const ov = $('#scopeOverview');
  const body = { scope };
  if (ov) body.projectOverview = ov.value;
  await api('PUT', '/api/clients/' + id, body);
  await reload(); if (thenRoute) { toast('Scope saved'); route(); }
};
window.scopeAdd = async function (id, i) { await scopeSave(id, false); const c = client(id); c.scope[i].items.push(''); await api('PUT', '/api/clients/' + id, { scope: c.scope }); await reload(); route(); };
window.scopeDel = async function (id, i, j) { await scopeSave(id, false); const c = client(id); c.scope[i].items.splice(j, 1); await api('PUT', '/api/clients/' + id, { scope: c.scope }); await reload(); route(); };
window.scopeIndent = async function (id, i, j, dir) {
  await scopeSave(id, false); // persist in-progress edits (incl. current indents)
  const items = client(id).scope[i].items;
  const level = Math.max(0, Math.min(SCOPE_MAX_INDENT, scopeIndentOf(items[j]) + dir));
  const text = scopeText(items[j]);
  items[j] = level ? { text, indent: level } : text;
  await api('PUT', '/api/clients/' + id, { scope: client(id).scope });
  await reload(); route();
};
window.scopeMoveLine = async function (id, i, j, dir) {
  const nj = j + dir;
  const c = client(id);
  if (nj < 0 || nj >= c.scope[i].items.length) return;
  await scopeSave(id, false); // persist any in-progress text edits first
  const items = client(id).scope[i].items;
  [items[j], items[nj]] = [items[nj], items[j]];
  await api('PUT', '/api/clients/' + id, { scope: client(id).scope });
  await reload(); route();
};
window.scopeSecAdd = async function (id) {
  await scopeSave(id, false);
  const c = client(id);
  c.scope.push({ key: 'custom_' + Date.now().toString(36), title: 'New Section', items: [''] });
  await api('PUT', '/api/clients/' + id, { scope: c.scope }); await reload(); route();
};
window.scopeSecDel = async function (id, i) {
  if (!confirm('Delete this scope section and all its lines?')) return;
  await scopeSave(id, false);
  const c = client(id);
  c.scope.splice(i, 1);
  await api('PUT', '/api/clients/' + id, { scope: c.scope }); await reload(); route();
};

/* ---------- Design tab ---------- */
function tDesign(c) {
  const sel = new Set(c.selectedFinishes || []);
  const tierOrder = ['Standard', 'Upgrade', 'Premium', 'Extra Premium', 'Brilliance'];
  const brands = ['PebbleTec', 'PebbleSheen', 'PebbleFina', 'PebbleBrilliance'];
  const plasterVal = c.contract.plasterColor || (c.selectedFinishes || [])[0] || '';
  const cfc = c.clientFinishChoice;
  const clientPickBanner = cfc
    ? `<div class="banner" style="background:#e7f6ec;border:1px solid #bfe6cc;color:#1f8a4c;margin-bottom:14px">
        🟦 <b>Client selected from the portal:</b> ${esc(cfc.brand ? cfc.brand + ' ' : '')}${esc(cfc.name)}${cfc.at ? ' · ' + fmtDate(cfc.at) : ''}</div>`
    : '';
  $('#tabBody').innerHTML = `
    ${clientPickBanner}
    <div class="card" style="max-width:760px;margin-bottom:14px">
      <h2>Project Selections</h2>
      <div class="row">
        <label class="fld grow">Plaster Color (Pebble Tec)<input type="text" id="selPlaster" value="${esc(plasterVal)}" placeholder="e.g. Caribbean Blue"></label>
        <label class="fld grow">Waterline Tile<input type="text" id="selTile" value="${esc(c.contract.waterlineTile || '')}" placeholder="e.g. 4×4 glass mosaic — blue blend"></label>
        <label class="fld grow">Coping<input type="text" id="selCoping" value="${esc(c.contract.coping || '')}" placeholder="e.g. brushed travertine"></label>
      </div>
      <button class="btn" onclick="saveSelections('${c.id}')">💾 Save Selections</button>
    </div>
    <div class="banner info">Click swatches to record the client's finish selections (these appear on the contract and the portal; the client can also choose their own finish from the portal). Grouped by pricing tier — prices are never shown to the client.</div>
    ${brands.map(brand => {
      const tiers = tierOrder.filter(t => S.finishes.some(f => f.active && f.brand === brand && f.tier === t));
      if (!tiers.length) return '';
      return `<div class="card"><h2>${brand}</h2>${tiers.map(t => `
        <h3>${t === 'Brilliance' ? 'All Colors' : t}</h3>
        <div class="swatch-grid">${S.finishes.filter(f => f.active && f.brand === brand && f.tier === t).map(f => `
          <div class="swatch ${sel.has(f.name) ? 'selected' : ''}" onclick="toggleFinish('${c.id}','${esc(f.name)}')">
            ${f.localImage || f.imageUrl ? `<img loading="lazy" src="${f.localImage || f.imageUrl}" alt="${esc(f.name)}">` : `<div class="colorblock" style="background:${f.color}"></div>`}
            <div class="nm">${esc(f.name)}${f.shimmer ? ' ✨' : ''}<small>${brand}</small></div>
          </div>`).join('')}</div>`).join('')}</div>`;
    }).join('')}`;
}
window.toggleFinish = async function (id, name) {
  const c = client(id);
  const sel = new Set(c.selectedFinishes || []);
  sel.has(name) ? sel.delete(name) : sel.add(name);
  await api('PUT', '/api/clients/' + id, { selectedFinishes: [...sel] });
  await reload(); route();
};

/* ---------- Finance tab ---------- */
function tFinance(c) {
  const total = c.finance.items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  $('#tabBody').innerHTML = `
    <div class="card" style="max-width:680px">
      <h2>Price Quote</h2>
      <div class="banner info">Pricing is set on the <a href="#/client/${c.id}/specs">Pool Specs</a> tab — each priced section feeds this quote. ${c.specsLocked ? 'Contract is signed: price changes go through Change Orders.' : ''}</div>
      <table class="tbl"><tbody>
        ${c.finance.items.length ? c.finance.items.map(it => `<tr><td>${esc(it.label)}</td><td class="right money">${money(it.amount)}</td></tr>`).join('')
          : '<tr><td class="muted">No priced sections yet — add them on Pool Specs.</td><td></td></tr>'}
      </tbody></table>
      <hr style="border:none;border-top:2px solid var(--blue-soft);margin:16px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="total-line">Total Quote</span><span class="total-line">${money(total)}</span>
      </div>
      ${c._coTotal ? `<div style="display:flex;justify-content:space-between;margin-top:6px" class="muted"><span>+ Change orders</span><span class="money">${money(c._coTotal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:800;color:var(--blue-dark)"><span>Contract total</span><span class="money">${money(total + c._coTotal)}</span></div>` : ''}
    </div>
    <div class="card" style="max-width:680px">
      <h2>Amount Due at Each Phase</h2>
      <table class="tbl"><thead><tr><th>Phase</th><th>Draw</th><th class="right">Amount</th></tr></thead><tbody>
        ${c.phases.map(p => `<tr><td>${esc(p.name)}</td><td>${p.drawPct}%</td><td class="right money">${p.drawPct ? money(total * p.drawPct / 100) : '—'}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
}

/* ---------- Files tab ---------- */
const IMG_RE = /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i;
function tFiles(c) {
  $('#tabBody').innerHTML = `
    <div class="card">
      <h2>Upload Files</h2>
      <div class="row" style="align-items:flex-end">
        <label class="fld grow">Category<select id="upCat" onchange="upCatChanged()">${S.settings.fileCategories.map(x => `<option>${x}</option>`).join('')}</select></label>
        <label class="fld grow" style="flex:2">Files (multiple allowed)<input type="file" id="upFiles" multiple class="input"></label>
        <label class="fld" id="upAmtWrap" style="display:none;max-width:190px">Invoice total $ (optional)<input type="number" step="0.01" min="0" id="upAmt" placeholder="auto-read from PDF"></label>
        <button class="btn" style="margin-bottom:12px" onclick="doUpload('${c.id}')">⬆ Upload</button>
      </div>
      <p class="muted">Plans, pool renderings, permits, material & labor invoices. Check ⭐ on a rendering to use it as the contract cover photo.
      Invoice uploads automatically add a line to <b>Costs (Internal)</b> — the amount is read from the PDF (or use the box above), and you can adjust it on the Costs tab.</p>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center"><h2 style="margin:0">Documents (${c.files.length})</h2>
        <button class="btn secondary small" onclick="emailFiles('${c.id}')">📧 Email selected…</button></div>
      <p class="muted" style="margin:0 0 6px">👁 <b>Client portal:</b> Pool Renderings show automatically once the contract is signed. For any other file, check <b>Show to client</b> to add it to the collapsible files menu on their portal.</p>
      <table class="tbl" style="margin-top:10px"><thead><tr><th></th><th>File</th><th>Category</th><th>Uploaded</th><th>Cover Photo</th><th>Client Portal</th><th></th></tr></thead><tbody>
      ${c.files.map(f => {
        const src = `/uploads/${c.id}/${encodeURIComponent(f.storedName)}`;
        const thumb = IMG_RE.test(f.originalName)
          ? `<img src="${src}" alt="" loading="lazy" title="Click to preview" onclick="previewImg('${c.id}','${f.id}')" style="height:46px;width:64px;object-fit:cover;border-radius:6px;border:1px solid var(--blue-soft);cursor:pointer;flex:none">`
          : `<span style="height:46px;width:64px;display:flex;align-items:center;justify-content:center;border-radius:6px;border:1px solid var(--blue-soft);background:var(--blue-pale);flex:none">📄</span>`;
        const visCell = f.category === 'Pool Renderings'
          ? '<span class="muted" title="Renderings show automatically after signing">🎨 Auto after signing</span>'
          : f.category === 'Signed Contract'
            ? '<span class="muted">On contract card</span>'
            : `<label class="check" style="margin:0"><input type="checkbox" ${f.clientVisible ? 'checked' : ''} onchange="setVisibility('${c.id}','${f.id}',this.checked)"> 👁 Show to client</label>`;
        return `<tr>
        <td><input type="checkbox" class="fileSel" value="${f.id}"></td>
        <td><div style="display:flex;align-items:center;gap:10px"><div>${thumb}</div><div><b>${esc(f.originalName)}</b><div class="muted">${(f.size / 1024 / 1024).toFixed(1)} MB</div></div></div></td>
        <td>${esc(f.category)}</td>
        <td class="muted">${fmtDate(f.uploadedAt)}</td>
        <td>${f.category === 'Pool Renderings' ? `<label class="check" style="margin:0"><input type="checkbox" ${f.isCoverPhoto ? 'checked' : ''} onchange="setCover('${c.id}','${f.id}',this.checked)"> ⭐ Contract Cover Photo</label>` : ''}</td>
        <td>${visCell}</td>
        <td class="right" style="white-space:nowrap">
          <a class="btn secondary small" href="/api/clients/${c.id}/files/${f.id}/download">⬇</a>
          <button class="btn danger small" onclick="delFile('${c.id}','${f.id}')">✕</button>
        </td></tr>`;
      }).join('') || '<tr><td colspan="7" class="muted">No files uploaded yet.</td></tr>'}
      </tbody></table>
    </div>`;
}
window.upCatChanged = function () {
  const isInvoice = ['Material Invoices', 'Labor Invoices'].includes($('#upCat').value);
  $('#upAmtWrap').style.display = isInvoice ? '' : 'none';
};
window.doUpload = async function (id) {
  const files = $('#upFiles').files;
  if (!files.length) return toast('Choose files first', true);
  const fd = new FormData();
  fd.append('category', $('#upCat').value);
  if ($('#upAmt') && $('#upAmt').value) fd.append('invoiceAmount', $('#upAmt').value);
  for (const f of files) fd.append('files', f);
  try {
    const r = await api('POST', `/api/clients/${id}/files`, fd);
    await reload();
    const added = r._costsAdded || [];
    toast(files.length + ' file(s) uploaded' + (added.length ? ` — ${added.length} cost line(s) added: ` + added.map(a => money(a.amount)).join(', ') : ''));
    route();
  }
  catch (e) { toast(e.message, true); }
};
window.previewImg = function (id, fid) {
  const c = client(id); const f = c && c.files.find(x => x.id === fid);
  if (!f) return;
  const src = `/uploads/${id}/${encodeURIComponent(f.storedName)}`;
  modal(`<h2 style="margin:0 0 10px">${esc(f.originalName)}</h2>
    <div style="text-align:center;background:var(--blue-pale);border-radius:8px;padding:8px">
      <img src="${src}" alt="${esc(f.originalName)}" style="max-width:100%;max-height:68vh;border-radius:4px">
    </div>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:12px">
      <a class="btn secondary" href="${src}" target="_blank">Open full size</a>
      <button class="btn" onclick="closeModal()">Close</button>
    </div>`);
};
window.setCover = async function (id, fid, on) { await api('POST', `/api/clients/${id}/files/${fid}/cover`, { isCoverPhoto: on }); await reload(); route(); toast(on ? 'Set as contract cover photo' : 'Cover photo removed'); };
window.setVisibility = async function (id, fid, on) { await api('POST', `/api/clients/${id}/files/${fid}/visibility`, { clientVisible: on }); await reload(); route(); toast(on ? 'File is now visible on the client portal' : 'File hidden from the client portal'); };
window.delFile = async function (id, fid) { if (!confirm('Delete this file?')) return; await api('DELETE', `/api/clients/${id}/files/${fid}`); await reload(); route(); };
window.emailFiles = function (id) {
  const c = client(id);
  const ids = [...document.querySelectorAll('.fileSel:checked')].map(x => x.value);
  if (!ids.length) return toast('Check at least one file first', true);
  modal(`<h2>Email ${ids.length} file(s)</h2>
    <label class="fld">Send to<select id="efTo">
      <option value="${esc(c.email)}">Client — ${esc(c.name)} (${esc(c.email) || 'no email'})</option>
      ${S.employees.map(e => `<option value="${esc(e.email)}">Employee — ${esc(e.name)} (${esc(e.email)})</option>`).join('')}
      <option value="__other">Other address…</option></select></label>
    <label class="fld" id="efOtherWrap" style="display:none">Email address<input type="email" id="efOther"></label>
    <label class="fld">Note (optional)<textarea id="efNote"></textarea></label>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn" id="efSend">Send</button></div>`, root => {
    $('#efTo').onchange = () => $('#efOtherWrap').style.display = $('#efTo').value === '__other' ? '' : 'none';
    $('#efSend').onclick = async () => {
      const to = $('#efTo').value === '__other' ? $('#efOther').value : $('#efTo').value;
      if (!to) return toast('Recipient required', true);
      try {
        const r = await api('POST', `/api/clients/${id}/files/email`, { fileIds: ids, to, note: $('#efNote').value });
        closeModal(); toast(r.email.status === 'sent' ? 'Email sent' : 'Logged (Gmail not configured)');
      } catch (e) { toast(e.message, true); }
    };
  });
};

/* ---------- Contract & Phases tab ---------- */
function tContract(c) {
  const total = c._quote;

  // DocuSeal in-portal signing section
  let docusealSection;
  if (!S.docusealConfigured) {
    docusealSection = `<p class="muted" style="margin-top:10px"><a href="#/settings">Configure DocuSeal in Settings</a> to let clients sign right inside their portal.</p>`;
  } else if (c.contract.signedAt && c.contract.signedMethod === 'docuseal') {
    docusealSection = `<div class="banner info">✅ Signed in the client portal (DocuSeal).</div>`;
  } else if (c.contract.docusealStatus === 'pending') {
    const sent = c.contract.docusealSentAt ? `Ready since ${fmtDate(c.contract.docusealSentAt)}` : '';
    docusealSection = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">
        <span class="chip prospect">Awaiting Signature (in portal)</span><span class="muted">${sent}</span>
        <button class="btn secondary small" onclick="checkDocusealStatus('${c.id}')">↻ Check Signing Status</button></div>
      <p class="muted" style="margin-top:6px">The client signs from their portal link. You'll be notified automatically when it's done.</p>`;
  } else {
    const dis = c.email ? '' : 'disabled title="Client has no email address"';
    docusealSection = `<div style="margin-top:10px"><button class="btn" onclick="sendViaDocuseal('${c.id}')" ${dis}>🖊️ Enable In-Portal Signing (DocuSeal)</button>
      <p class="muted" style="margin-top:6px">Prepares the contract for the client to review and sign directly in their portal — no email round-trip. The signed PDF is saved to Files automatically.</p></div>`;
  }

  const signedSection = c.contract.signedAt
    ? '<div class="banner info">✓ Signed. Specs locked; manage the build below.</div>'
    : `<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--mid);font-size:13px">Manual fallback — mark as signed outside the portal</summary>
        <div style="margin-top:10px">
          <div class="row" style="align-items:flex-end">
            <label class="fld grow">How was it signed?<select id="signMethod"><option value="digital">Digital signature (emailed back)</option><option value="paper">Paper (in person)</option></select></label>
            <label class="fld grow">Deposit taken now?<select id="depMethod"><option value="">No — send payment link</option><option value="check">Yes — check</option><option value="cash">Yes — cash</option></select></label>
            <button class="btn green" style="margin-bottom:12px" onclick="markSigned('${c.id}')">✓ Contract Signed</button>
          </div>
          <p class="muted">Signing locks specs & pricing, starts the Design phase, alerts the team, ${c.testMode ? '<b>(test job — no invoice is created)</b>' : S.quickbooksConnected ? 'creates the QuickBooks invoice for the full amount,' : ''} and sends the 10% design draw request.</p>
        </div></details>`;

  $('#tabBody').innerHTML = `
    <div class="card">
      <h2>Estimate</h2>
      <p class="muted">A line-item price estimate to send the customer for review before their contract. Copies ${esc((S.settings && S.settings.companyEmail) || 'the office')} on the email.</p>
      <p class="muted">Sent: ${c.estimateSentAt ? fmtDate(c.estimateSentAt) : 'not yet'}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn secondary" href="/api/clients/${c.id}/estimate.pdf" target="_blank">⬇ Preview Estimate PDF</a>
        <button class="btn secondary" onclick="sendEstimate('${c.id}')">📧 Email Estimate to Client</button>
      </div>
    </div>
    <div class="row">
      <div class="card grow" style="min-width:340px">
        <h2>Contract</h2>
        <p>Quote total: <b class="money">${money(total)}</b>${c._coTotal ? ` &nbsp;+ COs <b class="money">${money(c._coTotal)}</b> = <b class="money">${money(total + c._coTotal)}</b>` : ''}</p>
        <p class="muted">Sent: ${c.contract.sentAt ? fmtDate(c.contract.sentAt) : 'not yet'} · Signed: ${c.contract.signedAt ? fmtDate(c.contract.signedAt) + ' (' + c.contract.signedMethod + (c.contract.depositMethod ? ', deposit by ' + c.contract.depositMethod : '') + ')' : 'not yet'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn secondary" href="/api/clients/${c.id}/contract.pdf" target="_blank">⬇ Preview Contract PDF</a>
          <button class="btn secondary" onclick="sendContract('${c.id}')">📧 Email PDF to Client</button>
        </div>
        ${docusealSection}
        ${signedSection}
      </div>
      <div class="card grow" style="min-width:300px;max-width:430px">
        <h2>QuickBooks</h2>
        ${c.testMode ? '<div class="banner" style="background:#fef4dc;border:1px solid #f3e3b5;color:#8a5a10">🧪 Test job — QuickBooks invoicing is disabled. You can still paste practice payment links per phase below.</div>' : `
        ${S.quickbooksConnected ? '<span class="chip active">Connected</span>' : '<p class="muted">Not connected — payment links can still be pasted per phase below. Connect in <a href="#/settings">Settings</a>.</p>'}
        ${c.quickbooks.invoiceUrl
          ? `<p style="margin-top:10px">Master invoice: <a href="${c.quickbooks.invoiceUrl}" target="_blank">open in QuickBooks ↗</a></p>
             <p class="muted" style="font-size:12px">One invoice for the full contract. Each phase draw is requested as a partial payment against it — no additional invoices are created.</p>`
          : S.quickbooksConnected && c.contract.signedAt
            ? `<div class="banner warn" style="margin-top:10px">Master invoice was not created — this usually means the QuickBooks connection needs attention.</div>
               <button class="btn" style="margin-top:10px" onclick="createQbInvoice('${c.id}')">Create QB Customer &amp; Invoice</button>`
            : ''}`}
      </div>
    </div>
    <div class="card">
      <h2>Build Phases</h2>
      <table class="tbl"><thead><tr><th>Phase</th><th>Draw</th><th class="right">Amount</th><th>Due Date</th><th>Status</th><th>Payment</th><th></th></tr></thead><tbody>
      ${c.phases.map(p => {
        const amt = total * p.drawPct / 100;
        return `<tr style="${p.status === 'active' ? 'background:var(--blue-pale)' : ''}">
          <td><b>${esc(p.name)}</b><div class="muted">${esc(p.time)}</div></td>
          <td>${p.drawPct}%</td>
          <td class="right money">${p.drawPct ? money(amt) : '—'}</td>
          <td><input type="date" class="input" style="width:150px;padding:5px" value="${p.dueDate || ''}" onchange="setPhaseDue('${c.id}','${p.key}',this.value)"></td>
          <td>${p.status === 'complete' ? '✅ ' + fmtDate(p.completedAt) : p.status === 'active' ? '<span class="chip active">In Progress</span>' : '<span class="chip lost">Pending</span>'}</td>
          <td>${p.drawPct === 0 ? '—' : p.paymentReceivedAt ? '💰 Paid ' + fmtDate(p.paymentReceivedAt) + ' (' + (p.paymentMethod || '') + ')'
            : p.paymentRequestedAt ? `<span class="chip prospect">Requested ${fmtDate(p.paymentRequestedAt)}</span><br><button class="btn small green" style="margin-top:4px" onclick="payReceived('${c.id}','${p.key}')">Mark received</button>`
            : `<button class="btn small secondary" onclick="requestPay('${c.id}','${p.key}')">Send payment request</button> <button class="btn small secondary" onclick="payReceived('${c.id}','${p.key}')">Mark received</button>`}</td>
          <td class="right">${p.status === 'active' ? `<button class="btn small green" onclick="completePhase('${c.id}','${p.key}')">✓ Complete Phase</button>` : ''}</td>
        </tr>`;
      }).join('')}
      </tbody></table>
      <p class="muted">Completing a phase automatically: activates the next phase, emails all employees, posts a dashboard alert, and emails the client the next draw's payment request.</p>
    </div>`;
}
window.sendContract = async function (id) {
  try {
    const r = await api('POST', `/api/clients/${id}/contract/send`);
    await reload(); route();
    toast(r.email.status === 'sent' ? 'Contract emailed to client' : 'Contract generated; email logged (Gmail not configured)');
  } catch (e) { toast(e.message, true); }
};
window.sendEstimate = async function (id) {
  try {
    const r = await api('POST', `/api/clients/${id}/estimate/send`);
    await reload(); route();
    toast(r.email.status === 'sent' ? 'Estimate emailed to client (copy to office)' : 'Estimate generated; email logged (Gmail not configured)');
  } catch (e) { toast(e.message, true); }
};
window.markSigned = async function (id) {
  if (!confirm('Mark contract as signed? This locks specs and pricing.')) return;
  try {
    const r = await api('POST', `/api/clients/${id}/contract/mark-signed`, { method: $('#signMethod').value, depositMethod: $('#depMethod').value || null });
    await reload(); route();
    toast('Contract signed — Design phase started' + (r.quickbooksError ? ' (QuickBooks error: ' + r.quickbooksError + ')' : ''));
  } catch (e) { toast(e.message, true); }
};
window.createQbInvoice = async function (id) {
  if (!confirm('Create QuickBooks customer and master invoice now?')) return;
  try {
    await api('POST', `/api/clients/${id}/quickbooks/create-invoice`);
    await reload(); route();
    toast('QuickBooks customer and master invoice created successfully');
  } catch (e) { toast(e.message, true); }
};
window.sendViaDocuseal = async function (id) {
  try {
    toast('Preparing contract for in-portal signing…');
    await api('POST', `/api/clients/${id}/contract/docuseal-send`);
    await reload(); route();
    toast('Ready — the client can now sign from their portal');
  } catch (e) { toast(e.message, true); }
};
window.checkDocusealStatus = async function (id) {
  try {
    const r = await api('POST', `/api/clients/${id}/contract/docuseal-status`);
    await reload(); route();
    toast(r.status === 'completed' ? 'Signed! Design phase started' : 'Status: ' + r.status);
  } catch (e) { toast(e.message, true); }
};
window.completePhase = async function (id, key) {
  if (!confirm('Mark this phase complete? The next phase will activate and notifications will go out.')) return;
  try { await api('POST', `/api/clients/${id}/phases/${key}/complete`); await reload(); route(); toast('Phase completed — team & client notified'); }
  catch (e) { toast(e.message, true); }
};
window.payReceived = function (id, key) {
  modal(`<h2>Payment received</h2>
    <label class="fld">Method<select id="payM"><option>QuickBooks ACH</option><option>QuickBooks card</option><option>check</option><option>cash</option></select></label>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn green" onclick="payReceived2('${id}','${key}')">Record</button></div>`);
};
window.payReceived2 = async function (id, key) {
  await api('POST', `/api/clients/${id}/phases/${key}/payment-received`, { method: $('#payM').value });
  await reload(); closeModal(); route(); toast('Payment recorded');
};
window.requestPay = function (id, key) {
  const c = client(id);
  const p = c.phases.find(p => p.key === key);
  modal(`<h2>Send payment request</h2>
    <p>Emails ${esc(c.name)} the ${p.drawPct}% draw request (${money(c._quote * p.drawPct / 100)}) with a secure pay button.</p>
    <label class="fld">QuickBooks payment link (paste, or leave blank to use the invoice link)<input type="text" id="payLink" value="${esc(p.paymentLink || '')}" placeholder="https://connect.intuit.com/pay/..."></label>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn" onclick="requestPay2('${id}','${key}')">📧 Send</button></div>`);
};
window.requestPay2 = async function (id, key) {
  try {
    const r = await api('POST', `/api/clients/${id}/phases/${key}/request-payment`, { paymentLink: $('#payLink').value });
    await reload(); closeModal(); route();
    toast(r.email && r.email.status === 'sent' ? 'Payment request sent' : 'Logged (Gmail not configured)');
  } catch (e) { toast(e.message, true); }
};
window.setPhaseDue = async function (id, key, val) {
  const c = client(id);
  await api('PUT', '/api/clients/' + id, { phases: c.phases.map(p => p.key === key ? { ...p, dueDate: val } : p) });
  await reload(); toast('Due date saved');
};
window.saveSelections = async function (id) {
  try {
    await api('PUT', `/api/clients/${id}/selections`, {
      plasterColor: ($('#selPlaster') || {}).value || '',
      waterlineTile: ($('#selTile') || {}).value || '',
      coping: ($('#selCoping') || {}).value || '',
    });
    await reload(); toast('Selections saved');
  } catch (e) { toast(e.message, true); }
};
window.adjustHaul = async function (id, type, delta) {
  const c = client(id);
  const h = c.hauls || { triAxle: 0, gravel: 0 };
  try {
    await api('PUT', `/api/clients/${id}/hauls`, { [type]: Math.max(0, (h[type] || 0) + delta) });
    await reload(); route();
  } catch (e) { toast(e.message, true); }
};
window.createHaulCO = async function (id, type) {
  const c = client(id);
  const h = c.hauls || { triAxle: 0, gravel: 0 };
  const isTriAxle = type === 'triAxle';
  const over = Math.max(0, (h[type] || 0) - 5);
  if (over === 0) return;
  const rateInput = isTriAxle ? $('#haulRateTriAxle') : $('#haulRateGravel');
  const defaultRate = ((S.settings.haulRates || {})[type]) || (isTriAxle ? 500 : 1000);
  const rate = rateInput ? (Number(rateInput.value) || defaultRate) : defaultRate;
  const desc = isTriAxle
    ? `Tri-axle haul-off overage: ${over} extra truck(s) at ${money(rate)} each`
    : `Gravel load overage: ${over} extra load(s) at ${money(rate)} each`;
  const amount = over * rate;
  if (!confirm(`Create change order for ${over} extra ${isTriAxle ? 'haul-off truck(s)' : 'gravel load(s)'} = ${money(amount)}?`)) return;
  try {
    await api('POST', `/api/clients/${id}/change-orders`, { description: desc, value: amount });
    await reload(); route();
    toast('Change order sent to the client for approval on their portal');
  } catch (e) { toast(e.message, true); }
};

/* ---------- Tasks tab (per client) ---------- */
function tTasks(c) {
  const today = new Date().toISOString().slice(0, 10);
  const tasks = S.tasks.filter(t => t.clientId === c.id).sort((a, b) => (a.status === 'done') - (b.status === 'done') || String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999')));
  const open = tasks.filter(t => t.status !== 'done').length;
  $('#tabBody').innerHTML = `
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
        <h2 style="margin:0">Tasks for ${esc(c.address)} <span class="muted" style="font-weight:500">(${open} open)</span></h2>
        <button class="btn" onclick="addTask('${c.id}')">＋ Assign Task</button>
      </div>
      <p class="muted">Phase-workflow tasks appear here automatically when each phase starts (tagged <span class="chip phase">auto</span>). Templates are editable in <a href="#/settings">Settings</a>.</p>
      <table class="tbl"><thead><tr><th>Task</th><th>Assigned To</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
      ${tasks.map(t => {
        const emp = S.employees.find(e => e.id === t.employeeId);
        const overdue = t.status !== 'done' && t.dueDate && t.dueDate < today;
        return `<tr style="${t.status === 'done' ? 'opacity:.55' : ''}">
          <td><b>${esc(t.title)}</b>${t.source === 'auto' ? ' <span class="chip phase" title="Created automatically when the phase started">auto</span>' : ''}${t.details ? `<div class="muted">${esc(t.details)}</div>` : ''}</td>
          <td>${emp ? esc(emp.name) : '<i class="muted">unassigned</i>'}</td>
          <td style="${overdue ? 'color:var(--red);font-weight:700' : ''}">${fmtDate(t.dueDate)}${overdue ? ' ⚠' : ''}</td>
          <td>${t.status === 'done' ? '✅ Done' : '<span class="chip prospect">Open</span>'}</td>
          <td class="right" style="white-space:nowrap">
            ${t.status !== 'done' ? `<button class="btn small green" onclick="taskDone('${t.id}')">✓ Done</button>
            <button class="btn small secondary" onclick="taskRemind('${t.id}')">📧 Remind</button>` : ''}
            <button class="btn danger small" onclick="taskDel('${t.id}')">✕</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="5" class="muted">No tasks for this project yet — tasks appear automatically as phases start, or assign one now.</td></tr>'}
      </tbody></table>
    </div>`;
}

/* ---------- Change Orders tab ---------- */
function tChanges(c) {
  if (!c.contract.signedAt) {
    $('#tabBody').innerHTML = '<div class="banner info">Change Orders open once the client has signed the contract. Until then, edit Pool Specs and Finance directly.</div>';
    return;
  }
  const total = c.changeOrders.reduce((a, co) => a + (Number(co.value) || 0), 0);
  const hauls = c.hauls || { triAxle: 0, gravel: 0 };
  const defaultRates = S.settings.haulRates || { triAxle: 500, gravel: 1000 };
  const triOver = Math.max(0, hauls.triAxle - 5);
  const gravOver = Math.max(0, hauls.gravel - 5);
  const triOverHtml = triOver > 0
    ? `<span class="chip lost">${triOver} over</span> <button class="btn small" onclick="createHaulCO('${c.id}','triAxle')">Create Change Order</button>`
    : '<span class="chip active" style="font-size:11px">Within limit</span>';
  const gravOverHtml = gravOver > 0
    ? `<span class="chip lost">${gravOver} over</span> <button class="btn small" onclick="createHaulCO('${c.id}','gravel')">Create Change Order</button>`
    : '<span class="chip active" style="font-size:11px">Within limit</span>';
  $('#tabBody').innerHTML = `
    <div class="row" style="margin-bottom:14px">
      <div class="metric"><div class="v">${money(total)}</div><div class="l">Total Change Orders</div></div>
      <div class="metric"><div class="v">${c.changeOrders.length}</div><div class="l">Change Order Count</div></div>
      <div class="metric"><div class="v">${money(c._quote + total)}</div><div class="l">Revised Contract Total</div></div>
      <div style="flex:1;display:flex;align-items:center;justify-content:flex-end"><button class="btn" onclick="addCO('${c.id}')">＋ Add Change Order</button></div>
    </div>
    <div class="card" style="max-width:680px;margin-bottom:14px">
      <h2>Haul Tracking</h2>
      <p class="muted" style="margin-top:0">5 tri-axle haul-offs and 5 gravel loads included. Edit the per-unit rates below (pre-filled from Settings) before creating a change order.</p>
      <div class="row" style="margin-bottom:16px">
        <label class="fld grow">Rate per extra haul-off truck ($)<input type="number" id="haulRateTriAxle" min="0" step="25" value="${defaultRates.triAxle}"></label>
        <label class="fld grow">Rate per extra gravel load ($)<input type="number" id="haulRateGravel" min="0" step="25" value="${defaultRates.gravel}"></label>
      </div>
      <div style="display:flex;flex-direction:column;gap:16px">
        <div>
          <b style="display:block;margin-bottom:6px">Tri-Axle Haul-Off</b>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button class="btn secondary small" onclick="adjustHaul('${c.id}','triAxle',-1)">−</button>
            <span style="font-size:24px;font-weight:700;min-width:32px;text-align:center">${hauls.triAxle}</span>
            <button class="btn secondary small" onclick="adjustHaul('${c.id}','triAxle',1)">＋</button>
            <span class="muted">of 5 included</span>
            ${triOverHtml}
          </div>
        </div>
        <div>
          <b style="display:block;margin-bottom:6px">Gravel Loads</b>
          <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
            <button class="btn secondary small" onclick="adjustHaul('${c.id}','gravel',-1)">−</button>
            <span style="font-size:24px;font-weight:700;min-width:32px;text-align:center">${hauls.gravel}</span>
            <button class="btn secondary small" onclick="adjustHaul('${c.id}','gravel',1)">＋</button>
            <span class="muted">of 5 included</span>
            ${gravOverHtml}
          </div>
        </div>
      </div>
    </div>
    <div class="card">
      <p class="muted" style="margin:0 0 8px">Change orders are sent to the client for <b>final approval on their portal</b>. Only after they approve is the QuickBooks invoice created and the payment requested. You can also approve on their behalf if they OK it by phone.</p>
      <table class="tbl"><thead><tr><th>Date</th><th>Change Requested</th><th class="right">Value</th><th>Status</th><th>Invoice / Payment</th><th></th></tr></thead><tbody>
      ${c.changeOrders.map(co => {
        const status = co.status || 'approved';
        const statusCell = status === 'pending'
          ? '<span class="chip prospect">🕓 Awaiting client approval</span>'
          : status === 'declined'
            ? `<span class="chip lost">✕ Declined</span><div class="muted">${fmtDate(co.declinedAt)}</div>`
            : `<span class="chip active">✓ Approved</span>${co.approvedAt ? `<div class="muted">${fmtDate(co.approvedAt)}</div>` : ''}`;
        const invCell = co.qbInvoiceId
          ? `<a class="btn small secondary" href="${esc(co.qbInvoiceUrl)}" target="_blank">📄 View</a>
             ${c.email ? `<button class="btn small" onclick="sendCOInvoice('${c.id}','${co.id}')">📧 Resend</button>` : ''}`
          : status === 'approved'
            ? (c.testMode ? '<span class="muted">test job — no invoice</span>' : co.value <= 0 ? '<span class="muted">credit — no invoice</span>' : S.quickbooksConnected ? '<span class="muted">not created — check QB</span>' : '<span class="muted">paste a link per phase</span>')
            : '<span class="muted">—</span>';
        const actionCell = status === 'pending'
          ? `<button class="btn small green" onclick="approveCO('${c.id}','${co.id}')">Approve on behalf</button> <button class="btn danger small" onclick="delCO('${c.id}','${co.id}')">Delete</button>`
          : `<button class="btn danger small" onclick="delCO('${c.id}','${co.id}')">Delete</button>`;
        return `<tr>
        <td class="muted" style="white-space:nowrap">${fmtDate(co.createdAt)}</td>
        <td>${esc(co.description)}</td>
        <td class="right money">${money(co.value)}</td>
        <td>${statusCell}</td>
        <td>${invCell}</td>
        <td class="right" style="white-space:nowrap">${actionCell}</td>
      </tr>`;
      }).join('') || '<tr><td colspan="6" class="muted">No change orders logged.</td></tr>'}
      </tbody></table>
    </div>`;
}
window.addCO = function (id) {
  modal(`<h2>Add Change Order</h2>
    <label class="fld">Change Requested<textarea id="coDesc" placeholder="e.g. Upgrade to Pebble Sheen Ocean Blue finish"></textarea></label>
    <label class="fld">Value ($ — use negative for credits)<input type="number" step="0.01" id="coVal" placeholder="0.00"></label>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn" onclick="addCO2('${id}')">Log Change Order</button></div>`);
};
window.addCO2 = async function (id) {
  try {
    await api('POST', `/api/clients/${id}/change-orders`, { description: $('#coDesc').value, value: $('#coVal').value });
    await reload(); closeModal(); route();
    toast('Change order sent to the client for approval on their portal');
  } catch (e) { toast(e.message, true); }
};
window.approveCO = async function (clientId, coId) {
  if (!confirm('Approve this change order on the client\'s behalf?\n\nFor a positive charge this creates the QuickBooks invoice and requests payment — exactly as if the client approved it on their portal.')) return;
  try {
    const r = await api('POST', `/api/clients/${clientId}/change-orders/${coId}/approve`);
    await reload(); route();
    toast('Change order approved' + (r.quickbooksError ? ' (QB error: ' + r.quickbooksError + ')' : ''));
  } catch (e) { toast(e.message, true); }
};
window.sendCOInvoice = async function (clientId, coId) {
  try {
    await api('POST', `/api/clients/${clientId}/change-orders/${coId}/send-invoice`);
    toast('Change order invoice sent to client via QuickBooks');
  } catch (e) { toast(e.message, true); }
};
window.delCO = async function (id, coId) {
  if (!confirm('Delete this change order?')) return;
  await api('DELETE', `/api/clients/${id}/change-orders/${coId}`); await reload(); route();
};

/* ---------- Costs tab (internal) ---------- */
function tCosts(c) {
  const total = c.costs.items.reduce((a, i) => a + (Number(i.amount) || 0), 0);
  const rev = c._quote + c._coTotal;
  $('#tabBody').innerHTML = `
    <div class="banner lock">🔒 INTERNAL ONLY — costs never appear on contracts, the client portal, or any client email.</div>
    <div class="row" style="margin-bottom:14px">
      <div class="metric"><div class="v">${money(rev)}</div><div class="l">Revenue (quote + COs)</div></div>
      <div class="metric bad"><div class="v">${money(total)}</div><div class="l">Costs to Date</div></div>
      <div class="metric ${rev - total >= 0 ? 'good' : 'bad'}"><div class="v">${money(rev - total)}</div><div class="l">Profit</div></div>
      <div class="metric"><div class="v">${rev ? Math.round((rev - total) / rev * 100) : 0}%</div><div class="l">Margin</div></div>
    </div>
    <div class="card" style="max-width:680px">
      <h2>Build Costs</h2>
      <div id="costRows">${c.costs.items.map(it => `
        <div class="row" style="align-items:center;margin-bottom:8px" data-cost data-fileid="${it.fileId || ''}" title="${it.fileId ? 'Created automatically from an uploaded invoice' : ''}">
          ${it.fileId ? '<span title="From uploaded invoice">🧾</span>' : ''}
          <input class="input grow cost-label" value="${esc(it.label)}" placeholder="e.g. Shotcrete crew">
          <select class="input cost-cat" style="max-width:150px">${['Materials', 'Labor', 'Subcontractor', 'Permits', 'Equipment', 'Other'].map(x => `<option ${it.category === x ? 'selected' : ''}>${x}</option>`).join('')}</select>
          <span style="font-weight:700;color:var(--mid)">$</span>
          <input class="input cost-amount" type="number" step="0.01" style="max-width:140px;text-align:right" value="${it.amount || ''}">
          <button class="btn danger small" onclick="this.closest('[data-cost]').remove()">✕</button>
        </div>`).join('')}</div>
      <button class="btn secondary small" onclick="costAdd()">＋ Add cost</button>
      <div style="margin-top:14px"><button class="btn" onclick="costSave('${c.id}')">💾 Save Costs</button></div>
    </div>`;
}
window.costAdd = function () {
  $('#costRows').insertAdjacentHTML('beforeend', `
    <div class="row" style="align-items:center;margin-bottom:8px" data-cost>
      <input class="input grow cost-label" placeholder="e.g. Rebar package">
      <select class="input cost-cat" style="max-width:150px">${['Materials', 'Labor', 'Subcontractor', 'Permits', 'Equipment', 'Other'].map(x => `<option>${x}</option>`).join('')}</select>
      <span style="font-weight:700;color:var(--mid)">$</span>
      <input class="input cost-amount" type="number" step="0.01" style="max-width:140px;text-align:right">
      <button class="btn danger small" onclick="this.closest('[data-cost]').remove()">✕</button>
    </div>`);
};
window.costSave = async function (id) {
  const items = [...document.querySelectorAll('[data-cost]')].map(r => ({
    label: r.querySelector('.cost-label').value, category: r.querySelector('.cost-cat').value,
    amount: Number(r.querySelector('.cost-amount').value) || 0,
    ...(r.dataset.fileid ? { fileId: r.dataset.fileid } : {}),
  })).filter(i => i.label.trim());
  await api('PUT', '/api/clients/' + id, { costs: { items } });
  await reload(); toast('Costs saved'); route();
};

/* ---------- Portal tab ---------- */
// Whether/when the client has opened their portal, with a short visit log.
function portalAccessHTML(c) {
  const pa = c.portalAccess || {};
  if (!pa.lastAt) {
    return `<div class="banner info" style="margin-top:8px">👁 The client hasn't opened their portal yet.${c.contract.portalLinkSentAt ? '' : ' Email them the link above so they can.'}</div>`;
  }
  const times = pa.count === 1 ? 'once' : `${pa.count} times`;
  const rows = (pa.log || []).map(v =>
    `<li style="margin:2px 0">${fmtDateTime(v.at)} <span class="muted">· ${ago(v.at)}${v.ip ? ' · ' + esc(v.ip) : ''}</span></li>`).join('');
  return `<div class="card" style="background:var(--blue-soft);margin-top:8px">
      <p style="margin:0 0 4px"><b>👁 Client has opened their portal</b> — ${times}.</p>
      <p class="muted" style="margin:0 0 6px">First: ${fmtDateTime(pa.firstAt)} · Last: ${fmtDateTime(pa.lastAt)} (${ago(pa.lastAt)})</p>
      ${rows ? `<details><summary class="muted" style="cursor:pointer">Recent visits</summary><ul style="margin:6px 0 0;padding-left:18px;font-size:13px">${rows}</ul></details>` : ''}
    </div>`;
}
function tPortal(c) {
  const url = location.origin + '/portal/' + c.portalToken;
  $('#tabBody').innerHTML = `
    <div class="card" style="max-width:760px">
      <h2>Client-Facing Project Page</h2>
      <p>Share this private link with ${esc(c.name)} — it shows build progress (with the animated pool tracker), the current phase's deposit due with a pay button, chosen design finishes, and any items they need to complete. Costs and internal pricing are never shown.</p>
      <div class="row" style="align-items:center">
        <input class="input grow" readonly value="${url}" onclick="this.select()">
        <button class="btn secondary" onclick="navigator.clipboard.writeText('${url}');toast('Link copied')">Copy</button>
        <a class="btn secondary" href="${url}" target="_blank">Open Preview</a>
        ${c.email
          ? `<button class="btn" onclick="sendPortalLink('${c.id}')">📧 Email to Client</button>`
          : `<button class="btn" disabled title="No email address on file for this client">📧 Email to Client</button>`}
      </div>
      ${c.contract.portalLinkSentAt ? `<p class="muted" style="margin-top:6px">Last emailed ${fmtDate(c.contract.portalLinkSentAt)}${c.email ? ' → ' + esc(c.email) : ''}</p>` : ''}
      ${portalAccessHTML(c)}
      <h3>Client To-Do Items (shown as alerts on their page)</h3>
      <div id="todoList">${(c.clientTodos || []).map(t => `
        <div class="row" data-todo style="align-items:center;margin-bottom:6px">
          <input class="input grow todo-text" value="${esc(t.text)}">
          <label class="check" style="margin:0"><input type="checkbox" class="todo-done" ${t.done ? 'checked' : ''}> done</label>
          <button class="btn danger small" onclick="this.closest('[data-todo]').remove()">✕</button>
        </div>`).join('')}</div>
      <button class="btn secondary small" onclick="todoAdd()">＋ Add client to-do</button>
      <div style="margin-top:12px"><button class="btn" onclick="todoSave('${c.id}')">💾 Save</button></div>
    </div>`;
}
window.todoAdd = function () {
  $('#todoList').insertAdjacentHTML('beforeend', `
    <div class="row" data-todo style="align-items:center;margin-bottom:6px">
      <input class="input grow todo-text" placeholder="e.g. Provide gas line to heater location by May 1">
      <label class="check" style="margin:0"><input type="checkbox" class="todo-done"> done</label>
      <button class="btn danger small" onclick="this.closest('[data-todo]').remove()">✕</button>
    </div>`);
};
window.todoSave = async function (id) {
  const todos = [...document.querySelectorAll('[data-todo]')].map(r => ({
    text: r.querySelector('.todo-text').value, done: r.querySelector('.todo-done').checked,
  })).filter(t => t.text.trim());
  await api('PUT', '/api/clients/' + id, { clientTodos: todos });
  await reload(); toast('Saved'); route();
};
window.sendPortalLink = async function (id) {
  try {
    await api('POST', `/api/clients/${id}/portal/send-link`);
    await reload(); route(); toast('Portal link emailed to client');
  } catch (e) { toast('Email failed: ' + e.message, true); }
};

/* ============================== TASKS ============================== */
function vTasks() {
  const today = new Date().toISOString().slice(0, 10);
  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h1 style="margin:0">Tasks</h1><button class="btn" onclick="addTask()">＋ Assign Task</button>
    </div>
    <div class="card" style="margin-top:16px">
      <table class="tbl"><thead><tr><th>Task</th><th>Assigned To</th><th>Project</th><th>Due</th><th>Status</th><th></th></tr></thead><tbody>
      ${S.tasks.map(t => {
        const emp = S.employees.find(e => e.id === t.employeeId);
        const cl = S.clients.find(c => c.id === t.clientId);
        const overdue = t.status !== 'done' && t.dueDate && t.dueDate < today;
        return `<tr>
          <td><b>${esc(t.title)}</b>${t.source === 'auto' ? ' <span class="chip phase" title="Created automatically when the phase started">auto</span>' : ''}${t.details ? `<div class="muted">${esc(t.details)}</div>` : ''}</td>
          <td>${emp ? esc(emp.name) : '<i class="muted">unassigned</i>'}</td>
          <td>${cl ? `<a href="#/client/${cl.id}">${esc(cl.address)}</a>` : '—'}</td>
          <td style="${overdue ? 'color:var(--red);font-weight:700' : ''}">${fmtDate(t.dueDate)}${overdue ? ' ⚠' : ''}</td>
          <td>${t.status === 'done' ? '✅ Done' : '<span class="chip prospect">Open</span>'}</td>
          <td class="right" style="white-space:nowrap">
            ${t.status !== 'done' ? `<button class="btn small green" onclick="taskDone('${t.id}')">✓ Done</button>
            <button class="btn small secondary" onclick="taskRemind('${t.id}')">📧 Remind</button>` : ''}
            <button class="btn danger small" onclick="taskDel('${t.id}')">✕</button></td>
        </tr>`;
      }).join('') || '<tr><td colspan="6" class="muted">No tasks. Assign one!</td></tr>'}
      </tbody></table>
    </div>`;
}
window.addTask = function (preselectClientId) {
  modal(`<h2>Assign Task</h2>
    <label class="fld">Task<input type="text" id="tTitle" placeholder="Order rebar package"></label>
    <label class="fld">Details<textarea id="tDetails"></textarea></label>
    <label class="fld">Assign to<select id="tEmp"><option value="">— choose employee —</option>${S.employees.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select></label>
    <label class="fld">Project (optional)<select id="tClient"><option value="">—</option>${S.clients.map(c => `<option value="${c.id}" ${c.id === preselectClientId ? 'selected' : ''}>${esc(c.address)}</option>`).join('')}</select></label>
    <label class="fld">Due date<input type="date" id="tDue"></label>
    <label class="check"><input type="checkbox" id="tEmail" checked> Email assignment to employee now (Gmail)</label>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:10px"><button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn" onclick="addTask2()">Assign</button></div>`);
};
window.addTask2 = async function () {
  if (!$('#tTitle').value.trim()) return toast('Task title required', true);
  const t = await api('POST', '/api/tasks', {
    title: $('#tTitle').value, details: $('#tDetails').value, employeeId: $('#tEmp').value || null,
    clientId: $('#tClient').value || null, dueDate: $('#tDue').value || null, status: 'open', createdAt: new Date().toISOString(),
  });
  if ($('#tEmail').checked && t.employeeId) {
    try { await api('POST', `/api/tasks/${t.id}/remind`); } catch (e) { toast('Task saved; email failed: ' + e.message, true); }
  }
  await reload(); closeModal(); route(); toast('Task assigned');
};
window.taskDone = async function (id) { await api('PUT', '/api/tasks/' + id, { status: 'done' }); await reload(); route(); };
window.taskDel = async function (id) { await api('DELETE', '/api/tasks/' + id); await reload(); route(); };
window.taskRemind = async function (id) {
  try { const r = await api('POST', `/api/tasks/${id}/remind`); toast(r.email.status === 'sent' ? 'Reminder sent' : 'Logged (Gmail not configured)'); }
  catch (e) { toast(e.message, true); }
};

/* ============================== EMPLOYEES / CONTRACTORS ============================== */
function vEmployees() {
  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h1 style="margin:0">Employees</h1><button class="btn" onclick="empEdit()">＋ Add Employee</button>
    </div>
    <p class="muted">Everyone on this list receives automatic phase-completion and due-date alert emails.</p>
    <div class="card">
      <table class="tbl"><thead><tr><th>Name</th><th>Role</th><th>Email</th><th>Phone</th><th></th></tr></thead><tbody>
      ${S.employees.map(e => `<tr><td><b>${esc(e.name)}</b></td><td>${esc(e.role || '')}</td><td>${esc(e.email)}</td><td>${esc(e.phone || '')}</td>
        <td class="right"><button class="btn small secondary" onclick="empEdit('${e.id}')">Edit</button> <button class="btn danger small" onclick="empDel('${e.id}')">✕</button></td></tr>`).join('') || '<tr><td colspan="5" class="muted">No employees yet — add your team so they get alerts.</td></tr>'}
      </tbody></table>
    </div>`;
}
window.empEdit = function (id) {
  const e = S.employees.find(x => x.id === id) || { name: '', role: '', email: '', phone: '' };
  modal(`<h2>${id ? 'Edit' : 'Add'} Employee</h2>
    <label class="fld">Name<input type="text" id="emName" value="${esc(e.name)}"></label>
    <label class="fld">Role<input type="text" id="emRole" value="${esc(e.role || '')}" placeholder="Project Manager"></label>
    <label class="fld">Email (Gmail alerts go here)<input type="email" id="emEmail" value="${esc(e.email)}"></label>
    <label class="fld">Phone<input type="tel" id="emPhone" value="${esc(e.phone || '')}"></label>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn" onclick="empSave('${id || ''}')">Save</button></div>`);
};
window.empSave = async function (id) {
  const body = { name: ($('#emName') || {}).value || '', role: ($('#emRole') || {}).value || '', email: ($('#emEmail') || {}).value || '', phone: ($('#emPhone') || {}).value || '' };
  if (!body.name) return toast('Name required', true);
  try {
    await api(id ? 'PUT' : 'POST', '/api/employees' + (id ? '/' + id : ''), body);
    await reload(); closeModal(); route(); toast('Saved');
  } catch (e) { toast('Save failed: ' + e.message, true); }
};
window.empDel = async function (id) {
  if (!confirm('Remove employee?')) return;
  try { await api('DELETE', '/api/employees/' + id); await reload(); route(); }
  catch (e) { toast('Delete failed: ' + e.message, true); }
};

function vContractors() {
  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h1 style="margin:0">Contractor Reference List</h1><button class="btn" onclick="conEdit()">＋ Add Contractor</button>
    </div>
    <div class="card" style="margin-top:16px">
      <table class="tbl"><thead><tr><th>Name</th><th>Company</th><th>Category</th><th>Phone</th><th>Email</th><th></th></tr></thead><tbody>
      ${[...S.contractors].sort((a, b) => (a.category || '').localeCompare(b.category || '')).map(x => `<tr>
        <td><b>${esc(x.name)}</b></td><td>${esc(x.company || '')}</td><td><span class="chip phase">${esc(x.category || '')}</span></td>
        <td>${esc(x.phone || '')}</td><td>${esc(x.email || '')}</td>
        <td class="right"><button class="btn small secondary" onclick="conEdit('${x.id}')">Edit</button> <button class="btn danger small" onclick="conDel('${x.id}')">✕</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">No contractors yet.</td></tr>'}
      </tbody></table>
    </div>`;
}
window.conEdit = function (id) {
  const x = S.contractors.find(c => c.id === id) || { name: '', company: '', category: S.settings.contractorCategories[0], phone: '', email: '' };
  modal(`<h2>${id ? 'Edit' : 'Add'} Contractor</h2>
    <label class="fld">Name<input type="text" id="cnName" value="${esc(x.name)}"></label>
    <label class="fld">Company<input type="text" id="cnCo" value="${esc(x.company || '')}"></label>
    <label class="fld">Category of service<select id="cnCat">${S.settings.contractorCategories.map(c => `<option ${x.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
    <label class="fld">Phone<input type="tel" id="cnPhone" value="${esc(x.phone || '')}"></label>
    <label class="fld">Email<input type="email" id="cnEmail" value="${esc(x.email || '')}"></label>
    <div style="display:flex;gap:10px;justify-content:flex-end"><button class="btn secondary" onclick="closeModal()">Cancel</button>
    <button class="btn" onclick="conSave('${id || ''}')">Save</button></div>`);
};
window.conSave = async function (id) {
  const body = { name: $('#cnName').value, company: $('#cnCo').value, category: $('#cnCat').value, phone: $('#cnPhone').value, email: $('#cnEmail').value };
  if (!body.name) return toast('Name required', true);
  await api(id ? 'PUT' : 'POST', '/api/contractors' + (id ? '/' + id : ''), body);
  await reload(); closeModal(); route(); toast('Saved');
};
window.conDel = async function (id) { if (!confirm('Remove contractor?')) return; await api('DELETE', '/api/contractors/' + id); await reload(); route(); };

/* ============================== DESIGN LIBRARY ============================== */
function vDesign() {
  const tierOrder = ['Standard', 'Upgrade', 'Premium', 'Extra Premium', 'Brilliance'];
  const brands = ['PebbleTec', 'PebbleSheen', 'PebbleFina', 'PebbleBrilliance'];
  const pc = S.pebbleCheck;
  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <h1 style="margin:0">Design Library — Pebble Finishes</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" onclick="addColor()">＋ Add Color</button>
        <button class="btn secondary" onclick="runPebbleCheck()">🔄 Check pebbletec.com now</button>
      </div>
    </div>
    <p class="muted">Tiers follow the 2026 Pool Builder Rates sheet (pricing kept internal). Automatically verified against
      <a href="https://pebbletec.com/products/all-finishes/" target="_blank">pebbletec.com/products/all-finishes</a> every Monday at 7:00 AM CST —
      you'll get an email if a finish was added or removed. Last check: <b>${pc.lastRun ? fmtDate(pc.lastRun) : 'never'}</b>
      ${pc.lastResult ? (pc.lastResult.ok ? `(${pc.lastResult.added.length} new, ${pc.lastResult.missing.length} removed)` : '(failed: ' + esc(pc.lastResult.error) + ')') : ''}.
      <b>Click any color to edit it</b> — change its tier (Standard / Upgrade / Premium…), retire it, or update its swatch.</p>
    ${brands.map(brand => {
      const tiers = tierOrder.filter(t => S.finishes.some(f => f.brand === brand && f.tier === t));
      if (!tiers.length) return '';
      return `<div class="card"><h2>${brand}</h2>${tiers.map(t => `
        <h3>${t === 'Brilliance' ? 'All Colors' : t + ' Tier'}</h3>
        <div class="swatch-grid">${S.finishes.filter(f => f.brand === brand && f.tier === t).map(f => `
          <div class="swatch ${f.active ? '' : 'inactive'}" title="Click to edit tier, retire, or update this color" onclick="editColor('${f.id}')">
            ${f.localImage || f.imageUrl ? `<img loading="lazy" src="${f.localImage || f.imageUrl}" alt="${esc(f.name)}">` : `<div class="colorblock" style="background:${f.color}"></div>`}
            <div class="nm">${esc(f.name)}${f.shimmer ? ' ✨' : ''}<small>${esc(f.tier)} · ${f.active ? 'active' : 'retired'}</small></div>
          </div>`).join('')}</div>`).join('')}</div>`;
    }).join('')}`;
}
const FINISH_TIERS = ['Standard', 'Upgrade', 'Premium', 'Extra Premium', 'Brilliance'];
const FINISH_BRANDS = ['PebbleTec', 'PebbleSheen', 'PebbleFina', 'PebbleBrilliance'];
function colorFormFields(f) {
  f = f || {};
  return `
    <div class="row">
      <label class="fld grow">Brand<select id="cfBrand">${FINISH_BRANDS.map(b => `<option ${f.brand === b ? 'selected' : ''}>${b}</option>`).join('')}</select></label>
      <label class="fld grow">Tier (upgrade level)<select id="cfTier">${FINISH_TIERS.map(t => `<option ${f.tier === t ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>
    <label class="fld">Color Name<input type="text" id="cfName" value="${esc(f.name || '')}" placeholder="e.g. Egyptian Sands"></label>
    <div class="row">
      <label class="fld">Swatch Color<input type="color" id="cfColor" value="${esc(f.color || '#8fb8d4')}" style="height:42px;padding:2px"></label>
      <label class="fld grow">Swatch Image URL (optional)<input type="text" id="cfImage" value="${esc(f.imageUrl || '')}" placeholder="https://…jpg — leave blank to use the color"></label>
    </div>
    <div style="display:flex;gap:18px;margin-top:6px">
      <label class="check"><input type="checkbox" id="cfShimmer" ${f.shimmer ? 'checked' : ''}> ✨ Shimmer finish</label>
      <label class="check"><input type="checkbox" id="cfActive" ${f.active !== false ? 'checked' : ''}> Active (clients can choose it on the portal)</label>
    </div>`;
}
function colorFormValues() {
  return {
    brand: $('#cfBrand').value, tier: $('#cfTier').value, name: $('#cfName').value.trim(),
    color: $('#cfColor').value, imageUrl: $('#cfImage').value.trim() || null,
    shimmer: $('#cfShimmer').checked, active: $('#cfActive').checked,
  };
}
window.addColor = function () {
  modal(`<h2>Add Color to Design Library</h2>
    ${colorFormFields({ tier: 'Upgrade', active: true })}
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
      <button class="btn" id="cfSave">Add Color</button></div>`, root => {
    root.querySelector('#cfSave').onclick = async () => {
      const v = colorFormValues();
      if (!v.name) return toast('Color name is required', true);
      try { await api('POST', '/api/finishes', v); await reload(); closeModal(); route(); toast('Color added to the library'); }
      catch (e) { toast(e.message, true); }
    };
    $('#cfName').focus();
  });
};
window.editColor = function (id) {
  const f = S.finishes.find(x => x.id === id); if (!f) return;
  modal(`<h2>Edit Color</h2>
    ${colorFormFields(f)}
    <div style="display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:14px">
      <button class="btn danger" id="cfDel">Delete</button>
      <div style="display:flex;gap:10px">
        <button class="btn secondary" onclick="closeModal()">Cancel</button>
        <button class="btn" id="cfSave">Save Changes</button>
      </div>
    </div>`, root => {
    root.querySelector('#cfSave').onclick = async () => {
      const v = colorFormValues();
      if (!v.name) return toast('Color name is required', true);
      try { await api('PUT', '/api/finishes/' + id, v); await reload(); closeModal(); route(); toast('Color updated'); }
      catch (e) { toast(e.message, true); }
    };
    root.querySelector('#cfDel').onclick = async () => {
      if (!confirm(`Delete "${f.name}" from the library?\n\nTo just hide it from clients, uncheck Active instead.`)) return;
      try { await api('DELETE', '/api/finishes/' + id); await reload(); closeModal(); route(); toast('Color deleted'); }
      catch (e) { toast(e.message, true); }
    };
  });
};
window.runPebbleCheck = async function () {
  toast('Checking pebbletec.com…');
  try {
    const r = await api('POST', '/api/pebble-check/run', { sendEmail: false });
    await reload(); route();
    toast(r.ok ? `Check done: ${r.added.length} new on site, ${r.missing.length} missing from site` : 'Check failed: ' + r.error, !r.ok);
  } catch (e) { toast(e.message, true); }
};

/* ============================== ALERTS ============================== */
async function vAlerts() {
  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center">
      <h1 style="margin:0">Alerts</h1>
      <button class="btn secondary" onclick="api('POST','/api/alerts/read').then(reload).then(route)">Mark all read</button>
    </div>
    <div class="card" style="margin-top:16px">
      ${S.alerts.map(a => {
        const c = a.clientId ? S.clients.find(x => x.id === a.clientId) : null;
        return `<div class="alert-row" style="${a.read ? 'opacity:.65' : 'font-weight:600'}">
          <span class="alert-dot ${a.type}"></span>
          <span style="flex:1">${esc(a.message)} ${c ? `<a href="#/client/${c.id}">open</a>` : ''}</span>
          <span class="when">${ago(a.createdAt)}</span></div>`;
      }).join('') || '<p class="muted">No alerts yet.</p>'}
    </div>
    <div class="card">
      <h2>Email Log (Gmail)</h2>
      <table class="tbl"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th></tr></thead><tbody>
      ${S.outbox.map(o => `<tr><td class="muted" style="white-space:nowrap">${ago(o.createdAt)}</td><td>${esc(o.to)}</td><td>${esc(o.subject)}</td>
        <td>${o.status === 'sent' ? '<span class="chip active">sent</span>' : `<span class="chip prospect" title="${esc(o.error || '')}">${esc(o.status)}</span>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No emails yet.</td></tr>'}
      </tbody></table>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="margin:0">Error Log</h2>
        ${(S.errorLog || []).length ? `<button class="btn danger small" onclick="clearErrorLog()">Clear Log</button>` : ''}
      </div>
      ${(S.errorLog || []).length ? `
      <table class="tbl"><thead><tr><th>When</th><th>Method</th><th>Path</th><th>Error</th></tr></thead><tbody>
      ${(S.errorLog).map(e => `<tr>
        <td class="muted" style="white-space:nowrap">${ago(e.createdAt)}</td>
        <td><span class="chip phase">${esc(e.method)}</span></td>
        <td class="muted">${esc(e.path)}</td>
        <td style="font-size:13px">${esc(e.message)}${e.stack ? `<details style="margin-top:4px"><summary style="cursor:pointer;color:var(--mid);font-size:11px">stack trace</summary><pre style="font-size:10px;overflow:auto;max-height:120px;margin:4px 0 0">${esc(e.stack)}</pre></details>` : ''}</td>
      </tr>`).join('')}
      </tbody></table>` : '<p class="muted">No errors logged — all systems running cleanly.</p>'}
    </div>`;
}
window.clearErrorLog = async function () {
  if (!confirm('Clear all error log entries?')) return;
  await api('DELETE', '/api/error-log');
  await reload(); route();
  toast('Error log cleared');
};

/* ============================== SETTINGS ============================== */
function vSettings() {
  const st = S.settings;
  $('#main').innerHTML = `
    <h1>Settings</h1>
    <div class="card" style="max-width:760px">
      <h2>Company</h2>
      <div class="row">
        <label class="fld grow">Company name<input type="text" id="stName" value="${esc(st.companyName)}"></label>
        <label class="fld grow">Company email<input type="email" id="stEmail" value="${esc(st.companyEmail)}"></label>
      </div>
      <div class="row">
        <label class="fld grow">Phone<input type="text" id="stPhone" value="${esc(st.companyPhone || '')}"></label>
        <label class="fld grow">Address<input type="text" id="stAddr" value="${esc(st.companyAddress || '')}"></label>
      </div>
    </div>
    <div class="card" style="max-width:760px">
      <h2>Email (Gmail) ${S.gmailConfigured ? '<span class="chip active">connected</span>' : '<span class="chip prospect">not configured</span>'}</h2>
      <p class="muted">Uses a Gmail <b>App Password</b>: Google Account → Security → 2-Step Verification → App passwords → create one for "Mail". Paste the 16-character code below.</p>
      <div class="row">
        <label class="fld grow">Gmail address<input type="email" id="stGUser" value="${esc(st.gmail.user || '')}"></label>
        <label class="fld grow">App password<input type="text" id="stGPass" value="${esc(st.gmail.appPassword || '')}" placeholder="xxxx xxxx xxxx xxxx"></label>
      </div>
      <button class="btn secondary small" onclick="testEmail()">Send test email</button>
    </div>
    <div class="card" style="max-width:760px">
      <h2>QuickBooks ${S.quickbooksConnected ? '<span class="chip active">connected</span>' : '<span class="chip prospect">not connected</span>'}</h2>
      <p class="muted">Optional automation: with an Intuit developer app's credentials, signing a contract auto-creates the invoice and phase emails carry live payment links. Without it, paste QuickBooks payment links per phase (Contract & Phases tab) — everything else still works.</p>
      <div class="row">
        <label class="fld grow">Realm ID (Company ID)<input type="text" id="qbRealm" value="${esc(st.quickbooks.realmId || '')}"></label>
        <label class="fld grow">Environment<select id="qbEnv"><option ${st.quickbooks.environment === 'production' ? 'selected' : ''}>production</option><option ${st.quickbooks.environment === 'sandbox' ? 'selected' : ''}>sandbox</option></select></label>
      </div>
      <div class="row">
        <label class="fld grow">Client ID<input type="text" id="qbCid" value="${esc(st.quickbooks.clientId || '')}"></label>
        <label class="fld grow">Client Secret<input type="text" id="qbSec" value="${esc(st.quickbooks.clientSecret || '')}"></label>
      </div>
      <label class="fld">Refresh Token<input type="text" id="qbTok" value="${esc(st.quickbooks.refreshToken || '')}"></label>
      <div class="row">
        <label class="fld grow">ACH fee note (shown to client)<input type="text" id="qbAch" value="${esc(st.quickbooks.achFeeNote)}"></label>
        <label class="fld grow">Card fee note (shown to client)<input type="text" id="qbCc" value="${esc(st.quickbooks.ccFeeNote)}"></label>
      </div>
      <label class="check"><input type="checkbox" id="qbPass" ${st.quickbooks.passFeesToClient ? 'checked' : ''}> Show processing-fee notes on payment request emails</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">
        <button class="btn secondary small" onclick="testQuickBooks()">Test Connection</button>
        <span class="muted" style="font-size:12px;align-self:center">Saves settings, then verifies the token with Intuit. Your token is not cleared if the test fails.</span>
      </div>
    </div>
    <div class="card" style="max-width:760px">
      <h2>DocuSeal (In-Portal Signing) ${S.docusealConfigured ? '<span class="chip active">configured</span>' : '<span class="chip prospect">not configured</span>'}</h2>
      <p class="muted">When configured, the Contract & Phases tab shows an <b>Enable In-Portal Signing</b> button. The contract is sent to DocuSeal and the client signs it directly inside their portal — no email round-trip. The signed PDF is saved to the client's Files automatically.</p>
      <p class="muted" style="margin-top:0">Get your API key: DocuSeal → Settings → API. For self-hosted DocuSeal, set the base URL to your instance (e.g. https://sign.yourdomain.com/api).</p>
      <div class="row">
        <label class="fld grow" style="flex:2">API Key<input type="text" id="dsKey" value="${esc((st.docuseal || {}).apiKey || '')}" placeholder="Paste your DocuSeal API key"></label>
        <label class="fld grow">API Base URL<input type="text" id="dsBase" value="${esc((st.docuseal || {}).apiBaseUri || 'https://api.docuseal.com')}" placeholder="https://api.docuseal.com"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary small" onclick="testDocuseal()">Test Connection</button>
        <span class="muted" style="font-size:12px;align-self:center">Add a webhook in DocuSeal pointing to <code>${location.origin}/api/webhooks/docuseal</code> for the <b>form.completed</b> event to auto-finalize. Without it, signing still completes when the client finishes in the portal.</span>
      </div>
    </div>
    <div class="card" style="max-width:760px">
      <h2>Haul-Off &amp; Gravel Rates</h2>
      <p class="muted">Default per-unit rates for haul-off and gravel change orders. Pre-filled on each client's Change Orders page and editable per job.</p>
      ${S.marketRates ? `<div class="banner info" style="margin-bottom:12px">
        <b>Daily market research — Middle Tennessee</b> (updated ${S.marketRates.updatedAt ? S.marketRates.updatedAt.slice(0,10) : 'recently'})<br>
        Tri-axle haul-off: <b>${money(S.marketRates.triAxle.low)}–${money(S.marketRates.triAxle.high)}</b> · suggested <b>${money(S.marketRates.triAxle.suggested)}</b>${S.marketRates.triAxle.note ? ' · ' + esc(S.marketRates.triAxle.note) : ''}<br>
        Gravel delivery: <b>${money(S.marketRates.gravel.low)}–${money(S.marketRates.gravel.high)}</b> · suggested <b>${money(S.marketRates.gravel.suggested)}</b>${S.marketRates.gravel.note ? ' · ' + esc(S.marketRates.gravel.note) : ''}
      </div>` : '<p class="muted" style="font-style:italic">Daily market rate data not yet available — will appear after the first scheduled search runs.</p>'}
      <div class="row">
        <label class="fld grow">Extra Tri-Axle Haul-Off rate ($/truck)<input type="number" id="hrTriAxle" min="0" step="25" value="${esc(String((st.haulRates || {}).triAxle ?? 500))}"></label>
        <label class="fld grow">Extra Gravel Load rate ($/load)<input type="number" id="hrGravel" min="0" step="25" value="${esc(String((st.haulRates || {}).gravel ?? 1000))}"></label>
      </div>
    </div>
    <div class="card" style="max-width:860px">
      <h2>Automatic Phase Task Workflows</h2>
      <p class="muted">When a phase begins (or the contract is signed, for Design), these tasks are created automatically with due dates counted from the phase start. Assign a default owner per task — they'll get an email listing their new tasks the moment the phase kicks off.</p>
      <div id="ttWorkflows">
      ${S.settings.phaseTemplate.map(ph => `
        <h3 style="color:var(--blue-dark)">${esc(ph.name)}</h3>
        <div data-ttphase="${ph.key}">
        ${((S.settings.taskTemplates || {})[ph.key] || []).map(t => `
          <div class="row" data-ttrow style="align-items:center;margin-bottom:6px">
            <input class="input grow tt-title" value="${esc(t.title)}" placeholder="Task">
            <select class="input tt-emp" style="max-width:170px"><option value="">unassigned</option>${S.employees.map(e => `<option value="${e.id}" ${t.employeeId === e.id ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}</select>
            <span class="muted" style="white-space:nowrap">due +</span>
            <input class="input tt-off" type="number" min="0" style="max-width:70px" value="${Number(t.dueOffsetDays) || 0}">
            <span class="muted">days</span>
            <button class="btn danger small" onclick="this.closest('[data-ttrow]').remove()">✕</button>
          </div>`).join('')}
        </div>
        <button class="btn secondary small" style="margin-bottom:10px" onclick="ttAdd('${ph.key}')">＋ Add task to ${esc(ph.name)}</button>`).join('')}
      </div>
      <button class="btn secondary" onclick="ttAddPhase()">＋ Add Phase Section</button>
      <p class="muted" style="font-size:12px;margin-top:6px">New phase sections are added to your standard phase list at a 0% draw (no change to the payment schedule) and apply to newly created projects.</p>
    </div>
    <div class="card" style="max-width:860px">
      <h2>Scope of Work (master template)</h2>
      <p class="muted">The default Scope of Work copied into every new project's contract. You can still edit any individual client's scope on their <b>Scope of Work</b> tab without changing this master.</p>
      <div id="scopeMaster">
      ${(st.scopeTemplate || []).map(sec => `
        <div class="card" style="background:var(--blue-pale)" data-scopesec data-key="${esc(sec.key || '')}">
          <div class="row" style="align-items:center">
            <input class="input grow sm-title" value="${esc(sec.title)}" style="font-weight:700">
            <button class="btn danger small" onclick="this.closest('[data-scopesec]').remove()">Delete Section</button>
          </div>
          <div class="sm-items" style="margin-top:8px">
          ${(sec.items || []).map(it => smLineRowHTML(scopeText(it), scopeIndentOf(it))).join('')}
          </div>
          <button class="btn secondary small" onclick="smAddLine(this)">＋ Add line</button>
        </div>`).join('')}
      </div>
      <button class="btn secondary" onclick="smAddSection()">＋ Add Section</button>
    </div>
    <div class="card" style="max-width:860px">
      <h2>Disclosures, Exclusions & Site Conditions (universal — applies to ALL contracts)</h2>
      <div id="discList">
      ${st.disclosures.map((d, i) => `
        <div class="card" style="background:var(--blue-pale)" data-disc>
          <div class="row" style="align-items:center">
            <b class="disc-num" style="color:var(--blue-dark)">${i + 1}.</b>
            <input class="input grow disc-title" value="${esc(d.title)}">
            <button class="btn secondary small" title="Move up" onclick="discMove(this,-1)">↑</button>
            <button class="btn secondary small" title="Move down" onclick="discMove(this,1)">↓</button>
            <button class="btn danger small" onclick="this.closest('[data-disc]').remove();discRenumber()">✕</button>
          </div>
          <textarea class="input disc-body" style="margin-top:8px;min-height:90px">${esc(d.body)}</textarea>
        </div>`).join('')}
      </div>
      <button class="btn secondary small" onclick="discAdd()">＋ Add disclosure section</button>
    </div>
    <button class="btn" onclick="settingsSave()">💾 Save All Settings</button>
    <p class="muted" style="margin-top:8px">Weekly Pebble Tec check email goes to: <b>${esc(st.pebbleCheckEmail)}</b> (Mondays 7:00 AM CST while the app is running).</p>`;
  initSettingsCollapse();
}
// Collapse each Settings section to just its header; clicking the header expands
// it. Inputs stay in the DOM while collapsed, so Save reads them all as normal.
window.initSettingsCollapse = function () {
  document.querySelectorAll('#main > .card').forEach(card => {
    const h2 = card.querySelector(':scope > h2');
    if (!h2) return;
    const body = document.createElement('div');
    body.className = 'card-body';
    for (let n = h2.nextSibling; n; n = h2.nextSibling) body.appendChild(n);
    card.appendChild(body);
    body.style.display = 'none';
    h2.style.cursor = 'pointer';
    h2.style.userSelect = 'none';
    const caret = document.createElement('span');
    caret.textContent = '▸ ';
    caret.style.color = 'var(--blue)';
    h2.insertBefore(caret, h2.firstChild);
    h2.addEventListener('click', () => {
      const open = body.style.display !== 'none';
      body.style.display = open ? 'none' : '';
      caret.textContent = open ? '▸ ' : '▾ ';
    });
  });
};
window.discAdd = function () {
  $('#discList').insertAdjacentHTML('beforeend', `
    <div class="card" style="background:var(--blue-pale)" data-disc>
      <div class="row" style="align-items:center"><b class="disc-num" style="color:var(--blue-dark)">＋</b>
        <input class="input grow disc-title" placeholder="Section title">
        <button class="btn secondary small" title="Move up" onclick="discMove(this,-1)">↑</button>
        <button class="btn secondary small" title="Move down" onclick="discMove(this,1)">↓</button>
        <button class="btn danger small" onclick="this.closest('[data-disc]').remove();discRenumber()">✕</button></div>
      <textarea class="input disc-body" style="margin-top:8px;min-height:90px"></textarea>
    </div>`);
  discRenumber();
};
window.discMove = function (btn, dir) {
  const card = btn.closest('[data-disc]');
  if (dir < 0 && card.previousElementSibling) card.parentNode.insertBefore(card, card.previousElementSibling);
  else if (dir > 0 && card.nextElementSibling) card.parentNode.insertBefore(card.nextElementSibling, card);
  discRenumber();
};
window.discRenumber = function () {
  [...document.querySelectorAll('#discList [data-disc] .disc-num')].forEach((n, i) => { n.textContent = (i + 1) + '.'; });
};
window.ttAdd = function (phaseKey) {
  document.querySelector(`[data-ttphase="${phaseKey}"]`).insertAdjacentHTML('beforeend', `
    <div class="row" data-ttrow style="align-items:center;margin-bottom:6px">
      <input class="input grow tt-title" placeholder="Task">
      <select class="input tt-emp" style="max-width:170px"><option value="">unassigned</option>${S.employees.map(e => `<option value="${e.id}">${esc(e.name)}</option>`).join('')}</select>
      <span class="muted" style="white-space:nowrap">due +</span>
      <input class="input tt-off" type="number" min="0" style="max-width:70px" value="1">
      <span class="muted">days</span>
      <button class="btn danger small" onclick="this.closest('[data-ttrow]').remove()">✕</button>
    </div>`);
};
// One master-template line row (DOM-based) with the same move/indent/delete
// abilities as the per-client Scope tab.
function smLineRowHTML(text, indent) {
  indent = indent || 0;
  return `<div class="row sm-line" data-indent="${indent}" style="align-items:center;margin-bottom:6px;padding-left:${indent * 28}px">
    ${indent ? '<span class="sm-mark" style="color:var(--mid)">↳</span>' : ''}
    <input class="input grow sm-item" value="${esc(text)}">
    <button class="btn secondary small sm-out" title="Outdent" onclick="smIndent(this,-1)" ${indent === 0 ? 'disabled' : ''}>⇤</button>
    <button class="btn secondary small sm-in" title="Indent as sub-item" onclick="smIndent(this,1)" ${indent >= SCOPE_MAX_INDENT ? 'disabled' : ''}>⇥</button>
    <button class="btn secondary small" title="Move up" onclick="smMoveLine(this,-1)">↑</button>
    <button class="btn secondary small" title="Move down" onclick="smMoveLine(this,1)">↓</button>
    <button class="btn danger small" onclick="this.closest('.sm-line').remove()">✕</button></div>`;
}
window.smMoveLine = function (btn, dir) {
  const row = btn.closest('.sm-line');
  if (dir < 0 && row.previousElementSibling) row.parentNode.insertBefore(row, row.previousElementSibling);
  else if (dir > 0 && row.nextElementSibling) row.parentNode.insertBefore(row.nextElementSibling, row);
};
window.smIndent = function (btn, dir) {
  const row = btn.closest('.sm-line');
  const ind = Math.max(0, Math.min(SCOPE_MAX_INDENT, (Number(row.dataset.indent) || 0) + dir));
  row.dataset.indent = ind;
  row.style.paddingLeft = (ind * 28) + 'px';
  let mark = row.querySelector('.sm-mark');
  if (ind && !mark) {
    mark = document.createElement('span'); mark.className = 'sm-mark'; mark.style.color = 'var(--mid)'; mark.textContent = '↳';
    row.insertBefore(mark, row.firstChild);
  } else if (!ind && mark) { mark.remove(); }
  const out = row.querySelector('.sm-out'), inb = row.querySelector('.sm-in');
  if (out) out.disabled = ind === 0;
  if (inb) inb.disabled = ind >= SCOPE_MAX_INDENT;
};
window.smAddLine = function (btn) {
  btn.previousElementSibling.insertAdjacentHTML('beforeend', smLineRowHTML('', 0));
};
window.smAddSection = function () {
  const key = 'custom_' + Date.now().toString(36);
  $('#scopeMaster').insertAdjacentHTML('beforeend', `
    <div class="card" style="background:var(--blue-pale)" data-scopesec data-key="${key}">
      <div class="row" style="align-items:center">
        <input class="input grow sm-title" placeholder="Section title" style="font-weight:700">
        <button class="btn danger small" onclick="this.closest('[data-scopesec]').remove()">Delete Section</button>
      </div>
      <div class="sm-items" style="margin-top:8px">${smLineRowHTML('', 0)}</div>
      <button class="btn secondary small" onclick="smAddLine(this)">＋ Add line</button>
    </div>`);
};
window.ttAddPhase = function () {
  const key = 'custom_' + Date.now().toString(36);
  $('#ttWorkflows').insertAdjacentHTML('beforeend', `
    <h3 style="color:var(--blue-dark)">＋ New Phase</h3>
    <div data-ttphase="${key}" data-newphase="1">
      <input class="input tt-phasename" placeholder="Phase name (e.g. Permitting, Warranty)" style="font-weight:700;max-width:320px;margin-bottom:8px">
    </div>
    <button class="btn secondary small" style="margin-bottom:10px" onclick="ttAdd('${key}')">＋ Add task</button>`);
};
window.settingsSave = async function () {
  const disclosures = [...document.querySelectorAll('[data-disc]')].map(d => ({
    title: d.querySelector('.disc-title').value, body: d.querySelector('.disc-body').value,
  })).filter(d => d.title.trim());
  const taskTemplates = {};
  const existingPhase = Object.fromEntries((S.settings.phaseTemplate || []).map(p => [p.key, p]));
  const phaseTemplate = [];
  document.querySelectorAll('[data-ttphase]').forEach(ph => {
    const key = ph.dataset.ttphase;
    taskTemplates[key] = [...ph.querySelectorAll('[data-ttrow]')].map(r => ({
      title: r.querySelector('.tt-title').value,
      employeeId: r.querySelector('.tt-emp').value || null,
      dueOffsetDays: Number(r.querySelector('.tt-off').value) || 0,
    })).filter(t => t.title.trim());
    if (ph.dataset.newphase) {
      const name = (ph.querySelector('.tt-phasename')?.value || '').trim() || 'New Phase';
      phaseTemplate.push({ key, name, drawPct: 0, time: '', clientSummary: '', clientLabel: name });
    } else if (existingPhase[key]) {
      phaseTemplate.push(existingPhase[key]);
    }
  });
  const scopeTemplate = [...document.querySelectorAll('[data-scopesec]')].map(sec => ({
    key: sec.dataset.key || ('custom_' + Math.random().toString(36).slice(2, 8)),
    title: sec.querySelector('.sm-title').value,
    items: [...sec.querySelectorAll('.sm-line')].map(row => {
      const text = row.querySelector('.sm-item').value;
      const indent = Number(row.dataset.indent) || 0;
      return indent ? { text, indent } : text;
    }).filter(it => (typeof it === 'string' ? it : it.text).trim()),
  })).filter(s => s.title.trim());
  await api('PUT', '/api/settings', {
    taskTemplates,
    phaseTemplate,
    scopeTemplate,
    companyName: $('#stName').value, companyEmail: $('#stEmail').value,
    companyPhone: $('#stPhone').value, companyAddress: $('#stAddr').value,
    gmail: { user: $('#stGUser').value.trim(), appPassword: $('#stGPass').value.trim() },
    quickbooks: { ...S.settings.quickbooks, realmId: $('#qbRealm').value.trim(), environment: $('#qbEnv').value, clientId: $('#qbCid').value.trim(), clientSecret: $('#qbSec').value.trim(), refreshToken: $('#qbTok').value.trim(), achFeeNote: $('#qbAch').value, ccFeeNote: $('#qbCc').value, passFeesToClient: $('#qbPass').checked },
    docuseal: { apiKey: $('#dsKey').value.trim(), apiBaseUri: $('#dsBase').value.trim() || 'https://api.docuseal.com' },
    haulRates: { triAxle: Number($('#hrTriAxle').value) || 500, gravel: Number($('#hrGravel').value) || 1000 },
    disclosures,
  });
  await reload(); toast('Settings saved'); route();
};
window.testDocuseal = async function () {
  await settingsSave();
  try {
    await api('POST', '/api/settings/docuseal/test');
    toast('DocuSeal connected ✓');
  } catch (e) { toast(e.message, true); }
};
window.testQuickBooks = async function () {
  await settingsSave();
  try {
    const r = await api('POST', '/api/settings/quickbooks/test');
    if (r.ok) toast('QuickBooks connected ✓' + (r.companyName ? ' · ' + r.companyName : ''));
    else toast(r.error, true);
  } catch (e) { toast(e.message, true); }
};
window.testEmail = async function () {
  await settingsSave();
  try { const r = await api('POST', '/api/test-email', {}); toast(r.email.status === 'sent' ? 'Test email sent — check your inbox' : 'Not sent: ' + (r.email.error || r.email.status), r.email.status !== 'sent'); }
  catch (e) { toast(e.message, true); }
};

/* ============================== EULA ============================== */
function vEula() {
  $('#main').innerHTML = `
    <div style="max-width:760px">
      <h1>End User License Agreement</h1>
      <p class="muted">Last Updated: May 4, 2026</p>
      <div class="card">
        <p>This End User License Agreement ("Agreement") is a legal agreement between you ("User") and Infinity Pools ("Company") governing your use of the Infinity Pools Build Manager application ("App"). By accessing or using the App, you agree to be bound by this Agreement.</p>

        <h2>1. License Grant</h2>
        <p>Subject to the terms of this Agreement, Infinity Pools grants you a limited, non-exclusive, non-transferable, revocable license to use the App solely for internal pool construction scheduling and job management activities.</p>

        <h2>2. Restrictions</h2>
        <p>You may not: copy, modify, or distribute the App; reverse engineer or attempt to extract the source code; rent, lease, or lend the App; use the App for any unlawful purpose; or remove any proprietary notices or labels.</p>

        <h2>3. QuickBooks Integration</h2>
        <p>The App may connect to QuickBooks Online via OAuth 2.0 to sync invoicing and customer data. This data is used solely for display and operational purposes within the App. You may revoke this access at any time through your QuickBooks account settings.</p>

        <h2>4. DocuSeal Integration</h2>
        <p>The App may connect to DocuSeal to facilitate electronic contract signing. Documents transmitted through this integration are governed by DocuSeal's terms of service. Infinity Pools is not responsible for DocuSeal's availability or performance.</p>

        <h2>5. No Warranty</h2>
        <p>THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND. INFINITY POOLS DOES NOT WARRANT THAT THE APP WILL BE UNINTERRUPTED, ERROR-FREE, OR SECURE.</p>

        <h2>6. Limitation of Liability</h2>
        <p>TO THE MAXIMUM EXTENT PERMITTED BY LAW, INFINITY POOLS SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL DAMAGES, OR LOST PROFITS ARISING FROM YOUR USE OF THE APP.</p>

        <h2>7. Termination</h2>
        <p>Infinity Pools may terminate this Agreement and your access to the App at any time for non-compliance with these terms. Upon termination, you must immediately cease all use of the App.</p>

        <h2>8. Governing Law</h2>
        <p>This Agreement is governed by the laws of the State of Tennessee. Any disputes arising under this Agreement shall be resolved in the courts of Tennessee.</p>

        <h2>9. Contact</h2>
        <p>For questions regarding this Agreement, contact us at <a href="mailto:admin@infinitypoolstn.com">admin@infinitypoolstn.com</a>.</p>
      </div>
      <p style="margin-top:12px"><a href="#/" class="btn secondary">← Back to Dashboard</a></p>
    </div>`;
}

/* ============================== Privacy Policy ============================== */
function vPrivacy() {
  $('#main').innerHTML = `
    <div style="max-width:760px">
      <h1>Privacy Policy</h1>
      <p class="muted">Last Updated: May 4, 2026</p>
      <div class="card">
        <p>This Privacy Policy describes how Infinity Pools ("we," "us," or "our") collects, uses, and protects information when you use the Infinity Pools Build Manager application ("App").</p>

        <h2>1. Information We Collect</h2>
        <p>We collect information you provide directly, including client names, email addresses, project details, and job scheduling data. If you connect QuickBooks Online, we also access invoicing and customer data from that service.</p>

        <h2>2. How We Use Your Information</h2>
        <p>Information is used exclusively for internal scheduling, job management, and invoicing operations. We do not sell, share, or disclose your data to third parties for marketing or any other purpose.</p>

        <h2>3. Data Storage &amp; Security</h2>
        <p>Your data is stored in encrypted cloud storage and transmitted over HTTPS. Access is restricted to authorized personnel only. While we take reasonable precautions, no system is completely secure and we cannot guarantee absolute security.</p>

        <h2>4. Data Retention</h2>
        <p>Active project data is retained for the duration of use. Archived job records are retained for up to 7 years for record-keeping and legal compliance purposes.</p>

        <h2>5. QuickBooks Integration</h2>
        <p>When you authorize QuickBooks Online access, we retrieve invoicing and customer data via OAuth 2.0. This data is used solely for display within the App and is not stored beyond operational needs. You may disconnect QuickBooks at any time through your QuickBooks account settings.</p>

        <h2>6. Your Rights</h2>
        <p>You may request access to, correction of, or deletion of your data at any time by contacting us. You may also revoke any third-party integration permissions (QuickBooks, DocuSeal) through those services directly.</p>

        <h2>7. Third-Party Services</h2>
        <p>The App integrates with Intuit QuickBooks and DocuSeal. These services have their own privacy policies that govern their data practices independently of this policy.</p>

        <h2>8. Policy Updates</h2>
        <p>We may update this Privacy Policy from time to time. Changes take effect upon posting. Continued use of the App after changes are posted constitutes acceptance of the updated policy.</p>

        <h2>9. Contact</h2>
        <p>For privacy questions or requests, contact us at <a href="mailto:admin@infinitypoolstn.com">admin@infinitypoolstn.com</a>.</p>
      </div>
      <p style="margin-top:12px"><a href="#/" class="btn secondary">← Back to Dashboard</a></p>
    </div>`;
}

/* ============================== boot ============================== */
window.toast = toast; window.closeModal = closeModal; window.api = api; window.reload = reload; window.route = route;
route();
