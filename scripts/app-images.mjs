// The App Store images: the widget previews (widgets/<id>/preview-<theme>.png) as a tilted collage of columns
// on a gradient in the brand colour, laid out by dev/app-images.json. Used by render-app-images.mjs and
// render-previews.mjs (which re-renders them when it rendered a preview they use).
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

export const CONFIG = 'dev/app-images.json';
/** Homey's app image sizes (small and large required, xlarge optional), at the paths in .homeycompose/app.json. */
export const SIZES = {
  'assets/images/small.png': [250, 175],
  'assets/images/large.png': [500, 350],
  'assets/images/xlarge.png': [1000, 700],
};
// A card's box (its opaque part) is scaled to this width in the collage: the card widgets' own width in the
// 1024 px previews, so those are used as they are and the 880 px tile widgets are only scaled down.
const CARD = 800;
// Room kept around a card's box for its shadow (the previews' `0 12px 40px`), in preview pixels.
const SHADOW = 64;
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/** The config, checked: an unknown widget, a missing preview, a bad colour or a bad number throws. */
export function readConfig() {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const fail = msg => { throw new Error(`${CONFIG}: ${msg}`); };
  if (!['dark', 'light'].includes(config.theme)) fail('theme must be "dark" or "light"');
  if (!Array.isArray(config.columns) || !config.columns.length || config.columns.some(c => !Array.isArray(c) || !c.length)) {
    fail('columns must be a list of non-empty lists of widget ids');
  }
  const seen = new Set();
  for (const id of config.columns.flat()) {
    if (seen.has(id)) fail(`${id} is in it twice`);
    seen.add(id);
    if (!existsSync(`widgets/${id}/widget.compose.json`)) fail(`there's no widget ${id}`);
    if (!existsSync(previewOf(id, config.theme))) fail(`${previewOf(id, config.theme)} is missing (npm run previews)`);
  }
  for (const key of ['columnWidth', 'gap', 'stagger', 'tilt']) if (!Number.isFinite(config[key])) fail(`${key} must be a number`);
  if (config.columnWidth <= 0 || config.columnWidth > 1) fail('columnWidth must be above 0 and at most 1');
  const bg = config.background;
  const isColour = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  if (!bg || !Array.isArray(bg.stops) || bg.stops.length < 2 || !bg.stops.every(isColour)) fail('background.stops must be two or more #rrggbb colours');
  if (!Number.isFinite(bg.angle)) fail('background.angle must be a number');
  const glow = bg.glow;
  if (glow && (!isColour(glow.color) || !['opacity', 'x', 'y', 'radius'].every(k => Number.isFinite(glow[k])))) {
    fail('background.glow needs a #rrggbb color and numbers opacity, x, y and radius');
  }
  return config;
}

const previewOf = (id, theme) => `widgets/${id}/preview-${theme}.png`;

/** The preview files the images are made from. */
export function appImageSources(config = readConfig()) {
  return config.columns.flat().map(id => previewOf(id, config.theme));
}

/** A preview's card, scaled so its box is CARD wide, with the box's place in the image. */
async function card(file) {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] < 250) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) throw new Error(`${file} has no opaque card`);
  const left = Math.max(0, x0 - SHADOW), top = Math.max(0, y0 - SHADOW);
  const width = Math.min(info.width, x1 + 1 + SHADOW) - left, height = Math.min(info.height, y1 + 1 + SHADOW) - top;
  const f = CARD / (x1 + 1 - x0);
  if (f > 1) throw new Error(`${file}: its card is narrower than ${CARD} px, so it would be scaled up`);
  const image = await sharp(file).extract({ left, top, width, height })
    .resize(Math.round(width * f), Math.round(height * f), { kernel: 'lanczos3' }).png().toBuffer();
  return { image, dx: Math.round((x0 - left) * f), dy: Math.round((y0 - top) * f), height: Math.round((y1 + 1 - y0) * f) };
}

/** Every card on one transparent layer in the previews' scale, its columns centred and staggered, rotated by `tilt`. */
async function collage(config) {
  const columns = await Promise.all(config.columns.map(ids => Promise.all(ids.map(id => card(previewOf(id, config.theme))))));
  const heights = columns.map(cards => cards.reduce((sum, c) => sum + c.height, 0) + config.gap * (cards.length - 1));
  const tallest = Math.max(...heights);
  const width = columns.length * CARD + (columns.length - 1) * config.gap + 2 * SHADOW;
  const height = tallest + Math.abs(config.stagger) + 2 * SHADOW;
  const overlays = columns.flatMap((cards, i) => {
    const x = SHADOW + i * (CARD + config.gap);
    let y = SHADOW + (tallest - heights[i]) / 2 + Math.abs(config.stagger) / 2 + (i % 2 ? 1 : -1) * config.stagger / 2;
    return cards.map(c => {
      const overlay = { input: c.image, left: x - c.dx, top: Math.round(y) - c.dy };
      y += c.height + config.gap;
      return overlay;
    });
  });
  const layer = await sharp({ create: { width, height, channels: 4, background: CLEAR } }).composite(overlays).png().toBuffer();
  return sharp(layer).rotate(config.tilt, { background: CLEAR }).png().toBuffer();
}

/**
 * The background at w×h: a linear gradient through `stops` (evenly spaced) at `angle` degrees like CSS's
 * (0 runs upwards, 90 to the right), with an optional radial `glow` (its centre and radius fractions of the width).
 */
export function background({ stops, angle, glow }, w, h) {
  const a = angle * Math.PI / 180, dx = Math.sin(a), dy = -Math.cos(a);
  const half = (Math.abs(w * dx) + Math.abs(h * dy)) / 2;
  const line = `x1="${w / 2 - dx * half}" y1="${h / 2 - dy * half}" x2="${w / 2 + dx * half}" y2="${h / 2 + dy * half}"`;
  const linear = stops.map((c, i) => `<stop offset="${i / (stops.length - 1)}" stop-color="${c}"/>`).join('');
  const radial = glow ? `<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="${glow.x * w}" cy="${glow.y * h}" r="${glow.radius * w}">`
    + `<stop offset="0" stop-color="${glow.color}" stop-opacity="${glow.opacity}"/><stop offset="1" stop-color="${glow.color}" stop-opacity="0"/>`
    + '</radialGradient>' : '';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs>`
    + `<linearGradient id="l" gradientUnits="userSpaceOnUse" ${line}>${linear}</linearGradient>${radial}</defs>`
    + `<rect width="${w}" height="${h}" fill="url(#l)"/>${glow ? `<rect width="${w}" height="${h}" fill="url(#g)"/>` : ''}</svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

/** Renders every size in SIZES, each with one downscale of the collage, and returns the files written. */
export async function renderAppImages(config = readConfig()) {
  const layer = await collage(config);
  const { width: lw, height: lh } = await sharp(layer).metadata();
  for (const [out, [w, h]] of Object.entries(SIZES)) {
    const s = config.columnWidth * w / CARD;
    if (s > 1) throw new Error(`${CONFIG}: columnWidth ${config.columnWidth} would scale the previews up at ${w}×${h}`);
    const rw = Math.round(lw * s), rh = Math.round(lh * s);
    // Centre the scaled collage on a canvas at least w×h, then cut the frame out of its middle.
    const cw = Math.max(rw, w), ch = Math.max(rh, h);
    const scaled = await sharp(layer).resize(rw, rh, { kernel: 'lanczos3' }).png().toBuffer();
    const centred = await sharp({ create: { width: cw, height: ch, channels: 4, background: CLEAR } })
      .composite([{ input: scaled, left: Math.floor((cw - rw) / 2), top: Math.floor((ch - rh) / 2) }]).png().toBuffer();
    const frame = await sharp(centred).extract({ left: Math.floor((cw - w) / 2), top: Math.floor((ch - h) / 2), width: w, height: h })
      .png().toBuffer();

    await sharp(await background(config.background, w, h)).composite([{ input: frame }]).png({ compressionLevel: 9 }).toFile(out);
  }
  return Object.keys(SIZES);
}
