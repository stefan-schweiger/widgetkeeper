// Renders the README screenshots (docs/screenshots/*.png) from dev/screenshots.html with headless Edge:
// the real widgets with mock data, at a phone's widget width (358 px, 3x like an iPhone), on a transparent background.
// Usage: `npm run screenshots [-- <id>…]` (set EDGE to the browser path if it isn't the default).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { downloadIcons, edge } from './headless.mjs';

const page = pathToFileURL(resolve('dev/screenshots.html')).href;
const SHOTS = ['electricity', 'thermostat', 'quickactions', 'sensoralarms', 'sensordots', 'weather', 'heatmap', 'cameras', 'values', 'lights', 'sparklines', 'variables', 'flows', 'price', 'timers', 'locks', 'curtains'];
const WIDTH = 358;
const SCALE = 3;

await downloadIcons();
mkdirSync('docs/screenshots', { recursive: true });

const only = process.argv.slice(2);
for (const id of SHOTS.filter(s => !only.length || only.includes(s))) {
  const url = `${page}?s=${id}`;
  // First pass: the page reports its height once the fonts have loaded.
  const dom = edge([`--window-size=${WIDTH},2000`, '--dump-dom', url]);
  const height = Number(/data-height="(\d+)"/.exec(dom)?.[1]);
  if (!height) throw new Error(`No height for ${id}`);
  const out = `docs/screenshots/${id}.png`;
  edge([`--window-size=${WIDTH},${height}`, `--force-device-scale-factor=${SCALE}`, '--default-background-color=00000000', `--screenshot=${resolve(out)}`, url]);
  console.log('wrote', out, `(${WIDTH}×${height} @${SCALE}x)`);
}
