// Renders the 1.0.0 poster, what's new in 1.0.0 (docs/whats-new-1.0.0.png), from dev/whats-new.html with headless Edge,
// at 2x. Its web dashboards panel shows docs/web/settings.png, from `npm run web-showcase -- settings`.
// Usage: `npm run whats-new`.
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { downloadIcons, edge } from './headless.mjs';

const url = pathToFileURL(resolve('dev/whats-new.html')).href;
const SCALE = 2;

if (!existsSync('docs/web/settings.png')) throw new Error('Render docs/web/settings.png first: npm run web-showcase -- settings');
await downloadIcons();
mkdirSync('docs', { recursive: true });
// First pass: the page reports its size and its columns' heights.
const dom = edge(['--window-size=1760,3000', '--dump-dom', url]);
const width = Number(/data-width="(\d+)"/.exec(dom)?.[1]);
const height = Number(/data-height="(\d+)"/.exec(dom)?.[1]);
if (!width || !height) throw new Error('No size for the poster');
const out = 'docs/whats-new-1.0.0.png';
edge([`--window-size=${width},${height}`, `--force-device-scale-factor=${SCALE}`, `--screenshot=${resolve(out)}`, url]);
console.log('wrote', out, `(${width}×${height} @${SCALE}x; columns ${/data-columns="([^"]*)"/.exec(dom)?.[1]} px)`);
