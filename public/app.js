/* Infinity Pools — admin SPA */
'use strict';

let S = null; // bootstrap state
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtDate = d => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—';
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
  const active = S.clients.filter(c => c.status === 'active');
  const prospects = S.clients.filter(c => ['prospect', 'contract_sent'].includes(c.status));
  const signed = S.clients.filter(c => ['active', 'completed'].includes(c.status));
  const pipeline = prospects.reduce((a, c) => a + c._quote, 0);
  const contracted = signed.reduce((a, c) => a + c._quote + c._coTotal, 0);
  const collectedTotal = signed.reduce((a, c) => a + c._collected, 0);
  const outstanding = active.reduce((a, c) => a + c.phases.filter(p => p.paymentRequestedAt && !p.paymentReceivedAt).reduce((x, p) => x + c._quote * p.drawPct / 100, 0), 0);
  const costs = signed.reduce((a, c) => a + c._costs, 0);
  const profit = contracted - costs;
  const today = new Date().toISOString().slice(0, 10);
  const overdueTasks = S.tasks.filter(t => t.status !== 'done' && t.dueDate && t.dueDate < today);
  const soon = new Date(); soon.setDate(soon.getDate() + 7);
  const phasesDueSoon = active.flatMap(c => c.phases.filter(p => p.status === 'active' && p.dueDate && p.dueDate <= soon.toISOString().slice(0, 10)).map(p => ({ c, p })));
  const coTotal = signed.reduce((a, c) => a + c._coTotal, 0);

  $('#main').innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px">
      <h1 style="margin:0">Dashboard</h1>
      <button class="btn" onclick="addProspect()">＋ Add New Prospect</button>
    </div>
    ${!S.gmailConfigured ? '<div class="banner warn" style="margin-top:14px">📧 Gmail is not connected yet — emails are logged but not sent. Set it up in <a href="#/settings">Settings → Email</a>.</div>' : ''}
    <div class="row" style="margin:16px 0">
      <div class="metric"><div class="v">${active.length}</div><div class="l">Active Builds</div></div>
      <div class="metric"><div class="v">${prospects.length}</div><div class="l">Prospects</div></div>
      <div class="metric"><div class="v">${money(pipeline)}</div><div class="l">Pipeline Value</div></div>
      <div class="metric"><div class="v">${money(contracted)}</div><div class="l">Contracted + COs</div></div>
    </div>
    <div class="row" style="margin-bottom:18px">
      <div class="metric good"><div class="v">${money(collectedTotal)}</div><div class="l">Collected</div></div>
      <div class="metric warn"><div class="v">${money(outstanding)}</div><div class="l">Outstanding Draws</div></div>
      <div class="metric ${profit >= 0 ? 'good' : 'bad'}"><div class="v">${money(profit)}</div><div class="l">Est. Profit (signed jobs)</div></div>
      <div class="metric"><div class="v">${money(coTotal)}</div><div class="l">Change Orders</div></div>
      <div class="metric ${overdueTasks.length ? 'bad' : ''}"><div class="v">${overdueTasks.length}</div><div class="l">Overdue Tasks</div></div>
      <div class="metric ${phasesDueSoon.length ? 'warn' : ''}"><div class="v">${phasesDueSoon.length}</div><div class="l">Phases Due ≤ 7d</div></div>
    </div>
    <div class="row">
      <div class="card grow" style="flex:2;min-width:380px">
        <h2>Projects</h2>
        ${S.clients.length ? `<table class="tbl"><thead><tr><th>Address</th><th>Status</th><th>Current Phase</th><th>Progress</th><th class="right">Quote</th><th class="right">Change Orders</th><th class="right">Costs</th><th class="right">Profit</th></tr></thead><tbody>
          ${S.clients.map(c => {
            const profit = c._quote + c._coTotal - c._costs;
            return `<tr style="cursor:pointer" onclick="location.hash='#/client/${c.id}'">
            <td><b>${esc(c.address) || '<i>no address</i>'}</b><div class="muted">${esc(c.name)}</div></td>
            <td><span class="chip ${c.status}">${statusLabel[c.status]}</span></td>
            <td>${c._currentPhase ? `<span class="chip phase">${esc(c._currentPhase.name)}</span>${c._currentPhase.dueDate ? `<div class="muted">due ${fmtDate(c._currentPhase.dueDate)}</div>` : ''}` : c.status === 'completed' ? '🏁 Done' : '—'}</td>
            <td><div class="progress"><div style="width:${phasePct(c)}%"></div></div></td>
            <td class="right money">${money(c._quote)}</td>
            <td class="right money">${c._coTotal ? money(c._coTotal) : '—'}</td>
            <td class="right money">${c._costs ? money(c._costs) : '—'}</td>
            <td class="right money" style="color:${profit >= 0 ? 'var(--green)' : 'var(--red)'};font-weight:700">${money(profit)}</td>
          </tr>`;
          }).join('')}
        </tbody></table>` : '<p class="muted">No clients yet — click <b>Add New Prospect</b> to create your first one.</p>'}
      </div>
      <div class="card grow" style="min-width:300px;max-width:420px">
        <h2>Recent Alerts</h2>
        ${S.alerts.slice(0, 12).map(a => `<div class="alert-row"><span class="alert-dot ${a.type}"></span><span style="flex:1">${esc(a.message)}</span><span class="when">${ago(a.createdAt)}</span></div>`).join('') || '<p class="muted">Nothing yet.</p>'}
      </div>
    </div>`;
}

window.addProspect = function () {
  modal(`<h2>Add New Prospect</h2>
    <label class="fld">Client Name<input type="text" id="pName" placeholder="John & Jane Smith"></label>
    <label class="fld">Address<input type="text" id="pAddr" placeholder="1533 Harding Pl, Nashville TN"></label>
    <label class="fld">Email<input type="email" id="pEmail"></label>
    <label class="fld">Phone<input type="tel" id="pPhone"></label>
    <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:14px">
      <button class="btn secondary" onclick="closeModal()">Cancel</button>
      <button class="btn" id="pSave">Save & Open Client Page</button>
    </div>`, root => {
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
        <h1 style="margin:0 0 2px">${esc(c.address) || esc(c.name)}</h1>
        <div class="muted">${esc(c.name)} · ${esc(c.email)} · ${esc(c.phone)} &nbsp; <span class="chip ${c.status}">${statusLabel[c.status]}</span>
        ${c._currentPhase ? ` <span class="chip phase">${esc(c._currentPhase.name)}</span>` : ''}</div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary small" onclick="editClientInfo('${c.id}')">✏️ Edit Info</button>
        <a class="btn secondary small" href="/api/clients/${c.id}/contract.pdf" target="_blank">⬇ Contract PDF</a>
      </div>
    </div>
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
    <div style="display:flex;gap:10px;justify-content:space-between;margin-top:14px">
      <span><button class="btn danger" onclick="deleteClient('${c.id}')">Delete</button>
      <button class="btn secondary" onclick="startOverProject('${c.id}')">Cancel / Start Over</button></span>
      <span><button class="btn secondary" onclick="closeModal()">Close</button>
      <button class="btn" onclick="saveClientInfo('${c.id}')">Save</button></span>
    </div>`);
};
window.saveClientInfo = async function (id) {
  try {
    await api('PUT', '/api/clients/' + id, { name: $('#eName').value, address: $('#eAddr').value, email: $('#eEmail').value, phone: $('#ePhone').value, status: $('#eStatus').value });
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
  const featRow = (key, label, opts = {}) => {
    const { hasStyle = false, noDetails = false, extra = '' } = opts;
    const f = s[key] || {};
    const rowInner = `
        ${hasStyle ? `<label class="fld grow" style="max-width:220px">Style<select id="sp_${key}_style" ${dis}>${S.settings.ledgeStyles.map(o => `<option ${f.style === o ? 'selected' : ''}>${o}</option>`).join('')}</select></label>` : ''}
        ${noDetails ? '' : `<label class="fld grow">Size & details<input type="text" id="sp_${key}_det" value="${esc(f.details || '')}" ${dis} placeholder="e.g. 5' x 15', 12&quot; depth"></label>`}
        ${extra}`;
    return `
    <div class="card" style="padding:14px 18px;margin-bottom:10px">
      <label class="check"><input type="checkbox" id="sp_${key}_inc" ${f.included ? 'checked' : ''} ${dis}> Include ${label}</label>
      ${rowInner.trim() ? `<div class="row">${rowInner}</div>` : ''}
    </div>`;
  };
  const ht = s.hotTub || {};
  $('#tabBody').innerHTML = `
    <div class="card">
      <h2>Pool Size, Shape & Details</h2>
      <div class="row">
        <label class="fld" style="max-width:200px">Shape<select id="sp_shape" ${dis}>
          <option value="geometric" ${s.shape === 'geometric' ? 'selected' : ''}>Geometric</option>
          <option value="freeform" ${s.shape === 'freeform' ? 'selected' : ''}>Freeform</option></select></label>
        <label class="fld grow">Size & additional details<textarea id="sp_size" ${dis} placeholder="e.g. 15' x 25', 3.5' to 6' depth, descending entry steps">${esc(s.sizeDetails)}</textarea></label>
      </div>
      <div class="row">
        <label class="fld grow">Number of Jets<input type="text" id="sp_jets" value="${esc(s.jets)}" ${dis}></label>
        <label class="fld grow">Number of LED Lights<input type="text" id="sp_led" value="${esc(s.ledLights)}" ${dis}></label>
      </div>
    </div>
    ${featRow('hotTub', 'Hot Tub / Spa', { extra: `
        <label class="fld grow">Number of Jets<input type="text" id="sp_hotTub_jets" value="${esc(ht.jets || '')}" ${dis}></label>
        <label class="fld grow">Number of LED Lights<input type="text" id="sp_hotTub_led" value="${esc(ht.ledLights || '')}" ${dis}></label>` })}
    ${featRow('sunShelf', 'Sun Shelf')}
    ${featRow('spillover', 'Spillover', { noDetails: true })}
    ${featRow('ledgeSeating', 'Ledge / Seating', { hasStyle: true })}
    ${featRow('waterFeature', 'Water Feature')}
    ${featRow('fireFeature', 'Fire Feature')}
    ${featRow('coldPlunge', 'Cold Plunge')}
    <div class="card">
      <div class="row">
        <label class="fld grow">Equipment pad location<input type="text" id="sp_pad" value="${esc(s.equipmentPad)}" ${dis}></label>
      </div>
    </div>
    <div class="card">
      <h2>Add-Ons</h2>
      <div id="addOnList">${s.addOns.map((a, i) => `
        <div class="row" data-addon style="align-items:flex-end">
          <label class="fld grow">Add-on<input type="text" class="ao-label" value="${esc(a.label)}" ${dis}></label>
          <label class="fld grow">Details<input type="text" class="ao-value" value="${esc(a.value)}" ${dis}></label>
          ${!c.specsLocked ? '<button class="btn danger small" style="margin-bottom:12px" onclick="this.closest(\'[data-addon]\').remove()">✕</button>' : ''}
        </div>`).join('')}</div>
      ${!c.specsLocked ? '<button class="btn secondary small" onclick="addAddonRow()">＋ Add new field</button>' : ''}
    </div>
    ${!c.specsLocked ? `<button class="btn" onclick="saveSpecs('${c.id}')">💾 Save Pool Specs</button>` : '<p class="muted">🔒 Locked — contract signed. Use Change Orders for modifications.</p>'}`;
}
window.addAddonRow = function () {
  $('#addOnList').insertAdjacentHTML('beforeend', `
    <div class="row" data-addon style="align-items:flex-end">
      <label class="fld grow">Add-on<input type="text" class="ao-label" placeholder="e.g. Automatic cover"></label>
      <label class="fld grow">Details<input type="text" class="ao-value"></label>
      <button class="btn danger small" style="margin-bottom:12px" onclick="this.closest('[data-addon]').remove()">✕</button>
    </div>`);
};
window.saveSpecs = async function (id) {
  const g = (k, f) => { const det = $(`#sp_${k}_det`); return { included: $(`#sp_${k}_inc`).checked, details: det ? det.value : '', ...(f ? { style: $(`#sp_${k}_style`).value } : {}) }; };
  const specs = {
    shape: $('#sp_shape').value, sizeDetails: $('#sp_size').value,
    hotTub: { ...g('hotTub'), jets: $('#sp_hotTub_jets').value, ledLights: $('#sp_hotTub_led').value }, sunShelf: g('sunShelf'), spillover: g('spillover'),
    ledgeSeating: g('ledgeSeating', true), waterFeature: g('waterFeature'), fireFeature: g('fireFeature'), coldPlunge: g('coldPlunge'),
    jets: $('#sp_jets').value, ledLights: $('#sp_led').value, equipmentPad: $('#sp_pad').value,
    addOns: [...document.querySelectorAll('[data-addon]')].map(r => ({ label: r.querySelector('.ao-label').value, value: r.querySelector('.ao-value').value })).filter(a => a.label.trim()),
  };
  try { await api('PUT', '/api/clients/' + id, { specs }); await reload(); toast('Pool specs saved'); route(); }
  catch (e) { toast(e.message, true); }
};

/* ---------- Scope tab ---------- */
function tScope(c) {
  $('#tabBody').innerHTML = `
    <div class="banner info">Pre-populated from your standard contract. General descriptions only — sizes and dollar values live in Pool Specs and Finance. ${c.specsLocked ? 'Contract is signed: log substantive changes as Change Orders.' : 'Editable until the contract is signed.'}</div>
    ${c.scope.map((sec, i) => `
      <div class="card">
        <div class="row" style="align-items:center;margin-bottom:8px">
          <input class="input grow scope-title" data-scopetitle="${i}" value="${esc(sec.title)}" style="font-size:18px;font-weight:700">
          <button class="btn danger small" onclick="scopeSecDel('${c.id}',${i})">Delete Section</button>
        </div>
        ${sec.items.map((it, j) => `<div class="row" style="align-items:center;margin-bottom:6px">
          <input class="input grow" data-scope="${i}:${j}" value="${esc(it)}">
          <button class="btn danger small" onclick="scopeDel('${c.id}',${i},${j})">✕</button></div>`).join('')}
        <button class="btn secondary small" onclick="scopeAdd('${c.id}',${i})">＋ Add line</button>
      </div>`).join('')}
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
    scope[i].items[j] = inp.value;
  });
  await api('PUT', '/api/clients/' + id, { scope });
  await reload(); if (thenRoute) { toast('Scope saved'); route(); }
};
window.scopeAdd = async function (id, i) { await scopeSave(id, false); const c = client(id); c.scope[i].items.push(''); await api('PUT', '/api/clients/' + id, { scope: c.scope }); await reload(); route(); };
window.scopeDel = async function (id, i, j) { await scopeSave(id, false); const c = client(id); c.scope[i].items.splice(j, 1); await api('PUT', '/api/clients/' + id, { scope: c.scope }); await reload(); route(); };
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
  const plasterVal = c.contract.plasterColor || c.contract.adobeFinishSelection || (c.selectedFinishes || [])[0] || '';
  $('#tabBody').innerHTML = `
    <div class="card" style="max-width:760px;margin-bottom:14px">
      <h2>Project Selections</h2>
      <div class="row">
        <label class="fld grow">Plaster Color (Pebble Tec)<input type="text" id="selPlaster" value="${esc(plasterVal)}" placeholder="e.g. Caribbean Blue"></label>
        <label class="fld grow">Waterline Tile<input type="text" id="selTile" value="${esc(c.contract.waterlineTile || '')}" placeholder="e.g. 4×4 glass mosaic — blue blend"></label>
        <label class="fld grow">Coping<input type="text" id="selCoping" value="${esc(c.contract.coping || '')}" placeholder="e.g. brushed travertine"></label>
      </div>
      <button class="btn" onclick="saveSelections('${c.id}')">💾 Save Selections</button>
    </div>
    <div class="banner info">Click swatches to record the client's finish selections (these appear on the contract, the portal, and can be confirmed by checkbox during Adobe signing). Grouped by pricing tier — prices are never shown to the client.</div>
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
  const dis = c.specsLocked ? 'disabled' : '';
  $('#tabBody').innerHTML = `
    <div class="card" style="max-width:680px">
      <h2>Price Quote</h2>
      <div id="finRows">${c.finance.items.map((it, i) => `
        <div class="row" style="align-items:center;margin-bottom:8px" data-fin>
          <input class="input grow fin-label" value="${esc(it.label)}" ${dis}>
          <span style="font-weight:700;color:var(--mid)">$</span>
          <input class="input fin-amount" type="number" step="0.01" min="0" style="max-width:160px;text-align:right" value="${it.amount || ''}" ${dis} oninput="finTotal()">
          ${!c.specsLocked ? '<button class="btn danger small" onclick="this.closest(\'[data-fin]\').remove();finTotal()">✕</button>' : ''}
        </div>`).join('')}</div>
      ${!c.specsLocked ? '<button class="btn secondary small" onclick="finAdd()">＋ Add a charge</button>' : ''}
      <hr style="border:none;border-top:2px solid var(--blue-soft);margin:16px 0">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span class="total-line">Total Quote</span><span class="total-line" id="finTotalEl">${money(total)}</span>
      </div>
      ${c._coTotal ? `<div style="display:flex;justify-content:space-between;margin-top:6px" class="muted"><span>+ Change orders</span><span class="money">${money(c._coTotal)}</span></div>
      <div style="display:flex;justify-content:space-between;font-weight:800;color:var(--blue-dark)"><span>Contract total</span><span class="money">${money(total + c._coTotal)}</span></div>` : ''}
      ${!c.specsLocked ? `<button class="btn" style="margin-top:16px" onclick="finSave('${c.id}')">💾 Save Finance</button>` : '<p class="muted" style="margin-top:12px">🔒 Locked — contract signed. Price changes go through Change Orders.</p>'}
    </div>
    <div class="card" style="max-width:680px">
      <h2>Amount Due at Each Phase</h2>
      <table class="tbl"><thead><tr><th>Phase</th><th>Draw</th><th class="right">Amount</th></tr></thead><tbody>
        ${c.phases.map(p => `<tr><td>${esc(p.name)}</td><td>${p.drawPct}%</td><td class="right money">${p.drawPct ? money(total * p.drawPct / 100) : '—'}</td></tr>`).join('')}
      </tbody></table>
    </div>`;
}
window.finAdd = function () {
  $('#finRows').insertAdjacentHTML('beforeend', `
    <div class="row" style="align-items:center;margin-bottom:8px" data-fin>
      <input class="input grow fin-label" placeholder="Charge description">
      <span style="font-weight:700;color:var(--mid)">$</span>
      <input class="input fin-amount" type="number" step="0.01" min="0" style="max-width:160px;text-align:right" oninput="finTotal()">
      <button class="btn danger small" onclick="this.closest('[data-fin]').remove();finTotal()">✕</button>
    </div>`);
};
window.finTotal = function () {
  const t = [...document.querySelectorAll('.fin-amount')].reduce((a, i) => a + (Number(i.value) || 0), 0);
  $('#finTotalEl').textContent = money(t);
};
window.finSave = async function (id) {
  const items = [...document.querySelectorAll('[data-fin]')].map(r => ({
    label: r.querySelector('.fin-label').value, amount: Number(r.querySelector('.fin-amount').value) || 0,
  })).filter(i => i.label.trim());
  try { await api('PUT', '/api/clients/' + id, { finance: { items } }); await reload(); toast('Finance saved'); route(); }
  catch (e) { toast(e.message, true); }
};

/* ---------- Files tab ---------- */
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
      <table class="tbl" style="margin-top:10px"><thead><tr><th></th><th>File</th><th>Category</th><th>Uploaded</th><th>Cover Photo</th><th></th></tr></thead><tbody>
      ${c.files.map(f => `<tr>
        <td><input type="checkbox" class="fileSel" value="${f.id}"></td>
        <td><b>${esc(f.originalName)}</b><div class="muted">${(f.size / 1024 / 1024).toFixed(1)} MB</div></td>
        <td>${esc(f.category)}</td>
        <td class="muted">${fmtDate(f.uploadedAt)}</td>
        <td>${f.category === 'Pool Renderings' ? `<label class="check" style="margin:0"><input type="checkbox" ${f.isCoverPhoto ? 'checked' : ''} onchange="setCover('${c.id}','${f.id}',this.checked)"> ⭐ Contract Cover Photo</label>` : ''}</td>
        <td class="right" style="white-space:nowrap">
          <a class="btn secondary small" href="/api/clients/${c.id}/files/${f.id}/download">⬇</a>
          <button class="btn danger small" onclick="delFile('${c.id}','${f.id}')">✕</button>
        </td></tr>`).join('') || '<tr><td colspan="6" class="muted">No files uploaded yet.</td></tr>'}
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
window.setCover = async function (id, fid, on) { await api('POST', `/api/clients/${id}/files/${fid}/cover`, { isCoverPhoto: on }); await reload(); route(); toast(on ? 'Set as contract cover photo' : 'Cover photo removed'); };
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

  // Adobe Sign status card — computed before the template literal to avoid deep nesting
  let adobeSection;
  if (!S.adobeSignConfigured) {
    adobeSection = `<p class="muted" style="margin-top:10px"><a href="#/settings">Configure Adobe Sign in Settings</a> to send for e-signature with Pebble Tec finish selection.</p>`;
  } else if (c.contract.signedAt && c.contract.signedMethod === 'adobe') {
    const fin = c.contract.adobeFinishSelection ? ` · Finish: <b>${esc(c.contract.adobeFinishSelection)}</b>` : '';
    adobeSection = `<div class="banner info">✅ Signed via Adobe Sign${fin}.</div>`;
  } else if (c.contract.adobeAgreementId) {
    const chips = { IN_PROCESS: '<span class="chip prospect">Awaiting Signature</span>', SIGNED: '<span class="chip active">Signed</span>', RECALLED: '<span class="chip lost">Recalled</span>', EXPIRED: '<span class="chip lost">Expired</span>' };
    const chip = chips[c.contract.adobeStatus] || '<span class="chip prospect">Pending</span>';
    const sent = c.contract.adobeSentAt ? `Sent ${fmtDate(c.contract.adobeSentAt)}` : '';
    adobeSection = `<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:10px">${chip}<span class="muted">${sent}</span><button class="btn secondary small" onclick="checkAdobeStatus('${c.id}')">↻ Check Signing Status</button></div>`;
  } else {
    const dis = c.email ? '' : 'disabled title="Client has no email address"';
    adobeSection = `<div style="margin-top:10px"><button class="btn" onclick="sendViaAdobeSign('${c.id}')" ${dis}>📨 Send via Adobe Sign</button><p class="muted" style="margin-top:6px">Uploads the contract PDF to your Adobe Sign account and emails the client a signing link. The Pebble Tec finish selection field on the signature page becomes a required text field the client fills in before signing.</p></div>`;
  }

  const signedSection = c.contract.signedAt
    ? '<div class="banner info">✓ Signed. Specs locked; manage the build below.</div>'
    : `<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--mid);font-size:13px">Manual fallback — mark as signed without Adobe Sign</summary>
        <div style="margin-top:10px">
          <div class="row" style="align-items:flex-end">
            <label class="fld grow">How was it signed?<select id="signMethod"><option value="adobe">Adobe digital signature</option><option value="paper">Paper (in person)</option></select></label>
            <label class="fld grow">Deposit taken now?<select id="depMethod"><option value="">No — send payment link</option><option value="check">Yes — check</option><option value="cash">Yes — cash</option></select></label>
            <button class="btn green" style="margin-bottom:12px" onclick="markSigned('${c.id}')">✓ Contract Signed</button>
          </div>
          <p class="muted">Signing locks specs & pricing, starts the Design phase, alerts the team, ${S.quickbooksConnected ? 'creates the QuickBooks invoice for the full amount,' : ''} and sends the 10% design draw request.</p>
        </div></details>`;

  $('#tabBody').innerHTML = `
    <div class="row">
      <div class="card grow" style="min-width:340px">
        <h2>Contract</h2>
        <p>Quote total: <b class="money">${money(total)}</b>${c._coTotal ? ` &nbsp;+ COs <b class="money">${money(c._coTotal)}</b> = <b class="money">${money(total + c._coTotal)}</b>` : ''}</p>
        <p class="muted">Sent: ${c.contract.sentAt ? fmtDate(c.contract.sentAt) : 'not yet'} · Signed: ${c.contract.signedAt ? fmtDate(c.contract.signedAt) + ' (' + c.contract.signedMethod + (c.contract.depositMethod ? ', deposit by ' + c.contract.depositMethod : '') + ')' : 'not yet'}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn secondary" href="/api/clients/${c.id}/contract.pdf" target="_blank">⬇ Preview Contract PDF</a>
          <button class="btn secondary" onclick="sendContract('${c.id}')">📧 Email PDF to Client</button>
        </div>
        ${adobeSection}
        ${signedSection}
      </div>
      <div class="card grow" style="min-width:300px;max-width:430px">
        <h2>QuickBooks</h2>
        ${S.quickbooksConnected ? '<span class="chip active">Connected</span>' : '<p class="muted">Not connected — payment links can still be pasted per phase below. Connect in <a href="#/settings">Settings</a>.</p>'}
        ${c.quickbooks.estimateUrl
          ? `<p style="margin-top:10px">Contract estimate: <a href="${c.quickbooks.estimateUrl}" target="_blank">open in QuickBooks ↗</a></p>
             <p class="muted" style="font-size:12px">Each phase draw is billed as its own progress invoice against this estimate when its payment is requested.</p>`
          : S.quickbooksConnected && c.contract.signedAt
            ? `<div class="banner warn" style="margin-top:10px">Master estimate was not created — this usually means the QuickBooks connection needs attention.</div>
               <button class="btn" style="margin-top:10px" onclick="createQbInvoice('${c.id}')">Create QB Customer &amp; Estimate</button>`
            : ''}
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
window.markSigned = async function (id) {
  if (!confirm('Mark contract as signed? This locks specs and pricing.')) return;
  try {
    const r = await api('POST', `/api/clients/${id}/contract/mark-signed`, { method: $('#signMethod').value, depositMethod: $('#depMethod').value || null });
    await reload(); route();
    toast('Contract signed — Design phase started' + (r.quickbooksError ? ' (QuickBooks error: ' + r.quickbooksError + ')' : ''));
  } catch (e) { toast(e.message, true); }
};
window.createQbInvoice = async function (id) {
  if (!confirm('Create QuickBooks customer and master estimate now?')) return;
  try {
    await api('POST', `/api/clients/${id}/quickbooks/create-invoice`);
    await reload(); route();
    toast('QuickBooks customer and master estimate created successfully');
  } catch (e) { toast(e.message, true); }
};
window.sendViaAdobeSign = async function (id) {
  try {
    toast('Uploading PDF to Adobe Sign…');
    const r = await api('POST', `/api/clients/${id}/contract/adobe-send`);
    await reload(); route();
    toast('Contract sent via Adobe Sign — client will receive a signing email');
  } catch (e) { toast(e.message, true); }
};
window.checkAdobeStatus = async function (id) {
  try {
    const r = await api('POST', `/api/clients/${id}/contract/check-adobe-status`);
    await reload(); route();
    if (r.status === 'SIGNED') {
      toast('Signed! Design phase started' + (r.finishSelection ? ' · Finish: ' + r.finishSelection : '') + (r.quickbooksError ? ' (QB error: ' + r.quickbooksError + ')' : ''));
    } else {
      toast('Status: ' + r.status);
    }
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
    const r = await api('POST', `/api/clients/${id}/change-orders`, { description: desc, value: amount });
    await reload(); route();
    toast('Change order created' + (S.quickbooksConnected ? (r.quickbooksError ? ' (QB error: ' + r.quickbooksError + ')' : ' — QB invoice created') : ''));
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
      <table class="tbl"><thead><tr><th>Date</th><th>Change Requested</th><th class="right">Value</th><th>QuickBooks Invoice</th><th></th></tr></thead><tbody>
      ${c.changeOrders.map(co => `<tr>
        <td class="muted" style="white-space:nowrap">${fmtDate(co.createdAt)}</td>
        <td>${esc(co.description)}</td>
        <td class="right money">${money(co.value)}</td>
        <td>${co.qbInvoiceId
          ? `<a class="btn small secondary" href="${esc(co.qbInvoiceUrl)}" target="_blank">📄 View</a>
             ${c.email ? `<button class="btn small" onclick="sendCOInvoice('${c.id}','${co.id}')">📧 Send to Client</button>` : ''}`
          : S.quickbooksConnected ? '<span class="muted">Creating…</span>' : '<span class="muted">—</span>'}</td>
        <td class="right"><button class="btn danger small" onclick="delCO('${c.id}','${co.id}')">Delete</button></td>
      </tr>`).join('') || '<tr><td colspan="5" class="muted">No change orders logged.</td></tr>'}
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
    const r = await api('POST', `/api/clients/${id}/change-orders`, { description: $('#coDesc').value, value: $('#coVal').value });
    await reload(); closeModal(); route();
    toast('Change order logged' + (S.quickbooksConnected ? (r.quickbooksError ? ' (QB error: ' + r.quickbooksError + ')' : ' — QB invoice created') : ''));
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
      <button class="btn secondary" onclick="runPebbleCheck()">🔄 Check pebbletec.com now</button>
    </div>
    <p class="muted">Tiers follow the 2026 Pool Builder Rates sheet (pricing kept internal). Automatically verified against
      <a href="https://pebbletec.com/products/all-finishes/" target="_blank">pebbletec.com/products/all-finishes</a> every Monday at 7:00 AM CST —
      you'll get an email if a finish was added or removed. Last check: <b>${pc.lastRun ? fmtDate(pc.lastRun) : 'never'}</b>
      ${pc.lastResult ? (pc.lastResult.ok ? `(${pc.lastResult.added.length} new, ${pc.lastResult.missing.length} removed)` : '(failed: ' + esc(pc.lastResult.error) + ')') : ''}.
      Click a swatch to toggle it active/retired.</p>
    ${brands.map(brand => {
      const tiers = tierOrder.filter(t => S.finishes.some(f => f.brand === brand && f.tier === t));
      if (!tiers.length) return '';
      return `<div class="card"><h2>${brand}</h2>${tiers.map(t => `
        <h3>${t === 'Brilliance' ? 'All Colors' : t + ' Tier'}</h3>
        <div class="swatch-grid">${S.finishes.filter(f => f.brand === brand && f.tier === t).map(f => `
          <div class="swatch ${f.active ? '' : 'inactive'}" title="${f.active ? 'Active — click to retire' : 'Retired — click to restore'}" onclick="toggleFinishActive('${f.id}',${!f.active})">
            ${f.localImage || f.imageUrl ? `<img loading="lazy" src="${f.localImage || f.imageUrl}" alt="${esc(f.name)}">` : `<div class="colorblock" style="background:${f.color}"></div>`}
            <div class="nm">${esc(f.name)}${f.shimmer ? ' ✨' : ''}<small>${f.active ? 'active' : 'retired'}</small></div>
          </div>`).join('')}</div>`).join('')}</div>`;
    }).join('')}`;
}
window.toggleFinishActive = async function (id, active) { await api('PUT', '/api/finishes/' + id, { active }); await reload(); route(); };
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
      <h2>Adobe Acrobat Sign ${S.adobeSignConfigured ? '<span class="chip active">configured</span>' : '<span class="chip prospect">not configured</span>'}</h2>
      <p class="muted">When configured, the Contract & Phases tab shows a <b>Send via Adobe Sign</b> button. The contract PDF is uploaded to your Adobe Sign account and the client receives an email with a signing link. The Pebble Tec finish selection field in the contract becomes a required text field in the signing form — the client's choice is captured automatically when they sign.</p>
      <p class="muted" style="margin-top:0">Get your Integration Key: Adobe Sign → Account → Personal Preferences → API Access → Integration Keys. Create a key with <b>account_read</b>, <b>agreement_send</b>, <b>agreement_read</b>, <b>agreement_write</b> scopes.</p>
      <div class="row">
        <label class="fld grow" style="flex:2">Integration Key<input type="text" id="asKey" value="${esc((st.adobeSign || {}).integrationKey || '')}" placeholder="Paste your long-lived Integration Key here"></label>
        <label class="fld grow">API Base URL<input type="text" id="asBase" value="${esc((st.adobeSign || {}).apiBaseUri || 'https://api.na1.adobesign.com')}" placeholder="https://api.na1.adobesign.com"></label>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn secondary small" onclick="testAdobeSign()">Test Connection</button>
        <button class="btn secondary small" onclick="registerAdobeWebhook()">Register Webhook</button>
        <span class="muted" style="font-size:12px;align-self:center">Webhooks auto-process signed contracts. Requires a public URL — works on Render/Railway, not localhost. Without it, use "Check Signing Status" on the Contract tab.</span>
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
          ${(sec.items || []).map(it => `<div class="row" style="align-items:center;margin-bottom:6px">
            <input class="input grow sm-item" value="${esc(it)}">
            <button class="btn danger small" onclick="this.closest('.row').remove()">✕</button></div>`).join('')}
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
            <b style="color:var(--blue-dark)">${i + 1}.</b>
            <input class="input grow disc-title" value="${esc(d.title)}">
            <button class="btn danger small" onclick="this.closest('[data-disc]').remove()">✕</button>
          </div>
          <textarea class="input disc-body" style="margin-top:8px;min-height:90px">${esc(d.body)}</textarea>
        </div>`).join('')}
      </div>
      <button class="btn secondary small" onclick="discAdd()">＋ Add disclosure section</button>
    </div>
    <button class="btn" onclick="settingsSave()">💾 Save All Settings</button>
    <p class="muted" style="margin-top:8px">Weekly Pebble Tec check email goes to: <b>${esc(st.pebbleCheckEmail)}</b> (Mondays 7:00 AM CST while the app is running).</p>`;
}
window.discAdd = function () {
  $('#discList').insertAdjacentHTML('beforeend', `
    <div class="card" style="background:var(--blue-pale)" data-disc>
      <div class="row" style="align-items:center"><b style="color:var(--blue-dark)">＋</b>
        <input class="input grow disc-title" placeholder="Section title">
        <button class="btn danger small" onclick="this.closest('[data-disc]').remove()">✕</button></div>
      <textarea class="input disc-body" style="margin-top:8px;min-height:90px"></textarea>
    </div>`);
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
window.smAddLine = function (btn) {
  btn.previousElementSibling.insertAdjacentHTML('beforeend', `
    <div class="row" style="align-items:center;margin-bottom:6px">
      <input class="input grow sm-item" value="">
      <button class="btn danger small" onclick="this.closest('.row').remove()">✕</button></div>`);
};
window.smAddSection = function () {
  const key = 'custom_' + Date.now().toString(36);
  $('#scopeMaster').insertAdjacentHTML('beforeend', `
    <div class="card" style="background:var(--blue-pale)" data-scopesec data-key="${key}">
      <div class="row" style="align-items:center">
        <input class="input grow sm-title" placeholder="Section title" style="font-weight:700">
        <button class="btn danger small" onclick="this.closest('[data-scopesec]').remove()">Delete Section</button>
      </div>
      <div class="sm-items" style="margin-top:8px">
        <div class="row" style="align-items:center;margin-bottom:6px"><input class="input grow sm-item" value=""><button class="btn danger small" onclick="this.closest('.row').remove()">✕</button></div>
      </div>
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
    items: [...sec.querySelectorAll('.sm-item')].map(i => i.value).filter(v => v.trim()),
  })).filter(s => s.title.trim());
  await api('PUT', '/api/settings', {
    taskTemplates,
    phaseTemplate,
    scopeTemplate,
    companyName: $('#stName').value, companyEmail: $('#stEmail').value,
    companyPhone: $('#stPhone').value, companyAddress: $('#stAddr').value,
    gmail: { user: $('#stGUser').value.trim(), appPassword: $('#stGPass').value.trim() },
    quickbooks: { ...S.settings.quickbooks, realmId: $('#qbRealm').value.trim(), environment: $('#qbEnv').value, clientId: $('#qbCid').value.trim(), clientSecret: $('#qbSec').value.trim(), refreshToken: $('#qbTok').value.trim(), achFeeNote: $('#qbAch').value, ccFeeNote: $('#qbCc').value, passFeesToClient: $('#qbPass').checked },
    adobeSign: { integrationKey: $('#asKey').value.trim(), apiBaseUri: $('#asBase').value.trim() || 'https://api.na1.adobesign.com' },
    haulRates: { triAxle: Number($('#hrTriAxle').value) || 500, gravel: Number($('#hrGravel').value) || 1000 },
    disclosures,
  });
  await reload(); toast('Settings saved'); route();
};
window.testAdobeSign = async function () {
  await settingsSave();
  try {
    const r = await api('POST', '/api/settings/adobe-sign/test');
    toast('Adobe Sign connected ✓' + (r.apiAccessPoint ? ' · API: ' + r.apiAccessPoint : ''));
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
window.registerAdobeWebhook = async function () {
  await settingsSave();
  try {
    const r = await api('POST', '/api/settings/adobe-sign/register-webhook');
    toast('Webhook registered → ' + r.webhookUrl);
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

        <h2>4. Adobe Sign Integration</h2>
        <p>The App may connect to Adobe Acrobat Sign to facilitate electronic contract signing. Documents transmitted through this integration are governed by Adobe's terms of service. Infinity Pools is not responsible for Adobe Sign's availability or performance.</p>

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
        <p>You may request access to, correction of, or deletion of your data at any time by contacting us. You may also revoke any third-party integration permissions (QuickBooks, Adobe Sign) through those services directly.</p>

        <h2>7. Third-Party Services</h2>
        <p>The App integrates with Intuit QuickBooks and Adobe Acrobat Sign. These services have their own privacy policies that govern their data practices independently of this policy.</p>

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
