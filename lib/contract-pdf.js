// Contract PDF generator — reproduces the structure and wording of the signed
// 1533 Harding Place sample: cover (with selected rendering), Project Overview,
// Budget & Timeline, Scope of Work, finish color chart, Disclosures/Exclusions
// & Site Conditions, and Client Acknowledgment signature page.
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
const DARK = '#16324a';
const LIGHT = '#eaf4fc';
const MID = '#4a6b85';

const money = n => '$' + (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cap = w => w ? String(w).charAt(0).toUpperCase() + String(w).slice(1) : '';

// Elegant display font for the cover + headings. Drop a .ttf/.otf into /public/fonts
// (named display.ttf, or Saltz.ttf / Bruney.ttf) to use a custom face; falls back to Times-Bold.
let DISPLAY = 'Times-Bold';
function loadDisplayFont(doc) {
  DISPLAY = 'Times-Bold';
  const dir = path.join(__dirname, '..', 'public', 'fonts');
  for (const n of ['display.ttf', 'display.otf', 'Saltz.ttf', 'Saltz.otf', 'Bruney.ttf', 'Bruney.otf']) {
    const p = path.join(dir, n);
    if (fs.existsSync(p)) { try { doc.registerFont('Display', p); DISPLAY = 'Display'; return; } catch (e) { /* keep Times */ } }
  }
}

function header(doc, title) {
  doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
  doc.fillColor('#ffffff').font(DISPLAY).fontSize(20).text('INFINITY POOLS', 50, 22, { characterSpacing: 3 });
  doc.font('Times-Roman').fontSize(11).text(title.toUpperCase(), 50, 48, { characterSpacing: 2 });
  doc.fillColor(DARK);
  doc.y = 110;
}

// A mid-page blue block heading (for sections that flow within a page rather than starting one).
function blueBlock(doc, title) {
  if (doc.y > doc.page.height - 130) doc.addPage();
  doc.moveDown(0.6);
  const by = doc.y;
  doc.rect(50, by, doc.page.width - 100, 28).fill(BLUE);
  doc.fillColor('#ffffff').font(DISPLAY).fontSize(14).text(title, 60, by + 7, { lineBreak: false });
  doc.fillColor(DARK);
  doc.y = by + 28 + 10;
}

function sectionTitle(doc, text) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.6);
  doc.font(DISPLAY).fontSize(13).fillColor(BLUE).text(text, 50);
  doc.moveTo(50, doc.y + 2).lineTo(doc.page.width - 50, doc.y + 2).lineWidth(1).strokeColor('#cfe3f3').stroke();
  doc.moveDown(0.4);
  doc.fillColor(DARK).font('Times-Roman').fontSize(10);
}

function bullets(doc, items) {
  for (const it of items) {
    if (doc.y > doc.page.height - 90) doc.addPage();
    doc.font('Times-Roman').fontSize(10).fillColor(DARK)
      .text('•  ' + it, 60, doc.y, { width: doc.page.width - 120 });
    doc.moveDown(0.25);
  }
}

// Generic project overview. The specific sizes, features, and selections for
// this project are itemized in the "Your Selections" section directly below it.
function buildOverviewText(client) {
  return [
    'The project scope includes pre-construction design coordination followed by the construction of a custom in-ground pool. Optional features such as an attached spa, sun shelf, ledge seating, water features, and spillovers may be included as itemized in Your Selections below.',
    'Construction will consist of engineered rebar, shotcrete walls, and all required plumbing and electrical systems installed in accordance with applicable codes. Interior finishes will include a PebbleTec surface, waterline tile, and coping selections, all to be finalized during the design phase.',
    'The scope also includes the installation of all pool equipment and the equipment pad — including the pump, filtration system, plumbing, and lighting — along with final system activation and site cleanup.',
    'The specific sizes, configuration, features, and finish selections for this project are detailed in the Your Selections section below.',
  ].join(' ');
}

// All pool-spec selections as [label, value] rows, with capitalized labels/values,
// for the "Your Selections" section of the contract.
function buildSelections(client) {
  const s = client.specs;
  const rows = [];
  rows.push(['Pool Shape', cap(s.shape) + (s.sizeDetails ? ' — ' + s.sizeDetails : '')]);
  if (s.hotTub.included) rows.push(['Hot Tub', s.hotTub.details || 'Included']);
  if (s.sunShelf.included) rows.push(['Sun Shelf', s.sunShelf.details || 'Included']);
  if (s.spillover.included) rows.push(['Spillover', s.spillover.details || 'Included']);
  if (s.ledgeSeating.included) rows.push(['Ledge / Seating', (s.ledgeSeating.style || 'Included') + (s.ledgeSeating.details ? ' — ' + s.ledgeSeating.details : '')]);
  if (s.waterFeature.included) rows.push(['Water Feature', s.waterFeature.details || 'Included']);
  if (s.fireFeature && s.fireFeature.included) rows.push(['Fire Feature', s.fireFeature.details || 'Included']);
  if (s.jets) rows.push(['Jets', s.jets]);
  if (s.ledLights) rows.push(['LED Lights', s.ledLights]);
  if (s.equipmentPad) rows.push(['Equipment Pad Location', s.equipmentPad]);
  for (const a of (s.addOns || [])) rows.push([a.label || 'Add-on', a.value || 'Included']);
  if (client.selectedFinishes && client.selectedFinishes.length) rows.push(['Interior Finish', client.selectedFinishes.join(', ')]);
  return rows;
}

/**
 * Generate the contract PDF. Resolves with the absolute file path once the
 * file is fully written to disk.
 */
async function generate(client, { uploadsDir }) {
  const outDir = path.join(__dirname, '..', 'data', 'contracts');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${client.id}-contract.pdf`);
  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: 50, right: 50 }, bufferPages: true });
  const stream = fs.createWriteStream(outFile);
  const done = new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outFile));
    stream.on('error', reject);
  });
  doc.pipe(stream);
  loadDisplayFont(doc);

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
  doc.font('Times-Italic').fontSize(13).fillColor(MID)
    .text('Pool Construction Proposal & Contract', M, doc.y + 4);
  doc.moveDown(0.7);
  doc.fillColor(BLUE).font(DISPLAY).fontSize(20)
    .text('INFINITY POOLS', M, doc.y, { characterSpacing: 4 });
  doc.font('Times-Roman').fontSize(10).fillColor(MID)
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

  // ---------------- Project Overview ----------------
  doc.addPage();
  header(doc, 'Project Overview');
  doc.font('Times-Roman').fontSize(11).fillColor(DARK)
    .text(buildOverviewText(client), 50, 120, { width: doc.page.width - 100, lineGap: 4 });

  // ---------------- Your Selections (under the Project Overview, same page) ----------------
  blueBlock(doc, 'Your Selections');
  for (const [label, value] of buildSelections(client)) {
    if (doc.y > doc.page.height - 80) { doc.addPage(); blueBlock(doc, 'Your Selections (cont.)'); }
    const rowY = doc.y;
    doc.font('Times-Bold').fontSize(11).fillColor(BLUE).text(label + ':', 56, rowY, { width: 185 });
    doc.font('Times-Roman').fontSize(11).fillColor(DARK).text(String(value || '—'), 245, rowY, { width: doc.page.width - 295 });
    const nextY = Math.max(rowY + 24, doc.y + 12);
    doc.moveTo(50, nextY - 8).lineTo(doc.page.width - 50, nextY - 8).lineWidth(0.5).strokeColor('#e2edf6').stroke();
    doc.y = nextY;
  }

  // ---------------- Budget & Timeline ----------------
  doc.addPage();
  header(doc, 'Budget & Timeline');
  const cols = [85, 125, 200, 102];
  const x0 = 50, tableW = cols.reduce((a, b) => a + b), rowH = 30;
  let y = 140;
  doc.rect(x0, y, tableW, rowH).fill(BLUE);
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(12);
  doc.text('Draw', x0 + 10, y + 9, { width: cols[0] });
  doc.text('Amount', x0 + cols[0] + 10, y + 9, { width: cols[1] });
  doc.text('Phase', x0 + cols[0] + cols[1] + 10, y + 9, { width: cols[2] });
  doc.text('Time', x0 + cols[0] + cols[1] + cols[2] + 10, y + 9, { width: cols[3] });
  y += rowH;
  client.phases.forEach((p, i) => {
    if (i % 2 === 0) doc.rect(x0, y, tableW, rowH).fill(LIGHT);
    doc.fillColor(DARK).font('Times-Roman').fontSize(12);
    doc.text(p.drawPct + '%', x0 + 10, y + 9, { width: cols[0] });
    doc.text(p.drawPct > 0 ? money(store.phaseAmount(client, p)) : '—', x0 + cols[0] + 10, y + 9, { width: cols[1] });
    doc.text(p.name, x0 + cols[0] + cols[1] + 10, y + 9, { width: cols[2] });
    doc.text(p.time, x0 + cols[0] + cols[1] + cols[2] + 10, y + 9, { width: cols[3] });
    y += rowH;
  });
  doc.rect(x0, y, tableW, rowH + 4).fill(BLUE);
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(13);
  doc.text('TOTAL', x0 + 10, y + 11, { width: cols[0] + cols[1] });
  doc.text(money(total), x0 + cols[0] + 10, y + 11, { width: cols[1] + cols[2] });
  y += rowH + 4 + 22;
  doc.fillColor(MID).font('Times-Italic').fontSize(9)
    .text('Disclaimer: Construction timelines are estimates only and may be affected by weather, permitting, inspections, material lead times, terrain, and other unforeseen circumstances. Infinity Pools cannot guarantee completion dates, but we remain committed to clear communication throughout the process.', x0, y, { width: doc.page.width - 100, lineGap: 3 });

  // ---------------- Scope of Work ----------------
  doc.addPage();
  header(doc, 'Scope of Work');
  const drawByKey = Object.fromEntries(client.phases.map(p => [p.key, p.drawPct]));
  for (const sec of client.scope) {
    sectionTitle(doc, sec.title + (drawByKey[sec.key] !== undefined && drawByKey[sec.key] > 0 ? `  —  ${drawByKey[sec.key]}% Draw` : ''));
    bullets(doc, sec.items);
  }
  // (Pool configuration is now shown in its own "Your Selections" section above.)
  doc.moveDown(1);
  if (doc.y > doc.page.height - 110) doc.addPage();
  doc.rect(50, doc.y, doc.page.width - 100, 30).fill(LIGHT);
  doc.fillColor(DARK).font('Times-Bold').fontSize(12)
    .text('Subtotal', 60, doc.y + 9 - 30 + 30, { continued: true })
    .text('   ' + money(total));

  // ---------------- Finish color chart ----------------
  doc.addPage();
  header(doc, 'Interior Finish Selections');
  doc.font('Times-Roman').fontSize(10).fillColor(DARK)
    .text('Proposal includes all "Standard" Pebble Tec & Pebble Sheen plaster finishes. Upgrade, Premium, and specialty finishes are available at additional cost. Colors can be found at https://pebbletec.com/products/all-finishes/ or a sample chart can be provided.', 50, 115, { width: doc.page.width - 100, lineGap: 3 });
  doc.moveDown(0.8);
  const groups = {};
  for (const f of store.data.finishes.filter(f => f.active)) {
    const g = f.brand + '|' + f.tier;
    (groups[g] = groups[g] || []).push(f);
  }
  const tierOrder = ['Standard', 'Upgrade', 'Premium', 'Extra Premium', 'Brilliance'];
  const brandOrder = ['PebbleTec', 'PebbleSheen', 'PebbleFina', 'PebbleBrilliance'];
  const selected = new Set(client.selectedFinishes || []);
  const sw = 20, colW = 170, COLS = 3, finRowH = 26; // enlarged swatches, 3 columns across the page
  let firstBrand = true;
  for (const brand of brandOrder) {
    const brandTiers = tierOrder.filter(t => groups[brand + '|' + t]);
    if (!brandTiers.length) continue;
    if (doc.y > doc.page.height - 160) doc.addPage();
    // Divider between brands only (not between individual colors).
    if (!firstBrand) {
      doc.moveDown(0.7);
      doc.moveTo(50, doc.y).lineTo(doc.page.width - 50, doc.y).lineWidth(1).strokeColor('#cfe3f3').stroke();
      doc.moveDown(0.5);
    }
    firstBrand = false;
    doc.font('Times-Bold').fontSize(13).fillColor(BLUE).text(brand, 50);
    for (const tier of brandTiers) {
      const fin = groups[brand + '|' + tier];
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font('Times-Bold').fontSize(9).fillColor(MID).text(tier.toUpperCase(), 50, doc.y + 6);
      let cy = doc.y + 8;
      for (let i = 0; i < fin.length; i++) {
        const col = i % COLS;
        if (col === 0) {
          if (i > 0) cy += finRowH;
          if (cy + finRowH > doc.page.height - 80) { doc.addPage(); cy = doc.y; }
        }
        const cx = 50 + col * colW;
        const f = fin[i];
        const img = path.join(__dirname, '..', 'public', 'swatches', f.id + '.jpg');
        if (fs.existsSync(img)) {
          try { doc.image(img, cx, cy, { width: sw, height: sw }); }
          catch (e) { doc.rect(cx, cy, sw, sw).fill(f.color || '#999'); }
        } else {
          doc.rect(cx, cy, sw, sw).fill(f.color || '#999');
        }
        doc.rect(cx, cy, sw, sw).lineWidth(0.5).strokeColor('#9db8cc').stroke();
        const isSel = selected.has(f.name) || selected.has(f.brand + ' ' + f.name);
        doc.fillColor(DARK).font(isSel ? 'Times-Bold' : 'Times-Roman').fontSize(10)
          .text((isSel ? '✓ ' : '') + f.name + (f.shimmer ? '*' : ''), cx + sw + 7, cy + (sw - 10) / 2, { width: colW - sw - 12, lineBreak: false });
      }
      doc.y = cy + finRowH;
    }
  }
  doc.moveDown(0.6);
  doc.font('Times-Italic').fontSize(8).fillColor(MID)
    .text('* Denotes the finish contains Shimmering Sea™ seashell blend in the mix.', 50);
  if (selected.size) {
    doc.moveDown(0.5);
    doc.font('Times-Bold').fontSize(10).fillColor(BLUE).text('Client selections: ' + [...selected].join(', '), 50);
  }

  // ---------------- Disclosures ----------------
  doc.addPage();
  header(doc, 'Disclosures, Exclusions & Site Conditions');
  store.data.settings.disclosures.forEach((d, i) => {
    sectionTitle(doc, `${i + 1}. ${d.title}`);
    for (const para of d.body.split('\n')) {
      if (!para.trim()) { doc.moveDown(0.3); continue; }
      if (doc.y > doc.page.height - 90) doc.addPage();
      doc.font('Times-Roman').fontSize(9).fillColor(DARK).text(para, 56, doc.y, { width: doc.page.width - 112, lineGap: 2 });
      doc.moveDown(0.2);
    }
  });

  // ---------------- Acknowledgment & signatures ----------------
  doc.addPage();
  header(doc, 'Client Acknowledgment');
  doc.font('Times-Roman').fontSize(10).fillColor(DARK).text(
    'By signing below, Client acknowledges having read and understood all disclosures, exclusions, and site conditions set forth in this document, and agrees that these terms, together with the Project Overview, Budget & Timeline, Scope of Work, and finish selections, are incorporated into and made part of this signed project proposal. ' +
    'Any work, conditions, or materials not specifically included in this signed contract will be handled through a written change order prior to performance.', 50, 120, { width: doc.page.width - 100, lineGap: 4 });
  doc.moveDown(1.5);
  doc.font('Times-Bold').fontSize(11).fillColor(BLUE).text('Contract total: ' + money(total));
  doc.moveDown(1.2);

  // Interior finish is finalized during the design phase — no selection field here.
  // Leave the vertical space between the contract total and the signature lines.
  doc.y = doc.y + 56;
  doc.moveDown(1.5);

  const lineY = () => { const yy = doc.y; doc.moveTo(50, yy).lineTo(300, yy).strokeColor(DARK).lineWidth(1).stroke(); return yy; };
  let yy = lineY();
  doc.font('Times-Roman').fontSize(10).fillColor(DARK).text('Client Signature', 50, yy + 4);
  doc.moveTo(360, yy).lineTo(520, yy).stroke();
  doc.text('Date', 360, yy + 4);
  doc.moveDown(4);
  yy = lineY();
  doc.text('Infinity Pools Authorized Signature', 50, yy + 4);
  doc.moveTo(360, yy).lineTo(520, yy).stroke();
  doc.text('Date', 360, yy + 4);
  doc.moveDown(3);
  doc.font('Times-Italic').fontSize(8).fillColor(MID)
    .text('This document is provided for informational and contractual purposes. Consult a licensed attorney to confirm enforceability in your jurisdiction.', 50);

  // Footer page numbers (zero the bottom margin while writing in it, or
  // pdfkit auto-appends overflow pages)
  const range = doc.bufferedPageRange();
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(i);
    const oldBottom = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font('Times-Roman').fontSize(8).fillColor(MID)
      .text(`— ${i + 1} of ${range.count} —`, 0, doc.page.height - 36, { align: 'center', width: doc.page.width, lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  return done;
}

module.exports = { generate };
