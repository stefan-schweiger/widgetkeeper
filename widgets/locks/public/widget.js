/*
 * Locks: one line that says whether every lock, door and garage door picked is locked and closed
 * (*All locked and closed*, or *Back door · Unlocked since 18:12*). A tap shows every device with its state and,
 * for a lock or a garage door that isn't secure, a button to lock or close it (*Lock all* for several).
 * Unlocking and opening only with the `allowUnlock` setting.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const DAY = 864e5;
  const BUSY_MS = 15e3; // how long a lock may take to report its new state before the button gives up

  const DEFAULT_STRINGS = {
    selectDevices: 'Select locks and doors in the widget settings.',
    error: 'Could not load the locks.',
    failed: 'Could not change __name__.',
    unavailable: 'Unavailable',
    locked: 'Locked',
    unlocked: 'Unlocked',
    open: 'Open',
    closed: 'Closed',
    allLocked: 'All locked',
    allClosed: 'All closed',
    allSecure: 'All locked and closed',
    countUnlocked: '__count__ unlocked',
    countOpen: '__count__ open',
    countInsecure: '__count__ open or unlocked',
    noStatus: 'No status yet',
    since: 'since __time__',
    sinceStart: 'Since __time__',
    countUnavailable: '__count__ unavailable',
    lock: 'Lock',
    unlock: 'Unlock',
    close: 'Close',
    openAction: 'Open',
    lockAll: 'Lock all',
  };

  /** The capabilities read, and the value of each that's secure (as lib/LockService.ts). */
  const SECURE = { locked: true, alarm_contact: false, garagedoor_closed: true };
  const CAP_ORDER = ['locked', 'alarm_contact', 'garagedoor_closed'];

  const SVG_NS = 'http://www.w3.org/2000/svg';
  /** The summary's padlock, closed or open (Flow Buttons' lock glyph: 24 px, 2 px round stroke). */
  const PADLOCK = {
    closed: 'M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11zM8 11V8a4 4 0 0 1 8 0v3',
    open: 'M6.5 11h11a1.5 1.5 0 0 1 1.5 1.5v6a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.5v-6A1.5 1.5 0 0 1 6.5 11zM8 11V7.5a4 4 0 0 1 7.8-1.25',
  };
  const CHEVRON = 'M6 9l6 6 6-6';

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

  function svgPath(cls, d) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', cls);
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', d);
    svg.appendChild(path);
    return svg;
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
      if (!tap) return;
      e.preventDefault(); // no click after it
      e.stopPropagation();
      lastTouchTap = Date.now();
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

  /** As Sensor Dots: the time today, the weekday and time within 6 days, else the date. */
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

  /** The device's capabilities in a fixed order: `[[id, {value, setable, lastUpdated}]]`. */
  const capsOf = d => CAP_ORDER.filter(id => d.caps && d.caps[id]).map(id => [id, d.caps[id]]);
  const isSecure = (id, v) => v === SECURE[id];
  const isInsecure = (id, v) => typeof v === 'boolean' && v !== SECURE[id];

  /** 'secure', 'insecure', 'unknown' (nothing reported yet) or 'missing'. */
  function lockLevel(d) {
    if ('missing' in d) return 'missing';
    const caps = capsOf(d);
    if (caps.some(([id, c]) => isInsecure(id, c.value))) return 'insecure';
    return caps.some(([id, c]) => isSecure(id, c.value)) ? 'secure' : 'unknown';
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, view?: string,
   *   allowUnlock?: boolean, onSet?: (deviceId: string, capabilityId: string, value: boolean) => Promise<any>,
   *   onHaptic?: () => void, onHeight?: (h: number) => void }} opts
   */
  function createLocksWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`locks.${key}`, tokens) : null;
      if (s && s !== `locks.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const alwaysOpen = opts.view === 'list';
    const allowUnlock = opts.allowUnlock === true;

    let devices = []; // [{ id, name, icon, caps: { locked?, alarm_contact?, garagedoor_closed? } } | { id, missing }]
    let language = null;
    let expanded = alwaysOpen;
    let messageText = null;
    let messageTimer = null;
    const busy = new Map(); // deviceId → timeout, while a lock or close is on its way

    root.classList.add('lk');
    const tile = el('div', { class: 'lk-tile' }, root);
    const summary = el('div', { class: 'lk-summary' }, tile);
    const icon = el('div', { class: 'lk-icon' }, summary);
    const iconGlyph = { closed: svgPath('lk-glyph closed', PADLOCK.closed), open: svgPath('lk-glyph open', PADLOCK.open) };
    icon.appendChild(iconGlyph.closed);
    icon.appendChild(iconGlyph.open);
    const text = el('div', { class: 'lk-text' }, summary);
    const title = el('div', { class: 'lk-title', dir: 'auto' }, text);
    const sub = el('div', { class: 'lk-sub', dir: 'auto' }, text);
    if (!alwaysOpen) {
      summary.setAttribute('role', 'button');
      summary.setAttribute('tabindex', '0');
      summary.appendChild(svgPath('lk-chevron', CHEVRON));
      onTap(summary, () => { expanded = !expanded; render(); });
    }
    const list = el('div', { class: 'lk-list' }, tile);
    const allButton = el('div', { class: 'lk-all', role: 'button', tabindex: '0', text: t('lockAll') }, tile);
    onTap(allButton, () => {
      for (const d of devices) {
        const a = actionOf(d);
        if (a && a.secures) send(d, a);
      }
    });
    const messageEl = el('div', { class: 'lk-message', dir: 'auto' }, root);
    /** @type {Map<string, {row: HTMLElement, icon: HTMLElement, name: HTMLElement, state: HTMLElement, button: HTMLElement}>} */
    const rows = new Map();

    /** `{devices, language}` from `/state`, or just the device list. */
    function setState(state) {
      const listIn = Array.isArray(state) ? state : state && state.devices;
      devices = Array.isArray(listIn) ? listIn : [];
      if (state && typeof state.language === 'string') language = state.language;
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value, t: at }) {
      const d = devices.find(x => x.id === deviceId);
      const c = d && d.caps ? d.caps[capabilityId] : null;
      if (!c) return;
      c.value = value;
      c.lastUpdated = typeof at === 'number' ? at : Date.now();
      clearBusy(deviceId);
      render();
    }

    /** A message under the tile. Persistent messages also clear it. */
    function setMessage(textIn, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = textIn;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else devices = [];
      render();
    }

    function clearBusy(id) {
      const timer = busy.get(id);
      if (timer) clearTimeout(timer);
      busy.delete(id);
    }

    /**
     * What the device's button does: secure the first lock or garage door that isn't, or with `allowUnlock`
     * unlock or open the first that is. Null for a contact sensor, a missing device or a value not set yet.
     */
    function actionOf(d) {
      if ('missing' in d) return null;
      const settable = capsOf(d).filter(([, c]) => c.setable);
      const insecure = settable.find(([id, c]) => isInsecure(id, c.value));
      if (insecure) {
        const [id] = insecure;
        return { capabilityId: id, value: SECURE[id], secures: true, label: t(id === 'locked' ? 'lock' : 'close') };
      }
      const secure = allowUnlock && settable.find(([id, c]) => isSecure(id, c.value));
      if (secure) {
        const [id] = secure;
        return { capabilityId: id, value: !SECURE[id], secures: false, label: t(id === 'locked' ? 'unlock' : 'openAction') };
      }
      return null;
    }

    async function send(d, action) {
      if (busy.has(d.id)) return;
      try { if (opts.onHaptic) opts.onHaptic(); } catch (err) { /* not on every platform */ }
      busy.set(d.id, setTimeout(() => { busy.delete(d.id); render(); }, BUSY_MS));
      render();
      try {
        if (opts.onSet) await opts.onSet(d.id, action.capabilityId, action.value);
      } catch (err) {
        console.error(err);
        clearBusy(d.id);
        const r = rows.get(d.id);
        if (r) {
          r.row.classList.remove('shake');
          void r.row.offsetWidth;
          r.row.classList.add('shake');
        }
        setMessage(t('failed', { name: d.name }), true);
      }
    }

    /**
     * "Locked · Closed", or only what isn't secure ("Unlocked"), or "–" before anything was reported.
     */
    function stateText(d) {
      if ('missing' in d) return t('unavailable');
      const insecure = lockLevel(d) === 'insecure';
      const parts = [];
      for (const [id, c] of capsOf(d)) {
        if (typeof c.value !== 'boolean' || (insecure && !isInsecure(id, c.value))) continue;
        if (id === 'locked') parts.push(t(c.value ? 'locked' : 'unlocked'));
        else parts.push(t(isSecure(id, c.value) ? 'closed' : 'open'));
      }
      return parts.length ? parts.join(' · ') : '–';
    }

    const newest = list => {
      const times = list.map(c => c.lastUpdated).filter(x => typeof x === 'number');
      return times.length ? Math.max(...times) : null;
    };
    const sinceText = (ms, key) => (ms == null ? '' : t(key, { time: formatSince(ms, Date.now(), language, opts.locale) }));

    /** The summary line: `{level, title, sub}`. */
    function summaryOf() {
      const present = devices.filter(d => !('missing' in d));
      const missing = devices.length - present.length;
      const insecure = present.filter(d => lockLevel(d) === 'insecure');
      const unavailable = missing ? t('countUnavailable', { count: missing }) : '';
      const join = (...parts) => parts.filter(Boolean).join(' · ');
      if (insecure.length === 1) {
        const d = insecure[0];
        const caps = capsOf(d).filter(([id, c]) => isInsecure(id, c.value)).map(([, c]) => c);
        return { level: 'insecure', title: d.name, sub: join(`${stateText(d)} ${sinceText(newest(caps), 'since')}`.trim(), unavailable) };
      }
      if (insecure.length > 1) {
        const kinds = new Set(insecure.flatMap(d => capsOf(d).filter(([id, c]) => isInsecure(id, c.value)).map(([id]) => (id === 'locked' ? 'lock' : 'door'))));
        const key = kinds.size > 1 ? 'countInsecure' : kinds.has('lock') ? 'countUnlocked' : 'countOpen';
        return { level: 'insecure', title: t(key, { count: insecure.length }), sub: join(insecure.map(d => d.name).join(', '), unavailable) };
      }
      const known = present.filter(d => lockLevel(d) === 'secure');
      if (!known.length) return { level: present.length ? 'unknown' : 'missing', title: present.length ? t('noStatus') : t('unavailable'), sub: unavailable };
      const caps = known.flatMap(d => capsOf(d).map(([id, c]) => [id, c]));
      const hasLock = caps.some(([id]) => id === 'locked');
      const hasDoor = caps.some(([id]) => id !== 'locked');
      const key = hasLock && hasDoor ? 'allSecure' : hasLock ? 'allLocked' : 'allClosed';
      return { level: 'secure', title: t(key), sub: join(sinceText(newest(caps.map(([, c]) => c)), 'sinceStart'), unavailable) };
    }

    function rowFor(d) {
      let r = rows.get(d.id);
      if (r) return r;
      const row = el('div', { class: 'lk-row', 'data-device': d.id });
      const rIcon = el('span', { class: 'lk-dev-icon' }, row);
      const rText = el('div', { class: 'lk-row-text' }, row);
      const name = el('div', { class: 'lk-name', dir: 'auto' }, rText);
      const state = el('div', { class: 'lk-state', dir: 'auto' }, rText);
      const button = el('div', { class: 'lk-action', role: 'button', tabindex: '0' }, row);
      onTap(button, () => {
        const cur = devices.find(x => x.id === d.id);
        const a = cur && actionOf(cur);
        if (a) send(cur, a);
      });
      r = { row, icon: rIcon, name, state, button };
      rows.set(d.id, r);
      return r;
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--lk-mask') !== v) node.style.setProperty('--lk-mask', v);
    }

    let lastHeight = 0;
    function render() {
      const s = summaryOf();
      tile.dataset.level = s.level;
      title.textContent = s.title;
      sub.textContent = s.sub;
      sub.style.display = s.sub ? '' : 'none';
      iconGlyph.closed.style.display = s.level === 'insecure' ? 'none' : '';
      iconGlyph.open.style.display = s.level === 'insecure' ? '' : 'none';
      summary.setAttribute('aria-expanded', String(expanded));
      tile.classList.toggle('expanded', expanded);

      const ids = new Set(devices.map(d => d.id));
      for (const [id, r] of rows) {
        if (!ids.has(id)) { r.row.remove(); rows.delete(id); clearBusy(id); }
      }
      let securable = 0;
      for (const d of devices) {
        const r = rowFor(d);
        list.appendChild(r.row); // keeps the settings' order
        const level = lockLevel(d);
        r.row.dataset.level = level;
        r.name.textContent = 'missing' in d ? t('unavailable') : d.name;
        r.state.textContent = 'missing' in d ? '' : stateText(d);
        r.state.style.display = 'missing' in d ? 'none' : '';
        setMask(r.icon, 'missing' in d ? null : d.icon);
        r.icon.classList.toggle('fallback', 'missing' in d || !d.icon);
        const a = actionOf(d);
        if (a && a.secures) securable++;
        r.button.style.display = a ? '' : 'none';
        r.button.textContent = a ? a.label : '';
        r.button.classList.toggle('secures', !!(a && a.secures));
        r.button.classList.toggle('busy', busy.has(d.id));
      }
      list.style.display = expanded && devices.length ? '' : 'none';
      allButton.style.display = expanded && securable > 1 ? '' : 'none';
      allButton.classList.toggle('busy', devices.some(d => busy.has(d.id)));
      tile.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, pushChange, setMessage, render, t, expand: (v) => { expanded = v !== false || alwaysOpen; render(); } };
  }

  window.createLocksWidget = createLocksWidget;
  window.lockLevel = lockLevel;
})();
