/*
 * Locks: one line that says whether every lock, door and garage door picked is locked and closed
 * (*All locked and closed*, or *Back door · Unlocked since 18:12*). A tap shows every device with its state and,
 * for a lock or a garage door that isn't secure, a button to lock or close it (*Lock all* for several).
 * Unlocking and opening only with the `allowUnlock` setting; with it, a lock that has the capability picked in
 * `openCapability` also gets *Open* (pulls the latch), which takes two taps.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, tileNames, formatSince, applyColors } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const TAP_SLOP = 10; // px a finger may move and still count as a tap
  const BUSY_MS = 15e3; // how long a lock may take to report its new state before the button gives up
  const CONFIRM_MS = 3e3; // how long Open waits for its second tap
  const OPEN_MIN_MS = 1.5e3; // Open pulses at least this long: a button capability reports no value to wait for

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
    countNoStatus: '__count__ without status',
    since: 'since __time__',
    sinceStart: 'Since __time__',
    countUnavailable: '__count__ unavailable',
    lock: 'Lock',
    unlock: 'Unlock',
    close: 'Close',
    openAction: 'Open',
    lockAll: 'Lock all',
    openDoor: 'Open',
    tapToOpen: 'Tap to open',
    renameFailed: 'Could not save the name.',
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

  /** The device's capabilities in a fixed order: `[[id, {value, setable, lastUpdated}]]`. */
  const capsOf = d => CAP_ORDER.filter(id => d.caps && d.caps[id]).map(id => [id, d.caps[id]]);
  const isSecure = (id, v) => v === SECURE[id];
  const isInsecure = (id, v) => typeof v === 'boolean' && v !== SECURE[id];

  /**
   * 'secure' (every capability says so), 'insecure' (any says otherwise), 'unknown' (one hasn't reported yet:
   * a lock without a value on a closed door isn't known to be locked) or 'missing'.
   */
  function lockLevel(d) {
    if ('missing' in d) return 'missing';
    const caps = capsOf(d);
    if (caps.some(([id, c]) => isInsecure(id, c.value))) return 'insecure';
    return caps.length && caps.every(([id, c]) => isSecure(id, c.value)) ? 'secure' : 'unknown';
  }

  /**
   * @param {HTMLElement} root
   * @param {{ colorStyle?: string, t?: (key: string, tokens?: object) => string, locale?: string, view?: string,
   *   allowUnlock?: boolean, onSet?: (deviceId: string, capabilityId: string, value: boolean) => Promise<any>,
   *   allowOpen?: boolean, onOpen?: (deviceId: string, capabilityId: string) => Promise<any>,
   *   onHaptic?: () => void, onHeight?: (h: number) => void,
   *   renameTiles?: boolean, onRename?: (key: string, name: string) => Promise<any> }} opts
   */
  function createLocksWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`locks.${key}`, tokens) : null;
      if (s && s !== `locks.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const names = tileNames(opts, () => render(), (key) => {
      shake(key);
      setMessage(t('renameFailed'), true);
    });
    // Renaming: the list shows (its rows are the tiles), without the buttons.
    const alwaysOpen = opts.view === 'list' || names.renaming;
    /** A device's name: the one typed on its row, else its own. */
    const nameOf = d => names.name(d.id, d.name);
    const allowUnlock = opts.allowUnlock === true;
    const allowOpen = opts.allowOpen === true;

    let devices = []; // [{ id, name, icon, caps: { locked?, alarm_contact?, garagedoor_closed? } } | { id, missing }]
    let language = null;
    let expanded = alwaysOpen;
    let messageText = null;
    let messageTimer = null;
    const busy = new Map(); // deviceId → {capabilityId, value, timer}, while a lock or close is on its way
    const opening = new Map(); // deviceId → {busy, timer}: waiting for Open's second tap, or opening

    root.classList.add('lk');
    applyColors(root, { style: opts.colorStyle });
    root.classList.toggle('renaming', names.renaming);
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
    // Lock all sits in the summary row, before the chevron, so the list stays one kind of row.
    const allButton = el('div', { class: 'lk-all', role: 'button', tabindex: '0', text: t('lockAll') });
    summary.insertBefore(allButton, text.nextSibling);
    const list = el('div', { class: 'lk-list' }, tile);
    onTap(allButton, () => {
      for (const d of devices) {
        const a = actionOf(d);
        if (a && a.secures) send(d, a);
      }
    });
    const messageEl = el('div', { class: 'lk-message', dir: 'auto' }, root);
    /** @type {Map<string, {row: HTMLElement, icon: HTMLElement, name: HTMLElement, state: HTMLElement, button: HTMLElement, openButton: HTMLElement}>} */
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
      const b = busy.get(deviceId);
      if (b && b.capabilityId === capabilityId && b.value === value) clearBusy(deviceId);
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
      const b = busy.get(id);
      if (b) clearTimeout(b.timer);
      busy.delete(id);
    }

    function clearOpening(id) {
      const o = opening.get(id);
      if (o) clearTimeout(o.timer);
      opening.delete(id);
    }

    /** The capability that opens (unlatches) the lock: the widget's Open capability, when this lock has it. */
    const openCapOf = d => (allowOpen && !('missing' in d) && typeof d.open === 'string' && d.open ? d.open : null);

    /**
     * Open: the first tap asks for a second (*Tap to open*, CONFIRM_MS), the second pulls the latch. It physically
     * opens the door, so a stray tap on the dashboard mustn't.
     */
    async function tapOpen(id) {
      const d = devices.find(x => x.id === id);
      const cap = d && openCapOf(d);
      const o = opening.get(id);
      if (!cap || names.renaming || (o && o.busy)) return;
      if (!o) {
        opening.set(id, { busy: false, timer: setTimeout(() => { opening.delete(id); render(); }, CONFIRM_MS) });
        render();
        return;
      }
      clearTimeout(o.timer);
      opening.set(id, { busy: true, timer: null });
      if (opts.onHaptic) opts.onHaptic();
      render();
      const started = Date.now();
      try {
        if (opts.onOpen) await opts.onOpen(id, cap);
      } catch (err) {
        console.error(err);
        clearOpening(id);
        shake(id);
        setMessage(t('failed', { name: nameOf(d) }), true);
        return;
      }
      opening.set(id, { busy: true, timer: setTimeout(() => { opening.delete(id); render(); }, Math.max(0, OPEN_MIN_MS - (Date.now() - started))) });
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
      if (busy.has(d.id) || names.renaming) return;
      if (opts.onHaptic) opts.onHaptic();
      busy.set(d.id, { capabilityId: action.capabilityId, value: action.value, timer: setTimeout(() => { busy.delete(d.id); render(); }, BUSY_MS) });
      render();
      try {
        if (opts.onSet) await opts.onSet(d.id, action.capabilityId, action.value);
      } catch (err) {
        console.error(err);
        clearBusy(d.id);
        shake(d.id);
        setMessage(t('failed', { name: nameOf(d) }), true);
      }
    }

    function shake(id) {
      const r = rows.get(id);
      if (!r) return;
      r.row.classList.remove('shake');
      void r.row.offsetWidth;
      r.row.classList.add('shake');
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
        return { level: 'insecure', title: nameOf(d), sub: join(`${stateText(d)} ${sinceText(newest(caps), 'since')}`.trim(), unavailable) };
      }
      if (insecure.length > 1) {
        const kinds = new Set(insecure.flatMap(d => capsOf(d).filter(([id, c]) => isInsecure(id, c.value)).map(([id]) => (id === 'locked' ? 'lock' : 'door'))));
        const key = kinds.size > 1 ? 'countInsecure' : kinds.has('lock') ? 'countUnlocked' : 'countOpen';
        return { level: 'insecure', title: t(key, { count: insecure.length }), sub: join(insecure.map(nameOf).join(', '), unavailable) };
      }
      const known = present.filter(d => lockLevel(d) === 'secure');
      if (!known.length) return { level: present.length ? 'unknown' : 'missing', title: present.length ? t('noStatus') : t('unavailable'), sub: unavailable };
      // "All locked" only when every device says so: one that hasn't reported yet may well be open.
      const unknown = present.filter(d => lockLevel(d) === 'unknown');
      if (unknown.length === 1) return { level: 'unknown', title: nameOf(unknown[0]), sub: join(t('noStatus'), unavailable) };
      if (unknown.length > 1) return { level: 'unknown', title: t('countNoStatus', { count: unknown.length }), sub: join(unknown.map(nameOf).join(', '), unavailable) };
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
      const openButton = el('div', { class: 'lk-open', role: 'button', tabindex: '0' }, row);
      onTap(openButton, () => tapOpen(d.id));
      r = { row, icon: rIcon, name, state, button, openButton };
      rows.set(d.id, r);
      return r;
    }

    const setMask = (node, url) => window.WidgetkeeperKit.setMask(node, url, '--lk-mask');

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
        if (!ids.has(id)) { r.row.remove(); rows.delete(id); clearBusy(id); clearOpening(id); }
      }
      let securable = 0;
      let placed = null;
      for (const d of devices) {
        const r = rowFor(d);
        // Keeps the order, moving only what is out of place: a moved node loses the focus of a field in it.
        const want = placed ? placed.nextSibling : list.firstChild;
        if (r.row !== want) list.insertBefore(r.row, want);
        placed = r.row;
        const level = lockLevel(d);
        r.row.dataset.level = level;
        r.name.textContent = 'missing' in d ? t('unavailable') : nameOf(d);
        if (names.renaming && !('missing' in d)) {
          const field = names.field(d.id, d.name);
          if (field.previousSibling !== r.name) r.name.after(field);
        }
        r.state.textContent = 'missing' in d ? '' : stateText(d);
        r.state.style.display = 'missing' in d ? 'none' : '';
        setMask(r.icon, 'missing' in d ? null : d.icon);
        r.icon.classList.toggle('fallback', 'missing' in d || !d.icon);
        const a = actionOf(d);
        if (a && a.secures) securable++;
        r.button.style.display = a ? '' : 'none';
        r.button.textContent = a ? a.label : '';
        r.button.classList.toggle('busy', busy.has(d.id));
        if (!openCapOf(d)) clearOpening(d.id);
        const o = opening.get(d.id);
        r.openButton.style.display = openCapOf(d) && !names.renaming ? '' : 'none';
        r.openButton.textContent = o && !o.busy ? t('tapToOpen') : t('openDoor');
        r.openButton.classList.toggle('confirm', !!o && !o.busy);
        r.openButton.classList.toggle('busy', !!o && o.busy);
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

    return { setState, setNames: names.set, pushChange, setMessage, render, t, expand: (v) => { expanded = v !== false || alwaysOpen; render(); } };
  }

  window.createLocksWidget = createLocksWidget;
  window.lockLevel = lockLevel;
})();
