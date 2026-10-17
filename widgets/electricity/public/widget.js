/*
 * Electricity Overview widget renderer: live power, hourly (or 15-minute) price with usage trace, lowest price.
 * Plain browser JS (widget public files are served as-is). See the design spec for every
 * measurement used below. The drawing itself is chart.js (`window.WidgetkeeperChart`), shared with Charts.
 */
(function () {
  const { lowestSlot } = window.WidgetkeeperKit; // ../spacer/kit.js, loaded first
  'use strict';

  const C = window.WidgetkeeperChart; // chart.js, loaded first
  const { MIN, HOUR, L, X_LABEL_GAP, X_LABEL_H, LABEL_PAD, LABEL_MIN_GAP, el, clear, show, f1, niceStep, smoothValues, p985, p015 } = C;
  const NOW_SLOT = 24; // index of the current hour in the price slots
  const CHART_SLOTS = NOW_SLOT + 13; // the charts show 24 h back and 12 h ahead
  const QUARTER = 15 * MIN; // 15-minute prices (`quarters`), in quarter-hour markets

  // Chip row → top grid line, and the plot heights, per `layout`. Compact: a tighter chip row and
  // flatter plots (with smaller gaps and header in widget.css), about 350 px against 483.
  const DIMS = {
    standard: { CHIP_H: 38, LIVE_H: 83, PRICE_H: 122, USAGE_H: 100 },
    compact: { CHIP_H: 32, LIVE_H: 48, PRICE_H: 72, USAGE_H: 56 },
  };
  const R_USAGE = 34; // right gutter when the usage scale sits on the price chart
  const LIVE_POINTS = 120; // live chart resolution, whatever the window
  const LIVE_KEEP = 62 * MIN; // raw readings kept client-side (longest window + margin)

  const DEFAULT_STRINGS = {
    usingNow: 'Using now',
    exporting: 'Exporting now',
    minutesRemaining: '__minutes__ min left',
    fixedPrice: 'Fixed price',
    livePower: 'Live power',
    price: 'Price',
    usage: 'Usage',
    now: 'Now',
    lowestNext12h: 'Lowest next 12h',
    lowestNext24h: 'Lowest next 24h',
    lowestBoth: 'Lowest 12/24h',
    selectMeter: 'Select a power meter in the widget settings.',
    noReadings: 'No readings from the power meter yet.',
    meterError: 'Could not read the power meter.',
    error: 'Could not load data.',
  };

  function currencyUnits(code) {
    switch ((code || '').toUpperCase()) {
      case '':
      case 'DKK': return { value: 'kr.', chip: 'kr' };
      case 'NOK':
      case 'SEK': return { value: 'kr', chip: 'kr' };
      case 'EUR': return { value: '€', chip: '€' };
      default: return { value: code, chip: code };
    }
  }

  /**
   * Resample raw meter readings into LIVE_POINTS buckets ending at `now`. Buckets are aligned
   * to the step so values don't jitter as time passes; each is the average of its readings, or
   * the last known value when the meter didn't report. The last point is the current reading.
   */
  function resampleLive(raw, now, windowMs) {
    if (!raw.length) return [];
    const step = windowMs / LIVE_POINTS;
    const from = now - windowMs;
    const end = Math.floor(now / step) * step;
    const out = [];
    let j = 0, last = null;
    while (j < raw.length && raw[j].t <= from) last = raw[j++].w;
    out.push({ t: from, w: last });
    for (let b = end - (LIVE_POINTS - 1) * step; b <= end; b += step) {
      let sum = 0, n = 0;
      while (j < raw.length && raw[j].t <= b) { sum += raw[j].w; n++; last = raw[j++].w; }
      if (b > from) out.push({ t: b, w: n ? sum / n : last });
    }
    out.push({ t: now, w: raw[raw.length - 1].w });
    const first = out.find(p => p.w != null);
    return out.map(p => ({ t: p.t, w: Math.round(p.w == null ? first.w : p.w) }));
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string | null, locale?: string, layout?: string, onHeight?: (h: number) => void }} opts
   */
  function createElectricityWidget(root, opts = {}) {
    const locale = opts.locale || navigator.language || 'da-DK';
    const t = (key, tokens) => {
      let s = null;
      try { s = opts.t ? opts.t(`electricity.${key}`, tokens) : null; } catch (err) { /* fall back */ }
      if (!s || s === `electricity.${key}`) {
        s = DEFAULT_STRINGS[key] || key;
        for (const [k, v] of Object.entries(tokens || {})) s = s.replace(`__${k}__`, v);
      }
      return s;
    };
    const nfCache = {};
    const nf = (v, d) => {
      const key = d == null ? 'int' : d;
      nfCache[key] = nfCache[key] || new Intl.NumberFormat(locale, d == null
        ? { maximumFractionDigits: 0 }
        : { minimumFractionDigits: d, maximumFractionDigits: d });
      return nfCache[key].format(v);
    };
    // Negative power (solar export) gets a real minus sign: −1,5k.
    const kW = v => C.compactNumber(nf, v);
    const watts = v => (v < 0 ? '−' + nf(-v) : nf(v));
    const pad2 = n => String(n).padStart(2, '0');
    const hhmm = ms => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
    const hhmmss = ms => hhmm(ms) + ':' + pad2(new Date(ms).getSeconds());
    const hour = ms => new Date(ms).getHours() + ':00';
    /** Relative live-axis label: 1h, 30m, 2,5m, 30s. */
    const ago = ms => C.ago(ms, nf);
    const weekday = (ms, lang) => new Intl.DateTimeFormat(lang || 'en', { weekday: 'short' }).format(new Date(ms));

    const layout = opts.layout === 'compact' ? 'compact' : 'standard'; // missing on widgets placed before the setting
    const { CHIP_H, LIVE_H, PRICE_H, USAGE_H } = DIMS[layout];

    const state = {
      data: null, // snapshot from the app; data.live holds raw readings
      settings: { showPrices: true, showUsage: true, nextLow: '12', separateUsage: false, liveWindow: 10, smooth: false, usageColor: 'neutral' }, // nextLow: none/12/24/both; usageColor: neutral/purple
      message: null,
      width: root.clientWidth || 368,
      lastHeight: 0,
      liveIdx: null, // live scrub: index into the resampled live points
      slotIdx: null, // usage/price scrub: hour slot
      fineIdx: null, // usage/price scrub: 5-min index from the first slot
    };

    const kit = C.createKit();
    const { text, gradient, dot, chip, prepareSvg } = kit;

    // Persistent skeleton. The SVG elements must survive re-renders: replacing the element under
    // a finger drops the touch pointer capture and ends the scrub.
    const ui = (() => {
      const wrap = el('div', { class: layout === 'compact' ? 'ew ew-compact' : 'ew' }, root);
      const message = el('div', { class: 'ew-message', dir: 'auto' }, wrap);
      const header = el('div', { class: 'ew-header' }, wrap);
      const chart = (cls = '') => {
        const box = el('div', { class: `ew-chart ${cls}`.trim() }, wrap);
        const chips = el('div', { class: 'ew-chips' }, box);
        const svg = el('svg:svg', null, box);
        return { box, chips, svg };
      };
      const live = chart();
      const noLive = el('div', { class: 'ew-message', dir: 'auto' }, wrap);
      const usage = chart('ew-usage-chart');
      const price = chart();
      const footer = el('div', { class: 'ew-footer' }, wrap);
      return { wrap, message, header, live, noLive, usage, price, footer };
    })();
    const geom = { live: null, slots: null }; // geometry of the latest render, for pointer math

    // ------------------------------------------------------------------ derived data

    function liveWindowMs() {
      const minutes = Number(state.settings.liveWindow);
      return (minutes > 0 ? minutes : 10) * MIN;
    }

    function model() {
      const d = state.data;
      const w = state.width;
      const now = Date.now();
      const windowMs = liveWindowMs();
      const live = resampleLive(d.live || [], now, windowMs);
      const allSlots = d.prices || [];
      const slots = allSlots.slice(0, CHART_SLOTS);
      const firstSlot = slots.length ? slots[0].start : Math.floor(d.now / HOUR) * HOUR - NOW_SLOT * HOUR;
      const usageByIdx = new Map();
      for (const u of d.usage || []) usageByIdx.set(Math.round((u.t - firstSlot) / (5 * MIN)), u.w);
      // Prices show unless turned off; without any (no price set up in Homey Energy) they're left out
      // silently, as if turned off. A fixed price (one price for every hour) has no price chart or
      // lowest-price footer: the header shows the price. Without a price chart, usage gets its own chart.
      const pricesOn = state.settings.showPrices !== false && (d.fixedPrice != null || slots.some(s => s.price != null));
      const fixed = pricesOn && d.fixedPrice != null;
      const hasPrices = pricesOn && !fixed;
      // Quarter-hour markets: the price parts use the 15-minute prices on the same hourly axis (4 steps per hour).
      const allQuarters = hasPrices && Array.isArray(d.quarters) && d.quarters.length >= allSlots.length * 4 ? d.quarters : null;
      const quarters = allQuarters && allQuarters.slice(0, CHART_SLOTS * 4);
      const nowQ = NOW_SLOT * 4 + (slots[NOW_SLOT] ? Math.min(3, Math.max(0, Math.floor((now - slots[NOW_SLOT].start) / QUARTER))) : 0);
      const showUsage = state.settings.showUsage !== false && usageByIdx.size > 0;
      const separate = showUsage && (!hasPrices || state.settings.separateUsage === true);
      const usageOnPrice = showUsage && !separate; // trace + right scale on the price chart
      const pw = Math.max(40, w - L - (usageOnPrice ? R_USAGE : 4));
      const liveTime = windowMs < 10 * MIN ? hhmmss : hhmm;
      return {
        d, w, now, windowMs, live, liveTime, slots, allSlots, firstSlot, usageByIdx, quarters, allQuarters, nowQ,
        showUsage, separate, usageOnPrice, pw, pricesOn, hasPrices, fixed,
      };
    }

    // ------------------------------------------------------------------ render

    function render() {
      ui.wrap.classList.toggle('usage-purple', state.settings.usageColor === 'purple');
      const ready = !state.message && !!state.data;
      show(ui.message, !!state.message);
      ui.message.textContent = state.message || '';
      if (!ready) {
        [ui.header, ui.live.box, ui.noLive, ui.usage.box, ui.price.box, ui.footer].forEach(n => show(n, false));
        reportHeight();
        return;
      }

      const m = model();
      show(ui.header, true);
      renderHeader(ui.header, m);
      show(ui.live.box, m.live.length > 0);
      if (m.live.length) renderLive(ui.live, m);
      show(ui.noLive, !m.live.length);
      ui.noLive.textContent = t(m.d.meterError ? 'meterError' : 'noReadings');
      show(ui.usage.box, m.separate && m.slots.length > 0);
      if (m.separate && m.slots.length) renderUsage(ui.usage, m);
      show(ui.price.box, m.hasPrices);
      if (m.hasPrices) renderPrice(ui.price, m);
      const nextLow = state.settings.nextLow || '12';
      show(ui.footer, m.hasPrices && nextLow !== 'none');
      if (m.hasPrices && nextLow !== 'none') renderFooter(ui.footer, m, nextLow);
      reportHeight();
    }

    function reportHeight() {
      if (!opts.onHeight) return;
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== state.lastHeight) { state.lastHeight = h; opts.onHeight(h); }
    }

    function renderHeader(header, m) {
      const cur = currencyUnits(m.d.currency);
      const live = m.live;
      let leftVal = live.length ? live[live.length - 1].w : null;
      let leftSub = leftVal != null && leftVal < 0 ? t('exporting') : t('usingNow');
      if (state.liveIdx != null && live[state.liveIdx]) {
        leftVal = live[state.liveIdx].w;
        leftSub = m.liveTime(live[state.liveIdx].t);
      } else if (state.fineIdx != null && m.showUsage && m.usageByIdx.has(state.fineIdx)) {
        leftVal = m.usageByIdx.get(state.fineIdx);
        leftSub = hhmm(m.firstSlot + state.fineIdx * 5 * MIN);
      }

      const { slot: sel, len } = selected(m);
      const price = m.fixed ? m.d.fixedPrice : sel ? sel.price : null;
      const minutes = new Date().getMinutes();
      const priceSub = m.fixed ? t('fixedPrice')
        : state.slotIdx == null || !sel
          ? t('minutesRemaining', { minutes: m.quarters ? 15 - minutes % 15 : 60 - minutes })
          : `${weekday(sel.start, m.d.language)} ${hhmm(sel.start)}–${hhmm(sel.start + len)}`;

      clear(header);
      header.classList.toggle('one', !m.pricesOn);
      const lc = el('div', { class: 'ew-hcol' }, header);
      const lv = el('div', { class: `ew-hval live${leftVal < 0 ? ' export' : ''}` }, lc);
      el('span', { class: 'v ew-num', text: leftVal == null ? '–' : watts(leftVal) }, lv);
      el('span', { class: 'u', text: 'W' }, lv);
      el('div', { class: 'ew-hsub', dir: 'auto', text: leftSub }, lc);

      if (!m.pricesOn) return;
      const rc = el('div', { class: 'ew-hcol' }, header);
      const rv = el('div', { class: 'ew-hval price' }, rc);
      el('span', { class: 'v ew-num', text: `${price == null ? '–' : nf(price, 2)} ${cur.value}` }, rv);
      el('span', { class: 'u', text: '/kWh' }, rv);
      el('div', { class: 'ew-hsub', dir: 'auto', text: priceSub }, rc);
    }

    /** The W scale: from zero, extended below it in whole steps when there's export. */
    function wattScale(svg, max, h, top, pw, rightExt, min = 0) {
      return kit.valueScale(svg, { max, min, h, top, pw, rightExt, format: kW });
    }

    function renderLive(chart, m) {
      const { live, pw } = m;
      const top = CHIP_H, base = top + LIVE_H;
      const H = base + X_LABEL_GAP + X_LABEL_H;
      clear(chart.chips);
      chip(chart.chips, 'live', t('livePower'), 'W');
      const svg = chart.svg;
      prepareSvg(svg, m.w, H);

      const from = m.now - m.windowMs;
      const xs = live.map(p => L + pw * (p.t - from) / m.windowMs);
      geom.live = { xs };

      const fill = gradient(svg, 'live-stop', [[0, 0.45], [1, 0]]);
      const { y, zeroY } = wattScale(svg, Math.max(1, ...live.map(p => p.w)), LIVE_H, top, pw, 0,
        Math.min(0, ...live.map(p => p.w)));
      kit.axis(svg, top, base, pw);

      // With `smooth`, the line (and the dot) follow the smoothed values; the header keeps the real ones.
      const ws = state.settings.smooth ? smoothValues(live.map(p => p.w)) : live.map(p => p.w);
      const pts = ws.map((w, i) => [xs[i], y(w)]);
      const line = C.linePath(pts, state.settings.smooth);
      const area = `${line}L${f1(xs[xs.length - 1])} ${f1(zeroY)}L${f1(xs[0])} ${f1(zeroY)}Z`;
      kit.trace(svg, { line, area, fill, kind: 'live', lineClass: 'live-line', stops: [0.45, 0], zeroY, top, base });

      const idx = state.liveIdx == null ? live.length - 1 : Math.min(state.liveIdx, live.length - 1);
      if (state.liveIdx != null) el('svg:path', { class: 'cursor', d: `M${f1(xs[idx])} ${top}V${base}` }, svg);
      dot(svg, pts[idx][0], pts[idx][1], ws[idx] < 0 ? 'live export' : 'live');

      const ly = base + X_LABEL_GAP;
      text(svg, L, ly, ago(m.windowMs), 'start', 'hanging');
      text(svg, L + pw / 2, ly, ago(m.windowMs / 2), 'middle', 'hanging');
      text(svg, L + pw, ly, t('now'), 'end', 'hanging');
    }

    /** Vertical lines at midnight (day boundaries) on a slot chart. */
    function midnightLines(svg, slots, sw, top, base) {
      const xs = [];
      slots.forEach((s, i) => { if (i > 0 && new Date(s.start).getHours() === 0) xs.push(L + i * sw); });
      kit.midnightLines(svg, xs, top, base);
    }

    /**
     * The selected (or current) price slot: an hour, or with 15-minute prices the quarter under the finger
     * (`fineIdx` is in 5-minute steps, 3 to a quarter). `idx` indexes `steps` (`m.quarters` or `m.slots`),
     * `per` is the steps per hour, `len` a step's length.
     */
    function selected(m) {
      if (!m.quarters) {
        const idx = state.slotIdx == null ? NOW_SLOT : state.slotIdx;
        return { idx, slot: m.slots[idx], steps: m.slots, per: 1, len: HOUR };
      }
      const idx = state.slotIdx == null ? m.nowQ
        : Math.min(state.slotIdx * 4 + 3, Math.max(state.slotIdx * 4, Math.floor((state.fineIdx || 0) / 3)));
      return { idx, slot: m.quarters[idx], steps: m.quarters, per: 4, len: QUARTER };
    }

    /** Band marking the selected (or current) hour, or quarter, on a slot chart. */
    function slotBand(svg, m, sw, top, h) {
      const sel = selected(m);
      el('svg:rect', { class: 'band', x: f1(L + sel.idx * sw / sel.per), y: top - 6, width: f1(sw / sel.per), height: h + 6 }, svg);
      return sel;
    }

    /**
     * Usage trace path(s), broken over gaps; returns { line, area, yAt }, where yAt maps a
     * 5-min index to the trace's y (the smoothed one with `smooth`), for the dots.
     */
    function usagePaths(m, fx, y, base) { // base: where the area closes (the zero line)
      const smooth = state.settings.smooth;
      const entries = [...m.usageByIdx.entries()].sort((a, b) => a[0] - b[0]);
      const segs = [];
      for (const [j, v] of entries) {
        const last = segs[segs.length - 1];
        if (last && j === last[last.length - 1][0] + 1) last.push([j, v]); else segs.push([[j, v]]);
      }
      let line = '', area = '';
      const yAt = new Map();
      for (const seg of segs) {
        const vs = smooth ? smoothValues(seg.map(e => e[1])) : seg.map(e => e[1]);
        const pts = seg.map(([j], i) => [fx(j), y(vs[i])]);
        seg.forEach(([j], i) => yAt.set(j, pts[i][1]));
        const d = C.linePath(pts, smooth);
        line += d;
        area += `${d}V${f1(base)}H${f1(pts[0][0])}Z`;
      }
      return { line, area, yAt };
    }

    /** Separate usage chart: same 37-slot x axis as the price chart, with its own W scale. */
    function renderUsage(chart, m) {
      const { slots, pw } = m;
      const n = slots.length, sw = pw / n;
      const top = CHIP_H, base = top + USAGE_H;
      const H = base + X_LABEL_GAP + X_LABEL_H;

      clear(chart.chips);
      chip(chart.chips, 'usage', t('usage'), 'W');
      const svg = chart.svg;
      prepareSvg(svg, m.w, H);
      geom.slots = { sw, n };

      const scale = wattScale(svg, Math.max(1, p985(m.usageByIdx.values())), USAGE_H, top, pw, 0,
        p015(m.usageByIdx.values()));
      const y = v => Math.max(top - 2, scale.y(v));
      const fx = j => L + (j + 0.5) / 12 * sw;
      midnightLines(svg, slots, sw, top, base);
      slotBand(svg, m, sw, top, USAGE_H);
      kit.axis(svg, top, base, pw);

      const { zeroY } = scale;
      const { line, area, yAt } = usagePaths(m, fx, y, zeroY);
      kit.trace(svg, { line, area, kind: 'usage', lineClass: 'usage-line solo', stops: [0.22, 0.02], zeroY, top, base });

      // Marker at the scrubbed 5 min, else at the latest reading, like the live and price dots.
      const idx = state.fineIdx != null && m.usageByIdx.has(state.fineIdx)
        ? state.fineIdx : Math.max(-1, ...m.usageByIdx.keys());
      if (idx >= 0) dot(svg, fx(idx), yAt.get(idx), yAt.get(idx) > zeroY ? 'usage export' : 'usage', true);
      slotLabels(svg, slots, sw, pw, base);
    }

    function renderPrice(chart, m) {
      const { slots, pw } = m;
      const showUsage = m.usageOnPrice;
      const n = slots.length, sw = pw / n;
      const top = CHIP_H, base = top + PRICE_H;
      const H = base + X_LABEL_GAP + X_LABEL_H;
      const cur = currencyUnits(m.d.currency);

      clear(chart.chips);
      chip(chart.chips, 'price', t('price'), cur.chip);
      if (showUsage) chip(chart.chips, 'usage', t('usage'), 'W');
      const svg = chart.svg;
      prepareSvg(svg, m.w, H);
      geom.slots = { sw, n };

      // Price scale. Negative prices extend the scale below zero in whole steps.
      const steps = m.quarters || slots, per = m.quarters ? 4 : 1, ssw = sw / per; // price steps: hours or quarters
      const known = steps.map(s => s.price).filter(p => p != null);
      const maxP = Math.max(0.01, ...known), minP = Math.min(0, ...known);
      const pst = niceStep((maxP - minP) / 3);
      let kPos = Math.ceil(maxP / pst - 1e-9), kNeg = Math.ceil(-minP / pst - 1e-9);
      let k = kPos + kNeg;

      // Usage scale (right): same number of steps, sized from the 98.5th percentile, 0 at the bottom.
      // Negative usage (solar export) gets its own steps below zero, and the two scales then
      // share the zero line: each side has as many steps as the price or the usage needs.
      const uHi = Math.max(1, p985(m.usageByIdx.values())), uLo = showUsage ? p015(m.usageByIdx.values()) : 0;
      let ust, uMin = 0;
      if (uLo < 0) {
        ust = niceStep((uHi - uLo) / 3);
        kPos = Math.max(kPos, Math.ceil(uHi / ust - 1e-9));
        kNeg = Math.max(kNeg, Math.ceil(-uLo / ust - 1e-9));
        k = kPos + kNeg;
        uMin = -ust * kNeg;
      } else {
        ust = niceStep(uHi / k);
      }
      const pMax = pst * kPos, pMin = -pst * kNeg, uMax = uMin + ust * k;
      const py = p => top + PRICE_H * (1 - (p - pMin) / (pMax - pMin));
      const uy = uMin < 0
        ? v => Math.min(base + 2, Math.max(top - 2, top + PRICE_H * (1 - (v - uMin) / (uMax - uMin))))
        : v => Math.max(top - 2, top + PRICE_H * (1 - v / uMax));
      const uZero = uy(0);
      const fx = j => L + (j + 0.5) / 12 * sw;

      const fill = gradient(svg, 'price-stop', [[0, 0.24], [0.35, 0.16], [0.6, 0.096], [1, 0.02]],
        { gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: f1(py(maxP)), y2: base });

      // 1. Grid + y labels
      let grid = '';
      const xr = L + pw + (showUsage ? 6 : 0);
      const every = Math.max(1, Math.ceil(LABEL_MIN_GAP / (PRICE_H / k))); // thinned on a flat (compact) chart
      for (let j = 0; j <= k; j++) {
        const yy = py(pMin + pst * j);
        if (j > 0) grid += `M${L - 6} ${f1(yy)}H${xr}`;
        if ((j - kNeg) % every !== 0) continue; // zero always keeps its label
        text(svg, L - LABEL_PAD, yy, nf(pMin + pst * j, 2), 'end', 'central');
        if (showUsage) text(svg, L + pw + LABEL_PAD, yy, kW(uMin + ust * j), 'start', 'central');
      }
      el('svg:path', { class: 'grid', d: grid }, svg);

      midnightLines(svg, slots, sw, top, base);

      // 2. Hover / current-hour band
      const sel = slotBand(svg, m, sw, top, PRICE_H);

      // 3. Axes
      let axis = `M${L} ${top - 6}V${base}H${L + pw}`;
      if (showUsage) axis += `V${top - 6}M${L + pw} ${base}H${L + pw + 6}`;
      axis += `M${L - 6} ${base}H${L}`;
      el('svg:path', { class: 'axis', d: axis }, svg);

      // 4. Usage trace
      const usage = showUsage ? usagePaths(m, fx, uy, base) : null;
      if (usage) {
        kit.trace(svg, { line: usage.line, kind: 'usage', lineClass: 'usage-line', zeroY: uZero, top, base });
      }

      // 5–6. Price area + step line, broken where prices are missing. With `smooth`, the steps'
      // corners are rounded.
      let line = '', area = '', pts = null, lastKnown = -1;
      for (let i = 0; i <= steps.length; i++) {
        const p = i < steps.length ? steps[i].price : null;
        if (p != null) {
          const yy = py(p), x0 = L + i * ssw, x1 = L + (i + 1) * ssw;
          if (!pts) pts = [[x0, yy]];
          else if (yy !== pts[pts.length - 1][1]) pts.push([x0, yy]);
          else pts.pop(); // same price: extend the previous step
          pts.push([x1, yy]);
          lastKnown = i;
        } else if (pts) {
          const seg = C.stepPath(pts, state.settings.smooth);
          line += seg;
          area += `${seg}V${base}H${f1(pts[0][0])}Z`;
          pts = null;
        }
      }
      el('svg:path', { d: area, fill }, svg);
      el('svg:path', { class: 'price-line', d: line }, svg);

      // 7. Future overlay, up to the last published hour (or quarter)
      const fStart = L + ((m.quarters ? m.nowQ : NOW_SLOT) + 1) * ssw, fEnd = L + (lastKnown + 1) * ssw;
      if (fEnd > fStart) el('svg:rect', { class: 'future', x: f1(fStart), y: top - 6, width: f1(fEnd - fStart), height: PRICE_H + 6 }, svg);

      // 8. Usage scrub dot
      if (usage && state.fineIdx != null && usage.yAt.has(state.fineIdx)) {
        const cy = usage.yAt.get(state.fineIdx);
        el('svg:circle', { class: `usage-dot${cy > uZero ? ' export' : ''}`, cx: f1(fx(state.fineIdx)), cy: f1(cy), r: 4 }, svg);
      }

      // 9. Price dot
      if (sel.slot && sel.slot.price != null) dot(svg, L + sel.idx * ssw + ssw / 2, py(sel.slot.price), 'price');

      slotLabels(svg, slots, sw, pw, base);
    }

    /** Slot-chart x labels: Now + forecast end always, then H:00 candidates that don't collide. */
    function slotLabels(svg, slots, sw, pw, base) {
      const n = slots.length;
      const ly = base + X_LABEL_GAP;
      const kept = [
        { x: L + (NOW_SLOT + 0.5) * sw, cx: L + (NOW_SLOT + 0.5) * sw, anchor: 'middle', label: t('now') },
        { x: L + pw, cx: L + pw - 15, anchor: 'end', label: hour(slots[n - 1].start + HOUR) },
      ];
      slots.forEach((s, i) => {
        if (new Date(s.start).getHours() % (i > NOW_SLOT ? 3 : 6) !== 0) return;
        const x = L + i * sw;
        if (x - L >= 18 && kept.every(q => Math.abs(q.cx - x) >= 40)) kept.push({ x, cx: x, anchor: 'middle', label: hour(s.start) });
      });
      for (const q of kept) text(svg, q.x, ly, q.label, q.anchor, 'hanging');
    }

    /**
     * `mode` is '12', '24' or 'both'. Both: `03:00 • 1,22 / 03:00 • 1,22`, without the unit;
     * when the 12h and 24h lowest are the same slot it's shown once, with the unit.
     */
    function renderFooter(footer, m, mode) {
      // With 15-minute prices: the cheapest quarter, from the current one.
      const per = m.allQuarters ? 4 : 1;
      const slots = m.allQuarters || m.allSlots, from = m.allQuarters ? m.nowQ : NOW_SLOT;
      const lows = (mode === 'both' ? [12, 24] : [mode === '24' ? 24 : 12])
        .map(h => lowestSlot(slots, from, h * per)).filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
      clear(footer);
      if (!lows.length) { show(footer, false); return; }
      const both = lows.length > 1;
      const cur = currencyUnits(m.d.currency);
      el('span', { class: 'l', dir: 'auto', text: t(mode === 'both' ? 'lowestBoth' : mode === '24' ? 'lowestNext24h' : 'lowestNext12h') }, footer);
      const r = el('span', { class: 'r' }, footer);
      lows.forEach((low, k) => {
        const s = slots[low];
        if (k) el('span', { class: 'div', text: '/' }, r);
        el('span', { class: 'when ew-num', text: low === from ? t('now') : hhmm(s.start) }, r);
        el('span', { class: 'sep', text: '•' }, r);
        el('span', { class: 'price ew-num', text: both ? nf(s.price, 2) : `${nf(s.price, 2)} ${cur.value}` }, r);
      });
    }

    // ------------------------------------------------------------------ interaction

    const pointerX = C.pointerX;

    function scrubLive(e) {
      const g = geom.live;
      if (!g || !g.xs.length) return;
      const px = pointerX(e, ui.live.svg);
      let i = null;
      if (px >= L && px <= g.xs[g.xs.length - 1] + 1) {
        i = 0;
        for (let k = 1; k < g.xs.length; k++) if (Math.abs(g.xs[k] - px) < Math.abs(g.xs[i] - px)) i = k;
      }
      if (i !== state.liveIdx) { state.liveIdx = i; render(); }
    }
    function scrubSlots(e, svg) {
      const g = geom.slots;
      if (!g) return;
      const px = pointerX(e, svg) - L;
      const i = Math.floor(px / g.sw);
      const c = i < 0 || i >= g.n ? null : i;
      const j = c == null ? null : Math.max(0, Math.round(px / g.sw * 12 - 0.5));
      if (c !== state.slotIdx || j !== state.fineIdx) { state.slotIdx = c; state.fineIdx = j; render(); }
    }
    const resetLive = () => { if (state.liveIdx != null) { state.liveIdx = null; render(); } };
    const resetSlots = () => {
      if (state.slotIdx != null || state.fineIdx != null) { state.slotIdx = null; state.fineIdx = null; render(); }
    };

    // The usage and price charts share the 37-slot x axis, so they share scrub state (and the touch hold).
    const liveHold = { timer: null }, slotsHold = { timer: null };
    C.attachScrub(ui.live.svg, e => scrubLive(e), resetLive, liveHold);
    C.attachScrub(ui.usage.svg, e => scrubSlots(e, ui.usage.svg), resetSlots, slotsHold);
    C.attachScrub(ui.price.svg, e => scrubSlots(e, ui.price.svg), resetSlots, slotsHold);

    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w && w !== state.width) { state.width = w; render(); }
    });
    ro.observe(root);

    // Scroll the live chart with time: about one pixel per tick, at most once a second. Not while nobody sees it (a
    // hidden page, or a Smart Stack page that isn't on screen); drawn at once when it's back.
    let scrollTimer = null;
    let offScreen = false;
    const scrolling = () => state.data && !state.message && !offScreen && !document.hidden;
    function restartScroll() {
      if (scrollTimer) clearInterval(scrollTimer);
      scrollTimer = setInterval(() => { if (scrolling()) render(); }, Math.max(1000, liveWindowMs() / 300));
    }
    restartScroll();
    const onVisibility = () => { if (scrolling()) render(); };
    document.addEventListener('visibilitychange', onVisibility);
    render();

    // ------------------------------------------------------------------ public API

    return {
      setData(snapshot) { state.data = snapshot; state.message = null; render(); },
      setSettings(settings) { state.settings = { ...state.settings, ...settings }; restartScroll(); render(); },
      setMessage(message) { state.message = message; render(); },
      /** The Smart Stack: whether this page is the one on screen (the live chart only scrolls while it is). */
      setVisible(visible) { offScreen = !visible; if (scrolling()) render(); },
      render,
      /** Apply a realtime meter reading. */
      pushLive({ t: ts, w }) {
        const live = state.data && state.data.live;
        if (!live) return;
        const last = live[live.length - 1];
        if (last && ts <= last.t) last.w = w;
        else live.push({ t: ts, w });
        const cutoff = Date.now() - LIVE_KEEP;
        while (live.length > 1 && live[1].t < cutoff) live.shift();
        if (!document.hidden && !offScreen) render(); // else drawn when it's back
      },
      t,
      destroy() { ro.disconnect(); clearInterval(scrollTimer); document.removeEventListener('visibilitychange', onVisibility); },
    };
  }

  window.createElectricityWidget = createElectricityWidget;
})();
