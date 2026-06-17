// Best-effort extraction of the total amount from an uploaded invoice PDF.
// Returns a number, or 0 if no amount could be found (user edits it in Costs).
const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const KEYED = /(?:grand\s*total|amount\s*due|balance\s*due|total\s*due|invoice\s*total|total)\s*[:\-]?\s*\$?\s*([\d,]{1,12}(?:\.\d{2})?)/gi;
const ANY_MONEY = /\$\s*([\d,]{1,12}\.\d{2})/g;

function toNum(s) {
  const n = Number(String(s).replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

async function extractInvoiceTotal(filePath) {
  if (!/\.pdf$/i.test(filePath)) return 0;
  let parser;
  try {
    parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(filePath)) });
    const { text } = await parser.getText();

    // Prefer amounts labeled total/amount due; among those take the largest
    // (line-item "total" columns are usually smaller than the grand total).
    const keyed = [...text.matchAll(KEYED)].map(m => toNum(m[1])).filter(n => n > 0);
    if (keyed.length) return Math.max(...keyed);

    // Fallback: the largest $x.xx figure anywhere in the document
    const any = [...text.matchAll(ANY_MONEY)].map(m => toNum(m[1])).filter(n => n > 0);
    if (any.length) return Math.max(...any);
    return 0;
  } catch (e) {
    return 0;
  } finally {
    if (parser) await parser.destroy().catch(() => {});
  }
}

module.exports = { extractInvoiceTotal };
