// Renders the widget preview PNGs (1024×1024, transparent outside the card) from dev/widget-previews.html
// with headless Edge. Usage: `npm run previews` (set EDGE to the browser path if it isn't the default).
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const page = pathToFileURL(resolve('dev/widget-previews.html')).href;
const OUT = {
  'elec-dark': 'widgets/electricity/preview-dark.png',
  'elec-light': 'widgets/electricity/preview-light.png',
  'thermo-dark': 'widgets/thermostat/preview-dark.png',
  'thermo-light': 'widgets/thermostat/preview-light.png',
};

for (const [id, out] of Object.entries(OUT)) {
  // A fresh profile per run avoids stale cached files.
  const profile = mkdtempSync(join(tmpdir(), 'wk-previews-'));
  try {
    execFileSync(EDGE, [
      '--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=1',
      '--default-background-color=00000000', '--window-size=1024,1024',
      `--user-data-dir=${profile}`, `--screenshot=${resolve(out)}`, `${page}?p=${id}`,
    ], { stdio: 'ignore' });
    console.log('wrote', out);
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}
