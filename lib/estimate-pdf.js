// Estimate PDF generator. A lightweight, customer-facing price estimate sent
// BEFORE the contract: a branded header, a priced line-item table built from the
// project's Finance items (the same source as the quote total), the total, and an
// "estimate only — not a contract" note. No renderings, scope, draw schedule, or
// signature block — that's the contract's job (see lib/contract-pdf.js).
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const store = require('./store');

const BLUE = '#0a5ea8';
const DARK = '#16324a';
const LIGHT = '#eaf4fc';
const MID = '#4a6b85';

const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Fonts — mirror the contract: Roboto Condensed when its TTFs are present in
// /public/fonts, otherwise the built-in Times faces.
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

/**
 * Generate the estimate PDF. Resolves with the absolute file path once the file
 * is fully written to disk.
 */
async function generate(client) {
  const outDir = path.join(__dirname, '..', 'data', 'estimates');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${client.id}-estimate.pdf`);
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
  const items = (client.finance && client.finance.items) || [];
  const total = store.quoteTotal(client);

  // ---------------- Header band ----------------
  doc.rect(0, 0, PW, 92).fill(BLUE);
  const logoPath = findLogo();
  let logoPlaced = false;
  if (logoPath) { try { doc.image(logoPath, M, 20, { height: 52 }); logoPlaced = true; } catch (e) { /* fall back */ } }
  if (!logoPlaced) {
    doc.fillColor('#ffffff').font(DISPLAY).fontSize(22).text('INFINITY POOLS', M, 28, { characterSpacing: 3, lineBreak: false });
  }
  doc.fillColor('#ffffff').font(DISPLAY).fontSize(24)
    .text('ESTIMATE', M, 32, { width: PW - 2 * M, align: 'right', characterSpacing: 2, lineBreak: false });
  doc.fillColor(DARK);

  // ---------------- Project / prepared-for block ----------------
  let y = 118;
  doc.font(DISPLAY).fontSize(20).fillColor(DARK).text(client.address.toUpperCase(), M, y, { width: PW - 2 * M });
  y = doc.y + 6;
  doc.font(BODY).fontSize(11).fillColor(MID)
    .text('Prepared for ' + client.name, M, y)
    .text('Prepared by ' + (store.data.settings.companyName || 'Infinity Pools'), M, doc.y + 2)
    .text('Date: ' + today, M, doc.y + 2);
  doc.moveDown(1.2);

  // ---------------- Line-item table ----------------
  const tableX = M, tableW = PW - 2 * M;
  const amtW = 130;               // right column width
  const descW = tableW - amtW;
  const rowH = 30;
  let ty = doc.y + 4;

  // Header row
  doc.rect(tableX, ty, tableW, rowH).fill(BLUE);
  doc.fillColor('#ffffff').font(BOLD).fontSize(12);
  doc.text('Description', tableX + 14, ty + 9, { width: descW - 20, lineBreak: false });
  doc.text('Amount', tableX + descW, ty + 9, { width: amtW - 14, align: 'right', lineBreak: false });
  ty += rowH;

  if (!items.length) {
    doc.rect(tableX, ty, tableW, rowH).fill(LIGHT);
    doc.fillColor(MID).font(ITALIC).fontSize(11)
      .text('No priced line items yet — enter Pool Specs pricing to populate this estimate.', tableX + 14, ty + 9, { width: tableW - 28, lineBreak: false });
    ty += rowH;
  }

  items.forEach((it, i) => {
    if (ty + rowH > doc.page.height - 120) { doc.addPage(); ty = 60; }
    if (i % 2 === 0) doc.rect(tableX, ty, tableW, rowH).fill(LIGHT);
    doc.fillColor(DARK).font(BODY).fontSize(11);
    doc.text(it.label || '—', tableX + 14, ty + 9, { width: descW - 20, lineBreak: false });
    doc.font(BODY).text(money(it.amount), tableX + descW, ty + 9, { width: amtW - 14, align: 'right', lineBreak: false });
    ty += rowH;
  });

  // Total row
  if (ty + rowH + 8 > doc.page.height - 120) { doc.addPage(); ty = 60; }
  ty += 4;
  doc.rect(tableX, ty, tableW, rowH + 6).fill(DARK);
  doc.fillColor('#ffffff').font(BOLD).fontSize(14);
  doc.text('ESTIMATE TOTAL', tableX + 14, ty + 11, { width: descW - 20, lineBreak: false });
  doc.text(money(total), tableX + descW, ty + 11, { width: amtW - 14, align: 'right', lineBreak: false });
  ty += rowH + 6 + 20;

  // ---------------- Estimate disclaimer ----------------
  doc.y = ty;
  doc.font(ITALIC).fontSize(9.5).fillColor(MID).text(
    'This is a preliminary estimate only and does not constitute a contract or a binding offer. ' +
    'Pricing is based on the current Pool Specs and is subject to change following final site evaluation, ' +
    'permitting, and selections. A formal proposal and contract will follow for your review and signature.',
    M, doc.y, { width: PW - 2 * M, lineGap: 3 });

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
