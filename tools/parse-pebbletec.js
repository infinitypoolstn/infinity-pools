const fs = require('fs');
const body = fs.readFileSync(__dirname + '/pebbletec-page.html', 'utf8');
const imgs = [...body.matchAll(/<img[^>]*src="([^"]+)"[^>]*alt="([^"]*)"[^>]*>/g)].map(m => ({ src: m[1], alt: m[2] }));
const imgs2 = [...body.matchAll(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]+)"[^>]*>/g)].map(m => ({ src: m[2], alt: m[1] }));
const all = [...imgs, ...imgs2];
all.forEach(c => console.log(JSON.stringify(c.alt), '|', c.src.slice(0, 140)));
// Also check for lazy-load data-src and product links
const links = [...body.matchAll(/href="(https:\/\/pebbletec\.com\/(?:product|finish)[^"]*)"/g)].map(m => m[1]);
console.log('--- product links ---');
[...new Set(links)].slice(0, 80).forEach(l => console.log(l));
