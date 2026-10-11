/*
 * Clock: the time and the date, and optionally the weather now (MET's icon and the temperature) with today's high
 * and low. The time follows the screen's locale (24 or 12 hours), the date Homey's language.
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const MINUTE = 60e3;

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

  /** A whole degree, without a minus on zero. */
  function degrees(v) {
    const r = Math.round(v);
    return `${r === 0 ? 0 : r}°`;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ locale?: string, showWeather?: boolean, iconBase?: string, now?: () => number,
   *   onHeight?: (h: number) => void }} opts
   */
  function createClockWidget(root, opts = {}) {
    const clock = opts.now || (() => Date.now());
    // The Weather Forecast's icons, served next to this widget (only used when the app sent no SVG).
    const iconBase = opts.iconBase != null ? opts.iconBase : '../weather/icons/';
    const showWeather = opts.showWeather !== false;

    let language = null;
    let weather = null; // {symbol, temp, high, low, icon}
    let tickTimer = null;
    let iconSymbol;

    let timeFormat = null;
    const dateFormats = {};
    /** Hours and minutes in the screen's locale, which picks 24 or 12 hours; 24 hours always with two digits (`07:05`). */
    function formatTime(ms) {
      if (!timeFormat) {
        const o = /** @type {Intl.DateTimeFormatOptions} */ ({ hour: 'numeric', minute: '2-digit' });
        let locale = opts.locale || undefined;
        try { timeFormat = new Intl.DateTimeFormat(locale, o); } catch { locale = 'en'; timeFormat = new Intl.DateTimeFormat(locale, o); }
        if (timeFormat.resolvedOptions().hour12 === false) timeFormat = new Intl.DateTimeFormat(locale, { ...o, hour: '2-digit' });
      }
      return timeFormat.format(new Date(ms));
    }
    /** The screen's region (`DK` from `da-DK`), or null. */
    function region() {
      try { return new Intl.Locale(opts.locale || navigator.language).region || null; } catch { return null; }
    }
    /**
     * The weekday, day and month in Homey's language, in the order of the screen's region: `en` alone is American
     * (`Tuesday, October 6`), but an English Homey on a Danish phone reads `Tuesday, 6 October`.
     */
    function formatDate(ms) {
      const lang = language || 'en';
      if (!dateFormats[lang]) {
        const o = /** @type {Intl.DateTimeFormatOptions} */ ({ weekday: 'long', day: 'numeric', month: 'long' });
        const r = region();
        for (const tag of [r ? `${lang}-${r}` : null, lang, r ? `en-${r}` : null, 'en']) {
          if (!tag) continue;
          try { dateFormats[lang] = new Intl.DateTimeFormat(tag, o); break; } catch { /* the next one */ }
        }
      }
      return dateFormats[lang].format(new Date(ms));
    }

    root.classList.add('ck');
    const tile = el('div', { class: 'ck-tile' }, root);
    const when = el('div', { class: 'ck-when' }, tile);
    const timeEl = el('div', { class: 'ck-time', dir: 'auto' }, when);
    const dateEl = el('div', { class: 'ck-date', dir: 'auto' }, when);
    const weatherEl = el('div', { class: 'ck-weather' }, tile);
    const nowEl = el('div', { class: 'ck-now' }, weatherEl);
    const iconEl = el('img', { class: 'ck-icon', alt: '' }, nowEl);
    const tempEl = el('span', { class: 'ck-temp' }, nowEl);
    const rangeEl = el('div', { class: 'ck-range' }, weatherEl);
    const highEl = el('span', { class: 'ck-high' }, rangeEl);
    const lowEl = el('span', { class: 'ck-low' }, rangeEl);

    /** `/clock`'s answer: `{language, weather}`. */
    function setState(state) {
      if (!state) return;
      if (state.language) language = state.language;
      if ('weather' in state) {
        const w = state.weather;
        weather = w && !w.noLocation && typeof w.temp === 'number' ? w : null;
      }
      render();
    }

    function renderWeather() {
      const w = showWeather ? weather : null;
      weatherEl.style.display = w ? '' : 'none';
      if (!w) return;
      if (w.symbol !== iconSymbol) {
        iconSymbol = w.symbol;
        if (w.symbol) iconEl.src = w.icon ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(w.icon)}` : `${iconBase}${w.symbol}.svg`;
        else iconEl.removeAttribute('src');
        iconEl.style.display = w.symbol ? '' : 'none';
      }
      tempEl.textContent = degrees(w.temp);
      const range = typeof w.high === 'number' && typeof w.low === 'number';
      rangeEl.style.display = range ? '' : 'none';
      if (range) {
        highEl.textContent = `↑${degrees(w.high)}`;
        lowEl.textContent = `↓${degrees(w.low)}`;
      }
    }

    let lastHeight = 0;
    function render() {
      const now = clock();
      timeEl.textContent = formatTime(now);
      dateEl.textContent = formatDate(now);
      renderWeather();
      schedule(now);
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    /** Re-renders just after the minute turns. */
    function schedule(now) {
      if (tickTimer) clearTimeout(tickTimer);
      tickTimer = setTimeout(render, Math.floor(now / MINUTE) * MINUTE + MINUTE - now + 50);
    }

    render();
    return { setState, render };
  }

  window.createClockWidget = createClockWidget;
})();
