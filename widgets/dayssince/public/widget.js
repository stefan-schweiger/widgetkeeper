/*
 * Days Since: counters for household rhythms (plants watered, a filter changed, sheets washed) as a list: per row the
 * icon, the name and the time since the last reset, then a bar filling up towards the day it's due and the time left
 * (or how long it's overdue). A row turns amber, then red, the set number of days after its reset. A tap starts it
 * again from today, with Undo for a few seconds. The counters live in the app, shared by name with other widgets and
 * Flows.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, applyColors } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
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
    left: '__time__ left',
    over: '+__time__',
    shortDay: '__n__ d',
    shortWeek: '__n__ w',
    shortMonth: '__n__ mo',
    shortYear: '__n__ y',
  };

  /** The tile icons: Flow Buttons' (the kit's; the `iconN` settings list them through FlowService's listIcons()). */
  const ICONS = window.WidgetkeeperKit.icons;
  const SVG_NS = 'http://www.w3.org/2000/svg';

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

  /**
   * How far a counter is towards the day it's due (`red`, else `amber`), on exact time like the colours: `fill` 0–1,
   * and the whole days `left` (at least 1) or, once past, `over` (from 1 in the first 24 h). Null without either
   * interval or a reset.
   */
  function progressOf(counter, resetAt, now) {
    const due = counter.red != null ? counter.red : counter.amber;
    if (resetAt == null || due == null) return null;
    const dueAt = resetAt + due * DAY;
    if (now < dueAt) return { fill: Math.min(1, Math.max(0, (now - resetAt) / (due * DAY))), left: Math.ceil((dueAt - now) / DAY), over: null };
    return { fill: 1, left: null, over: Math.max(1, Math.ceil((now - dueAt) / DAY)) };
  }

  const SHORT_KEYS = { day: 'shortDay', week: 'shortWeek', month: 'shortMonth', year: 'shortYear' };
  /** A number of days as the label under a bar shows it: `2 d`, `5 w`, `3 mo` (`t` the widget's strings). */
  function shortText(days, units, t) {
    const a = amountOf(days, units);
    return t(SHORT_KEYS[a.unit], { n: a.value });
  }

  /** The time since a reset as a row shows it: `Today`, `6 days`, `2 weeks` (`today` is the translated word). */
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
   * @param {{ colorStyle?: string, t?: (key: string, tokens?: object) => string, locale?: string,
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
    applyColors(root, { style: opts.colorStyle });
    const list = el('div', { class: 'ds-list' }, root);
    const messageEl = el('div', { class: 'ds-message', dir: 'auto' }, root);

    const tiles = counters.map((c) => {
      const tile = el('div', { class: 'ds-row', role: 'button', tabindex: '0', 'data-key': c.key }, list);
      if (c.icon) tile.appendChild(iconSvg(c.icon));
      const top = el('div', { class: 'ds-top' }, tile);
      el('div', { class: 'ds-name', dir: 'auto', text: c.name }, top);
      const value = el('div', { class: 'ds-value', dir: 'auto' }, top);
      const undo = el('div', { class: 'ds-undo', role: 'button', tabindex: '0', text: t('undo') }, top);
      const bar = el('div', { class: 'ds-bar' }, tile);
      el('div', { class: 'ds-fill' }, bar);
      const left = el('div', { class: 'ds-left', dir: 'auto' }, tile);
      onTap(tile, () => reset(c));
      onTap(undo, () => undoReset(c));
      return { counter: c, tile, value, undo, bar, left };
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
      if (!messageTimer) messageText = null; // a failed first load's message (a passing one runs out by itself)
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
      list.style.display = counters.length && !failed ? '' : 'none';
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
        const p = progressOf(c, resetAt, now);
        const leftText = !p ? '' : p.over != null ? t('over', { time: shortText(p.over, units, t) })
          : t('left', { time: shortText(p.left, units, t) });
        tl.left.textContent = leftText;
        tl.left.classList.toggle('over', !!p && p.over != null);
        tl.tile.classList.toggle('no-due', c.red == null && c.amber == null);
        tl.bar.style.setProperty('--ds-fill', p ? `${(p.fill * 100).toFixed(2)}%` : '0%');
        tl.tile.setAttribute('aria-label', t('resetLabel', { name: c.name, time: leftText ? `${text}, ${leftText}` : text }));
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
  window.daysSinceProgress = progressOf;
})();
