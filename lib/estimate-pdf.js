// Estimate PDF generator. A lightweight, customer-facing price estimate sent
// BEFORE the contract: a branded header, a priced Pool Specs breakdown (each
// section with its detail lines — Shape, Size, Depth, Jets, LED, etc. — reusing
// the contract's buildSpecSections), the total, and an "estimate only — not a
// contract" note. No renderings, scope, draw schedule, or signature block —
// that's the contract's job (see lib/contract-pdf.js).
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const { buildSpecSections } = require('./contract-pdf');

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
  // Priced rows are the quote itself (client.finance.items) so they always sum to
  // the total. Each row is annotated with the matching Pool Specs section's detail
  // lines (Shape, Size, Jets, LED, …) when one exists — finance labels and
  // spec-section titles share the same names (store.specsToFinance vs contract
  // buildSpecSections), so they line up. Rows priced directly in the Finance tab
  // (e.g. Excavation, Labor) simply carry no spec details.
  const items = (client.finance && client.finance.items) || [];
  const detailByTitle = Object.fromEntries(buildSpecSections(client).map(s => [s.title, s.lines || []]));
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

  // ---------------- Priced Pool Specs breakdown ----------------
  const tableX = M, tableW = PW - 2 * M;
  const amtW = 130;               // right column width
  const descW = tableW - amtW;
  const titleRowH = 26;           // height of a section's title/price row
  const detailX = tableX + 26;    // left inset for the detail lines
  const detailW = descW - 30;     // detail text stays within the description column
  let ty = doc.y + 4;

  const ensure = h => { if (ty + h > doc.page.height - 120) { doc.addPage(); ty = 60; } };

  // Header row
  doc.rect(tableX, ty, tableW, titleRowH).fill(BLUE);
  doc.fillColor('#ffffff').font(BOLD).fontSize(12);
  doc.text('Description', tableX + 14, ty + 8, { width: descW - 20, lineBreak: false });
  doc.text('Amount', tableX + descW, ty + 8, { width: amtW - 14, align: 'right', lineBreak: false });
  ty += titleRowH;

  if (!items.length) {
    doc.rect(tableX, ty, tableW, titleRowH).fill(LIGHT);
    doc.fillColor(MID).font(ITALIC).fontSize(11)
      .text('No priced line items yet — enter pricing in Pool Specs or Finance.', tableX + 14, ty + 8, { width: tableW - 28, lineBreak: false });
    ty += titleRowH;
  }

  items.forEach((it, i) => {
    const lines = detailByTitle[it.label] || [];
    // Measure the detail block so a row's title and its details never split
    // across a page break.
    doc.font(BODY).fontSize(9.5);
    let detailH = 0;
    for (const l of lines) detailH += doc.heightOfString('– ' + l, { width: detailW, lineGap: 1 }) + 2;
    const blockH = titleRowH + (lines.length ? detailH + 6 : 0);
    ensure(blockH);
    if (i % 2 === 0) doc.rect(tableX, ty, tableW, blockH).fill(LIGHT);
    // Title + price
    doc.fillColor(DARK).font(BOLD).fontSize(11.5);
    doc.text(it.label || '—', tableX + 14, ty + 7, { width: descW - 20, lineBreak: false });
    doc.text(money(it.amount), tableX + descW, ty + 7, { width: amtW - 14, align: 'right', lineBreak: false });
    // Matching Pool Specs detail lines beneath the title
    let dy = ty + titleRowH;
    doc.font(BODY).fontSize(9.5).fillColor(DARK);
    for (const l of lines) {
      const hh = doc.heightOfString('– ' + l, { width: detailW, lineGap: 1 });
      doc.text('– ' + l, detailX, dy, { width: detailW, lineGap: 1 });
      dy += hh + 2;
    }
    ty += blockH;
  });

  // Total row
  ensure(titleRowH + 8 + 20);
  ty += 4;
  doc.rect(tableX, ty, tableW, titleRowH + 6).fill(DARK);
  doc.fillColor('#ffffff').font(BOLD).fontSize(14);
  doc.text('ESTIMATE TOTAL', tableX + 14, ty + 11, { width: descW - 20, lineBreak: false });
  doc.text(money(total), tableX + descW, ty + 11, { width: amtW - 14, align: 'right', lineBreak: false });
  ty += titleRowH + 6 + 20;

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
