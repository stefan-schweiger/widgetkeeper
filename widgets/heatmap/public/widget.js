/*
 * Insights Heatmap: one capability's last week as weekday rows × hour columns, shaded from the
 * lowest to the highest value shown, with a scale and a legend. Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const LEVELS = 5;
  const AXIS_HOURS = [0, 6, 12, 18, 24];

  const DEFAULT_STRINGS = {
    selectDevice: 'Select a device and a value in the widget settings.',
    error: 'Could not load the history.',
    now: '__value__ now',
    activeNow: 'Active now',
    inactiveNow: 'Inactive now',
    less: 'Less',
    more: 'More',
    nothing: 'Nothing reported',
  };

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

  /** `date` (YYYY-MM-DD) plus `n` days. */
  function addDays(date, n) {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  }

  /**
   * The `period` setting: `week` (Monday to Sunday), or the last 3, 7 (`rolling`, its original id), 10 or
   * 14 days. Returns the number of days to show and to ask the app for.
   * @param {string} period
   */
  function periodDays(period) {
    if (period === 'week' || period === 'rolling' || period == null) return 7;
    const n = Number(period);
    return [3, 7, 10, 14].includes(n) ? n : 7;
  }

  /**
   * The rows to show. `days` are the service's local days ending today (7 or 14). `week`: Monday to
   * Sunday of the current week, with the days still to come empty; otherwise the last `count` days.
   * @param {{date: string, weekday: number, hours: (number|null)[]}[]} days
   * @param {string} period
   */
  function arrangeRows(days, period) {
    if (period !== 'week') return days.slice(-periodDays(period));
    if (!days.length) return days;
    const today = days[days.length - 1];
    const sinceMonday = (today.weekday + 6) % 7;
    const rows = [];
    for (let r = 0; r < 7; r++) {
      const back = sinceMonday - r;
      if (back >= 0) rows.push(days[days.length - 1 - back]);
      else rows.push({ date: addDays(today.date, -back), weekday: (today.weekday - back) % 7, hours: new Array(24).fill(null) });
    }
    return rows;
  }

  /** 24 hourly values → 24/step columns, each the average of its reported hours (`null` if none). */
  function mergeHours(hours, step) {
    const out = [];
    for (let h = 0; h < 24; h += step) {
      const vals = hours.slice(h, h + step).filter(v => v != null && Number.isFinite(v));
      out.push(vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null);
    }
    return out;
  }

  /**
   * 0 … LEVELS-1, evenly between `min` and `max`; the middle level when they're equal,
   * except an on/off value that was never on (`fromZero` and all 0 %), which is the lowest.
   */
  function level(v, min, max, fromZero) {
    if (!(max > min)) return fromZero && max === 0 ? 0 : Math.floor(LEVELS / 2);
    return Math.min(LEVELS - 1, Math.floor(((v - min) / (max - min)) * LEVELS));
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string,
   *   period?: string, step?: number, showScale?: boolean, showLegend?: boolean,
   *   onHeight?: (h: number) => void }} opts
   */
  function createHeatmapWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`heatmap.${key}`, tokens) : null;
      if (s && s !== `heatmap.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const period = opts.period == null ? 'week' : String(opts.period);
    const step = [1, 2, 3].includes(Number(opts.step)) ? Number(opts.step) : 2;
    const cols = 24 / step;
    const showScale = opts.showScale !== false;
    const showLegend = opts.showLegend !== false;

    let data = null;
    let messageText = null;
    let messageTimer = null;
    let lastHeight = 0;

    root.classList.add('hm');
    root.style.setProperty('--hm-cols', String(cols));
    root.classList.toggle('hm-dense', step === 1);
    const header = el('div', { class: 'hm-header' }, root);
    const iconBox = el('div', { class: 'hm-icon' }, header);
    const titles = el('div', { class: 'hm-titles' }, header);
    const nameEl = el('div', { class: 'hm-name', dir: 'auto' }, titles);
    const subEl = el('div', { class: 'hm-sub', dir: 'auto' }, titles);
    const body = el('div', { class: 'hm-body' }, root);

    function setData(d) {
      data = d;
      messageText = null;
      render();
    }

    /** A message in place of the subtitle. Persistent messages also clear the data. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else data = null;
      render();
    }

    function numberFormat(cap, v, min, max) {
      if (cap.type === 'boolean') {
        return new Intl.NumberFormat(opts.locale, { style: 'percent', maximumFractionDigits: 0 }).format(v);
      }
      // Small ranges keep a decimal (5.2 lx, 21.5 °C); large ones don't (1 250 W).
      const span = Math.max(Math.abs(min), Math.abs(max));
      const digits = span < 100 ? 1 : 0;
      const n = new Intl.NumberFormat(opts.locale, { maximumFractionDigits: digits }).format(v);
      return cap.units ? `${n} ${cap.units}` : n;
    }

    /** `Mon`, or with the day of the month (in the language's order) when weekdays repeat (more than 7 rows). */
    function weekdayName(date, withDay) {
      const lang = (data && data.language) || opts.locale;
      /** @type {Intl.DateTimeFormatOptions} */
      const fmt = withDay ? { weekday: 'short', day: 'numeric', timeZone: 'UTC' } : { weekday: 'short', timeZone: 'UTC' };
      try {
        return new Intl.DateTimeFormat(lang, fmt).format(new Date(`${date}T00:00:00Z`));
      } catch (e) {
        return new Intl.DateTimeFormat(undefined, fmt).format(new Date(`${date}T00:00:00Z`));
      }
    }

    function render() {
      nameEl.textContent = data ? data.name : '';
      nameEl.style.display = data ? '' : 'none';
      const sub = messageText || (data ? data.capability.title : '');
      subEl.textContent = sub;
      subEl.classList.toggle('error', !!messageText && !!data);
      header.classList.toggle('message-only', !data);
      iconBox.style.display = data ? '' : 'none';
      if (data && data.icon) {
        iconBox.classList.remove('fallback');
        iconBox.style.setProperty('--hm-icon', `url("${data.icon}")`);
      } else {
        iconBox.classList.add('fallback');
      }

      while (body.firstChild) body.removeChild(body.firstChild);
      body.style.display = data ? '' : 'none';
      if (data) renderBody();

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    function renderBody() {
      const cap = data.capability;
      const rows = arrangeRows(data.days || [], period).map(d => ({ ...d, cells: mergeHours(d.hours, step) }));
      const values = rows.flatMap(r => r.cells).filter(v => v != null);
      // On/off shares start at 0 %: otherwise an hour with a little motion would read as "less" than nothing.
      const min = !values.length ? null : cap.type === 'boolean' ? 0 : Math.min(...values);
      const max = values.length ? Math.max(...values) : null;

      const withDay = rows.length > 7;
      const grid = el('div', { class: 'hm-grid' }, body);
      for (const row of rows) {
        el('div', { class: 'hm-day', dir: 'auto', text: weekdayName(row.date, withDay) }, grid);
        const cells = el('div', { class: 'hm-cells' }, grid);
        row.cells.forEach((v, i) => {
          const c = el('div', { class: v == null ? 'hm-cell none' : `hm-cell l${level(v, min, max, cap.type === 'boolean')}` }, cells);
          const from = String(i * step).padStart(2, '0');
          c.title = `${weekdayName(row.date, true)} ${from}:00${v == null ? '' : ` · ${numberFormat(cap, v, min, max)}`}`;
        });
      }
      el('div', {}, grid);
      const axis = el('div', { class: 'hm-axis' }, grid);
      for (const h of AXIS_HOURS) {
        const label = el('span', { text: String(h).padStart(2, '0') }, axis);
        label.style.left = `${(h / 24) * 100}%`;
        if (h === 0) label.classList.add('start');
        if (h === 24) label.classList.add('end');
      }

      if (showScale && min != null) renderScale(cap, min, max);
      if (showLegend) renderLegend();
    }

    function renderScale(cap, min, max) {
      const scale = el('div', { class: 'hm-scale' }, body);
      el('span', { class: 'hm-scale-end', text: numberFormat(cap, min, min, max) }, scale);
      const track = el('div', { class: 'hm-track' }, scale);
      el('div', { class: 'hm-bar' }, track);
      el('span', { class: 'hm-scale-end', text: numberFormat(cap, max, min, max) }, scale);

      const v = data.value;
      if (cap.type === 'boolean' && typeof v === 'boolean') {
        el('span', { class: 'hm-now center', dir: 'auto', text: t(v ? 'activeNow' : 'inactiveNow') }, track);
      } else if (typeof v === 'number' && Number.isFinite(v)) {
        const pos = max > min ? Math.min(1, Math.max(0, (v - min) / (max - min))) : 0.5;
        const marker = el('div', { class: 'hm-marker' }, track);
        marker.style.left = `${pos * 100}%`;
        const label = el('span', { class: 'hm-now', dir: 'auto', text: t('now', { value: numberFormat(cap, v, min, max) }) }, track);
        label.style.left = `${pos * 100}%`;
        // Kept inside the track at the ends.
        label.classList.toggle('start', pos < 0.2);
        label.classList.toggle('end', pos > 0.8);
      }
    }

    function renderLegend() {
      const legend = el('div', { class: 'hm-legend' }, body);
      const scale = el('div', { class: 'hm-legend-group' }, legend);
      el('span', { dir: 'auto', text: t('less') }, scale);
      for (let i = 0; i < LEVELS; i++) el('span', { class: `hm-swatch l${i}` }, scale);
      el('span', { dir: 'auto', text: t('more') }, scale);
      const none = el('div', { class: 'hm-legend-group' }, legend);
      el('span', { class: 'hm-swatch none' }, none);
      el('span', { dir: 'auto', text: t('nothing') }, none);
    }

    render();
    return { setData, setMessage, render, t };
  }

  window.createHeatmapWidget = createHeatmapWidget;
  window.heatmapPeriodDays = periodDays;
})();
