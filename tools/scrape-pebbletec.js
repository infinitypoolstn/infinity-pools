// One-time scrape of pebbletec.com all-finishes page to harvest finish names + swatch image URLs
const https = require('https');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36', 'Accept': 'text/html' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    }).on('error', reject);
  });
}

(async () => {
  const { status, body } = await get('https://pebbletec.com/products/all-finishes/');
  console.log('HTTP', status, 'len', body.length);
  // Dump image tags and nearby text for inspection
  const imgs = [...body.matchAll(/<img[^>]+>/g)].map(m => m[0]);
  console.log('img tags:', imgs.length);
  require('fs').writeFileSync(__dirname + '/pebbletec-page.html', body, 'utf8');
})().catch(e => console.error('ERR', e.message));
