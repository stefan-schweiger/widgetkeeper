/*
 * Weather Forecast: hourly columns (icon, temperature, precipitation, wind) for the next 36 hours,
 * from MET Norway via the app, in a horizontally scrolling strip. With two rows, the hours are laid out
 * in pages of two rows that scroll a page at a time. Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const SHOWN_HOURS = 36;
  const HOUR = 3600e3;

  const DEFAULT_STRINGS = {
    now: 'Now',
    error: 'Could not load the forecast.',
    noLocation: 'Set Homey\'s location to see the forecast.',
    today: 'Today',
    tomorrow: 'Tomorrow',
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

  // Temperature colour: the text colour at NEUTRAL, blending to full blue at COLD and full red at HOT.
  const NEUTRAL = 12;
  const COLD = -5;
  const HOT = 28;

  /** Colours a temperature element: a `cold`/`warm` class and how far (`--k`, 0-1) towards blue or red. */
  function colorTemp(node, r) {
    const warm = r > NEUTRAL;
    const k = warm ? (r - NEUTRAL) / (HOT - NEUTRAL) : (NEUTRAL - r) / (NEUTRAL - COLD);
    node.classList.add(warm ? 'warm' : 'cold');
    node.style.setProperty('--k', String(Math.round(Math.min(1, k) * 100) / 100));
  }

  const SVG_NS = 'http://www.w3.org/2000/svg';

  /** A small arrow pointing up; rotated to where the wind blows. */
  function windArrow(parent) {
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('class', 'wf-arrow');
    svg.setAttribute('viewBox', '0 0 10 10');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', 'M5 0.5 L9 9 L5 7 L1 9 Z');
    svg.appendChild(path);
    parent.appendChild(svg);
    return svg;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, iconBase?: string,
   *   density?: 'compact' | 'detailed', rows?: number | string, step?: number | string,
   *   now?: () => number, onHeight?: (h: number) => void }} opts
   */
  function createWeatherWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`weather.${key}`, tokens) : null;
      if (s && s !== `weather.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const now = opts.now || (() => Date.now());
    const iconBase = opts.iconBase != null ? opts.iconBase : 'icons/';
    const intFmt = new Intl.NumberFormat(opts.locale, { maximumFractionDigits: 0 });
    const mmFmt = new Intl.NumberFormat(opts.locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    let weekdayFmt = new Intl.DateTimeFormat(opts.locale, { weekday: 'short' });
    // Compact (the default) fits about twice the hours: smaller icons and text, units only in the footer.
    const compact = opts.density !== 'detailed';
    const rows = Number(opts.rows) === 2 ? 2 : 1;
    // Hours per column: 1, or 2 or 3 with the hours combined (see combine()).
    const step = [2, 3].includes(Number(opts.step)) ? Number(opts.step) : 1;

    let hours = [];
    let icons = {}; // symbol → SVG text, sent with the forecast
    const iconUrls = {}; // symbol → data URL, kept across refreshes
    let message = null;
    let lastKey = null; // what's rendered, so an unchanged refresh doesn't rebuild the strip
    let hourTimer = null;
    let lastHeight = 0;

    root.classList.add('wf', compact ? 'wf-compact' : 'wf-detailed');
    if (rows === 2) root.classList.add('wf-paged');
    // The strip stays the same element across renders, so its scroll position survives.
    const strip = el('div', { class: 'wf-strip' }, root);
    const messageEl = el('div', { class: 'wf-message', dir: 'auto' }, root);
    const footer = el('div', { class: 'wf-footer' }, root);
    // Today's (the rest of it) and tomorrow's high and low.
    const summary = el('span', { class: 'wf-summary' }, footer);
    if (compact) el('span', { class: 'wf-units', text: 'mm · m/s' }, footer);

    // Two rows: a page holds two rows of as many columns as the width shows (set in CSS), so a
    // width change can need a different split.
    let pageCols = 0;
    if (rows === 2 && typeof ResizeObserver === 'function') {
      new ResizeObserver(() => { if (columns() !== pageCols) render(); }).observe(strip);
    }

    strip.addEventListener('scroll', updateEdges, { passive: true });
    enableMouseDrag(strip);

    /** `data`: the app's `/forecast` response. */
    function setForecast(data) {
      message = null;
      if (data && data.language) {
        try { weekdayFmt = new Intl.DateTimeFormat(data.language, { weekday: 'short' }); } catch (e) { /* keep the default */ }
      }
      if (data && data.noLocation) {
        hours = [];
        message = t('noLocation');
      } else {
        hours = (data && Array.isArray(data.hours)) ? data.hours : [];
      }
      icons = (data && data.icons) || {};
      render();
    }

    function setMessage(text) {
      message = text;
      hours = [];
      render();
    }

    function visibleHours() {
      const from = Math.floor(now() / HOUR) * HOUR;
      return hours.filter(h => Date.parse(h.t) >= from).slice(0, SHOWN_HOURS);
    }

    /** Columns per screen, from the CSS (`--wf-cols`, which depends on the widget's width). */
    function columns() {
      const n = parseInt(getComputedStyle(strip).getPropertyValue('--wf-cols'), 10);
      return n > 0 ? n : (compact ? 9 : 5);
    }

    function render() {
      const list = message ? [] : group(visibleHours());
      // The widget refetches every 5 min, mostly getting the same forecast back.
      const key = JSON.stringify([message, hours, Math.floor(now() / HOUR), rows === 2 ? columns() : 0]);
      if (key === lastKey) {
        scheduleHourTick();
        return;
      }
      lastKey = key;
      const scrollLeft = strip.scrollLeft;
      while (strip.firstChild) strip.removeChild(strip.firstChild);
      if (rows === 2) {
        pageCols = columns();
        let page = null;
        list.forEach((h, i) => {
          if (i % (pageCols * 2) === 0) page = el('div', { class: 'wf-page' }, strip);
          renderHour(h, i, page);
        });
      } else {
        list.forEach((h, i) => renderHour(h, i, strip));
      }
      strip.hidden = !list.length;
      messageEl.hidden = !message;
      messageEl.textContent = message || '';
      renderSummary();
      footer.hidden = !list.length;
      strip.scrollLeft = scrollLeft;
      updateEdges();
      scheduleHourTick();
      reportHeight();
    }

    /**
     * Columns of `step` hours, on the clock (with 3: 00, 03, 06 …). The first column runs from the
     * current hour to the next boundary, so it can be shorter.
     */
    function group(list) {
      if (step === 1) return list;
      const out = [];
      let cur = [];
      for (const h of list) {
        if (cur.length && new Date(h.t).getHours() % step === 0) {
          out.push(combine(cur));
          cur = [];
        }
        cur.push(h);
      }
      if (cur.length) out.push(combine(cur));
      return out;
    }

    /**
     * Averages the temperature and wind speed, sums the precipitation, averages the wind direction
     * weighted by speed, and takes the icon of the wettest hour (the first one when it's dry).
     */
    function combine(hs) {
      const avg = (key) => {
        const v = hs.map(h => h[key]).filter(x => x != null);
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
      };
      const precips = hs.map(h => h.precip).filter(x => x != null);
      let x = 0;
      let y = 0;
      for (const h of hs) {
        if (h.windDir == null || h.wind == null) continue;
        const r = h.windDir * Math.PI / 180;
        x += Math.sin(r) * h.wind;
        y += Math.cos(r) * h.wind;
      }
      const wettest = hs.reduce((a, b) => ((b.precip || 0) > (a.precip || 0) ? b : a), hs[0]);
      return {
        t: hs[0].t,
        symbol: wettest.symbol || hs[0].symbol,
        temp: avg('temp'),
        wind: avg('wind'),
        windDir: x || y ? Math.round(Math.atan2(x, y) * 180 / Math.PI + 360) % 360 : null,
        precip: precips.length ? precips.reduce((a, b) => a + b, 0) : null,
      };
    }

    function renderHour(h, i, parent) {
      const date = new Date(h.t);
      const midnight = date.getHours() === 0;
      const col = el('div', { class: `wf-col${midnight && i > 0 ? ' wf-newday' : ''}`, 'data-t': h.t }, parent);
      const label = i === 0 ? t('now') : midnight ? weekdayFmt.format(date) : String(date.getHours()).padStart(2, '0');
      el('div', { class: `wf-hour${i === 0 || midnight ? ' strong' : ''}`, dir: 'auto', text: label }, col);
      const iconBox = el('div', { class: 'wf-icon' }, col);
      if (h.symbol && /^[a-z_]+$/.test(h.symbol)) {
        const img = el('img', { src: iconSrc(h.symbol), alt: '', draggable: 'false' }, iconBox);
        img.addEventListener('error', () => img.remove(), { once: true });
      }
      const temp = el('div', { class: 'wf-temp' }, col);
      if (h.temp != null) {
        const rounded = Math.round(h.temp);
        temp.textContent = `${intFmt.format(rounded === 0 ? 0 : rounded)}°`;
        colorTemp(temp, rounded);
      }
      el('div', { class: 'wf-precip', text: h.precip > 0 ? `${mmFmt.format(h.precip)}${compact ? '' : ' mm'}` : '' }, col);
      const wind = el('div', { class: 'wf-wind' }, col);
      if (h.wind != null) {
        if (h.windDir != null && h.wind >= 0.5) {
          // MET gives where the wind comes from; the arrow shows where it blows.
          windArrow(wind).style.transform = `rotate(${(h.windDir + 180) % 360}deg)`;
        }
        el('span', { text: `${intFmt.format(Math.round(h.wind))}${compact ? '' : ' m/s'}` }, wind);
      }
    }

    /** High and low per local day, from all the hours the app sent (today from the current hour). */
    function renderSummary() {
      while (summary.firstChild) summary.removeChild(summary.firstChild);
      if (message) return;
      const from = Math.floor(now() / HOUR) * HOUR;
      const today = new Date(from);
      today.setHours(0, 0, 0, 0);
      const days = [[t('today'), today.getTime()], [t('tomorrow'), new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1).getTime()]];
      const dayAfter = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 2).getTime();
      days.forEach(([label, start], i) => {
        const end = i === 0 ? days[1][1] : dayAfter;
        const temps = hours
          .filter(h => h.temp != null && Date.parse(h.t) >= Math.max(from, start) && Date.parse(h.t) < end)
          .map(h => Math.round(h.temp));
        if (!temps.length) return;
        const day = el('span', { class: 'wf-day' }, summary);
        el('span', { class: 'wf-day-label', dir: 'auto', text: label }, day);
        tempRange(day, Math.max(...temps), '↑');
        tempRange(day, Math.min(...temps), '↓');
      });
    }

    function tempRange(parent, value, arrow) {
      const v = value === 0 ? 0 : value;
      colorTemp(el('span', { class: 'wf-range', text: `${arrow}${intFmt.format(v)}°` }, parent), v);
    }

    function iconSrc(symbol) {
      if (!iconUrls[symbol] && icons[symbol]) iconUrls[symbol] = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(icons[symbol])}`;
      return iconUrls[symbol] || `${iconBase}${symbol}.svg`;
    }

    /** Fades the edge that has more hours past it. */
    function updateEdges() {
      const max = strip.scrollWidth - strip.clientWidth;
      root.classList.toggle('more-left', strip.scrollLeft > 1);
      root.classList.toggle('more-right', max > 1 && strip.scrollLeft < max - 1);
    }

    /** Re-renders on the hour, so the hour that has passed drops off. */
    function scheduleHourTick() {
      if (hourTimer) clearTimeout(hourTimer);
      hourTimer = null;
      if (!hours.length) return;
      const next = (Math.floor(now() / HOUR) + 1) * HOUR;
      hourTimer = setTimeout(render, next - now() + 1000);
    }

    function reportHeight() {
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) {
        lastHeight = h;
        if (opts.onHeight) opts.onHeight(h);
      }
    }

    return { setForecast, setMessage, t, render };
  }

  /**
   * Touch scrolls the strip natively. A mouse has no horizontal swipe, so dragging scrolls it too
   * (Homey's web dashboard).
   */
  function enableMouseDrag(strip) {
    let drag = null;
    strip.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      drag = { x: e.clientX, left: strip.scrollLeft, moved: false };
    });
    strip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (!drag.moved && Math.abs(dx) < 4) return;
      if (!drag.moved) {
        drag.moved = true;
        strip.classList.add('dragging');
        try { strip.setPointerCapture(e.pointerId); } catch (err) { /* not capturable */ }
      }
      strip.scrollLeft = drag.left - dx;
    });
    const end = () => {
      drag = null;
      strip.classList.remove('dragging');
    };
    strip.addEventListener('pointerup', end);
    strip.addEventListener('pointercancel', end);
  }

  window.createWeatherWidget = createWeatherWidget;
})();
