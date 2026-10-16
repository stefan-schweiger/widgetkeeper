/*
 * Thermostat Presets: a header with the device and three preset buttons. A button is
 * highlighted while the device's state matches its preset; when none matches, the header says
 * what the device is currently doing. The header, buttons and highlighting are the shared presets
 * module (presets.js, which Variable Presets loads too); this is the device model and its text.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const TEMP_TOLERANCE = 0.25;

  const DEFAULT_STRINGS = {
    selectDevice: 'Select a thermostat in the widget settings.',
    off: 'Off',
    on: 'On',
    currently: 'Currently __state__',
    currentlyOff: 'Currently off',
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
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string,
   *   onApply?: (values: {capabilityId: string, value: any}[]) => Promise<any>,
   *   onHeight?: (h: number) => void, layout?: string }} opts
   */
  function createThermostatWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`thermostat.${key}`, tokens) : null;
      if (s && s !== `thermostat.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const numberFmt = new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 1 });

    // The header, the buttons and which is lit; the device model below reads its state ({ name, icon, values, caps }).
    const core = window.WidgetkeeperPresets.create(root, {
      layout: opts.layout,
      onHeight: opts.onHeight,
      text: p => presetText(p),
      matches: (p, state) => presetMatches(state.values, deviceValues(p)),
      usable: p => deviceValues(p).length > 0,
      apply: opts.onApply ? p => opts.onApply(deviceValues(p)) : null,
      failed: err => `${t('applyFailed')} ${(err && err.message) || ''}`.trim(),
      current: () => currentText(),
    });

    function pushChange({ capabilityId, value }) {
      const state = core.getState();
      if (!state) return;
      state.values[capabilityId] = value;
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

    return { setButtons: core.setButtons, setState: core.setState, pushChange, setMessage: core.setMessage, render: core.render, t };
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
