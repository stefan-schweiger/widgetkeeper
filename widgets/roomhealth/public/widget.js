/*
 * Room Health: the indoor climate per room. The picked sensors are grouped by their Homey zone, and each room is a cell:
 * its worst value large (else the temperature), its name, and a row of marks, one per measure (temperature, humidity,
 * CO₂, radon, PM2.5, PM10, VOC): bars or icons, lined up across the rooms, grey (or green) inside the comfortable range
 * and yellow to red further out. A tap steps the large value through the room's other readings.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, tileNames, applyColors, icons } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const DEFAULT_STRINGS = {
    selectDevices: 'Select sensors in the widget settings.',
    error: 'Could not load the sensors.',
    unavailable: 'Unavailable',
    renameFailed: 'Could not save the name.',
    good: 'Good',
    noReadings: 'No readings',
    cold: 'Cold',
    warm: 'Warm',
    dry: 'Dry',
    humid: 'Humid',
    stuffy: 'Stuffy',
    radon: 'Radon',
    particles: 'Particles',
    voc: 'VOCs',
  };

  const TAP_SLOP = 10; // px a touch may move and still count as a tap
  const READOUT_MS = 6000; // how long a tapped room shows another reading

  /** The measures, in the marks' order, a tap's, and a tie's. */
  const MEASURES = ['temperature', 'humidity', 'co2', 'radon', 'pm25', 'pm10', 'voc'];
  /** Each measure's unit (the app sends every value in it). Temperature and humidity are written without a space. */
  const UNITS = { temperature: '°C', humidity: '%', co2: 'ppm', radon: 'Bq/m³', pm25: 'μg/m³', pm10: 'μg/m³', voc: 'ppb' };
  /** The comfortable ranges' settings and defaults: temperature and humidity have both ends, the rest an upper limit. */
  const RANGES = {
    temperature: { min: ['tempMin', 18], max: ['tempMax', 24] },
    humidity: { min: ['humidityMin', 30], max: ['humidityMax', 60] },
    co2: { max: ['co2Max', 1000] },
    radon: { max: ['radonMax', 100] },
    pm25: { max: ['pm25Max', 15] },
    pm10: { max: ['pm10Max', 45] },
    voc: { max: ['vocMax', 1000] },
  };
  /** How far outside the range a value is red: degrees and percentage points; the concentrations at 1.5 × their limit. */
  const MARGINS = { temperature: 3, humidity: 10 };
  /** The state word (a room's label for screen readers), per measure and side. */
  const PROBLEMS = {
    temperature: { low: 'cold', high: 'warm' },
    humidity: { low: 'dry', high: 'humid' },
    co2: { high: 'stuffy' },
    radon: { high: 'radon' },
    pm25: { high: 'particles' },
    pm10: { high: 'particles' },
    voc: { high: 'voc' },
  };
  /** Each measure's icon (the Icons layout), on the kit's 24 px grid with its 2 px round stroke. */
  const ICONS = {
    temperature: icons.thermometer.d,
    humidity: icons.drop.d,
    co2: 'M6.5 17.5h11a4 4 0 0 0 .3-7.99A5.5 5.5 0 0 0 7.1 8.53 4.5 4.5 0 0 0 6.5 17.5z',
    radon: 'M12 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM4.93 4.93A10 4 45 1 1 19.07 19.07 10 4 45 1 1 4.93 4.93zM4.93 19.07A10 4 -45 1 1 19.07 4.93 10 4 -45 1 1 4.93 19.07z',
    pm25: 'M6 5.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM13 4a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM18.5 8.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM9.5 11a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM5 16.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM14.5 14.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM11 19a1 1 0 1 0 0 2 1 1 0 0 0 0-2zM18.5 18.5a1 1 0 1 0 0 2 1 1 0 0 0 0-2z',
    pm10: 'M8 4.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM16.5 9a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5zM8.5 14.5a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z',
    voc: 'M9.5 3h5M10.5 3v6.2L5 18.5A1.7 1.7 0 0 0 6.5 21h11a1.7 1.7 0 0 0 1.5-2.5L13.5 9.2V3M7.4 15h9.2',
  };

  /**
   * The comfortable ranges from the settings: `{temperature: {min, max}, co2: {min: null, max} …}`. A missing, empty or
   * non-numeric setting is its default; a lowest above the highest is swapped.
   */
  function roomHealthRange(settings) {
    const s = settings || {};
    const num = ([id, fallback]) => {
      const v = s[id];
      return v !== '' && v != null && isFinite(Number(v)) ? Number(v) : fallback;
    };
    const out = {};
    for (const m of MEASURES) {
      let min = RANGES[m].min ? num(RANGES[m].min) : null;
      let max = num(RANGES[m].max);
      if (min != null && min > max) [min, max] = [max, min];
      out[m] = { min, max };
    }
    return out;
  }

  /**
   * How far a value is from comfortable: `{score: 0, side: null}` inside its range, else `score` 0–1 (1 at the
   * margin and beyond) and `side` 'low' or 'high'; null without a value.
   */
  function roomHealthScore(measure, value, ranges) {
    const r = ranges && ranges[measure];
    if (!r || typeof value !== 'number' || !isFinite(value)) return null;
    const margin = MARGINS[measure] != null ? MARGINS[measure] : r.max / 2;
    const out = (distance, side) => ({ score: margin > 0 ? Math.min(1, distance / margin) : 1, side });
    if (r.min != null && value < r.min) return out(r.min - value, 'low');
    if (value > r.max) return out(value - r.max, 'high');
    return { score: 0, side: null };
  }

  /**
   * The sensors as rooms: grouped by zone, in the order their first sensor was picked, keyed `zone:<id>` (a sensor
   * without a known zone is a room of its own, keyed by its id; so is a missing one). Each measure is the average of
   * the room's sensors that have it, ignoring those without a reading (null when none has one).
   */
  function roomHealthRooms(devices) {
    const rooms = [];
    const byZone = new Map();
    for (const d of Array.isArray(devices) ? devices : []) {
      if (!d || typeof d !== 'object') continue;
      if ('missing' in d) { rooms.push({ key: d.id, id: d.id, missing: true, sensors: [], values: {} }); continue; }
      const zone = d.zone && d.zone.id ? d.zone : null;
      if (zone && byZone.has(zone.id)) { byZone.get(zone.id).sensors.push(d); continue; }
      const room = zone ? { key: `zone:${zone.id}`, name: zone.name, sensors: [d] } : { key: d.id, name: d.name, sensors: [d] };
      if (zone) byZone.set(zone.id, room);
      rooms.push(room);
    }
    for (const room of rooms) {
      if (room.missing) continue;
      room.values = {};
      for (const m of MEASURES) {
        const has = room.sensors.filter(s => s.measures && s.measures[m]);
        if (!has.length) continue;
        const read = has.map(s => s.measures[m].value).filter(v => typeof v === 'number' && isFinite(v));
        room.values[m] = read.length ? read.reduce((a, b) => a + b, 0) / read.length : null;
      }
    }
    return rooms;
  }

  /** A room's worst measure, `{measure, score, side}` (the score 0 when every reading is fine), or null without readings. */
  function worstOf(room, ranges) {
    let worst = null;
    for (const m of MEASURES) {
      const s = room.values ? roomHealthScore(m, room.values[m], ranges) : null;
      if (s && (!worst || s.score > worst.score)) worst = { measure: m, ...s };
    }
    return worst;
  }

  /** The measures a room has a reading of, in MEASURES order. */
  function readable(room) {
    return room.missing ? [] : MEASURES.filter(m => typeof room.values[m] === 'number');
  }

  /** The measure a room shows large: its worst when one is off, else the temperature (or its first reading); null without one. */
  function mainMeasure(room, ranges) {
    const worst = room.missing ? null : worstOf(room, ranges);
    if (worst && worst.score > 0) return worst.measure;
    const read = readable(room);
    return read.includes('temperature') ? 'temperature' : read[0] || null;
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

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /**
   * @param {HTMLElement} root
   * @param {{ colorStyle?: string, layout?: string, columns?: number|string, greenWhenFine?: boolean, t?: (key: string, tokens?: object) => string,
   *   locale?: string, renameTiles?: boolean, onRename?: (key: string, name: string) => Promise<any>, onHeight?: (h: number) => void,
   *   tempMin?: unknown, tempMax?: unknown, humidityMin?: unknown, humidityMax?: unknown, co2Max?: unknown,
   *   radonMax?: unknown, pm25Max?: unknown, pm10Max?: unknown, vocMax?: unknown }} opts
   */
  function createRoomHealthWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`roomhealth.${key}`, tokens) : null;
      if (s && s !== `roomhealth.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    const ranges = roomHealthRange(opts);
    const layout = opts.layout === 'bars' ? 'bars' : 'icons';
    let devices = []; // [{ id, name, zone, measures: {[measure]: {capabilityId, value}} } | { id, missing }]
    let rooms = [];
    let messageText = null;
    let messageTimer = null;
    let pick = null; // { key, measure }: the reading a tap brought up in a room
    let pickTimer = null;

    root.classList.add('rh', `rh-${layout}`);
    root.classList.toggle('rh-green', opts.greenWhenFine === true);
    root.dataset.columns = ['2', '4'].includes(String(opts.columns)) ? String(opts.columns) : '3';
    applyColors(root, { style: opts.colorStyle });
    const typed = tileNames(opts, () => render(), (key) => {
      const cell = cells.get(key);
      if (cell) {
        cell.node.classList.remove('shake');
        void cell.node.offsetWidth; // restart the animation
        cell.node.classList.add('shake');
      }
      setMessage(t('renameFailed'), true);
    });
    root.classList.toggle('renaming', typed.renaming);
    const tileEl = el('div', { class: 'rh-tile' }, root);
    const grid = el('div', { class: 'rh-grid' }, tileEl);
    const messageEl = el('div', { class: 'rh-message', dir: 'auto' }, root);
    /** @type {Map<string, {node: HTMLElement, value: HTMLElement, num: HTMLElement, unit: HTMLElement, name: HTMLElement, marks: HTMLElement}>} */
    const cells = new Map();

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, measure, value }) {
      const d = devices.find(x => x.id === deviceId);
      const m = d && d.measures ? d.measures[measure] : null;
      if (!m || m.capabilityId !== capabilityId) return;
      m.value = typeof value === 'number' && isFinite(value) ? value : null;
      render();
    }

    /** A message under the rooms. Persistent messages also clear the rooms. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else devices = [];
      render();
    }

    /** A value in its measure's unit, in the device locale: temperature to a tenth, the rest whole. */
    function formatNumber(measure, value) {
      if (typeof value !== 'number' || !isFinite(value)) return '–';
      const digits = measure === 'temperature' ? 1 : 0;
      return value.toLocaleString(opts.locale, { minimumFractionDigits: digits, maximumFractionDigits: digits });
    }
    function formatValue(measure, value) {
      const text = formatNumber(measure, value);
      if (text === '–') return text;
      return measure === 'temperature' || measure === 'humidity' ? `${text}${UNITS[measure]}` : `${text} ${UNITS[measure]}`;
    }

    /**
     * `data-level` (`good`, `off` with `--k` 0–1, `none` without a reading, or `absent` for a measure the room hasn't),
     * which the CSS colours: grey or green, then yellow to red.
     * @param {HTMLElement | SVGElement} node
     * @param {number | null | 'absent'} score
     */
    function setLevel(node, score) {
      if (score == null || score === 'absent') {
        node.dataset.level = score === 'absent' ? 'absent' : 'none';
        node.style.removeProperty('--k');
        return;
      }
      node.dataset.level = score > 0 ? 'off' : 'good';
      if (score > 0) node.style.setProperty('--k', String(Math.round(score * 100) / 100));
      else node.style.removeProperty('--k');
    }

    function roomName(room) {
      return room.missing ? t('unavailable') : typed.name(room.key, room.name);
    }

    /**
     * A tap: the room's next reading in its large value, for READOUT_MS, starting from the one it shows; past the last
     * it's back to the usual one. Not on a missing room, one with a single reading, or while renaming.
     */
    function step(key) {
      if (typed.renaming) return;
      const room = rooms.find(r => r.key === key);
      if (!room) return;
      const read = readable(room);
      if (read.length < 2) return;
      const main = mainMeasure(room, ranges);
      const order = [...read.slice(read.indexOf(main)), ...read.slice(0, read.indexOf(main))];
      const from = pick && pick.key === key ? pick.measure : main;
      const next = order[(order.indexOf(from) + 1) % order.length];
      if (pickTimer) clearTimeout(pickTimer);
      pickTimer = null;
      pick = next === main ? null : { key, measure: next };
      if (pick) pickTimer = setTimeout(() => { pick = null; pickTimer = null; render(); }, READOUT_MS);
      render();
    }

    function cellFor(key) {
      let cell = cells.get(key);
      if (!cell) {
        const node = el('div', { class: 'rh-room', 'data-room': key, role: 'button', tabindex: '0' });
        const value = el('div', { class: 'rh-value' }, node);
        cell = {
          node,
          value,
          num: el('span', { class: 'rh-num' }, value),
          unit: el('span', { class: 'rh-unit' }, value),
          name: el('span', { class: 'rh-name', dir: 'auto' }, node),
          marks: el('div', { class: 'rh-marks', 'aria-hidden': 'true' }, node),
        };
        onTap(node, () => step(key));
        cells.set(key, cell);
      }
      return cell;
    }

    /** A mark per column (the measures any room has, so they line up): a bar, or the measure's icon. */
    function drawMarks(cell, room, columns) {
      const shape = columns.join();
      if (cell.marks.dataset.shape !== shape) {
        cell.marks.dataset.shape = shape;
        cell.marks.textContent = '';
        for (const m of columns) {
          const mark = el('span', { class: 'rh-mark', 'data-measure': m }, cell.marks);
          if (layout !== 'icons') continue;
          const svg = el('svg', { viewBox: '0 0 24 24' }, mark, SVG_NS);
          el('path', { d: ICONS[m] }, svg, SVG_NS);
        }
      }
      for (const mark of cell.marks.children) {
        const m = /** @type {HTMLElement} */ (mark).dataset.measure;
        const has = !room.missing && m in room.values;
        const s = has ? roomHealthScore(m, room.values[m], ranges) : null;
        setLevel(/** @type {HTMLElement} */ (mark), has ? (s ? s.score : null) : 'absent');
        mark.classList.toggle('picked', !!pick && pick.key === room.key && pick.measure === m);
      }
    }

    let lastHeight = 0;
    function reportHeight() {
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    function render() {
      rooms = roomHealthRooms(devices);
      if (pick && !rooms.some(r => r.key === pick.key && readable(r).includes(pick.measure))) pick = null;
      const columns = MEASURES.filter(m => rooms.some(r => !r.missing && m in r.values));
      grid.style.setProperty('--rh-n', String(columns.length));
      const keys = new Set(rooms.map(r => r.key));
      for (const [key, cell] of cells) {
        if (!keys.has(key)) { cell.node.remove(); cells.delete(key); }
      }
      let placed = null;
      for (const room of rooms) {
        const cell = cellFor(room.key);
        // Keeps the order, moving only what is out of place: a moved node loses the focus of a field in it.
        const want = placed ? placed.nextSibling : grid.firstChild;
        if (cell.node !== want) grid.insertBefore(cell.node, want);
        placed = cell.node;
        const missing = !!room.missing;
        const picked = !!pick && pick.key === room.key;
        cell.node.classList.toggle('missing', missing);
        cell.node.classList.toggle('picking', picked);
        cell.name.textContent = roomName(room);
        if (typed.renaming && !missing) {
          const field = typed.field(room.key, room.name);
          if (field.previousSibling !== cell.name) cell.name.after(field);
        }
        drawMarks(cell, room, columns);
        // The large value: a tapped reading, else the worst when one is off, else the temperature; `°`/`%` attached.
        const shown = picked ? pick.measure : mainMeasure(room, ranges);
        const v = shown ? room.values[shown] : null;
        const tight = shown === 'temperature' || shown === 'humidity';
        cell.num.textContent = shown ? formatNumber(shown, v) + (shown === 'temperature' ? '°' : shown === 'humidity' ? '%' : '') : '–';
        cell.unit.textContent = shown && !tight ? UNITS[shown] : '';
        cell.unit.style.display = cell.unit.textContent ? '' : 'none';
        // Its width in ems (digits and signs about 0.58, separators 0.27) and the unit's, so the CSS shrinks it to fit.
        const ems = [...cell.num.textContent].reduce((w, ch) => w + (/[.,\s]/.test(ch) ? 0.27 : 0.58), 0);
        cell.value.style.setProperty('--rh-em', ems.toFixed(2));
        if (cell.unit.textContent) cell.value.style.setProperty('--rh-unit-w', `calc(var(--rh-fs-small) * ${(cell.unit.textContent.length * 0.68).toFixed(2)} + 2px)`);
        else cell.value.style.removeProperty('--rh-unit-w');
        const score = shown ? roomHealthScore(shown, v, ranges) : null;
        setLevel(cell.value, score ? score.score : null);
        // For screen readers: the worst problem's word, `Good` or `No readings`, then the readings.
        const worst = missing ? null : worstOf(room, ranges);
        // The room's worst in three steps, which Vivid fills the cell with; a fine room only when it's green.
        const tone = !worst ? null : worst.score > 0 ? (worst.score < 1 / 3 ? 'yellow' : worst.score < 2 / 3 ? 'orange' : 'red') : opts.greenWhenFine === true ? 'green' : null;
        if (tone) cell.node.dataset.tone = tone;
        else delete cell.node.dataset.tone;
        const state = !worst ? t('noReadings') : worst.score > 0 ? t(PROBLEMS[worst.measure][worst.side]) : t('good');
        const values = readable(room).map(m => formatValue(m, room.values[m]));
        cell.node.setAttribute('aria-label', missing ? t('unavailable') : [`${roomName(room)}: ${state}`, ...values].join(', '));
      }
      tileEl.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);
      reportHeight();
    }

    // The width changes the number of rooms per row, so the height.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => reportHeight()).observe(grid);

    return { setState, setNames: typed.set, pushChange, setMessage, render, t, open: (key) => step(key) };
  }

  window.createRoomHealthWidget = createRoomHealthWidget;
  window.roomHealthRange = roomHealthRange;
  window.roomHealthScore = roomHealthScore;
  window.roomHealthRooms = roomHealthRooms;
})();
