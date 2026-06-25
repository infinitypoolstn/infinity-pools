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
const quickbooks = require('./lib/quickbooks');
const adobeSign = require('./lib/adobe-sign');
const { extractInvoiceTotal } = require('./lib/invoice-amount');

const PORT = process.env.PORT || 4525;
const UPLOADS_DIR = process.env.UPLOADS_DIR ? path.resolve(process.env.UPLOADS_DIR) : path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

store.load();

const app = express();

// Basic Auth — protects all routes except the client portal and Adobe Sign webhooks.
// Set APP_USER and APP_PASS environment variables. Defaults allow local dev without credentials.
const APP_USER = process.env.APP_USER || '';
const APP_PASS = process.env.APP_PASS || '';
if (APP_USER && APP_PASS) {
  // Public (no Basic Auth): health check, client portal + its API, Adobe Sign webhooks,
  // and the finish swatch images the portal displays. /uploads (contracts, invoices) stays protected.
  const PUBLIC_PATHS = ['/healthz', '/portal/', '/api/portal/', '/api/webhooks/adobe-sign', '/swatches/'];
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

// Strip internal-only data before anything client-facing is built from a record.
function publicClientView(c) {
  const quote = store.quoteTotal(c);
  return {
    name: c.name, address: c.address,
    status: c.status,
    phases: c.phases.map(p => ({
      key: p.key, name: p.name, drawPct: p.drawPct, time: p.time, status: p.status,
      dueDate: p.dueDate, completedAt: p.completedAt,
      amountDue: store.phaseAmount(c, p),
      paymentRequestedAt: p.paymentRequestedAt, paymentReceivedAt: p.paymentReceivedAt,
      paymentLink: p.paymentLink || p.payLink || '',
      clientSummary: (store.data.settings.phaseTemplate.find(t => t.key === p.key) || {}).clientSummary || '',
      clientLabel: (store.data.settings.phaseTemplate.find(t => t.key === p.key) || {}).clientLabel || p.name,
    })),
    selectedFinishes: (c.selectedFinishes || []).map(name => {
      const f = store.data.finishes.find(f => f.name === name || (f.brand + ' ' + f.name) === name);
      return f ? { name: f.name, brand: f.brand, image: f.localImage || f.imageUrl, color: f.color } : { name };
    }),
    clientTodos: (c.clientTodos || []).filter(t => !t.done),
    contractSigned: !!c.contract.signedAt,
    quoteTotal: quote,
    changeOrderTotal: store.changeOrderTotal(c),
    collected: store.collected(c),
    feeNotes: store.data.settings.quickbooks.passFeesToClient
      ? [store.data.settings.quickbooks.achFeeNote, store.data.settings.quickbooks.ccFeeNote] : [],
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
  res.json({
    settings: d.settings,
    marketRates: readMarketRates(),
    employees: d.employees,
    contractors: d.contractors,
    tasks: d.tasks,
    alerts: d.alerts.slice(0, 100),
    finishes: d.finishes,
    pebbleCheck: d.pebbleCheck,
    outbox: d.outbox.slice(0, 50),
    errorLog: (d.errorLog || []).slice(0, 100),
    gmailConfigured: mailer.configured(),
    quickbooksConnected: quickbooks.connected(),
    adobeSignConfigured: adobeSign.configured(store.data.settings),
    clients: d.clients.map(c => ({
      ...c,
      _quote: store.quoteTotal(c),
      _coTotal: store.changeOrderTotal(c),
      _costs: store.costTotal(c),
      _collected: store.collected(c),
      _currentPhase: store.currentPhase(c),
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
  for (const k of ['name', 'address', 'email', 'phone', 'status', 'scope', 'notes', 'selectedFinishes', 'clientTodos']) {
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
// Contract lifecycle
// ---------------------------------------------------------------------------
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
      <p>We'll follow up with a request for your digital signature through Adobe Acrobat Sign. When you sign, you'll also be able to confirm your interior finish color selections right on the signing form.</p>
      <p>Once signed, your project moves into the Design phase and we'll send your first invoice through QuickBooks.</p>
      <p>Questions? Just reply to this email.</p><p>— Infinity Pools</p>`,
    attachments: [{ filename: `${c.address} - Infinity Pools Contract.pdf`, path: file }],
  });
  c.contract.sentAt = new Date().toISOString();
  if (c.status === 'prospect') c.status = 'contract_sent';
  store.addAlert(`Contract emailed to ${c.name} (${c.address})`, { clientId: c.id });
  store.save();
  res.json({ client: c, email: rec });
}));

// Accept/sign: works for Adobe-signed and paper. Locks specs + pricing, starts
// Design phase, sends design draw payment request, creates QBO invoice if connected.
app.post('/api/clients/:id/contract/mark-signed', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  const { method = 'adobe', depositMethod = null } = req.body; // method: adobe|paper, depositMethod: check|cash|null
  c.contract.signedAt = new Date().toISOString();
  c.contract.signedMethod = method;
  c.contract.depositMethod = depositMethod;
  c.specsLocked = true;
  c.status = 'active';

  const design = c.phases[0];
  design.status = 'active';
  design.startedAt = new Date().toISOString();
  if (!design.dueDate) {
    const d = new Date(); d.setDate(d.getDate() + 7);
    design.dueDate = d.toISOString().slice(0, 10);
  }

  let qb = null, qbError = null;
  if (quickbooks.connected()) {
    try { qb = await quickbooks.createContractEstimate(c, store.quoteTotal(c)); }
    catch (e) { qbError = e.message; store.addAlert('QuickBooks estimate creation failed for ' + c.address + ': ' + e.message, { clientId: c.id, type: 'error' }); }
  }

  store.addAlert(`🎉 Contract SIGNED (${method}${depositMethod ? ', deposit by ' + depositMethod : ''}): ${c.name} — ${c.address}. Design phase started.`, { clientId: c.id, type: 'phase' });

  if (depositMethod) {
    // deposit already collected in person
    design.paymentReceivedAt = new Date().toISOString();
    design.paymentMethod = depositMethod;
  } else if (c.email && design.drawPct > 0) {
    await alerts.sendPaymentRequest(c, design);
  }

  // Auto-create the Design phase task workflow
  await alerts.spawnPhaseTasks(c, design);

  const emails = mailer.allEmployeeEmails();
  if (emails.length) {
    await mailer.send({
      to: emails,
      subject: `Contract signed — ${c.address}`,
      html: `<p><b>${c.name}</b> signed the contract for <b>${c.address}</b> (${alerts.fmtMoney(store.quoteTotal(c))}).</p><p>The project is now in the <b>Design Finalization</b> phase.</p>`,
    });
  }
  store.save();
  res.json({ client: c, quickbooksInvoice: qb, quickbooksError: qbError });
}));

// ---------------------------------------------------------------------------
// Adobe Acrobat Sign
// ---------------------------------------------------------------------------

// Shared helper: runs the full "contract signed" flow after Adobe Sign reports SIGNED.
async function processAdobeSigning(c, agreementId) {
  const csv = await adobeSign.getFormData(agreementId, store.data.settings);
  const finish = adobeSign.parseFinishFromFormData(csv);
  if (finish) {
    c.contract.adobeFinishSelection = finish;
    if (!c.selectedFinishes.includes(finish)) c.selectedFinishes.push(finish);
  }
  c.contract.adobeStatus = 'SIGNED';
  c.contract.signedAt = new Date().toISOString();
  c.contract.signedMethod = 'adobe';
  c.specsLocked = true;
  c.status = 'active';
  const design = c.phases[0];
  design.status = 'active';
  design.startedAt = new Date().toISOString();
  if (!design.dueDate) {
    const d = new Date(); d.setDate(d.getDate() + 7);
    design.dueDate = d.toISOString().slice(0, 10);
  }
  let qbError = null;
  if (quickbooks.connected()) {
    try { await quickbooks.createContractEstimate(c, store.quoteTotal(c)); }
    catch (e) { qbError = e.message; store.addAlert('QuickBooks estimate creation failed for ' + c.address + ': ' + e.message, { clientId: c.id, type: 'error' }); }
  }
  store.addAlert(`🎉 Contract SIGNED via Adobe Sign: ${c.name} — ${c.address}. Design phase started.${finish ? ' Finish: ' + finish : ''}`, { clientId: c.id, type: 'phase' });
  if (c.email && design.drawPct > 0) await alerts.sendPaymentRequest(c, design);
  await alerts.spawnPhaseTasks(c, design);
  const emails = mailer.allEmployeeEmails();
  if (emails.length) {
    await mailer.send({
      to: emails,
      subject: `Contract signed — ${c.address}`,
      html: `<p><b>${c.name}</b> signed the contract for <b>${c.address}</b> via Adobe Sign (${alerts.fmtMoney(store.quoteTotal(c))}).</p>${finish ? `<p>Pebble Tec finish selection: <b>${finish}</b></p>` : ''}<p>Project is now in <b>Design Finalization</b>.</p>`,
    });
  }
  store.save();
  return { finish, qbError };
}

// Generate PDF and send to client via Adobe Sign for e-signature.
app.post('/api/clients/:id/contract/adobe-send', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (!c.email) return res.status(400).json({ error: 'Client has no email address on file' });
  if (!adobeSign.configured(store.data.settings)) return res.status(400).json({ error: 'Adobe Sign is not configured — add your Integration Key in Settings' });
  const pdfPath = await contractPdf.generate(c, { uploadsDir: UPLOADS_DIR });
  const transientDocId = await adobeSign.uploadDocument(pdfPath, store.data.settings);
  const agreement = await adobeSign.createAgreement(c, transientDocId, store.data.settings);
  c.contract.adobeAgreementId = agreement.id;
  c.contract.adobeStatus = 'IN_PROCESS';
  c.contract.adobeSentAt = new Date().toISOString();
  if (c.status === 'prospect') c.status = 'contract_sent';
  store.addAlert(`Contract sent via Adobe Sign to ${c.name} (${c.email})`, { clientId: c.id });
  store.save();
  res.json({ client: c, agreementId: agreement.id });
}));

// Poll Adobe Sign for current status; auto-process if signed.
app.post('/api/clients/:id/contract/check-adobe-status', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (!c.contract.adobeAgreementId) return res.status(400).json({ error: 'No Adobe Sign agreement found for this client' });
  if (!adobeSign.configured(store.data.settings)) return res.status(400).json({ error: 'Adobe Sign is not configured' });
  const agreement = await adobeSign.getAgreement(c.contract.adobeAgreementId, store.data.settings);
  c.contract.adobeStatus = agreement.status;
  if (agreement.status === 'SIGNED' && !c.contract.signedAt) {
    const { finish, qbError } = await processAdobeSigning(c, c.contract.adobeAgreementId);
    return res.json({ client: c, status: 'SIGNED', finishSelection: finish, quickbooksError: qbError });
  }
  store.save();
  res.json({ client: c, status: agreement.status });
}));

// Webhook verification — Adobe Sign sends a GET first to confirm the endpoint is live.
app.get('/api/webhooks/adobe-sign', (req, res) => res.json({ ok: true }));

// Webhook event — Adobe Sign POSTs here on AGREEMENT_WORKFLOW_COMPLETE.
// Requires a publicly accessible URL (works on Render/Railway; not reachable at localhost).
app.post('/api/webhooks/adobe-sign', wrap(async (req, res) => {
  res.json({ ok: true }); // acknowledge immediately; process async
  const event = req.body;
  if (!event || event.event !== 'AGREEMENT_WORKFLOW_COMPLETE') return;
  const agreementId = event.agreementId;
  if (!agreementId) return;
  const c = store.data.clients.find(c => c.contract.adobeAgreementId === agreementId);
  if (!c || c.contract.signedAt) return; // unknown or already processed
  try {
    await processAdobeSigning(c, agreementId);
  } catch (e) {
    store.addAlert('Adobe Sign webhook error: ' + e.message, { type: 'error' });
    store.save();
    console.error('Adobe Sign webhook:', e);
  }
}));

// Test Adobe Sign credentials.
app.post('/api/settings/adobe-sign/test', wrap(async (req, res) => {
  if (!adobeSign.configured(store.data.settings)) return res.status(400).json({ error: 'Adobe Sign credentials not saved yet' });
  const url = store.data.settings.adobeSign.apiBaseUri.replace(/\/$/, '') + '/api/rest/v6/baseUris';
  const r = await fetch(url, { headers: { 'Authorization': 'Bearer ' + store.data.settings.adobeSign.integrationKey } });
  const text = await r.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = {}; }
  if (!r.ok) return res.status(400).json({ error: json.message || json.code || `HTTP ${r.status} — check your Integration Key and API URL` });
  res.json({ ok: true, apiAccessPoint: json.apiAccessPoint });
}));

// Register an Adobe Sign webhook pointing to this server (requires public URL).
app.post('/api/settings/adobe-sign/register-webhook', wrap(async (req, res) => {
  if (!adobeSign.configured(store.data.settings)) return res.status(400).json({ error: 'Adobe Sign credentials not saved yet' });
  const webhookUrl = `${req.protocol}://${req.get('host')}/api/webhooks/adobe-sign`;
  const result = await adobeSign.registerWebhook(webhookUrl, store.data.settings);
  res.json({ ok: true, webhookUrl, result });
}));

// Validate QuickBooks credentials without clearing the token on failure.
app.post('/api/settings/quickbooks/test', wrap(async (req, res) => {
  res.json(await quickbooks.testConnection());
}));

// ---------------------------------------------------------------------------
// Manually create QB customer + master estimate when auto-creation failed at signing.
app.post('/api/clients/:id/quickbooks/create-invoice', wrap(async (req, res) => {
  const c = getClient(req, res); if (!c) return;
  if (!c.contract.signedAt) return res.status(400).json({ error: 'Contract has not been signed yet.' });
  if (!quickbooks.connected()) return res.status(400).json({ error: 'QuickBooks is not connected.' });
  if (c.quickbooks.estimateId) return res.status(400).json({ error: 'A QuickBooks estimate already exists for this client.' });
  await quickbooks.createContractEstimate(c, store.quoteTotal(c));
  store.save();
  res.json({ client: c });
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
    qbInvoiceId: null, qbInvoiceUrl: null,
  };
  if (!co.description) return res.status(400).json({ error: 'Change description is required' });
  c.changeOrders.push(co);
  store.addAlert(`${c.address}: change order added — "${co.description}" (${alerts.fmtMoney(co.value)})`, { clientId: c.id, type: 'change' });
  let qbError = null;
  if (quickbooks.connected() && co.value !== 0) {
    try { await quickbooks.createChangeOrderInvoice(c, co); }
    catch (e) { qbError = e.message; store.addAlert('QuickBooks CO invoice failed: ' + e.message, { clientId: c.id, type: 'error' }); }
  }
  store.save();
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
      c.costs.items.push({ id: store.id(), label, category: INVOICE_COST_CATEGORY[category], amount, fileId: rec.id });
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
  if (!c.email) return res.status(400).json({ error: 'Client has no email address on file' });
  const portalUrl = `${req.protocol}://${req.get('host')}/portal/${c.portalToken}`;
  await mailer.send({
    to: c.email,
    subject: `Your Infinity Pools project page — ${c.address}`,
    html: `<p>Hi ${c.name.split(' ')[0]},</p>
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
  c.contract.portalLinkSentAt = new Date().toISOString();
  store.addAlert(`Portal link emailed to ${c.name} (${c.email})`, { clientId: c.id });
  store.save();
  res.json({ ok: true });
}));

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

app.post('/api/portal/:token/verify', (req, res) => {
  const c = store.data.clients.find(c => c.portalToken === req.params.token);
  if (!c) return res.status(404).json({ error: 'Project not found' });
  const submitted = String(req.body.email || '').trim().toLowerCase();
  if (!submitted || submitted !== (c.email || '').trim().toLowerCase()) {
    return res.status(401).json({ error: 'Email address not recognized for this project. Please double-check and try again.' });
  }
  prunePortalSessions();
  const sessionId = crypto.randomBytes(32).toString('hex');
  portalSessions.set(sessionId, { portalToken: req.params.token, expires: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  res.json({ sessionId });
});

app.get('/api/portal/:token', (req, res) => {
  const c = store.data.clients.find(c => c.portalToken === req.params.token);
  if (!c) return res.status(404).json({ error: 'Project not found' });
  const sessionId = req.headers['x-portal-session'];
  const session = sessionId && portalSessions.get(sessionId);
  if (!session || session.portalToken !== req.params.token || session.expires < Date.now()) {
    return res.status(401).json({ error: 'verify' });
  }
  res.json(publicClientView(c));
});

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ---------------------------------------------------------------------------
// Schedules
// ---------------------------------------------------------------------------
// Monday 7:00 AM Central — Pebble Tec accuracy check (emails on differences)
cron.schedule('0 7 * * 1', () => pebble.run({ sendEmail: true }).catch(console.error), { timezone: 'America/Chicago' });
// Every day 7:00 AM Central — due-date digest for phases and tasks
cron.schedule('0 7 * * *', () => alerts.dailyDigest().catch(console.error), { timezone: 'America/Chicago' });

app.listen(PORT, () => {
  console.log(`\n  Infinity Pools is running →  http://localhost:${PORT}\n`);
  pebble.cacheSwatches().catch(e => console.error('swatch cache:', e.message));
});
