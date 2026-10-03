/*
 * Sensor Alarms: a grid of device tiles, 2 per row, each with the device's icon, its name and its
 * current alarm (or "No alarm"). A tile with an active alarm turns red.
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
  };

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

    root.classList.add('sa');
    const grid = el('div', { class: 'sa-grid' }, root);
    const messageEl = el('div', { class: 'sa-message', dir: 'auto' }, root);
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
        const title = String(a.title).replace(/\s*\([^)]*\)\s*$/, '') || a.title;
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

    function tileFor(id) {
      let tile = tiles.get(id);
      if (!tile) {
        const node = el('div', { class: 'sa-tile', 'data-device': id });
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
      }
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
