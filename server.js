// Infinity Pools — pool build management app
// Run: node server.js   then open http://localhost:4525
const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const cron = require('node-cron');

const store = require('./lib/store');
const mailer = require('./lib/mailer');
const alerts = require('./lib/alerts');
const pebble = require('./lib/pebble-check');
const contractPdf = require('./lib/contract-pdf');
const estimatePdf = require('./lib/estimate-pdf');
const specIntakePdf = require('./lib/spec-intake-pdf');
const specIntakeParse = require('./lib/spec-intake-parse');
const quickbooks = require('./lib/quickbooks');
const docuseal = require('./lib/docuseal');
const { extractInvoiceTotal } = require('./lib/invoice-amount');

const PORT = process.env.PORT || 4525;
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

store.load();

const app = express();

// Basic Auth — protects all routes except the client portal and DocuSeal webhooks.
// Set APP_USER and APP_PASS environment variables. Defaults allow local dev without credentials.
const APP_USER = process.env.APP_USER || '';
const APP_PASS = process.env.APP_PASS || '';
if (APP_USER && APP_PASS) {
  // Public (no Basic Auth): health check, client portal + its API, DocuSeal webhooks,
  // and the finish swatch images the portal displays. /uploads (contracts, invoices) stays protected.
  const PUBLIC_PATHS = ['/healthz', '/portal/', '/api/portal/', '/employee/', '/api/employee/', '/api/webhooks/docuseal', '/swatches/'];
  app.use((req, res, next) => {
    if (PUBLIC_PATHS.some(p => req.path.startsWith(p))) return next();
    const auth = req.headers.authorization;
    if (auth && auth.startsWith('Basic ')) {
      const [user, pass] = Buffer.from(auth.slice(6), 'base64').toString().split(':');
      if (user === APP_USER && pass === APP_PASS) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Infinity Pools"');
    res.status(401).send('Authentication required');
  });
}

// Unauthenticated health check for Render. Kept separate from /api/bootstrap so the
// real (data-bearing) endpoint can stay behind Basic Auth.
app.get('/healthz', (req, res) => res.json({ ok: true }));

app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(UPLOADS_DIR));

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(UPLOADS_DIR, req.params.id);
      fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname.replace(/[^\w.\- ]/g, '_')),
  }),
  limits: { fileSize: 50 * 1024 * 1024 },
});

const getClient = (req, res) => {
  const c = store.data.clients.find(c => c.id === req.params.id);
  if (!c) { res.status(404).json({ error: 'Client not found' }); return null; }
  return c;
};

const wrap = fn => (req, res) => Promise.resolve(fn(req, res)).catch(e => {
  console.error(e);
  store.addError(req.method, req.path, e.message, e.stack);
  res.status(500).json({ error: e.message });
});

// A project is reachable on the portal once its contract has been sent or signed
// (and it isn't a lost deal). Used to group a client's projects by their email.
function portalEligible(c) {
  return !!(c.contract && (c.contract.sentAt || c.contract.signedAt)) && c.status !== 'lost';
}
// Every email that may receive the portal link and log in: the primary plus any
// additionals, normalized (lowercased, trimmed, de-duplicated, non-empty).
function clientEmails(c) {
  return [...new Set([c.email, ...(c.additionalEmails || [])].map(e => (e || '').trim().toLowerCase()).filter(Boolean))];
}
// All portal projects sharing this client's email (the current one is always
// included so the switcher can show it as selected).
function siblingProjects(c) {
  const email = (c.email || '').trim().toLowerCase();
  const list = email
    ? store.data.clients.filter(x => (x.email || '').trim().toLowerCase() === email && (x.id === c.id || portalEligible(x)))
    : [c];
  return list.map(x => ({ address: x.address, status: x.status, token: x.portalToken, current: x.id === c.id }));
}

// Strip internal-only data before anything client-facing is built from a record.
// readOnly = true for the shareable view link and for non-primary (additional)
// contacts: they see everything but can't sign or make binding decisions.
// Pool Specs overview as [label, value] pairs — sizes only, never any pricing.
// Mirrors the admin Overview tab's size summary; shared by the client portal and
// the Employee View.
function poolSpecsSummary(c) {
  const _s = c.specs || {}, _pb = _s.poolBase || {}, _spa = _s.spaBase || {}, _fl = _s.fireLounge || {};
  const _wf = _s.waterFeature || {}, _cp = _s.coldPlunge || {}, _ff = _s.fireFeature || {};
  const _ss = _pb.sunShelf || {}, _sp = _pb.spillover || {}, _lg = _pb.ledgeSeating || {};
  const specsSummary = [];
  specsSummary.push(['Shape', _pb.shape === 'freeform' ? ('Freeform' + (_pb.freeform ? ' — ' + _pb.freeform : '')) : 'Geometric']);
  if (_pb.size) specsSummary.push(['Pool Size', _pb.size]);
  if (_pb.depth) specsSummary.push(['Depth', _pb.depth]);
  if (_ss.included) specsSummary.push(['Sun Shelf', _ss.details || 'Included']);
  if (_spa.included && _spa.size) specsSummary.push(['Spa Size', _spa.size]);
  if (_fl.included && _fl.size) specsSummary.push(['Fire Lounge Size', _fl.size]);
  if (_sp.included) specsSummary.push(['Spillover', _sp.details || 'Included']);
  if (_lg.included) specsSummary.push(['Ledge / Seating', _lg.details || 'Included']);
  if (_wf.included) specsSummary.push(['Water Feature', _wf.details || 'Included']);
  if (_cp.included) specsSummary.push(['Cold Plunge', _cp.details || 'Included']);
  if (_ff.included) specsSummary.push(['Fire Feature', _ff.details || 'Included']);
  return specsSummary;
}

function publicClientView(c, { readOnly = false } = {}) {
  const quote = store.quoteTotal(c);
  const specsSummary = poolSpecsSummary(c);
  return {
    specsSummary,
    name: c.name, address: c.address,
    status: c.status,
    readOnly: !!readOnly,
    // Every project this client (same email) can open on the portal — powers the
    // "switch project" menu when they have more than one.
    otherProjects: siblingProjects(c),
    phases: c.phases.map(p => ({
      key: p.key, name: p.name, drawPct: p.drawPct, time: p.time, status: p.status,
      dueDate: p.dueDate, completedAt: p.completedAt,
      amountDue: store.phaseAmount(c, p),
      paymentRequestedAt: p.paymentRequestedAt, paymentReceivedAt: p.paymentReceivedAt,
      paymentLink: p.paymentLink || p.payLink || c.quickbooks.payLink || '',
      clientSummary: (store.data.settings.phaseTemplate.find(t => t.key === p.key) || {}).clientSummary || '',
      clientLabel: (store.data.settings.phaseTemplate.find(t => t.key === p.key) || {}).clientLabel || p.name,
    })),
    // Optional stages that bracket the pool build, shown as extra steps on the
    // client's Build Tracker when included. status: pending | active | complete.
    siteExcavation: { included: !!(c.siteExcavation && c.siteExcavation.included), status: (c.siteExcavation && c.siteExcavation.status) || 'pending' },
    landscaping: { included: !!(c.landscaping && c.landscaping.included), status: (c.landscaping && c.landscaping.status) || 'pending' },
    selectedFinishes: (c.selectedFinishes || []).map(name => {
      const f = store.data.finishes.find(f => f.name === name || (f.brand + ' ' + f.name) === name);
      return f ? { name: f.name, brand: f.brand, image: f.localImage || f.imageUrl, color: f.color, tier: f.tier } : { name };
    }),
    // Waterline tile & coping — the same values shown on the Design tab, so the
    // client can share their preferences and the team sees them in one place.
    waterlineTile: c.contract.waterlineTile || '',
    coping: c.contract.coping || '',
    // Active Pebble finishes the client can choose from on the portal (no pricing).
    finishCatalog: (store.data.finishes || []).filter(f => f.active).map(f => ({
      name: f.name, brand: f.brand, tier: f.tier,
      image: f.localImage || f.imageUrl, color: f.color, shimmer: !!f.shimmer,
    })),
    clientTodos: (c.clientTodos || []).filter(t => !t.done),
    // Change orders the client can act on — pending ones need their approval;
    // approved ones show status (and a pay link if one was created). Declined
    // ones are hidden.
    changeOrders: (c.changeOrders || []).filter(co => (co.status || 'pending') !== 'declined').map(co => ({
      id: co.id, description: co.description, value: co.value,
      status: co.status || 'pending', createdAt: co.createdAt, approvedAt: co.approvedAt || null,
      paymentLink: co.qbPayLink || null, paymentReceivedAt: co.paymentReceivedAt || null,
    })),
    // Pool Renderings show on the portal at any time (design images to share with
    // the client). Other shared files appear only after they've accepted (signed).
    ...(() => {
      const isImg = n => /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(n || '');
      const allFiles = c.files || [];
      const sharedSource = c.contract.signedAt ? allFiles : [];
      const meta = f => ({ id: f.id, name: f.originalName, category: f.category, isImage: isImg(f.originalName) });
      return {
        renderings: allFiles.filter(f => f.category === 'Pool Renderings').map(meta),
        sharedFiles: sharedSource.filter(f => f.clientVisible && f.category !== 'Pool Renderings' && f.category !== 'Signed Contract').map(meta),
      };
    })(),
    contractSigned: !!c.contract.signedAt,
    contractSignedAt: c.contract.signedAt || null,
    contractSentAt: c.contract.sentAt || null,
    // The client can always view their contract PDF once it exists (sent, ready
    // to sign, or signed).
    contractViewable: !!(c.contract.sentAt || c.contract.signedAt || c.contract.docusealStatus === 'pending'),
    // Embedded DocuSeal signing form, shown while a submission is pending — only
    // to the primary contact (never on the view link / to additional contacts).
    signing: (!readOnly && !c.contract.signedAt && c.contract.docusealEmbedSrc && c.contract.docusealStatus === 'pending')
      ? { provider: 'docuseal', src: c.contract.docusealEmbedSrc }
      : null,
    quoteTotal: quote,
    changeOrderTotal: store.changeOrderTotal(c),
    collected: store.collected(c),
    feeNotes: store.data.settings.quickbooks.passFeesToClient
      ? [store.data.settings.quickbooks.achFeeNote, store.data.settings.quickbooks.ccFeeNote] : [],
  };
}

// ---------------------------------------------------------------------------
// Employee View — a public, read-only, no-login dashboard for field crews.
// Operational info only: schedule, project status, and phase progress. Never
// any pricing, costs, change-order values, contract, or payment details.
// ---------------------------------------------------------------------------
// File categories a field crew may see — operational documents only. Invoice
// categories (which carry costs) and the Signed Contract are never included.
const EMPLOYEE_FILE_CATEGORIES = ['Plans', 'Pool Renderings', 'Landscape Plans', 'Permits', 'Other'];
const isImageName = n => /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(n || '');

function employeeClientView(c) {
  const cur = store.currentPhase(c);
  const done = c.phases.filter(p => p.status === 'complete').length;
  return {
    id: c.id,
    name: c.name,
    address: c.address,
    phone: c.phone || '',
    status: c.status,
    projectType: c.projectType || 'new_pool',
    targetFinishDate: c.targetFinishDate || null,
    // Builder / contractor / other contacts — team-only operational info.
    contacts: c.contacts || {},
    currentPhase: cur ? { key: cur.key, name: cur.name, time: cur.time, dueDate: cur.dueDate || null } : null,
    progress: c.phases.length ? Math.round(100 * done / c.phases.length) : 0,
    // Phase names, status, and dates only — no draw percentages or dollar amounts.
    phases: c.phases.map(p => ({
      key: p.key, name: p.name, time: p.time, status: p.status,
      startedAt: p.startedAt || null, dueDate: p.dueDate || null, completedAt: p.completedAt || null,
    })),
    // Pool Specs — sizes only, never pricing.
    specs: poolSpecsSummary(c),
    // Operational files only (plans, renderings, permits) — download via the
    // token-gated employee file route below.
    files: (c.files || [])
      .filter(f => EMPLOYEE_FILE_CATEGORIES.includes(f.category))
      .map(f => ({ id: f.id, name: f.originalName, category: f.category, isImage: isImageName(f.originalName) })),
    siteExcavation: { included: !!(c.siteExcavation && c.siteExcavation.included), status: (c.siteExcavation && c.siteExcavation.status) || 'pending' },
    landscaping: { included: !!(c.landscaping && c.landscaping.included), status: (c.landscaping && c.landscaping.status) || 'pending' },
  };
}

// A stable, unguessable token that grants access to the Employee View. Generated
// once and stored in settings so the same shareable link keeps working.
function ensureEmployeeToken() {
  if (!store.data.settings.employeeToken) {
    store.data.settings.employeeToken = store.token();
    store.saveNow();
  }
  return store.data.settings.employeeToken;
}

function employeeData() {
  const clients = store.data.clients.filter(c => !c.testMode && c.status !== 'lost');
  const ids = new Set(clients.map(c => c.id));
  return {
    companyName: store.data.settings.companyName || 'Infinity Pools',
    generatedAt: new Date().toISOString(),
    clients: clients.map(employeeClientView),
    employees: (store.data.employees || []).map(e => ({ id: e.id, name: e.name })),
    // Scheduled events for these projects (plus any company-wide dated items).
    events: (store.data.events || [])
      .filter(e => !e.clientId || ids.has(e.clientId))
      .map(e => ({ id: e.id, clientId: e.clientId || null, title: e.title, details: e.details || '', date: e.date, endDate: e.endDate || null, time: e.time || '', employeeId: e.employeeId || null })),
    // Open, dated tasks only — no financial fields on tasks.
    tasks: (store.data.tasks || [])
      .filter(t => t.status !== 'done' && (!t.clientId || ids.has(t.clientId)) && t.dueDate)
      .map(t => ({ id: t.id, clientId: t.clientId || null, title: t.title, dueDate: t.dueDate, status: t.status })),
  };
}

// ---------------------------------------------------------------------------
// Bootstrap / dashboard
// ---------------------------------------------------------------------------
function readMarketRates() {
  try {
    const dir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(__dirname, 'data');
    const raw = fs.readFileSync(path.join(dir, 'market-rates.json'), 'utf8');
    return JSON.parse(raw);
  } catch { return null; }
}

app.get('/api/bootstrap', (req, res) => {
  const d = store.data;
  ensureEmployeeToken(); // make sure settings.employeeToken exists for the dashboard link
  res.json({
    settings: d.settings,
    marketRates: readMarketRates(),
    employees: d.employees,
    contractors: d.contractors,
    tasks: d.tasks,
    events: d.events,
    alerts: d.alerts.slice(0, 100),
    finishes: d.finishes,
    pebbleCheck: d.pebbleCheck,
    outbox: d.outbox.slice(0, 50),
    errorLog: (d.errorLog || []).slice(0, 100),
    gmailConfigured: mailer.configured(),
    quickbooksConnected: quickbooks.connected(),
    docusealConfigured: docuseal.configured(store.data.settings),
    clients: d.clients.map(c => ({
      ...c,
      _quote: store.quoteTotal(c),
      _coTotal: store.changeOrderTotal(c),
      _costs: store.costTotal(c),
      _collected: store.collected(c),
      _currentPhase: store.currentPhase(c),
      _siteExcavationTotal: store.moduleTotal(c.siteExcavation),
      _landscapingTotal: store.moduleTotal(c.landscaping),
    })),
  });
});

// ---------------------------------------------------------------------------
// Clients
// ---------------------------------------------------------------------------
app.post('/api/clients', (req, res) => {
  const c = store.newClient(req.body);
  store.data.clients.push(c);
  store.addAlert(`New prospect added: ${c.name} — ${c.address}`, { clientId: c.id });
  store.save();
  res.json(c);
});

// Create a seeded TEST job: a full, walkable project (specs → contract → sign →
// phases → payment requests) that never creates a QuickBooks invoice. Emails go
// to the company address so you can watch the client-facing flow end to end.
app.post('/api/clients/test-job', (req, res) => {
  const settings = store.data.settings || {};
  const email = String(req.body.email || settings.companyEmail || '').trim();
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const c = store.newClient({
    name: 'TEST — Sample Homeowner',
    address: `123 Test Street (TEST JOB · ${stamp})`,
    email,
    phone: '615-555-0100',
    testMode: true,
  });
  // Pre-fill enough specs to produce a realistic contract + quote.
  c.specs.poolBase.size = "16' x 32'";
  c.specs.poolBase.depth = "3.5' - 6'";
  c.specs.poolBase.jets = '8';
  c.specs.poolBase.ledLights = '4';
  c.specs.poolBase.price = 120000;
  c.specs.spaBase = { included: true, price: 22000, size: "7' x 7'", jets: '6', ledLights: '2', details: 'Raised spa with spillover' };
  c.finance = store.specsToFinance(c.specs);
  c.notes = 'This is a TEST job. No QuickBooks invoice will ever be created for it. Delete it when you are done.';
  store.data.clients.push(c);
  store.addAlert(`🧪 Test job created: ${c.address} — invoicing disabled.`, { clientId: c.id, type: 'info' });
  store.save();
  res.json(c);
});

// Create a prospect from a filled Sales Rep Form (Pool Spec intake PDF): parse the
// AcroForm fields and pre-populate the client's contact info + Pool Specs.
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
app.post('/api/prospects/from-intake', memUpload.single('file'), wrap(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No PDF uploaded.' });
  let parsed;
  try {
    parsed = await specIntakeParse.parseIntake(req.file.buffer);
  } catch (e) {
    return res.status(422).json({ error: 'Could not read the form: ' + e.message });
  }
  const c = store.newClient({ name: parsed.name, address: parsed.address, email: parsed.email, phone: parsed.phone });
  c.specs = parsed.specs;
  c.finance = store.specsToFinance(parsed.specs);
  if (parsed.notes) c.notes = parsed.notes;
  store.data.clients.push(c);
  store.addAlert(`New prospect from intake form: ${c.name || 'Unnamed'} — ${c.address || 'no address'}`, { clientId: c.id });
  store.save();
  res.json(c);
}));

app.put('/api/clients/:id', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const b = req.body;
  // Specs are frozen once the contract is signed — changes must be change orders.
  if (b.specs !== undefined) {
    if (c.specsLocked) return res.status(409).json({ error: 'Specs are locked: the contract is signed. Enter this change as a Change Order.' });
    c.specs = b.specs;
    // The priced spec sections are the source of truth for the quote: regenerate
    // the Finance line items so the two totals always match.
    c.finance = store.specsToFinance(b.specs);
  }
  for (const k of ['name', 'address', 'email', 'phone', 'additionalEmails', 'status', 'targetFinishDate', 'projectType', 'repair', 'scope', 'disclosures', 'notes', 'specNotes', 'selectedFinishes', 'clientTodos', 'projectOverview', 'siteExcavation', 'landscaping', 'contacts']) {
    if (b[k] !== undefined) c[k] = b[k];
  }
  if (b.finance !== undefined) {
    if (c.specsLocked) return res.status(409).json({ error: 'Pricing is locked: the contract is signed. Enter price changes as Change Orders.' });
    c.finance = b.finance;
  }
  if (b.costs !== undefined) c.costs = b.costs; // internal — always editable
  if (b.phases !== undefined) {
    // allow date edits / payment link edits without touching status machine
    for (const incoming of b.phases) {
      const p = c.phases.find(p => p.key === incoming.key);
      if (p) { p.dueDate = incoming.dueDate; p.paymentLink = incoming.paymentLink || p.paymentLink; }
    }
  }
  store.save();
  res.json(c);
});

app.delete('/api/clients/:id', (req, res) => {
  const i = store.data.clients.findIndex(c => c.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  store.data.clients.splice(i, 1);
  store.save();
  res.json({ ok: true });
});

// Cancel / Start Over: reset the build, keep the client record.
app.post('/api/clients/:id/reset', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  store.resetBuild(c);
  store.addAlert(`${c.address || c.name}: build reset (Cancel / Start Over) — phases, contract, and QuickBooks links cleared.`, { clientId: c.id, type: 'info' });
  res.json({ client: c });
});

// ---------------------------------------------------------------------------
// Phases
// ---------------------------------------------------------------------------
app.post('/api/clients/:id/phases/:key/complete', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const result = await alerts.completePhase(c, req.params.key);
  res.json({ client: c, result });
}));

app.post('/api/clients/:id/phases/:key/payment-received', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const p = c.phases.find(p => p.key === req.params.key);
  if (!p) return res.status(404).json({ error: 'Phase not found' });
  p.paymentReceivedAt = new Date().toISOString();
  p.paymentMethod = req.body.method || 'unspecified';
  store.addAlert(`${c.address}: ${p.name} draw received (${p.paymentMethod}) — ${alerts.fmtMoney(store.phaseAmount(c, p))}`, { clientId: c.id, type: 'payment' });
  store.save();
  res.json(c);
});

app.post('/api/clients/:id/phases/:key/request-payment', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const p = c.phases.find(p => p.key === req.params.key);
  if (!p) return res.status(404).json({ error: 'Phase not found' });
  if (req.body.paymentLink !== undefined) p.paymentLink = req.body.paymentLink;
  const rec = await alerts.sendPaymentRequest(c, p);
  res.json({ client: c, email: rec });
}));

// ---------------------------------------------------------------------------
// Optional project modules (Site Excavation / Landscaping) — lightweight stage
// tracking. Starting a stage spawns its master task list; no payment draws.
// ---------------------------------------------------------------------------
const MODULE_KEYS = ['siteExcavation', 'landscaping'];
app.post('/api/clients/:id/modules/:module/start', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const key = req.params.module;
  if (!MODULE_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown module' });
  const m = c[key];
  if (!m || !m.included) return res.status(400).json({ error: 'Module is not included on this project' });
  m.status = 'active';
  m.startedAt = new Date().toISOString();
  const label = key === 'siteExcavation' ? 'Site Excavation' : 'Landscaping';
  store.addAlert(`${c.address}: ${label} stage started`, { clientId: c.id, type: 'info' });
  const tasks = await alerts.spawnModuleTasks(c, key);
  store.save();
  res.json({ client: c, tasks });
}));

app.post('/api/clients/:id/modules/:module/complete', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const key = req.params.module;
  if (!MODULE_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown module' });
  const m = c[key];
  if (!m) return res.status(404).json({ error: 'Module not found' });
  m.status = 'complete';
  m.completedAt = new Date().toISOString();
  const label = key === 'siteExcavation' ? 'Site Excavation' : 'Landscaping';
  store.addAlert(`${c.address}: ${label} stage completed`, { clientId: c.id, type: 'info' });
  store.save();
  res.json({ client: c });
});

// Reset a module's stage back to Not started (keeps its details, pricing, and
// include choice; clears start/complete timestamps).
app.post('/api/clients/:id/modules/:module/reset', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const key = req.params.module;
  if (!MODULE_KEYS.includes(key)) return res.status(404).json({ error: 'Unknown module' });
  const m = c[key];
  if (!m) return res.status(404).json({ error: 'Module not found' });
  m.status = 'pending';
  m.startedAt = null;
  m.completedAt = null;
  // No tasks should exist for a stage that hasn't started — remove the ones this
  // stage auto-generated so a reset truly returns it to Not started.
  const removed = alerts.clearModuleTasks(c, key);
  const label = key === 'siteExcavation' ? 'Site Excavation' : 'Landscaping';
  store.addAlert(`${c.address}: ${label} stage reset to Not started${removed ? ` (${removed} auto task(s) removed)` : ''}`, { clientId: c.id, type: 'info' });
  store.save();
  res.json({ client: c, removed });
});

// ---------------------------------------------------------------------------
// Dirtworks Ledger integration — pull a linked job's expenses into a project's
// Site Excavation costs. Read-only, server-to-server (token never hits browser).
// ---------------------------------------------------------------------------
// Map a Dirtworks expense category onto our internal cost categories.
const DW_CAT_MAP = {
  'Labor': 'Labor', 'Equipment Rental': 'Equipment', 'Fuel': 'Equipment',
  'Materials': 'Materials', 'Supplies': 'Materials', 'Repairs & Maintenance': 'Equipment',
  'Permits & Fees': 'Permits', 'Subcontractor': 'Subcontractor', 'Meals': 'Other',
};

async function dirtworksFetch(pathAndQuery) {
  const dw = store.data.settings.dirtworks || {};
  if (!dw.exportToken) throw new Error('Dirtworks export token is not set — add it in Settings.');
  const base = (dw.url || 'https://dirtworks-ledger.onrender.com').replace(/\/+$/, '');
  let r;
  try {
    r = await fetch(base + pathAndQuery, { headers: { 'X-Export-Token': dw.exportToken } });
  } catch (e) {
    throw new Error('Could not reach Dirtworks at ' + base + ' (' + e.message + ')');
  }
  if (!r.ok) {
    if (r.status === 401) throw new Error('Dirtworks rejected the export token — check it matches EXPORT_TOKEN on the Dirtworks service.');
    if (r.status === 501) throw new Error('Dirtworks export is not enabled — set EXPORT_TOKEN (and Upstash sync) on the Dirtworks service.');
    if (r.status === 404) throw new Error('That Dirtworks job was not found.');
    throw new Error('Dirtworks returned error ' + r.status + '.');
  }
  return r.json();
}

// Proxy the job list so the admin can pick one to link (and to test the connection).
app.get('/api/dirtworks/jobs', wrap(async (req, res) => {
  const data = await dirtworksFetch('/api/export/jobs');
  res.json(data);
}));

// Pull the linked job's expenses in as Site Excavation cost lines (idempotent:
// previously-pulled Dirtworks lines are replaced by the current set).
app.post('/api/clients/:id/modules/siteExcavation/pull-dirtworks', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const m = c.siteExcavation;
  const jobId = String((req.body && req.body.jobId) || (m && m.dirtworksJobId) || '').trim();
  if (!jobId) return res.status(400).json({ error: 'No Dirtworks job linked — choose a job first.' });
  const data = await dirtworksFetch('/api/export/jobs/' + encodeURIComponent(jobId));
  const expenses = data.expenses || [];
  c.costs.items = (c.costs.items || []).filter(it => it.source !== 'dirtworks');
  let total = 0;
  for (const e of expenses) {
    const label = (e.store || 'Expense') + (e.product && e.product !== '—' ? ' — ' + e.product : '');
    const amount = Number(e.amount) || 0;
    c.costs.items.push({
      id: store.id(), label, category: DW_CAT_MAP[e.category] || 'Other',
      scope: 'siteExcavation', amount, source: 'dirtworks', sourceId: e.id, dwJobId: jobId,
    });
    total += amount;
  }
  m.dirtworksJobId = jobId;
  m.dirtworksJobName = (data.job && data.job.name) || '';
  m.dirtworksPulledAt = new Date().toISOString();
  store.addAlert(`${c.address}: pulled ${expenses.length} Site Excavation cost line(s) from Dirtworks (${alerts.fmtMoney(total)})`, { clientId: c.id, type: 'info' });
  store.save();
  res.json({ client: c, added: expenses.length, total });
}));

// ---------------------------------------------------------------------------
// Contract lifecycle
// ---------------------------------------------------------------------------
// Blank, fillable Pool Specs intake form to hand to a sales rep. Not tied to a
// client — it's a reusable template.
app.get('/api/forms/pool-spec-intake.pdf', wrap(async (req, res) => {
  const file = await specIntakePdf.generate();
  res.download(file, 'Infinity Pools - Pool Spec Intake Form.pdf');
}));

// Pre-contract price estimate: a line-item PDF the customer reviews before the
// formal contract. Preview/download for admin.
app.get('/api/clients/:id/estimate.pdf', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const file = await estimatePdf.generate(c);
  res.download(file, `${c.address.replace(/[^\w ]/g, '')} - Infinity Pools Estimate.pdf`);
}));

// Email the estimate PDF to the client, copying the company admin address so the
// office keeps a record of what was quoted.
app.post('/api/clients/:id/estimate/send', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const file = await estimatePdf.generate(c);
  const rec = await mailer.send({
    to: c.email,
    cc: store.data.settings.companyEmail,
    subject: `Your Infinity Pools estimate — ${c.address}`,
    html: `<p>Hi ${c.name.split(' ')[0]},</p>
      <p>Attached is a preliminary estimate for your pool project at <b>${c.address}</b>, totaling <b>${alerts.fmtMoney(store.quoteTotal(c))}</b>.</p>
      <p>This is an estimate only — it lets you review the scope and pricing before we prepare your formal proposal and contract. Pricing may be refined after a final site evaluation and your selections.</p>
      <p>Questions or changes? Just reply to this email and we'll be glad to help.</p><p>— Infinity Pools</p>`,
    attachments: [{ filename: `${c.address} - Infinity Pools Estimate.pdf`, path: file }],
  });
  c.estimateSentAt = new Date().toISOString();
  store.addAlert(`Estimate emailed to ${c.name} (${c.address})`, { clientId: c.id });
  store.save();
  res.json({ client: c, email: rec });
}));

app.get('/api/clients/:id/contract.pdf', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const file = await contractPdf.generate(c, { uploadsDir: UPLOADS_DIR });
  res.download(file, `${c.address.replace(/[^\w ]/g, '')} - Infinity Pools Contract.pdf`);
}));

app.post('/api/clients/:id/contract/send', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const file = await contractPdf.generate(c, { uploadsDir: UPLOADS_DIR });
  const rec = await mailer.send({
    to: c.email,
    subject: `Your Infinity Pools contract — ${c.address}`,
    html: `<p>Hi ${c.name.split(' ')[0]},</p>
      <p>Attached is your pool construction proposal and contract for <b>${c.address}</b>, totaling <b>${alerts.fmtMoney(store.quoteTotal(c))}</b>.</p>
      <p>When you're ready, you can review and sign the contract securely right inside your project portal — we'll send you the link. You'll also be able to choose your interior finish color there.</p>
      <p>Once signed, your project moves into the Design phase and we'll send your invoice through QuickBooks. You'll pay it in phase draws as your build progresses.</p>
      <p>Questions? Just reply to this email.</p><p>— Infinity Pools</p>`,
    attachments: [{ filename: `${c.address} - Infinity Pools Contract.pdf`, path: file }],
  });
  c.contract.sentAt = new Date().toISOString();
  if (c.status === 'prospect') c.status = 'contract_sent';
  store.addAlert(`Contract emailed to ${c.name} (${c.address})`, { clientId: c.id });
  store.save();
  res.json({ client: c, email: rec });
}));

// Shared "contract is now signed" flow, used by manual mark-signed and DocuSeal:
// locks specs + pricing, starts the Design phase, creates the QBO
// estimate, alerts the team, and either records an in-person deposit or sends the
// design-draw payment request. Returns { qb, qbError }.
// Convert a date-only string (YYYY-MM-DD from a date input) to an ISO timestamp at
// noon UTC, so it renders as the same calendar day in any timezone. Returns null
// for empty/invalid input (callers fall back to "now").
const dateOnlyToIso = d => (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) ? new Date(d + 'T12:00:00Z').toISOString() : null;

async function finalizeContractSigning(c, { method, depositMethod = null, finishText = null, note = '', signedAt = null, depositReceivedAt = null }) {
  c.contract.signedAt = signedAt || new Date().toISOString();
  c.contract.signedMethod = method;
  c.contract.depositMethod = depositMethod;
  if (finishText && !c.selectedFinishes.includes(finishText)) c.selectedFinishes.push(finishText);
  c.specsLocked = true;
  c.status = 'active';

  // Default the projected completion to 3 months out — unless one was already set,
  // which stays editable in Edit Client Info.
  if (!c.targetFinishDate) {
    const t = new Date(c.contract.signedAt); t.setMonth(t.getMonth() + 3);
    c.targetFinishDate = t.toISOString().slice(0, 10);
  }

  const design = c.phases[0];
  design.status = 'active';
  design.startedAt = new Date().toISOString();
  if (!design.dueDate) {
    const d = new Date(); d.setDate(d.getDate() + 7);
    design.dueDate = d.toISOString().slice(0, 10);
  }

  let qb = null, qbError = null;
  if (quickbooks.connected() && !c.testMode) {
    try { qb = await quickbooks.createContractInvoice(c, store.quoteTotal(c)); }
    catch (e) { qbError = e.message; store.addAlert('QuickBooks invoice creation failed for ' + c.address + ': ' + e.message, { clientId: c.id, type: 'error' }); }
  }

  store.addAlert(`🎉 Contract SIGNED (${method}${depositMethod ? ', deposit by ' + depositMethod : ''}): ${c.name} — ${c.address}. Design phase started.${note}`, { clientId: c.id, type: 'phase' });

  if (depositMethod) {
    design.paymentReceivedAt = depositReceivedAt || new Date().toISOString();
    design.paymentMethod = depositMethod;
  } else if (c.email && design.drawPct > 0) {
    await alerts.sendPaymentRequest(c, design);
  }

  await alerts.spawnPhaseTasks(c, design);

  const emails = mailer.allEmployeeEmails();
  if (emails.length) {
    await mailer.send({
      to: emails,
      subject: `Contract signed — ${c.address}`,
      html: `<p><b>${c.name}</b> signed the contract for <b>${c.address}</b> (${alerts.fmtMoney(store.quoteTotal(c))}).</p>${finishText ? `<p>Finish selection: <b>${finishText}</b></p>` : ''}<p>The project is now in the <b>Design Finalization</b> phase.</p>`,
    });
  }
  store.save();
  return { qb, qbError };
}

// Manual fallback: mark a contract signed outside the system (paper, or a signed
// PDF emailed back). Locks specs + pricing, starts Design phase, sends design draw
// payment request, creates QBO invoice if connected. Optionally accepts the actual
// signed PDF (multipart field "signedPdf") plus explicit signed / deposit-received
// dates (YYYY-MM-DD); both default to now when omitted.
app.post('/api/clients/:id/contract/mark-signed', upload.single('signedPdf'), wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const method = req.body.method || 'manual';            // digital | paper
  const depositMethod = req.body.depositMethod || null;  // check | cash | null
  const signedAt = dateOnlyToIso(req.body.signedAt);
  const depositReceivedAt = dateOnlyToIso(req.body.depositReceivedAt);
  // Store the uploaded signed PDF under the 'Signed Contract' category so the
  // contract card's "View Signed PDF" button finds it (mirrors DocuSeal).
  if (req.file) {
    c.files.push({
      id: store.id(), originalName: req.file.originalname || 'Signed Contract.pdf',
      storedName: req.file.filename, category: 'Signed Contract',
      size: req.file.size, uploadedAt: new Date().toISOString(), isCoverPhoto: false,
    });
  }
  const { qb, qbError } = await finalizeContractSigning(c, { method, depositMethod, signedAt, depositReceivedAt });
  res.json({ client: c, quickbooksInvoice: qb, quickbooksError: qbError });
}));

// ---------------------------------------------------------------------------
// DocuSeal — in-portal contract e-signing
// ---------------------------------------------------------------------------

// Download the signed PDF, save it to the client's files, then run the shared
// "contract signed" flow. Idempotent: no-op once signedAt is set.
async function processDocusealCompletion(c) {
  if (c.contract.signedAt) return;
  let signedUrl = null;
  try {
    if (c.contract.docusealSubmissionId) {
      const sub = await docuseal.getSubmission(c.contract.docusealSubmissionId, store.data.settings);
      c.contract.docusealStatus = sub.status || 'completed';
      signedUrl = docuseal.signedPdfUrl(sub);
    }
  } catch (e) { store.addAlert('DocuSeal: could not fetch submission for ' + c.address + ': ' + e.message, { clientId: c.id, type: 'error' }); }

  if (signedUrl) {
    try {
      const r = await fetch(signedUrl);
      if (r.ok) {
        const buf = Buffer.from(await r.arrayBuffer());
        const dir = path.join(UPLOADS_DIR, c.id);
        fs.mkdirSync(dir, { recursive: true });
        const storedName = `signed-contract-${Date.now()}.pdf`;
        fs.writeFileSync(path.join(dir, storedName), buf);
        c.files.push({ id: store.id(), originalName: 'Signed Contract.pdf', storedName, category: 'Signed Contract', size: buf.length, uploadedAt: new Date().toISOString(), isCoverPhoto: false });
      }
    } catch (e) { store.addAlert('DocuSeal: could not download signed PDF for ' + c.address + ': ' + e.message, { clientId: c.id, type: 'error' }); }
  }

  c.contract.docusealStatus = 'completed';
  await finalizeContractSigning(c, { method: 'docuseal', note: ' Signed in client portal.' });
}

// Generate the signing PDF, create a DocuSeal template + embedded submission.
app.post('/api/clients/:id/contract/docuseal-send', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (!c.email) return res.status(400).json({ error: 'Client has no email address on file' });
  if (!docuseal.configured(store.data.settings)) return res.status(400).json({ error: 'DocuSeal is not configured — add your API key in Settings' });
  const pdfPath = await contractPdf.generate(c, { uploadsDir: UPLOADS_DIR, forSigning: true });
  const tpl = await docuseal.createTemplateFromPdf(c, pdfPath, store.data.settings);
  const subResp = await docuseal.createSubmission(c, tpl.id, store.data.settings);
  const sub = docuseal.firstSubmitter(subResp);
  if (!sub.slug) return res.status(502).json({ error: 'DocuSeal did not return a signing link' });
  c.contract.docusealTemplateId = tpl.id;
  c.contract.docusealSubmissionId = sub.submissionId;
  c.contract.docusealSlug = sub.slug;
  c.contract.docusealEmbedSrc = sub.embedSrc;
  c.contract.docusealStatus = 'pending';
  c.contract.docusealSentAt = new Date().toISOString();
  if (c.status === 'prospect') c.status = 'contract_sent';
  store.addAlert(`Contract ready for in-portal signing (DocuSeal) — ${c.name} (${c.address})`, { clientId: c.id });
  store.save();
  res.json({ client: c, slug: sub.slug, embedSrc: sub.embedSrc });
}));

// Admin poll: check DocuSeal status and finalize if completed.
app.post('/api/clients/:id/contract/docuseal-status', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (!c.contract.docusealSubmissionId) return res.status(400).json({ error: 'No DocuSeal submission found for this client' });
  if (!docuseal.configured(store.data.settings)) return res.status(400).json({ error: 'DocuSeal is not configured' });
  const sub = await docuseal.getSubmission(c.contract.docusealSubmissionId, store.data.settings);
  c.contract.docusealStatus = sub.status || c.contract.docusealStatus;
  if ((sub.status === 'completed') && !c.contract.signedAt) {
    await processDocusealCompletion(c);
    return res.json({ client: c, status: 'completed' });
  }
  store.save();
  res.json({ client: c, status: c.contract.docusealStatus });
}));

// Webhook — DocuSeal POSTs here on form.completed / submission.completed.
app.post('/api/webhooks/docuseal', wrap(async (req, res) => {
  res.json({ ok: true }); // acknowledge immediately; process async
  const ev = req.body || {};
  if (!['form.completed', 'submission.completed'].includes(ev.event_type)) return;
  const data = ev.data || {};
  const submission = data.submission || data;
  const extId = data.external_id || submission.external_id;
  let c = extId && store.data.clients.find(x => x.id === extId);
  if (!c) {
    const subId = submission.id || data.submission_id;
    c = subId && store.data.clients.find(x => String(x.contract.docusealSubmissionId) === String(subId));
  }
  if (!c || c.contract.signedAt) return;
  try {
    await processDocusealCompletion(c);
  } catch (e) {
    store.addAlert('DocuSeal webhook error: ' + e.message, { type: 'error' });
    store.save();
    console.error('DocuSeal webhook:', e);
  }
}));

// Test DocuSeal credentials.
app.post('/api/settings/docuseal/test', wrap(async (req, res) => {
  if (!docuseal.configured(store.data.settings)) return res.status(400).json({ error: 'DocuSeal API key not saved yet' });
  const url = docuseal.base(store.data.settings) + '/templates?limit=1';
  const r = await fetch(url, { headers: { 'X-Auth-Token': store.data.settings.docuseal.apiKey } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = {}; }
  if (!r.ok) return res.status(400).json({ error: (json && (json.error || json.message)) || `HTTP ${r.status} — check your API key and base URL` });
  res.json({ ok: true });
}));

// Validate QuickBooks credentials without clearing the token on failure.
app.post('/api/settings/quickbooks/test', wrap(async (req, res) => {
  res.json(await quickbooks.testConnection());
}));

// ---------------------------------------------------------------------------
// Manually create QB customer + master invoice when auto-creation failed at signing.
app.post('/api/clients/:id/quickbooks/create-invoice', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (c.testMode) return res.status(400).json({ error: 'This is a test job — invoicing is disabled.' });
  if (!c.contract.signedAt) return res.status(400).json({ error: 'Contract has not been signed yet.' });
  if (!quickbooks.connected()) return res.status(400).json({ error: 'QuickBooks is not connected.' });
  if (c.quickbooks.invoiceId) return res.status(400).json({ error: 'A QuickBooks invoice already exists for this client.' });
  await quickbooks.createContractInvoice(c, store.quoteTotal(c));
  store.save();
  res.json({ client: c });
}));

// Link an invoice already created in QuickBooks (e.g. an older job invoiced there
// directly) to this project, by invoice number or ID. Payments stay manual.
app.post('/api/clients/:id/quickbooks/link-invoice', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (c.testMode) return res.status(400).json({ error: 'This is a test job — invoicing is disabled.' });
  if (!quickbooks.connected()) return res.status(400).json({ error: 'QuickBooks is not connected.' });
  if (c.quickbooks.invoiceId) return res.status(400).json({ error: 'A QuickBooks invoice is already linked to this project.' });
  const invoice = await quickbooks.linkExistingInvoice(c, req.body.invoice);
  store.addAlert(`${c.address}: linked existing QuickBooks invoice${invoice.docNumber ? ' #' + invoice.docNumber : ''}.`, { clientId: c.id, type: 'info' });
  store.save();
  res.json({ client: c, invoice });
}));

// Change orders
// ---------------------------------------------------------------------------
app.post('/api/clients/:id/change-orders', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const co = {
    id: store.id(),
    description: String(req.body.description || '').trim(),
    value: Number(req.body.value) || 0,
    createdAt: new Date().toISOString(),
    // A change order is not invoiced until the client approves it on their portal.
    status: 'pending', approvedAt: null, declinedAt: null, paymentRequestedAt: null,
    qbInvoiceId: null, qbInvoiceUrl: null, qbPayLink: null,
  };
  if (!co.description) return res.status(400).json({ error: 'Change description is required' });
  c.changeOrders.push(co);
  store.addAlert(`${c.address}: change order added — "${co.description}" (${alerts.fmtMoney(co.value)}) — awaiting client approval on their portal.`, { clientId: c.id, type: 'change' });
  // Ask the client to review & approve it on their portal (no invoice yet).
  let email = null;
  if (c.email) {
    try { email = await mailer.send({
      to: c.email,
      subject: `Approval needed — change order for ${c.address}`,
      html: `<p>Hi ${c.name.split(' ')[0]},</p>
        <p>We've prepared a change order for your project at <b>${c.address}</b>:</p>
        <p style="margin:10px 0"><b>${co.description}</b><br>
        Amount: <b>${alerts.fmtMoney(co.value)}</b>${co.value < 0 ? ' (credit)' : ''}</p>
        <p>Please review and approve it on your project portal. ${co.value > 0 ? 'Once you approve, we\'ll send your invoice and payment request for this change.' : 'Once you approve, the credit will be applied to your contract.'}</p>
        <p><a href="/portal/${c.portalToken}" style="display:inline-block;background:#0a5ea8;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:600;">Review on your portal</a></p>
        <p>Thank you!<br>Infinity Pools</p>`,
    }); } catch (e) { /* portal approval still works without the email */ }
  }
  store.save();
  res.json({ client: c, email });
}));

// Shared change-order approval flow (client portal, or admin on the client's
// behalf): mark approved, then — for a positive charge on a non-test job with
// QuickBooks connected — create the invoice and send it (the payment request).
async function approveChangeOrder(c, co) {
  if (co.status === 'approved') return { qbError: null };
  co.status = 'approved';
  co.approvedAt = new Date().toISOString();
  co.declinedAt = null;
  let qbError = null;
  if (co.value > 0 && !c.testMode && quickbooks.connected()) {
    try {
      await quickbooks.createChangeOrderInvoice(c, co);
      await quickbooks.sendInvoiceById(c, co.qbInvoiceId);
      co.paymentRequestedAt = new Date().toISOString();
    } catch (e) {
      qbError = e.message;
      store.addAlert('QuickBooks change-order invoice failed after approval for ' + c.address + ': ' + e.message, { clientId: c.id, type: 'error' });
    }
  }
  const suffix = co.value > 0
    ? (c.testMode ? ' (test job — no invoice)' : !quickbooks.connected() ? ' — connect QuickBooks or paste a link to invoice it' : qbError ? ' — invoice FAILED, see error' : ' — invoice created & payment requested')
    : ' (credit applied)';
  store.addAlert(`✅ Client APPROVED change order "${co.description}" (${alerts.fmtMoney(co.value)})${suffix}.`, { clientId: c.id, type: 'change' });
  store.save();
  return { qbError };
}

// Admin approves a change order on the client's behalf (e.g. verbal approval),
// running the same invoice + payment-request flow as the portal approval.
app.post('/api/clients/:id/change-orders/:coId/approve', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const co = c.changeOrders.find(co => co.id === req.params.coId);
  if (!co) return res.status(404).json({ error: 'Change order not found' });
  const { qbError } = await approveChangeOrder(c, co);
  res.json({ client: c, quickbooksError: qbError });
}));

app.delete('/api/clients/:id/change-orders/:coId', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  c.changeOrders = c.changeOrders.filter(co => co.id !== req.params.coId);
  store.save();
  res.json(c);
});

// Project selections (plaster color, waterline tile, coping)
app.put('/api/clients/:id/selections', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const { plasterColor, waterlineTile, coping } = req.body;
  if (plasterColor !== undefined) c.contract.plasterColor = plasterColor;
  if (waterlineTile !== undefined) c.contract.waterlineTile = waterlineTile;
  if (coping !== undefined) c.contract.coping = coping;
  store.save();
  res.json(c);
});

// Haul tracking (tri-axle haul-offs and gravel loads)
app.put('/api/clients/:id/hauls', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (!c.hauls) c.hauls = { triAxle: 0, gravel: 0 };
  if (req.body.triAxle !== undefined) c.hauls.triAxle = Math.max(0, Number(req.body.triAxle) || 0);
  if (req.body.gravel !== undefined) c.hauls.gravel = Math.max(0, Number(req.body.gravel) || 0);
  store.save();
  res.json(c);
});

app.post('/api/clients/:id/change-orders/:coId/send-invoice', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const co = c.changeOrders.find(co => co.id === req.params.coId);
  if (!co) return res.status(404).json({ error: 'Change order not found' });
  if (!co.qbInvoiceId) return res.status(400).json({ error: 'No QuickBooks invoice for this change order yet' });
  await quickbooks.sendInvoiceById(c, co.qbInvoiceId);
  store.addAlert(`${c.address}: change order invoice sent to ${c.email} — "${co.description}"`, { clientId: c.id, type: 'info' });
  store.save();
  res.json({ ok: true });
}));

// Repair project: create a QuickBooks invoice for the repair budget and email it
// to the client. Only for client-responsible repairs on a real (non-test) job.
app.post('/api/clients/:id/repair/invoice', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const r = c.repair || {};
  if (c.projectType !== 'repair') return res.status(400).json({ error: 'This project is not a repair.' });
  if (r.responsible !== 'client') return res.status(400).json({ error: 'Set “Client responsible” before invoicing.' });
  if (!(Number(r.budget) > 0)) return res.status(400).json({ error: 'Set a repair budget greater than $0 first.' });
  if (!c.email) return res.status(400).json({ error: 'Client has no email address on file.' });
  if (c.testMode) return res.status(400).json({ error: 'Test job — no invoice is created.' });
  if (!quickbooks.connected()) return res.status(400).json({ error: 'QuickBooks is not connected. Paste a payment link instead, or connect QuickBooks in Settings.' });
  await quickbooks.createRepairInvoice(c);
  try {
    await quickbooks.sendInvoiceById(c, c.repair.qb.invoiceId);
    c.repair.qb.sentAt = new Date().toISOString();
  } catch (e) {
    store.addAlert('Repair invoice created but could not be emailed for ' + c.address + ': ' + e.message, { clientId: c.id, type: 'error' });
    store.save();
    return res.status(502).json({ error: 'Invoice created but sending failed: ' + e.message, client: c });
  }
  store.addAlert(`🔧 Repair invoice sent to ${c.name} (${alerts.fmtMoney(Number(c.repair.budget) || 0)}) — ${c.address}`, { clientId: c.id, type: 'change' });
  store.save();
  res.json({ client: c });
}));

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------
const INVOICE_COST_CATEGORY = { 'Material Invoices': 'Materials', 'Labor Invoices': 'Labor' };

app.post('/api/clients/:id/files', upload.array('files', 20), wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const category = req.body.category || 'Other';
  const enteredAmount = Number(req.body.invoiceAmount) || 0;
  const costsAdded = [];
  for (const f of req.files) {
    const rec = {
      id: store.id(), originalName: f.originalname, storedName: f.filename,
      category, size: f.size, uploadedAt: new Date().toISOString(), isCoverPhoto: false,
    };
    c.files.push(rec);
    // Invoice uploads automatically create a matching line on Costs (Internal).
    if (INVOICE_COST_CATEGORY[category]) {
      // Manually entered amount wins (only unambiguous for a single file);
      // otherwise read the total out of the invoice PDF.
      let amount = (req.files.length === 1 && enteredAmount > 0) ? enteredAmount
        : await extractInvoiceTotal(path.join(UPLOADS_DIR, c.id, f.filename));
      const label = 'Invoice: ' + f.originalname.replace(/\.[^.]+$/, '');
      c.costs.items.push({ id: store.id(), label, category: INVOICE_COST_CATEGORY[category], scope: 'pool', amount, fileId: rec.id });
      costsAdded.push({ label, amount });
    }
  }
  if (costsAdded.length) {
    store.addAlert(`${c.address}: ${costsAdded.length} invoice(s) uploaded — cost line(s) added: ${costsAdded.map(x => x.label.replace('Invoice: ', '') + ' (' + alerts.fmtMoney(x.amount) + ')').join(', ')}. Review amounts in Costs (Internal).`, { clientId: c.id, type: 'info' });
  }
  store.save();
  res.json({ ...c, _costsAdded: costsAdded });
}));

app.get('/api/clients/:id/files/:fileId/download', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const f = c.files.find(f => f.id === req.params.fileId);
  if (!f) return res.status(404).json({ error: 'File not found' });
  res.download(path.join(UPLOADS_DIR, c.id, f.storedName), f.originalName);
});

app.post('/api/clients/:id/files/:fileId/cover', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  for (const f of c.files) f.isCoverPhoto = (f.id === req.params.fileId) ? !!req.body.isCoverPhoto : false;
  store.save();
  res.json(c);
});

// Toggle whether a file is visible to the client on their portal (after signing).
app.post('/api/clients/:id/files/:fileId/visibility', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const f = c.files.find(f => f.id === req.params.fileId);
  if (!f) return res.status(404).json({ error: 'File not found' });
  f.clientVisible = !!req.body.clientVisible;
  store.save();
  res.json(c);
});

app.delete('/api/clients/:id/files/:fileId', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const f = c.files.find(f => f.id === req.params.fileId);
  if (f) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, c.id, f.storedName)); } catch (e) {}
    c.files = c.files.filter(x => x.id !== f.id);
    // remove the cost line this invoice created (if any)
    c.costs.items = c.costs.items.filter(i => i.fileId !== f.id);
    store.save();
  }
  res.json(c);
});

app.post('/api/clients/:id/files/email', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const { fileIds = [], to, note = '' } = req.body;
  const files = c.files.filter(f => fileIds.includes(f.id));
  if (!files.length) return res.status(400).json({ error: 'No files selected' });
  if (!to) return res.status(400).json({ error: 'No recipient' });
  const rec = await mailer.send({
    to,
    subject: `Documents for ${c.address} — Infinity Pools`,
    html: `<p>Please find attached ${files.length} document(s) for <b>${c.address}</b>.</p>${note ? '<p>' + note + '</p>' : ''}<p>— Infinity Pools</p>`,
    attachments: files.map(f => ({ filename: f.originalName, path: path.join(UPLOADS_DIR, c.id, f.storedName) })),
  });
  res.json({ email: rec });
}));

// ---------------------------------------------------------------------------
// Employees, contractors, tasks
// ---------------------------------------------------------------------------
function crud(name) {
  app.post(`/api/${name}`, (req, res) => {
    const rec = { id: store.id(), ...req.body };
    store.data[name].push(rec); store.save(); res.json(rec);
  });
  app.put(`/api/${name}/:id`, (req, res) => {
    const rec = store.data[name].find(r => r.id === req.params.id);
    if (!rec) return res.status(404).json({ error: 'Not found' });
    Object.assign(rec, req.body, { id: rec.id }); store.save(); res.json(rec);
  });
  app.delete(`/api/${name}/:id`, (req, res) => {
    store.data[name] = store.data[name].filter(r => r.id !== req.params.id);
    store.save(); res.json({ ok: true });
  });
}
crud('employees');
crud('contractors');
crud('tasks');

// Events: creating one emails an alert to the assignee + admin (editing/deleting
// don't). Mirrors the generic crud otherwise.
app.post('/api/events', wrap(async (req, res) => {
  const rec = { id: store.id(), ...req.body };
  store.data.events.push(rec);
  store.save();
  try { await alerts.notifyEventAdded(rec); } catch (e) { console.error('event email:', e.message); }
  res.json(rec);
}));
app.put('/api/events/:id', (req, res) => {
  const rec = store.data.events.find(r => r.id === req.params.id);
  if (!rec) return res.status(404).json({ error: 'Not found' });
  Object.assign(rec, req.body, { id: rec.id }); store.save(); res.json(rec);
});
app.delete('/api/events/:id', (req, res) => {
  store.data.events = store.data.events.filter(r => r.id !== req.params.id);
  store.save(); res.json({ ok: true });
});

// Manually run the day-before / morning-of schedule reminders (also runs nightly
// via cron). Handy for testing and a "Run reminders now" button.
app.post('/api/schedule-reminders/run', wrap(async (req, res) => {
  const result = await alerts.sendScheduleReminders();
  res.json(result);
}));

app.post('/api/tasks/:id/remind', wrap(async (req, res) => {
  const t = store.data.tasks.find(t => t.id === req.params.id);
  if (!t) return res.status(404).json({ error: 'Task not found' });
  const rec = await alerts.taskReminder(t);
  res.json({ email: rec });
}));

// ---------------------------------------------------------------------------
// Settings, alerts, finishes, pebble check, outbox
// ---------------------------------------------------------------------------
app.put('/api/settings', (req, res) => {
  Object.assign(store.data.settings, req.body);
  store.save();
  res.json(store.data.settings);
});

app.post('/api/alerts/read', (req, res) => {
  for (const a of store.data.alerts) a.read = true;
  store.save(); res.json({ ok: true });
});

app.delete('/api/error-log', (req, res) => {
  store.data.errorLog = [];
  store.save(); res.json({ ok: true });
});

app.put('/api/finishes/:id', (req, res) => {
  const f = store.data.finishes.find(f => f.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Not found' });
  Object.assign(f, req.body, { id: f.id }); store.save(); res.json(f);
});

app.post('/api/finishes', (req, res) => {
  const f = { id: store.id(), active: true, source: 'manual', ...req.body };
  store.data.finishes.push(f); store.save(); res.json(f);
});

app.delete('/api/finishes/:id', (req, res) => {
  const i = store.data.finishes.findIndex(f => f.id === req.params.id);
  if (i === -1) return res.status(404).json({ error: 'Not found' });
  store.data.finishes.splice(i, 1); store.save(); res.json({ ok: true });
});

app.post('/api/pebble-check/run', wrap(async (req, res) => {
  const result = await pebble.run({ sendEmail: !!req.body.sendEmail });
  res.json(result);
}));

app.post('/api/test-email', wrap(async (req, res) => {
  const rec = await mailer.send({
    to: req.body.to || store.data.settings.companyEmail,
    subject: 'Infinity Pools — test email',
    html: '<p>Your Gmail connection is working. 🎉</p>',
  });
  res.json({ email: rec });
}));

// ---------------------------------------------------------------------------
// Client portal (public, token-protected)
// ---------------------------------------------------------------------------
app.post('/api/clients/:id/portal/send-link', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const recipients = clientEmails(c);
  if (!recipients.length) return res.status(400).json({ error: 'Client has no email address on file' });
  const portalUrl = `${req.protocol}://${req.get('host')}/portal/${c.portalToken}`;
  const rec = await mailer.send({
    to: recipients,
    subject: `Your Infinity Pools project page — ${c.address}`,
    html: `<p>Hi ${(c.name || 'there').split(' ')[0]},</p>
      <p>Here is your personal project page for <b>${c.address}</b>. You can use it any time to:</p>
      <ul>
        <li>Follow your build progress through each phase</li>
        <li>View and pay your current invoice</li>
        <li>See your interior finish selections</li>
        <li>Check any items we need from you</li>
      </ul>
      <p style="margin:20px 0;">
        <a href="${portalUrl}" style="display:inline-block;background:#0a5ea8;color:#fff;text-decoration:none;padding:13px 28px;border-radius:8px;font-weight:600;font-size:15px;">View Your Project Page</a>
      </p>
      <p style="font-size:13px;color:#4a6b85;">Or copy this link into your browser:<br>${portalUrl}</p>
      <p style="font-size:13px;color:#4a6b85;">Bookmark this page — the link is private and unique to your project.</p>
      <p>Questions? Just reply to this email.<br>— Infinity Pools</p>`,
  });
  // Only claim success when the email actually sent. mailer.send never throws —
  // it records the real outcome on the outbox record — so report that truthfully
  // instead of always showing "emailed".
  if (rec.status !== 'sent') {
    store.addAlert(`⚠ Portal link to ${c.name || c.address} was NOT sent: ${rec.error || rec.status}`, { clientId: c.id, type: 'error' });
    store.save();
    return res.status(502).json({ error: rec.error || 'Email was not sent', status: rec.status });
  }
  c.contract.portalLinkSentAt = new Date().toISOString();
  store.addAlert(`Portal link emailed to ${c.name} (${recipients.join(', ')})`, { clientId: c.id });
  store.save();
  res.json({ ok: true, recipients });
}));

// Regenerate the read-only shareable view link (revokes the old one).
app.post('/api/clients/:id/portal/regenerate-view-link', (req, res) => {
  const c = getClient(req, res); if (!c) return;
  c.viewToken = store.token();
  store.addAlert(`View-only portal link regenerated for ${c.name} — the old link no longer works.`, { clientId: c.id });
  store.save();
  res.json({ viewToken: c.viewToken });
});

// ---------------------------------------------------------------------------
// Client portal — email verification sessions (in-memory, 7-day expiry)
// ---------------------------------------------------------------------------
const portalSessions = new Map(); // sessionId → { portalToken, expires }
function prunePortalSessions() {
  const now = Date.now();
  for (const [id, s] of portalSessions) if (s.expires < now) portalSessions.delete(id);
}

app.get('/portal/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});
// Read-only shareable link — same portal page; the front-end detects the /view/
// path and skips the email gate (access is granted by the viewToken alone).
app.get('/portal/view/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'portal.html'));
});

app.post('/api/portal/:token/verify', (req, res) => {
  const c = store.data.clients.find(c => c.portalToken === req.params.token);
  if (!c) return res.status(404).json({ error: 'Project not found' });
  const submitted = String(req.body.email || '').trim().toLowerCase();
  if (!submitted || !clientEmails(c).includes(submitted)) {
    return res.status(401).json({ error: 'Email address not recognized for this project. Please double-check and try again.' });
  }
  prunePortalSessions();
  const sessionId = crypto.randomBytes(32).toString('hex');
  // Session is scoped to the verified email, so it can open any of this person's
  // projects (same email, contract sent) without re-verifying.
  portalSessions.set(sessionId, { portalToken: req.params.token, email: submitted, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  res.json({ sessionId });
});

// Resolve the client for an authenticated portal request, or send the error and
// return null. Requires a valid, unexpired session for this token.
function portalClient(req, res, { allowQuerySession = false } = {}) {
  // View-only shareable link: the viewToken alone grants read-only access — no
  // login. Marks the request read-only so binding actions (sign, change-order
  // approval, finish selection) are refused.
  const viewC = store.data.clients.find(c => c.viewToken === req.params.token);
  if (viewC) { req.portalReadOnly = true; return viewC; }

  const c = store.data.clients.find(c => c.portalToken === req.params.token);
  if (!c) { res.status(404).json({ error: 'Project not found' }); return null; }
  // <img>/<a> tags can't send a custom header, so file requests may pass the
  // session as ?s=… instead. The portalToken + session together still gate access.
  const sessionId = req.headers['x-portal-session'] || (allowQuerySession ? req.query.s : null);
  const session = sessionId && portalSessions.get(sessionId);
  // Valid if the session was issued for this exact project, OR it was verified for
  // an email that also owns this (contract-sent) project — enabling seamless
  // switching between a person's projects without re-verifying each one.
  const ok = session && session.expires >= Date.now() && (
    session.portalToken === req.params.token ||
    (session.email && clientEmails(c).includes(session.email) && portalEligible(c))
  );
  if (!ok) { res.status(401).json({ error: 'verify' }); return null; }
  // Only the project's PRIMARY contact can sign / make binding decisions. Everyone
  // else who verified (additional emails) is read-only.
  const primary = (c.email || '').trim().toLowerCase();
  req.portalReadOnly = !(session.email && session.email === primary);
  return c;
}

// Client downloads/views a file we've shared with them. Pool Renderings are
// viewable any time; other clientVisible files only after they've signed.
app.get('/api/portal/:token/files/:fileId', (req, res) => {
  const c = portalClient(req, res, { allowQuerySession: true }); if (!c) return;
  const f = (c.files || []).find(f => f.id === req.params.fileId);
  const allowed = f && f.category !== 'Signed Contract' && (
    f.category === 'Pool Renderings' || (c.contract.signedAt && f.clientVisible)
  );
  if (!allowed) return res.status(404).json({ error: 'File not available' });
  const p = path.join(UPLOADS_DIR, c.id, f.storedName);
  if (!fs.existsSync(p)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(p); // inline — images render in the gallery, PDFs open in a tab
});

// Record a portal view. Fires on the authenticated bootstrap load, so it means the
// (email-verified) client actually opened their portal — not a link scanner. Rapid
// repeats/polls within 30 min collapse into a single visit in the log.
function recordPortalVisit(c, req) {
  const now = Date.now();
  const nowIso = new Date().toISOString();
  const pa = c.portalAccess || (c.portalAccess = { firstAt: null, lastAt: null, count: 0, log: [] });
  const lastMs = pa.lastAt ? new Date(pa.lastAt).getTime() : 0;
  if (!pa.firstAt) pa.firstAt = nowIso;
  pa.lastAt = nowIso;
  if (now - lastMs > 30 * 60 * 1000) {
    pa.count = (pa.count || 0) + 1;
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
    pa.log.unshift({ at: nowIso, ip });
    if (pa.log.length > 25) pa.log.length = 25;
  }
  store.save();
}

app.get('/api/portal/:token', (req, res) => {
  const c = portalClient(req, res); if (!c) return;
  // Only count real client visits (verified logins) — not shared view-link opens.
  if (!req.portalReadOnly) recordPortalVisit(c, req);
  res.json(publicClientView(c, { readOnly: req.portalReadOnly }));
});

// Refuse binding actions on a read-only session (view link or additional contact).
function requirePrimary(req, res) {
  if (req.portalReadOnly) { res.status(403).json({ error: 'This is a view-only link — only the main contact can take this action.' }); return false; }
  return true;
}

// Client views their contract PDF from the portal (session-authenticated). Serves
// the signed copy if one has been saved, otherwise the current generated contract.
app.get('/api/portal/:token/contract.pdf', wrap(async (req, res) => {
  const c = portalClient(req, res); if (!c) return;
  const signed = (c.files || []).find(f => f.category === 'Signed Contract');
  if (signed) {
    const p = path.join(UPLOADS_DIR, c.id, signed.storedName);
    if (fs.existsSync(p)) return res.type('application/pdf').sendFile(p);
  }
  const file = await contractPdf.generate(c, { uploadsDir: UPLOADS_DIR });
  res.type('application/pdf').sendFile(file);
}));

// Client finished signing in the portal — confirm with DocuSeal and finalize.
// Lets signing complete even without a public webhook (a status poll).
app.post('/api/portal/:token/contract/signed', wrap(async (req, res) => {
  const c = portalClient(req, res); if (!c) return;
  if (!requirePrimary(req, res)) return;
  if (c.contract.signedAt) return res.json(publicClientView(c));
  if (c.contract.docusealSubmissionId && docuseal.configured(store.data.settings)) {
    try {
      const sub = await docuseal.getSubmission(c.contract.docusealSubmissionId, store.data.settings);
      if (sub.status === 'completed') await processDocusealCompletion(c);
    } catch (e) { /* webhook will finalize if the poll is too early */ }
  }
  res.json(publicClientView(c));
}));

// Client gives final approval to a change order from the portal — this creates
// the invoice and sends the payment request (for a positive charge).
app.post('/api/portal/:token/change-orders/:coId/approve', wrap(async (req, res) => {
  const c = portalClient(req, res); if (!c) return;
  if (!requirePrimary(req, res)) return;
  const co = (c.changeOrders || []).find(co => co.id === req.params.coId);
  if (!co) return res.status(404).json({ error: 'Change order not found' });
  await approveChangeOrder(c, co);
  res.json(publicClientView(c));
}));

// Client declines a change order from the portal.
app.post('/api/portal/:token/change-orders/:coId/decline', (req, res) => {
  const c = portalClient(req, res); if (!c) return;
  if (!requirePrimary(req, res)) return;
  const co = (c.changeOrders || []).find(co => co.id === req.params.coId);
  if (!co) return res.status(404).json({ error: 'Change order not found' });
  if (co.status !== 'approved') {
    co.status = 'declined';
    co.declinedAt = new Date().toISOString();
    store.addAlert(`✕ Client DECLINED change order "${co.description}" (${alerts.fmtMoney(co.value)}). Follow up with them.`, { clientId: c.id, type: 'change' });
    store.save();
  }
  res.json(publicClientView(c));
});

// Client picks their interior (Pebble) finish from the portal. Single selection;
// the admin can still adjust it on the Design tab.
app.post('/api/portal/:token/select-finish', (req, res) => {
  const c = portalClient(req, res); if (!c) return;
  // Interior finish is selectable by anyone with the link (including the view-only
  // share) — it's a design preference, not a binding/contractual action.
  const name = String(req.body.name || '').trim();
  const isChange = !!req.body.isChange;
  const match = store.data.finishes.find(f => f.active && f.name === name);
  if (!match) return res.status(400).json({ error: 'Unknown finish' });
  const prior = c.selectedFinishes[0];
  c.selectedFinishes = [match.name];
  // Reflect the client's pick as the Plaster Color on the Design tab (same field
  // the team edits there), alongside the swatch selection.
  c.contract.plasterColor = match.name;
  // Record that the client (not the admin) made this pick, for the Design tab.
  c.clientFinishChoice = { name: match.name, brand: match.brand, at: new Date().toISOString(), changed: isChange };
  const tierNote = (match.tier && match.tier !== 'Standard') ? ` [${match.tier} — upgrade charge]` : '';
  if (isChange) {
    store.addAlert(`🎨 APPROVAL NEEDED: client CHANGED their interior finish${prior ? ` from "${prior}"` : ''} to "${match.brand} ${match.name}"${tierNote} on the portal. Please review & approve.`, { clientId: c.id, type: 'change' });
  } else {
    store.addAlert(`${c.address}: client confirmed interior finish "${match.brand} ${match.name}"${tierNote} on the portal.`, { clientId: c.id, type: 'info' });
  }
  store.save();
  res.json(publicClientView(c, { readOnly: req.portalReadOnly }));
});

// Client shares their Waterline Tile and Coping preferences from the portal.
// These write the same fields the team manages on the Design → Project Selections
// tab (single source of truth), and are open to the view-only share too.
app.post('/api/portal/:token/design-selections', (req, res) => {
  const c = portalClient(req, res); if (!c) return;
  const changed = [];
  if (req.body.waterlineTile !== undefined) { c.contract.waterlineTile = String(req.body.waterlineTile).trim(); changed.push('waterline tile'); }
  if (req.body.coping !== undefined) { c.contract.coping = String(req.body.coping).trim(); changed.push('coping'); }
  if (changed.length) {
    store.addAlert(`${c.address}: client updated ${changed.join(' & ')} note(s) on the portal — see the Design tab.`, { clientId: c.id, type: 'info' });
    store.save();
  }
  res.json(publicClientView(c, { readOnly: req.portalReadOnly }));
});

// Employee View — public read-only page + its data API (see PUBLIC_PATHS).
app.get('/employee/:token', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'employee.html'));
});
app.get('/api/employee/:token', (req, res) => {
  if (req.params.token !== ensureEmployeeToken()) return res.status(404).json({ error: 'Not found' });
  res.json(employeeData());
});
// Serve an operational file to the Employee View — token-gated, and only for
// whitelisted (non-financial) categories on non-test, non-lost projects.
app.get('/api/employee/:token/files/:clientId/:fileId', (req, res) => {
  if (req.params.token !== ensureEmployeeToken()) return res.status(404).end();
  const c = store.data.clients.find(c => c.id === req.params.clientId && !c.testMode && c.status !== 'lost');
  if (!c) return res.status(404).end();
  const f = (c.files || []).find(f => f.id === req.params.fileId && EMPLOYEE_FILE_CATEGORIES.includes(f.category));
  if (!f) return res.status(404).end();
  res.download(path.join(UPLOADS_DIR, c.id, f.storedName), f.originalName);
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------
// Monday 7:00 AM Central — Pebble Tec accuracy check (emails on differences)
cron.schedule('0 7 * * 1', () => pebble.run({ sendEmail: true }).catch(console.error), { timezone: 'America/Chicago' });
// Every day 7:00 AM Central — due-date digest for phases and tasks, then the
// day-before / morning-of reminders for scheduled events and dated tasks.
cron.schedule('0 7 * * *', () => {
  alerts.dailyDigest().catch(console.error);
  alerts.sendScheduleReminders().catch(console.error);
}, { timezone: 'America/Chicago' });

app.listen(PORT, () => {
  console.log(`\n  Infinity Pools is running →  http://localhost:${PORT}\n`);
  pebble.cacheSwatches().catch(e => console.error('swatch cache:', e.message));
});
