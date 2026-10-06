/*
 * Sensor Alarms: a grid of device tiles, 2 per row, each with the device's icon, its name and its
 * current alarm (or "No alarm"). A tile with an active alarm turns red. A tap opens a panel under the tile's
 * row with every alarm of the device, active or not.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_STRINGS = {
    selectDevices: 'Select sensors in the widget settings.',
    error: 'Could not load the sensors.',
    noAlarm: 'No alarm',
    alarms: '__count__ alarms',
    noSensors: 'No alarm sensors',
    unavailable: 'Unavailable',
    active: 'Active',
    inactive: 'Inactive',
  };

  const TAP_SLOP = 10; // px a touch may move and still count as a tap

  /** An alarm's title without a trailing unit "(…)", so one alarm reported in several units reads once. */
  function baseTitle(title) {
    return String(title).replace(/\s*\([^)]*\)\s*$/, '') || String(title);
  }

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
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, includeStates?: boolean,
   *   onHeight?: (h: number) => void }} opts
   */
  function createSensorAlarmsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`sensoralarms.${key}`, tokens) : null;
      if (s && s !== `sensoralarms.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    let devices = []; // [{ id, name, icon, alarms: [{ capabilityId, title, value, state }] } | { id, missing }]
    let messageText = null;
    let messageTimer = null;
    let openId = null; // the device whose alarm panel is open
    let lastTouchTap = 0;

    root.classList.add('sa');
    const grid = el('div', { class: 'sa-grid' }, root);
    const messageEl = el('div', { class: 'sa-message', dir: 'auto' }, root);
    const panel = el('div', { class: 'sa-panel' });
    const panelList = el('div', { class: 'sa-list' }, panel);
    /** @type {Map<string, {tile: HTMLElement, icon: HTMLElement, name: HTMLElement, status: HTMLElement}>} */
    const tiles = new Map();

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      const d = devices.find(x => x.id === deviceId);
      const a = d && d.alarms ? d.alarms.find(x => x.capabilityId === capabilityId) : null;
      if (!a) return;
      a.value = value;
      render();
    }

    /** A message under the tiles. Persistent messages also clear the tiles. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else devices = [];
      render();
    }

    /**
     * The alarms that are on, one per title. Motion and contact only count with the `includeStates` setting.
     * Some devices report one alarm in several units (Airthings: "Radon alarm", "Radon alarm (Bq/m³)" and
     * "Radon alarm (pCi/L)"), so a trailing "(…)" is dropped and the same title counts once.
     */
    function activeAlarms(d) {
      const seen = new Set();
      const out = [];
      for (const a of d.alarms || []) {
        if (a.value !== true || (a.state && !opts.includeStates)) continue;
        const title = baseTitle(a.title);
        if (seen.has(title.toLowerCase())) continue;
        seen.add(title.toLowerCase());
        out.push(title);
      }
      return out;
    }

    function statusText(d) {
      if ('missing' in d) return t('unavailable');
      const counted = (d.alarms || []).filter(a => !a.state || opts.includeStates);
      if (!counted.length) return t('noSensors');
      const active = activeAlarms(d);
      if (active.length === 1) return active[0];
      if (active.length > 1) return t('alarms', { count: active.length });
      return t('noAlarm');
    }

    /**
     * Every alarm of the device for the panel, one row per title (active when any of its units is), in the
     * device's order. Motion and contact are listed too; they only show as alarms when they count.
     */
    function alarmRows(d) {
      const rows = new Map();
      for (const a of d.alarms || []) {
        const title = baseTitle(a.title);
        const key = title.toLowerCase();
        const row = rows.get(key) || { title, value: null, counts: !a.state || !!opts.includeStates };
        if (a.value === true) row.value = true;
        else if (a.value === false && row.value !== true) row.value = false;
        rows.set(key, row);
      }
      return [...rows.values()];
    }

    function toggle(id) {
      const d = devices.find(x => x.id === id);
      openId = openId === id || !d || 'missing' in d ? null : id;
      render();
    }

    function tileFor(id) {
      let tile = tiles.get(id);
      if (!tile) {
        const node = el('div', { class: 'sa-tile', 'data-device': id, role: 'button', tabindex: '0' });
        // Taps from the touch events, as in Device Quick Actions: a touch that ends within TAP_SLOP of where it
        // started. A drag is left to the dashboard, so it still scrolls.
        let start = null;
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
          lastTouchTap = Date.now();
          toggle(id);
        });
        node.addEventListener('touchcancel', unpress);
        node.addEventListener('click', () => {
          if (Date.now() - lastTouchTap < 800) return;
          toggle(id);
        });
        node.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' && e.key !== ' ') return;
          e.preventDefault();
          toggle(id);
        });
        const icon = el('span', { class: 'sa-icon' }, node);
        const text = el('div', { class: 'sa-text' }, node);
        tile = {
          tile: node,
          icon,
          name: el('span', { class: 'sa-name', dir: 'auto' }, text),
          status: el('span', { class: 'sa-status', dir: 'auto' }, text),
        };
        tiles.set(id, tile);
      }
      return tile;
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--sa-mask') !== v) node.style.setProperty('--sa-mask', v);
    }

    function renderPanel() {
      const index = devices.findIndex(x => x.id === openId);
      const d = devices[index];
      if (!d || 'missing' in d) {
        openId = null;
        panel.remove();
        return;
      }
      // Right after the tapped tile's row (2 per row).
      const after = tiles.get(devices[Math.min(index | 1, devices.length - 1)].id);
      if (after && panel.previousSibling !== after.tile) after.tile.after(panel);
      const rows = alarmRows(d);
      panelList.textContent = '';
      if (!rows.length) el('div', { class: 'sa-empty', dir: 'auto', text: t('noSensors') }, panelList);
      for (const r of rows) {
        const row = el('div', { class: 'sa-row' }, panelList);
        row.classList.toggle('on', r.value === true);
        row.classList.toggle('alarm', r.value === true && r.counts);
        el('span', { class: 'sa-dot' }, row);
        el('span', { class: 'sa-row-title', dir: 'auto', text: r.title }, row);
        el('span', { class: 'sa-row-state', dir: 'auto', text: r.value == null ? '–' : t(r.value ? 'active' : 'inactive') }, row);
      }
    }

    let lastHeight = 0;
    function render() {
      const ids = new Set(devices.map(d => d.id));
      for (const [id, tile] of tiles) {
        if (!ids.has(id)) { tile.tile.remove(); tiles.delete(id); }
      }
      for (const d of devices) {
        const tile = tileFor(d.id);
        grid.appendChild(tile.tile); // keeps the settings' order; a no-op when already in place
        const missing = 'missing' in d;
        tile.name.textContent = missing ? '' : d.name;
        tile.name.style.display = missing ? 'none' : '';
        tile.status.textContent = statusText(d);
        setMask(tile.icon, missing ? null : d.icon);
        tile.icon.classList.toggle('fallback', missing || !d.icon);
        tile.tile.classList.toggle('alarm', !missing && activeAlarms(d).length > 0);
        tile.tile.classList.toggle('missing', missing);
        tile.tile.classList.toggle('open', d.id === openId);
        tile.tile.setAttribute('aria-expanded', String(d.id === openId));
      }
      renderPanel();
      grid.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, pushChange, setMessage, render, t };
  }

  window.createSensorAlarmsWidget = createSensorAlarmsWidget;
})();
