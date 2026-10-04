// Reads the app's diagnostics from the active Homey (the one `npx homey select` picked), through the
// Homey CLI's own login, so nobody has to copy the report out of the settings page.
//
//   npm run diagnostics                     status and the log
//   npm run diagnostics -- --device Aircon  plus one device's full capability details (id or part of a name)
//   npm run diagnostics -- --devices        plus the device list (quick actions, thermostats)
//   npm run diagnostics -- --json           the whole report as JSON
//   npm run diagnostics -- --heatmap <deviceId>:<capabilityId>[:<days>]   plus the heatmap widget's history for it (JSON)
//   npm run diagnostics -- --debug on|off   turns routine (debug) logging on or off first

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parseArgs } from 'node:util';

const require = createRequire(import.meta.url);
const APP_ID = JSON.parse(readFileSync(new URL('../.homeycompose/app.json', import.meta.url), 'utf8')).id;
const CLI = require.resolve('homey/bin/homey.mjs');

const { values: opts } = parseArgs({
  options: {
    device: { type: 'string' },
    devices: { type: 'boolean' },
    json: { type: 'boolean' },
    debug: { type: 'string' },
    heatmap: { type: 'string' },
  },
});

/** A request to the Homey's web API, authenticated as the CLI's logged-in user. */
function homeyApi(method, path, body) {
  const args = [CLI, 'api', 'raw', '-X', method, '--path', path, '--json'];
  if (body !== undefined) args.push('--body', JSON.stringify(body));
  let out;
  try {
    out = execFileSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // The CLI prints its error (e.g. the app is still starting) as JSON on stdout.
    out = err.stdout || '';
    if (!out.trim()) throw new Error(`${method} ${path} failed: ${(err.stderr || err.message).trim()}`);
  }
  const res = JSON.parse(out);
  if (res && typeof res === 'object' && 'error' in res && Object.keys(res).length === 1) {
    throw new Error(`${method} ${path}: ${typeof res.error === 'string' ? res.error : JSON.stringify(res.error)}`);
  }
  return res;
}

if (opts.debug !== undefined) {
  if (!['on', 'off'].includes(opts.debug)) throw new Error('--debug takes on or off');
  homeyApi('PUT', `/api/manager/apps/app/${APP_ID}/setting/debugLog`, { value: opts.debug === 'on' });
}

const params = new URLSearchParams();
if (opts.device) params.set('device', opts.device);
if (opts.heatmap) params.set('heatmap', opts.heatmap);
const query = params.size ? `?${params}` : '';
const report = homeyApi('GET', `/api/app/${APP_ID}/diagnostics${query}`);

if (opts.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const { log = [], devices, thermostats, device, heatmapHistory, ...status } = report;
  console.log(Object.entries(status).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join('\n'));
  if (opts.devices) {
    console.log('\nthermostats:', JSON.stringify(thermostats, null, 2));
    console.log('\ndevices:', JSON.stringify(devices, null, 2));
  }
  if (device) console.log('\ndevice:', JSON.stringify(device, null, 2));
  if (heatmapHistory) console.log('\nheatmapHistory:', JSON.stringify(heatmapHistory));
  console.log(`\nlog (${log.length} lines):`);
  for (const line of log) console.log(line);
}
