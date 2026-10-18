/*
 * Value Matrix: the picked devices (or their rooms) as rows and a capability per column, each cell its value, green
 * (OK) inside the column's range, orange (Warning) outside it and red (Alert) far outside; striped where a row hasn't
 * the value. A legend of the three under the table. Display only.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, tileNames, applyColors } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const DEFAULT_STRINGS = {
    selectDevices: 'Select devices in the widget settings.',
    selectColumns: 'Pick the values to show in the widget settings.',
    error: 'Could not load the values.',
    unavailable: 'Unavailable',
    renameFailed: 'Could not save the name.',
    ok: 'OK',
    warning: 'Warning',
    alert: 'Alert',
    noReading: 'No reading',
    radon: 'Radon',
    voc: 'VOC',
  };

  /**
   * Capabilities with a usual comfortable range (Room Health's defaults) and a short header, both only in the unit
   * named (`units`, matched without case; a missing one passes where `optional`). `label` is a string key when it's
   * translated.
   */
  const KNOWN = [
    { id: /^measure_temperature(\.|$)/, units: /^°C$/, range: { min: 18, max: 24 }, label: '°C' },
    { id: /^measure_humidity(\.|$)/, units: /^%$/, range: { min: 30, max: 60 }, label: '%' },
    { id: /^measure_co2$/, units: /^ppm$/i, optional: true, range: { min: null, max: 1000 }, label: 'CO₂' },
    { id: /^measure_radon$/, units: /^bq\/m(3|³)$/i, range: { min: null, max: 100 }, label: { key: 'radon' } },
    { id: /^measure_pm25$/, units: /^(μ|µ|u)g\/m(3|³)$/i, optional: true, range: { min: null, max: 15 }, label: 'PM2.5' },
    { id: /^measure_pm10$/, units: /^(μ|µ|u)g\/m(3|³)$/i, optional: true, range: { min: null, max: 45 }, label: 'PM10' },
    { id: /^measure_t?voc$/i, units: /^ppb$/i, range: { min: null, max: 1000 }, label: { key: 'voc' } },
  ];

  /** The known capability a column is, in its expected unit, or null. */
  function knownOf(column) {
    if (!column || !column.capabilityId) return null;
    const units = column.units ? String(column.units).trim() : '';
    return KNOWN.find(k => k.id.test(column.capabilityId) && (units ? k.units.test(units) : !!k.optional)) || null;
  }

  const NUM = '(-?\\d+(?:[.,]\\d+)?)';
  const BETWEEN = new RegExp(`^${NUM}\\s*[-–—]\\s*${NUM}$`);
  const BELOW = new RegExp(`^(?:<=?|≤)\\s*${NUM}$`);
  const ABOVE = new RegExp(`^(?:>=?|≥)\\s*${NUM}$`);
  const toNum = s => Number(s.replace(',', '.'));

  /**
   * A column's OK range, `{min, max}` (either may be null), from its setting: `18–24` (or `-`/`—`), `<1000`,
   * `≤1000`, `>10`, `≥10`. Empty is the usual range of a known capability in its unit (`column`: `{capabilityId,
   * units}`), else none; `–` alone, or text it can't read, is none (null).
   */
  function valueMatrixRange(text, column) {
    const s = typeof text === 'string' ? text.trim() : text == null ? '' : String(text).trim();
    if (!s) {
      const known = knownOf(column);
      return known ? { ...known.range } : null;
    }
    let m = s.match(BETWEEN);
    if (m) {
      const [a, b] = [toNum(m[1]), toNum(m[2])];
      return { min: Math.min(a, b), max: Math.max(a, b) };
    }
    if ((m = s.match(BELOW))) return { min: null, max: toNum(m[1]) };
    if ((m = s.match(ABOVE))) return { min: toNum(m[1]), max: null };
    return null;
  }

  /**
   * A cell's level: `none` without a reading, `plain` without a range, else `good` inside it (edges included), `out`
   * past it, and `far` past it by half its width or more (one-sided: half the limit, so 1.5 × an upper one).
   */
  function valueMatrixLevel(value, range) {
    if (typeof value !== 'number' || !isFinite(value)) return 'none';
    if (!range || (range.min == null && range.max == null)) return 'plain';
    let distance = 0;
    if (range.min != null && value < range.min) distance = range.min - value;
    else if (range.max != null && value > range.max) distance = value - range.max;
    if (distance <= 0) return 'good';
    const margin = range.min != null && range.max != null ? (range.max - range.min) / 2 : Math.abs(range.min != null ? range.min : range.max) / 2;
    return distance >= margin ? 'far' : 'out';
  }

  /**
   * The rows: in `rooms` mode the devices grouped by zone, in the order their first device was picked, keyed
   * `zone:<id>` (a device without a known zone is a row of its own, keyed by its id); in `devices` mode one row per
   * device. A missing device is a row of its own. `values[capabilityId]` is the average of the row's devices that
   * read it (null when none does); a capability no device of the row has is left out.
   */
  function valueMatrixRows(devices, mode) {
    const rows = [];
    const byZone = new Map();
    for (const d of Array.isArray(devices) ? devices : []) {
      if (!d || typeof d !== 'object') continue;
      if ('missing' in d) { rows.push({ key: d.id, missing: true, devices: [], values: {} }); continue; }
      const zone = mode !== 'devices' && d.zone && d.zone.id ? d.zone : null;
      if (zone && byZone.has(zone.id)) { byZone.get(zone.id).devices.push(d); continue; }
      const row = zone ? { key: `zone:${zone.id}`, name: zone.name, devices: [d] } : { key: d.id, name: d.name, devices: [d] };
      if (zone) byZone.set(zone.id, row);
      rows.push(row);
    }
    for (const row of rows) {
      if (row.missing) continue;
      row.values = {};
      const ids = new Set(row.devices.flatMap(d => Object.keys(d.values || {})));
      for (const id of ids) {
        const read = row.devices.map(d => (d.values || {})[id]).filter(v => typeof v === 'number' && isFinite(v));
        row.values[id] = read.length ? read.reduce((a, b) => a + b, 0) / read.length : null;
      }
    }
    return rows;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ colorStyle?: string, rows?: string, showLegend?: boolean, columns?: {capabilityId: string, title?: string, range?: string, header?: string}[],
   *   t?: (key: string, tokens?: object) => string, locale?: string, renameTiles?: boolean,
   *   onRename?: (key: string, name: string) => Promise<any>, onHeight?: (h: number) => void }} opts
   */
  function createValueMatrixWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`valuematrix.${key}`, tokens) : null;
      if (s && s !== `valuematrix.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    const mode = opts.rows === 'devices' ? 'devices' : 'rooms';
    const picked = Array.isArray(opts.columns) ? opts.columns.filter(c => c && c.capabilityId) : [];
    let described = []; // the app's column descriptions, by position: {capabilityId, title, units, decimals} | null
    let devices = []; // [{ id, name, zone, values: {[capabilityId]: number | null} } | { id, missing }]
    let messageText = null;
    let messageTimer = null;

    root.classList.add('vm');
    applyColors(root, { style: opts.colorStyle });
    const typed = tileNames(opts, () => render(), (key) => {
      const row = rowEls.get(key);
      if (row) {
        row.node.classList.remove('shake');
        void row.node.offsetWidth; // restart the animation
        row.node.classList.add('shake');
      }
      setMessage(t('renameFailed'), true);
    });
    root.classList.toggle('renaming', typed.renaming);
    const tileEl = el('div', { class: 'vm-tile' }, root);
    // One grid for the header and every row (each `display: contents`), so the name column fits the names.
    const gridEl = el('div', { class: 'vm-grid' }, tileEl);
    const headEl = el('div', { class: 'vm-row vm-head', 'aria-hidden': 'true' }, gridEl);
    const legendEl = el('div', { class: 'vm-legend', 'aria-hidden': 'true' }, tileEl);
    for (const [level, key] of [['good', 'ok'], ['out', 'warning'], ['far', 'alert']]) {
      const item = el('span', { class: 'vm-key' }, legendEl);
      el('span', { class: 'vm-swatch', 'data-level': level }, item);
      el('span', { class: 'vm-key-label', text: t(key) }, item);
    }
    const messageEl = el('div', { class: 'vm-message', dir: 'auto' }, root);
    /** @type {Map<string, {node: HTMLElement, name: HTMLElement}>} */
    const rowEls = new Map();

    /** `{columns, devices}` from the app's `/state`. */
    function setState(state) {
      described = state && Array.isArray(state.columns) ? state.columns : [];
      devices = state && Array.isArray(state.devices) ? state.devices : [];
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      const d = devices.find(x => x.id === deviceId);
      if (!d || !d.values || !(capabilityId in d.values)) return;
      d.values[capabilityId] = typeof value === 'number' && isFinite(value) ? value : null;
      render();
    }

    /** A message under the table. Persistent messages also clear it. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else devices = [];
      render();
    }

    /** Each picked column with what the app said about it, its range and its header. */
    function columns() {
      return picked.map((c, i) => {
        const d = described[i] && described[i].capabilityId === c.capabilityId ? described[i] : { capabilityId: c.capabilityId, title: c.title || c.capabilityId, units: null, decimals: null };
        const known = knownOf(d);
        const header = typeof c.header === 'string' && c.header.trim() ? c.header.trim()
          : known ? (typeof known.label === 'string' ? known.label : t(known.label.key))
            : d.units && d.units.length <= 4 ? d.units : d.title;
        return { ...d, header, range: valueMatrixRange(c.range, d) };
      });
    }

    /**
     * A value in the device locale, to the column's decimals (at most one; up to one when it has none). With more than
     * four columns the cells are narrow, so without a thousands separator.
     */
    function formatNumber(column, value, many) {
      if (typeof value !== 'number' || !isFinite(value)) return '–';
      const digits = column.decimals != null ? Math.max(0, Math.min(column.decimals, 1)) : null;
      return value.toLocaleString(opts.locale, {
        ...(digits != null ? { minimumFractionDigits: digits, maximumFractionDigits: digits } : { maximumFractionDigits: 1 }),
        useGrouping: !many,
      });
    }

    function rowName(row) {
      return row.missing ? t('unavailable') : typed.name(row.key, row.name);
    }

    function rowFor(key) {
      let row = rowEls.get(key);
      if (!row) {
        const node = el('div', { class: 'vm-row', 'data-row': key, role: 'group' });
        const name = el('span', { class: 'vm-name', dir: 'auto' }, node);
        row = { node, name };
        rowEls.set(key, row);
      }
      return row;
    }

    let lastHeight = 0;
    function reportHeight() {
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    const LEVEL_WORDS = { good: 'ok', out: 'warning', far: 'alert' };

    function render() {
      const cols = columns();
      const rows = valueMatrixRows(devices, mode);
      gridEl.style.setProperty('--vm-n', String(cols.length));
      const many = cols.length > 4;
      gridEl.classList.toggle('vm-many', many);
      // The header: an empty corner over the names, then each column's label.
      const heads = headEl.children;
      while (heads.length < cols.length + 1) el('span', { class: 'vm-label', dir: 'auto' }, headEl);
      while (heads.length > cols.length + 1) headEl.lastChild.remove();
      cols.forEach((c, i) => { heads[i + 1].textContent = c.header; heads[i + 1].title = c.title; });

      const keys = new Set(rows.map(r => r.key));
      for (const [key, row] of rowEls) {
        if (!keys.has(key)) { row.node.remove(); rowEls.delete(key); }
      }
      let placed = null;
      for (const r of rows) {
        const row = rowFor(r.key);
        // Keeps the order, moving only what is out of place: a moved node loses the focus of a field in it.
        const want = placed ? placed.nextSibling : headEl.nextSibling;
        if (row.node !== want) gridEl.insertBefore(row.node, want);
        placed = row.node;
        const missing = !!r.missing;
        row.node.classList.toggle('missing', missing);
        row.name.textContent = rowName(r);
        let field = null;
        if (typed.renaming && !missing) {
          field = typed.field(r.key, r.name);
          if (field.previousSibling !== row.name) row.name.after(field);
        }
        const cells = /** @type {HTMLElement[]} */ ([...row.node.querySelectorAll(':scope > .vm-cell')]);
        while (cells.length < cols.length) {
          const cell = el('span', { class: 'vm-cell', 'aria-hidden': 'true' }, row.node);
          el('span', { class: 'vm-num' }, cell);
          cells.push(cell);
        }
        while (cells.length > cols.length) cells.pop().remove();
        const spoken = [];
        cols.forEach((c, i) => {
          const has = !missing && c.capabilityId in r.values;
          const value = has ? r.values[c.capabilityId] : null;
          const level = !has ? (missing ? 'none' : 'absent') : valueMatrixLevel(value, c.range);
          cells[i].dataset.level = level;
          cells[i].firstChild.textContent = has || missing ? formatNumber(c, value, many) : '';
          if (!has) return;
          const word = level === 'none' ? t('noReading') : LEVEL_WORDS[level] ? t(LEVEL_WORDS[level]) : null;
          spoken.push([c.header, level === 'none' ? null : formatNumber(c, value), word].filter(Boolean).join(' '));
        });
        row.node.setAttribute('aria-label', missing ? t('unavailable') : [`${rowName(r)}:`, spoken.join(', ')].join(' '));
      }
      tileEl.style.display = devices.length && cols.length ? '' : 'none';
      legendEl.style.display = opts.showLegend !== false && cols.some(c => c.range) ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);
      reportHeight();
    }

    // The width can wrap the legend, so the height.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => reportHeight()).observe(root);

    return { setState, setNames: typed.set, pushChange, setMessage, render, t };
  }

  window.createValueMatrixWidget = createValueMatrixWidget;
  window.valueMatrixRange = valueMatrixRange;
  window.valueMatrixLevel = valueMatrixLevel;
  window.valueMatrixRows = valueMatrixRows;
})();
