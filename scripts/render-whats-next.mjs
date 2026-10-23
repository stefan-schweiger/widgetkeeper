// Renders the 1.1.0 teaser, what's next in 1.1.0 (docs/whats-next-1.1.0.png), from dev/whats-next.html with headless
// Edge, at 2x. Its wide widgets panel shows docs/web/wide.png, from `npm run web-showcase -- wide`. The page fetches the
// popup's picture, which a file:// page can't, so the repo root is served while it renders, by render-web-showcase.mjs's
// server in a child process (edge() blocks this one).
// Usage: `npm run whats-next`.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { edge } from './headless.mjs';

const SCALE = 2;

if (!existsSync('docs/web/wide.png')) throw new Error('Render docs/web/wide.png first: npm run web-showcase -- wide');
mkdirSync('docs', { recursive: true });
const child = spawn(process.execPath, [resolve('scripts/render-web-showcase.mjs'), '--serve'], { stdio: ['ignore', 'pipe', 'inherit'] });
const port = await new Promise((done, fail) => {
  child.stdout.on('data', (b) => { const m = /PORT (\d+)/.exec(String(b)); if (m) done(Number(m[1])); });
  child.on('exit', () => fail(new Error('The server stopped')));
});
try {
  const url = `http://127.0.0.1:${port}/dev/whats-next.html`;
  // First pass: the page reports its size and its columns' heights.
  const dom = edge(['--window-size=1760,3000', '--dump-dom', url]);
  const width = Number(/data-width="(\d+)"/.exec(dom)?.[1]);
  const height = Number(/data-height="(\d+)"/.exec(dom)?.[1]);
  if (!width || !height) throw new Error('No size for the poster');
  const out = 'docs/whats-next-1.1.0.png';
  edge([`--window-size=${width},${height}`, `--force-device-scale-factor=${SCALE}`, `--screenshot=${resolve(out)}`, url]);
  console.log('wrote', out, `(${width}×${height} @${SCALE}x; columns ${/data-columns="([^"]*)"/.exec(dom)?.[1]} px)`);
} finally {
  child.kill();
}
