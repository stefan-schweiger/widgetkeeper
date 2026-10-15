/*
 * Light Controls: compact light tiles, two per row (no brightness text: the bar shows it, and the space
 * goes to the colour chip's tap area). A tap on the tile turns the light on or off; the bar at the bottom
 * sets the brightness (0 = off); lights without brightness (plugs, switches) have no bar. The chip opens a panel of colour and white swatches over the tile's row
 * (with `palette: moods`, the room's Homey Moods in place of the colours): taps only, as Homey's Android app takes
 * any drag. Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const OPTIMISTIC_MS = 10e3; // how long a changed tile shows its new value while waiting for the device
  const PANEL_MS = 8e3; // the swatch panel closes after this long without a touch
  const TAP_SLOP = 10; // px a finger may move and still count as a tap

  const DEFAULT_STRINGS = {
    selectDevices: 'Select lights in the widget settings.',
    error: 'Could not load the lights.',
    failed: 'Could not change __name__.',
    unavailable: 'Unavailable',
    temperature: 'Colour temperature',
    color: 'Colour',
    close: 'Close',
    noKey: 'To start Moods, add an API key in the app settings.',
    keyScope: 'The API key may not start Moods.',
    keyInvalid: 'The API key was not accepted.',
    moodFailed: 'Could not start __name__.',
    moods: 'Moods',
  };
  /** Why the app couldn't start a Mood (`{ok: false, reason}`): no usable personal API key. */
  const KEY_PROBLEMS = ['noKey', 'keyScope', 'keyInvalid'];

  const svg = (viewBox, body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="#000" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  // A thermometer with a sun ray, for the temperature chip.
  const TEMP_GLYPH = svg('6.3 1.3 11.4 21.4', '<path d="M10 14.5V4a2 2 0 0 1 4 0v10.5a4 4 0 1 1-4 0z"/><circle cx="12" cy="17.5" r="1.6" fill="#000"/><path d="M12 9.5v6"/>');
  // A half-filled circle, for the chip of a light with colour: a ring with its right half filled.
  const HUE_GLYPH = svg('2 2 20 20', '<circle cx="12" cy="12" r="9" stroke-width="1.6"/><path fill="#000" stroke="none" d="M12 3a9 9 0 0 1 0 18z"/>');
  const CLOSE_GLYPH =svg('5 5 14 14', '<path d="M6 6l12 12M18 6L6 18"/>');
  // A full circle, for the chip of a tile whose lights shine in several colours: filled with a pie of them.
  const PIE_GLYPH = svg('2 2 20 20', '<circle cx="12" cy="12" r="9" fill="#000" stroke="none"/>');
  /** At most this many colours on a tile whose lights shine in several. */
  const MAX_COLORS = 4;

  /**
   * The swatch palettes (the `palette` setting): 7 colours for the first row (hue in degrees, saturation 0–1)
   * and 5 whites for the second (colour temperature, 0 = cool), each row in the order shown. `moods` has no entry:
   * it puts the room's Moods in the first row, and a room without Moods gets the default colours.
   */
  const PALETTES = {
    // Bright colours around the wheel, and whites from cool to warm.
    default: {
      colors: [[0, 1], [30, 1], [55, 1], [120, 1], [220, 1], [275, 1], [320, 1]],
      whites: [0, 0.25, 0.5, 0.75, 1],
    },
    // Warm: from red through orange and amber, on to warm and then cool white.
    warm: {
      colors: [[0, 1], [10, 1], [20, 1], [28, 0.95], [35, 0.85], [40, 0.7], [44, 0.5]],
      whites: [1, 0.75, 0.5, 0.25, 0],
    },
    // Dusk: the sky after sunset, indigo through violet and rose to coral and amber, with warm whites.
    dusk: {
      colors: [[240, 0.8], [262, 0.75], [285, 0.65], [320, 0.6], [345, 0.65], [12, 0.75], [30, 0.85]],
      whites: [1, 0.85, 0.7, 0.55, 0.4],
    },
  };

  /** The colour of a temperature (0 = cool, 1 = warm), as on Homey's own light card. */
  function temperatureColor(k) {
    const cool = [214, 232, 255];
    const warm = [255, 176, 84];
    const mix = cool.map((c, i) => Math.round(c + (warm[i] - c) * Math.min(1, Math.max(0, k))));
    return `rgb(${mix.join(' ')})`;
  }

  /** A colour light's hue and saturation (0–1); lighter as the saturation drops, so 0 is white. */
  function hueColor(hue, sat) {
    return `hsl(${Math.round(hue * 360)} ${Math.round(sat * 100)}% ${Math.round(62 + (1 - sat) * 38)}%)`;
  }

  /** The colour a light shines in: its hue in colour mode, else its temperature (or a warm white). */
  function lightColor(caps) {
    const v = id => (caps[id] ? caps[id].value : null);
    const hue = v('light_hue');
    const colourMode = v('light_mode') === 'color' || (!caps.light_mode && !caps.light_temperature);
    if (colourMode && typeof hue === 'number') {
      const sat = typeof v('light_saturation') === 'number' ? v('light_saturation') : 1;
      return hueColor(hue, sat);
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
   *   onSet?: (deviceId: string, change: {dim?: number, onoff?: boolean, temperature?: number,
   *     hue?: number, saturation?: number}) => Promise<any>,
   *   onMood?: (moodId: string) => Promise<any>,
   *   onHeight?: (h: number) => void, groupByZone?: boolean, palette?: string, barMin?: string }} opts
   */
  function createLightsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`lights.${key}`, tokens) : null;
      if (s && s !== `lights.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    let devices = []; // [{ id, name, icon, zone, caps } | { id, missing }]
    /**
     * The tiles: one per light, or with `groupByZone` one per room that has two or more of the lights,
     * placed where its first light is. `id` is the light's id or `zone:<zoneId>`.
     * @type {({id: string, name: string, icon: string | null, members: any[]} | {id: string, missing: true})[]}
     */
    let items = [];
    const optimistic = new Map(); // `${deviceId}:${capabilityId}` → { value, until }
    const drags = new Map(); // tile id → fraction, while a finger or the mouse is on the bar
    let messageText = null;
    let messageTimer = null;

    root.classList.add('lc');
    const grid = el('div', { class: 'lc-grid' }, root);
    // The swatch panel, over the row of the tile it's open for. In the grid (absolutely positioned) so it
    // can cover the row; the tiles are kept before it.
    const panel = el('div', { class: 'lc-panel' }, grid);
    panel.style.display = 'none';
    let panelFor = null; // the tile id the panel is open for
    let panelKey = ''; // which swatches it holds, so it's only rebuilt when that changes
    const palette = PALETTES[opts.palette] || PALETTES.default;
    /** `palette: moods`: the room's Moods (`setMoods()`) in place of the colours. */
    const useMoods = opts.palette === 'moods';
    /** @type {{id: string, name: string, zone: string, colors: ({hue: number, saturation: number} | {temperature: number})[]}[]} */
    let moods = [];
    /** The bar's lowest value: 0 turns the light off (the default); `barMin: '1'` stops at 1 %, so it stays on. */
    const barFloor = opts.barMin === '1' ? 0.01 : 0;
    const level = x => Math.max(barFloor, snap(x));
    let panelTimer = null;
    /** @type {{node: HTMLElement, swatch: {hue?: number, sat?: number, k?: number}}[]} */
    let swatches = [];
    /** The panel's Moods (`palette: moods`), while it shows a room's. */
    let moodRow = null;
    for (const type of ['touchstart', 'pointerdown']) panel.addEventListener(type, () => armPanel(), { passive: true });
    const messageEl = el('div', { class: 'lc-message', dir: 'auto' }, root);
    let lastTouchTap = 0;
    /** @type {Map<string, {tile: HTMLElement, icon: HTMLElement, chip: HTMLButtonElement, chipGlyph: HTMLElement,
     *   name: HTMLElement, bar: HTMLElement, fill: HTMLElement, knob: HTMLElement}>} */
    const tiles = new Map();
    /** Each light's last brightness above 0, which the app restores on a light without `onoff`. */
    const lastDim = new Map();

    function noteDim(id, value) {
      if (typeof value === 'number' && value > 0) lastDim.set(id, value);
    }

    function setState(list) {
      devices = Array.isArray(list) ? list : [];
      messageText = null;
      for (const d of devices) if (d.caps && d.caps.dim) noteDim(d.id, d.caps.dim.value);
      render();
    }

    /** The Moods of the lights' rooms (`palette: moods`). */
    function setMoods(list) {
      moods = Array.isArray(list) ? list : [];
      render();
    }

    /** A light and, for a Homey group device, the lights in it (`groupLights`). */
    const withGroup = d => [d, ...(Array.isArray(d.groupLights) ? d.groupLights : [])];

    function pushChange({ deviceId, capabilityId, value }) {
      // The device itself, or a light in a group device (both, when it's picked too).
      let hit = false;
      for (const d of devices) {
        for (const x of 'missing' in d ? [] : withGroup(d)) {
          if (x.id !== deviceId || !x.caps || !x.caps[capabilityId]) continue;
          x.caps[capabilityId].value = value;
          hit = true;
        }
      }
      if (!hit) return;
      if (capabilityId === 'dim') noteDim(deviceId, value);
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

    /** Shows `values` while the device confirms them; a group device's lights take them on too. */
    function hope(d, values) {
      const until = Date.now() + OPTIMISTIC_MS;
      for (const x of withGroup(d)) {
        for (const [id, value] of Object.entries(values)) {
          if (x.caps[id]) optimistic.set(`${x.id}:${id}`, { value, until });
        }
      }
      setTimeout(render, OPTIMISTIC_MS + 50);
    }

    /** Whether the light is on: `onoff`, or a brightness above 0 without it. */
    function isOn(d) {
      const dim = shown(d, 'dim');
      if (d.caps.onoff) return shown(d, 'onoff') === true;
      return typeof dim === 'number' && dim > 0;
    }

    /** The brightness (0–1): a light without `dim` (a plug or a switch) is full while on. */
    function brightness(d) {
      if (!d.caps.dim) return isOn(d) ? 1 : 0;
      const dim = shown(d, 'dim');
      return isOn(d) && typeof dim === 'number' ? dim : 0;
    }

    /** Sends one light's change; a failure shakes its tile (`item`) and shows a message. */
    async function send(item, d, change) {
      if (!opts.onSet) return;
      try {
        await opts.onSet(d.id, change);
      } catch (err) {
        console.error(err);
        for (const id of ['onoff', 'dim', 'light_temperature', 'light_mode', 'light_hue', 'light_saturation']) optimistic.delete(`${d.id}:${id}`);
        const tile = tiles.get(item.id);
        if (tile) {
          tile.tile.classList.remove('shake');
          void tile.tile.offsetWidth; // restart the animation
          tile.tile.classList.add('shake');
        }
        setMessage(t('failed', { name: d.name }), true);
      }
    }

    /** The tile with this id, if it shows lights. */
    function itemOf(id) {
      const item = items.find(x => x.id === id);
      return item && 'members' in item ? item : null;
    }

    /** A tile is on while any of its lights is. */
    const itemOn = item => item.members.some(isOn);
    /** A tile's brightness: its light's, or the average of a room's lights that are on. */
    function itemBrightness(item) {
      const on = item.members.filter(isOn);
      return on.length ? on.reduce((sum, d) => sum + brightness(d), 0) / on.length : 0;
    }
    /** The light a tile's colour comes from: the first one that is on, else the first. */
    const lead = item => item.members.find(isOn) || item.members[0];

    /** The colour a light shines in, from its shown (optimistic) values. */
    const colorOf = d => lightColor(Object.fromEntries(Object.keys(d.caps).map(k => [k, { value: shown(d, k) }])));
    /**
     * The colours a tile's lit lights shine in, without repeats (at most MAX_COLORS): a Homey group device counts
     * its lit lights (its own colour is only the last one set on the group; a Mood may have given them several),
     * any other light itself while it's on. Empty while nothing is on.
     */
    function colorsOf(item) {
      const out = [];
      for (const d of item.members) {
        const group = Array.isArray(d.groupLights) ? d.groupLights.filter(isOn) : [];
        for (const x of group.length ? group : isOn(d) ? [d] : []) {
          const c = colorOf(x);
          if (!out.includes(c)) out.push(c);
        }
      }
      return out.slice(0, MAX_COLORS);
    }

    /** A tap on a tile: turns all its lights off when any is on, else all on. */
    function toggle(id) {
      const item = itemOf(id);
      if (!item) return;
      const on = !itemOn(item);
      for (const d of item.members) {
        if (d.caps.onoff) hope(d, { onoff: on });
        else hope(d, { dim: on ? (shown(d, 'dim') || lastDim.get(d.id) || 1) : 0 });
      }
      render();
      for (const d of item.members) send(item, d, { onoff: on });
    }

    /** The bar was let go at `x` (0–1): the brightness of every light on the tile. */
    function commit(id, x) {
      const item = itemOf(id);
      if (!item) return;
      const value = level(x);
      for (const d of item.members) {
        if (value === 0) hope(d, d.caps.onoff ? { onoff: false } : { dim: 0 });
        else hope(d, { dim: value, onoff: true });
      }
      render();
      for (const d of item.members) send(item, d, { dim: value });
    }

    const settable = (d, id) => !!d.caps[id] && d.caps[id].setable !== false;
    const hasColor = item => item.members.some(d => settable(d, 'light_hue'));
    const hasTemp = item => item.members.some(d => settable(d, 'light_temperature'));
    /** The room a tile is in: a grouped room's, or its light's. */
    const zoneOf = item => (item.id.startsWith('zone:') ? item.id.slice(5) : (item.members[0].zone ? item.members[0].zone.id : null));
    /** The Moods of a tile's room, with `palette: moods`. */
    function roomMoods(item) {
      const zone = useMoods ? zoneOf(item) : null;
      return zone ? moods.filter(m => m.zone === zone) : [];
    }
    /** Whether a tile has the chip: colour, colour temperature or its room's Moods. */
    const hasChip = item => hasColor(item) || hasTemp(item) || roomMoods(item).length > 0;

    /**
     * A swatch was tapped: sets the colour (or white) of each light on the tile that can show it, and
     * closes the panel. In a room, a white also goes to colour lights without colour temperature, as
     * saturation 0.
     */
    function pick(id, swatch) {
      const item = itemOf(id);
      closePanel();
      if (!item) return;
      const changes = [];
      for (const d of item.members) {
        if (swatch.k != null && settable(d, 'light_temperature')) {
          hope(d, { light_temperature: swatch.k, light_mode: 'temperature', onoff: true });
          changes.push([d, { temperature: swatch.k }]);
        } else if (settable(d, 'light_hue') && (swatch.k == null || item.members.length > 1)) {
          const hue = swatch.k != null ? 0 : swatch.hue / 360;
          const saturation = swatch.k != null ? 0 : swatch.sat;
          hope(d, { light_hue: hue, light_saturation: saturation, light_mode: 'color', onoff: true });
          changes.push([d, { hue, saturation }]);
        }
      }
      render();
      for (const [d, change] of changes) send(item, d, change);
    }

    /** A Mood was tapped: Homey starts it (through the API key), and the lights report their new state. */
    async function startMood(id, mood) {
      closePanel();
      if (!opts.onMood) return;
      try {
        await opts.onMood(mood.id);
      } catch (err) {
        console.error(err);
        const tile = tiles.get(id);
        if (tile) {
          tile.tile.classList.remove('shake');
          void tile.tile.offsetWidth; // restart the animation
          tile.tile.classList.add('shake');
        }
        const reason = err && err.reason;
        setMessage(KEY_PROBLEMS.includes(reason) ? t(reason) : t('moodFailed', { name: mood.name }), true);
      }
    }

    /** A Mood's colours as the pill's dot: one colour, or a gradient through them (none without colours). */
    function moodDot(colors) {
      const list = (colors || []).map(c => ('temperature' in c ? temperatureColor(c.temperature) : hueColor(c.hue, c.saturation)));
      if (!list.length) return null;
      return list.length === 1 ? list[0] : `linear-gradient(135deg, ${list.join(', ')})`;
    }

    function armPanel() {
      clearTimeout(panelTimer);
      panelTimer = setTimeout(closePanel, PANEL_MS);
    }

    function closePanel() {
      clearTimeout(panelTimer);
      panelTimer = null;
      if (panelFor == null) return;
      panelFor = null;
      render();
    }

    function togglePanel(id) {
      if (panelFor === id) { closePanel(); return; }
      panelFor = id;
      armPanel();
      render();
    }

    /**
     * Fills the panel for `d` from the palette: the colours (with colour) in the first row, then the whites
     * (the temperatures, or a plain white without them), and the close button in the last column. With
     * `palette: moods`, a room with Moods gets only them (no colours or whites), as pills in two rows beside the
     * close button that scroll sideways when they don't fit (one row while they fit in one).
     */
    function buildPanel(d) {
      const color = hasColor(d);
      const temp = hasTemp(d);
      const room = roomMoods(d);
      const key = `${color}:${temp}:${JSON.stringify(room.map(m => [m.id, m.name, m.colors]))}`;
      if (key === panelKey) return;
      panelKey = key;
      panel.textContent = '';
      swatches = [];
      moodRow = null;
      panel.classList.toggle('moods', room.length > 0);
      if (room.length) {
        const row = el('div', { class: 'lc-moods' }, panel);
        moodRow = row;
        for (const mood of room) {
          const node = el('button', { type: 'button', class: 'lc-mood' }, row);
          const dot = moodDot(mood.colors);
          if (dot) el('span', { class: 'lc-mood-dot' }, node).style.setProperty('--lc-swatch', dot);
          el('span', { class: 'lc-mood-name', dir: 'auto', text: mood.name }, node);
          onTap(node, () => { if (panelFor != null) startMood(panelFor, mood); });
        }
      }
      /** @type {{hue?: number, sat?: number, k?: number}[]} */
      const list = room.length ? [] : [
        ...(color ? palette.colors.map(([hue, sat]) => ({ hue, sat })) : []),
        ...(temp ? palette.whites.map(k => ({ k })) : color ? [{ hue: 0, sat: 0 }] : []),
      ];
      for (const swatch of list) {
        const node = el('button', { type: 'button', class: 'lc-swatch' }, panel);
        node.style.setProperty('--lc-swatch', swatch.k != null ? temperatureColor(swatch.k) : hueColor(swatch.hue / 360, swatch.sat));
        onTap(node, () => { if (panelFor != null) pick(panelFor, swatch); });
        swatches.push({ node, swatch });
      }
      const close = el('button', { type: 'button', class: 'lc-close', 'aria-label': t('close') }, panel);
      el('span', { class: 'lc-close-glyph' }, close).style.setProperty('--lc-mask', `url("${CLOSE_GLYPH}")`);
      onTap(close, closePanel);
    }

    /** Whether a swatch is the current colour or white of the tile's lead light. */
    function isCurrent(item, swatch) {
      const d = lead(item);
      const v = id => shown(d, id);
      const colourMode = v('light_mode') === 'color' || (!d.caps.light_mode && !d.caps.light_temperature);
      if (swatch.k != null) {
        const k = v('light_temperature');
        return !colourMode && typeof k === 'number' && Math.abs(k - swatch.k) < 0.05;
      }
      const hue = v('light_hue');
      if (!colourMode || typeof hue !== 'number') return false;
      const sat = typeof v('light_saturation') === 'number' ? v('light_saturation') : 1;
      if (Math.abs(sat - swatch.sat) >= 0.03) return false;
      if (swatch.sat === 0) return true;
      const dh = Math.abs(hue - swatch.hue / 360);
      return Math.min(dh, 1 - dh) < 0.03;
    }

    /** Places the panel over the row of its tile, or hides it. */
    function renderPanel() {
      const d = panelFor != null ? itemOf(panelFor) : null;
      const tile = d ? tiles.get(d.id) : null;
      if (!d || !tile || !hasChip(d)) {
        if (panelFor != null) { panelFor = null; clearTimeout(panelTimer); }
        panel.style.display = 'none';
        return;
      }
      buildPanel(d);
      for (const s of swatches) s.node.classList.toggle('current', isCurrent(d, s.swatch));
      panel.style.display = '';
      panel.style.top = `${tile.tile.offsetTop}px`;
      panel.style.height = `${tile.tile.offsetHeight}px`;
      // The Moods take one row while they fit in it, else two.
      if (moodRow) {
        moodRow.classList.add('one-row');
        if (moodRow.scrollWidth > moodRow.clientWidth + 1) moodRow.classList.remove('one-row');
      }
    }

    /**
     * Taps on the tile body: a touch that ends within TAP_SLOP, or a click. Drags scroll the dashboard.
     * `stop` keeps a control's taps (and keys) from also reaching the tile around it.
     */
    function onTap(node, fn, { stop = false } = {}) {
      let start = null;
      const unpress = () => { start = null; node.classList.remove('pressing'); };
      node.addEventListener('touchstart', (e) => {
        if (stop) e.stopPropagation();
        const p = e.changedTouches[0];
        start = { x: p.clientX, y: p.clientY };
        node.classList.add('pressing');
      }, { passive: true });
      node.addEventListener('touchmove', (e) => {
        const p = e.changedTouches[0];
        if (start && Math.hypot(p.clientX - start.x, p.clientY - start.y) > TAP_SLOP) unpress();
      }, { passive: true });
      node.addEventListener('touchend', (e) => {
        const isTap = !!start;
        unpress();
        // Every touch: one that moved past TAP_SLOP can still get the browser's click.
        lastTouchTap = Date.now();
        if (!isTap) return;
        e.preventDefault(); // no click after it
        if (stop) e.stopPropagation();
        fn();
      });
      node.addEventListener('touchcancel', unpress);
      node.addEventListener('click', (e) => {
        if (stop) e.stopPropagation();
        if (Date.now() - lastTouchTap < 800) return;
        fn();
      });
      node.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (stop) e.stopPropagation();
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
      bar.addEventListener('click', e => e.stopPropagation()); // not a tap on the tile
    }

    function tileFor(id) {
      let tile = tiles.get(id);
      if (!tile) {
        const node = el('div', { class: 'lc-tile', 'data-device': id, role: 'group', tabindex: '0' });
        const top = el('div', { class: 'lc-top' }, node);
        const icon = el('span', { class: 'lc-icon' }, top);
        const chip = el('button', { type: 'button', class: 'lc-chip' }, top);
        const chipGlyph = el('span', { class: 'lc-chip-glyph' }, chip);
        const name = el('span', { class: 'lc-name', dir: 'auto' }, node);
        const bar = el('div', { class: 'lc-bar', role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '100' }, node);
        const track = el('div', { class: 'lc-track' }, bar);
        const fill = el('div', { class: 'lc-fill' }, track);
        const knob = el('div', { class: 'lc-knob' }, bar);
        tile = { tile: node, icon, chip, chipGlyph, name, bar, fill, knob };
        onTap(node, () => toggle(id));
        // The chip is inside the tile: its own taps (and keys) must not toggle the light.
        onTap(chip, () => togglePanel(id), { stop: true });
        wireBar(id, bar);
        tiles.set(id, tile);
      }
      return tile;
    }

    /**
     * The gradients of a tile whose lights shine in several colours: the tint (diagonal, mixed into the tile as
     * one colour is), the bar's fill (left to right, mixed as the fill is) and the chip's pie. Null clears them.
     */
    function setBlend(node, colors) {
      const props = colors ? {
        '--lc-tint-bg': `linear-gradient(135deg, ${colors.map(c => `color-mix(in srgb, ${c} var(--lc-tint), var(--lc-tile))`).join(', ')})`,
        '--lc-fill-bg': `linear-gradient(to right, ${colors.map(c => `color-mix(in srgb, ${c} var(--lc-fill-share), var(--lc-fill-with))`).join(', ')})`,
        '--lc-pie': `conic-gradient(${colors.map((c, i) => `color-mix(in srgb, ${c} var(--lc-fill-share), var(--lc-fill-with)) ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`,
      } : { '--lc-tint-bg': '', '--lc-fill-bg': '', '--lc-pie': '' };
      for (const [k, v] of Object.entries(props)) {
        if (node.style.getPropertyValue(k) === v) continue;
        if (v) node.style.setProperty(k, v);
        else node.style.removeProperty(k);
      }
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--lc-mask') !== v) node.style.setProperty('--lc-mask', v);
    }

    /** The tiles for the lights, grouped by room with `groupByZone`. */
    function buildItems() {
      const usable = d => !('missing' in d) && d.caps && (d.caps.dim || d.caps.onoff);
      const rooms = new Map(); // zone id → its usable lights
      if (opts.groupByZone) {
        for (const d of devices) {
          if (!usable(d) || !d.zone) continue;
          if (!rooms.has(d.zone.id)) rooms.set(d.zone.id, []);
          rooms.get(d.zone.id).push(d);
        }
      }
      const out = [];
      const placed = new Set();
      for (const d of devices) {
        if (!usable(d)) { out.push({ id: d.id, missing: true }); continue; }
        const room = d.zone ? rooms.get(d.zone.id) : null;
        if (room && room.length > 1) {
          if (placed.has(d.zone.id)) continue;
          placed.add(d.zone.id);
          out.push({ id: `zone:${d.zone.id}`, name: d.zone.name, icon: room[0].icon, members: room });
        } else {
          out.push({ id: d.id, name: d.name, icon: d.icon, members: [d] });
        }
      }
      return out;
    }

    let lastHeight = 0;
    function render() {
      items = buildItems();
      const ids = new Set(items.map(d => d.id));
      for (const [id, tile] of tiles) {
        if (!ids.has(id)) { tile.tile.remove(); tiles.delete(id); }
      }
      let prev = null;
      for (const d of items) {
        const tile = tileFor(d.id);
        // Keeps the settings' order. Only moves a tile that is out of place: moving it would drop
        // the bar's pointer capture during a drag.
        const want = prev ? prev.nextSibling : grid.firstChild;
        if (tile.tile !== want) grid.insertBefore(tile.tile, want);
        prev = tile.tile;
        if (!('members' in d)) {
          tile.tile.classList.add('missing');
          tile.name.textContent = t('unavailable');
          setMask(tile.icon, null);
          tile.icon.classList.add('fallback');
          tile.chip.style.display = 'none';
          tile.tile.classList.remove('on');
          tile.tile.style.removeProperty('--lc-light');
          tile.tile.style.setProperty('--lc-x', '0');
          continue;
        }
        tile.tile.classList.remove('missing');
        tile.name.textContent = d.name;
        // A group, not a button: it holds the chip and the slider, which have their own roles.
        tile.tile.setAttribute('aria-label', d.name);
        tile.bar.setAttribute('aria-label', d.name);
        setMask(tile.icon, d.icon);
        tile.icon.classList.toggle('fallback', !d.icon);
        const color = hasColor(d);
        const colors = colorsOf(d);
        // Several colours: the tile's tint, the bar and the chip blend them (the first stays --lc-light).
        const multi = colors.length > 1;
        const on = itemOn(d);
        const drag = drags.get(d.id);
        const x = drag != null ? level(drag) : itemBrightness(d);

        const temp = hasTemp(d);
        // A light with only its room's Moods gets the colour chip's glyph.
        const hueChip = color || !temp;
        tile.chip.style.display = hasChip(d) ? '' : 'none';
        tile.chip.setAttribute('aria-label', t(color ? 'color' : temp ? 'temperature' : 'moods'));
        tile.chip.classList.toggle('active', panelFor === d.id);
        tile.chipGlyph.classList.toggle('hue', hueChip || multi);
        setMask(tile.chipGlyph, multi ? PIE_GLYPH : hueChip ? HUE_GLYPH : TEMP_GLYPH);
        tile.tile.classList.toggle('on', on || (drag != null && x > 0));
        tile.tile.classList.toggle('no-dim', !d.members.some(m => m.caps.dim)); // on/off only: no bar
        tile.tile.style.setProperty('--lc-light', colors[0] || colorOf(lead(d)));
        tile.tile.classList.toggle('multi', multi);
        setBlend(tile.tile, multi ? colors : null);
        tile.tile.style.setProperty('--lc-x', String(x));
        tile.bar.setAttribute('aria-valuenow', String(Math.round(x * 100)));
      }
      renderPanel();
      grid.style.display = devices.length ? '' : 'none';
      messageEl.textContent = messageText || '';
      messageEl.style.display = messageText ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && devices.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, setMoods, pushChange, setMessage, render, t };
  }

  window.createLightsWidget = createLightsWidget;
})();
