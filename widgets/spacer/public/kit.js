/*
 * The widgets' shared front-end kit, `window.WidgetkeeperKit`: the helpers every widget used to copy. Homey serves
 * each widget's folder and has no shared one, so it lives in the Spacer's (it has no code of its own) and every
 * index.html loads it first as `../spacer/kit.js`, as Charts loads `../electricity/chart.js`. The Smart Stack's
 * pages use the stack's copy; the tests load it before a widget (`test/helpers/loadWidget.ts`).
 */
(function () {
  const DAY = 864e5;

  /**
   * Flow Buttons' icons, also the icons of Days Since's tiles, Notes, Variable Presets and Media's buttons: drawn on a
   * 24 px grid with a 2 px round stroke (`fill: true` for a filled shape). The ids are the icon settings' (FLOW_ICONS
   * in lib/FlowService.ts, named in `flows.icons.<id>`); `npm run flow-icons` renders their previews from here.
   */
  const ICONS = {
    play: { fill: true, d: 'M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z' },
    power: { d: 'M12 3v8M7.05 6.05a7 7 0 1 0 9.9 0' },
    bulb: { d: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.6 10.8c.7.55 1.1 1.3 1.1 2.2h5c0-.9.4-1.65 1.1-2.2A6 6 0 0 0 12 3z' },
    sun: { d: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41' },
    moon: { d: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z' },
    home: { d: 'M3.5 11 12 3.8l8.5 7.2M6 9.3V20h4.5v-5.5h3V20H18V9.3' },
    leave: { d: 'M10 4H5.5A1.5 1.5 0 0 0 4 5.5v13A1.5 1.5 0 0 0 5.5 20H10M15 8l4 4-4 4M19 12H9' },
    bed: { d: 'M3 6v13M3 16h18v3M21 16v-3.5a2.5 2.5 0 0 0-2.5-2.5H11v6M7 13a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z' },
    lock: { d: 'M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11zM8 11V8a4 4 0 0 1 8 0v3' },
    shield: { d: 'M12 3 5 6v5.5c0 4.3 3 8 7 9.5 4-1.5 7-5.2 7-9.5V6l-7-3z' },
    bell: { d: 'M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 21h4' },
    flame: { d: 'M12 2.5c.8 3.2 5.5 5.3 5.5 10.5a5.5 5.5 0 0 1-11 0c0-2.3 1-4 2.3-5.2.2 2 1.1 3.2 2.3 3.2-.7-3-.3-5.9.9-8.5z' },
    snowflake: { d: 'M12 2v20M3.34 7l17.32 10M3.34 17 20.66 7M9.5 3.5 12 6l2.5-2.5M9.5 20.5 12 18l2.5 2.5' },
    fan: { d: 'M12 12c-1.6-4-1.2-9.2 2.4-9.4 3.6-.2 3.4 5.4-2.4 9.4zM12 12c4.2.6 8.6 3.6 7 6.9-1.6 3.2-6.6.6-7-6.9zM12 12c-2.6 3.3-7.4 5.8-9.4 2.8C.6 11.8 5.6 9 12 12z' },
    drop: { d: 'M12 3.5s-6 6.6-6 11a6 6 0 0 0 12 0c0-4.4-6-11-6-11z' },
    bolt: { d: 'M13 2.5 5 13.5h6l-1 8 8-11h-6l1-8z' },
    music: { d: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z' },
    tv: { d: 'M4.5 6h15A1.5 1.5 0 0 1 21 7.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 16.5v-9A1.5 1.5 0 0 1 4.5 6zM8 21h8M9 2.5 12 6l3-3.5' },
    clock: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 2' },
    star: { d: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.06 6.2L12 17.3l-5.56 2.9 1.06-6.2L3 9.6l6.2-.9L12 3z' },
    heart: { d: 'M12 20s-8-4.9-8-10.5A4.5 4.5 0 0 1 12 6.6a4.5 4.5 0 0 1 8 2.9C20 15.1 12 20 12 20z' },
    door: { d: 'M6 21V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5V21M4 21h16M14.5 12h.01' },
    window: { d: 'M5.5 3h13A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3zM12 3v18M4 12h16' },
    blinds: { d: 'M3 3.5h18M5 3.5V20h14V3.5M5 8h14M5 12h14M5 16h14' },
    garage: { d: 'M3 21V9l9-5.5L21 9v12M7 21v-9h10v9M7 15h10M7 18h10' },
    car: { d: 'M5 16H3.5v-3.5l2-5A1.5 1.5 0 0 1 6.9 6.5h10.2a1.5 1.5 0 0 1 1.4 1l2 5V16H19M9 16h6M3.5 12.5h17M7 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4zM17 14a2 2 0 1 0 0 4 2 2 0 0 0 0-4z' },
    sofa: { d: 'M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M3.5 11A1.5 1.5 0 0 1 5 12.5V14h14v-1.5a1.5 1.5 0 0 1 3 0V18H2v-5.5A1.5 1.5 0 0 1 3.5 11zM5 18v2M19 18v2' },
    coffee: { d: 'M4 9h12v6a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5V9zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 2.5v3M12 2.5v3' },
    utensils: { d: 'M7 3v18M4.5 3v5a2.5 2.5 0 0 0 5 0V3M17 21V3c-2 1-3.5 3.5-3.5 7.5V13H17' },
    washer: { d: 'M5.5 3h13A1.5 1.5 0 0 1 20 4.5v15a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-15A1.5 1.5 0 0 1 5.5 3zM12 9a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9zM7.5 6h.01M10.5 6h.01' },
    vacuum: { d: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM7 9h10M12 13.5h.01' },
    trash: { d: 'M4 6.5h16M9 6.5V4h6v2.5M6 6.5l1 13A1.5 1.5 0 0 0 8.5 21h7a1.5 1.5 0 0 0 1.5-1.5l1-13M10 10.5v6M14 10.5v6' },
    thermometer: { d: 'M14 14.76V4.5a2 2 0 0 0-4 0v10.26a4 4 0 1 0 4 0zM12 18v-6' },
    plug: { d: 'M9 2.5V7M15 2.5V7M6 7h12v4a6 6 0 0 1-12 0V7zM12 17v4.5' },
    wifi: { d: 'M2.5 8.5a14 14 0 0 1 19 0M5.5 12a9.5 9.5 0 0 1 13 0M8.5 15.5a5 5 0 0 1 7 0M12 19.5h.01' },
    camera: { d: 'M4.5 7h3l1.5-2.5h6L16.5 7h3A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5v-10A1.5 1.5 0 0 1 4.5 7zM12 10a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7z' },
    speaker: { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9a4 4 0 0 1 0 6M18.5 6.5a7.5 7.5 0 0 1 0 11' },
    mute: { d: 'M4 9.5h3.5L12 5.5v13l-4.5-4H4v-5zM16 9.5l5 5M21 9.5l-5 5' },
    umbrella: { d: 'M12 3a9 9 0 0 1 9 9H3a9 9 0 0 1 9-9zM12 12v6.5a2 2 0 0 1-4 0' },
    leaf: { d: 'M5 19C5 10 11 5 20 4c-1 9-6 15-15 15zM5 19l8-8' },
    paw: { d: 'M12 13c-2.5 0-5 3-5 5a2.5 2.5 0 0 0 2.5 2.5c1 0 1.5-.5 2.5-.5s1.5.5 2.5.5A2.5 2.5 0 0 0 17 18c0-2-2.5-5-5-5zM5.5 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM9 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM15 4.5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3zM18.5 9a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3z' },
    briefcase: { d: 'M4.5 7.5h15A1.5 1.5 0 0 1 21 9v9.5a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5V9a1.5 1.5 0 0 1 1.5-1.5zM9 7.5V5h6v2.5M3 13h18' },
    gift: { d: 'M4 8.5h16V12H4zM5.5 12v8.5h13V12M12 8.5v12M12 8.5S11 4 8.5 4a2.25 2.25 0 0 0 0 4.5M12 8.5S13 4 15.5 4a2.25 2.25 0 0 1 0 4.5' },
    sparkles: { d: 'M11 3l1.8 5.2L18 10l-5.2 1.8L11 17l-1.8-5.2L4 10l5.2-1.8L11 3zM18.5 15v5M16 17.5h5' },
    // A dashboard's tiles (Dashboard Shortcuts' default): a tall one on the left, two on the right.
    dashboard: { fill: true, d: 'M5.5 4h4A1.5 1.5 0 0 1 11 5.5v13A1.5 1.5 0 0 1 9.5 20h-4A1.5 1.5 0 0 1 4 18.5v-13A1.5 1.5 0 0 1 5.5 4zM14.5 4h4A1.5 1.5 0 0 1 20 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-6A1.5 1.5 0 0 1 14.5 4zM14.5 15h4a1.5 1.5 0 0 1 1.5 1.5v2a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5v-2a1.5 1.5 0 0 1 1.5-1.5z' },
  };

  /**
   * Homey's Android app already scales its type tokens by the system font scale (calc(1.1 * 14px)), and the
   * WebView's text zoom then scales all text again, so token text came out 1.21x where the native tiles are 1.1x.
   * This divides the tokens by the zoom (measured: a 100px font computes as 110px), so they render at Homey's size.
   * Fixed px sizes keep the zoom once, like the native text. Each index.html runs it first.
   */
  function undoTextZoom() {
    const probe = document.createElement('span');
    probe.style.cssText = 'position:absolute;visibility:hidden;font-size:100px';
    document.body.appendChild(probe);
    const zoom = parseFloat(getComputedStyle(probe).fontSize) / 100;
    probe.remove();
    if (!(zoom > 0) || Math.abs(zoom - 1) < 0.01) return;
    const cs = getComputedStyle(document.body);
    for (const size of ['small', 'default', 'large', 'xlarge', 'xxlarge']) {
      for (const prop of ['font-size', 'line-height']) {
        const name = `--homey-${prop}-${size}`;
        const v = cs.getPropertyValue(name).trim();
        if (v) document.body.style.setProperty(name, `calc((${v}) / ${zoom})`);
      }
    }
  }

  /** An element with attributes (`text` sets its text; null values are left out), appended to `parent`; `ns` for SVG. */
  function el(tag, attrs, parent, ns) {
    const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null) continue;
        if (k === 'text') node.textContent = v;
        else node.setAttribute(k, v);
      }
    }
    if (parent) parent.appendChild(node);
    return node;
  }

  /** Sets an icon (a data URL) as `node`'s mask, in the widget's CSS variable `name` (`--vt-mask` …); none without one. */
  function setMask(node, url, name) {
    const v = url ? `url("${url}")` : '';
    if (node.style.getPropertyValue(name) !== v) node.style.setProperty(name, v);
  }

  /**
   * The names typed on the tiles (`renameTiles`; the app keeps them per widget instance, by tile key): `name(key, own)`
   * is the typed name, else `own`. In rename mode `field(key, own)` is the tile's text field (made once per key, with
   * `own` as the placeholder): it saves on change (Enter or leaving it), Escape puts it back, and a realtime update
   * doesn't overwrite it while it has the focus. Its touches, clicks and keys never reach the tile's own taps.
   * `failed(key)` shakes the tile and says so; the name goes back, unless the app's names came meanwhile.
   */
  function tileNames(opts, render, failed) {
    let names = {};
    let reads = 0; // set() calls: the app's names, by realtime or a read
    const fields = new Map();
    async function save(key, value) {
      const before = names[key];
      if ((before || '') === value) return;
      const put = v => { names = { ...names }; if (v) names[key] = v; else delete names[key]; };
      put(value);
      const seen = reads;
      render();
      try {
        if (opts.onRename) await opts.onRename(key, value);
      } catch (err) {
        console.error(err);
        // Only while it still shows this save's name and nothing came from the app since: what came says what the
        // app kept (a newer name, or this one when only the answer was lost).
        if (reads === seen && (names[key] || '') === value) put(before);
        failed(key);
      }
    }
    return {
      renaming: opts.renameTiles === true,
      name: (key, own) => names[key] || own,
      set(map) {
        reads++;
        names = {};
        if (map && typeof map === 'object') for (const [k, v] of Object.entries(map)) if (typeof v === 'string' && v) names[k] = v;
        render();
      },
      field(key, own) {
        let input = fields.get(key);
        if (!input) {
          input = document.createElement('input');
          input.type = 'text';
          input.className = 'wk-rename';
          input.dir = 'auto';
          input.maxLength = 60;
          input.autocomplete = 'off';
          input.setAttribute('enterkeyhint', 'done');
          const field = input;
          for (const type of ['touchstart', 'touchend', 'pointerdown', 'click']) field.addEventListener(type, e => e.stopPropagation(), { passive: true });
          field.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') field.blur();
            else if (e.key === 'Escape') { field.value = names[key] || ''; field.blur(); }
          });
          field.addEventListener('change', () => { field.value = field.value.trim(); save(key, field.value); });
          fields.set(key, input);
        }
        input.placeholder = own || '';
        input.setAttribute('aria-label', own || '');
        if (document.activeElement !== input) input.value = names[key] || '';
        return input;
      },
    };
  }

  /** The time today, the weekday and time within 6 days, else the date (times in `locale`, names in `language`). */
  function formatSince(ms, now, language, locale) {
    const at = new Date(ms);
    const time = at.toLocaleTimeString(locale || [], { hour: 'numeric', minute: '2-digit' });
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);
    if (ms >= midnight.getTime()) return time;
    let lang = language || undefined;
    try { new Intl.DateTimeFormat(lang); } catch (err) { lang = undefined; }
    if (ms >= midnight.getTime() - 6 * DAY) return `${at.toLocaleDateString(lang, { weekday: 'short' })} ${time}`;
    return at.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  }

  /** An alarm's title without a trailing unit "(…)". */
  function baseTitle(title) {
    return String(title).replace(/\s*\([^)]*\)\s*$/, '') || String(title);
  }

  /** The cheapest price slot from `from` up to `hours` ahead (the first of equal ones), or -1. */
  function lowestSlot(slots, from, hours) {
    let low = -1;
    for (let i = from; i <= from + hours && i < slots.length; i++) {
      const p = slots[i].price;
      if (p != null && (low < 0 || p < slots[low].price - 1e-9)) low = i;
    }
    return low;
  }

  /** Why a write through the personal API key failed (`KeyProblem` in lib/PersonalApiKey.ts): each has its own message. */
  const KEY_PROBLEMS = ['noKey', 'keyScope', 'keyInvalid'];

  /** Units written right after the number: `21°C`, `45%`. */
  const TIGHT_UNITS = /^(°|%)/;

  /** A `%` number as 0–100 (a 0–1 range, like Homey's `dim`, is scaled up), else the number itself. */
  function scaled(cap, value) {
    return cap.units === '%' && cap.max === 1 && (cap.min == null || cap.min === 0) ? value * 100 : value;
  }

  /** A number in the device locale, to the capability's decimals (at most 4; 1 without them, none for a scaled `%`). */
  function formatNumber(cap, value) {
    const percent = scaled(cap, value) !== value;
    const digits = percent ? 0 : cap.decimals != null ? Math.max(0, Math.min(cap.decimals, 4)) : null;
    return scaled(cap, value).toLocaleString(undefined, digits != null
      ? { minimumFractionDigits: 0, maximumFractionDigits: digits }
      : { maximumFractionDigits: 1 });
  }

  /**
   * A capability value as the tiles show it: a number to its decimals with its units (`°` and `%` attached), yes/no
   * as `t('on')`/`t('off')`, an enum by its value's title, else the text; `–` for none.
   * @param {{type?: string, units?: string|null, decimals?: number|null, min?: number|null, max?: number|null, values?: {id: string, title: string}[]|null}} cap
   * @param {unknown} value
   * @param {(key: string) => string} [t]
   */
  function formatValue(cap, value, t) {
    if (value == null || value === '') return '–';
    if (typeof value === 'boolean') return t ? t(value ? 'on' : 'off') : String(value);
    if (typeof value === 'number' && isFinite(value)) {
      const text = formatNumber(cap, value);
      if (!cap.units) return text;
      return TIGHT_UNITS.test(cap.units) ? `${text}${cap.units}` : `${text} ${cap.units}`;
    }
    const v = (cap.values || []).find(x => x.id === String(value));
    return v ? v.title : String(value);
  }

  /** A frame's load marks for the app's diagnostics log (`wireFrame()`'s `perf=`): start, HTML, SDK ready, request. */
  function loadMarks(sdkAt) {
    const nav = /** @type {PerformanceNavigationTiming | null} */ (performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null);
    return [Math.round(performance.timeOrigin), nav ? Math.round(nav.responseEnd) : -1,
      Math.round(sdkAt), Math.round(performance.now())].join(',');
  }

  /**
   * A mount's link to Homey's frame (`frame`: the body, or a Smart Stack slide):
   * - `ready(opts)` tells Homey the widget is ready, once (later calls do nothing). `fonts: true` waits for the text
   *   font first, so text doesn't pop in after the icons, with `waitFor()`'s promises too, at most `maxMs`; `before()`
   *   runs just before.
   * - `setHeight()` passes the frame's height on, once ready (the widget's `onHeight`); `height()` is that height.
   * - `perfParam(sep)` is the load marks for the app's diagnostics log, `&perf=…` (`?perf=…` with `'?'`), on the first
   *   request only.
   */
  function wireFrame(Homey, frame) {
    const sdkAt = performance.now();
    let marksSent = false;
    let readyStarted = false;
    let readySent = false;
    const height = () => Math.ceil(frame.getBoundingClientRect().height);
    return {
      height,
      setHeight() {
        if (readySent) Homey.setHeight(height());
      },
      async ready({ fonts = false, waitFor = null, maxMs = 1000, before = null } = {}) {
        if (readyStarted) return;
        readyStarted = true;
        /** @type {Promise<unknown>[]} */
        const waits = waitFor ? waitFor() : [];
        if (fonts && document.fonts && document.fonts.ready) waits.unshift(document.fonts.ready);
        if (waits.length) await Promise.race([Promise.all(waits), new Promise(r => setTimeout(r, maxMs))]);
        if (before) before();
        readySent = true;
        Homey.ready({ height: height() });
      },
      perfParam(sep = '&') {
        if (marksSent) return '';
        marksSent = true;
        return `${sep}perf=${loadMarks(sdkAt)}`;
      },
    };
  }

  /** The widget's `devices` setting (`Homey.getDeviceIds()`), always a list: empty without one or on a failure. */
  function getDeviceIds(Homey) {
    return Promise.resolve(typeof Homey.getDeviceIds === 'function' ? Homey.getDeviceIds() : [])
      .then(ids => (Array.isArray(ids) ? ids : []), () => []);
  }

  /**
   * A mount's tile names (`renameTiles`), which the app keeps per widget instance: `state(path)` reads `/state` with
   * them (a failure keeps the last ones), realtime keeps them current, and `rename(key, name)` saves one. `setNames` is
   * the widget's.
   */
  function wireTileNames(Homey, setNames) {
    let instance = 'default';
    let asked = '';
    try { asked = typeof Homey.getWidgetInstanceId === 'function' ? Homey.getWidgetInstanceId() : ''; } catch (e) { /* stays 'default' */ }
    const known = Promise.resolve(asked)
      .then((id) => { if (typeof id === 'string' && id) instance = id; })
      .catch(() => {});
    Homey.on('tilenames:state', (data) => {
      if (data && data.instance === instance) setNames(data.names);
    });
    return {
      // `/state` with the instance answers `{state, tileNames}`: the names come with every read, in one request.
      state: path => known
        .then(() => Homey.api('GET', `${path}&instance=${encodeURIComponent(instance)}`))
        .then((res) => {
          if (!res || typeof res !== 'object' || !('tileNames' in res)) return res;
          setNames(res.tileNames);
          return res.state;
        }),
      rename: (key, name) => known.then(() => Homey.api('POST', '/names', { instance, key, name })),
    };
  }

  /** The colour settings' names (Device Values' Flow colours), in kit.css's palette. */
  const COLORS = ['blue', 'red', 'orange', 'yellow', 'green', 'purple'];

  /**
   * The `colorStyle` setting ("Colours"): 'deep' (Homey's darker shades as solid fills, white text) or 'soft' (the
   * default). Device Values' old 'bright' reads as 'deep'; a missing or unknown value is the default.
   */
  function colorStyle(value) {
    return value === 'deep' || value === 'bright' ? 'deep' : 'soft';
  }

  /**
   * Puts a widget root on kit.css's palette: `wk`, `wk-deep` for the Vivid colours, and `data-wk-color` (a colour
   * setting, else `fallback`; null leaves it out) for `--wk-c`/`--wk-on`. Returns the scheme ('soft' or 'deep').
   * @param {HTMLElement} root
   * @param {{ style?: unknown, color?: unknown, fallback?: string | null }} [opts]
   */
  function applyColors(root, { style, color, fallback = null } = {}) {
    const scheme = colorStyle(style);
    root.classList.add('wk');
    root.classList.toggle('wk-deep', scheme === 'deep');
    const name = typeof color === 'string' && COLORS.includes(color) ? color : fallback;
    if (name) root.dataset.wkColor = name;
    else delete root.dataset.wkColor;
    return scheme;
  }

  window.WidgetkeeperKit = { icons: ICONS, TIGHT_UNITS, KEY_PROBLEMS, COLORS, scaled, formatNumber, formatValue, undoTextZoom, el, setMask, tileNames, formatSince, baseTitle, lowestSlot, wireFrame, getDeviceIds, wireTileNames, colorStyle, applyColors };
})();
