/*
 * Energy Price Strip: the electricity price now with its level (where it sits in today's range: low, medium or high), and
 * the coming 12, 24 or 36 hours as small bars in their level colours, with a dot over the cheapest. With 15-minute
 * prices (quarter-hour markets), the price now is the current quarter's and there's a bar per quarter.
 * Plain browser JS (served as-is).
 */
(function () {
  const { el, lowestSlot } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const HOUR = 36e5;
  const QUARTER = HOUR / 4; // 15-minute prices (`quarters`), in quarter-hour markets
  /** Hours between the axis labels, per window. */
  const TICK_STEP = { 12: 3, 24: 6, 36: 12 };

  const DEFAULT_STRINGS = {
    now: 'Now',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    fixedPrice: 'Fixed price',
    noPrices: 'No electricity prices. Set them up in Homey Energy.',
    error: 'Could not load the prices.',
  };

  /** As the Electricity Overview: `kr.` for DKK (and no currency), `kr` for NOK and SEK, `€` for EUR. */
  function currencyUnit(code) {
    switch ((code || '').toUpperCase()) {
      case '':
      case 'DKK': return 'kr.';
      case 'NOK':
      case 'SEK': return 'kr';
      case 'EUR': return '€';
      default: return code;
    }
  }

  /**
   * Where `price` sits among `prices` (today's): in the lowest third of the range 'low', in the highest 'high',
   * the rest (and a flat day) 'medium'. Null without prices.
   */
  function priceLevel(price, prices) {
    const list = prices.filter(p => typeof p === 'number');
    if (typeof price !== 'number' || !list.length) return null;
    const min = Math.min(...list);
    const max = Math.max(...list);
    if (max - min < 1e-9) return 'medium';
    const k = (price - min) / (max - min);
    return k < 1 / 3 - 1e-9 ? 'low' : k > 2 / 3 + 1e-9 ? 'high' : 'medium';
  }

  /** The index of the slot (`len` ms long) holding `now`, or -1. */
  function slotAt(slots, now, len = HOUR) {
    return slots.findIndex(s => s.start <= now && now < s.start + len);
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, hours?: string | number,
   *   tint?: boolean, now?: () => number, onHeight?: (h: number) => void }} opts
   */
  function createPriceWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`price.${key}`, tokens) : null;
      if (s && s !== `price.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const clock = opts.now || (() => Date.now());
    const hours = [12, 24, 36].includes(Number(opts.hours)) ? Number(opts.hours) : 12;

    const nfCache = {};
    const nf = (v, d) => {
      nfCache[d] = nfCache[d] || new Intl.NumberFormat(opts.locale || undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
      return nfCache[d].format(v);
    };
    const pad2 = n => String(n).padStart(2, '0');
    /** The short weekday in Homey's language (the midnight label). */
    const weekdays = {};
    const weekday = ms => {
      const lang = (snapshot && snapshot.language) || 'en';
      if (!weekdays[lang]) {
        try { weekdays[lang] = new Intl.DateTimeFormat(lang, { weekday: 'short' }); } catch { weekdays[lang] = new Intl.DateTimeFormat('en', { weekday: 'short' }); }
      }
      return weekdays[lang].format(new Date(ms));
    };

    let snapshot = null; // { prices: [{start, price}], fixedPrice, currency, language }
    let messageText = null;
    let messageTimer = null;
    let slotTimer = null;

    root.classList.add('pb');
    if (opts.tint === false) root.classList.add('no-tint');
    const tile = el('div', { class: 'pb-tile' }, root);
    const nowCell = el('div', { class: 'pb-now' }, tile);
    const labelEl = el('div', { class: 'pb-label', dir: 'auto' }, nowCell);
    const valueEl = el('div', { class: 'pb-value' }, nowCell);
    const numberEl = el('span', { class: 'pb-number' }, valueEl);
    const unitEl = el('span', { class: 'pb-unit' }, valueEl);
    const chart = el('div', { class: 'pb-chart', 'aria-hidden': 'true' }, tile);
    const barsEl = el('div', { class: 'pb-bars' }, chart);
    const axisEl = el('div', { class: 'pb-axis' }, chart);
    const messageEl = el('div', { class: 'pb-message', dir: 'auto' }, root);
    // Kept across renders, like the Electricity Overview's SVG elements; made again only when the count changes
    // (hourly ↔ 15-minute prices: 4 bars an hour).
    let bars = [];
    chart.dataset.hours = String(hours);
    function ensureBars(count) {
      if (bars.length === count) return;
      barsEl.textContent = '';
      bars = Array.from({ length: count }, () => el('div', { class: 'pb-bar' }, barsEl));
      if (count > hours) chart.dataset.quarters = ''; else delete chart.dataset.quarters;
    }

    /** `/price`'s answer: `{prices, quarters, fixedPrice, currency, language}` (`quarters`: 15-minute prices or null). */
    function setState(state) {
      snapshot = state && Array.isArray(state.prices) ? state : null;
      messageText = null;
      render();
    }

    /** A message under the tile. Persistent messages also clear the tile. */
    function setMessage(text, transient) {
      if (messageTimer) clearTimeout(messageTimer);
      messageTimer = null;
      messageText = text;
      if (transient) messageTimer = setTimeout(() => { messageText = null; render(); }, 8000);
      else snapshot = null;
      render();
    }

    /** The prices of the local day holding `ms`, cached in `cache` by its midnight. */
    function dayPrices(slots, ms, cache) {
      const d = new Date(ms);
      d.setHours(0, 0, 0, 0);
      const from = d.getTime();
      if (!cache[from]) {
        const end = new Date(d);
        end.setDate(end.getDate() + 1);
        cache[from] = slots.filter(s => s.start >= from && s.start < end.getTime()).map(s => s.price);
      }
      return cache[from];
    }

    /**
     * What the tile shows at `now`, or null without a price for the current slot: the price now with its level,
     * and the coming `hours` from the current slot as bars, one per hour or, with 15-minute prices, per quarter.
     * Each bar has its level in its own day, so tomorrow's cheap hours are green against tomorrow; the heights
     * share one scale, the window's lowest to highest.
     */
    function model(now) {
      if (!snapshot) return null;
      const fine = Array.isArray(snapshot.quarters) && snapshot.quarters.length > 0;
      const slots = fine ? snapshot.quarters : snapshot.prices;
      const len = fine ? QUARTER : HOUR;
      const count = hours * HOUR / len;
      const unit = currencyUnit(snapshot.currency);
      if (typeof snapshot.fixedPrice === 'number') {
        return { level: null, label: t('fixedPrice'), value: nf(snapshot.fixedPrice, 2), unit, bars: null, len: HOUR };
      }
      const i = slotAt(slots, now, len);
      const price = i >= 0 ? slots[i].price : null;
      if (typeof price !== 'number') return null;
      const days = {};
      const level = priceLevel(price, dayPrices(slots, now, days));
      const first = slots[i].start;
      const window = Array.from({ length: count }, (_, k) => {
        const start = first + k * len;
        const s = slots[i + k];
        const p = s && s.start === start && typeof s.price === 'number' ? s.price : null;
        return { start, price: p, level: p == null ? null : priceLevel(p, dayPrices(slots, start, days)), height: 0, lowest: false };
      });
      const known = window.filter(b => b.price != null).map(b => b.price);
      const min = Math.min(...known);
      const max = Math.max(...known);
      const flat = max - min < 1e-9;
      const low = lowestSlot(slots, i, count - 1);
      for (const b of window) {
        if (b.price != null) b.height = flat ? 0.6 : 0.2 + 0.8 * (b.price - min) / (max - min);
        b.lowest = !flat && low >= 0 && b.start === slots[low].start;
      }
      // Labels on the step's local hours, clear of "Now" and the right edge; midnight shows the weekday.
      const step = TICK_STEP[hours];
      const ticks = [];
      window.forEach((b, k) => {
        const d = new Date(b.start);
        const h = d.getHours();
        if (d.getMinutes() || h % step || k < count * 0.18 || k > count * 0.92) return;
        ticks.push({ at: k / count, text: h === 0 ? weekday(b.start) : pad2(h) });
      });
      return { level, label: t(level), value: nf(price, 2), unit, bars: window, ticks, len };
    }

    function renderBars(m) {
      ensureBars(m.bars.length);
      bars.forEach((bar, k) => {
        const b = m.bars[k];
        bar.className = `pb-bar${k === 0 ? ' now' : ''}${b.price == null ? ' none' : ''}${b.lowest ? ' lowest' : ''}`;
        if (b.level) bar.dataset.level = b.level; else delete bar.dataset.level;
        bar.style.height = b.price == null ? '' : `${Math.round(b.height * 100)}%`;
      });
      axisEl.textContent = '';
      el('span', { class: 'pb-tick pb-tick-now', text: t('now'), dir: 'auto' }, axisEl);
      for (const tick of m.ticks) {
        el('span', { class: 'pb-tick', text: tick.text, style: `left:${(tick.at * 100).toFixed(2)}%` }, axisEl);
      }
    }

    let lastHeight = 0;
    function render() {
      const now = clock();
      const m = model(now);
      tile.style.display = m ? '' : 'none';
      if (m) {
        if (m.level) tile.dataset.level = m.level; else delete tile.dataset.level;
        labelEl.textContent = m.label;
        numberEl.textContent = m.value;
        unitEl.textContent = m.unit;
        chart.style.display = m.bars ? '' : 'none';
        if (m.bars) renderBars(m);
      }
      const text = messageText || (snapshot && !m ? t('noPrices') : null);
      messageEl.textContent = text || '';
      messageEl.style.display = text ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && !!m);
      scheduleNext(now, m ? m.len : HOUR);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    /** Re-renders when the current slot (an hour or a quarter) moves on (the 5-min refresh brings new days). */
    function scheduleNext(now, len) {
      if (slotTimer) clearTimeout(slotTimer);
      slotTimer = setTimeout(render, Math.floor(now / len) * len + len - now + 50);
    }

    return { setState, setMessage, render, t };
  }

  window.createPriceWidget = createPriceWidget;
  window.electricityPriceLevel = priceLevel;
})();
