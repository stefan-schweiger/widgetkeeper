// The App Store images: the widget previews (widgets/<id>/preview-<theme>.png) as a tilted collage of columns
// on a gradient in the brand colour, with a drawn browser window of a web dashboard upright on top, laid out by
// dev/app-images.json. Used by render-app-images.mjs and render-previews.mjs (which re-renders them when it
// rendered a preview they use).
import { existsSync, readFileSync } from 'node:fs';
import sharp from 'sharp';

export const CONFIG = 'dev/app-images.json';
/** Homey's app image sizes (small and large required, xlarge optional), at the paths in .homeycompose/app.json. */
export const SIZES = {
  'assets/images/small.png': [250, 175],
  'assets/images/large.png': [500, 350],
  'assets/images/xlarge.png': [1000, 700],
};
/** A size's name in the config (`small`, `large`, `xlarge`): its file's. */
const sizeName = out => out.slice(out.lastIndexOf('/') + 1, -'.png'.length);
// A card's box (its opaque part) is scaled to this width in the collage: the card widgets' own width in the
// 1024 px previews, so those are used as they are and the 880 px tile widgets are only scaled down.
const CARD = 800;
// Room kept around a card's box for its shadow (the previews' `0 12px 40px`), in preview pixels.
const SHADOW = 64;
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };
// What `dim` darkens the collage with, under the browser: a black with the background's purple in it.
const DIM = { r: 8, g: 4, b: 20 };

/**
 * A column's items: a widget id (one card), a list of ids (a row of cards side by side) or `{space: n}` (room n cards
 * wide and 16:10, as the browser would take there; the browser on top covers it).
 */
const isSpace = item => !!item && typeof item === 'object' && !Array.isArray(item);
const spanOf = item => typeof item === 'string' ? 1 : Array.isArray(item) ? item.length : item.space;
const idsOf = item => typeof item === 'string' ? [item] : isSpace(item) ? [] : item;

/** The config, checked: an unknown widget, a missing preview, a bad colour or a bad number throws. */
export function readConfig() {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const fail = msg => { throw new Error(`${CONFIG}: ${msg}`); };
  const isColour = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  const isIds = list => Array.isArray(list) && list.length > 0 && list.every(id => typeof id === 'string');
  if (!['dark', 'light'].includes(config.theme)) fail('theme must be "dark" or "light"');
  if (!Array.isArray(config.columns) || !config.columns.length || config.columns.some(c => !Array.isArray(c) || !c.length)) {
    fail('columns must be a list of non-empty lists');
  }
  for (const item of config.columns.flat()) {
    if (typeof item !== 'string' && !isIds(item) && !(isSpace(item) && Number.isInteger(item.space) && item.space >= 1)) {
      fail(`${JSON.stringify(item)} isn't a widget id, a row of ids or {space: n}`);
    }
  }
  const b = config.browser;
  if (b !== undefined) {
    if (!b || !Array.isArray(b.columns) || !b.columns.length || !b.columns.every(isIds)) fail('browser.columns must be a list of non-empty lists of widget ids');
    if (!Array.isArray(b.page) || b.page.length !== 2 || !b.page.every(isColour)) fail('browser.page must be two #rrggbb colours');
    for (const key of ['width', 'toolbar']) {
      for (const size of Object.keys(SIZES).map(sizeName)) if (!(b[key]?.[size] > 0)) fail(`browser.${key}.${size} must be a number above 0`);
    }
  }
  const seen = new Set();
  for (const { id, file } of sources(config)) {
    if (seen.has(id)) fail(`${id} is in it twice`);
    seen.add(id);
    if (!existsSync(`widgets/${id}/widget.compose.json`)) fail(`there's no widget ${id}`);
    if (!existsSync(file)) fail(`${file} is missing (npm run previews)`);
  }
  for (const key of ['columnWidth', 'gap', 'stagger', 'tilt']) if (!Number.isFinite(config[key])) fail(`${key} must be a number`);
  if (config.columnWidth <= 0 || config.columnWidth > 1) fail('columnWidth must be above 0 and at most 1');
  if (config.dim !== undefined && !(config.dim >= 0 && config.dim < 1)) fail('dim must be at least 0 and under 1');
  const bg = config.background;
  if (!bg || !Array.isArray(bg.stops) || bg.stops.length < 2 || !bg.stops.every(isColour)) fail('background.stops must be two or more #rrggbb colours');
  if (!Number.isFinite(bg.angle)) fail('background.angle must be a number');
  const glow = bg.glow;
  if (glow && (!isColour(glow.color) || !['opacity', 'x', 'y', 'radius'].every(k => Number.isFinite(glow[k])))) {
    fail('background.glow needs a #rrggbb color and numbers opacity, x, y and radius');
  }
  return config;
}

const previewOf = (id, theme) => `widgets/${id}/preview-${theme}.png`;

/** Every widget in the images, the browser's too, with its preview. */
const sources = config => [...config.columns.flat().flatMap(idsOf), ...(config.browser?.columns.flat() ?? [])]
  .map(id => ({ id, file: previewOf(id, config.theme) }));

/** The preview files the images are made from. */
export function appImageSources(config = readConfig()) {
  return sources(config).map(s => s.file);
}

/** A preview's card, scaled so its box is `width` wide, with the box's place in the image and the image's height. */
async function card(file, width = CARD) {
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
  const w = Math.min(info.width, x1 + 1 + SHADOW) - left, h = Math.min(info.height, y1 + 1 + SHADOW) - top;
  const f = width / (x1 + 1 - x0);
  if (f > 1) throw new Error(`${file}: its card is narrower than ${width} px, so it would be scaled up`);
  const image = await sharp(file).extract({ left, top, width: w, height: h })
    .resize(Math.round(w * f), Math.round(h * f), { kernel: 'lanczos3' }).png().toBuffer();
  return {
    image, dx: Math.round((x0 - left) * f), dy: Math.round((y0 - top) * f), height: Math.round((y1 + 1 - y0) * f),
    full: Math.round(h * f),
  };
}

// The browser window, in the preview pixels it's drawn in: one toolbar (the traffic lights and the address, in the
// light colours of dev/web-showcase.html's drawn browser; a tab strip was lost in the 250 px image), the page's
// padding and gap, its header, the corner, and the room for its shadow. The page's text is Homey's dark tokens.
const BAR = 84, PAD = 56, INNER_GAP = 28, HEADER = 100, CORNER = 24, ROOM = 160;
const TOOLBAR = { bar: '#FFFFFF', address: '#F1F3F4', text: '#1F1F1F', line: '#DADCE0' };
const PAGE_TEXT = '#E4E4E7', PAGE_MUTED = '#999AA3';

/**
 * The web dashboard's window, `width` wide and 16:10, drawn the way the previews draw text (bars, no words): the
 * toolbar, `k` times its size, then the page on its `page` gradient with a header and the columns of cards, cut off at
 * the bottom like a page you'd scroll. Returned with its shadow and the room around it.
 */
async function browser({ columns, page: [from, to] }, theme, width, k) {
  const height = Math.round(width * 10 / 16), top = Math.round(BAR * k), view = height - top;
  const inner = Math.floor((width - 2 * PAD - (columns.length - 1) * INNER_GAP) / columns.length);
  const cards = await Promise.all(columns.map(ids => Promise.all(ids.map(id => card(previewOf(id, theme), inner)))));
  // The page, laid out without a bottom, then cut to the window.
  const overlays = cards.flatMap((list, i) => {
    let y = HEADER;
    return list.map(c => {
      const overlay = { input: c.image, left: PAD + i * (inner + INNER_GAP) - c.dx, top: y - c.dy, bottom: y - c.dy + c.full };
      y += c.height + INNER_GAP;
      return overlay;
    });
  });
  const pageHeight = Math.max(height, ...overlays.map(o => o.bottom));
  const pageArt = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${pageHeight}">`
    + `<defs><linearGradient id="p" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>`
    + `<rect width="${width}" height="${view}" fill="url(#p)"/>`
    + `<path d="M${PAD + 12} ${HEADER / 2 - 12}l-12 12 12 12" fill="none" stroke="${PAGE_MUTED}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<rect x="${PAD + 36}" y="${HEADER / 2 - 11}" width="150" height="22" rx="11" fill="${PAGE_TEXT}"/>`
    + [0, 1, 2].map(i => `<circle cx="${width - PAD - 13 - i * 56}" cy="${HEADER / 2}" r="13" fill="none" stroke="${PAGE_MUTED}" stroke-width="4"/>`).join('')
    + '</svg>';
  const pageImage = await sharp(Buffer.from(pageArt)).composite(overlays.map(({ bottom, ...o }) => o)).png().toBuffer();
  const viewport = await sharp(pageImage).extract({ left: 0, top: 0, width, height: view }).png().toBuffer();

  // The toolbar, drawn at k times its size: the traffic lights, the address field with the address in its middle.
  const w = width / k;
  const toolbar = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g transform="scale(${k})">`
    + `<rect width="${w}" height="${BAR}" fill="${TOOLBAR.bar}"/>`
    + ['#FF5F57', '#FEBC2E', '#28C840'].map((fill, i) => `<circle cx="${34 + i * 36}" cy="${BAR / 2}" r="13" fill="${fill}"/>`).join('')
    + `<rect x="150" y="${BAR / 2 - 22}" width="${w - 180}" height="44" rx="22" fill="${TOOLBAR.address}"/>`
    + `<rect x="${150 + (w - 180) / 2 - 170}" y="${BAR / 2 - 8}" width="340" height="16" rx="8" fill="${TOOLBAR.text}"/>`
    + `<rect y="${BAR - 2}" width="${w}" height="2" fill="${TOOLBAR.line}"/></g></svg>`;
  const rounded = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${CORNER}"/></svg>`);
  const rim = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1.5" y="1.5" width="${width - 3}" height="${height - 3}" rx="${CORNER - 1.5}" fill="none" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="3"/></svg>`);
  const win = await sharp(Buffer.from(toolbar))
    .composite([{ input: viewport, left: 0, top }, { input: rounded, blend: 'dest-in' }, { input: rim }]).png().toBuffer();

  // A deep shadow, a little lower, as it floats above the cards.
  const shadow = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width + 2 * ROOM}" height="${height + 2 * ROOM}">`
    + `<rect x="${ROOM}" y="${ROOM + 20}" width="${width}" height="${height - 20}" rx="${CORNER}" fill="#000" fill-opacity="0.75"/></svg>`))
    .blur(40).png().toBuffer();
  return sharp(shadow).composite([{ input: win, left: ROOM, top: ROOM }]).png().toBuffer();
}

/**
 * Every card on one transparent layer in the previews' scale, rotated by `tilt`. A column is as wide as its widest
 * item (a card, a row's cards or a space) with the narrower ones centred; the columns are centred and staggered.
 * A row's cards line up on the side facing the column's middle, so rows above and below a space close up to it.
 */
async function collage(config) {
  const across = n => n * CARD + (n - 1) * config.gap;
  const columns = await Promise.all(config.columns.map(async items => {
    const width = across(Math.max(...items.map(spanOf)));
    const pieces = await Promise.all(items.map(async (item, k) => {
      if (isSpace(item)) return { cards: [], width: across(item.space), height: Math.round(across(item.space) * 10 / 16) };
      const cards = await Promise.all([item].flat().map(async (id, i) => ({ ...await card(previewOf(id, config.theme)), x: i * (CARD + config.gap) })));
      const height = Math.max(...cards.map(c => c.height));
      const down = Array.isArray(item) && k < (items.length - 1) / 2;
      return { cards: cards.map(c => ({ ...c, y: down ? height - c.height : 0 })), width: across(cards.length), height };
    }));
    return { width, pieces, height: pieces.reduce((sum, p) => sum + p.height, 0) + config.gap * (pieces.length - 1) };
  }));
  const tallest = Math.max(...columns.map(c => c.height));
  const width = columns.reduce((sum, c) => sum + c.width, 0) + (columns.length - 1) * config.gap + 2 * SHADOW;
  const height = tallest + Math.abs(config.stagger) + 2 * SHADOW;
  let x = SHADOW;
  const overlays = columns.flatMap((column, i) => {
    let y = SHADOW + (tallest - column.height) / 2 + Math.abs(config.stagger) / 2 + (i % 2 ? 1 : -1) * config.stagger / 2;
    const left = x;
    x += column.width + config.gap;
    return column.pieces.flatMap(p => {
      const at = Math.round(y), from = left + (column.width - p.width) / 2;
      y += p.height + config.gap;
      return p.cards.map(c => ({ input: c.image, left: Math.round(from + c.x) - c.dx, top: at + c.y - c.dy }));
    });
  });
  const layer = await sharp({ create: { width, height, channels: 4, background: CLEAR } }).composite(overlays).png().toBuffer();
  return sharp(layer).rotate(config.tilt, { background: CLEAR }).png().toBuffer();
}

/**
 * The browser upright on top of a w×h image: `width` of the image wide, a little below the middle, its toolbar
 * `toolbar` px high there. Drawn at the size two cards take in the collage, then scaled; what runs off is cut.
 */
async function browserOnTop(config, w, h, size) {
  const drawn = 2 * CARD + config.gap, f = config.browser.width[size] * w / drawn;
  const image = await browser(config.browser, config.theme, drawn, config.browser.toolbar[size] / (BAR * f));
  const meta = await sharp(image).metadata();
  const iw = Math.round(meta.width * f), ih = Math.round(meta.height * f);
  const left = Math.round((w - iw) / 2), top = Math.round((h - ih) / 2 + h * 0.02);
  const cutLeft = Math.max(0, -left), cutTop = Math.max(0, -top);
  const input = await sharp(await sharp(image).resize(iw, ih, { kernel: 'lanczos3' }).png().toBuffer())
    .extract({ left: cutLeft, top: cutTop, width: Math.min(iw - cutLeft, w - Math.max(0, left)), height: Math.min(ih - cutTop, h - Math.max(0, top)) })
    .png().toBuffer();
  return { input, left: Math.max(0, left), top: Math.max(0, top) };
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

/**
 * Renders every size in SIZES, each with one downscale of the collage (darkened by `dim`) and the browser drawn
 * for it on top, and returns the files written.
 */
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
    let frame = await sharp(centred).extract({ left: Math.floor((cw - w) / 2), top: Math.floor((ch - h) / 2), width: w, height: h })
      .png().toBuffer();
    if (config.dim) {
      frame = await sharp(frame).composite([{ input: { create: { width: w, height: h, channels: 4, background: { ...DIM, alpha: config.dim } } }, blend: 'atop' }])
        .png().toBuffer();
    }
    const layers = [{ input: frame }];
    if (config.browser) layers.push(await browserOnTop(config, w, h, sizeName(out)));

    await sharp(await background(config.background, w, h)).composite(layers).png({ compressionLevel: 9 }).toFile(out);
  }
  return Object.keys(SIZES);
}
