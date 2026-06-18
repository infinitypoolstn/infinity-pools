// QuickBooks Online integration (optional). When connected via an Intuit app's
// OAuth2 credentials + refresh token, the app can create the customer + invoice
// at contract acceptance and generate payment links per phase. When not
// connected, the UI falls back to manually-pasted payment links.
const https = require('https');
const store = require('./store');

function cfg() { return store.data.settings.quickbooks; }
function connected() {
  const q = cfg();
  return !!(q && q.realmId && q.clientId && q.clientSecret && q.refreshToken);
}

function request(method, host, path, headers, bodyStr) {
  return new Promise((resolve, reject) => {
    const req = https.request({ method, host, path, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (e) { /* leave raw */ }
        resolve({ status: res.statusCode, json, raw: data });
      });
    });
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

let accessToken = null;
let accessTokenExp = 0;
let refreshInFlight = null;

// Single-flight: Intuit rotates (and invalidates) the refresh token on each use, so
// two concurrent refreshes with the same token can burn it. Share one in-flight refresh
// among all callers (e.g. the Promise.all in createContractInvoice) to refresh exactly once.
async function getAccessToken() {
  if (accessToken && Date.now() < accessTokenExp - 60000) return accessToken;
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => { refreshInFlight = null; });
  return refreshInFlight;
}

async function doRefresh() {
  const q = cfg();
  const body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(q.refreshToken);
  const auth = Buffer.from(q.clientId + ':' + q.clientSecret).toString('base64');
  const r = await request('POST', 'oauth.platform.intuit.com', '/oauth2/v1/tokens/bearer', {
    'Authorization': 'Basic ' + auth,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  }, body);
  if (r.status !== 200 || !r.json) {
    if (r.json && r.json.error === 'invalid_grant') {
      // Refresh token expired or revoked — clear it so connected() returns false
      q.refreshToken = '';
      store.save();
      throw new Error('QuickBooks authorization has expired or been revoked. Go to Settings → QuickBooks and paste a new Refresh Token to reconnect.');
    }
    throw new Error('QuickBooks token refresh failed: HTTP ' + r.status + ' ' + r.raw.slice(0, 200));
  }
  accessToken = r.json.access_token;
  accessTokenExp = Date.now() + (r.json.expires_in || 3600) * 1000;
  if (r.json.refresh_token && r.json.refresh_token !== q.refreshToken) {
    q.refreshToken = r.json.refresh_token; // Intuit rotates refresh tokens
    store.save();
  }
  return accessToken;
}

function apiHost() { return cfg().environment === 'sandbox' ? 'sandbox-quickbooks.api.intuit.com' : 'quickbooks.api.intuit.com'; }

async function api(method, pathSuffix, payload) {
  const tok = await getAccessToken();
  const body = payload ? JSON.stringify(payload) : null;
  const r = await request(method, apiHost(), `/v3/company/${cfg().realmId}${pathSuffix}`, {
    'Authorization': 'Bearer ' + tok,
    'Accept': 'application/json',
    ...(body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {}),
  }, body);
  if (r.status >= 300) throw new Error('QuickBooks API error HTTP ' + r.status + ': ' + r.raw.slice(0, 300));
  return r.json;
}

/** Find or create the QBO customer for a client record. Returns customer Id. */
async function ensureCustomer(client) {
  const q = `select * from Customer where DisplayName = '${client.name.replace(/'/g, "\\'")}'`;
  const found = await api('GET', '/query?query=' + encodeURIComponent(q));
  if (found.QueryResponse && found.QueryResponse.Customer && found.QueryResponse.Customer.length) {
    return found.QueryResponse.Customer[0].Id;
  }
  const created = await api('POST', '/customer', {
    DisplayName: client.name,
    PrimaryEmailAddr: client.email ? { Address: client.email } : undefined,
    PrimaryPhone: client.phone ? { FreeFormNumber: client.phone } : undefined,
    BillAddr: client.address ? { Line1: client.address } : undefined,
  });
  return created.Customer.Id;
}

let _serviceItemId = null;
/** Find or create the "Pool Construction Services" service item. Returns item Id. */
async function ensureServiceItem() {
  if (_serviceItemId) return _serviceItemId;
  const found = await api('GET', '/query?query=' + encodeURIComponent("select * from Item where Name = 'Pool Construction Services'"));
  if (found.QueryResponse && found.QueryResponse.Item && found.QueryResponse.Item.length) {
    _serviceItemId = found.QueryResponse.Item[0].Id;
    return _serviceItemId;
  }
  // Look up the default income account to attach to the item
  const accts = await api('GET', '/query?query=' + encodeURIComponent("select * from Account where AccountType = 'Income' and Active = true"));
  const incomeAccount = accts.QueryResponse && accts.QueryResponse.Account && accts.QueryResponse.Account[0];
  if (!incomeAccount) throw new Error('No active Income account found in QuickBooks. Please create one and try again.');
  const created = await api('POST', '/item', {
    Name: 'Pool Construction Services',
    Type: 'Service',
    IncomeAccountRef: { value: incomeAccount.Id, name: incomeAccount.Name },
  });
  _serviceItemId = created.Item.Id;
  return _serviceItemId;
}

/**
 * Fetch the invoice's customer-facing shareable pay link (guest pay — no Intuit
 * login required), as opposed to the app.qbo.intuit.com URL which is the merchant
 * dashboard and forces a business login. Returns null if QBO doesn't provide one
 * (e.g. QuickBooks Payments / online payment not yet enabled on the account).
 */
async function getInvoiceShareLink(invoiceId) {
  try {
    const r = await api('GET', `/invoice/${invoiceId}?include=invoiceLink&minorversion=65`);
    return (r && r.Invoice && r.Invoice.InvoiceLink) || null;
  } catch (e) { return null; }
}

/**
 * Create the master invoice for the full contract amount at acceptance.
 * Phase draws are then collected as partial payments against this invoice.
 */
async function createContractInvoice(client, total) {
  const [customerId, itemId] = await Promise.all([ensureCustomer(client), ensureServiceItem()]);
  const inv = await api('POST', '/invoice', {
    CustomerRef: { value: customerId },
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: true,
    BillEmail: client.email ? { Address: client.email } : undefined,
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: total,
      Description: `In-ground pool construction — ${client.address}. Per signed contract; collected in phase draws per the Budget & Timeline schedule.`,
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: total },
    }],
  });
  const invoice = inv.Invoice;
  client.quickbooks.invoiceId = invoice.Id;
  client.quickbooks.invoiceUrl = `https://app.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`; // merchant view (needs QBO login)
  client.quickbooks.payLink = await getInvoiceShareLink(invoice.Id); // customer guest-pay link
  store.save();
  return invoice;
}

/**
 * Create the master Estimate for the full contract total at signing. This is the
 * "complete total" record; each phase draw is billed as a progress invoice against
 * it (see createDrawInvoice). Requires Progress Invoicing enabled in QuickBooks.
 */
async function createContractEstimate(client, total) {
  const [customerId, itemId] = await Promise.all([ensureCustomer(client), ensureServiceItem()]);
  const est = await api('POST', '/estimate', {
    CustomerRef: { value: customerId },
    BillEmail: client.email ? { Address: client.email } : undefined,
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: total,
      Description: `In-ground pool construction — ${client.address}. Full contract total; billed in phase draws per the Budget & Timeline schedule.`,
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: total },
    }],
  });
  const estimate = est.Estimate;
  client.quickbooks.estimateId = estimate.Id;
  client.quickbooks.estimateUrl = `https://app.qbo.intuit.com/app/estimate?txnId=${estimate.Id}`;
  store.save();
  return estimate;
}

/**
 * Bill a single phase draw as a progress invoice for that draw's exact amount,
 * linked to the master estimate so it rolls up against the contract total. Stores
 * the per-phase invoice id + guest-pay link on the phase. Falls back to a standalone
 * (unlinked) invoice if no estimate exists yet, so the draw is still billed correctly.
 */
async function createDrawInvoice(client, phase, amount) {
  const [customerId, itemId] = await Promise.all([ensureCustomer(client), ensureServiceItem()]);
  const base = {
    CustomerRef: { value: customerId },
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: true,
    BillEmail: client.email ? { Address: client.email } : undefined,
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: amount,
      Description: `${phase.name} draw (${phase.drawPct}% of contract) — ${client.address}.`,
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: amount },
    }],
  };
  let inv;
  if (client.quickbooks.estimateId) {
    try {
      inv = await api('POST', '/invoice', { ...base, LinkedTxn: [{ TxnId: client.quickbooks.estimateId, TxnType: 'Estimate' }] });
    } catch (e) {
      // Linking failed (commonly: Progress Invoicing not enabled in QBO). Still bill the
      // correct draw amount as a standalone invoice so the client can pay; log why it wasn't linked.
      store.addError('POST', `draw-invoice-link/${client.id}/${phase.key}`, e.message, e.stack);
      inv = await api('POST', '/invoice', base);
    }
  } else {
    inv = await api('POST', '/invoice', base);
  }
  const invoice = inv.Invoice;
  phase.qbInvoiceId = invoice.Id;
  phase.qbInvoiceUrl = `https://app.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`; // merchant view (needs QBO login)
  phase.payLink = await getInvoiceShareLink(invoice.Id); // customer guest-pay link
  store.save();
  return invoice;
}

/** Email the QBO invoice (with its Pay Now link) to the client via QuickBooks. */
async function sendInvoice(client) {
  if (!client.quickbooks.invoiceId) throw new Error('No QuickBooks invoice on file for this client');
  return api('POST', `/invoice/${client.quickbooks.invoiceId}/send?sendTo=${encodeURIComponent(client.email)}`);
}

/** Create a QBO invoice for a change order. Does NOT send — call sendInvoiceById to deliver. */
async function createChangeOrderInvoice(client, changeOrder) {
  const [customerId, itemId] = await Promise.all([ensureCustomer(client), ensureServiceItem()]);
  const inv = await api('POST', '/invoice', {
    CustomerRef: { value: customerId },
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: true,
    BillEmail: client.email ? { Address: client.email } : undefined,
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: changeOrder.value,
      Description: `Change order — ${client.address}: ${changeOrder.description}`,
      SalesItemLineDetail: { ItemRef: { value: itemId }, Qty: 1, UnitPrice: changeOrder.value },
    }],
  });
  const invoice = inv.Invoice;
  changeOrder.qbInvoiceId = invoice.Id;
  changeOrder.qbInvoiceUrl = `https://app.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`; // merchant view (needs QBO login)
  changeOrder.qbPayLink = await getInvoiceShareLink(invoice.Id); // customer guest-pay link
  return invoice;
}

/** Send any QBO invoice by ID to the client's email address. */
async function sendInvoiceById(client, invoiceId) {
  if (!client.email) throw new Error('Client has no email address on file');
  return api('POST', `/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(client.email)}`);
}

/**
 * Validate the saved credentials WITHOUT clearing the refresh token on failure,
 * so the Settings "Test Connection" button can be retried without re-pasting.
 * Returns { ok, companyName?, error? } and never throws for credential problems.
 */
async function testConnection() {
  const q = cfg();
  if (!q || !q.clientId || !q.clientSecret) return { ok: false, error: 'Enter a Client ID and Client Secret first.' };
  if (!q.refreshToken) return { ok: false, error: 'Enter a Refresh Token first.' };
  if (!q.realmId) return { ok: false, error: 'Enter a Realm ID (Company ID) first.' };

  // Refresh inline (not via getAccessToken) so a failure does NOT clear the token.
  const body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(q.refreshToken);
  const auth = Buffer.from(q.clientId + ':' + q.clientSecret).toString('base64');
  const r = await request('POST', 'oauth.platform.intuit.com', '/oauth2/v1/tokens/bearer', {
    'Authorization': 'Basic ' + auth,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  }, body);
  if (r.status !== 200 || !r.json) {
    const code = r.json && r.json.error;
    if (code === 'invalid_client') return { ok: false, error: 'Client ID or Secret rejected (invalid_client). Confirm they match your Intuit app exactly and the Environment is correct. Your token was NOT cleared.' };
    if (code === 'invalid_grant') return { ok: false, error: 'Refresh token rejected (invalid_grant). Generate a fresh token using the SAME Client ID/Secret + environment, and paste it without "refreshing" it in the Playground first. Your token was NOT cleared.' };
    return { ok: false, error: 'Token refresh failed: HTTP ' + r.status + ' ' + r.raw.slice(0, 200) };
  }
  // Success — cache the access token and persist any rotated refresh token.
  accessToken = r.json.access_token;
  accessTokenExp = Date.now() + (r.json.expires_in || 3600) * 1000;
  if (r.json.refresh_token && r.json.refresh_token !== q.refreshToken) {
    q.refreshToken = r.json.refresh_token; // Intuit rotates refresh tokens
    store.save();
  }
  // Confirm realm + API access with a lightweight CompanyInfo read.
  try {
    const info = await api('GET', '/companyinfo/' + q.realmId);
    const name = info && info.CompanyInfo && info.CompanyInfo.CompanyName;
    return { ok: true, companyName: name || null };
  } catch (e) {
    return { ok: false, error: 'Token is valid, but the API call failed — check the Realm ID matches the authorized company. (' + e.message + ')' };
  }
}

module.exports = { connected, createContractInvoice, createContractEstimate, createDrawInvoice, sendInvoice, createChangeOrderInvoice, sendInvoiceById, ensureCustomer, testConnection };
