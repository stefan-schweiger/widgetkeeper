/*
 * Thermostat Presets: a header with the device and three preset buttons. A button is
 * highlighted while the device's state matches its preset; when none matches, the header says
 * what the device is currently doing, and when a lit preset sets no temperature, the setpoint. A chosen sensor value
 * (`state.sensor`) can sit at the header's right end. Tapping the header opens the controls panel in the widget's place:
 * every setting of the device, applied one at a time. The header, buttons and highlighting are the shared presets
 * module (presets.js, which Variable Presets loads too); this is the device model, its text and the panel.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TEMP_TOLERANCE = 0.25;
  const STEP_DELAY = 700; // a stepper's taps are sent this long after the last one
  const PENDING_MS = 10e3; // how long a control shows the value sent while waiting for the device to report it
  const MESSAGE_MS = 8000;
  const IDLE_CLOSE_MS = 30e3; // the panel closes after this long untouched (a wall tablet shouldn't stay in it)
  const SEGMENTS_MAX = 4; // an enum with more values steps through them instead

  const DEFAULT_STRINGS = {
    selectDevice: 'Select a thermostat in the widget settings.',
    off: 'Off',
    on: 'On',
    currently: 'Currently __state__',
    currentlyOff: 'Currently off',
    setpoint: 'Set to __temp__',
    power: 'Power',
    controls: 'Show the controls',
    close: 'Close',
    error: 'Could not load the thermostat.',
    applyFailed: 'Could not change the thermostat.',
  };

  // Mode value ids → colour class. Anything else uses the accent colour.
  /** @type {[RegExp, string][]} */
  const MODE_KINDS = [[/heat/i, 'heat'], [/cool/i, 'cool'], [/auto/i, 'auto'], [/dry|dehum/i, 'dry'], [/fan|vent/i, 'fan']];

  function sameValue(capabilityId, a, b) {
    if (typeof a === 'number' && typeof b === 'number') {
      return capabilityId === 'target_temperature' ? Math.abs(a - b) <= TEMP_TOLERANCE : a === b;
    }
    return a === b || (a != null && b != null && String(a) === String(b));
  }

  function modeKind(value) {
    const hit = MODE_KINDS.find(([re]) => re.test(String(value)));
    return hit ? hit[1] : 'other';
  }

  /** "Fan speed" + "Slow" → "Fan slow". */
  function shortSetting(capTitle, valueTitle) {
    const word = String(capTitle || '').split(/\s+/)[0];
    if (!word || valueTitle.toLowerCase().startsWith(word.toLowerCase())) return valueTitle;
    const v = valueTitle === valueTitle.toUpperCase() ? valueTitle : valueTitle.charAt(0).toLowerCase() + valueTitle.slice(1);
    return `${word} ${v}`;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ colorStyle?: string, t?: (key: string, tokens?: object) => string, locale?: string,
   *   onApply?: (values: {capabilityId: string, value: any}[], press?: { button: number }) => Promise<any>,
   *   onHeight?: (h: number) => void, layout?: string, title?: string }} opts `title` replaces the device's name.
   *   Without `onApply` there's no controls panel.
   */
  function createThermostatWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`thermostat.${key}`, tokens) : null;
      if (s && s !== `thermostat.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const numberFmt = new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 1 });
    const title = typeof opts.title === 'string' ? opts.title.trim() : '';
    const { el } = window.WidgetkeeperKit;

    // The header, the buttons and which is lit; the device model below reads its state ({ name, icon, values, caps }).
    window.WidgetkeeperKit.applyColors(root, { style: opts.colorStyle }); // ../spacer/kit.js: the Vivid colours
    const core = window.WidgetkeeperPresets.create(root, {
      layout: opts.layout,
      onHeight: opts.onHeight,
      text: p => presetText(p),
      matches: (p, state) => presetMatches(state.values, deviceValues(p)),
      usable: p => deviceValues(p).length > 0,
      // A button's values with its number (1–3), for the Flow card *… was tapped*; the panel's changes send none.
      apply: opts.onApply ? (p, s, i) => opts.onApply(deviceValues(p), { button: i + 1 }) : null,
      failed: err => `${t('applyFailed')} ${(err && err.message) || ''}`.trim(),
      current: () => currentText(),
      lit: (state, active) => setpointText(state, active),
      onHeader: opts.onApply ? () => openPanel() : null,
      headerLabel: t('controls'),
      // The sensor beside the name: `{capability, value}` from Device Values' tracking (the kit's formatting).
      aside: state => (state.sensor ? window.WidgetkeeperKit.formatValue(state.sensor.capability, state.sensor.value, t) : ''),
    });

    /** The device's state, named by the `title` setting when there is one. */
    function setState(state) {
      core.setState(title && state ? { ...state, name: title } : state);
      if (!state) closePanel();
      else if (panelOpen) buildPanel();
    }

    function pushChange({ capabilityId, value }) {
      const state = core.getState();
      if (!state) return;
      state.values[capabilityId] = value;
      const p = pending[capabilityId];
      if (p && sameValue(capabilityId, p.value, value)) delete pending[capabilityId];
      core.render();
      updatePanel();
    }

    /** A message in the subtitle; a persistent one (the state is gone) also closes the panel. */
    function setMessage(text, transient) {
      core.setMessage(text, transient);
      if (!transient) closePanel();
    }

    /** A realtime value of the sensor beside the name. */
    function pushSensor(value) {
      const state = core.getState();
      if (!state || !state.sensor) return;
      state.sensor.value = value;
      core.render();
    }

    // ---------------------------------------------------------------- device model

    function offValue(id) {
      const state = core.getState();
      const info = state && state.caps[id];
      return info && info.values && info.values.find(x => /^off$/i.test(x.id) || /^off$/i.test(x.title));
    }

    /**
     * The capability the buttons' Mode field uses (often a driver's own, not `thermostat_mode`).
     * When no button sets a mode: `thermostat_mode`, else the first enum with an `off` value.
     */
    function modeCap() {
      const state = core.getState();
      for (const p of core.presets()) {
        const m = p.values.find(v => v.slot === 'mode');
        if (m) return m.capabilityId;
      }
      if (state && !state.caps.thermostat_mode) {
        const id = Object.keys(state.caps).find(offValue);
        if (id) return id;
      }
      return 'thermostat_mode';
    }

    /** The mode value that means off, e.g. `thermostat_mode: off`. */
    function offMode() {
      const id = modeCap();
      const off = offValue(id);
      return off ? { capabilityId: id, value: off.id } : null;
    }

    function isOff(values) {
      if ('onoff' in values) return values.onoff === false;
      const off = offMode();
      return !!off && sameValue(off.capabilityId, values[off.capabilityId], off.value);
    }

    /**
     * The values to send and match against for this device. Many aircons have no `onoff` and turn
     * off through their mode instead; turning them on is then implied by the other values.
     */
    function deviceValues(preset) {
      const state = core.getState();
      if (!state || state.caps.onoff) return preset.values;
      if (preset.values.some(v => v.capabilityId === 'onoff' && v.value === false)) {
        const off = offMode();
        // No way to turn this device off: the "Off" button is disabled rather than sending the rest.
        if (!off) return [];
        // Turning off wins over any mode the preset also sets.
        return [off, ...preset.values.filter(v => v.capabilityId !== 'onoff' && v.capabilityId !== off.capabilityId)];
      }
      return preset.values.filter(v => v.capabilityId !== 'onoff');
    }

    /** True when the device state equals everything the preset sets. */
    function presetMatches(values, presetValues) {
      if (!presetValues.length) return false;
      const off = offMode();
      const turnsOff = presetValues.some(v => (v.capabilityId === 'onoff' && v.value === false)
        || (off && v.capabilityId === off.capabilityId && sameValue(v.capabilityId, v.value, off.value)));
      // A preset that doesn't turn the device off only counts while it's on.
      if (!turnsOff && isOff(values)) return false;
      return presetValues.every(v => sameValue(v.capabilityId, values[v.capabilityId], v.value));
    }

    // ---------------------------------------------------------------- text

    function enumTitle(capabilityId, value, fallbackName) {
      const state = core.getState();
      const info = state && state.caps[capabilityId];
      const match = info && info.values && info.values.find(x => String(x.id) === String(value));
      if (match) return match.title;
      // Before the state loads: the autocomplete item name, "Fan speed: Slow".
      if (fallbackName && fallbackName.includes(': ')) return fallbackName.split(': ').slice(1).join(': ');
      return value == null ? null : String(value);
    }

    function capTitle(capabilityId, fallbackName) {
      const state = core.getState();
      const info = state && state.caps[capabilityId];
      if (info && info.title) return info.title;
      return fallbackName && fallbackName.includes(': ') ? fallbackName.split(': ')[0] : capabilityId;
    }

    function temp(v) { return `${numberFmt.format(v)}°`; }

    /** What a preset tile shows: a big line, an optional coloured mode line and extra settings. */
    function presetText(p) {
      const slot = name => p.values.find(v => v.slot === name);
      const onoff = slot('power'), tt = slot('temp'), mode = slot('mode');
      const extras = p.values.filter(v => v.slot === 'extra')
        .map(v => shortSetting(capTitle(v.capabilityId, v.name), enumTitle(v.capabilityId, v.value, v.name)));
      const modeTitle = mode ? enumTitle(mode.capabilityId, mode.value, mode.name) : null;
      const off = offMode();
      if ((onoff && onoff.value === false) || (mode && off && mode.capabilityId === off.capabilityId && sameValue(mode.capabilityId, mode.value, off.value))) {
        return { big: t('off'), mode: null, kind: 'off', extras: [] };
      }
      const kind = mode ? modeKind(`${mode.value} ${modeTitle}`) : 'other';
      if (tt) return { big: temp(tt.value), mode: modeTitle, kind, extras };
      if (modeTitle) return { big: modeTitle, mode: null, kind, extras };
      if (extras.length) return { big: extras[0], mode: null, kind, extras: extras.slice(1) };
      return { big: onoff ? t('on') : '', mode: null, kind, extras: [] };
    }

    /** "Set to 21°" while the lit presets set no temperature: the device's own setpoint (wk-079). */
    function setpointText(state, active) {
      const v = state.values.target_temperature;
      if (typeof v !== 'number' || isOff(state.values)) return '';
      const presets = core.presets();
      if (active.some(i => presets[i] && presets[i].values.some(x => x.capabilityId === 'target_temperature'))) return '';
      return t('setpoint', { temp: temp(v) });
    }

    /** "Cool 23° · Fan auto", covering the mode, target temperature and settings the buttons use. */
    function currentText() {
      const values = core.getState().values;
      if (isOff(values)) return t('currentlyOff');
      const mc = modeCap();
      const head = [];
      if (values[mc] != null) head.push(enumTitle(mc, values[mc]));
      if (typeof values.target_temperature === 'number') head.push(temp(values.target_temperature));
      const parts = head.length ? [head.join(' ')] : [];
      const extra = new Set();
      for (const p of core.presets()) {
        for (const v of p.values) {
          if (v.slot === 'extra' && v.capabilityId !== mc && v.capabilityId in values) extra.add(v.capabilityId);
        }
      }
      for (const id of extra) {
        const title = enumTitle(id, values[id]);
        if (title != null) parts.push(shortSetting(capTitle(id), title));
      }
      return parts.length ? t('currently', { state: parts.join(' · ') }) : '';
    }

    // ---------------------------------------------------------------- controls panel

    // In the widget's place while open (`.tw-open` hides the header and the buttons): a top row with the name and ✕, then
    // a row per setting of the device. Each change is one `onApply` value; the row shows it until the device reports it.
    const panel = el('div', { class: 'tw-controls' }, root);
    let panelOpen = false;
    let panelKey = '';
    let rows = []; // { id, node, update() }
    let idleTimer = null;
    let messageTimer = null;
    let messageEl = null;
    /** @type {Record<string, {value: any, until: number}>} */
    const pending = {};
    /** @type {Record<string, any>} */
    const sendTimers = {};

    panel.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closePanel(true);
      else touchPanel();
    });
    panel.addEventListener('pointerdown', () => touchPanel());

    function openPanel() {
      if (panelOpen || !core.getState()) return;
      panelOpen = true;
      root.classList.add('tw-open');
      buildPanel();
      touchPanel();
      const close = /** @type {HTMLElement | null} */ (panel.querySelector('.tw-close'));
      if (close) close.focus({ preventScroll: true });
    }

    function closePanel(focusHeader) {
      if (!panelOpen) return;
      panelOpen = false;
      clearTimeout(idleTimer);
      clearTimeout(messageTimer);
      root.classList.remove('tw-open');
      while (panel.firstChild) panel.removeChild(panel.firstChild);
      rows = [];
      panelKey = '';
      messageEl = null;
      core.render();
      const header = /** @type {HTMLElement | null} */ (root.querySelector('.tw-header'));
      if (focusHeader && header) header.focus({ preventScroll: true });
    }

    function touchPanel() {
      clearTimeout(idleTimer);
      if (panelOpen) idleTimer = setTimeout(() => closePanel(), IDLE_CLOSE_MS);
    }

    /** The settings the panel offers, all settable: power, the setpoint, then the mode and the other enums. */
    function controlCaps(state) {
      const usable = id => {
        const info = state.caps[id];
        if (!info || info.setable === false || id === 'measure_temperature') return false;
        return id === 'onoff' || id === 'target_temperature' || !!(info.values && info.values.length);
      };
      const mode = modeCap();
      const enums = Object.keys(state.caps).filter(id => id !== 'onoff' && id !== 'target_temperature' && usable(id));
      return ['onoff', 'target_temperature', ...enums.filter(id => id === mode), ...enums.filter(id => id !== mode)].filter(usable);
    }

    /** What a control shows: the value sent while it's pending, else the device's. */
    function shown(id) {
      const p = pending[id];
      if (p && Date.now() < p.until) return p.value;
      delete pending[id];
      const state = core.getState();
      return state ? state.values[id] : null;
    }

    /** Builds the rows (again when the name or the settings changed), then shows the values. */
    function buildPanel() {
      const state = core.getState();
      if (!panelOpen || !state) return;
      const ids = controlCaps(state);
      const key = `${state.name}|${ids.join()}`;
      if (key !== panelKey) {
        panelKey = key;
        while (panel.firstChild) panel.removeChild(panel.firstChild);
        const top = el('div', { class: 'tw-ctl-top' }, panel);
        el('div', { class: 'tw-ctl-name', dir: 'auto', text: state.name }, top);
        const close = el('button', { type: 'button', class: 'tw-close', 'aria-label': t('close') }, top);
        close.addEventListener('click', () => closePanel(true));
        rows = ids.map(id => (id === 'target_temperature' ? setpointRow(state.caps[id])
          : id === 'onoff' ? choiceRow(id, t('power'), [{ id: false, title: t('off') }, { id: true, title: t('on') }])
            : enumRow(id, state.caps[id])));
        messageEl = el('div', { class: 'tw-ctl-msg', dir: 'auto' }, panel);
        messageEl.style.display = 'none';
      }
      updatePanel();
    }

    function updatePanel() {
      if (!panelOpen) return;
      for (const r of rows) r.update();
      core.refreshHeight();
    }

    function rowNode(label) {
      const node = el('div', { class: 'tw-ctl-row' }, panel);
      el('div', { class: 'tw-ctl-label', dir: 'auto', text: label }, node);
      return node;
    }

    /** A segmented row: one button per value, the current one lit (the mode's in its colour). */
    function choiceRow(id, label, values) {
      const node = rowNode(label);
      const seg = el('div', { class: 'tw-row tw-ctl-seg' }, node);
      seg.style.setProperty('--tw-count', String(values.length));
      const isMode = id === modeCap();
      const buttons = values.map((v) => {
        const b = el('button', { type: 'button', class: 'tw-btn tw-seg' }, seg);
        el('span', { class: 'tw-big', dir: 'auto', text: v.title }, b);
        b.dataset.kind = v.id === false || /^off$/i.test(String(v.id)) ? 'off' : isMode ? modeKind(`${v.id} ${v.title}`) : 'other';
        b.addEventListener('click', () => send(id, v.id, node));
        return b;
      });
      const update = () => {
        const cur = shown(id);
        values.forEach((v, i) => buttons[i].classList.toggle('active', cur != null && sameValue(id, cur, v.id)));
      };
      return { id, node, update };
    }

    /** An enum with few values is segmented; with more, `‹ value ›` steps through them. */
    function enumRow(id, info) {
      if (info.values.length <= SEGMENTS_MAX) return choiceRow(id, info.title, info.values);
      const vals = info.values;
      const titleOf = v => {
        const x = vals.find(o => sameValue(id, o.id, v));
        return x ? x.title : v == null ? '–' : String(v);
      };
      const next = (cur, dir) => {
        const i = vals.findIndex(o => sameValue(id, o.id, cur));
        return vals[((i < 0 ? (dir > 0 ? -1 : 0) : i) + dir + vals.length) % vals.length].id;
      };
      return stepRow(id, info.title, '‹', '›', titleOf, next, () => [true, true]);
    }

    /** The target temperature: `− 21.5° +`, within the capability's range, by its step. */
    function setpointRow(info) {
      const step = info.step || 0.5;
      const decimals = (String(step).split('.')[1] || '').length;
      const min = typeof info.min === 'number' ? info.min : null;
      const max = typeof info.max === 'number' ? info.max : null;
      const clamp = v => Math.min(max == null ? Infinity : max, Math.max(min == null ? -Infinity : min, v));
      const next = (cur, dir) => {
        const base = typeof cur === 'number' ? Math.round(cur / step) * step : (min == null ? 20 : min);
        return clamp(Number((base + dir * step).toFixed(decimals)));
      };
      const enabled = cur => [typeof cur !== 'number' || min == null || cur > min + 1e-9,
        typeof cur !== 'number' || max == null || cur < max - 1e-9];
      return stepRow('target_temperature', info.title, '−', '+', v => (typeof v === 'number' ? temp(v) : '–'), next, enabled);
    }

    /** A stepper: two buttons around the value. The taps are sent together, `STEP_DELAY` after the last one. */
    function stepRow(id, label, less, more, text, next, enabled) {
      const node = rowNode(label);
      const seg = el('div', { class: 'tw-row tw-ctl-seg tw-ctl-step' }, node);
      const down = el('button', { type: 'button', class: 'tw-btn tw-seg', 'aria-label': `${label} ${less}` }, seg);
      el('span', { class: 'tw-big', text: less }, down);
      const valueEl = el('div', { class: 'tw-ctl-value', dir: 'auto' }, seg);
      const up = el('button', { type: 'button', class: 'tw-btn tw-seg', 'aria-label': `${label} ${more}` }, seg);
      el('span', { class: 'tw-big', text: more }, up);
      const update = () => {
        const cur = shown(id);
        valueEl.textContent = text(cur);
        const [canDown, canUp] = enabled(cur);
        down.disabled = !canDown;
        up.disabled = !canUp;
      };
      const tap = (dir) => {
        const value = next(shown(id), dir);
        pending[id] = { value, until: Date.now() + STEP_DELAY + PENDING_MS };
        update();
        clearTimeout(sendTimers[id]);
        sendTimers[id] = setTimeout(() => send(id, value, node), STEP_DELAY);
      };
      down.addEventListener('click', () => tap(-1));
      up.addEventListener('click', () => tap(1));
      return { id, node, update };
    }

    async function send(id, value, node) {
      clearTimeout(sendTimers[id]);
      pending[id] = { value, until: Date.now() + PENDING_MS };
      updatePanel();
      setTimeout(updatePanel, PENDING_MS + 50);
      try {
        await opts.onApply([{ capabilityId: id, value }]);
      } catch (err) {
        console.error(err);
        delete pending[id];
        node.classList.remove('shake');
        void node.offsetWidth; // restart the animation
        node.classList.add('shake');
        showPanelMessage(`${t('applyFailed')} ${(err && err.message) || ''}`.trim());
        updatePanel();
      }
    }

    function showPanelMessage(text) {
      if (!messageEl) return;
      clearTimeout(messageTimer);
      messageEl.textContent = text;
      messageEl.style.display = '';
      core.refreshHeight();
      messageTimer = setTimeout(() => {
        if (messageEl) messageEl.style.display = 'none';
        core.refreshHeight();
      }, MESSAGE_MS);
    }

    return {
      setButtons: core.setButtons, setState, pushChange, pushSensor, setMessage, render: core.render, t,
      openPanel, closePanel: () => closePanel(false),
    };
  }

  /** Turns the flat widget settings into three presets of capability values. */
  function presetsFromSettings(settings) {
    const out = [];
    for (const n of [1, 2, 3]) {
      const values = [];
      const power = settings[`b${n}Power`];
      if (power === 'on' || power === 'off') values.push({ slot: 'power', capabilityId: 'onoff', value: power === 'on' });
      // Mode first: some drivers check other values (like fan speed) against the current mode.
      for (const [slot, key] of [['mode', `b${n}Mode`], ['temp', `b${n}Temp`], ['extra', `b${n}Extra`]]) {
        const item = settings[key];
        if (item && item.capabilityId && !values.some(v => v.capabilityId === item.capabilityId)) {
          values.push({ slot, capabilityId: item.capabilityId, value: item.value, name: item.name });
        }
      }
      out.push({ values });
    }
    return out;
  }

  window.createThermostatWidget = createThermostatWidget;
  window.thermostatPresetsFromSettings = presetsFromSettings;
})();
