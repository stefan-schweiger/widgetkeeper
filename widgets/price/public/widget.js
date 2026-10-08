/*
 * Price Badge: the electricity price now, the next hour's and the lowest coming hour, in one compact tile. The
 * tile is tinted by where the price now sits in today's range (low, medium or high).
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const HOUR = 36e5;

  const DEFAULT_STRINGS = {
    now: 'Now',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    nextHour: 'Next hour',
    lowest12: 'Lowest 12h',
    lowest24: 'Lowest 24h',
    fixedPrice: 'Fixed price',
    noPrices: 'No electricity prices. Set them up in Homey Energy.',
    error: 'Could not load the prices.',
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

  /** The index of the slot holding `now`, or -1. */
  function slotAt(slots, now) {
    return slots.findIndex(s => s.start <= now && now < s.start + HOUR);
  }

  /** The cheapest slot from `from` up to `hours` ahead (the first of equal ones), or -1. As the Electricity Overview. */
  function lowestSlot(slots, from, hours) {
    let low = -1;
    for (let i = from; i <= from + hours && i < slots.length; i++) {
      const p = slots[i].price;
      if (p != null && (low < 0 || p < slots[low].price - 1e-9)) low = i;
    }
    return low;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, showNext?: boolean,
   *   nextLow?: string, tint?: boolean, now?: () => number, onHeight?: (h: number) => void }} opts
   */
  function createPriceWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`price.${key}`, tokens) : null;
      if (s && s !== `price.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const clock = opts.now || (() => Date.now());
    const showNext = opts.showNext !== false;
    const nextLow = ['none', '12', '24'].includes(opts.nextLow) ? opts.nextLow : '12';

    const nfCache = {};
    const nf = (v, d) => {
      nfCache[d] = nfCache[d] || new Intl.NumberFormat(opts.locale || undefined, { minimumFractionDigits: d, maximumFractionDigits: d });
      return nfCache[d].format(v);
    };
    const pad2 = n => String(n).padStart(2, '0');
    const hhmm = ms => { const d = new Date(ms); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };

    let snapshot = null; // { prices: [{start, price}], fixedPrice, currency }
    let messageText = null;
    let messageTimer = null;
    let hourTimer = null;

    root.classList.add('pb');
    if (opts.tint === false) root.classList.add('no-tint');
    const tile = el('div', { class: 'pb-tile' }, root);
    const cells = {};
    for (const id of ['now', 'next', 'low']) {
      const cell = el('div', { class: `pb-cell pb-${id}` }, tile);
      cells[id] = { cell, label: el('div', { class: 'pb-label', dir: 'auto' }, cell), value: el('div', { class: 'pb-value' }, cell) };
    }
    const messageEl = el('div', { class: 'pb-message', dir: 'auto' }, root);

    /** `/price`'s answer: `{prices, fixedPrice, currency}`. */
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

    function setCell(id, label, value) {
      const c = cells[id];
      c.cell.style.display = value == null ? 'none' : '';
      c.label.textContent = label || '';
      c.value.textContent = value || '';
    }

    /** What the tile shows at `now`, or null without a price for the current hour. */
    function model(now) {
      if (!snapshot) return null;
      const slots = snapshot.prices;
      const unit = currencyUnit(snapshot.currency);
      if (typeof snapshot.fixedPrice === 'number') {
        return { level: null, now: { label: t('fixedPrice'), value: `${nf(snapshot.fixedPrice, 2)} ${unit}` } };
      }
      const i = slotAt(slots, now);
      const price = i >= 0 ? slots[i].price : null;
      if (typeof price !== 'number') return null;
      const midnight = new Date(now);
      midnight.setHours(0, 0, 0, 0);
      const dayEnd = new Date(midnight);
      dayEnd.setDate(dayEnd.getDate() + 1);
      const today = slots.filter(s => s.start >= midnight.getTime() && s.start < dayEnd.getTime()).map(s => s.price);
      const level = priceLevel(price, today);
      const m = { level, now: { label: `${t('now')} · ${t(level)}`, value: `${nf(price, 2)} ${unit}` } };
      const next = slots[i + 1];
      if (showNext && next && typeof next.price === 'number') {
        const arrow = next.price > price + 1e-9 ? '↑' : next.price < price - 1e-9 ? '↓' : '→';
        m.next = { label: t('nextHour'), value: `${arrow} ${nf(next.price, 2)}` };
      }
      if (nextLow !== 'none') {
        const low = lowestSlot(slots, i, Number(nextLow));
        if (low >= 0) {
          m.low = {
            label: t(nextLow === '24' ? 'lowest24' : 'lowest12'),
            value: `${low === i ? t('now') : hhmm(slots[low].start)} · ${nf(slots[low].price, 2)}`,
          };
        }
      }
      return m;
    }

    let lastHeight = 0;
    function render() {
      const now = clock();
      const m = model(now);
      tile.style.display = m ? '' : 'none';
      if (m) {
        tile.dataset.level = m.level || '';
        if (!m.level) delete tile.dataset.level;
        setCell('now', m.now.label, m.now.value);
        setCell('next', m.next && m.next.label, m.next && m.next.value);
        setCell('low', m.low && m.low.label, m.low && m.low.value);
      }
      const text = messageText || (snapshot && !m ? t('noPrices') : null);
      messageEl.textContent = text || '';
      messageEl.style.display = text ? '' : 'none';
      messageEl.classList.toggle('error', !!messageText && !!m);
      scheduleHour(now);

      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== lastHeight) { lastHeight = h; if (opts.onHeight) opts.onHeight(h); }
    }

    /** Re-renders on the hour, when the current slot moves on (the 5-min refresh brings new days). */
    function scheduleHour(now) {
      if (hourTimer) clearTimeout(hourTimer);
      hourTimer = setTimeout(render, Math.floor(now / HOUR) * HOUR + HOUR - now + 50);
    }

    return { setState, setMessage, render, t };
  }

  window.createPriceWidget = createPriceWidget;
  window.electricityPriceLevel = priceLevel;
})();
