// Weekly accuracy check of the Pebble Tec finish library against
// https://pebbletec.com/products/all-finishes/ — runs Mondays 7:00 AM CST
// (scheduled in server.js) and on demand from Settings.
const https = require('https');
const fs = require('fs');
const path = require('path');
const store = require('./store');
const mailer = require('./mailer');

const SOURCE_URL = 'https://pebbletec.com/products/all-finishes/';
const SWATCH_DIR = path.join(__dirname, '..', 'public', 'swatches');

function get(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36' } }, res => {
      if ([301, 302, 307, 308].includes(res.statusCode) && res.headers.location && redirects < 5) {
        return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

// Brands we track (must match seed data brands)
const BRAND_PATHS = {
  pebbletec: 'PebbleTec', pebblesheen: 'PebbleSheen', pebblefina: 'PebbleFina', pebblebrilliance: 'PebbleBrilliance',
};

function titleCase(slug) {
  return slug.split('-').map(w => w === 'de' ? 'de' : w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

// Names that differ between our rate sheet and pebbletec.com slugs
const NAME_ALIASES = { 'Creme de Menthe': 'Crème de Menthe', 'Creme De Menthe': 'Crème de Menthe', 'Steel Gray': 'Steel Grey' };

async function scrapeSite() {
  const { status, body } = await get(SOURCE_URL);
  if (status !== 200) throw new Error('pebbletec.com returned HTTP ' + status);
  const html = body.toString('utf8');
  const found = []; // {brand, name, productUrl}
  const re = /href="https:\/\/pebbletec\.com\/product\/(pebbletec|pebblesheen|pebblefina|pebblebrilliance)\/([a-z0-9-]+)\/?"/g;
  let m;
  const seen = new Set();
  while ((m = re.exec(html)) !== null) {
    const brand = BRAND_PATHS[m[1]];
    let name = titleCase(m[2]);
    name = NAME_ALIASES[name] || name;
    const key = brand + '|' + name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ brand, name, productUrl: `https://pebbletec.com/product/${m[1]}/${m[2]}/` });
  }
  // swatch images
  const imgs = {};
  const ire = /<img[^>]*src="(https:\/\/pebbletec\.com\/wp-content\/uploads\/[^"]*(?:pt|ps|pf|pb)-sample-([a-z0-9-]+?)(?:-\d)?-\d+x\d+\.jpg)"/g;
  while ((m = ire.exec(html)) !== null) imgs[m[2]] = m[1];
  return { found, imgs };
}

async function run({ sendEmail = true } = {}) {
  const result = { ranAt: new Date().toISOString(), ok: true, added: [], missing: [], error: null };
  try {
    const { found } = await scrapeSite();
    if (found.length < 10) throw new Error('Page parsed but only ' + found.length + ' finishes found — page layout may have changed.');
    const siteKeys = new Set(found.map(f => (f.brand + '|' + f.name).toLowerCase()));
    const ours = store.data.finishes.filter(f => f.active && ['PebbleTec', 'PebbleSheen', 'PebbleFina', 'PebbleBrilliance'].includes(f.brand));
    const ourKeys = new Set(ours.map(f => (f.brand + '|' + f.name).toLowerCase()));

    // On the site but not in our library → possibly newly added
    for (const f of found) {
      if (!ourKeys.has((f.brand + '|' + f.name).toLowerCase())) result.added.push(f);
    }
    // In our library but no longer on the site → possibly discontinued
    for (const f of ours) {
      if (!siteKeys.has((f.brand + '|' + f.name).toLowerCase())) result.missing.push({ brand: f.brand, name: f.name, tier: f.tier });
    }

    if ((result.added.length || result.missing.length) && sendEmail) {
      const li = arr => arr.map(f => `<li><b>${f.brand}</b> — ${f.name}${f.tier ? ' (' + f.tier + ' tier)' : ''}${f.productUrl ? ` — <a href="${f.productUrl}">view</a>` : ''}</li>`).join('');
      await mailer.send({
        to: store.data.settings.pebbleCheckEmail || store.data.settings.companyEmail,
        subject: `Pebble Tec finish review needed — ${result.added.length} new, ${result.missing.length} removed`,
        html: `<p>The weekly Pebble Tec accuracy check found differences between your finish library and <a href="${SOURCE_URL}">pebbletec.com/products/all-finishes</a>:</p>
          ${result.added.length ? `<p><b>On pebbletec.com but NOT in your library (possibly new):</b></p><ul>${li(result.added)}</ul>` : ''}
          ${result.missing.length ? `<p><b>In your library but NO LONGER on pebbletec.com (possibly discontinued):</b></p><ul>${li(result.missing)}</ul>` : ''}
          <p>Review these in the app under <b>Design Library</b>, and confirm pricing with your plaster contractor before adding or retiring colors.</p>`,
      });
      store.addAlert(`Pebble Tec check: ${result.added.length} new / ${result.missing.length} removed finish(es) need review`, { type: 'warning' });
    } else if (sendEmail) {
      store.addAlert('Pebble Tec weekly check: library matches pebbletec.com — no action needed', { type: 'info' });
    }
  } catch (e) {
    result.ok = false; result.error = e.message;
    store.addAlert('Pebble Tec weekly check FAILED: ' + e.message, { type: 'error' });
    if (sendEmail) {
      await mailer.send({
        to: store.data.settings.pebbleCheckEmail || store.data.settings.companyEmail,
        subject: 'Pebble Tec weekly check failed',
        html: `<p>The Monday Pebble Tec accuracy check could not complete:</p><p style="color:#b00">${e.message}</p><p>Please check ${SOURCE_URL} manually.</p>`,
      });
    }
  }
  store.data.pebbleCheck = { lastRun: result.ranAt, lastResult: result };
  store.save();
  return result;
}

// Download swatch images locally so the design page and contract PDF work
// offline and don't hotlink. Best-effort; runs in background at startup.
async function cacheSwatches() {
  fs.mkdirSync(SWATCH_DIR, { recursive: true });
  for (const f of store.data.finishes) {
    if (!f.imageUrl) continue;
    const file = path.join(SWATCH_DIR, f.id + '.jpg');
    if (fs.existsSync(file)) { f.localImage = '/swatches/' + f.id + '.jpg'; continue; }
    try {
      const { status, body } = await get(f.imageUrl);
      if (status === 200 && body.length > 5000) {
        fs.writeFileSync(file, body);
        f.localImage = '/swatches/' + f.id + '.jpg';
      }
    } catch (e) { /* keep remote URL fallback */ }
  }
  store.save();
}

module.exports = { run, cacheSwatches, SOURCE_URL, SWATCH_DIR };
