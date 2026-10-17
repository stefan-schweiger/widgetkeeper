/*
 * Variable Presets: one Logic variable and 2–4 buttons that set it to preset values, laid out as Thermostat
 * Presets: its presets module (presets.js and presets.css, loaded from ../thermostat/) draws the header and the
 * buttons and lights the one whose value the variable has; when none matches, the header says what the variable
 * is. Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const DEFAULT_STRINGS = {
    selectVariable: 'Pick a variable in the widget settings.',
    noPresets: 'Pick the buttons’ values in the widget settings.',
    missing: 'Variable not found',
    error: 'Could not load the variable.',
    failed: 'Could not change __name__.',
    currently: 'Currently __value__',
    yes: 'Yes',
    no: 'No',
    noKey: 'To change variables, add an API key in the app settings.',
    keyScope: 'The API key may not change variables: it needs Variables.',
    keyInvalid: 'The API key was not accepted.',
  };

  const KEY_PROBLEMS = ['noKey', 'keyScope', 'keyInvalid'];

  /** The lit button's colour: Device Values' Flow colours (the `color` setting). */
  const COLORS = ['blue', 'red', 'orange', 'yellow', 'green', 'purple'];

  /** A variable's types; `typeof` a value of each is the type's name. */
  const TYPES = ['boolean', 'number', 'string'];

  /** The header's optional icon: Flow Buttons' (the kit's; the `icon` setting lists them, listIcons()). */
  const ICONS = window.WidgetkeeperKit.icons;

  /**
   * An icon as a data URL, for the header's masked icon box (the shape is all a mask uses). A thinner stroke than
   * Flow Buttons' 2 px, and a little room around it, so it reads like the device icons beside Thermostat Presets' names.
   */
  function iconUrl(icon) {
    const path = `<path d="${icon.d}" fill="${icon.fill ? '#000' : 'none'}" stroke="#000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-1 -1 26 26">${path}</svg>`)}`;
  }

  /** The variable has a button's value: numbers within floating-point noise (0.1 + 0.2), the rest exactly. */
  function sameValue(a, b) {
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
    return a === b;
  }

  /**
   * The buttons from the widget settings: each `valueN` choice (the autocomplete item keeps its `value` and `type`)
   * with its `labelN`. Empty buttons and `None` are left out.
   * @returns {{ value: boolean | number | string, type: string, label: string }[]}
   */
  function presetsFromSettings(settings) {
    const out = [];
    for (const n of [1, 2, 3, 4]) {
      const item = settings && settings[`value${n}`];
      if (!item || typeof item !== 'object' || item.id === 'none' || !TYPES.includes(item.type)) continue;
      if (typeof item.value !== item.type || (item.type === 'number' && !isFinite(item.value))) continue;
      const label = settings[`label${n}`];
      out.push({ value: item.value, type: item.type, label: typeof label === 'string' ? label.trim() : '' });
    }
    return out;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, layout?: string, color?: string,
   *   icon?: string, title?: string, onSet?: (value: boolean | number | string) => Promise<any>,
   *   onHeight?: (h: number) => void }} opts
   */
  function createVarPresetsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`varpresets.${key}`, tokens) : null;
      if (s && s !== `varpresets.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const numberFmt = new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 3 });
    const title = typeof opts.title === 'string' ? opts.title.trim() : '';
    const icon = typeof opts.icon === 'string' && Object.prototype.hasOwnProperty.call(ICONS, opts.icon) ? iconUrl(ICONS[opts.icon]) : null;

    let presets = []; // from the settings
    let variable = null; // { id, name, type, value }
    let shownKey = null; // the buttons on screen, so a refresh with the same ones keeps them (and a lit tap)

    root.classList.add('vp');
    root.dataset.color = COLORS.includes(opts.color) ? opts.color : 'blue';

    const core = window.WidgetkeeperPresets.create(root, {
      layout: opts.layout,
      fallbackIcon: false,
      onHeight: opts.onHeight,
      text: p => ({ big: p.label || valueText(p.value) }),
      matches: (p, s) => sameValue(s.variable.value, p.value),
      apply: opts.onSet ? p => opts.onSet(p.value) : null,
      failed: err => (err && KEY_PROBLEMS.includes(err.reason) ? t(err.reason) : t('failed', { name: headerName() })),
      current: s => t('currently', { value: valueText(s.variable.value) }),
    });

    function valueText(v) {
      if (typeof v === 'boolean') return v ? t('yes') : t('no');
      if (typeof v === 'number' && isFinite(v)) return numberFmt.format(v);
      return typeof v === 'string' && v !== '' ? v : '–';
    }

    function headerName() {
      return title || (variable ? variable.name : '');
    }

    /**
     * The buttons for the variable: the presets of its type (a preset picked for another variable is left out). A
     * yes/no variable without any gets Yes and No. Before the variable is known: every preset, disabled.
     */
    function buttons() {
      if (!variable) return presets;
      const own = presets.filter(p => p.type === variable.type);
      if (own.length || variable.type !== 'boolean' || presets.length) return own;
      return [true, false].map(value => ({ value, type: 'boolean', label: '' }));
    }

    function sync() {
      const list = buttons();
      const key = JSON.stringify(list);
      if (key !== shownKey) {
        shownKey = key;
        core.setButtons(list);
      }
      return list;
    }

    function setPresets(list) {
      presets = list;
      sync();
    }

    /** The variable, `{id, name, type, value}`; a deleted one is the mount's (a persistent `missing`). */
    function setState(v) {
      variable = v;
      if (!sync().length) core.setMessage(t('noPresets'));
      else core.setState({ name: headerName(), icon, variable });
    }

    /** A `variables:state` event for this variable (the service's copy of it). */
    function pushChange(v) {
      if (!variable || !v || v.id !== variable.id) return;
      setState({ ...variable, ...v });
    }

    return { setPresets, setState, pushChange, setMessage: core.setMessage, render: core.render, t };
  }

  window.createVarPresetsWidget = createVarPresetsWidget;
  window.varPresetsFromSettings = presetsFromSettings;
})();
