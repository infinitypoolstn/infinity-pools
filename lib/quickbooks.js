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

async function getAccessToken() {
  const q = cfg();
  if (accessToken && Date.now() < accessTokenExp - 60000) return accessToken;
  const body = 'grant_type=refresh_token&refresh_token=' + encodeURIComponent(q.refreshToken);
  const auth = Buffer.from(q.clientId + ':' + q.clientSecret).toString('base64');
  const r = await request('POST', 'oauth.platform.intuit.com', '/oauth2/v1/tokens/bearer', {
    'Authorization': 'Basic ' + auth,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Accept': 'application/json',
    'Content-Length': Buffer.byteLength(body),
  }, body);
  if (r.status !== 200 || !r.json) throw new Error('QuickBooks token refresh failed: HTTP ' + r.status + ' ' + r.raw.slice(0, 200));
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

/**
 * Create the master invoice for the full contract amount at acceptance.
 * Phase draws are then collected as partial payments against this invoice.
 */
async function createContractInvoice(client, total) {
  const customerId = await ensureCustomer(client);
  const inv = await api('POST', '/invoice', {
    CustomerRef: { value: customerId },
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: true,
    BillEmail: client.email ? { Address: client.email } : undefined,
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: total,
      Description: `In-ground pool construction — ${client.address}. Per signed contract; collected in phase draws per the Budget & Timeline schedule.`,
      SalesItemLineDetail: { ItemRef: { value: '1' }, Qty: 1, UnitPrice: total },
    }],
  });
  const invoice = inv.Invoice;
  client.quickbooks.invoiceId = invoice.Id;
  client.quickbooks.invoiceUrl = `https://app.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`;
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
  const customerId = await ensureCustomer(client);
  const inv = await api('POST', '/invoice', {
    CustomerRef: { value: customerId },
    AllowOnlineACHPayment: true,
    AllowOnlineCreditCardPayment: true,
    BillEmail: client.email ? { Address: client.email } : undefined,
    Line: [{
      DetailType: 'SalesItemLineDetail',
      Amount: changeOrder.value,
      Description: `Change order — ${client.address}: ${changeOrder.description}`,
      SalesItemLineDetail: { ItemRef: { value: '1' }, Qty: 1, UnitPrice: changeOrder.value },
    }],
  });
  const invoice = inv.Invoice;
  changeOrder.qbInvoiceId = invoice.Id;
  changeOrder.qbInvoiceUrl = `https://app.qbo.intuit.com/app/invoice?txnId=${invoice.Id}`;
  return invoice;
}

/** Send any QBO invoice by ID to the client's email address. */
async function sendInvoiceById(client, invoiceId) {
  if (!client.email) throw new Error('Client has no email address on file');
  return api('POST', `/invoice/${invoiceId}/send?sendTo=${encodeURIComponent(client.email)}`);
}

module.exports = { connected, createContractInvoice, sendInvoice, createChangeOrderInvoice, sendInvoiceById, ensureCustomer };
