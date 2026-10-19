// Renders the Homey Community post's images (docs/forum/*.jpg): the showcase dashboards and the web dashboards views
// on the App Store images' brand background, as JPEGs at 2x the post's 690 px. Discourse turns a large PNG into a
// JPEG on a white background, so the transparent docs/showcase and docs/web PNGs showed in a white box (2026-10-19).
// Usage: `npm run forum-images` (after `npm run showcase` and `npm run web-showcase`).
import { mkdirSync, readdirSync } from 'node:fs';
import sharp from 'sharp';
import { background, readConfig } from './app-images.mjs';

const WIDTH = 1380;
const SOURCES = ['showcase', 'web'];

const config = readConfig();
mkdirSync('docs/forum', { recursive: true });
for (const dir of SOURCES) {
  for (const file of readdirSync(`docs/${dir}`).filter(f => f.endsWith('.png')).sort()) {
    const image = await sharp(`docs/${dir}/${file}`).resize({ width: WIDTH, kernel: 'lanczos3' }).png().toBuffer();
    const { width, height } = await sharp(image).metadata();
    const out = `docs/forum/${dir}-${file.replace(/\.png$/, '.jpg')}`;
    await sharp(await background(config.background, width, height)).composite([{ input: image }])
      .jpeg({ quality: 88, mozjpeg: true }).toFile(out);
    console.log('wrote', out, `(${width}×${height})`);
  }
}
