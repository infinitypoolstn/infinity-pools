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

function header(doc, title) {
  doc.rect(0, 0, doc.page.width, 80).fill(BLUE);
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(20).text('INFINITY POOLS', 50, 22, { characterSpacing: 3 });
  doc.font('Times-Roman').fontSize(11).text(title.toUpperCase(), 50, 48, { characterSpacing: 2 });
  doc.fillColor(DARK);
  doc.y = 110;
}

function sectionTitle(doc, text) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.moveDown(0.6);
  doc.font('Times-Bold').fontSize(13).fillColor(BLUE).text(text, 50);
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

function buildOverviewText(client) {
  const s = client.specs;
  const parts = [];
  parts.push(`The project scope includes pre-construction design coordination followed by the construction of a custom ${s.sizeDetails ? s.sizeDetails + ' ' : ''}${s.shape} in-ground pool${s.hotTub.included ? ' with an attached spa' : ''}.`);
  const feats = [];
  if (s.sunShelf.included) feats.push(`a sun shelf${s.sunShelf.details ? ' (' + s.sunShelf.details + ')' : ''}`);
  if (s.ledgeSeating.included) feats.push(`${s.ledgeSeating.style || 'ledge'} seating${s.ledgeSeating.details ? ' (' + s.ledgeSeating.details + ')' : ''}`);
  if (s.hotTub.included) feats.push(`a spa${s.hotTub.details ? ' (' + s.hotTub.details + ')' : ''}${s.jets ? ' equipped with ' + s.jets + ' integrated jets' : ''}`);
  if (s.spillover.included) feats.push(`a cascading spillover${s.spillover.details ? ' (' + s.spillover.details + ')' : ''}`);
  if (s.waterFeature.included) feats.push(`water feature${s.waterFeature.details ? ': ' + s.waterFeature.details : ''}`);
  if (feats.length) parts.push(`The pool will feature ${feats.join(', ')}.`);
  parts.push('Construction will consist of engineered rebar, shotcrete walls, and all required plumbing and electrical systems installed in accordance with applicable codes. Interior finishes will include a PebbleTec surface, waterline tile, and coping selections, all to be finalized during the design phase.');
  const extras = [];
  if (s.ledLights) extras.push(`${s.ledLights} LED light(s)`);
  if (s.equipmentPad) extras.push(`equipment pad located at: ${s.equipmentPad}`);
  parts.push(`The scope also includes the installation of all pool equipment and the equipment pad, including pump, filtration system, plumbing, and lighting${extras.length ? ' (' + extras.join('; ') + ')' : ''}, along with final system activation and site cleanup.`);
  if (s.addOns && s.addOns.length) {
    parts.push('Additional inclusions: ' + s.addOns.map(a => a.label + (a.value ? ' — ' + a.value : '')).join('; ') + '.');
  }
  return parts.join(' ');
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

  const today = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' });
  const total = store.quoteTotal(client);

  // ---------------- Cover page ----------------
  doc.rect(0, 0, doc.page.width, doc.page.height).fill('#0b4d87');
  const PW = doc.page.width, M = 50;

  // Logo, top-left — real logo image if /public/logo.* exists, else an elegant wordmark.
  const logoPath = findLogo();
  let logoPlaced = false;
  if (logoPath) {
    try { doc.image(logoPath, M, 38, { height: 54 }); logoPlaced = true; } catch (e) { /* fall back */ }
  }
  if (!logoPlaced) {
    doc.fillColor('#ffffff').font('Times-Bold').fontSize(15)
      .text('INFINITY POOLS', M, 50, { characterSpacing: 3, lineBreak: false });
  }

  // Selected rendering (the uploads-page cover photo) — the focal point of the page.
  const cover = client.files.find(f => f.isCoverPhoto);
  let imgBottom = 120;
  if (cover) {
    const imgPath = path.join(uploadsDir, client.id, cover.storedName);
    if (fs.existsSync(imgPath)) {
      const buf = await imgToJpeg(imgPath);
      if (buf) {
        const fx = M, fy = 112, fw = PW - 2 * M, fh = 392;
        doc.rect(fx - 6, fy - 6, fw + 12, fh + 12).fill('#ffffff'); // matted frame around the rendering
        doc.image(buf, fx, fy, { fit: [fw, fh], align: 'center', valign: 'center' });
        imgBottom = fy + fh + 6;
      }
    }
  }

  // Title block — address + proposal line sit ABOVE the INFINITY POOLS wordmark, left-aligned.
  const ty = Math.max(imgBottom + 28, 540);
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(26)
    .text(client.address.toUpperCase(), M, ty, { width: PW - 2 * M });
  doc.font('Times-Italic').fontSize(13).fillColor('#cfe3f3')
    .text('Pool Construction Proposal & Contract', M, doc.y + 4);
  doc.moveDown(0.7);
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(20)
    .text('INFINITY POOLS', M, doc.y, { characterSpacing: 4 });
  doc.font('Times-Roman').fontSize(10).fillColor('#e6f0fa')
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
        ry += COL_H + 26;
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
      doc.rect(rx, ry, COL_W, COL_H).lineWidth(0.5).strokeColor('#c0d5e8').stroke();
      doc.image(buf, rx + 2, ry + 2, { fit: [COL_W - 4, COL_H - 4], align: 'center', valign: 'center' });
      const lbl = (f.isCoverPhoto ? '★ ' : '') + f.originalName;
      doc.font(f.isCoverPhoto ? 'Times-Bold' : 'Times-Roman').fontSize(8).fillColor(f.isCoverPhoto ? BLUE : MID)
        .text(lbl.length > 50 ? lbl.slice(0, 47) + '…' : lbl, rx, ry + COL_H + 5, { width: COL_W });
    }
  }

  // ---------------- Project Overview ----------------
  doc.addPage();
  header(doc, 'Project Overview');
  doc.font('Times-Roman').fontSize(11).fillColor(DARK)
    .text(buildOverviewText(client), 50, 120, { width: doc.page.width - 100, lineGap: 4 });

  // ---------------- Budget & Timeline ----------------
  doc.addPage();
  header(doc, 'Budget & Timeline');
  const cols = [70, 90, 230, 120];
  const x0 = 50;
  let y = 130;
  doc.font('Times-Bold').fontSize(10).fillColor('#ffffff');
  doc.rect(x0, y - 6, cols.reduce((a, b) => a + b), 24).fill(BLUE);
  doc.fillColor('#ffffff');
  doc.text('Draw', x0 + 8, y, { width: cols[0] });
  doc.text('Amount', x0 + cols[0] + 8, y, { width: cols[1] });
  doc.text('Phase', x0 + cols[0] + cols[1] + 8, y, { width: cols[2] });
  doc.text('Time', x0 + cols[0] + cols[1] + cols[2] + 8, y, { width: cols[3] });
  y += 24;
  client.phases.forEach((p, i) => {
    if (i % 2 === 0) { doc.rect(x0, y - 6, cols.reduce((a, b) => a + b), 22).fill(LIGHT); }
    doc.fillColor(DARK).font('Times-Roman').fontSize(10);
    doc.text(p.drawPct + '%', x0 + 8, y, { width: cols[0] });
    doc.text(p.drawPct > 0 ? money(store.phaseAmount(client, p)) : '—', x0 + cols[0] + 8, y, { width: cols[1] });
    doc.text(p.name, x0 + cols[0] + cols[1] + 8, y, { width: cols[2] });
    doc.text(p.time, x0 + cols[0] + cols[1] + cols[2] + 8, y, { width: cols[3] });
    y += 22;
  });
  doc.rect(x0, y - 6, cols.reduce((a, b) => a + b), 26).fill(BLUE);
  doc.fillColor('#ffffff').font('Times-Bold').fontSize(11);
  doc.text('TOTAL', x0 + 8, y, { width: cols[0] + cols[1] });
  doc.text(money(total), x0 + cols[0] + 8, y, { width: cols[1] + cols[2] });
  y += 40;
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
  // Pool configuration summary from specs
  const s = client.specs;
  sectionTitle(doc, 'Pool Configuration');
  const conf = [];
  conf.push(`Pool: ${s.shape}${s.sizeDetails ? ', ' + s.sizeDetails : ''}`);
  if (s.hotTub.included) conf.push(`Spa / hot tub: ${s.hotTub.details || 'included'}`);
  if (s.sunShelf.included) conf.push(`Sun shelf: ${s.sunShelf.details || 'included'}`);
  if (s.spillover.included) conf.push(`Spillover: ${s.spillover.details || 'included'}`);
  if (s.ledgeSeating.included) conf.push(`Ledge / seating: ${s.ledgeSeating.style}${s.ledgeSeating.details ? ' — ' + s.ledgeSeating.details : ''}`);
  if (s.waterFeature.included) conf.push(`Water feature: ${s.waterFeature.details || 'included'}`);
  if (s.jets) conf.push(`Jets: ${s.jets}`);
  if (s.ledLights) conf.push(`LED lights: ${s.ledLights}`);
  if (s.equipmentPad) conf.push(`Equipment pad location: ${s.equipmentPad}`);
  for (const a of (s.addOns || [])) conf.push(`${a.label}${a.value ? ': ' + a.value : ''}`);
  bullets(doc, conf);
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
  for (const brand of brandOrder) {
    const brandTiers = tierOrder.filter(t => groups[brand + '|' + t]);
    if (!brandTiers.length) continue;
    if (doc.y > doc.page.height - 160) doc.addPage();
    doc.moveDown(0.5);
    doc.font('Times-Bold').fontSize(12).fillColor(BLUE).text(brand, 50);
    for (const tier of brandTiers) {
      const fin = groups[brand + '|' + tier];
      if (doc.y > doc.page.height - 120) doc.addPage();
      doc.font('Times-Bold').fontSize(9).fillColor(MID).text(tier.toUpperCase(), 50, doc.y + 4);
      let cx = 50, cy = doc.y + 4;
      const sw = 12, colW = 165;
      doc.font('Times-Roman').fontSize(9).fillColor(DARK);
      for (const f of fin) {
        if (cx + colW > doc.page.width - 50) { cx = 50; cy += 18; }
        if (cy > doc.page.height - 80) { doc.addPage(); cy = doc.y; cx = 50; }
        // swatch: local cached image, else flat color
        const img = path.join(__dirname, '..', 'public', 'swatches', f.id + '.jpg');
        if (fs.existsSync(img)) {
          try { doc.image(img, cx, cy, { width: sw, height: sw }); }
          catch (e) { doc.rect(cx, cy, sw, sw).fill(f.color || '#999'); }
        } else {
          doc.rect(cx, cy, sw, sw).fill(f.color || '#999');
        }
        doc.rect(cx, cy, sw, sw).lineWidth(0.5).strokeColor('#9db8cc').stroke();
        const isSel = selected.has(f.name) || selected.has(f.brand + ' ' + f.name);
        doc.fillColor(DARK).font(isSel ? 'Times-Bold' : 'Times-Roman')
          .text((isSel ? '✓ ' : '') + f.name + (f.shimmer ? '*' : ''), cx + sw + 5, cy + 2, { width: colW - sw - 8, lineBreak: false });
        cx += colW;
      }
      doc.y = cy + 20;
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

  // Interior Finish Selection field — Adobe Sign text tag.
  // In raw PDF this shows as the {{...}} placeholder text; Adobe Sign replaces it
  // with an interactive required text field the signer types their color choice into.
  const fsBoxY = doc.y;
  const fsBoxH = 52;
  doc.rect(50, fsBoxY, doc.page.width - 100, fsBoxH).fill(LIGHT);
  doc.rect(50, fsBoxY, doc.page.width - 100, fsBoxH).lineWidth(0.75).strokeColor('#b8d0e8').stroke();
  doc.font('Times-Bold').fontSize(8.5).fillColor(MID)
    .text('INTERIOR FINISH SELECTION — type the Pebble Tec / Pebble Sheen finish name from the color chart:', 60, fsBoxY + 9);
  doc.font('Times-Roman').fontSize(9.5).fillColor(DARK)
    .text('{{Finish_Selection_es_:signer1:textfield:required}}', 60, fsBoxY + 28, { width: doc.page.width - 120 });
  doc.y = fsBoxY + fsBoxH + 4;
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
    doc.font('Times-Roman').fontSize(8).fillColor(i === 0 ? '#ffffff' : MID)
      .text(`— ${i + 1} of ${range.count} —`, 0, doc.page.height - 36, { align: 'center', width: doc.page.width, lineBreak: false });
    doc.page.margins.bottom = oldBottom;
  }
  doc.end();
  return done;
}

module.exports = { generate };
