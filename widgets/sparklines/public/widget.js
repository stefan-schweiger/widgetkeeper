/*
 * Sparklines: Device Values' tiles (widgets/values) with a small chart of each value's recent history,
 * its lowest and highest value at the chart's right edge. Display only.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_STRINGS = {
    selectSlots: 'Pick device values in the widget settings.',
    error: 'Could not load the values.',
    unavailable: 'Unavailable',
  };

  const SPAN_MS = { '1h': 3600e3, '6h': 6 * 3600e3, '24h': 24 * 3600e3, '7d': 7 * 24 * 3600e3 };
  /** The chart's vertical padding, so the line and the dot aren't cut at the top and bottom. */
  const PAD = 3;

  // The glyphs, glyph(), percentOf() and formatValue() are copied from widgets/values/public/widget.js
  // (Homey serves each widget's files separately), trimmed to numbers: only those have sparklines.
  const svg = (viewBox, body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  const GLYPHS = {
    thermometer: svg('7.4 2.4 9.2 19.6', '<path d="M10 13.8V5a2 2 0 0 1 4 0v8.8a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>'),
    drop: svg('5.4 2.4 13.2 18.2', '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
    bolt: svg('3.4 1.4 16.2 21.2', '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    sun: svg('1.4 1.4 21.2 21.2', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    cloud: svg('2.4 3.4 20.2 15.2', '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5z"/>'),
    battery: svg('2.4 6.4 19.2 11.2', '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4"/>'),
    bulb: svg('5.4 2.4 13.2 19.2', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>'),
    wave: svg('2.4 2.4 19.2 16.2', '<path d="M3 12h2l2-6 3 12 3-15 3 15 2-6h3"/>'),
    gauge: svg('3.4 8.4 17.2 9.2', '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>'),
  };

  function glyph(capabilityId) {
    const base = capabilityId.split('.')[0];
    if (base === 'measure_temperature' || base === 'target_temperature') return GLYPHS.thermometer;
    if (base === 'measure_humidity' || base === 'measure_rain') return GLYPHS.drop;
    if (base === 'measure_power' || base === 'meter_power' || base === 'measure_current' || base === 'measure_voltage') return GLYPHS.bolt;
    if (base === 'measure_luminance' || base === 'measure_ultraviolet') return GLYPHS.sun;
    if (/^measure_(co2|co|pm\d+|voc|tvoc)$/.test(base)) return GLYPHS.cloud;
    if (base === 'measure_battery') return GLYPHS.battery;
    if (base === 'dim') return GLYPHS.bulb;
    if (base === 'measure_noise') return GLYPHS.wave;
    return GLYPHS.gauge;
  }

  const TIGHT_UNITS = /^(°|%)/;

  /** A `%` number as 0–100 (a 0–1 range, like Homey's `dim`, is scaled up), else the number itself. */
  function scaled(cap, value) {
    return cap.units === '%' && cap.max === 1 && (cap.min == null || cap.min === 0) ? value * 100 : value;
  }

  /** The number in the device locale, to the capability's decimals (at most 1 without them). */
  function formatNumber(cap, value) {
    const percent = scaled(cap, value) !== value;
    const digits = percent ? 0 : cap.decimals != null ? Math.max(0, Math.min(cap.decimals, 4)) : null;
    return scaled(cap, value).toLocaleString(undefined, digits != null
      ? { minimumFractionDigits: 0, maximumFractionDigits: digits }
      : { maximumFractionDigits: 1 });
  }

  function formatValue(cap, value) {
    if (typeof value !== 'number' || !isFinite(value)) return value == null ? '–' : String(value);
    const text = formatNumber(cap, value);
    if (!cap.units) return text;
    return TIGHT_UNITS.test(cap.units) ? `${text}${cap.units}` : `${text} ${cap.units}`;
  }

  /**
   * The line and area paths for `points` (`[t, v]`, oldest first) drawn over `[from, to]` in a `w` × `h`
   * box, and the lowest and highest value shown. x is by time; y runs from the lowest value (bottom) to
   * the highest (top). A flat series sits in the middle. Null with fewer than 2 points in the span.
   * @param {[number, number][]} points
   */
  function sparkPath(points, from, to, w, h) {
    const shown = points.filter(p => p[0] >= from && p[0] <= to && typeof p[1] === 'number' && isFinite(p[1]));
    if (shown.length < 2) return null;
    let min = Infinity;
    let max = -Infinity;
    for (const [, v] of shown) { if (v < min) min = v; if (v > max) max = v; }
    const x = t => Math.round((t - from) / (to - from) * w * 10) / 10;
    const y = v => Math.round((max === min ? h / 2 : PAD + (1 - (v - min) / (max - min)) * (h - 2 * PAD)) * 10) / 10;
    const xy = shown.map(([t, v]) => [x(t), y(v)]);
    const line = xy.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join('');
    const area = `${line}L${xy[xy.length - 1][0]} ${h}L${xy[0][0]} ${h}Z`;
    const [dx, dy] = xy[xy.length - 1];
    return { line, area, dot: { x: dx, y: dy }, min, max };
  }

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
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const keyOf = s => `${s.deviceId}:${s.capabilityId}`;
  const lastT = points => (points.length ? points[points.length - 1][0] : -Infinity);

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, span?: string, columns?: number|string,
   *   now?: () => number, onHeight?: (h: number) => void }} opts
   */
  function createSparklinesWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`sparklines.${key}`, tokens) : null;
      if (s && s !== `sparklines.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const now = opts.now || (() => Date.now());
    const spanMs = SPAN_MS[opts.span] || SPAN_MS['24h'];

    let slots = []; // [{ deviceId, capabilityId, name, capability, value, points } | { deviceId, capabilityId, missing }]
    let messageText = null;
    let messageTimer = null;

    root.classList.add('sl');
    root.dataset.columns = String(opts.columns) === '1' ? '1' : '2';
    const grid = el('div', { class: 'sl-grid' }, root);
    const messageEl = el('div', { class: 'sl-message', dir: 'auto' }, root);
    const tiles = new Map();

    /** Live points received since the last fetch are kept when a refresh brings an older history (it's cached up to 5 min). */
    function setState(list) {
      const previous = new Map();
      for (const s of slots) if (s.points) previous.set(keyOf(s), s.points);
      slots = (Array.isArray(list) ? list : []).map((s) => {
        if ('missing' in s) return s;
        const points = Array.isArray(s.points) ? s.points.slice() : [];
        const old = previous.get(keyOf(s)) || [];
        const after = lastT(points);
        return { ...s, points: points.concat(old.filter(p => p[0] > after)) };
      });
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      let changed = false;
      const at = now();
      for (const s of slots) {
        if (s.deviceId !== deviceId || s.capabilityId !== capabilityId || 'missing' in s) continue;
        s.value = value;
        if (typeof value === 'number' && isFinite(value)) {
          s.points.push([at, value]);
          while (s.points.length && s.points[0][0] < at - spanMs) s.points.shift();
        }
        changed = true;
      }
      if (changed) render();
    }

    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else slots = [];
      render();
    }

    // The SVG and its shapes stay in place; only their attributes change.
    function tileFor(key) {
      let tile = tiles.get(key);
      if (!tile) {
        const node = el('div', { class: 'sl-tile', 'data-slot': key });
        const top = el('div', { class: 'sl-top' }, node);
        const icon = el('span', { class: 'sl-icon' }, top);
        const value = el('span', { class: 'sl-value', dir: 'auto' }, top);
        const chart = el('div', { class: 'sl-chart' }, node);
        const plot = el('svg', { class: 'sl-plot', 'aria-hidden': 'true' }, chart, SVG_NS);
        const area = el('path', { class: 'sl-area' }, plot, SVG_NS);
        const line = el('path', { class: 'sl-line' }, plot, SVG_NS);
        const dot = el('circle', { class: 'sl-dot', r: '2.5' }, plot, SVG_NS);
        const range = el('div', { class: 'sl-range' }, chart);
        const max = el('span', { class: 'sl-max' }, range);
        const min = el('span', { class: 'sl-min' }, range);
        const name = el('span', { class: 'sl-name', dir: 'auto' }, node);
        tile = { tile: node, icon, value, plot, area, line, dot, max, min, name };
        tiles.set(key, tile);
      }
      return tile;
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--sl-mask') !== v) node.style.setProperty('--sl-mask', v);
    }

    function drawChart(tile, s) {
      const w = Math.round(tile.plot.getBoundingClientRect().width) || 100;
      const h = Math.round(tile.plot.getBoundingClientRect().height) || 36;
      tile.plot.setAttribute('viewBox', `0 0 ${w} ${h}`);
      const to = now();
      let points = 'missing' in s ? [] : s.points;
      // The value holds until it changes (Homey doesn't log repeats), so the line runs on to now.
      if (!('missing' in s) && typeof s.value === 'number' && isFinite(s.value) && lastT(points) < to) points = points.concat([[to, s.value]]);
      const p = sparkPath(points, to - spanMs, to, w, h);
      tile.line.setAttribute('d', p ? p.line : '');
      tile.area.setAttribute('d', p ? p.area : '');
      tile.dot.style.display = p ? '' : 'none';
      if (p) { tile.dot.setAttribute('cx', String(p.dot.x)); tile.dot.setAttribute('cy', String(p.dot.y)); }
      tile.max.textContent = p ? `↑${formatNumber(s.capability, p.max)}` : '';
      tile.min.textContent = p ? `↓${formatNumber(s.capability, p.min)}` : '';
    }

    let lastHeight = 0;
    function render() {
      const keys = slots.map((s, i) => `${keyOf(s)}#${i}`);
      const wanted = new Set(keys);
      for (const [key, tile] of tiles) {
        if (!wanted.has(key)) { tile.tile.remove(); tiles.delete(key); }
      }
      slots.forEach((s, i) => {
        const tile = tileFor(keys[i]);
        grid.appendChild(tile.tile);
        const missing = 'missing' in s;
        tile.name.textContent = missing ? t('unavailable') : s.name;
        tile.value.textContent = missing ? '' : formatValue(s.capability, s.value);
        setMask(tile.icon, missing ? glyph(s.capabilityId) : (s.capability.icon || glyph(s.capabilityId)));
        drawChart(tile, s);
        tile.tile.classList.toggle('missing', missing);
        tile.tile.dataset.capability = s.capabilityId;
        tile.tile.title = missing ? '' : s.capability.title;
      });
      grid.style.display = slots.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && slots.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    // The line scrolls with time: about one of its 120 points per redraw.
    setInterval(render, Math.max(10e3, Math.min(60e3, spanMs / 120)));
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => render()).observe(grid);

    return { setState, pushChange, setMessage, render, t };
  }

  window.createSparklinesWidget = createSparklinesWidget;
  window.sparkPath = sparkPath;
})();
