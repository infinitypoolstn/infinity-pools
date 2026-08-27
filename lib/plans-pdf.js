// Plans / Permit Spec Sheet PDF. A clean, price-free document to hand to a plans
// designer or permit office: the project's Scope of Work sections plus the Pool
// Specifications (sizes, features, details). Deliberately excludes all pricing,
// photos/renderings, and disclosures — just what's being built. Reuses the
// contract's buildSpecSections for the spec breakdown.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { buildSpecSections } = require('./contract-pdf');

const BLUE = '#0a5ea8';
const MEDBLUE = '#2f7dc2';
const DARK = '#16324a';
const MID = '#4a6b85';

// Fonts — mirror the contract/estimate: Roboto Condensed when present, else Times.
let DISPLAY = 'Times-Bold', BODY = 'Times-Roman', BOLD = 'Times-Bold', ITALIC = 'Times-Italic';
function loadFonts(doc) {
  const dir = path.join(__dirname, '..', 'public', 'fonts');
  const reg = (name, file) => {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) { try { doc.registerFont(name, p); return true; } catch (e) { /* keep fallback */ } }
    return false;
  };
  if (reg('RC', 'RobotoCondensed-Regular.ttf')) BODY = 'RC';
  if (reg('RC-Bold', 'RobotoCondensed-Bold.ttf')) { BOLD = 'RC-Bold'; DISPLAY = 'RC-Bold'; }
  if (reg('RC-Italic', 'RobotoCondensed-Italic.ttf')) ITALIC = 'RC-Italic';
  for (const n of ['display.ttf', 'display.otf', 'Saltz.ttf', 'Saltz.otf', 'Bruney.ttf', 'Bruney.otf']) {
    if (reg('Display', n)) { DISPLAY = 'Display'; break; }
  }
}

function findLogo() {
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg']) {
    const p = path.join(__dirname, '..', 'public', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// --- Section rendering helpers (copied from contract-pdf; not exported there) ---
function sectionTitle(doc, text, fill = MEDBLUE) {
  if (doc.y > doc.page.height - 110) doc.addPage();
  doc.moveDown(0.3);
  const by = doc.y, h = 22;
  doc.rect(50, by, doc.page.width - 100, h).fill(fill);
  doc.fillColor('#ffffff').font(DISPLAY).fontSize(13).text(text, 60, by + 5, { lineBreak: false, width: doc.page.width - 120 });
  doc.fillColor(DARK).font(BODY).fontSize(10);
  doc.y = by + h + 5;
}
function bullets(doc, items) {
  for (const it of items) {
    const text = typeof it === 'string' ? it : (it && it.text) || '';
    const indent = typeof it === 'string' ? 0 : ((it && it.indent) || 0);
    const bold = typeof it === 'string' ? false : !!(it && it.bold);
    if (doc.y > doc.page.height - 90) doc.addPage();
    const inset = indent * 20;
    doc.font(bold ? BOLD : BODY).fontSize(10).fillColor(DARK)
      .text((indent ? '–  ' : '•  ') + text, 60 + inset, doc.y, { width: doc.page.width - 120 - inset, lineGap: 1 });
    doc.moveDown(0.12);
  }
}
function bulletsHeight(doc, items) {
  doc.font(BODY).fontSize(10);
  const lh = doc.currentLineHeight();
  let h = 0;
  for (const it of items) {
    const text = typeof it === 'string' ? it : (it && it.text) || '';
    const indent = typeof it === 'string' ? 0 : ((it && it.indent) || 0);
    const inset = indent * 20;
    h += doc.heightOfString((indent ? '–  ' : '•  ') + text, { width: doc.page.width - 120 - inset, lineGap: 1 });
    h += lh * 0.12;
  }
  return h;
}
function sectionHeight(doc, items) {
  doc.font(BODY).fontSize(10);
  return doc.currentLineHeight() * 0.3 + 22 + 5 + bulletsHeight(doc, items);
}
function keepTogether(doc, height) {
  const safeBottom = doc.page.height - 70;
  const pageTop = doc.page.margins.top;
  if (doc.y + height > safeBottom && height <= safeBottom - pageTop) doc.addPage();
}

// A plain group heading (e.g. "Scope of Work", "Pool Specifications").
function groupHeading(doc, text) {
  if (doc.y > doc.page.height - 130) doc.addPage();
  doc.moveDown(0.6);
  doc.font(DISPLAY).fontSize(16).fillColor(BLUE).text(text.toUpperCase(), 50, doc.y, { characterSpacing: 1 });
  const y = doc.y + 3;
  doc.moveTo(50, y).lineTo(doc.page.width - 50, y).lineWidth(1).strokeColor(BLUE).stroke();
  doc.y = y + 8;
  doc.fillColor(DARK);
}

/**
 * Generate the Plans / Permit Spec Sheet. Resolves with the absolute file path
 * once written. No pricing, photos, or disclosures.
 */
async function generate(client) {
  const outDir = path.join(__dirname, '..', 'data', 'plans');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${client.id}-plans.pdf`);
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 }, bufferPages: true });
  const stream = fs.createWriteStream(outFile);
  const done = new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outFile));
    stream.on('error', reject);
  });
  doc.pipe(stream);
  loadFonts(doc);

  const M = 50, PW = doc.page.width;
  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });

  // ---------------- Header band ----------------
  doc.rect(0, 0, PW, 92).fill(BLUE);
  const logoPath = findLogo();
  let logoPlaced = false;
  if (logoPath) { try { doc.image(logoPath, M, 20, { height: 52 }); logoPlaced = true; } catch (e) { /* fall back */ } }
  if (!logoPlaced) {
    doc.fillColor('#ffffff').font(DISPLAY).fontSize(22).text('INFINITY POOLS', M, 28, { characterSpacing: 3, lineBreak: false });
  }
  doc.fillColor('#ffffff').font(DISPLAY).fontSize(19)
    .text('PLANS SPEC SHEET', M, 36, { width: PW - 2 * M, align: 'right', characterSpacing: 2, lineBreak: false });
  doc.fillColor(DARK);

  // ---------------- Project block ----------------
  let y = 118;
  doc.font(DISPLAY).fontSize(20).fillColor(DARK).text((client.address || '').toUpperCase(), M, y, { width: PW - 2 * M });
  y = doc.y + 6;
  doc.font(BODY).fontSize(11).fillColor(MID)
    .text('Prepared by ' + (store.data.settings.companyName || 'Infinity Pools'), M, y)
    .text('Date: ' + today, M, doc.y + 2);
  doc.font(ITALIC).fontSize(9.5).fillColor(MID)
    .text('Specifications and scope of work for plan preparation and permitting. Not a contract; no pricing included.', M, doc.y + 6, { width: PW - 2 * M, lineGap: 2 });
  doc.moveDown(0.8);
  doc.fillColor(DARK);

  // ---------------- Scope of Work ----------------
  // Same source and cleaning as the contract, but without the "% Draw" suffix
  // (that's payment-schedule info, not relevant to plans/permitting).
  const scope = client.scope || [];
  if (scope.length) {
    groupHeading(doc, 'Scope of Work');
    const cleanText = t => (t || '').replace(/\s*Color chart attached in proposal\.?/i, '');
    const cleanItem = it => typeof it === 'string'
      ? cleanText(it)
      : { text: cleanText(it && it.text), indent: (it && it.indent) || 0 };
    for (const sec of scope) {
      const items = (sec.items || []).map(cleanItem);
      keepTogether(doc, sectionHeight(doc, items));
      sectionTitle(doc, sec.title);
      bullets(doc, items);
      doc.moveDown(0.35);
    }
  }

  // ---------------- Pool Specifications (no pricing) ----------------
  const specSecs = buildSpecSections(client);
  if (specSecs.length) {
    groupHeading(doc, 'Pool Specifications');
    for (const sec of specSecs) {
      keepTogether(doc, sectionHeight(doc, sec.lines));
      sectionTitle(doc, sec.title); // title only — no money(sec.price)
      if (sec.lines.length) bullets(doc, sec.lines);
    }
  }

  if (!scope.length && !specSecs.length) {
    doc.font(BODY).fontSize(11).fillColor(MID)
      .text('No scope or pool specifications have been entered for this project yet.', M, doc.y + 10, { width: PW - 2 * M });
  }

  // Footer page numbers
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(BODY).fontSize(8).fillColor(MID)
      .text(`— ${i + 1} of ${range.count} —`, 0, doc.page.height - 36, { align: 'center', width: doc.page.width, lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  return done;
}

module.exports = { generate };
