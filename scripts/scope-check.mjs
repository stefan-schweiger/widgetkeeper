// Which of the app's doors a personal API key opens: for checking a narrow key (one the user makes with a few boxes
// ticked) against the app's own API, a widget's route and the app settings. Read-only: it starts nothing and sets
// nothing, and it prints statuses and setting names only, never the key or a setting's value.
//
//   HOMEY_TOKEN=<personal API key> HOMEY_ADDRESS=http://<the Homey's IP> node scripts/scope-check.mjs
//
// HOMEY_ADDRESS may also be `https://<homeyId>.connect.athom.com` (Homey's cloud relay), to check from away.

import { readFileSync } from 'node:fs';

const APP_ID = JSON.parse(readFileSync(new URL('../.homeycompose/app.json', import.meta.url), 'utf8')).id;
const { HOMEY_TOKEN: token, HOMEY_ADDRESS: address } = process.env;
if (!token || !address) {
  console.error('Set HOMEY_TOKEN (a personal API key) and HOMEY_ADDRESS (http://<the Homey\'s IP>).');
  process.exit(1);
}
const base = address.replace(/\/+$/, '');

/** One GET with the key: the status and the parsed answer (null when it isn't JSON). */
async function get(path) {
  const res = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  const text = await res.text();
  let body = null;
  try { body = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, body, error: res.ok ? null : (body?.error ?? body?.message ?? text).toString().slice(0, 120) };
}

const me = await get('/api/manager/sessions/session/me');
console.log(`Key's scopes: ${me.status === 200 ? (me.body?.scopes ?? []).join(', ') || '(none)' : `${me.status} ${me.error}`}`);

const checks = [
  ['App API (web dashboards address)', `/api/app/${APP_ID}/web/address`, () => 'answered'],
  ['A widget route (Clock /clock)', `/api/app/${APP_ID}/widget/clock/api/clock`, () => 'answered'],
  ['App settings (names only)', `/api/manager/apps/app/${APP_ID}/setting`, body => (
    body && typeof body === 'object' ? `readable: ${Object.keys(body).sort().join(', ') || '(none)'}` : 'answered'
  )],
];
for (const [label, path, describe] of checks) {
  const r = await get(path);
  console.log(`${label}: ${r.status} ${r.status < 300 ? describe(r.body) : r.error}`);
}
