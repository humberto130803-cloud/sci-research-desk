// Bundle the whole site into one self-contained .html file — CSS, JS and today's feed inlined.
// Useful for looking at the real thing before deploying, or for sending someone a snapshot.
//
//   node scripts/preview.mjs [outfile]

import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = (f) => path.join(ROOT, 'public', f);

const out = process.argv[2] || path.join(ROOT, 'preview.html');

const [html, css, js, feed] = await Promise.all([
  readFile(pub('index.html'), 'utf8'),
  readFile(pub('styles.css'), 'utf8'),
  readFile(pub('app.js'), 'utf8'),
  readFile(pub('data/feed.json'), 'utf8'),
]);

// </script> inside the JSON payload would close the tag early.
const safeFeed = feed.replace(/<\/script/gi, '<\\/script');

const bundled = html
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script src="app.js"></script>',
    `<script>window.__FEED__ = ${safeFeed};</script>\n<script>\n${js}\n</script>`
  );

await writeFile(out, bundled);
console.log(`Wrote ${out} (${(bundled.length / 1024).toFixed(0)} KB) — open it directly, no server needed.`);
