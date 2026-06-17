const fs = require('fs');
const { PDFParse } = require('pdf-parse');

const src = 'H:\\My Drive\\Jobs\\1533 Harding\\1533 Harding Pl (4.08.26) SIGNED.pdf';
(async () => {
  const parser = new PDFParse({ data: new Uint8Array(fs.readFileSync(src)) });
  const result = await parser.getText();
  fs.writeFileSync(__dirname + '\\contract-text.txt', result.text, 'utf8');
  console.log('chars:', result.text.length);
  await parser.destroy();
})().catch(e => { console.error(e.message); process.exit(1); });
