/*
 * Lights by Room: the picked lights grouped by their Homey room, a card per room. A closed card shows the room's
 * icon, name and state, its switch and its bar (every light in it); a tap on the header opens it, showing the room's
 * Moods and a row per light: a tap on the row toggles the light, its slim bar dims it, and the chip opens Light
 * Controls' swatches under the row. Taps only for what Android must do, as Homey's Android app takes any drag.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, applyColors, KEY_PROBLEMS, onTap: kitOnTap, touchGuard, messageLine } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  const { glyphs, PALETTES, temperatureColor, hueColor, lightColor, moodDot } = window.WidgetkeeperKit.lights;
  'use strict';

  const OPTIMISTIC_MS = 10e3; // how long a changed light shows its new value while waiting for the device
  const PANEL_MS = 8e3; // the swatch panel closes after this long without a touch
  /** At most this many colours in a room's tint (or a group's chip). */
  const MAX_COLORS = 4;
  /** The room of lights without a known room, and of missing ones. */
  const OTHER = 'other';

  const DEFAULT_STRINGS = {
    selectDevices: 'Select lights in the widget settings.',
    error: 'Could not load the lights.',
    failed: 'Could not change __name__.',
    unavailable: 'Unavailable',
    other: 'Other',
    on: 'On',
    off: 'Off',
    allOn: 'All on',
    someOn: '__on__ of __all__ on',
    level: '__state__ · __percent__%',
    temperature: 'Colour temperature',
    color: 'Colour',
    close: 'Close',
    noKey: 'To start Moods, add an API key in the app settings.',
    keyScope: 'The API key may not start Moods: it needs Set Moods.',
    keyInvalid: 'The API key was not accepted.',
    moodFailed: 'Could not start __name__.',
    moods: 'Moods',
  };

  const svg = (viewBox, body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="#000" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  // Points right while the room is closed, down (turned by the CSS) while it's open.
  const CHEVRON_GLYPH = svg('0 0 24 24', '<path d="M9 5.5l6.5 6.5L9 18.5"/>');

  const clamp01 = x => Math.min(1, Math.max(0, x));
  /** Snaps to whole percent; anything below half a percent is 0 (off). */
  const snap = x => Math.round(clamp01(x) * 100) / 100;

  /**
   * @param {HTMLElement} root
   * @param {{ colorStyle?: string, t?: (key: string, tokens?: object) => string,
   *   onSet?: (deviceId: string, change: {dim?: number, onoff?: boolean, temperature?: number,
   *     hue?: number, saturation?: number}) => Promise<any>,
   *   onMood?: (moodId: string) => Promise<any>, showMoods?: boolean, palette?: string, barMin?: string,
   *   open?: string[], onHeight?: (h: number) => void }} opts `open`: rooms (zone ids) open from the start, for the
   *   dev pages and renders; on a dashboard every room starts closed.
   */
  function createLightRoomsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`lightrooms.${key}`, tokens) : null;
      if (s && s !== `lightrooms.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    let devices = []; // [{ id, name, icon, zone, caps, groupLights? } | { id, missing }]
    /** Each room's icon (an SVG data URL) by zone id. */
    let zoneIcons = {};
    /** @type {{id: string, name: string, zone: string, colors: ({hue: number, saturation: number} | {temperature: number})[]}[]} */
    let moods = [];
    /**
     * The rooms, in the order of their first light: `key` is `zone:<zoneId>` or OTHER, `members` its lights that
     * can be switched, `rows` every entry shown in it (the missing ones too, in OTHER).
     * @type {{key: string, zone: string | null, name: string, members: any[], rows: any[]}[]}
     */
    let rooms = [];
    const optimistic = new Map(); // `${deviceId}:${capabilityId}` → { value, until }
    const drags = new Map(); // a room key or light id → fraction, while a finger or the mouse is on its bar
    /** The rooms open on this screen (their keys); every room starts closed. */
    const open = new Set((opts.open || []).map(z => `zone:${z}`));
    // What failed: a lasting message replaces the content, a transient one goes by itself.
    const message = messageLine(() => render(), { clear: () => { devices = []; } });

    root.classList.add('lr');
    applyColors(root, { style: opts.colorStyle });
    const list = el('div', { class: 'lr-list' }, root);
    const messageEl = el('div', { class: 'lr-message', dir: 'auto' }, root);
    const palette = PALETTES[opts.palette] || PALETTES.default;
    /** The bar's lowest value: 0 turns the light off (the default); `barMin: '1'` stops at 1 %, so it stays on. */
    const barFloor = opts.barMin === '1' ? 0.01 : 0;
    const level = x => Math.max(barFloor, snap(x));
    const touches = touchGuard(); // the tiles' taps and the bars' touches

    /** The swatch panel, under the row of the light it's open for. */
    const panel = el('div', { class: 'lr-panel' });
    let panelFor = null; // the light id the panel is open for
    let panelKey = ''; // which swatches it holds, so it's only rebuilt when that changes
    let panelTimer = null;
    /** @type {{node: HTMLElement, swatch: {hue?: number, sat?: number, k?: number}}[]} */
    let swatches = [];
    for (const type of ['touchstart', 'pointerdown']) panel.addEventListener(type, () => armPanel(), { passive: true });

    /** @type {Map<string, any>} the room cards by key */
    const cards = new Map();
    /** @type {Map<string, any>} the light rows by light id */
    const rows = new Map();
    /** Each light's last brightness above 0, which the app restores on a light without `onoff`. */
    const lastDim = new Map();

    function noteDim(id, value) {
      if (typeof value === 'number' && value > 0) lastDim.set(id, value);
    }

    /** The lights (`/state`'s `lights`) and their rooms' icons (`zoneIcons`). */
    function setState(lights, icons) {
      devices = Array.isArray(lights) ? lights : [];
      if (icons && typeof icons === 'object') zoneIcons = icons;
      message.reset();
      for (const d of devices) if (d.caps && d.caps.dim) noteDim(d.id, d.caps.dim.value);
      render();
    }

    /** The Moods of the lights' rooms. */
    function setMoods(listOfMoods) {
      moods = Array.isArray(listOfMoods) ? listOfMoods : [];
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

    /** A message under the rooms. Persistent messages also clear the rooms. */
    function setMessage(text, transient) {
      message.set(text, transient);
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

    /**
     * What a tap, a bar or a swatch acts on: a room (by its key) or one light (by its id), with its lights.
     * @returns {{id: string, name: string, members: any[]} | null}
     */
    function itemOf(id) {
      const room = rooms.find(r => r.key === id);
      if (room) return room.members.length ? { id, name: room.name, members: room.members } : null;
      const d = devices.find(x => x.id === id && !('missing' in x) && x.caps && (x.caps.dim || x.caps.onoff));
      return d ? { id, name: d.name, members: [d] } : null;
    }

    /** On while any of its lights is. */
    const itemOn = item => item.members.some(isOn);
    /** Its light's brightness, or the average of a room's lights that are on. */
    function itemBrightness(item) {
      const on = item.members.filter(isOn);
      return on.length ? on.reduce((sum, d) => sum + brightness(d), 0) / on.length : 0;
    }

    /** The colour a light shines in, from its shown (optimistic) values. */
    const colorOf = d => lightColor(Object.fromEntries(Object.keys(d.caps).map(k => [k, { value: shown(d, k) }])));
    /**
     * The colours the lit lights shine in, without repeats (at most MAX_COLORS): a Homey group device counts its lit
     * lights (its own colour is only the last one set on the group), any other light itself while it's on.
     */
    function colorsOf(members) {
      const out = [];
      for (const d of members) {
        const group = Array.isArray(d.groupLights) ? d.groupLights.filter(isOn) : [];
        for (const x of group.length ? group : isOn(d) ? [d] : []) {
          const c = colorOf(x);
          if (!out.includes(c)) out.push(c);
        }
      }
      return out.slice(0, MAX_COLORS);
    }

    /** Sends one light's change; a failure shakes the room or the row (`item`) and shows a message. */
    async function send(item, d, change) {
      if (!opts.onSet) return;
      try {
        await opts.onSet(d.id, change);
      } catch (err) {
        console.error(err);
        for (const id of ['onoff', 'dim', 'light_temperature', 'light_mode', 'light_hue', 'light_saturation']) optimistic.delete(`${d.id}:${id}`);
        shake(item.id);
        setMessage(t('failed', { name: d.name }), true);
      }
    }

    function shake(id) {
      const node = cards.has(id) ? cards.get(id).card : rows.has(id) ? rows.get(id).row : null;
      if (!node) return;
      node.classList.remove('shake');
      void node.offsetWidth; // restart the animation
      node.classList.add('shake');
    }

    /** A tap on a room's switch or a light's row: turns all its lights off when any is on, else all on. */
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

    /** The bar was let go at `x` (0–1): the brightness of the light, or of every light in the room. */
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
    /** Whether a light has the chip (colour or colour temperature), which opens the swatches. */
    const hasChip = d => settable(d, 'light_hue') || settable(d, 'light_temperature');

    /** A swatch was tapped: sets the light's colour or white (as Light Controls does for one light), and closes. */
    function pick(id, swatch) {
      const item = itemOf(id);
      closePanel();
      if (!item) return;
      const d = item.members[0];
      let change = null;
      if (swatch.k != null && settable(d, 'light_temperature')) {
        hope(d, { light_temperature: swatch.k, light_mode: 'temperature', onoff: true });
        change = { temperature: swatch.k };
      } else if (settable(d, 'light_hue') && swatch.k == null) {
        hope(d, { light_hue: swatch.hue / 360, light_saturation: swatch.sat, light_mode: 'color', onoff: true });
        change = { hue: swatch.hue / 360, saturation: swatch.sat };
      }
      render();
      if (change) send(item, d, change);
    }

    /** A Mood was tapped: Homey starts it (through the API key), and the lights report their new state. */
    async function startMood(key, mood) {
      if (!opts.onMood) return;
      try {
        await opts.onMood(mood.id);
      } catch (err) {
        console.error(err);
        shake(key);
        const reason = err && err.reason;
        setMessage(KEY_PROBLEMS.includes(reason) ? t(reason) : t('moodFailed', { name: mood.name }), true);
      }
    }

    /** Opens or closes a room; closing it closes its light's swatches too. */
    function toggleOpen(key) {
      if (open.has(key)) {
        open.delete(key);
        const room = rooms.find(r => r.key === key);
        if (room && room.rows.some(d => d.id === panelFor)) { panelFor = null; clearTimeout(panelTimer); }
      } else {
        open.add(key);
      }
      render();
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
     * Fills the panel for light `d` from the palette: the colours (with `light_hue`) in the first row, then the whites
     * (the temperatures, or a plain white without them), and the close button in the last column.
     */
    function buildPanel(d) {
      const color = settable(d, 'light_hue');
      const temp = settable(d, 'light_temperature');
      const key = `${color}:${temp}`;
      if (key === panelKey) return;
      panelKey = key;
      panel.textContent = '';
      swatches = [];
      /** @type {{hue?: number, sat?: number, k?: number}[]} */
      const swatchList = [
        ...(color ? palette.colors.map(([hue, sat]) => ({ hue, sat })) : []),
        ...(temp ? palette.whites.map(k => ({ k })) : color ? [{ hue: 0, sat: 0 }] : []),
      ];
      for (const swatch of swatchList) {
        const node = el('button', { type: 'button', class: 'lr-swatch' }, panel);
        node.style.setProperty('--lr-swatch', swatch.k != null ? temperatureColor(swatch.k) : hueColor(swatch.hue / 360, swatch.sat));
        onTap(node, () => { if (panelFor != null) pick(panelFor, swatch); });
        swatches.push({ node, swatch });
      }
      const close = el('button', { type: 'button', class: 'lr-close', 'aria-label': t('close') }, panel);
      setMask(el('span', { class: 'lr-close-glyph' }, close), glyphs.close);
      onTap(close, closePanel);
    }

    /** Whether a swatch is the light's current colour or white. */
    function isCurrent(d, swatch) {
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

    /** Taps on the tile body; `stop` keeps a control's taps (and keys) from also reaching the tile around it. */
    function onTap(node, fn, { stop = false } = {}) {
      kitOnTap(node, fn, { stop, guard: touches });
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
        touches.touched();
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

    const setMask = (node, url) => window.WidgetkeeperKit.setMask(node, url, '--lr-mask');

    /** A bar: a track with its fill, and the knob. */
    function makeBar(parent, cls) {
      const bar = el('div', { class: cls, role: 'slider', 'aria-valuemin': '0', 'aria-valuemax': '100' }, parent);
      const track = el('div', { class: 'lr-track' }, bar);
      el('div', { class: 'lr-fill' }, track);
      el('div', { class: 'lr-knob' }, bar);
      return bar;
    }

    function cardFor(key) {
      let card = cards.get(key);
      if (!card) {
        const node = el('div', { class: 'lr-room', 'data-room': key });
        const head = el('div', { class: 'lr-head', role: 'button', tabindex: '0' }, node);
        const icon = el('span', { class: 'lr-icon' }, head);
        const name = el('span', { class: 'lr-name', dir: 'auto' }, head);
        const state = el('span', { class: 'lr-state' }, head);
        setMask(el('span', { class: 'lr-chevron' }, head), CHEVRON_GLYPH);
        const sw = el('button', { type: 'button', class: 'lr-switch', role: 'switch' }, head);
        const bar = makeBar(node, 'lr-bar');
        const body = el('div', { class: 'lr-body' }, node);
        const moodRow = el('div', { class: 'lr-moods' }, body);
        el('div', { class: 'lr-sep' }, body);
        const rowList = el('div', { class: 'lr-rows' }, body);
        card = { card: node, head, icon, name, state, sw, bar, body, moodRow, moodKey: '', rowList };
        onTap(head, () => toggleOpen(key));
        // The switch is inside the header: its own taps (and keys) must not open the room.
        onTap(sw, () => toggle(key), { stop: true });
        wireBar(key, bar);
        cards.set(key, card);
      }
      return card;
    }

    function rowFor(id) {
      let row = rows.get(id);
      if (!row) {
        const node = el('div', { class: 'lr-row', 'data-device': id, role: 'group', tabindex: '0' });
        const chip = el('button', { type: 'button', class: 'lr-chip' }, node);
        const glyph = el('span', { class: 'lr-chip-glyph' }, chip);
        const name = el('span', { class: 'lr-row-name', dir: 'auto' }, node);
        const sub = el('span', { class: 'lr-row-sub' }, node);
        const bar = makeBar(node, 'lr-bar slim');
        row = { row: node, chip, glyph, name, sub, bar };
        onTap(node, () => toggle(id));
        // The chip is inside the row: its taps open the swatches, or toggle a light without colour.
        onTap(chip, () => {
          const item = itemOf(id);
          if (item && hasChip(item.members[0])) togglePanel(id);
          else toggle(id);
        }, { stop: true });
        wireBar(id, bar);
        rows.set(id, row);
      }
      return row;
    }

    /**
     * The gradients of several colours: the tint (mixed into the card as one colour is), the bar's fill (left to
     * right) and the chip's pie. Null clears them.
     */
    function setBlend(node, colors, tintAngle) {
      const props = colors ? {
        '--lr-tint-bg': `linear-gradient(${tintAngle}, ${colors.map(c => `color-mix(in srgb, ${c} var(--lr-tint), var(--lr-tile))`).join(', ')})`,
        '--lr-fill-bg': `linear-gradient(to right, ${colors.map(c => `color-mix(in srgb, ${c} var(--lr-fill-share), var(--lr-fill-with))`).join(', ')})`,
        '--lr-pie': `conic-gradient(${colors.map((c, i) => `color-mix(in srgb, ${c} var(--lr-fill-share), var(--lr-fill-with)) ${(i / colors.length) * 100}% ${((i + 1) / colors.length) * 100}%`).join(', ')})`,
      } : { '--lr-tint-bg': '', '--lr-fill-bg': '', '--lr-pie': '' };
      for (const [k, v] of Object.entries(props)) {
        if (node.style.getPropertyValue(k) === v) continue;
        if (v) node.style.setProperty(k, v);
        else node.style.removeProperty(k);
      }
    }

    /** The rooms of the lights, in the order of each room's first light; OTHER last. */
    function buildRooms() {
      const usable = d => !('missing' in d) && d.caps && (d.caps.dim || d.caps.onoff);
      const byKey = new Map();
      for (const d of devices) {
        const ok = usable(d);
        const key = ok && d.zone ? `zone:${d.zone.id}` : OTHER;
        if (!byKey.has(key)) {
          byKey.set(key, { key, zone: key === OTHER ? null : d.zone.id, name: key === OTHER ? t('other') : d.zone.name, members: [], rows: [] });
        }
        const room = byKey.get(key);
        room.rows.push(d);
        if (ok) room.members.push(d);
      }
      const out = [...byKey.values()].filter(r => r.key !== OTHER);
      if (byKey.has(OTHER)) out.push(byKey.get(OTHER));
      return out;
    }

    /** The room's state: Off, All on or "2 of 3 on", with the brightness of those on. */
    function roomState(room, on, x) {
      if (!room.members.length) return t('unavailable');
      const lit = room.members.filter(isOn).length;
      if (!on) return t('off');
      const state = lit === room.members.length ? t('allOn') : t('someOn', { on: lit, all: room.members.length });
      return room.members.some(d => d.caps.dim) ? t('level', { state, percent: Math.round(x * 100) }) : state;
    }

    /** Keeps `node` as the next child after `prev` in `parent` (moving it only when out of place, so a drag goes on). */
    function place(parent, prev, node) {
      const want = prev ? prev.nextSibling : parent.firstChild;
      if (node !== want) parent.insertBefore(node, want);
      return node;
    }

    function renderBar(bar, x, name) {
      bar.style.setProperty('--lr-x', String(x));
      bar.setAttribute('aria-valuenow', String(Math.round(x * 100)));
      bar.setAttribute('aria-label', name);
    }

    function renderRoom(room, card) {
      const item = { id: room.key, members: room.members };
      const drag = drags.get(room.key);
      const on = itemOn(item);
      const x = drag != null ? level(drag) : itemBrightness(item);
      const colors = colorsOf(room.members);
      const isOpen = open.has(room.key);
      card.card.classList.toggle('on', on || (drag != null && x > 0));
      card.card.classList.toggle('open', isOpen);
      card.card.classList.toggle('multi', colors.length > 1);
      card.card.classList.toggle('no-dim', !room.members.some(d => d.caps.dim));
      card.card.style.setProperty('--lr-light', colors[0] || (room.members[0] ? colorOf(room.members[0]) : 'transparent'));
      setBlend(card.card, colors.length > 1 ? colors : null, '90deg');
      card.head.setAttribute('aria-expanded', String(isOpen));
      const icon = room.zone ? zoneIcons[room.zone] : null;
      setMask(card.icon, icon || null);
      card.icon.classList.toggle('fallback', !icon);
      card.name.textContent = room.name;
      card.state.textContent = roomState(room, on, x);
      card.sw.classList.toggle('on', on);
      card.sw.setAttribute('aria-checked', String(on));
      card.sw.setAttribute('aria-label', room.name);
      card.sw.style.display = room.members.length ? '' : 'none';
      renderBar(card.bar, x, room.name);

      // The room's Moods, while it's open.
      const roomMoods = isOpen && opts.showMoods !== false && room.zone ? moods.filter(m => m.zone === room.zone) : [];
      const moodKey = JSON.stringify(roomMoods.map(m => [m.id, m.name, m.colors]));
      if (moodKey !== card.moodKey) {
        card.moodKey = moodKey;
        card.moodRow.textContent = '';
        for (const mood of roomMoods) {
          const node = el('button', { type: 'button', class: 'lr-mood' }, card.moodRow);
          const dot = moodDot(mood.colors);
          if (dot) el('span', { class: 'lr-mood-dot' }, node).style.setProperty('--lr-swatch', dot);
          el('span', { class: 'lr-mood-name', dir: 'auto', text: mood.name }, node);
          onTap(node, () => startMood(room.key, mood));
        }
      }
      card.moodRow.style.display = roomMoods.length ? '' : 'none';
      card.body.style.display = isOpen ? '' : 'none';
      if (!isOpen) return;

      let prev = null;
      for (const d of room.rows) {
        const row = rowFor(d.id);
        prev = place(card.rowList, prev, row.row);
        renderRow(d, row);
        if (panelFor === d.id) prev = place(card.rowList, prev, panel);
      }
    }

    function renderRow(d, row) {
      const missing = 'missing' in d || !d.caps || !(d.caps.dim || d.caps.onoff);
      row.row.classList.toggle('missing', missing);
      if (missing) {
        row.name.textContent = t('unavailable');
        row.sub.textContent = '';
        row.row.classList.remove('on', 'multi');
        row.row.classList.add('no-dim');
        row.chip.classList.add('plain');
        row.row.style.setProperty('--lr-light', 'transparent');
        return;
      }
      const item = { id: d.id, members: [d] };
      const drag = drags.get(d.id);
      const on = itemOn(item);
      const x = drag != null ? level(drag) : itemBrightness(item);
      const colors = colorsOf([d]);
      const multi = colors.length > 1;
      const color = settable(d, 'light_hue');
      const chip = hasChip(d);
      row.row.classList.toggle('on', on || (drag != null && x > 0));
      row.row.classList.toggle('no-dim', !d.caps.dim);
      row.row.classList.toggle('multi', multi);
      row.row.style.setProperty('--lr-light', colors[0] || colorOf(d));
      setBlend(row.row, multi ? colors : null, '135deg');
      row.row.setAttribute('aria-label', d.name);
      row.name.textContent = d.name;
      row.sub.textContent = d.caps.dim ? '' : t(on ? 'on' : 'off');
      // A light without colour or temperature: a plain dot in its colour.
      row.chip.classList.toggle('plain', !chip);
      row.chip.classList.toggle('active', panelFor === d.id);
      row.chip.tabIndex = chip ? 0 : -1;
      row.chip.setAttribute('aria-label', t(color ? 'color' : 'temperature'));
      row.glyph.classList.toggle('hue', color || multi);
      setMask(row.glyph, chip ? (multi ? glyphs.pie : color ? glyphs.hue : glyphs.temp) : null);
      renderBar(row.bar, x, d.name);
    }

    let lastHeight = 0;
    function render() {
      rooms = buildRooms();
      const keys = new Set(rooms.map(r => r.key));
      for (const [key, card] of cards) {
        if (!keys.has(key)) { card.card.remove(); cards.delete(key); open.delete(key); }
      }
      const ids = new Set(devices.map(d => d.id));
      for (const [id, row] of rows) {
        if (!ids.has(id)) { row.row.remove(); rows.delete(id); }
      }
      // The swatches: only while their light is shown in an open room and can take a colour.
      const panelItem = panelFor != null ? itemOf(panelFor) : null;
      const panelRoom = panelItem ? rooms.find(r => r.rows.some(d => d.id === panelFor)) : null;
      if (!panelItem || !panelRoom || !open.has(panelRoom.key) || !hasChip(panelItem.members[0])) {
        if (panelFor != null) { panelFor = null; clearTimeout(panelTimer); }
        panel.remove();
      } else {
        buildPanel(panelItem.members[0]);
        for (const s of swatches) s.node.classList.toggle('current', isCurrent(panelItem.members[0], s.swatch));
      }

      let prev = null;
      for (const room of rooms) {
        const card = cardFor(room.key);
        prev = place(list, prev, card.card);
        renderRoom(room, card);
      }
      list.style.display = devices.length ? '' : 'none';
      messageEl.textContent = message.text || '';
      messageEl.style.display = message.text ? '' : 'none';
      messageEl.classList.toggle('error', !!message.text && devices.length > 0);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    return { setState, setMoods, pushChange, setMessage, render, t };
  }

  window.createLightRoomsWidget = createLightRoomsWidget;
})();
