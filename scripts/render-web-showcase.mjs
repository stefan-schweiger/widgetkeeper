// Renders the web dashboards showcase (docs/web/<view>.png) from dev/web-showcase.html with headless Edge: the web
// dashboards page with the made-up home's widgets, in a drawn browser window, at 2x on a transparent background.
// Usage: `npm run web-showcase [-- dashboard front editor settings]` (default: all four).
// The page fetches /app.json and /locales/en.json, which a file:// page can't, so the repo root is served over HTTP
// on 127.0.0.1 while it renders: by a child process, since edge() blocks this one.
import { spawn } from 'node:child_process';
import { createReadStream, mkdirSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadIcons, edge } from './headless.mjs';

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg' };

if (process.argv[2] === '--serve') {
  // The child: serve the repo root on a free port and print it.
  const root = resolve('.');
  const server = createServer((req, res) => {
    const path = resolve(join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname)));
    if (path !== root && !path.startsWith(root + sep)) { res.writeHead(403).end(); return; }
    let file = path;
    try { if (statSync(file).isDirectory()) file = join(file, 'index.html'); statSync(file); } catch { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream' });
    createReadStream(file).pipe(res);
  });
  server.listen(0, '127.0.0.1', () => console.log(`PORT ${server.address().port}`));
} else {
  const VIEWS = ['dashboard', 'front', 'editor', 'settings'];
  const SCALE = 2;
  const only = process.argv.slice(2);
  const bad = only.filter(v => !VIEWS.includes(v));
  if (bad.length) throw new Error(`Unknown view: ${bad.join(', ')} (${VIEWS.join(', ')})`);

  await downloadIcons();
  mkdirSync('docs/web', { recursive: true });

  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--serve'], { stdio: ['ignore', 'pipe', 'inherit'] });
  const port = await new Promise((done, fail) => {
    child.stdout.on('data', (b) => { const m = /PORT (\d+)/.exec(String(b)); if (m) done(Number(m[1])); });
    child.on('exit', () => fail(new Error('The server stopped')));
  });
  try {
    for (const view of only.length ? only : VIEWS) {
      const url = `http://127.0.0.1:${port}/dev/web-showcase.html?v=${view}`;
      // First pass: the page reports its size.
      const dom = edge(['--window-size=1600,1100', '--dump-dom', url]);
      const width = Number(/data-width="(\d+)"/.exec(dom)?.[1]);
      const height = Number(/data-height="(\d+)"/.exec(dom)?.[1]);
      if (!width || !height) throw new Error(`No size for ${view}`);
      const out = `docs/web/${view}.png`;
      edge([`--window-size=${width},${height}`, `--force-device-scale-factor=${SCALE}`, '--default-background-color=00000000', `--screenshot=${resolve(out)}`, url]);
      console.log('wrote', out, `(${width}×${height} @${SCALE}x)`);
    }
  } finally {
    child.kill();
  }
}
