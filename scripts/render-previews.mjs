// Renders the widget preview PNGs (1024×1024, transparent outside the card) from dev/widget-previews.html
// with headless Edge, plus a copy cropped to the card for the README (docs/previews/<widget>-<theme>.png),
// then the App Store images when a preview they use was rendered.
// Usage: `npm run previews [-- <id>…]` (set EDGE to the browser path if it isn't the default).
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { appImageSources, renderAppImages } from './app-images.mjs';
import { edge } from './headless.mjs';

const page = pathToFileURL(resolve('dev/widget-previews.html')).href;
// The page's frame ids are `<prefix>-dark` and `<prefix>-light`; each goes to widgets/<widget>/preview-<theme>.png.
const WIDGETS = {
  elec: 'electricity', thermo: 'thermostat', qa: 'quickactions', sa: 'sensoralarms', sd: 'sensordots', rh: 'roomhealth', weather: 'weather',
  hm: 'heatmap', cam: 'cameras', val: 'values', lc: 'lights', spark: 'sparklines', chart: 'charts', var: 'variables', vp: 'varpresets', fb: 'flows',
  pb: 'price', tm: 'timers', lk: 'locks', ct: 'curtains', mw: 'media', sk: 'stack', ck: 'clock', sp: 'spacer', tl: 'textline',
  ds: 'dayssince',
};
const OUT = Object.fromEntries(Object.entries(WIDGETS).flatMap(([prefix, widget]) =>
  ['dark', 'light'].map(theme => [`${prefix}-${theme}`, { widget, theme, out: `widgets/${widget}/preview-${theme}.png` }])));

const only = process.argv.slice(2);
const rendered = [];
for (const [id, { widget, theme, out }] of Object.entries(OUT).filter(([id]) => !only.length || only.includes(id))) {
  edge([
    '--force-device-scale-factor=1', '--default-background-color=00000000', '--window-size=1024,1024',
    `--screenshot=${resolve(out)}`, `${page}?p=${id}`,
  ], { virtualTime: null });
  console.log('wrote', out);
  // The README shows the previews small, floated left of the text; the 1024×1024 frame is mostly empty
  // space, so crop to the card (its shadow included), scale to 480 px wide (120 px at 4x) and pad the
  // bottom to 420 px, so every image is as tall and the text beside it doesn't wrap under a short one.
  const cropped = `docs/previews/${widget}-${theme}.png`;
  mkdirSync('docs/previews', { recursive: true });
  const card = await sharp(await sharp(out).trim({ threshold: 1 }).toBuffer()).resize({ width: 480 }).toBuffer();
  const { height } = await sharp(card).metadata();
  await sharp(card).extend({ bottom: Math.max(0, 420 - height), background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 }).toFile(cropped);
  console.log('wrote', cropped);
  rendered.push(out);
}

// The App Store images are made from some of the previews (dev/app-images.json): keep them current.
if (appImageSources().some(file => rendered.includes(file))) {
  for (const out of await renderAppImages()) console.log('wrote', out);
}
