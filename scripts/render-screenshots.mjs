// Renders the README screenshots (docs/screenshots/*.png) from dev/screenshots.html with headless Edge:
// the real widgets with mock data, at a phone's widget width (358 px, 3x like an iPhone), on a transparent background.
// Usage: `npm run screenshots [-- <id>…]` (set EDGE to the browser path if it isn't the default).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const page = pathToFileURL(resolve('dev/screenshots.html')).href;
const SHOTS = ['electricity', 'thermostat', 'quickactions', 'sensoralarms', 'weather', 'heatmap', 'cameras', 'values', 'lights'];
const WIDTH = 358;
const SCALE = 3;

// Homey's icon library, as the Homey app shows device icons. Not committed: fetched into temp/ (gitignored).
const ICONS = ['climate', 'christmas-lights', 'lock', 'light-standing', 'speaker', 'light-hanging', 'smoke-detector', 'air-purifier', 'washing-machine', 'door', 'motion-sensor'];
const icons = {};
for (const name of ICONS) {
  const res = await fetch(`https://my.homey.app/img/devices/${name}.svg`);
  if (!res.ok) { console.warn(`icon ${name}: HTTP ${res.status}`); continue; }
  icons[name] = `data:image/svg+xml;base64,${Buffer.from(await res.text()).toString('base64')}`;
}
mkdirSync('temp', { recursive: true });
writeFileSync('temp/screenshot-icons.js', `window.ICONS = ${JSON.stringify(icons)};\n`);
mkdirSync('docs/screenshots', { recursive: true });

function edge(args) {
  // A fresh profile per run avoids stale cached files.
  const profile = mkdtempSync(join(tmpdir(), 'wk-screenshots-'));
  try {
    return execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000',
      `--user-data-dir=${profile}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

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
