// The App Store images: the widget previews (widgets/<id>/preview-<theme>.png) as a tilted collage of columns
// on a gradient in the brand colour, with a drawn browser window of a web dashboard among them, laid out by
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
// A card's box (its opaque part) is scaled to this width in the collage: the card widgets' own width in the
// 1024 px previews, so those are used as they are and the 880 px tile widgets are only scaled down.
const CARD = 800;
// Room kept around a card's box for its shadow (the previews' `0 12px 40px`), in preview pixels.
const SHADOW = 64;
const CLEAR = { r: 0, g: 0, b: 0, alpha: 0 };

/**
 * A column's items: a widget id (one card), a list of ids (a row of cards side by side) or
 * `{browser: [[ids]], span, theme}` (the web dashboard's window, `span` cards wide, 2 if not given, with those columns
 * of cards in its page, in its own `theme` if given).
 */
const isBrowser = item => !!item && typeof item === 'object' && !Array.isArray(item);
const spanOf = item => typeof item === 'string' ? 1 : Array.isArray(item) ? item.length : item.span ?? 2;
const idsOf = item => typeof item === 'string' ? [item] : (isBrowser(item) ? item.browser : item).flat();
const themeOf = (item, config) => isBrowser(item) && item.theme || config.theme;
const THEMES = ['dark', 'light'];

/** The config, checked: an unknown widget, a missing preview, a bad colour or a bad number throws. */
export function readConfig() {
  const config = JSON.parse(readFileSync(CONFIG, 'utf8'));
  const fail = msg => { throw new Error(`${CONFIG}: ${msg}`); };
  if (!THEMES.includes(config.theme)) fail('theme must be "dark" or "light"');
  if (!Array.isArray(config.columns) || !config.columns.length || config.columns.some(c => !Array.isArray(c) || !c.length)) {
    fail('columns must be a list of non-empty lists');
  }
  for (const item of config.columns.flat()) {
    const ok = typeof item === 'string'
      || Array.isArray(item) && item.length && item.every(id => typeof id === 'string')
      || isBrowser(item) && Array.isArray(item.browser) && item.browser.length
        && item.browser.every(c => Array.isArray(c) && c.length && c.every(id => typeof id === 'string'))
        && (item.span === undefined || Number.isInteger(item.span) && item.span >= 1)
        && (item.theme === undefined || THEMES.includes(item.theme));
    if (!ok) fail(`${JSON.stringify(item)} isn't a widget id, a row of ids or {browser: [[ids]], span, theme}`);
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

/** Every widget in the images, the browser's too, with its preview. */
const sources = config => config.columns.flat()
  .flatMap(item => idsOf(item).map(id => ({ id, file: previewOf(id, themeOf(item, config)) })));

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

// The browser window's colours: those of dev/web-showcase.html's drawn browser, and the Plum backdrop of
// settings/dashboard.js's BACKGROUNDS for the page.
const BROWSER = {
  dark: { tabs: '#1B1C1F', tab: '#2A2B2F', address: '#1B1C1F', line: '#111217', text: '#E8EAED', muted: '#9AA0A6', page: '#1C1226', rim: '#FFFFFF', rimOpacity: 0.08 },
  light: { tabs: '#DEE1E6', tab: '#FFFFFF', address: '#F1F3F4', line: '#DADCE0', text: '#1F1F1F', muted: '#5F6368', page: '#EEE6F5', rim: '#000000', rimOpacity: 0.12 },
};
// Its chrome in preview pixels: the tab strip and the toolbar (about 1.4x the showcase's, so they still read in the
// small image), the page's padding and gap, its header, and the window's corner.
const TABS = 64, TOOLBAR = 68, PAD = 56, INNER_GAP = 28, HEADER = 100, CORNER = 24;

/**
 * The web dashboard's window, `width` wide and 16:10, drawn the way the previews draw text (bars, no words): the tab,
 * the address, then the page on its backdrop with a header and the columns of cards, cut off at the bottom like a
 * page you'd scroll. Returned like a card, with its shadow.
 */
async function browser(columns, theme, width) {
  const c = BROWSER[theme];
  const height = Math.round(width * 10 / 16), top = TABS + TOOLBAR;
  const inner = Math.floor((width - 2 * PAD - (columns.length - 1) * INNER_GAP) / columns.length);
  const cards = await Promise.all(columns.map(ids => Promise.all(ids.map(id => card(previewOf(id, theme), inner)))));
  // The page, laid out without a bottom, then cut to the window.
  const overlays = cards.flatMap((list, i) => {
    let y = HEADER;
    return list.map(k => {
      const overlay = { input: k.image, left: PAD + i * (inner + INNER_GAP) - k.dx, top: y - k.dy, bottom: y - k.dy + k.full };
      y += k.height + INNER_GAP;
      return overlay;
    });
  });
  const pageHeight = Math.max(height, ...overlays.map(o => o.bottom));
  const pageArt = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${pageHeight}">`
    + `<rect width="${width}" height="${pageHeight}" fill="${c.page}"/>`
    + `<path d="M${PAD + 12} ${HEADER / 2 - 12}l-12 12 12 12" fill="none" stroke="${c.muted}" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<rect x="${PAD + 36}" y="${HEADER / 2 - 11}" width="150" height="22" rx="11" fill="${c.text}"/>`
    + [0, 1, 2].map(i => `<circle cx="${width - PAD - 13 - i * 56}" cy="${HEADER / 2}" r="13" fill="none" stroke="${c.muted}" stroke-width="4"/>`).join('')
    + '</svg>';
  const page = await sharp(Buffer.from(pageArt)).composite(overlays.map(({ bottom, ...o }) => o)).png().toBuffer();
  const viewport = await sharp(page).extract({ left: 0, top: 0, width, height: height - top }).png().toBuffer();

  // The chrome: the traffic lights, one tab (an icon and its title), the toolbar's arrows and the address.
  const arrow = (x, d, colour) => `<path transform="translate(${x} ${TABS + TOOLBAR / 2 - 15}) scale(1.25)" d="${d}" fill="none" stroke="${colour}" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>`;
  const chromeArt = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="${width}" height="${TABS}" fill="${c.tabs}"/>`
    + ['#FF5F57', '#FEBC2E', '#28C840'].map((fill, i) => `<circle cx="${36 + i * 30}" cy="${TABS / 2}" r="10" fill="${fill}"/>`).join('')
    + `<path d="M140 ${TABS}V${30}a16 16 0 0 1 16-16h308a16 16 0 0 1 16 16V${TABS}z" fill="${c.tab}"/>`
    + `<rect x="162" y="${TABS / 2 - 3}" width="22" height="22" rx="6" fill="#8A6BEA"/>`
    + `<rect x="198" y="${TABS / 2 + 2}" width="170" height="12" rx="6" fill="${c.text}"/>`
    + `<rect y="${TABS}" width="${width}" height="${TOOLBAR}" fill="${c.tab}"/>`
    + arrow(26, 'M19 12H5M11 6l-6 6 6 6', c.muted) + arrow(72, 'M5 12h14M13 6l6 6-6 6', c.muted)
    + arrow(118, 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5', c.muted)
    + `<rect x="170" y="${TABS + 14}" width="${width - 200}" height="${TOOLBAR - 28}" rx="${(TOOLBAR - 28) / 2}" fill="${c.address}"/>`
    + `<rect x="200" y="${TABS + TOOLBAR / 2 - 6}" width="130" height="12" rx="6" fill="${c.text}"/>`
    + `<rect x="342" y="${TABS + TOOLBAR / 2 - 6}" width="420" height="12" rx="6" fill="${c.muted}" fill-opacity="0.6"/>`
    + `<rect y="${top - 2}" width="${width}" height="2" fill="${c.line}"/>`
    + '</svg>';
  const rounded = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${CORNER}"/></svg>`);
  const rim = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect x="1" y="1" width="${width - 2}" height="${height - 2}" rx="${CORNER - 1}" fill="none" stroke="${c.rim}" stroke-opacity="${c.rimOpacity}" stroke-width="2"/></svg>`);
  const win = await sharp(Buffer.from(chromeArt))
    .composite([{ input: viewport, left: 0, top }, { input: rounded, blend: 'dest-in' }, { input: rim }]).png().toBuffer();

  // A shadow like the cards': dark, blurred and a little lower, in the same room around it.
  const shadow = await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width + 2 * SHADOW}" height="${height + 2 * SHADOW}">`
    + `<rect x="${SHADOW}" y="${SHADOW + 16}" width="${width}" height="${height - 16}" rx="${CORNER}" fill="#000" fill-opacity="0.5"/></svg>`))
    .blur(18).png().toBuffer();
  const image = await sharp(shadow).composite([{ input: win, left: SHADOW, top: SHADOW }]).png().toBuffer();
  return { image, dx: SHADOW, dy: SHADOW, height };
}

/**
 * Every item on one transparent layer in the previews' scale, rotated by `tilt`. A column is as wide as its widest
 * item (a card, a row's cards or the browser's span) with the narrower ones centred; the columns are centred and
 * staggered. A row's cards line up on the side facing the column's middle, so rows above and below the browser
 * close up to it.
 */
async function collage(config) {
  const across = n => n * CARD + (n - 1) * config.gap;
  const columns = await Promise.all(config.columns.map(async items => {
    const width = across(Math.max(...items.map(spanOf)));
    const pieces = await Promise.all(items.map(async (item, k) => {
      if (isBrowser(item)) return { cards: [{ ...await browser(item.browser, themeOf(item, config), across(spanOf(item))), x: 0 }], width: across(spanOf(item)) };
      const cards = await Promise.all([item].flat().map(async (id, i) => ({ ...await card(previewOf(id, config.theme)), x: i * (CARD + config.gap) })));
      const height = Math.max(...cards.map(c => c.height));
      const down = Array.isArray(item) && k < (items.length - 1) / 2;
      return { cards: cards.map(c => ({ ...c, y: down ? height - c.height : 0 })), width: across(cards.length) };
    }));
    for (const p of pieces) p.height = Math.max(...p.cards.map(c => (c.y ?? 0) + c.height));
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
      return p.cards.map(c => ({ input: c.image, left: Math.round(from + c.x) - c.dx, top: at + (c.y ?? 0) - c.dy }));
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
