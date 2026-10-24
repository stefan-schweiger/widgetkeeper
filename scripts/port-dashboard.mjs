// Ports a Homey dashboard (the Homey app's own) to a web dashboard on the active Homey: the same name, columns and
// widgets, with their settings, devices, titles and typed tile names. Homey's own widgets (light groups, device tiles …)
// can't run on a web dashboard and are left out; other apps' widgets come along as such.
//
//   npm run port-dashboard -- "Lilletoften 3"            by name (or by the dashboard's id)
//   npm run port-dashboard -- "Lilletoften 3" --dry-run  only says what it would do
//
// The web dashboard's id is the Homey dashboard's, so a re-run replaces it (keeping the theme and backdrop chosen on
// the web since) and each widget keeps its id: its tile names are copied from `<widget id>` to
// `web-<dashboard id>-<widget id>` (lib/TileNameService.ts). Running timers and Media's chosen speaker stay with the
// Homey dashboard's widgets. Like `test-dashboards.mjs`, it writes the app setting `webDashboards` through the Homey
// CLI's login, and the app's `normalize()` checks it on the next read.

import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { APP_ID, WEB_SETTING, DASHBOARDS, TILE_NAMES, MAX_WEB_DASHBOARDS, connect, widgetManifests } from './homey-session.mjs';

/** The web dashboards' limits (lib/WebDashboardService.ts). */
const MAX_COLUMNS = 6;
const MAX_WIDGETS = 60;

/**
 * A Homey dashboard as a web dashboard: `{dashboard, skipped, names}`. `manifests` are this app's widgets by id;
 * `skipped` lists what was left out (`{title, type, reason}`); `names` maps a ported widget's web instance id to the
 * Homey instance's (the tile names to copy). Columns past the sixth are added to the sixth.
 */
export function portDashboard(native, manifests, appId = APP_ID) {
  const own = `homey:app:${appId}:`;
  const dashboardId = String(native.id);
  const skipped = [];
  const names = {};
  let count = 0;
  const columns = [];
  for (const [c, column] of (native.columns ?? []).entries()) {
    const col = columns[Math.min(c, MAX_COLUMNS - 1)] ??= [];
    for (const widget of column.widgets ?? []) {
      const title = widget.titleHidden ? '' : String(widget.title ?? '').trim();
      const appWidgetId = widget.type === 'app_webview' ? widget.data?.appWidgetId : null;
      const label = widget.title || widget.data?.name || widget.type;
      if (!appWidgetId) { skipped.push({ title: label, type: widget.type, reason: "Homey's own widget" }); continue; }
      const ours = appWidgetId.startsWith(own);
      const type = ours ? appWidgetId.slice(own.length) : appWidgetId;
      const def = ours ? manifests[type] : null;
      if (ours && !def) { skipped.push({ title: label, type, reason: 'not a widget of this checkout' }); continue; }
      if (count >= MAX_WIDGETS) { skipped.push({ title: label, type, reason: `more than ${MAX_WIDGETS} widgets` }); continue; }
      const stored = widget.data?.settings ?? {};
      // Our widgets keep only their manifest's settings (a removed one stays in a Homey dashboard's data); another
      // app's keep theirs, as the web editor stores them.
      const ids = def ? new Set((def.settings ?? []).map(s => s.id)) : null;
      const settings = ids ? Object.fromEntries(Object.entries(stored).filter(([k]) => ids.has(k))) : { ...stored };
      const deviceIds = Array.isArray(widget.data?.deviceIds) ? widget.data.deviceIds.map(String) : [];
      col.push({ id: String(widget.id), type, title, settings, deviceIds });
      names[`web-${dashboardId}-${widget.id}`] = String(widget.id);
      count += 1;
    }
  }
  if (!columns.length) columns.push([]);
  return {
    dashboard: { id: dashboardId, name: String(native.name ?? '').slice(0, 60), theme: 'auto', background: 'default', columns },
    skipped,
    names,
  };
}

async function main() {
  const { values: opts, positionals } = parseArgs({ options: { 'dry-run': { type: 'boolean' } }, allowPositionals: true });
  const wanted = positionals.join(' ').trim();
  if (!wanted) throw new Error('Name the Homey dashboard to port: npm run port-dashboard -- "<name or id>"');
  const { api, close } = await connect();
  try {
    const all = Object.values(await api('GET', DASHBOARDS) ?? {});
    const found = all.filter(d => d.id === wanted || String(d.name ?? '').toLowerCase() === wanted.toLowerCase());
    if (found.length !== 1) {
      throw new Error(`${found.length ? 'Several' : 'No'} Homey dashboards called "${wanted}" (there are: ${all.map(d => `${d.name} (${d.id})`).join(', ')})`);
    }
    const { dashboard, skipped, names } = portDashboard(found[0], widgetManifests());
    const saved = await api('GET', WEB_SETTING);
    const current = Array.isArray(saved) ? saved : [];
    const before = current.find(d => d.id === dashboard.id);
    if (before) Object.assign(dashboard, { theme: before.theme ?? 'auto', background: before.background ?? 'default' });
    const ported = dashboard.columns.flat();
    console.log(`${dashboard.name}: ${ported.length} widgets in ${dashboard.columns.length} columns (${ported.map(x => x.type).join(', ')})`);
    for (const s of skipped) console.log(`  left out: ${s.title} (${s.type}): ${s.reason}`);
    if (!before && current.length >= MAX_WEB_DASHBOARDS) throw new Error(`There are already ${MAX_WEB_DASHBOARDS} web dashboards`);
    if (opts['dry-run']) { console.log(`Would ${before ? 'replace' : 'add'} web dashboard ${dashboard.id}.`); return; }

    const next = before ? current.map(d => (d.id === dashboard.id ? dashboard : d)) : [...current, dashboard];
    await api('PUT', WEB_SETTING, { value: next });
    // The tile names typed on the Homey dashboard, onto the web widgets (replacing what a run before copied).
    const tileNames = await api('GET', TILE_NAMES);
    const stored = tileNames && typeof tileNames === 'object' ? { ...tileNames } : {};
    let copied = 0;
    for (const key of Object.keys(stored)) if (key.startsWith(`web-${dashboard.id}-`)) delete stored[key];
    for (const [web, homey] of Object.entries(names)) {
      if (stored[homey]) { stored[web] = stored[homey]; copied += 1; }
    }
    await api('PUT', TILE_NAMES, { value: stored });
    console.log(`${before ? 'Replaced' : 'Added'} web dashboard ${dashboard.id}${copied ? `, with the tile names of ${copied} widgets` : ''}.`);
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
