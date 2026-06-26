// DocuSeal integration — in-portal contract e-signing.
// Auth uses an API key from DocuSeal → Settings → API.
// Docs: https://www.docuseal.com/docs/api
//
// Flow: createTemplateFromPdf (the generated contract PDF, with {{...}} signature
// text tags) → createSubmission with send_email:false (embedded signing) → the
// client signs inside their portal via the <docuseal-form> web component → the
// `form.completed` webhook (or a portal poll) finalizes the contract.
const fs = require('fs');
const path = require('path');

function configured(settings) {
  const s = settings.docuseal;
  return !!(s && s.apiKey);
}

function base(settings) {
  return ((settings.docuseal && settings.docuseal.apiBaseUri) || 'https://api.docuseal.com').replace(/\/$/, '');
}

async function call(method, endpoint, body, settings) {
  const url = base(settings) + endpoint;
  const headers = { 'X-Auth-Token': (settings.docuseal || {}).apiKey || '' };
  let reqBody;
  if (body) { headers['Content-Type'] = 'application/json'; reqBody = JSON.stringify(body); }
  const res = await fetch(url, { method, headers, body: reqBody });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch (e) { json = text; }
  if (!res.ok) {
    const msg = (json && typeof json === 'object' && (json.error || json.message)) || `HTTP ${res.status}`;
    throw new Error('DocuSeal: ' + msg);
  }
  return json;
}

/** Create a template from the contract PDF. The PDF carries {{...}} signature
 *  text tags which DocuSeal converts to fields (and strips). Returns the template. */
async function createTemplateFromPdf(client, pdfPath, settings) {
  const b64 = fs.readFileSync(pdfPath).toString('base64');
  return call('POST', '/templates/pdf', {
    name: `Infinity Pools — ${client.address} Pool Contract`,
    documents: [{ name: path.basename(pdfPath), file: b64 }],
  }, settings);
}

/** Create a submission for embedded (in-portal) signing — no email is sent.
 *  Returns the raw API response (an array of submitters). */
async function createSubmission(client, templateId, settings) {
  return call('POST', '/submissions', {
    template_id: templateId,
    send_email: false,
    submitters: [{ email: client.email, name: client.name, role: 'Client', external_id: client.id }],
  }, settings);
}

/** Normalize the create-submission response to the first submitter's
 *  { submissionId, slug, embedSrc }. */
function firstSubmitter(resp) {
  const arr = Array.isArray(resp) ? resp : (resp.submitters || []);
  const s = arr[0] || {};
  const slug = s.slug || null;
  return {
    submissionId: s.submission_id || (Array.isArray(resp) ? null : resp.id) || null,
    slug,
    embedSrc: s.embed_src || (slug ? 'https://docuseal.com/s/' + slug : null),
  };
}

/** Fetch a submission (status + signed-document URLs) after completion. */
async function getSubmission(submissionId, settings) {
  return call('GET', `/submissions/${submissionId}`, null, settings);
}

/** Pull the signed (combined) PDF URL out of a submission object. */
function signedPdfUrl(submission) {
  if (!submission) return null;
  if (submission.combined_document_url) return submission.combined_document_url;
  const docs = submission.documents || [];
  return (docs[0] && docs[0].url) || null;
}

module.exports = { configured, base, createTemplateFromPdf, createSubmission, firstSubmitter, getSubmission, signedPdfUrl };
