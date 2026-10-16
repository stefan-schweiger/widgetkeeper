/*
 * Device Values: a grid of half-height tiles in the style of Device Quick Actions, each showing one
 * capability of a device: its icon and value on top, the device name below. Display only.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_STRINGS = {
    selectSlots: 'Pick device values in the widget settings.',
    error: 'Could not load the values.',
    unavailable: 'Unavailable',
    on: 'On',
    off: 'Off',
    renameFailed: 'Could not save the name.',
  };

  // Homey's standard capabilities carry no icon of their own (the Homey app draws them), so these stand
  // in unless the capability has one. Drawn like Quick Actions' glyphs: each viewBox cropped to the ink
  // (plus half the stroke), with the library icons' thin line.
  const svg = (viewBox, body) => `data:image/svg+xml;base64,${btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" fill="none" stroke="#000" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`)}`;
  const LOCK_BOX = '4.4 2.4 15.2 19.2';
  const GLYPHS = {
    thermometer: svg('7.4 2.4 9.2 19.6', '<path d="M10 13.8V5a2 2 0 0 1 4 0v8.8a4 4 0 1 1-4 0z"/><path d="M12 9v6"/>'),
    drop: svg('5.4 2.4 13.2 18.2', '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>'),
    bolt: svg('3.4 1.4 16.2 21.2', '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>'),
    sun: svg('1.4 1.4 21.2 21.2', '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>'),
    cloud: svg('2.4 3.4 20.2 15.2', '<path d="M7 18a4 4 0 0 1-.5-8A5.5 5.5 0 0 1 17 8.5a4.5 4.5 0 0 1 .5 9.5z"/>'),
    battery: svg('2.4 6.4 19.2 11.2', '<rect x="3" y="7" width="16" height="10" rx="2"/><path d="M21 10v4"/>'),
    bell: svg('3.9 4.4 16.2 18.7', '<path d="M6 16v-5a6 6 0 0 1 12 0v5l1.5 2h-15z"/><path d="M10 20.5a2 2 0 0 0 4 0"/>'),
    power: svg('3.4 2.4 17.2 18.6', '<path d="M12 3v9"/><path d="M6.3 6.8a8 8 0 1 0 11.4 0"/>'),
    locked: svg(LOCK_BOX, '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>'),
    unlocked: svg(LOCK_BOX, '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>'),
    bulb: svg('5.4 2.4 13.2 19.2', '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z"/>'),
    wave: svg('2.4 2.4 19.2 16.2', '<path d="M3 12h2l2-6 3 12 3-15 3 15 2-6h3"/>'),
    gauge: svg('3.4 8.4 17.2 9.2', '<path d="M4 17a8 8 0 1 1 16 0"/><path d="M12 17l4-5"/>'),
  };

  /** The built-in glyph for a capability and its current value. */
  function glyph(capabilityId, value) {
    const base = capabilityId.split('.')[0];
    if (base === 'measure_temperature' || base === 'target_temperature') return GLYPHS.thermometer;
    if (base === 'measure_humidity' || base === 'measure_rain') return GLYPHS.drop;
    if (base === 'measure_power' || base === 'meter_power' || base === 'measure_current' || base === 'measure_voltage') return GLYPHS.bolt;
    if (base === 'measure_luminance' || base === 'measure_ultraviolet') return GLYPHS.sun;
    if (/^measure_(co2|co|pm\d+|voc|tvoc)$/.test(base)) return GLYPHS.cloud;
    if (base === 'measure_battery' || base === 'alarm_battery') return GLYPHS.battery;
    if (base.startsWith('alarm_')) return GLYPHS.bell;
    if (base === 'onoff') return GLYPHS.power;
    if (base === 'locked') return value ? GLYPHS.locked : GLYPHS.unlocked;
    if (base === 'dim') return GLYPHS.bulb;
    if (base === 'measure_noise') return GLYPHS.wave;
    return GLYPHS.gauge;
  }

  /** The capability's own icon, else the glyph; batteries always get the glyph (drivers' own differ, some with a fixed level). */
  function iconFor(s) {
    if ('missing' in s) return glyph(s.capabilityId, null);
    const base = s.capabilityId.split('.')[0];
    if (base === 'measure_battery' || base === 'alarm_battery') return glyph(s.capabilityId, s.value);
    return s.capability.icon || glyph(s.capabilityId, s.value);
  }

  /** The tile colours a Flow can set (the `values_set_color` card). */
  const COLORS = new Set(['red', 'orange', 'yellow', 'green', 'blue', 'purple']);

  /** Units written without a space, as the Homey app does (`21.5°C`, `45%`). */
  const TIGHT_UNITS = /^(°|%)/;

  /**
   * A `%` number as 0–100, or null for anything else. Homey's `dim` (and some others) report `%` as 0–1
   * (`max: 1`), so a range of 0–1 is scaled up.
   * @param {{type: string, units: string|null, min?: number|null, max?: number|null}} cap
   * @param {unknown} value
   */
  function percentOf(cap, value) {
    if (cap.type !== 'number' || cap.units !== '%' || typeof value !== 'number' || !isFinite(value)) return null;
    return cap.max === 1 && (cap.min == null || cap.min === 0) ? value * 100 : value;
  }

  /** The fill colour for a percentage: red below `red`, yellow below `yellow`, else green. */
  function levelOf(percent, thresholds) {
    if (percent < thresholds.red) return 'red';
    if (percent < thresholds.yellow) return 'yellow';
    return 'green';
  }

  /**
   * @param {{type: string, units: string|null, decimals: number|null, min?: number|null, max?: number|null, values: {id: string, title: string}[]|null}} cap
   * @param {unknown} value
   * @param {(key: string) => string} t
   */
  function formatValue(cap, value, t) {
    if (value == null) return '–';
    if (cap.type === 'boolean') return value ? t('on') : t('off');
    if (cap.type === 'enum') {
      const v = (cap.values || []).find(x => x.id === String(value));
      return v ? v.title : String(value);
    }
    const percent = percentOf(cap, value);
    if (percent != null && percent !== value) return `${Math.round(percent).toLocaleString()}%`;
    if (cap.type === 'number' && typeof value === 'number') {
      const digits = cap.decimals != null ? Math.max(0, Math.min(cap.decimals, 4)) : null;
      const text = value.toLocaleString(undefined, digits != null
        ? { minimumFractionDigits: 0, maximumFractionDigits: digits }
        : { maximumFractionDigits: 1 });
      if (!cap.units) return text;
      return TIGHT_UNITS.test(cap.units) ? `${text}${cap.units}` : `${text} ${cap.units}`;
    }
    return String(value);
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

  const keyOf = s => `${s.deviceId}:${s.capabilityId}`;

  /** Each tile's key for its typed name: the value's own key, then `#2`, `#3` … for repeats, so reordering keeps the names. */
  function nameKeys(slots) {
    const seen = new Map();
    return slots.map((s) => {
      const k = keyOf(s);
      const n = (seen.get(k) || 0) + 1;
      seen.set(k, n);
      return n > 1 ? `${k}#${n}` : k;
    });
  }

  /** An entry with the tile's own name from the settings, when one is set (a missing entry keeps none). */
  function withName(entry, name) {
    const n = typeof name === 'string' ? name.trim() : '';
    return n && entry && !('missing' in entry) ? { ...entry, name: n } : entry;
  }

  /**
   * The names typed on the tiles (`renameTiles`; the app keeps them per widget instance, by tile key): `name(key, own)`
   * is the typed name, else `own`. In rename mode `field(key, own)` is the tile's text field (made once per key, with
   * `own` as the placeholder): it saves on change (Enter or leaving it), Escape puts it back, and a realtime update
   * doesn't overwrite it while it has the focus. Its touches, clicks and keys never reach the tile's own taps.
   * `failed(key)` shakes the tile and says so; the name goes back, unless the app's names came meanwhile.
   */
  function tileNames(opts, render, failed) {
    let names = {};
    let reads = 0; // set() calls: the app's names, by realtime or a read
    const fields = new Map();
    async function save(key, value) {
      const before = names[key];
      if ((before || '') === value) return;
      const put = v => { names = { ...names }; if (v) names[key] = v; else delete names[key]; };
      put(value);
      const seen = reads;
      render();
      try {
        if (opts.onRename) await opts.onRename(key, value);
      } catch (err) {
        console.error(err);
        // Only while it still shows this save's name and nothing came from the app since: what came says what the
        // app kept (a newer name, or this one when only the answer was lost).
        if (reads === seen && (names[key] || '') === value) put(before);
        failed(key);
      }
    }
    return {
      renaming: opts.renameTiles === true,
      name: (key, own) => names[key] || own,
      set(map) {
        reads++;
        names = {};
        if (map && typeof map === 'object') for (const [k, v] of Object.entries(map)) if (typeof v === 'string' && v) names[k] = v;
        render();
      },
      field(key, own) {
        let input = fields.get(key);
        if (!input) {
          input = document.createElement('input');
          input.type = 'text';
          input.className = 'wk-rename';
          input.dir = 'auto';
          input.maxLength = 60;
          input.autocomplete = 'off';
          input.setAttribute('enterkeyhint', 'done');
          const field = input;
          for (const type of ['touchstart', 'touchend', 'pointerdown', 'click']) field.addEventListener(type, e => e.stopPropagation(), { passive: true });
          field.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter') field.blur();
            else if (e.key === 'Escape') { field.value = names[key] || ''; field.blur(); }
          });
          field.addEventListener('change', () => { field.value = field.value.trim(); save(key, field.value); });
          fields.set(key, input);
        }
        input.placeholder = own || '';
        input.setAttribute('aria-label', own || '');
        if (document.activeElement !== input) input.value = names[key] || '';
        return input;
      },
    };
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, columns?: number|string, colorStyle?: string,
   *   percentFill?: boolean, redBelow?: number|string, yellowBelow?: number|string, names?: string[],
   *   renameTiles?: boolean, onRename?: (key: string, name: string) => Promise<any>,
   *   onHeight?: (h: number) => void }} opts
   */
  function createValuesWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`values.${key}`, tokens) : null;
      if (s && s !== `values.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };

    const names = Array.isArray(opts.names) ? opts.names : []; // per tile, lined up with the entries
    let slots = []; // [{ deviceId, capabilityId, name, capability, value, color? } | { deviceId, capabilityId, missing }]
    let messageText = null;
    let messageTimer = null;

    root.classList.add('vt');
    // The typed names win over the `nameN` settings (which give the field its placeholder).
    const typed = tileNames(opts, () => render(), (key) => {
      const i = nameKeys(slots).indexOf(key);
      const tile = i >= 0 ? tiles.get(`${keyOf(slots[i])}#${i}`) : null;
      if (tile) {
        tile.tile.classList.remove('shake');
        void tile.tile.offsetWidth; // restart the animation
        tile.tile.classList.add('shake');
      }
      setMessage(t('renameFailed'), true);
    });
    root.classList.toggle('renaming', typed.renaming);
    root.dataset.columns = String(opts.columns) === '2' ? '2' : '3';
    // Bright colours: fills and Flow colours at full strength, with text that reads on them (soft, the 22 % tint, otherwise).
    const bright = opts.colorStyle === 'bright';
    root.classList.toggle('vt-bright', bright);
    const num = (v, fallback) => (v !== '' && v != null && isFinite(Number(v)) ? Number(v) : fallback);
    const thresholds = { red: num(opts.redBelow, 10), yellow: num(opts.yellowBelow, 20) };
    const grid = el('div', { class: 'vt-grid' }, root);
    const messageEl = el('div', { class: 'vt-message', dir: 'auto' }, root);
    /** @type {Map<string, {tile: HTMLElement, icon: HTMLElement, value: HTMLElement, name: HTMLElement,
     *   ink: {icon: HTMLElement, value: HTMLElement, name: HTMLElement} | null}>} */
    const tiles = new Map();

    function setState(list) {
      slots = (Array.isArray(list) ? list : []).map((s, i) => withName(s, names[i]));
      messageText = null;
      render();
    }

    function pushChange({ deviceId, capabilityId, value }) {
      let changed = false;
      for (const s of slots) {
        if (s.deviceId === deviceId && s.capabilityId === capabilityId && !('missing' in s)) {
          s.value = value;
          changed = true;
        }
      }
      if (changed) render();
    }

    /** A tile colour set by a Flow (`color` null resets it), for every tile showing that value. */
    function pushColor({ deviceId, capabilityId, color }) {
      let changed = false;
      for (const s of slots) {
        if (s.deviceId === deviceId && s.capabilityId === capabilityId && !('missing' in s)) {
          s.color = color || undefined;
          changed = true;
        }
      }
      if (changed) render();
    }

    /** A message under the tiles. Persistent messages also clear the tiles. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else slots = [];
      render();
    }

    // A slot can appear twice (the same value picked for two tiles), so tiles are keyed by position too.
    function tileFor(key) {
      let tile = tiles.get(key);
      if (!tile) {
        const node = el('div', { class: 'vt-tile', 'data-slot': key });
        const top = el('div', { class: 'vt-top' }, node);
        tile = {
          tile: node,
          icon: el('span', { class: 'vt-icon' }, top),
          value: el('span', { class: 'vt-value', dir: 'auto' }, top),
          name: el('span', { class: 'vt-name', dir: 'auto' }, node),
          ink: null,
        };
        // Bright fills: the same icon and text again in the ink colour, which the CSS clips to the fill.
        if (bright) {
          const ink = el('div', { class: 'vt-ink', 'aria-hidden': 'true' }, node);
          const inkTop = el('div', { class: 'vt-top' }, ink);
          tile.ink = {
            icon: el('span', { class: 'vt-icon' }, inkTop),
            value: el('span', { class: 'vt-value', dir: 'auto' }, inkTop),
            name: el('span', { class: 'vt-name', dir: 'auto' }, ink),
          };
        }
        tiles.set(key, tile);
      }
      return tile;
    }

    function setMask(node, url) {
      const v = url ? `url("${url}")` : '';
      if (node.style.getPropertyValue('--vt-mask') !== v) node.style.setProperty('--vt-mask', v);
    }

    let lastHeight = 0;
    function render() {
      const keys = slots.map((s, i) => `${keyOf(s)}#${i}`);
      const named = nameKeys(slots);
      const wanted = new Set(keys);
      for (const [key, tile] of tiles) {
        if (!wanted.has(key)) { tile.tile.remove(); tiles.delete(key); }
      }
      slots.forEach((s, i) => {
        const tile = tileFor(keys[i]);
        grid.appendChild(tile.tile); // keeps the settings' order; a no-op when already in place
        const missing = 'missing' in s;
        tile.name.textContent = missing ? t('unavailable') : typed.name(named[i], s.name);
        if (typed.renaming && !missing) {
          const field = typed.field(named[i], s.name);
          if (field.previousSibling !== tile.name) tile.name.after(field);
        }
        tile.value.textContent = missing ? '' : formatValue(s.capability, s.value, t);
        setMask(tile.icon, iconFor(s));
        if (tile.ink) {
          tile.ink.name.textContent = tile.name.textContent;
          tile.ink.value.textContent = tile.value.textContent;
          setMask(tile.ink.icon, iconFor(s));
        }
        tile.tile.classList.toggle('active', !missing && s.capability.type === 'boolean' && s.value === true);
        // Percentages can fill the tile from the left, coloured by level.
        const percent = !missing && opts.percentFill ? percentOf(s.capability, s.value) : null;
        tile.tile.classList.toggle('filled', percent != null);
        if (percent != null) {
          tile.tile.style.setProperty('--vt-fill', `${Math.max(0, Math.min(100, percent))}%`);
          tile.tile.dataset.level = levelOf(percent, thresholds);
        } else {
          tile.tile.style.removeProperty('--vt-fill');
          delete tile.tile.dataset.level;
        }
        // A colour set by a Flow tints the tile (and colours a percentage fill instead of its level).
        const color = !missing && COLORS.has(s.color) ? s.color : null;
        if (color) tile.tile.dataset.color = color;
        else delete tile.tile.dataset.color;
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

    return { setState, setNames: typed.set, pushChange, pushColor, setMessage, render, t };
  }

  window.createValuesWidget = createValuesWidget;
  window.formatCapabilityValue = formatValue;
})();
