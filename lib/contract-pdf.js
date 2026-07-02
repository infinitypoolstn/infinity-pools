// Contract PDF generator. Page order: cover (with selected rendering), Pool
// Renderings gallery, Scope of Work (scope sections, then the priced Pool Specs
// sections, the project-overview paragraph, and the total price quote), full-page
// Budget & Timeline, Disclosures/Exclusions & Site Conditions, and the Client
// Acknowledgment signature page.
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const store = require('./store');

// Convert any image format (WebP, HEIC, PNG, JPEG, …) to a JPEG Buffer that
// PDFKit can always embed. Returns null if the file can't be read.
async function imgToJpeg(filePath) {
  try {
    return await sharp(filePath).jpeg({ quality: 90 }).toBuffer();
  } catch (e) {
    console.warn('contract-pdf: could not convert image', path.basename(filePath), '-', e.message);
    return null;
  }
}

// Optional brand logo for the contract cover. Drop a file named logo.png / logo.jpg
// into /public to use it; otherwise the cover falls back to a typographic wordmark.
function findLogo() {
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg']) {
    const p = path.join(__dirname, '..', 'public', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const BLUE = '#0a5ea8';
const MEDBLUE = '#2f7dc2'; // section-header banner fill (medium blue, white text)
const PRICEBLUE = '#5b9bd5'; // lighter blue banner for priced (Pool Specs) sections
const DARK = '#16324a';
const LIGHT = '#eaf4fc';
const MID = '#4a6b85';

const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = w => w ? String(w).charAt(0).toUpperCase() + String(w).slice(1) : '';

// Fonts. The whole contract renders in Roboto Condensed when its TTFs are present
// in /public/fonts (RobotoCondensed-Regular/Bold/Italic.ttf); otherwise it falls
// back to the built-in Times faces. DISPLAY (cover + headings) defaults to the
// condensed bold, but a display.ttf / Saltz / Bruney face still overrides it.
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
  // An explicit display face still wins for the cover + headings.
  for (const n of ['display.ttf', 'display.otf', 'Saltz.ttf', 'Saltz.otf', 'Bruney.ttf', 'Bruney.otf']) {
    if (reg('Display', n)) { DISPLAY = 'Display'; break; }
  }
}

function header(doc, title) {
  doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
  doc.fillColor('#ffffff').font(DISPLAY).fontSize(20).text('INFINITY POOLS', 50, 22, { characterSpacing: 3 });
  doc.font(BODY).fontSize(11).text(title.toUpperCase(), 50, 48, { characterSpacing: 2 });
  doc.fillColor(DARK);
  doc.y = 110;
}

// Section header rendered as a banner with white text. Defaults to medium blue;
// pass a fill color to distinguish a section (priced sections use PRICEBLUE).
function sectionTitle(doc, text, fill = MEDBLUE) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.6);
  const by = doc.y, h = 24;
  doc.rect(50, by, doc.page.width - 100, h).fill(fill);
  doc.fillColor('#ffffff').font(DISPLAY).fontSize(13).text(text, 60, by + 6, { lineBreak: false, width: doc.page.width - 120 });
  doc.fillColor(DARK).font(BODY).fontSize(10);
  doc.y = by + h + 8;
}

function bullets(doc, items) {
  for (const it of items) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc.font(BODY).fontSize(10).fillColor(DARK)
      .text('•  ' + it, 60, doc.y, { width: doc.page.width - 120 });
    doc.moveDown(0.25);
  }
}

// Generic project overview paragraph, shown below the Scope of Work. The specific
// sizes, features, and prices are itemized in the pool sections directly above it.
function buildOverviewText(client) {
  return [
    'The project scope includes pre-construction design coordination followed by the construction of a custom in-ground pool. Optional features such as an attached spa, sun shelf, ledge seating, water features, and spillovers are included as itemized in the pool sections above.',
    'Construction will consist of engineered rebar, shotcrete walls, and all required plumbing and electrical systems installed in accordance with applicable codes. Interior finishes will include a PebbleTec surface, waterline tile, and coping selections, all to be finalized during the design phase.',
    'The scope also includes the installation of all pool equipment and the equipment pad — including the pump, filtration system, plumbing, and lighting — along with final system activation and site cleanup.',
  ].join(' ');
}

// Pool Specs broken into priced sections for the contract, mirroring the Finance
// quote: Pool Base (always), then each included selection (with its price). Each
// section is { title, price, lines[] } where lines are the feature detail rows.
function buildSpecSections(client) {
  const s = client.specs || {};
  const sections = [];
  const pb = s.poolBase || {};
  const pbLines = ['Shape: ' + cap(pb.shape) + (pb.shape === 'freeform' && pb.freeform ? ' — ' + pb.freeform : '')];
  if (pb.size) pbLines.push('Size: ' + pb.size);
  if (pb.depth) pbLines.push('Depth: ' + pb.depth);
  if (pb.jets) pbLines.push('Number of Jets: ' + pb.jets);
  if (pb.ledLights) pbLines.push('Hayward Colorlogic 320 LED Lights: ' + pb.ledLights);
  if (pb.sunShelf && pb.sunShelf.included) pbLines.push('Sun Shelf: ' + (pb.sunShelf.details || 'Included'));
  if (pb.spillover && pb.spillover.included) pbLines.push('Spillover: ' + (pb.spillover.details || 'Included'));
  if (pb.ledgeSeating && pb.ledgeSeating.included) pbLines.push('Ledge / Seating: ' + (pb.ledgeSeating.details || 'Included'));
  sections.push({ title: 'Pool Base', price: Number(pb.price) || 0, lines: pbLines });

  // Spa Base keeps Size / Jets / LED but not its free-text additional details.
  const spa = s.spaBase || {};
  if (spa.included) {
    const lines = [];
    if (spa.size) lines.push('Size: ' + spa.size);
    if (spa.jets) lines.push('Number of Jets: ' + spa.jets);
    if (spa.ledLights) lines.push('Hayward Colorlogic 320 LED Lights: ' + spa.ledLights);
    sections.push({ title: 'Spa Base', price: Number(spa.price) || 0, lines });
  }
  // Water Feature, Cold Plunge, and Fire Feature show their detail text as-is
  // (no "Size and Details" label).
  const feat = (obj, title) => {
    if (obj && obj.included) sections.push({ title, price: Number(obj.price) || 0, lines: obj.details ? [obj.details] : [] });
  };
  feat(s.waterFeature, 'Water Feature');
  const cp = s.coldPlunge;
  if (cp && cp.included) {
    const lines = [];
    if (cp.details) lines.push(cp.details);
    if (cp.ledLights) lines.push('Hayward Colorlogic 320 LED Lights: ' + cp.ledLights);
    sections.push({ title: 'Cold Plunge', price: Number(cp.price) || 0, lines });
  }
  feat(s.fireFeature, 'Fire Feature');
  for (const a of (s.addOns || [])) {
    if (!(a.label || '').trim()) continue;
    sections.push({ title: a.label, price: Number(a.price) || 0, lines: a.value ? ['Details: ' + a.value] : [] });
  }
  return sections;
}

/**
 * Generate the contract PDF. Resolves with the absolute file path once the
 * file is fully written to disk. Pass { forSigning: true } to embed DocuSeal
 * signature/date text tags on the acknowledgment page.
 */
async function generate(client, { uploadsDir, forSigning = false } = {}) {
  const outDir = path.join(__dirname, '..', 'data', 'contracts');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${client.id}-contract${forSigning ? '-signing' : ''}.pdf`);
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 }, bufferPages: true });
  const stream = fs.createWriteStream(outFile);
  const done = new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outFile));
    stream.on('error', reject);
  });
  doc.pipe(stream);
  loadFonts(doc);

  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
  const total = store.quoteTotal(client);

  // ---------------- Cover page (white, with a blue band behind the rendering) ----------------
  const PW = doc.page.width, M = 50;

  // Logo, top-left (enlarged) — real logo image if /public/logo.* exists, else a wordmark.
  const logoPath = findLogo();
  let logoPlaced = false;
  if (logoPath) {
    try { doc.image(logoPath, M, 40, { height: 96 }); logoPlaced = true; } catch (e) { /* fall back */ }
  }
  if (!logoPlaced) {
    doc.fillColor(BLUE).font(DISPLAY).fontSize(26)
      .text('INFINITY POOLS', M, 56, { characterSpacing: 3, lineBreak: false });
  }

  // Selected rendering (uploads-page cover photo) on a full-width blue band — the focal point.
  const cover = client.files.find(f => f.isCoverPhoto);
  const bandY = 175, bandH = 300;
  let imgBottom = bandY + bandH;
  if (cover) {
    const imgPath = path.join(uploadsDir, client.id, cover.storedName);
    if (fs.existsSync(imgPath)) {
      const buf = await imgToJpeg(imgPath);
      if (buf) {
        doc.rect(0, bandY, PW, bandH).fill('#0b4d87'); // blue horizontal block behind the image
        doc.image(buf, M, bandY + 20, { fit: [PW - 2 * M, bandH - 40], align: 'center', valign: 'center' }); // no border
      }
    }
  }

  // Title block — address + proposal line ABOVE the INFINITY POOLS wordmark, left-aligned (dark on white).
  const ty = imgBottom + 42;
  doc.fillColor(DARK).font(DISPLAY).fontSize(28)
    .text(client.address.toUpperCase(), M, ty, { width: PW - 2 * M });
  doc.font(ITALIC).fontSize(13).fillColor(MID)
    .text('Pool Construction Proposal & Contract', M, doc.y + 4);
  doc.moveDown(0.7);
  doc.fillColor(BLUE).font(DISPLAY).fontSize(20)
    .text('INFINITY POOLS', M, doc.y, { characterSpacing: 4 });
  doc.font(BODY).fontSize(10).fillColor(MID)
    .text('Prepared for ' + client.name, M, doc.y + 6)
    .text('Prepared by ' + (store.data.settings.companyName || 'Infinity Pools'), M, doc.y + 2)
    .text(today, M, doc.y + 2);

  // ---------------- Pool Renderings gallery (all uploaded renderings) ----------------
  const renderings = client.files.filter(f => f.category === 'Pool Renderings');
  if (renderings.length > 0) {
    doc.addPage();
    header(doc, 'Pool Renderings');
    const COL_W = 245, COL_H = 180, GUTTER = 16;
    let ry = doc.y;
    for (let i = 0; i < renderings.length; i++) {
      const col = i % 2;
      const rx = 50 + col * (COL_W + GUTTER);
      if (col === 0 && i > 0) {
        ry += COL_H + 16;
        if (ry + COL_H > doc.page.height - 70) {
          doc.addPage();
          header(doc, 'Pool Renderings (cont.)');
          ry = doc.y;
        }
      }
      const f = renderings[i];
      const imgPath = path.join(uploadsDir, client.id, f.storedName);
      if (!fs.existsSync(imgPath)) continue;
      const buf = await imgToJpeg(imgPath);
      if (!buf) continue;
      // No border, no filename — just the rendering.
      doc.image(buf, rx, ry, { fit: [COL_W, COL_H], align: 'center', valign: 'center' });
    }
  }

  // ---------------- Scope of Work ----------------
  doc.addPage();
  header(doc, 'Scope of Work');
  const drawByKey = Object.fromEntries(client.phases.map(p => [p.key, p.drawPct]));
  // Drop the obsolete "Color chart attached in proposal" reference (the swatch
  // chart was removed); applies to clients whose stored scope still has it.
  const cleanItem = it => it.replace(/\s*Color chart attached in proposal\.?/i, '');
  for (const sec of client.scope) {
    sectionTitle(doc, sec.title + (drawByKey[sec.key] !== undefined && drawByKey[sec.key] > 0 ? `  —  ${drawByKey[sec.key]}% Draw` : ''));
    bullets(doc, sec.items.map(cleanItem));
    doc.moveDown(0.7); // space each scope section out
  }
  doc.moveDown(0.9); // extra space after Landscaping, before the pool sections

  // Pool selections from Pool Specs — shown as sections below Landscaping, each
  // with its quoted price (replaces the old "Your Selections" table).
  for (const sec of buildSpecSections(client)) {
    sectionTitle(doc, sec.title + '  —  ' + money(sec.price), PRICEBLUE);
    if (sec.lines.length) bullets(doc, sec.lines);
  }

  // Project overview paragraph (moved here from its own page), then the total.
  sectionTitle(doc, 'Project Overview');
  doc.font(BODY).fontSize(10).fillColor(DARK)
    .text(buildOverviewText(client), 56, doc.y, { width: doc.page.width - 112, lineGap: 4 });
  doc.moveDown(1);
  if (doc.y > doc.page.height - 90) doc.addPage();
  const tqY = doc.y;
  doc.rect(50, tqY, doc.page.width - 100, 34).fill(BLUE);
  doc.fillColor('#ffffff').font(BOLD).fontSize(14).text('Total Price Quote', 60, tqY + 10, { lineBreak: false });
  doc.font(BOLD).fontSize(14).fillColor('#ffffff').text(money(total), 50, tqY + 10, { width: doc.page.width - 110, align: 'right' });
  doc.fillColor(DARK);
  doc.y = tqY + 34 + 12;

  // ---------------- Budget & Timeline (full page, after Scope of Work) ----------------
  doc.addPage();
  header(doc, 'Budget & Timeline');
  const cols = [90, 140, 190, 92];
  const x0 = 50, tableW = cols.reduce((a, b) => a + b);
  const topY = 130;
  // Size the rows so the table fills the page (header + phases + total), leaving
  // room at the bottom for the timeline disclaimer.
  const nRows = client.phases.length + 2; // header + phases + total
  const bottomLimit = doc.page.height - 150;
  const rowH = Math.max(30, Math.min(58, Math.floor((bottomLimit - topY) / nRows)));
  const vc = h => Math.round((rowH - h) / 2);
  let y = topY;
  doc.rect(x0, y, tableW, rowH).fill(BLUE);
  doc.fillColor('#ffffff').font(BOLD).fontSize(13);
  doc.text('Draw', x0 + 12, y + vc(13), { width: cols[0] });
  doc.text('Amount', x0 + cols[0] + 12, y + vc(13), { width: cols[1] });
  doc.text('Phase', x0 + cols[0] + cols[1] + 12, y + vc(13), { width: cols[2] });
  doc.text('Time', x0 + cols[0] + cols[1] + cols[2] + 12, y + vc(13), { width: cols[3] });
  y += rowH;
  client.phases.forEach((p, i) => {
    if (i % 2 === 0) doc.rect(x0, y, tableW, rowH).fill(LIGHT);
    doc.fillColor(DARK).font(BODY).fontSize(12);
    doc.text(p.drawPct + '%', x0 + 12, y + vc(12), { width: cols[0] });
    doc.text(p.drawPct > 0 ? money(store.phaseAmount(client, p)) : '—', x0 + cols[0] + 12, y + vc(12), { width: cols[1] });
    doc.text(p.name, x0 + cols[0] + cols[1] + 12, y + vc(12), { width: cols[2] });
    doc.text(p.time, x0 + cols[0] + cols[1] + cols[2] + 12, y + vc(12), { width: cols[3] });
    y += rowH;
  });
  doc.rect(x0, y, tableW, rowH).fill(BLUE);
  doc.fillColor('#ffffff').font(BOLD).fontSize(14);
  doc.text('TOTAL', x0 + 12, y + vc(14), { width: cols[0] + cols[1] });
  doc.text(money(total), x0 + cols[0] + 12, y + vc(14), { width: cols[1] + cols[2] });
  y += rowH + 22;
  doc.fillColor(MID).font(ITALIC).fontSize(9)
    .text('Disclaimer: Construction timelines are estimates only and may be affected by weather, permitting, inspections, material lead times, terrain, and other unforeseen circumstances. Infinity Pools cannot guarantee completion dates, but we remain committed to clear communication throughout the process.', x0, y, { width: doc.page.width - 100, lineGap: 3 });

  // ---------------- Disclosures ----------------
  doc.addPage();
  header(doc, 'Disclosures, Exclusions & Site Conditions');
  store.data.settings.disclosures.forEach((d, i) => {
    sectionTitle(doc, `${i + 1}. ${d.title}`);
    for (const para of d.body.split('\n')) {
      if (!para.trim()) { doc.moveDown(0.3); continue; }
      if (doc.y > doc.page.height - 90) doc.addPage();
      doc.font(BODY).fontSize(9).fillColor(DARK).text(para, 56, doc.y, { width: doc.page.width - 112, lineGap: 2 });
      doc.moveDown(0.2);
    }
  });

  // ---------------- Acknowledgment & signatures ----------------
  doc.addPage();
  header(doc, 'Client Acknowledgment');
  doc.font(BODY).fontSize(10).fillColor(DARK).text(
    'By signing below, Client acknowledges having read and understood all disclosures, exclusions, and site conditions set forth in this document, and agrees that these terms, together with the Scope of Work and Budget & Timeline, are incorporated into and made part of this signed project proposal. ' +
    'Any work, conditions, or materials not specifically included in this signed contract will be handled through a written change order prior to performance.', 50, 120, { width: doc.page.width - 100, lineGap: 4 });
  doc.moveDown(1.5);
  doc.font(BOLD).fontSize(11).fillColor(BLUE).text('Contract total: ' + money(total));
  doc.moveDown(1.2);

  // Interior finish is finalized during the design phase — no selection field here.
  // Leave the vertical space between the contract total and the signature lines.
  doc.y = doc.y + 56;
  doc.moveDown(1.5);

  const lineY = () => { const yy = doc.y; doc.moveTo(50, yy).lineTo(300, yy).strokeColor(DARK).lineWidth(1).stroke(); return yy; };
  let yy = lineY();
  // DocuSeal signature/date text tags, rendered in white just above the client
  // signature line so they're invisible. DocuSeal detects {{...}} tags, turns them
  // into fillable fields, and strips the text (remove_tags defaults true).
  if (forSigning) {
    doc.font(BODY).fontSize(10).fillColor('#ffffff')
      .text('{{Signature;role=Client;type=signature}}', 55, yy - 26, { lineBreak: false });
    doc.text('{{Date;role=Client;type=date}}', 360, yy - 26, { lineBreak: false });
    doc.fillColor(DARK);
  }
  doc.font(BODY).fontSize(10).fillColor(DARK).text('Client Signature', 50, yy + 4);
  doc.moveTo(360, yy).lineTo(520, yy).stroke();
  doc.text('Date', 360, yy + 4);
  doc.moveDown(4);
  yy = lineY();
  doc.text('Infinity Pools Authorized Signature', 50, yy + 4);
  doc.moveTo(360, yy).lineTo(520, yy).stroke();
  doc.text('Date', 360, yy + 4);
  doc.moveDown(3);
  doc.font(ITALIC).fontSize(8).fillColor(MID)
    .text('This document is provided for informational and contractual purposes. Consult a licensed attorney to confirm enforceability in your jurisdiction.', 50);

  // Footer page numbers (zero the bottom margin while writing in it, or
  // pdfkit auto-appends overflow pages)
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
