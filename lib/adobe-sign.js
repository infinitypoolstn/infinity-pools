// Adobe Acrobat Sign integration — contract sending and signing detection.
// Auth uses the long-lived Integration Key from:
//   Adobe Sign → Account → Personal Preferences → API Access → Integration Keys
// Docs: https://secure.na1.adobesign.com/public/docs/restapi/v6
const fs = require('fs');
const path = require('path');

function configured(settings) {
  const s = settings.adobeSign;
  return !!(s && s.integrationKey && s.apiBaseUri);
}

function base(settings) {
  return (settings.adobeSign.apiBaseUri || 'https://api.na1.adobesign.com').replace(/\/$/, '');
}

async function call(method, endpoint, body, settings) {
  const url = `${base(settings)}/api/rest/v6${endpoint}`;
  const headers = { 'Authorization': 'Bearer ' + settings.adobeSign.integrationKey };
  let reqBody;
  if (body instanceof FormData) {
    reqBody = body;
  } else if (body) {
    headers['Content-Type'] = 'application/json';
    reqBody = JSON.stringify(body);
  }
  const res = await fetch(url, { method, headers, body: reqBody });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch (e) { json = text; }
  if (!res.ok) {
    const msg = (typeof json === 'object' && (json.message || json.code)) || `HTTP ${res.status}`;
    throw new Error(`Adobe Sign: ${msg}`);
  }
  return json;
}

/** Upload the contract PDF and return a transient document ID (valid 7 days). */
async function uploadDocument(pdfPath, settings) {
  const fileName = path.basename(pdfPath);
  const fileBuffer = fs.readFileSync(pdfPath);
  const form = new FormData();
  form.append('File', new Blob([fileBuffer], { type: 'application/pdf' }), fileName);
  form.append('File-Name', fileName);
  form.append('Mime-Type', 'application/pdf');

  const url = `${base(settings)}/api/rest/v6/transientDocuments`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + settings.adobeSign.integrationKey },
    body: form,
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = {}; }
  if (!res.ok) throw new Error(`Adobe Sign upload: ${json.message || json.code || `HTTP ${res.status}`}`);
  return json.transientDocumentId;
}

/** Create an agreement and email the signing invitation to the client. */
async function createAgreement(client, transientDocId, settings) {
  return call('POST', '/agreements', {
    fileInfos: [{ transientDocumentId: transientDocId }],
    name: `Infinity Pools — ${client.address} Pool Contract`,
    participantSetsInfo: [{
      memberInfos: [{ email: client.email, name: client.name }],
      order: 1,
      role: 'SIGNER',
    }],
    signatureType: 'ESIGN',
    state: 'IN_PROCESS',
    message:
      `Hi ${client.name.split(' ')[0]}, please review and digitally sign your pool construction contract for ` +
      `${client.address}. Fill in your chosen Pebble Tec finish name in the "Interior Finish Selection" ` +
      `box above the signature line before signing.`,
  }, settings);
}

/** Poll for current agreement status. Returns the full agreement object. */
async function getAgreement(agreementId, settings) {
  return call('GET', `/agreements/${agreementId}`, null, settings);
}

/**
 * After signing is complete, retrieve the filled form fields as CSV text.
 * Adobe Sign returns "fieldName,fieldValue\n..." rows.
 */
async function getFormData(agreementId, settings) {
  const url = `${base(settings)}/api/rest/v6/agreements/${agreementId}/formData`;
  const res = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + settings.adobeSign.integrationKey },
  });
  if (!res.ok) return null;
  return res.text(); // CSV
}

/** Parse the "Finish_Selection" value out of the Adobe Sign CSV form data. */
function parseFinishFromFormData(csv) {
  if (!csv) return null;
  const lines = csv.trim().split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return null;

  // CSV may be quoted ("col","val") or bare
  const unquote = s => s.replace(/^"|"$/g, '').trim();
  const headers = lines[0].split(',').map(unquote);
  const values  = lines[1].split(',').map(unquote);

  const idx = headers.findIndex(h => /finish/i.test(h));
  return idx >= 0 && values[idx] ? values[idx] : null;
}

/**
 * Register a webhook so Adobe Sign POSTs to your server when an agreement
 * is signed. Run once; call again only if the webhook URL changes.
 * webhookUrl must be publicly reachable (works on Render/Railway, not localhost).
 */
async function registerWebhook(webhookUrl, settings) {
  return call('POST', '/webhooks', {
    name: 'Infinity Pools — Agreement Signed',
    scope: 'ACCOUNT',
    state: 'ACTIVE',
    webhookSubscriptionEvents: ['AGREEMENT_WORKFLOW_COMPLETE'],
    webhookUrlInfo: { url: webhookUrl },
  }, settings);
}

module.exports = { configured, uploadDocument, createAgreement, getAgreement, getFormData, parseFinishFromFormData, registerWebhook };
