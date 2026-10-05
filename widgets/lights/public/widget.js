/*
 * Light Controls: compact light tiles, two per row (no brightness text: the bar shows it, and the space
 * goes to the temperature chip's tap area). A tap on the tile turns the light on or off; the bar
 * at the bottom sets the brightness (0 = off), or the colour temperature after a tap on the chip.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const OPTIMISTIC_MS = 10e3; // how long a changed tile shows its new value while waiting for the device
  const TEMP_MODE_MS = 6e3; // the bar switches back to brightness after this long without a touch
  const TAP_SLOP = 10; // px a finger may move and still count as a tap

  const DEFAULT_STRINGS = {
    selectDevices: 'Select lights in the widget settings.',
    error: 'Could not load the lights.',
    failed: 'Could not change __name__.',
    unavailable: 'Unavailable',
    temperature: 'Colour temperature',
  };

  const svg = (viewBox, body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  // A thermometer with a sun ray, for the temperature chip.
  const TEMP_GLYPH = svg('6.3 1.3 11.4 21.4', '<path d="M10 14.5V4a2 2 0 0 1 4 0v10.5a4 4 0 1 1-4 0z"/><circle cx="12" cy="17.5" r="1.6" fill="#000"/><path d="M12 9.5v6"/>');

  /** The colour of a temperature (0 = cool, 1 = warm), as on Homey's own light card. */
  function temperatureColor(k) {
    const cool = [214, 232, 255];
    const warm = [255, 176, 84];
    const mix = cool.map((c, i) => Math.round(c + (warm[i] - c) * Math.min(1, Math.max(0, k))));
    return `rgb(${mix.join(' ')})`;
  }

  /** The colour a light shines in: its hue in colour mode, else its temperature (or a warm white). */
  function lightColor(caps) {
    const v = id => (caps[id] ? caps[id].value : null);
    const hue = v('light_hue');
    const colourMode = v('light_mode') === 'color' || (!caps.light_mode && !caps.light_temperature);
    if (colourMode && typeof hue === 'number') {
      const sat = typeof v('light_saturation') === 'number' ? v('light_saturation') : 1;
      return `hsl(${Math.round(hue * 360)} ${Math.round(sat * 100)}% 62%)`;
    }
    const k = v('light_temperature');
    return temperatureColor(typeof k === 'number' ? k : 0.6);
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

  const clamp01 = x => Math.min(1, Math.max(0, x));
  /** Snaps to whole percent; anything below half a percent is 0 (off). */
  const snap = x => Math.round(clamp01(x) * 100) / 100;

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string,
   *   onSet?: (deviceId: string, change: {dim?: number, onoff?: boolean, temperature?: number}) => Promise<any>,
   *   onHeight?: (h: number) => void }} opts
   */
  function createLightsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`lights.${key}`, tokens) : null;
      if (s && s !== `lights.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    let devices = []; // [{ id, name, icon, caps } | { id, missing }]
    const optimistic = new Map(); // `${deviceId}:${capabilityId}` → { value, until }
    const tempMode = new Map(); // deviceId → timer, while the bar sets the temperature
    const drags = new Map(); // deviceId → fraction, while a finger or the mouse is on the bar
    let messageText = null;
    let messageTimer = null;

    root.classList.add('lc');
    const grid = el('div', { class: 'lc-grid' }, root);
    const messageEl = el('div', { class: 'lc-message', dir: 'auto' }, root);
    let lastTouchTap = 0;
    /** @type {Map<string, {tile: HTMLElement, icon: HTMLElement, chip: HTMLButtonElement,
     *   name: HTMLElement, bar: HTMLElement, fill: HTMLElement, knob: HTMLElement}>} */
    const tiles = new Map();

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      const d = devices.find(x => x.id === deviceId);
      if (!d || !d.caps || !d.caps[capabilityId]) return;
      d.caps[capabilityId].value = value;
      const key = `${deviceId}:${capabilityId}`;
      const o = optimistic.get(key);
      if (o && o.value === value) optimistic.delete(key);
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

    /** A capability's value, or the one just sent while the device hasn't confirmed it. */
    function shown(d, capabilityId) {
      const key = `${d.id}:${capabilityId}`;
      const o = optimistic.get(key);
      if (o && Date.now() < o.until) return o.value;
      optimistic.delete(key);
      return d.caps[capabilityId] ? d.caps[capabilityId].value : null;
    }

    function hope(d, values) {
      const until = Date.now() + OPTIMISTIC_MS;
      for (const [id, value] of Object.entries(values)) {
        if (d.caps[id]) optimistic.set(`${d.id}:${id}`, { value, until });
      }
      setTimeout(render, OPTIMISTIC_MS + 50);
    }

    /** Whether the light is on: `onoff`, or a brightness above 0 without it. */
    function isOn(d) {
      const dim = shown(d, 'dim');
      if (d.caps.onoff) return shown(d, 'onoff') === true;
      return typeof dim === 'number' && dim > 0;
    }

    function brightness(d) {
      const dim = shown(d, 'dim');
      return isOn(d) && typeof dim === 'number' ? dim : 0;
    }

    async function send(d, change) {
      if (!opts.onSet) return;
      try {
        await opts.onSet(d.id, change);
      } catch (err) {
        console.error(err);
        for (const id of ['onoff', 'dim', 'light_temperature', 'light_mode']) optimistic.delete(`${d.id}:${id}`);
        const tile = tiles.get(d.id);
        if (tile) {
          tile.tile.classList.remove('shake');
          void tile.tile.offsetWidth; // restart the animation
          tile.tile.classList.add('shake');
        }
        setMessage(t('failed', { name: d.name }), true);
      }
    }

    function toggle(id) {
      const d = devices.find(x => x.id === id);
      if (!d || !d.caps) return;
      const on = !isOn(d);
      if (d.caps.onoff) hope(d, { onoff: on });
      else hope(d, { dim: on ? (shown(d, 'dim') || 1) : 0 });
      render();
      send(d, { onoff: on });
    }

    /** The bar was let go at `x` (0–1): brightness, or the temperature in temperature mode. */
    function commit(id, x) {
      const d = devices.find(v => v.id === id);
      if (!d || !d.caps) return;
      const value = snap(x);
      if (tempMode.has(id)) {
        hope(d, { light_temperature: value, light_mode: 'temperature', onoff: true });
        armTempMode(id);
        render();
        send(d, { temperature: value });
        return;
      }
      if (value === 0) hope(d, d.caps.onoff ? { onoff: false } : { dim: 0 });
      else hope(d, { dim: value, onoff: true });
      render();
      send(d, { dim: value });
    }

    function armTempMode(id) {
      clearTimeout(tempMode.get(id));
      tempMode.set(id, setTimeout(() => { tempMode.delete(id); render(); }, TEMP_MODE_MS));
    }

    function toggleTempMode(id) {
      if (tempMode.has(id)) {
        clearTimeout(tempMode.get(id));
        tempMode.delete(id);
      } else {
        armTempMode(id);
      }
      render();
    }

    /** Taps on the tile body: a touch that ends within TAP_SLOP, or a click. Drags scroll the dashboard. */
    function onTap(node, fn) {
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
        fn();
      });
      node.addEventListener('touchcancel', unpress);
      node.addEventListener('click', () => {
        if (Date.now() - lastTouchTap < 800) return;
        fn();
      });
    }

    /**
     * The bar: a drag sets the value live and sends it when let go; a tap sets it where it lands. The
     * touches are taken (preventDefault, touch-action: none) so iOS doesn't scroll the dashboard. Homey's
     * Android app takes the touch anyway after about 100 ms (touchcancel): that gesture is dropped, but a
     * quick tap still gets through.
     */
    function wireBar(id, bar) {
      const at = clientX => {
        const r = bar.getBoundingClientRect();
        return r.width ? clamp01((clientX - r.left) / r.width) : 0;
      };
      const move = (clientX) => {
        drags.set(id, at(clientX));
        if (tempMode.has(id)) armTempMode(id);
        render();
      };
      const end = (commitIt) => {
        if (!drags.has(id)) return;
        const x = drags.get(id);
        drags.delete(id);
        bar.classList.remove('dragging');
        if (commitIt) commit(id, x);
        else render();
      };
      bar.addEventListener('touchstart', (e) => {
        e.preventDefault();
        e.stopPropagation();
        bar.classList.add('dragging');
        move(e.changedTouches[0].clientX);
      }, { passive: false });
      bar.addEventListener('touchmove', (e) => {
        e.preventDefault();
        move(e.changedTouches[0].clientX);
      }, { passive: false });
      bar.addEventListener('touchend', (e) => {
        e.preventDefault();
        e.stopPropagation();
        lastTouchTap = Date.now();
        end(true);
      });
      bar.addEventListener('touchcancel', () => end(false));
      // Mouse (and pen): pointer events with capture, ignored for touch (handled above).
      bar.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch') return;
        e.preventDefault();
        if (bar.setPointerCapture) bar.setPointerCapture(e.pointerId);
        bar.classList.add('dragging');
        move(e.clientX);
      });
      bar.addEventListener('pointermove', (e) => {
        if (e.pointerType === 'touch' || !drags.has(id)) return;
        move(e.clientX);
      });
      bar.addEventListener('pointerup', (e) => {
        if (e.pointerType === 'touch') return;
        end(true);
      });
      bar.addEventListener('pointercancel', (e) => {
        if (e.pointerType === 'touch') return;
        end(false);
      });
      bar.addEventListener('click', e => e.stopPropagation()); // not a toggle
    }

    function tileFor(id) {
      let tile = tiles.get(id);
      if (!tile) {
        const node = el('div', { class: 'lc-tile', 'data-device': id });
        const top = el('div', { class: 'lc-top' }, node);
        const icon = el('span', { class: 'lc-icon' }, top);
        const chip = el('button', { type: 'button', class: 'lc-chip', 'aria-label': t('temperature') }, top);
        el('span', { class: 'lc-chip-glyph' }, chip).style.setProperty('--lc-mask', `url("${TEMP_GLYPH}")`);
        const name = el('span', { class: 'lc-name', dir: 'auto' }, node);
        const bar = el('div', { class: 'lc-bar', role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '100' }, node);
        const track = el('div', { class: 'lc-track' }, bar);
        const fill = el('div', { class: 'lc-fill' }, track);
        const knob = el('div', { class: 'lc-knob' }, bar);
        tile = { tile: node, icon, chip, name, bar, fill, knob };
        onTap(node, () => toggle(id));
        // The chip is inside the tile: its own taps must not toggle the light.
        for (const type of ['touchstart', 'touchend', 'click']) {
          chip.addEventListener(type, (e) => {
            e.stopPropagation();
            if (type === 'touchstart') return;
            if (type === 'touchend') { e.preventDefault(); lastTouchTap = Date.now(); }
            else if (Date.now() - lastTouchTap < 800) return;
            toggleTempMode(id);
          }, { passive: type !== 'touchend' });
        }
        wireBar(id, bar);
        tiles.set(id, tile);
      }
      return tile;
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--lc-mask') !== v) node.style.setProperty('--lc-mask', v);
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
        const missing = 'missing' in d || !d.caps || !d.caps.dim;
        tile.tile.classList.toggle('missing', missing);
        tile.name.textContent = missing ? t('unavailable') : d.name;
        setMask(tile.icon, missing ? null : d.icon);
        tile.icon.classList.toggle('fallback', missing || !d.icon);
        if (missing) {
          tile.chip.style.display = 'none';
          tile.tile.classList.remove('on', 'temp');
          tile.tile.style.removeProperty('--lc-light');
          tile.tile.style.setProperty('--lc-x', '0');
          continue;
        }
        const hasTemp = !!d.caps.light_temperature && d.caps.light_temperature.setable !== false;
        if (!hasTemp && tempMode.has(d.id)) { clearTimeout(tempMode.get(d.id)); tempMode.delete(d.id); }
        const temp = tempMode.has(d.id);
        const caps = Object.fromEntries(Object.keys(d.caps).map(k => [k, { value: shown(d, k) }]));
        const on = isOn(d);
        const drag = drags.get(d.id);
        const k = shown(d, 'light_temperature');
        const x = drag != null ? snap(drag) : temp ? (typeof k === 'number' ? k : 0) : brightness(d);

        tile.chip.style.display = hasTemp ? '' : 'none';
        tile.chip.classList.toggle('active', temp);
        tile.tile.classList.toggle('on', on || (drag != null && !temp && x > 0));
        tile.tile.classList.toggle('temp', temp);
        tile.tile.style.setProperty('--lc-light', temp && drag != null ? temperatureColor(x) : lightColor(caps));
        tile.tile.style.setProperty('--lc-x', String(x));
        tile.bar.setAttribute('aria-valuenow', String(Math.round(x * 100)));
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

  window.createLightsWidget = createLightsWidget;
})();
