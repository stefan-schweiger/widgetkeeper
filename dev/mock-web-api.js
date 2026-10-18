// A simulated Widgetkeeper app API for the web dashboards page (settings/dashboard.js), shared by web-preview.html
// and web-showcase.html. Load it before dashboard.js, from a served repo root (it fetches /app.json and
// /locales/<lang>.json). It answers the page's `fetch('/api/app/<appId>/…')` calls; everything else goes through.
// `mockWebApi({lang, dashboards, zones, devices, readings})`: the dashboards, and for the device and value pickers a
// made-up house (`zones`: id → [name, parent id]; `devices`: {id, name, zone, class, capabilities, icon};
// `readings`: capability → {title, type, units, …, value (or a function of the device)}).
function mockWebApi({ lang = 'en', dashboards = [], zones = {}, devices = [], readings = {} } = {}) {
  try { localStorage.setItem('widgetkeeper.web.key', 'preview'); } catch (e) { /* private mode */ }
  const loc = (text) => (text && typeof text === 'object' ? text[lang] || text.en : text) || '';

  let manifest = null;
  let strings = null;
  const ready = Promise.all([
    fetch('/app.json').then(r => r.json()).then((m) => { manifest = m; }),
    fetch(`/locales/${lang}.json`).then(r => r.json()).then((s) => { strings = s; }),
  ]);
  const pathOf = (z) => { const out = []; let p = zones[z][1]; while (p) { out.unshift(zones[p][0]); p = zones[p][1]; } return out; };
  const zoneOf = (d) => (d.zone ? { id: d.zone, name: zones[d.zone][0], path: pathOf(d.zone) } : null);
  const passes = (d, filter) => {
    if (!filter) return true;
    const any = (v) => String(v).split('|');
    if (filter.class && !any(filter.class).includes(d.class)) return false;
    if (filter.capabilities && !any(filter.capabilities).some(c => d.capabilities.includes(c))) return false;
    return true;
  };
  // The editor's sections, as lib/WebDashboardService.ts's settingSections() makes them (keep the two alike).
  const SUB_ROW = /^\s+–\s*/;
  const NUMBERED = /^(.*\S)\s+\d+$/;
  const capitalize = (text) => text.charAt(0).toLocaleUpperCase() + text.slice(1);
  function settingSections(settings) {
    const en = settings.map(s => (s.title && s.title.en) || s.id);
    const sub = en.map(t => SUB_ROW.test(t));
    const labels = new Map();
    const sections = [];
    let plain = null;
    for (let i = 0; i < settings.length;) {
      const title = loc(settings[i].title) || settings[i].id;
      let end = i + 1;
      while (!sub[i] && end < settings.length && sub[end]) end++;
      if (end > i + 1) {
        const enColon = en[i].indexOf(':');
        const colon = title.indexOf(':');
        labels.set(settings[i].id, enColon < 0 || colon < 0 ? title : capitalize(title.slice(colon + 1).trim()));
        for (let j = i + 1; j < end; j++) labels.set(settings[j].id, capitalize((loc(settings[j].title) || settings[j].id).replace(SUB_ROW, '')));
        sections.push({ kind: 'group', title: enColon < 0 || colon < 0 ? title : title.slice(0, colon).trim(),
          numbered: NUMBERED.test(enColon < 0 ? en[i] : en[i].slice(0, enColon)), ids: settings.slice(i, end).map(s => s.id) });
        plain = null;
        i = end;
        continue;
      }
      const base = !sub[i] && !en[i].includes(':') ? (NUMBERED.exec(en[i]) || [])[1] : undefined;
      let last = i;
      if (base) {
        while (last + 1 < settings.length && !sub[last + 1] && !sub[last + 2] && settings[last + 1].type === settings[i].type
          && (NUMBERED.exec(en[last + 1]) || [])[1] === base) last++;
      }
      if (last > i) {
        for (let j = i; j <= last; j++) labels.set(settings[j].id, loc(settings[j].title) || settings[j].id);
        sections.push({ kind: 'slots', ids: settings.slice(i, last + 1).map(s => s.id) });
        plain = null;
        i = last + 1;
        continue;
      }
      labels.set(settings[i].id, sub[i] ? capitalize(title.replace(SUB_ROW, '')) : title);
      if (!plain) sections.push({ kind: 'plain', ids: plain = [] });
      plain.push(settings[i].id);
      i++;
    }
    return { sections, labels };
  }

  async function answer(method, path, body) {
    await ready;
    const [p, qs] = path.split('?');
    const q = new URLSearchParams(qs || '');
    if (p === '/web/setup') {
      const widgets = Object.entries(manifest.widgets).map(([type, w]) => {
        const { sections, labels } = settingSections(w.settings || []);
        return {
          type,
          name: loc(w.name) || type,
          height: w.height ?? null,
          transparent: !!w.transparent,
          devices: w.devices ? { singular: w.devices.singular === true } : null,
          settings: (w.settings || []).map(s => ({
            id: s.id, type: s.type, title: loc(s.title) || s.id, label: labels.get(s.id), hint: loc(s.hint) || null, value: s.value ?? null,
            ...(typeof s.min === 'number' ? { min: s.min } : {}),
            ...(typeof s.max === 'number' ? { max: s.max } : {}),
            ...(s.values ? { values: s.values.map(v => ({ id: String(v.id), title: loc(v.title) || String(v.id) })) } : {}),
            ...(((type === 'values' || type === 'sparklines') && /^slot\d+$/.test(s.id)) || (type === 'charts' && /^chart\d$/.test(s.id)) ? { picker: 'capability' } : {}),
          })),
          sections,
        };
      });
      return { appId: 'com.thomassidor.widgetkeeper', homeyId: 'preview', language: lang, strings, widgets, dashboards };
    }
    if (p === '/web/devices') {
      const filter = manifest.widgets[q.get('type')]?.devices?.filter;
      return devices.filter(d => passes(d, filter))
        .map(d => ({ id: d.id, name: d.name, zone: zoneOf(d), icon: d.icon }))
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (p === '/web/values') {
      // Made-up readings: each device's capabilities as the value picker gets them (Sparklines and Charts: numbers only).
      const numbersOnly = q.get('type') === 'sparklines' || q.get('type') === 'charts';
      return devices
        .map(d => ({
          id: d.id, name: d.name, zone: zoneOf(d), icon: d.icon,
          caps: d.capabilities.filter(c => readings[c] && (!numbersOnly || readings[c].type === 'number'))
            .map((c, i) => ({ id: c, ...readings[c], value: typeof readings[c].value === 'function' ? readings[c].value(d, i) : readings[c].value })),
        }))
        .filter(d => d.caps.length)
        .sort((a, b) => a.name.localeCompare(b.name));
    }
    if (p === '/web/dashboards' && method === 'PUT') {
      const saved = { ...body, id: body.id || Math.random().toString(36).slice(2, 10) };
      dashboards = dashboards.filter(d => d.id !== saved.id).concat(saved);
      return saved;
    }
    if (p.startsWith('/web/dashboards/') && method === 'DELETE') {
      dashboards = dashboards.filter(d => d.id !== p.split('/').pop());
      return { removed: true };
    }
    if (p === '/web/autocomplete') return [];
    throw new Error(`Not in the preview: ${method} ${p}`);
  }
  const realFetch = window.fetch.bind(window);
  window.fetch = async (url, init = {}) => {
    const m = String(url).match(/^\/api\/app\/[^/]+(\/.*)$/);
    if (!m) return realFetch(url, init);
    try {
      const data = await answer(init.method || 'GET', m[1], init.body ? JSON.parse(init.body) : undefined);
      return new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500 });
    }
  };
}
