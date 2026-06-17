// Test: uploading an invoice PDF auto-creates a Costs (Internal) line with the
// extracted total, and deleting the file removes the cost line.
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const B = 'http://localhost:4525';

async function makeInvoicePdf(file) {
  const doc = new PDFDocument();
  const out = fs.createWriteStream(file);
  const done = new Promise(r => out.on('finish', r));
  doc.pipe(out);
  doc.fontSize(18).text('BROTHERS POOL PLASTERING — INVOICE #2041');
  doc.moveDown().fontSize(12);
  doc.text('PebbleTec Tahoe Blue, 800 sq ft @ $8.05 .......... $6,440.00');
  doc.text('Spa surface, 51-100 sq ft ........................ $1,725.00');
  doc.text('Travel ........................................... $0.00');
  doc.moveDown();
  doc.fontSize(14).text('TOTAL DUE: $8,165.00');
  doc.end();
  await done;
}

(async () => {
  const tmp = path.join(__dirname, 'test-invoice.pdf');
  await makeInvoicePdf(tmp);

  const clients = (await (await fetch(B + '/api/bootstrap')).json()).clients;
  const c = clients[0];
  const before = c.costs.items.length;

  // upload as Material Invoices
  const fd = new FormData();
  fd.append('category', 'Material Invoices');
  fd.append('files', new Blob([fs.readFileSync(tmp)], { type: 'application/pdf' }), 'Brothers Invoice 2041.pdf');
  const up = await (await fetch(`${B}/api/clients/${c.id}/files`, { method: 'POST', body: fd })).json();
  const added = up._costsAdded || [];
  console.log('cost lines added:', JSON.stringify(added));
  console.log('extracted $8165?', added.length === 1 && added[0].amount === 8165 ? 'PASS' : 'FAIL');
  console.log('costs count:', before, '->', up.costs.items.length);
  const costItem = up.costs.items.find(i => i.fileId);
  console.log('linked item:', costItem.label, costItem.category, costItem.amount);

  // delete the file -> cost line should disappear
  const fileRec = up.files.find(f => f.originalName === 'Brothers Invoice 2041.pdf');
  const afterDel = await (await fetch(`${B}/api/clients/${c.id}/files/${fileRec.id}`, { method: 'DELETE' })).json();
  console.log('cost removed on file delete?', afterDel.costs.items.length === before ? 'PASS' : 'FAIL');

  fs.unlinkSync(tmp);
  console.log('INVOICE TEST DONE');
})().catch(e => { console.error('FAIL:', e.message); process.exit(1); });
