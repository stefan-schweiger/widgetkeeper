/*
 * Days Since: counters for household rhythms (plants watered, a filter changed, sheets washed) as tiles: the icon and
 * the time since the last reset on top, the name below. A tile turns amber, then red, the set number of days after
 * its reset. A tap starts it again from today, with Undo for a few seconds. The counters live in the app, shared by
 * name with other widgets and Flows.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const MINUTE = 60e3;
  const DAY = 24 * 60 * MINUTE;
  const UNDO_MS = 5000; // how long Undo shows after a tap
  const MAX_NAME = 60;
  const COUNTERS = [1, 2, 3, 4, 5, 6, 7, 8];
  const DEFAULT_ICON = 'clock';
  const DEFAULT_AMBER = 5;
  const DEFAULT_RED = 7;

  const DEFAULT_STRINGS = {
    setup: 'Name your counters in the widget settings.',
    error: 'Could not load the counters.',
    failed: 'Could not reset __name__.',
    undoFailed: 'Could not undo the reset of __name__.',
    today: 'Today',
    notStarted: 'Not started',
    undo: 'Undo',
    resetLabel: '__name__: __time__. Tap to reset.',
  };

  /**
   * The tile icons: Flow Buttons' (the `iconN` settings list them through lib/FlowService.ts' listIcons()), on a 24 px
   * grid with a 2 px round stroke (`fill: true` for a filled shape). A checked copy.
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
  };
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function el(tag, attrs, parent) {
    const node = document.createElement(tag);
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

  /**
   * A tap: a touch that ends within TAP_SLOP of where it started (a drag is left to the dashboard, so it
   * still scrolls), or a click from a mouse or keyboard. Quick Actions' logic; a button's tap isn't also its row's.
   */
  function onTap(node, fn) {
    let start = null;
    let lastTouchTap = 0;
    const unpress = () => { start = null; node.classList.remove('pressing'); };
    node.addEventListener('touchstart', (e) => {
      e.stopPropagation(); // a tap on a button mustn't also press the row around it
      const p = e.changedTouches[0];
      start = { x: p.clientX, y: p.clientY };
      node.classList.add('pressing');
    }, { passive: true });
    node.addEventListener('touchmove', (e) => {
      const p = e.changedTouches[0];
      if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > TAP_SLOP) unpress();
    }, { passive: true });
    node.addEventListener('touchend', (e) => {
      const tap = !!start;
      unpress();
      // Every touch: one that moved past TAP_SLOP can still get the browser's click.
      lastTouchTap = Date.now();
      if (!tap) return;
      e.preventDefault(); // no click after it
      e.stopPropagation();
      fn(e);
    });
    node.addEventListener('touchcancel', unpress);
    node.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Date.now() - lastTouchTap < 800) return;
      fn(e);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
      fn(e);
    });
  }

  /** A counter's key: its name trimmed and lower-cased (`counterKey()` in lib/DaysSinceService.ts); null without a name. */
  function counterKey(name) {
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n) return null;
    const key = n.toLowerCase().slice(0, MAX_NAME);
    return key === '__proto__' || key === 'constructor' || key === 'prototype' ? null : key;
  }

  /** An interval setting in days: a positive number, 0 (or less) for off; a missing one is the default. */
  function intervalOf(value, fallback) {
    if (value == null || value === '') return fallback;
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  /**
   * The counters from the widget settings, N = 1…8: `counterN` (the autocomplete's pick; its id is the name, `none`
   * empties the slot), `iconN` (unset: the clock; `none`: no icon), `amberN` and `redN` (days; 0 is off).
   */
  function countersFromSettings(settings) {
    const s = settings || {};
    const out = [];
    for (const n of COUNTERS) {
      const pick = s[`counter${n}`];
      const name = pick && typeof pick === 'object' ? (pick.id || pick.name) : pick;
      if (typeof name !== 'string' || name === 'none') continue;
      const key = counterKey(name);
      if (!key) continue;
      const iconPick = s[`icon${n}`];
      const iconId = iconPick && typeof iconPick === 'object' ? iconPick.id : iconPick;
      const icon = iconId === 'none' ? null
        : iconId && Object.prototype.hasOwnProperty.call(ICONS, iconId) ? iconId : DEFAULT_ICON;
      out.push({ key, name: name.trim().slice(0, MAX_NAME), icon,
        amber: intervalOf(s[`amber${n}`], DEFAULT_AMBER), red: intervalOf(s[`red${n}`], DEFAULT_RED) });
    }
    return out;
  }

  /** The calendar days from `from` to `to` in this screen's time: 0 the same day, 1 the next. */
  function calendarDays(from, to) {
    const a = new Date(from);
    const b = new Date(to);
    return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / DAY);
  }

  /**
   * How a number of days is shown: days to 13, then weeks (2–8), months (2–11) and years, each counted down; with
   * `units` `days`, always days.
   */
  function amountOf(days, units) {
    if (units !== 'days') {
      if (days >= 365) return { value: Math.floor(days / 365), unit: 'year' };
      if (days >= 61) return { value: Math.floor(days / 30.4375), unit: 'month' };
      if (days >= 14) return { value: Math.floor(days / 7), unit: 'week' };
    }
    return { value: days, unit: 'day' };
  }

  /** `red` from `red` days after the reset, else `amber`, else null; null for a counter never reset. */
  function levelOf(counter, resetAt, now) {
    if (resetAt == null) return null;
    if (counter.red != null && now >= resetAt + counter.red * DAY) return 'red';
    if (counter.amber != null && now >= resetAt + counter.amber * DAY) return 'amber';
    return null;
  }

  const unitFormats = {};
  /**
   * `6 days`, `2 weeks`: Intl's units in Homey's language (the plurals of every language, no strings), in the screen
   * region's form where there is one (as the Clock's date); `6 d` where Intl can't.
   */
  function amountText(value, unit, language, locale) {
    const lang = language || 'en';
    const id = `${lang}|${locale || ''}|${unit}`;
    if (!(id in unitFormats)) {
      unitFormats[id] = null;
      let region = null;
      try { region = new Intl.Locale(locale || navigator.language).region || null; } catch { /* none */ }
      for (const tag of [region ? `${lang}-${region}` : null, lang, 'en']) {
        if (!tag) continue;
        try { unitFormats[id] = new Intl.NumberFormat(tag, { style: 'unit', unit, unitDisplay: 'long' }); break; } catch { /* the next one */ }
      }
    }
    const f = unitFormats[id];
    return f ? f.format(value) : `${value} ${unit[0]}`;
  }

  /** The time since a reset as a tile shows it: `Today`, `6 days`, `2 weeks` (`today` is the translated word). */
  function daysSinceText(days, units, language, locale, today) {
    if (days <= 0) return today || DEFAULT_STRINGS.today;
    const a = amountOf(days, units);
    return amountText(a.value, a.unit, language, locale);
  }

  function iconSvg(id) {
    const icon = ICONS[id];
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'ds-icon');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', icon.d);
    if (icon.fill) path.setAttribute('class', 'filled');
    svg.appendChild(path);
    return svg;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string,
   *   counters?: {key: string, name: string, icon: string | null, amber: number | null, red: number | null}[],
   *   units?: string,
   *   onReset?: (name: string) => Promise<any>,
   *   onUndo?: (name: string, at: number) => Promise<any>,
   *   onHaptic?: () => void, now?: () => number, onHeight?: (h: number) => void }} opts
   */
  function createDaysSinceWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`dayssince.${key}`, tokens) : null;
      if (s && s !== `dayssince.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const counters = Array.isArray(opts.counters) ? opts.counters.slice(0, COUNTERS.length) : [];
    const units = opts.units === 'days' ? 'days' : 'friendly';
    const clock = opts.now || (() => Date.now()); // the screen's clock (the previews fix it)
    let offset = 0; // the Homey's clock minus ours
    const serverNow = () => clock() + offset;

    let language = null;
    let loaded = false;
    let failed = false; // the first load failed: the error instead of the tiles
    /** @type {Map<string, {resetAt: number | null}>} the app's counters (or what a tap made of them), by key */
    const entries = new Map();
    /**
     * A tap's reset while it can be undone, by key: `previous` (the resetAt before), `at` (the app's resetAt once
     * `/reset` answered), `until` (on the screen's clock) and `request` (resolves to whether the reset went through).
     */
    const undoable = new Map();
    /** Keys with an undo on its way: realtime doesn't overwrite them meanwhile. */
    const undoing = new Set();
    let messageText = null;
    let messageTimer = null;

    root.classList.add('ds');
    const grid = el('div', { class: 'ds-grid' }, root);
    const messageEl = el('div', { class: 'ds-message', dir: 'auto' }, root);

    const tiles = counters.map((c) => {
      const tile = el('div', { class: 'ds-tile', role: 'button', tabindex: '0', 'data-key': c.key }, grid);
      const top = el('div', { class: 'ds-top' }, tile);
      if (c.icon) top.appendChild(iconSvg(c.icon));
      const value = el('div', { class: 'ds-value', dir: 'auto' }, top);
      const bottom = el('div', { class: 'ds-bottom' }, tile);
      el('div', { class: 'ds-name', dir: 'auto', text: c.name }, bottom);
      const undo = el('div', { class: 'ds-undo', role: 'button', tabindex: '0', text: t('undo') }, bottom);
      onTap(tile, () => reset(c));
      onTap(undo, () => undoReset(c));
      return { counter: c, tile, value, undo };
    });

    function haptic() {
      if (opts.onHaptic) opts.onHaptic();
    }

    function shake(key) {
      for (const tl of tiles) {
        if (tl.counter.key !== key) continue;
        tl.tile.classList.remove('shake');
        void tl.tile.offsetWidth; // restart the animation
        tl.tile.classList.add('shake');
      }
    }

    /** A counter entry from the app (`{key, resetAt}`), unless an undo of it is on its way. */
    function apply(entry, force) {
      if (!entry || typeof entry.key !== 'string') return;
      if (undoing.has(entry.key) && !force) return;
      entries.set(entry.key, { resetAt: typeof entry.resetAt === 'number' ? entry.resetAt : null });
    }

    function setClock(now) {
      if (typeof now === 'number') offset = now - clock();
    }

    /** `/state`'s answer: `{now, language, counters}`. */
    function setState(state) {
      if (!state || !Array.isArray(state.counters)) return;
      setClock(state.now);
      if (state.language) language = state.language;
      for (const entry of state.counters) apply(entry);
      loaded = true;
      failed = false;
      render();
    }

    /** A realtime event: one counter changed (a tap on another screen, a Flow). */
    function update(entry) {
      if (!entry || !entries.has(entry.key) && !counters.some(c => c.key === entry.key)) return;
      apply(entry);
      render();
    }

    /** A message under the tiles; a persistent one (a failed first load) replaces them. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 6000);
      else if (!loaded) failed = true;
      render();
    }

    /** A tap: the counter starts again from now at once, with Undo; the app's answer replaces it. */
    function reset(c) {
      const shown = undoable.get(c.key);
      if (shown && shown.until > clock()) return; // Undo is the tile's only action meanwhile
      haptic();
      const before = entries.get(c.key) || { resetAt: null };
      const now = serverNow();
      const mark = { previous: before.resetAt, at: null, until: clock() + UNDO_MS, request: null };
      undoable.set(c.key, mark);
      entries.set(c.key, { resetAt: now });
      render();
      mark.request = (async () => {
        try {
          const res = opts.onReset ? await opts.onReset(c.name) : null;
          if (res) {
            setClock(res.now);
            apply(res.counter);
            if (res.counter && typeof res.counter.resetAt === 'number') mark.at = res.counter.resetAt;
          }
          render();
          return mark.at != null;
        } catch (err) {
          console.error(err);
          if (undoable.get(c.key) === mark) undoable.delete(c.key);
          const cur = entries.get(c.key);
          if (cur && cur.resetAt === now) entries.set(c.key, before);
          setMessage(t('failed', { name: c.name }), true);
          shake(c.key);
          return false;
        }
      })();
    }

    /** Undo: the counter shows its old time at once; sent once the reset itself has answered. */
    async function undoReset(c) {
      const mark = undoable.get(c.key);
      if (!mark) return;
      undoable.delete(c.key);
      haptic();
      entries.set(c.key, { resetAt: mark.previous });
      undoing.add(c.key);
      render();
      const ok = await mark.request;
      if (!ok) { undoing.delete(c.key); render(); return; } // the reset failed: it's already back
      try {
        const res = opts.onUndo ? await opts.onUndo(c.name, mark.at) : null;
        undoing.delete(c.key);
        if (res) {
          setClock(res.now);
          if (res.counter) apply(res.counter, true);
          if (res.undone === false) {
            setMessage(t('undoFailed', { name: c.name }), true);
            shake(c.key);
          }
        }
      } catch (err) {
        console.error(err);
        undoing.delete(c.key);
        entries.set(c.key, { resetAt: mark.at }); // the app still has the reset
        setMessage(t('undoFailed', { name: c.name }), true);
        shake(c.key);
      }
      render();
    }

    let lastHeight = 0;
    let tickTimer = null;
    let undoTimer = null;
    function render() {
      const screenNow = clock();
      const now = serverNow();
      for (const [key, mark] of undoable) if (mark.until <= screenNow) undoable.delete(key);
      grid.style.display = counters.length && !failed ? '' : 'none';
      for (const tl of tiles) {
        const c = tl.counter;
        const e = entries.get(c.key);
        const resetAt = e ? e.resetAt : null;
        let text = '';
        if (e && resetAt == null) text = t('notStarted');
        else if (e) text = daysSinceText(calendarDays(resetAt - offset, screenNow), units, language, opts.locale, t('today'));
        tl.value.textContent = text;
        tl.tile.classList.toggle('not-started', !!e && resetAt == null);
        const level = levelOf(c, resetAt, now);
        if (level) tl.tile.dataset.level = level;
        else delete tl.tile.dataset.level;
        tl.tile.classList.toggle('undoable', undoable.has(c.key));
        tl.tile.setAttribute('aria-label', t('resetLabel', { name: c.name, time: text }));
      }
      const msg = messageText || (!counters.length ? t('setup') : null);
      messageEl.textContent = msg || '';
      messageEl.style.display = msg ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText);
      schedule(screenNow);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    /** Re-renders just after the minute turns (the days, the colours), and when the first Undo should go. */
    function schedule(now) {
      if (tickTimer) clearTimeout(tickTimer);
      tickTimer = setTimeout(render, Math.floor(now / MINUTE) * MINUTE + MINUTE - now + 50);
      if (undoTimer) clearTimeout(undoTimer);
      undoTimer = null;
      let first = Infinity;
      for (const mark of undoable.values()) first = Math.min(first, mark.until);
      if (first < Infinity) undoTimer = setTimeout(render, Math.max(0, first - now) + 20);
    }

    render();
    return { setState, update, setMessage, render, t };
  }

  window.createDaysSinceWidget = createDaysSinceWidget;
  window.daysSinceCountersFromSettings = countersFromSettings;
  window.daysSinceKey = counterKey;
  window.daysSinceText = daysSinceText;
  window.daysSinceCalendarDays = calendarDays;
  window.daysSinceLevel = levelOf;
  window.DAYS_SINCE_ICON_PATHS = ICONS;
})();
