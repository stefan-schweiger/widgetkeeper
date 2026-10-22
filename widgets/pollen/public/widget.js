/*
 * Pollen and UV: today's level of each chosen pollen type and the day's UV peak, from Open-Meteo's air-quality API (the
 * app's GET /pollen). Detailed adds the grains per m³ and the next three days. Plain browser JS (served as-is).
 */
(function () {
  const { el, applyColors, timeFormatter } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const SVG = 'http://www.w3.org/2000/svg';
  /** Open-Meteo's six, in the settings' order: trees, grass, weeds. */
  const TYPES = ['alder', 'birch', 'olive', 'grass', 'mugwort', 'ragweed'];
  /** Pollen levels 0 none … 4 very high, and UV levels 1 low … 5 extreme, by the same words. */
  const LEVEL_KEYS = ['none', 'low', 'moderate', 'high', 'veryHigh', 'extreme'];
  /** A pollen bar's steps: low … very high. */
  const STEPS = 4;

  /**
   * The icons: one path each on a 24 px grid, drawn for this widget like the kit's (2 px round stroke). Birch is a
   * twig with a catkin and a leaf, alder two little cones, olive a branch with an olive, grass an ear with blades,
   * mugwort its deeply cut leaf, ragweed a spike of flower heads over cut leaves.
   */
  const ICONS = {
    alder: 'M12 2.5V8.5M12 8.5 8.5 11.5M12 8.5 15.5 11.5M8.5 11.5C10.3 11.5 11.5 13.4 11.5 15.8S10.3 20.5 8.5 20.5 5.5 18.4 5.5 15.8 6.7 11.5 8.5 11.5ZM15.5 11.5C17.3 11.5 18.5 13.4 18.5 15.8S17.3 20.5 15.5 20.5 12.5 18.4 12.5 15.8 13.7 11.5 15.5 11.5ZM5.7 15.5H11.3M12.7 15.5H18.3',
    birch: 'M3 5.5C9 4.5 15 4.5 21 6M7.5 6.5C8.9 6.5 9.2 8 9.2 9.5V17.5C9.2 19.5 8.5 21 7.5 21S5.8 19.5 5.8 17.5V9.5C5.8 8 6.1 6.5 7.5 6.5ZM5.8 11 7.5 12.3 9.2 11M5.8 15 7.5 16.3 9.2 15M16 5.5C13.5 9.7 15.1 15.2 18.2 17.8C20.1 14.3 19.8 8.6 16 5.5ZM16 5.5 17.6 14.5',
    olive: 'M5 21C9 16 13 10 19 3M7.7 17.7C6 16.6 3.8 17.2 2.8 18.6C4.2 19.5 6.5 19.3 7.7 17.7ZM10.5 14C9.6 11.9 7.2 10.8 5.3 11C6 12.7 8.2 14.3 10.5 14ZM13.5 10C12.6 7.9 10.2 6.8 8.3 7C9 8.7 11.2 10.3 13.5 10ZM16.3 6.3C15.3 4.6 13.1 4 11.6 4.6C12.4 6 14.4 7 16.3 6.3ZM12 12 15 14.5M14.2 16.6a2.4 2.4 0 1 0 4.8 0a2.4 2.4 0 1 0-4.8 0',
    grass: 'M12 22V4M12 5C13 4 12.8 2.4 12 1.5C11.2 2.4 11 4 12 5ZM12 7.5C12 5.9 10.7 4.7 9.4 4.4C9.5 5.7 10.5 7.2 12 7.5ZM12 7.5C13.5 7.2 14.5 5.7 14.6 4.4C13.3 4.7 12 5.9 12 7.5ZM12 10.5C12 8.9 10.7 7.7 9.4 7.4C9.5 8.7 10.5 10.2 12 10.5ZM12 10.5C13.5 10.2 14.5 8.7 14.6 7.4C13.3 7.7 12 8.9 12 10.5ZM12 13.5C12 11.9 10.7 10.7 9.4 10.4C9.5 11.7 10.5 13.2 12 13.5ZM12 13.5C13.5 13.2 14.5 11.7 14.6 10.4C13.3 10.7 12 11.9 12 13.5ZM12 22C10.5 19.5 8 18 4.5 17.5M12 22C13.5 19.5 16 18.5 19.5 18.5',
    mugwort: 'M12 2.5 13.2 6 17.5 4.5 14 8.5 19.5 9 14 12 18.5 14.5 13 15.5 12 17 11 15.5 5.5 14.5 10 12 4.5 9 10 8.5 6.5 4.5 10.8 6ZM12 6.5V21.5',
    ragweed: 'M12 22V2.5M8.7 4a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0M13.1 6a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0M8.7 8a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0M13.1 10a1.1 1.1 0 1 0 2.2 0a1.1 1.1 0 1 0-2.2 0M12 18 5 15.5M7.6 16.4 6.8 14M9.4 17.1 9 19.5M12 18 19 15.5M16.4 16.4 17.2 14M14.6 17.1 15 19.5',
    sun: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0-8 0M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
  };

  const DEFAULT_STRINGS = {
    error: 'Could not load the pollen forecast.',
    noLocation: "Set Homey's location to see pollen and UV.",
    outside: 'Pollen forecasts only cover Europe.',
    season: 'No pollen in the air today.',
    nothingChosen: 'Choose what to show in the widget settings.',
    uv: 'UV __value__',
    peak: 'peak at __time__',
    now: 'now __value__',
    grains: '__value__ /m³',
    none: 'None',
    low: 'Low',
    moderate: 'Moderate',
    high: 'High',
    veryHigh: 'Very high',
    extreme: 'Extreme',
    alder: 'Alder',
    birch: 'Birch',
    olive: 'Olive',
    grass: 'Grass',
    mugwort: 'Mugwort',
    ragweed: 'Ragweed',
  };

  /**
   * The types to show, in the settings' order: `show<Type>` checkboxes, a missing one as its default (birch, grass and
   * mugwort on).
   * @param {Record<string, unknown>} settings
   */
  function pollenTypes(settings) {
    const on = { birch: true, grass: true, mugwort: true };
    return TYPES.filter((type) => {
      const v = settings[`show${type[0].toUpperCase()}${type.slice(1)}`];
      return typeof v === 'boolean' ? v : !!on[type];
    });
  }

  function icon(name, parent, cls) {
    const svg = el('svg', { class: `pw-icon ${cls || ''}`, viewBox: '0 0 24 24', 'aria-hidden': 'true' }, parent, SVG);
    el('path', { d: ICONS[name] }, svg, SVG);
    return svg;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, density?: string, types?: string[],
   *   showUv?: boolean, colorStyle?: string, timeFormat?: string, onHeight?: (h: number) => void }} opts
   */
  function createPollenWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`pollen.${key}`, tokens) : null;
      if (s && s !== `pollen.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const detailed = opts.density === 'detailed';
    const types = Array.isArray(opts.types) ? opts.types.filter(type => TYPES.includes(type)) : pollenTypes({});
    const showUv = opts.showUv !== false;

    root.classList.add('pw');
    root.classList.toggle('pw-detailed', detailed);
    applyColors(root, { style: opts.colorStyle });

    /** @type {any} */
    let data = null;
    let message = '';
    let lastHeight = 0;

    function setData(next) {
      data = next;
      message = '';
      render();
    }

    /** `keep`: a failed refresh keeps what's shown (only a failed first load shows the message alone). */
    function setMessage(text, keep = false) {
      if (keep && data) return;
      data = null;
      message = text;
      render();
    }

    function locale() {
      return opts.locale || (data && data.language) || undefined;
    }

    function number(v, digits = 0) {
      try { return new Intl.NumberFormat(locale(), { maximumFractionDigits: digits }).format(v); } catch (e) { return String(Math.round(v)); }
    }

    function weekday(date) {
      const d = new Date(`${date}T12:00:00Z`);
      try { return new Intl.DateTimeFormat(locale(), { weekday: 'short', timeZone: 'UTC' }).format(d); } catch (e) { return date.slice(5); }
    }

    /** No pollen of the chosen types today (and, in Detailed, none on the days after either). */
    function noPollen(days) {
      const shown = detailed ? days : days.slice(0, 1);
      return shown.every(day => types.every(type => !day.pollen[type] || day.pollen[type].level === 0));
    }

    function render() {
      while (root.firstChild) root.removeChild(root.firstChild);
      if (message || !data) {
        el('div', { class: 'pw-message', dir: 'auto', text: message || t('error') }, root);
      } else if (data.noLocation) {
        el('div', { class: 'pw-message', dir: 'auto', text: t('noLocation') }, root);
      } else if (!showUv && !types.length) {
        el('div', { class: 'pw-message', dir: 'auto', text: t('nothingChosen') }, root);
      } else {
        renderData();
      }
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    function renderData() {
      const days = Array.isArray(data.days) ? data.days : [];
      const today = days[0];
      if (!today) {
        el('div', { class: 'pw-message', dir: 'auto', text: t('error') }, root);
        return;
      }
      if (showUv && today.uv) renderUv(today.uv);
      if (!types.length) return;
      if (showUv && today.uv) el('div', { class: 'pw-sep' }, root);
      if (data.outside || noPollen(days)) {
        el('div', { class: 'pw-note', dir: 'auto', text: t(data.outside ? 'outside' : 'season') }, root);
        return;
      }
      const rows = el('div', { class: 'pw-rows' }, root);
      for (const type of types) renderRow(rows, type, today.pollen[type]);
      if (detailed && days.length > 1) renderDays(days.slice(1, 4));
    }

    function renderUv(uv) {
      const line = el('div', { class: 'pw-uv', 'data-level': String(uv.level) }, root);
      icon('sun', line, 'pw-sun');
      el('span', { class: 'pw-uv-value', dir: 'auto', text: t('uv', { value: number(uv.max) }) }, line);
      el('span', { class: 'pw-uv-level', dir: 'auto', text: t(LEVEL_KEYS[uv.level]) }, line);
      let rest = t('peak', { time: timeFormatter(opts.locale, opts.timeFormat).format(new Date(uv.at)) });
      if (detailed && typeof data.uvNow === 'number') rest += ` · ${t('now', { value: number(data.uvNow) })}`;
      el('span', { class: 'pw-uv-peak', dir: 'auto', text: `· ${rest}` }, line);
    }

    function renderRow(parent, type, entry) {
      const level = entry ? entry.level : 0;
      const row = el('div', { class: 'pw-row', 'data-type': type, 'data-level': String(level) }, parent);
      icon(type, row);
      el('span', { class: 'pw-name', dir: 'auto', text: t(type) }, row);
      const bar = el('div', { class: 'pw-bar' }, row);
      for (let i = 0; i < STEPS; i++) el('i', { class: i < level ? 'on' : null }, bar);
      const end = el('div', { class: 'pw-level' }, row);
      el('span', { class: 'pw-word', dir: 'auto', text: entry ? t(LEVEL_KEYS[level]) : '–' }, end);
      if (detailed && level) el('span', { class: 'pw-grains', dir: 'auto', text: t('grains', { value: number(entry.value) }) }, end);
    }

    /** The next days: a column each, a row per type (its level), and the day's UV peak. */
    function renderDays(days) {
      const grid = el('div', { class: 'pw-days' }, root);
      grid.style.setProperty('--pw-cols', String(days.length));
      el('span', {}, grid);
      for (const day of days) el('span', { class: 'pw-day', dir: 'auto', text: weekday(day.date) }, grid);
      for (const type of types) {
        icon(type, el('span', { class: 'pw-days-icon', title: t(type) }, grid));
        for (const day of days) {
          const entry = day.pollen[type];
          const level = entry ? entry.level : 0;
          el('span', { class: 'pw-cell', 'data-level': String(level), dir: 'auto', text: level ? t(LEVEL_KEYS[level]) : '–' }, grid);
        }
      }
      if (!showUv) return;
      icon('sun', el('span', { class: 'pw-days-icon', title: t('uv', { value: '' }).trim() }, grid));
      for (const day of days) {
        el('span', { class: 'pw-cell pw-cell-uv', 'data-level': String(day.uv ? day.uv.level : 0), text: day.uv ? number(day.uv.max) : '–' }, grid);
      }
    }

    render();
    return { setData, setMessage, render, t };
  }

  window.createPollenWidget = createPollenWidget;
  window.pollenTypes = pollenTypes;
})();
