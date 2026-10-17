/*
 * Room Health: the indoor climate per room. The picked sensors are grouped by their Homey zone, and each room is a ring
 * of one arc per measure it has (temperature, humidity, CO₂, radon, PM2.5, PM10, VOC), each green inside its comfortable
 * range and yellow to red further out. The centre shows the worst value (else the temperature), the name and a state
 * word under it; one line under the rings names the worst problem in the house and what to do. A tap on a ring shows its
 * readings there for a few seconds.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, tileNames } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const DEFAULT_STRINGS = {
    selectDevices: 'Select sensors in the widget settings.',
    error: 'Could not load the sensors.',
    unavailable: 'Unavailable',
    renameFailed: 'Could not save the name.',
    good: 'Good',
    noReadings: 'No readings',
    allGood: 'All rooms are comfortable.',
    hint: '__room__: __problem__, __value__. __action__',
    cold: 'Cold',
    warm: 'Warm',
    dry: 'Dry',
    humid: 'Humid',
    stuffy: 'Stuffy',
    radon: 'Radon',
    particles: 'Particles',
    voc: 'VOCs',
    problemCold: 'cold',
    problemWarm: 'warm',
    problemDry: 'dry',
    problemHumid: 'humid',
    problemStuffy: 'stuffy',
    problemRadon: 'high radon',
    problemParticles: 'particles',
    problemVoc: 'VOCs',
    actionHeat: 'Turn up the heat.',
    actionCool: 'Cool it down.',
    actionHumidify: 'Humidify the air.',
    actionAirOut: 'Air it out.',
    actionVentilate: 'Ventilate more.',
    actionPurify: 'Run an air purifier.',
  };

  const TAP_SLOP = 10; // px a touch may move and still count as a tap
  const READOUT_MS = 6000; // how long a tapped ring's readings stay

  /** The measures, in the ring's order (clockwise from the top), the readout's, and the hint's for a tie. */
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
  /** The state word and the hint's problem and action, per measure and side. */
  const PROBLEMS = {
    temperature: { low: ['cold', 'problemCold', 'actionHeat'], high: ['warm', 'problemWarm', 'actionCool'] },
    humidity: { low: ['dry', 'problemDry', 'actionHumidify'], high: ['humid', 'problemHumid', 'actionAirOut'] },
    co2: { high: ['stuffy', 'problemStuffy', 'actionAirOut'] },
    radon: { high: ['radon', 'problemRadon', 'actionVentilate'] },
    pm25: { high: ['particles', 'problemParticles', 'actionPurify'] },
    pm10: { high: ['particles', 'problemParticles', 'actionPurify'] },
    voc: { high: ['voc', 'problemVoc', 'actionAirOut'] },
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

  /** The worst problem in the house, `{room, measure, score, side}`, or null when every room is fine. Ties go to the first room and measure. */
  function roomHealthWorst(rooms, ranges) {
    let worst = null;
    for (const room of rooms || []) {
      if (room.missing) continue;
      const w = worstOf(room, ranges);
      if (w && w.score > 0 && (!worst || w.score > worst.score)) worst = { room, ...w };
    }
    return worst;
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
  const RING = { stroke: 8.8, gap: 16 }; // in the ring's 100-unit viewBox (6 px of a 68 px ring); the gap between arcs in degrees

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, renameTiles?: boolean,
   *   onRename?: (key: string, name: string) => Promise<any>, onHeight?: (h: number) => void,
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
    let devices = []; // [{ id, name, zone, measures: {[measure]: {capabilityId, value}} } | { id, missing }]
    let rooms = [];
    let messageText = null;
    let messageTimer = null;
    let readoutKey = null; // the room whose readings the hint line shows
    let readoutTimer = null;

    root.classList.add('rh');
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
    const hintEl = el('div', { class: 'rh-hint' }, tileEl);
    const hintDot = el('span', { class: 'rh-hint-dot' }, hintEl);
    const hintText = el('span', { class: 'rh-hint-text', dir: 'auto' }, hintEl);
    const messageEl = el('div', { class: 'rh-message', dir: 'auto' }, root);
    /** @type {Map<string, {node: HTMLElement, svg: SVGSVGElement, value: HTMLElement, unit: HTMLElement, name: HTMLElement, state: HTMLElement}>} */
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

    /** A message under the rings. Persistent messages also clear the rings. */
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
     * `data-level` (`good`, `off` with `--k` 0–1, or `none` without a reading), which the CSS colours: green, then yellow to red.
     * @param {HTMLElement | SVGElement} node
     * @param {number | null} score
     */
    function setLevel(node, score) {
      if (score == null) { node.dataset.level = 'none'; node.style.removeProperty('--k'); return; }
      node.dataset.level = score > 0 ? 'off' : 'good';
      if (score > 0) node.style.setProperty('--k', String(Math.round(score * 100) / 100));
      else node.style.removeProperty('--k');
    }

    function roomName(room) {
      return room.missing ? t('unavailable') : typed.name(room.key, room.name);
    }

    function toggleReadout(key) {
      if (typed.renaming) return;
      const room = rooms.find(r => r.key === key);
      if (!room || room.missing) return;
      if (readoutTimer) clearTimeout(readoutTimer);
      readoutTimer = null;
      readoutKey = readoutKey === key ? null : key;
      if (readoutKey) readoutTimer = setTimeout(() => { readoutKey = null; readoutTimer = null; render(); }, READOUT_MS);
      render();
    }

    function cellFor(key) {
      let cell = cells.get(key);
      if (!cell) {
        const node = el('div', { class: 'rh-room', 'data-room': key, role: 'button', tabindex: '0' });
        const ring = el('div', { class: 'rh-ring' }, node);
        const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
        svg.setAttribute('viewBox', '0 0 100 100');
        svg.setAttribute('aria-hidden', 'true');
        ring.appendChild(svg);
        const center = el('div', { class: 'rh-center' }, ring);
        cell = {
          node,
          svg,
          value: el('span', { class: 'rh-value' }, center),
          unit: el('span', { class: 'rh-unit' }, center),
          name: el('span', { class: 'rh-name', dir: 'auto' }, node),
          state: el('span', { class: 'rh-state', dir: 'auto' }, node),
        };
        onTap(node, () => toggleReadout(key));
        cells.set(key, cell);
      }
      return cell;
    }

    /** One arc per measure the room has (a full ring for one, a dashed one for a missing sensor), each in its own colour. */
    function drawRing(cell, room) {
      const ms = room.missing ? [] : MEASURES.filter(m => m in room.values);
      const shape = room.missing ? 'missing' : ms.join();
      const r = 50 - RING.stroke / 2;
      if (cell.svg.dataset.shape !== shape) {
        cell.svg.dataset.shape = shape;
        cell.svg.textContent = '';
        const arcs = room.missing ? [null] : ms.length ? ms : [null];
        const n = arcs.length;
        const gap = n > 1 ? RING.gap : 0;
        arcs.forEach((m, i) => {
          const c = document.createElementNS(SVG_NS, 'circle');
          c.setAttribute('cx', '50');
          c.setAttribute('cy', '50');
          c.setAttribute('r', String(r));
          c.setAttribute('class', 'rh-arc');
          c.setAttribute('stroke-width', String(room.missing ? RING.stroke / 3 : RING.stroke));
          if (m) c.dataset.measure = m;
          if (n > 1) {
            const len = 360 / n - gap;
            c.setAttribute('pathLength', '360');
            c.setAttribute('stroke-dasharray', `${len} ${360 - len}`);
            c.setAttribute('stroke-dashoffset', String(-(i * 360 / n + gap / 2)));
            c.setAttribute('transform', 'rotate(-90 50 50)');
          }
          cell.svg.appendChild(c);
        });
      }
      for (const c of cell.svg.querySelectorAll('circle')) {
        const m = c.dataset.measure;
        const s = m ? roomHealthScore(m, room.values[m], ranges) : null;
        setLevel(c, s ? s.score : null);
      }
    }

    /** The template's text with its tokens as nodes (so the room can be bold and the problem coloured, in any language's order). */
    function fillTemplate(target, key, parts) {
      const marks = {};
      for (const k of Object.keys(parts)) marks[k] = `\u0000${k}\u0000`;
      const text = t(key, marks);
      target.textContent = '';
      text.split('\u0000').forEach((piece, i) => {
        if (i % 2 === 0) { if (piece) target.appendChild(document.createTextNode(piece)); return; }
        const part = parts[piece];
        if (part) target.appendChild(part);
      });
    }

    function renderHint() {
      const room = readoutKey ? rooms.find(r => r.key === readoutKey && !r.missing) : null;
      if (readoutKey && !room) readoutKey = null;
      hintEl.classList.remove('good', 'readout', 'empty');
      if (room) {
        // The tapped room's readings: `Bedroom · 18.6°C · 51% · 1,400 ppm`.
        const w = worstOf(room, ranges);
        setLevel(hintDot, w ? w.score : null);
        hintEl.classList.add('readout');
        hintText.textContent = '';
        el('b', { dir: 'auto', text: roomName(room) }, hintText);
        const values = MEASURES.filter(m => m in room.values).map(m => formatValue(m, room.values[m]));
        if (values.length) hintText.appendChild(document.createTextNode(` · ${values.join(' · ')}`));
        return;
      }
      const worst = roomHealthWorst(rooms, ranges);
      if (worst) {
        const [, problem, action] = PROBLEMS[worst.measure][worst.side];
        setLevel(hintDot, worst.score);
        // The room, the problem and the value are each isolated (a dir attribute), so an English room name or a number
        // keeps its place in an Arabic sentence; the template's own text sets the line's direction.
        const word = el('span', { class: 'rh-problem', dir: 'auto', text: t(problem) });
        setLevel(word, worst.score);
        fillTemplate(hintText, 'hint', {
          room: el('b', { dir: 'auto', text: roomName(worst.room) }),
          problem: word,
          value: el('span', { dir: 'ltr', text: formatValue(worst.measure, worst.room.values[worst.measure]) }),
          action: document.createTextNode(t(action)),
        });
        return;
      }
      // Every room fine; nothing at all when no room has a reading yet (the line keeps its height).
      const anyReading = rooms.some(r => !r.missing && worstOf(r, ranges));
      setLevel(hintDot, anyReading ? 0 : null);
      hintEl.classList.add(anyReading ? 'good' : 'empty');
      hintText.textContent = anyReading ? t('allGood') : '';
    }

    let lastHeight = 0;
    function reportHeight() {
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    function render() {
      rooms = roomHealthRooms(devices);
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
        cell.node.classList.toggle('missing', missing);
        cell.node.classList.toggle('selected', room.key === readoutKey);
        cell.name.textContent = roomName(room);
        if (typed.renaming && !missing) {
          const field = typed.field(room.key, room.name);
          if (field.previousSibling !== cell.name) cell.name.after(field);
        }
        drawRing(cell, room);
        const worst = missing ? null : worstOf(room, ranges);
        // The centre: the worst value when one is off, else the temperature (or the first reading).
        const shown = worst && worst.score > 0 ? worst.measure
          : ['temperature', ...MEASURES].find(m => room.values && typeof room.values[m] === 'number') || null;
        const v = shown ? room.values[shown] : null;
        const tight = shown === 'temperature' || shown === 'humidity';
        cell.value.textContent = missing ? '' : shown ? formatNumber(shown, v) + (shown === 'temperature' ? '°' : shown === 'humidity' ? '%' : '') : '–';
        cell.unit.textContent = shown && !tight ? UNITS[shown] : '';
        cell.unit.style.display = cell.unit.textContent ? '' : 'none';
        // Under the name: the worst problem's word, `Good`, or `No readings`.
        let state = '';
        if (!missing) {
          if (!worst) state = t('noReadings');
          else if (worst.score > 0) state = t(PROBLEMS[worst.measure][worst.side][0]);
          else state = t('good');
        }
        cell.state.textContent = state;
        setLevel(cell.state, worst ? worst.score : null);
        cell.node.setAttribute('aria-label', missing ? t('unavailable') : `${roomName(room)}: ${state}`);
      }
      renderHint();
      tileEl.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);
      reportHeight();
    }

    // The width changes the number of rings per row, so the height.
    if (typeof ResizeObserver === 'function') new ResizeObserver(() => reportHeight()).observe(grid);

    return { setState, setNames: typed.set, pushChange, setMessage, render, t, open: (key) => toggleReadout(key) };
  }

  window.createRoomHealthWidget = createRoomHealthWidget;
  window.roomHealthRange = roomHealthRange;
  window.roomHealthScore = roomHealthScore;
  window.roomHealthRooms = roomHealthRooms;
})();
