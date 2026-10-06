// Renders the showcase dashboards (docs/showcase/<id>.png) from dev/showcase.html with headless Edge:
// a made-up home's dashboards on a drawn tablet, at 2x on a transparent background.
// Usage: `npm run showcase [-- <id>…]` (default: every dashboard in dev/showcase-data.js).
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { downloadIcons, edge } from './headless.mjs';

const page = pathToFileURL(resolve('dev/showcase.html')).href;
const SCALE = 2;
// The dashboard ids: the keys of `window.SHOWCASE` (each followed by its `title`).
const ALL = [...readFileSync('dev/showcase-data.js', 'utf8').matchAll(/^ {4}(\w+): \{\r?\n {6}title:/gm)].map(m => m[1]);

await downloadIcons();
mkdirSync('docs/showcase', { recursive: true });

const only = process.argv.slice(2);
for (const id of only.length ? only : ALL) {
  const url = `${page}?d=${id}`;
  // First pass: the page reports its size, and how far each column runs past the screen's bottom.
  const dom = edge(['--window-size=2000,1400', '--dump-dom', url]);
  const width = Number(/data-width="(\d+)"/.exec(dom)?.[1]);
  const height = Number(/data-height="(\d+)"/.exec(dom)?.[1]);
  if (!width || !height) throw new Error(`No size for ${id}`);
  const overflow = /data-overflow="([^"]*)"/.exec(dom)?.[1].split(',').map(Number) || [];
  overflow.forEach((px, i) => { if (px > 0) console.warn(`${id}: column ${i + 1} runs ${px} px off the screen`); });
  const out = `docs/showcase/${id}.png`;
  edge([`--window-size=${width},${height}`, `--force-device-scale-factor=${SCALE}`, '--default-background-color=00000000', `--screenshot=${resolve(out)}`, url]);
  console.log('wrote', out, `(${width}×${height} @${SCALE}x; columns end ${overflow.map(px => `${-px}`).join('/')} px above the bottom)`);
}
