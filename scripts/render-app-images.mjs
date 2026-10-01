// Renders the app store PNGs (the hero photo, cropped to 10:7) from dev/app-images.html with headless Edge.
// Usage: `npm run app-images` (set EDGE to the browser path if it isn't the default).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const page = pathToFileURL(resolve('dev/app-images.html')).href;
const OUT = {
  'assets/images/small.png': [250, 175],
  'assets/images/large.png': [500, 350],
  'assets/images/xlarge.png': [1000, 700],
};

for (const [out, [w, h]] of Object.entries(OUT)) {
  // A fresh profile per run avoids stale cached files.
  const profile = mkdtempSync(join(tmpdir(), 'wk-app-images-'));
  try {
    execFileSync(EDGE, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      `--window-size=${w},${h}`, `--user-data-dir=${profile}`, `--screenshot=${resolve(out)}`, page,
    ], { stdio: 'ignore' });
    console.log('wrote', out);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
