// Gmail sending via nodemailer. Every send (attempted or not) is logged to the
// outbox so nothing silently disappears when Gmail isn't configured yet.
const nodemailer = require('nodemailer');
const store = require('./store');

function configured() {
  const g = store.data.settings.gmail;
  return !!(g && g.user && g.appPassword);
}

function transporter() {
  const g = store.data.settings.gmail;
  return nodemailer.createTransport({
    service: 'gmail',
    auth: { user: g.user, pass: g.appPassword },
  });
}

const BRAND_BLUE = '#0a5ea8';

function wrapHtml(subject, bodyHtml) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f0f6fb;font-family:Segoe UI,Arial,sans-serif;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">
    <div style="background:${BRAND_BLUE};color:#fff;border-radius:12px 12px 0 0;padding:20px 28px;">
      <div style="font-size:22px;font-weight:700;letter-spacing:2px;">&#8734; INFINITY POOLS</div>
    </div>
    <div style="background:#ffffff;border:1px solid #d7e6f2;border-top:0;border-radius:0 0 12px 12px;padding:28px;color:#1c3347;font-size:15px;line-height:1.6;">
      ${bodyHtml}
      <hr style="border:none;border-top:1px solid #e3eef7;margin:24px 0 12px;">
      <div style="color:#6b8aa5;font-size:12px;">Infinity Pools &bull; ${store.data.settings.companyAddress || ''} &bull; ${store.data.settings.companyEmail}</div>
    </div>
  </div></body></html>`;
}

/**
 * Send an email. opts: { to, subject, html, text, attachments, cc }
 * Returns the outbox record.
 */
async function send(opts) {
  const rec = {
    id: store.id(),
    to: Array.isArray(opts.to) ? opts.to.join(', ') : opts.to,
    subject: opts.subject,
    createdAt: new Date().toISOString(),
    status: 'pending', error: null,
  };
  store.data.outbox.unshift(rec);
  if (store.data.outbox.length > 1000) store.data.outbox.length = 1000;

  if (!opts.to || (Array.isArray(opts.to) && !opts.to.length)) {
    rec.status = 'skipped'; rec.error = 'No recipient address'; store.save(); return rec;
  }
  if (!configured()) {
    rec.status = 'queued_no_gmail';
    rec.error = 'Gmail not configured (Settings → Email). Logged only.';
    store.save(); return rec;
  }
  try {
    await transporter().sendMail({
      from: `"${store.data.settings.companyName}" <${store.data.settings.gmail.user}>`,
      to: opts.to, cc: opts.cc,
      subject: opts.subject,
      text: opts.text,
      html: opts.html ? wrapHtml(opts.subject, opts.html) : undefined,
      attachments: opts.attachments,
    });
    rec.status = 'sent';
  } catch (e) {
    rec.status = 'failed'; rec.error = e.message;
    console.error('Email failed:', e.message);
  }
  store.save();
  return rec;
}

function allEmployeeEmails() {
  return store.data.employees.map(e => e.email).filter(Boolean);
}

module.exports = { send, configured, allEmployeeEmails, wrapHtml };
