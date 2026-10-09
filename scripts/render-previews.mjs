// Renders the widget preview PNGs (1024×1024, transparent outside the card) from dev/widget-previews.html
// with headless Edge, plus a copy cropped to the card for the README (docs/previews/<widget>-<theme>.png).
// Usage: `npm run previews [-- <id>…]` (set EDGE to the browser path if it isn't the default).
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const page = pathToFileURL(resolve('dev/widget-previews.html')).href;
const OUT = {
  'elec-dark': 'widgets/electricity/preview-dark.png',
  'elec-light': 'widgets/electricity/preview-light.png',
  'thermo-dark': 'widgets/thermostat/preview-dark.png',
  'thermo-light': 'widgets/thermostat/preview-light.png',
  'qa-dark': 'widgets/quickactions/preview-dark.png',
  'qa-light': 'widgets/quickactions/preview-light.png',
  'sa-dark': 'widgets/sensoralarms/preview-dark.png',
  'sa-light': 'widgets/sensoralarms/preview-light.png',
  'sd-dark': 'widgets/sensordots/preview-dark.png',
  'sd-light': 'widgets/sensordots/preview-light.png',
  'weather-dark': 'widgets/weather/preview-dark.png',
  'weather-light': 'widgets/weather/preview-light.png',
  'hm-dark': 'widgets/heatmap/preview-dark.png',
  'hm-light': 'widgets/heatmap/preview-light.png',
  'cam-dark': 'widgets/cameras/preview-dark.png',
  'cam-light': 'widgets/cameras/preview-light.png',
  'val-dark': 'widgets/values/preview-dark.png',
  'val-light': 'widgets/values/preview-light.png',
  'lc-dark': 'widgets/lights/preview-dark.png',
  'lc-light': 'widgets/lights/preview-light.png',
  'spark-dark': 'widgets/sparklines/preview-dark.png',
  'spark-light': 'widgets/sparklines/preview-light.png',
  'var-dark': 'widgets/variables/preview-dark.png',
  'var-light': 'widgets/variables/preview-light.png',
  'fb-dark': 'widgets/flows/preview-dark.png',
  'fb-light': 'widgets/flows/preview-light.png',
  'pb-dark': 'widgets/price/preview-dark.png',
  'pb-light': 'widgets/price/preview-light.png',
  'tm-dark': 'widgets/timers/preview-dark.png',
  'tm-light': 'widgets/timers/preview-light.png',
  'lk-dark': 'widgets/locks/preview-dark.png',
  'lk-light': 'widgets/locks/preview-light.png',
  'ct-dark': 'widgets/curtains/preview-dark.png',
  'ct-light': 'widgets/curtains/preview-light.png',
};

const only = process.argv.slice(2);
for (const [id, out] of Object.entries(OUT).filter(([id]) => !only.length || only.includes(id))) {
  // A fresh profile per run avoids stale cached files.
  const profile = mkdtempSync(join(tmpdir(), 'wk-previews-'));
  try {
    execFileSync(EDGE, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000', '--window-size=1024,1024',
      `--user-data-dir=${profile}`, `--screenshot=${resolve(out)}`, `${page}?p=${id}`,
    ], { stdio: 'ignore' });
    console.log('wrote', out);
    // The README shows the previews small, floated left of the text; the 1024×1024 frame is mostly empty
    // space, so crop to the card (its shadow included), scale to 480 px wide (120 px at 4x) and pad the
    // bottom to 420 px, so every image is as tall and the text beside it doesn't wrap under a short one.
    const [, widget, theme] = out.match(/^widgets\/(\w+)\/preview-(\w+)\.png$/);
    const cropped = `docs/previews/${widget}-${theme}.png`;
    mkdirSync('docs/previews', { recursive: true });
    const card = await sharp(await sharp(out).trim({ threshold: 1 }).toBuffer()).resize({ width: 480 }).toBuffer();
    const { height } = await sharp(card).metadata();
    await sharp(card).extend({ bottom: Math.max(0, 420 - height), background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 }).toFile(cropped);
    console.log('wrote', cropped);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
