// Shared by the render scripts: headless Edge, and the Homey library icons the mock devices use.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const EDGE = process.env.EDGE || 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/** Runs headless Edge with the given arguments and returns its stdout. */
export function edge(args) {
  // A fresh profile per run avoids stale cached files.
  const profile = mkdtempSync(join(tmpdir(), 'wk-render-'));
  try {
    return execFileSync(EDGE, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--virtual-time-budget=4000',
      `--user-data-dir=${profile}`, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  } finally {
    rmSync(profile, { recursive: true, force: true });
  }
}

// Homey's icon library, as the Homey app shows device icons. Not committed: fetched into temp/ (gitignored).
const ICONS = ['climate', 'christmas-lights', 'lock', 'light-standing', 'speaker', 'light-hanging', 'smoke-detector', 'air-purifier',
  'washing-machine', 'door', 'motion-sensor', 'light-spot', 'light-table', 'light-outdoor', 'coffee-machine', 'tv', 'inverter',
  'car-charger', 'dryer', 'socket', 'fridge', 'kettle', 'oven', 'garage-door', 'doorbell', 'router'];

/** Downloads the icons into temp/screenshot-icons.js (`window.ICONS`), which the dev pages load. */
export async function downloadIcons() {
  const icons = {};
  for (const name of ICONS) {
    const res = await fetch(`https://my.homey.app/img/devices/${name}.svg`);
    if (!res.ok) { console.warn(`icon ${name}: HTTP ${res.status}`); continue; }
    icons[name] = `data:image/svg+xml;base64,${Buffer.from(await res.text()).toString('base64')}`;
  }
  mkdirSync('temp', { recursive: true });
  writeFileSync('temp/screenshot-icons.js', `window.ICONS = ${JSON.stringify(icons)};\n`);
}
