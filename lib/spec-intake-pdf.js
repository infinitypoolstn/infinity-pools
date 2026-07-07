// Blank, fillable "Pool Specification — Sales Intake" PDF. This mirrors every
// field on the admin Pool Specs page (plus Owner/Builder + Address) as an
// interactive AcroForm so a sales rep can type into it on a computer, or print
// it and fill it out by hand. A free-text Notes box sits at the bottom.
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Same brand logo lookup as the contract generator: /public/logo.(png|jpg|jpeg).
function findLogo() {
  for (const name of ['logo.png', 'logo.jpg', 'logo.jpeg']) {
    const p = path.join(__dirname, '..', 'public', name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

const BLUE = '#0a5ea8';
const MEDBLUE = '#2f7dc2';
const DARK = '#16324a';
const MID = '#4a6b85';
const FIELD_BORDER = '#9db8cf';
const FIELD_BG = '#f5faff';

const M = 50;                 // page margin
const BOX_H = 20;             // text-field height
const LABEL_H = 12;           // room for a label above its field
const ROW_GAP = 10;           // vertical gap after a field row
const GUTTER = 12;            // horizontal gap between columns

/**
 * Generate the blank intake form. Resolves with the absolute file path once the
 * PDF is fully written to disk.
 */
async function generate({ outDir } = {}) {
  const dir = outDir || path.join(__dirname, '..', 'data', 'forms');
  fs.mkdirSync(dir, { recursive: true });
  const outFile = path.join(dir, 'pool-spec-intake.pdf');

  const doc = new PDFDocument({ size: 'LETTER', margins: { top: 50, bottom: 50, left: M, right: M } });
  const stream = fs.createWriteStream(outFile);
  const done = new Promise((resolve, reject) => {
    stream.on('finish', () => resolve(outFile));
    stream.on('error', reject);
  });
  doc.pipe(stream);

  // Fonts: built-in Helvetica keeps AcroForm fields fillable in every viewer; a
  // condensed display face (if bundled) is used only for static headings.
  let DISPLAY = 'Helvetica-Bold', BODY = 'Helvetica', BOLD = 'Helvetica-Bold';
  const fdir = path.join(__dirname, '..', 'public', 'fonts');
  try {
    const disp = path.join(fdir, 'RobotoCondensed-Bold.ttf');
    if (fs.existsSync(disp)) { doc.registerFont('Display', disp); DISPLAY = 'Display'; }
  } catch (e) { /* keep Helvetica */ }

  doc.font(BODY);
  doc.initForm();

  const PW = doc.page.width;
  const contentW = PW - 2 * M;
  const BOTTOM = doc.page.height - 55;
  const st = { y: 0 };
  let fieldSeq = 0;
  const uniq = base => `${base}_${fieldSeq++}`; // AcroForm field names must be unique

  // ---- primitives ---------------------------------------------------------
  function pageHeader(title, subtitle) {
    doc.rect(0, 0, PW, 96).fill(BLUE);
    const logo = findLogo();
    let textX = M;
    if (logo) {
      try { doc.image(logo, M, 20, { height: 56 }); textX = M + 150; } catch (e) { /* fall back to wordmark */ }
    }
    if (textX === M) {
      doc.fillColor('#ffffff').font(DISPLAY).fontSize(24).text('INFINITY POOLS', M, 28, { characterSpacing: 2, lineBreak: false });
    }
    doc.fillColor('#ffffff').font(DISPLAY).fontSize(16).text(title, textX, 30, { lineBreak: false });
    doc.font(BODY).fontSize(10).fillColor('#dbeafc').text(subtitle, textX, 54, { width: PW - textX - M });
    doc.fillColor(DARK);
    st.y = 118;
  }

  function newPage() {
    doc.addPage();
    pageHeader('Pool Specification — Sales Intake', 'Continued');
  }

  function need(h) {
    if (st.y + h > BOTTOM) newPage();
  }

  function banner(title) {
    need(30 + BOX_H);
    st.y += 6;
    doc.rect(M, st.y, contentW, 22).fill(MEDBLUE);
    doc.fillColor('#ffffff').font(DISPLAY).fontSize(12).text(title, M + 10, st.y + 5, { lineBreak: false, width: contentW - 20 });
    doc.fillColor(DARK);
    st.y += 22 + 8;
  }

  // Draw a single labeled text field at an explicit position.
  function fieldAt(label, x, y, w, name, { multiline = false, h = BOX_H } = {}) {
    doc.font(BODY).fontSize(8.5).fillColor(MID).text(label, x, y, { width: w, lineBreak: false });
    doc.formText(uniq(name), x, y + LABEL_H, w, h, {
      borderColor: FIELD_BORDER, backgroundColor: FIELD_BG,
      fontSize: 11, align: 'left', multiline,
    });
  }

  // Lay out one or more fields across the content width. Each spec: {label, name, flex?}.
  function fieldRow(specs) {
    need(LABEL_H + BOX_H + ROW_GAP);
    const totalFlex = specs.reduce((a, s) => a + (s.flex || 1), 0);
    const usableW = contentW - GUTTER * (specs.length - 1);
    let x = M;
    for (const s of specs) {
      const w = usableW * ((s.flex || 1) / totalFlex);
      fieldAt(s.label, x, st.y, w, s.name);
      x += w + GUTTER;
    }
    st.y += LABEL_H + BOX_H + ROW_GAP;
  }

  function checkbox(label, x, y, name) {
    doc.formCheckbox(uniq(name), x, y, 12, 12, { borderColor: FIELD_BORDER, backgroundColor: '#ffffff' });
    doc.font(BODY).fontSize(10).fillColor(DARK).text(label, x + 18, y + 1, { lineBreak: false });
  }

  // A "check to include" toggle on its own line.
  function includeRow(label, incName) {
    need(BOX_H + ROW_GAP);
    checkbox('Include ' + label, M, st.y + 2, incName);
    st.y += BOX_H + ROW_GAP;
  }

  // Fill the rest of the current page with ruled lines to write on. Each line is
  // also a transparent (borderless) fillable field, so the form works both
  // printed and on-screen. Stops at the bottom margin — never spills to a new page.
  function notesFill(bottomReserve = 0) {
    const limit = BOTTOM - bottomReserve;
    const LINE_GAP = 24;
    while (st.y + LINE_GAP <= limit) {
      const y = st.y;
      doc.formText(uniq('notes'), M, y, contentW, LINE_GAP - 6, { fontSize: 11, align: 'left' });
      doc.save().lineWidth(0.75).strokeColor(FIELD_BORDER)
        .moveTo(M, y + LINE_GAP - 6).lineTo(M + contentW, y + LINE_GAP - 6).stroke().restore();
      st.y += LINE_GAP;
    }
  }

  // A single checkbox line with a details field on the next row.
  function checkboxWithDetails(label, incName, detailLabel, detName) {
    need(18 + LABEL_H + BOX_H + ROW_GAP);
    checkbox(label, M, st.y, incName);
    st.y += 18;
    fieldRow([{ label: detailLabel, name: detName }]);
  }

  // ---- document -----------------------------------------------------------
  pageHeader('Pool Specification — Sales Intake', 'Complete on-site with the client. Return to the office to build the quote & contract.');

  banner('Project & Contact');
  fieldRow([
    { label: 'Owner / Builder', name: 'owner_builder' },
    { label: 'Phone', name: 'phone', flex: 0.7 },
  ]);
  fieldRow([{ label: 'Property Address', name: 'address' }]);
  fieldRow([
    { label: 'Email', name: 'email' },
    { label: 'Date', name: 'date', flex: 0.6 },
  ]);

  banner('Pool Base');
  // Shape as two checkboxes + freeform details.
  need(18);
  checkbox('Geometric', M, st.y, 'pb_shape_geometric');
  checkbox('Freeform', M + 130, st.y, 'pb_shape_freeform');
  st.y += 18;
  fieldRow([{ label: 'Freeform details (if freeform)', name: 'pb_freeform' }]);
  fieldRow([
    { label: 'Size', name: 'pb_size' },
    { label: 'Depth', name: 'pb_depth' },
  ]);
  fieldRow([
    { label: 'Number of Jets', name: 'pb_jets' },
    { label: 'Hayward Colorlogic 320 LED Lights', name: 'pb_led' },
  ]);
  fieldRow([{ label: 'Equipment pad location', name: 'pb_equippad' }]);
  checkboxWithDetails('Sun Shelf', 'pb_sunshelf_inc', 'Sun Shelf details', 'pb_sunshelf_det');
  checkboxWithDetails('Spillover', 'pb_spillover_inc', 'Spillover details', 'pb_spillover_det');
  checkboxWithDetails('Ledge / Seating', 'pb_ledge_inc', 'Ledge / Seating details', 'pb_ledge_det');

  newPage(); // Spa Base and the remaining sections start on page 2
  banner('Spa Base');
  includeRow('Spa Base', 'spa_inc');
  fieldRow([
    { label: 'Size', name: 'spa_size' },
    { label: 'Number of Jets', name: 'spa_jets' },
    { label: 'Hayward Colorlogic 320 LED Lights', name: 'spa_led' },
  ]);
  fieldRow([{ label: 'Additional Details', name: 'spa_det' }]);

  banner('Water Feature');
  includeRow('Water Feature', 'wf_inc');
  fieldRow([{ label: 'Size and Details', name: 'wf_det' }]);

  banner('Cold Plunge');
  includeRow('Cold Plunge', 'cp_inc');
  fieldRow([
    { label: 'Size and Details', name: 'cp_det' },
    { label: 'Hayward Colorlogic 320 LED Lights', name: 'cp_led' },
  ]);
  fieldRow([{ label: 'Additional Details', name: 'cp_addl' }]);

  banner('Fire Feature');
  includeRow('Fire Feature', 'ff_inc');
  fieldRow([{ label: 'Size and Details', name: 'ff_det' }]);

  banner('Additional Notes');
  notesFill(LABEL_H + BOX_H + 14); // leave room for the Sales Rep line at the very bottom

  // Sales Rep pinned to the bottom of the sheet.
  fieldAt('Sales Rep', M, BOTTOM - (LABEL_H + BOX_H), 260, 'sales_rep');

  doc.end();
  return done;
}

module.exports = { generate };
