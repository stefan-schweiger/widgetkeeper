/*
 * Sensor Dots: motion, contact and camera-detection sensors as a grid of dots, in one colour while idle and
 * another while active (settings; grey and blue by default). A tap on a dot opens an overlay over its row with the device's name, what's active and since when;
 * a tap on the overlay closes it.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_STRINGS = {
    selectDevices: 'Select sensors in the widget settings.',
    error: 'Could not load the sensors.',
    unavailable: 'Unavailable',
    open: 'Open',
    closed: 'Closed',
    motion: 'Motion',
    noMotion: 'No motion',
    nothingDetected: 'Nothing detected',
    since: 'since __time__',
  };

  const COLORS = ['grey', 'blue', 'red', 'orange', 'yellow', 'green', 'purple'];
  /** A colour setting's id, or the fallback when it's unknown. */
  const colorOf = (id, fallback) => (COLORS.includes(id) ? id : fallback);

  const TAP_SLOP = 10; // px a touch may move and still count as a tap
  const DAY = 864e5;

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
   * Taps from the touch events, as in Device Quick Actions: a touch that ends within TAP_SLOP of where it
   * started. A drag is left to the dashboard, so it still scrolls. `click` is kept for mouse and keyboard.
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
      // Every touch: one that moved past TAP_SLOP can still get the browser's click.
      lastTouchTap = Date.now();
      if (!tap) return;
      e.preventDefault(); // no click after it
      fn(e);
    });
    node.addEventListener('touchcancel', unpress);
    node.addEventListener('click', (e) => {
      if (Date.now() - lastTouchTap < 800) return;
      fn(e);
    });
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      fn(e);
    });
  }

  /** An alarm's title without a trailing unit "(…)" (as in Sensor Alarms). */
  function baseTitle(title) {
    return String(title).replace(/\s*\([^)]*\)\s*$/, '') || String(title);
  }

  const baseId = a => String(a.capabilityId).split('.')[0];

  /**
   * When a sensor changed, for "since …": the time today, the weekday and time within the last 6 days, else
   * the date. Times follow the device locale (or `locale`), weekday and month names Homey's language.
   */
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

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, title?: string,
   *   idleColor?: string, activeColor?: string, onHeight?: (h: number) => void }} opts
   */
  function createSensorDotsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`sensordots.${key}`, tokens) : null;
      if (s && s !== `sensordots.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    let devices = []; // [{ id, name, icon, alarms: [{ capabilityId, title, value, lastUpdated }] } | { id, missing }]
    let language = null;
    let messageText = null;
    let messageTimer = null;
    let openId = null; // the device whose overlay is open

    root.classList.add('sd');
    root.dataset.idle = colorOf(opts.idleColor, 'grey');
    root.dataset.active = colorOf(opts.activeColor, 'blue');
    // One device tile: an optional header (the `title` setting), then the dots.
    const tileEl = el('div', { class: 'sd-tile' }, root);
    const title = typeof opts.title === 'string' ? opts.title.trim() : '';
    if (title) el('div', { class: 'sd-header', dir: 'auto', text: title }, tileEl);
    const grid = el('div', { class: 'sd-grid' }, tileEl);
    const messageEl = el('div', { class: 'sd-message', dir: 'auto' }, root);
    // The overlay, over the row of the dot it's open for. In the grid (absolutely positioned, as Light
    // Controls' swatch panel) so it can cover the row; the dots are kept before it.
    const panel = el('div', { class: 'sd-panel', role: 'button', tabindex: '0' }, grid);
    const panelDot = el('span', { class: 'sd-panel-dot' }, panel);
    const panelText = el('div', { class: 'sd-panel-text' }, panel);
    const panelName = el('span', { class: 'sd-panel-name', dir: 'auto' }, panelText);
    const panelState = el('span', { class: 'sd-panel-state', dir: 'auto' }, panelText);
    panel.style.display = 'none';
    onTap(panel, () => { openId = null; render(); });
    /** @type {Map<string, HTMLElement>} */
    const cells = new Map();

    /** `{devices, language}` from `/state`, or just the device list. */
    function setState(state) {
      const list = Array.isArray(state) ? state : state && state.devices;
      devices = Array.isArray(list) ? list : [];
      if (state && typeof state.language === 'string') language = state.language;
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value, t: at }) {
      const d = devices.find(x => x.id === deviceId);
      const a = d && d.alarms ? d.alarms.find(x => x.capabilityId === capabilityId) : null;
      if (!a) return;
      a.value = value;
      a.lastUpdated = typeof at === 'number' ? at : Date.now();
      render();
    }

    /** A message under the dots. Persistent messages also clear the dots. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else devices = [];
      render();
    }

    const activeOf = d => (d.alarms || []).filter(a => a.value === true);

    /** 'active', 'idle', 'unknown' (no value reported) or 'missing'. */
    function levelOf(d) {
      if ('missing' in d) return 'missing';
      if (activeOf(d).length) return 'active';
      return (d.alarms || []).some(a => a.value === false) ? 'idle' : 'unknown';
    }

    /** "Open", "Motion, Person Detected", "Closed", "No motion" …, then "since 18:32" when known. */
    function stateText(d) {
      if ('missing' in d) return t('unavailable');
      const alarms = d.alarms || [];
      const active = activeOf(d);
      const from = active.length ? active : alarms;
      let text;
      if (active.length) {
        const labels = [];
        for (const a of active) {
          const id = baseId(a);
          const label = id === 'alarm_contact' ? t('open') : id === 'alarm_motion' ? t('motion') : baseTitle(a.title);
          if (!labels.includes(label)) labels.push(label);
        }
        text = labels.join(', ');
      } else if (alarms.some(a => a.value === false)) {
        text = alarms.some(a => baseId(a) === 'alarm_contact') ? t('closed')
          : alarms.some(a => baseId(a) === 'alarm_motion') ? t('noMotion') : t('nothingDetected');
      } else {
        return '–';
      }
      const times = from.map(a => a.lastUpdated).filter(x => typeof x === 'number');
      if (!times.length) return text;
      return `${text} ${t('since', { time: formatSince(Math.max(...times), Date.now(), language, opts.locale) })}`;
    }

    function toggle(id) {
      openId = openId === id ? null : id;
      render();
    }

    function cellFor(id) {
      let cell = cells.get(id);
      if (!cell) {
        cell = el('div', { class: 'sd-cell', 'data-device': id, role: 'button', tabindex: '0' });
        el('span', { class: 'sd-dot' }, cell);
        onTap(cell, () => toggle(id));
        cells.set(id, cell);
      }
      return cell;
    }

    /** Places the overlay over the row of its dot, or hides it. */
    function renderPanel() {
      const d = openId != null ? devices.find(x => x.id === openId) : null;
      const cell = d ? cells.get(d.id) : null;
      if (!d || !cell) {
        openId = null;
        panel.style.display = 'none';
        return;
      }
      panel.dataset.level = levelOf(d);
      panelName.textContent = 'missing' in d ? '' : d.name;
      panelName.style.display = 'missing' in d ? 'none' : '';
      panelState.textContent = stateText(d);
      panel.style.display = '';
      panel.style.top = `${cell.offsetTop}px`;
      panel.style.height = `${cell.offsetHeight}px`;
    }

    let lastHeight = 0;
    function render() {
      const ids = new Set(devices.map(d => d.id));
      for (const [id, cell] of cells) {
        if (!ids.has(id)) { cell.remove(); cells.delete(id); }
      }
      for (const d of devices) {
        const cell = cellFor(d.id);
        grid.insertBefore(cell, panel); // keeps the settings' order, and the overlay last
        const level = levelOf(d);
        cell.dataset.level = level;
        cell.classList.toggle('open', d.id === openId);
        cell.setAttribute('aria-expanded', String(d.id === openId));
        cell.setAttribute('aria-label', 'missing' in d ? t('unavailable') : `${d.name}: ${stateText(d)}`);
      }
      renderPanel();
      tileEl.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    // The width changes the number of dots per row, so the height and the overlay's row.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => render()).observe(grid);

    return { setState, pushChange, setMessage, render, t, open: (id) => { openId = id; render(); } };
  }

  window.createSensorDotsWidget = createSensorDotsWidget;
})();
