/*
 * Electricity Overview widget renderer: live power, hourly price with usage trace, lowest price.
 * Plain browser JS (widget public files are served as-is). See the design spec for every
 * measurement used below.
 */
(function () {
  'use strict';

  const MIN = 60e3;
  const HOUR = 60 * MIN;
  const NOW_SLOT = 24; // index of the current hour in the price slots
  const CHART_SLOTS = NOW_SLOT + 13; // the charts show 24 h back and 12 h ahead
  const SVG_NS = 'http://www.w3.org/2000/svg';

  const L = 38; // left gutter
  const CHIP_H = 38; // chip row → top grid line
  const LIVE_H = 83;
  const PRICE_H = 122;
  const USAGE_H = 100; // separate usage chart
  const X_LABEL_GAP = 5;
  const X_LABEL_H = 14;
  const R_USAGE = 34; // right gutter when the usage scale sits on the price chart
  const LABEL_PAD = 8; // y label ↔ axis
  const LABEL_MIN_GAP = 16; // min vertical distance between y labels
  const LIVE_POINTS = 120; // live chart resolution, whatever the window
  const SMOOTH_PASSES = 6; // `smooth` setting: averaging passes over the live and usage traces
  const STEP_RADIUS = 5; // `smooth` setting: corner radius on the price steps
  const LIVE_KEEP =62 * MIN; // raw readings kept client-side (longest window + margin)

  const DEFAULT_STRINGS = {
    usingNow: 'Using now',
    minutesRemaining: '__minutes__ min left',
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
    noPrices: 'No electricity prices available. Enable dynamic prices in Homey Energy.',
    error: 'Could not load data.',
  };

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }

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

  function el(tag, attrs, parent) {
    const node = tag.startsWith('svg:') ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
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

  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }
  function show(node, on) { node.style.display = on ? '' : 'none'; }
  function f1(n) { return Math.round(n * 10) / 10; }

  /** Smoothed values for the `smooth` setting: six [1 2 1]/4 passes; the ends stay put. */
  function smoothValues(vs) {
    let q = vs;
    for (let k = 0; k < SMOOTH_PASSES; k++) {
      q = q.map((v, i) => i === 0 || i === q.length - 1 ? v : (q[i - 1] + 2 * v + q[i + 1]) / 4);
    }
    return q;
  }

  /**
   * Path segments (after the M) through `pts` ([x, y] with rising x): a monotone cubic
   * (Fritsch–Carlson, like d3's curveMonotoneX), which never overshoots between points.
   */
  function monotonePath(pts) {
    const n = pts.length;
    if (n < 3) return pts.slice(1).map(([x, y]) => `L${f1(x)} ${f1(y)}`).join('');
    const s = [], m = [];
    for (let i = 0; i < n - 1; i++) s.push((pts[i + 1][1] - pts[i][1]) / ((pts[i + 1][0] - pts[i][0]) || 1e-9));
    m[0] = s[0];
    m[n - 1] = s[n - 2];
    for (let i = 1; i < n - 1; i++) {
      if (s[i - 1] * s[i] <= 0) { m[i] = 0; continue; }
      const h0 = pts[i][0] - pts[i - 1][0], h1 = pts[i + 1][0] - pts[i][0];
      const w0 = (h0 + 2 * h1) / (3 * (h0 + h1));
      m[i] = 1 / (w0 / s[i - 1] + (1 - w0) / s[i]);
    }
    let d = '';
    for (let i = 0; i < n - 1; i++) {
      const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = (x1 - x0) / 3;
      d += `C${f1(x0 + h)} ${f1(y0 + m[i] * h)} ${f1(x1 - h)} ${f1(y1 - m[i + 1] * h)} ${f1(x1)} ${f1(y1)}`;
    }
    return d;
  }

  /** Path segments (after the M) through the corners of a step line, rounded with radius `r`. */
  function roundedPath(pts, r) {
    let d = '';
    for (let i = 1; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === pts.length - 1) { d += `L${f1(x)} ${f1(y)}`; break; }
      const [ax, ay] = pts[i - 1], [bx, by] = pts[i + 1];
      const d0 = Math.hypot(x - ax, y - ay), d1 = Math.hypot(bx - x, by - y);
      const rr = Math.min(r, d0 / 2, d1 / 2);
      d += `L${f1(x - (x - ax) / d0 * rr)} ${f1(y - (y - ay) / d0 * rr)}`
        + `Q${f1(x)} ${f1(y)} ${f1(x + (bx - x) / d1 * rr)} ${f1(y + (by - y) / d1 * rr)}`;
    }
    return d;
  }

  /** 98.5th percentile, used to size usage scales so single spikes don't flatten the trace. */
  function p985(values) {
    const v = [...values].sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.985))] : 1;
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
   * @param {{ t?: (key: string, tokens?: object) => string | null, locale?: string, onHeight?: (h: number) => void }} opts
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
    const kW = v => (v >= 1000 ? nf(v / 1000, v % 1000 ? 1 : 0) + 'k' : nf(Math.round(v)));
    const pad2 = n => String(n).padStart(2, '0');
    const hhmm = ms => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
    const hhmmss = ms => hhmm(ms) + ':' + pad2(new Date(ms).getSeconds());
    const hour = ms => new Date(ms).getHours() + ':00';
    /** Relative live-axis label: 1h, 30m, 2,5m, 30s. */
    const ago = ms => (ms >= HOUR && ms % HOUR === 0 ? `${ms / HOUR}h`
      : ms >= MIN ? `${nf(ms / MIN, ms % MIN ? 1 : 0)}m`
        : `${Math.round(ms / 1000)}s`);
    const weekday = (ms, lang) => new Intl.DateTimeFormat(lang || 'en', { weekday: 'short' }).format(new Date(ms));

    const state = {
      data: null, // snapshot from the app; data.live holds raw readings
      settings: { showUsage: true, nextLow: '12', separateUsage: false, liveWindow: 10, smooth: false, usageColor: 'neutral' }, // nextLow: none/12/24/both; usageColor: neutral/purple
      message: null,
      width: root.clientWidth || 368,
      lastHeight: 0,
      liveIdx: null, // live scrub: index into the resampled live points
      slotIdx: null, // usage/price scrub: hour slot
      fineIdx: null, // usage/price scrub: 5-min index from the first slot
    };

    let gradientCounter = 0;
    const uid = 'ew' + Math.random().toString(36).slice(2, 7);

    // Persistent skeleton. The SVG elements must survive re-renders: replacing the element under
    // a finger drops the touch pointer capture and ends the scrub.
    const ui = (() => {
      const wrap = el('div', { class: 'ew' }, root);
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
      const noPrices = el('div', { class: 'ew-message', dir: 'auto' }, wrap);
      const footer = el('div', { class: 'ew-footer' }, wrap);
      return { wrap, message, header, live, noLive, usage, price, noPrices, footer };
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
      const showUsage = state.settings.showUsage !== false && usageByIdx.size > 0;
      const separate = showUsage && state.settings.separateUsage === true;
      const usageOnPrice = showUsage && !separate; // trace + right scale on the price chart
      const pw = Math.max(40, w - L - (usageOnPrice ? R_USAGE : 4));
      const hasPrices = slots.some(s => s.price != null);
      const liveTime = windowMs < 10 * MIN ? hhmmss : hhmm;
      return {
        d, w, now, windowMs, live, liveTime, slots, allSlots, firstSlot, usageByIdx,
        showUsage, separate, usageOnPrice, pw, hasPrices,
      };
    }

    // ------------------------------------------------------------------ render

    function render() {
      ui.wrap.classList.toggle('usage-purple', state.settings.usageColor === 'purple');
      const ready = !state.message && !!state.data;
      show(ui.message, !!state.message);
      ui.message.textContent = state.message || '';
      if (!ready) {
        [ui.header, ui.live.box, ui.noLive, ui.usage.box, ui.price.box, ui.noPrices, ui.footer].forEach(n => show(n, false));
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
      show(ui.noPrices, !m.hasPrices);
      ui.noPrices.textContent = t('noPrices');
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
      let leftSub = t('usingNow');
      if (state.liveIdx != null && live[state.liveIdx]) {
        leftVal = live[state.liveIdx].w;
        leftSub = m.liveTime(live[state.liveIdx].t);
      } else if (state.fineIdx != null && m.showUsage && m.usageByIdx.has(state.fineIdx)) {
        leftVal = m.usageByIdx.get(state.fineIdx);
        leftSub = hhmm(m.firstSlot + state.fineIdx * 5 * MIN);
      }

      const selIdx = state.slotIdx == null ? NOW_SLOT : state.slotIdx;
      const sel = m.slots[selIdx];
      const price = sel ? sel.price : null;
      const priceSub = state.slotIdx == null || !sel
        ? t('minutesRemaining', { minutes: 60 - new Date().getMinutes() })
        : `${weekday(sel.start, m.d.language)} ${hhmm(sel.start)}–${hhmm(sel.start + HOUR)}`;

      clear(header);
      const lc = el('div', { class: 'ew-hcol' }, header);
      const lv = el('div', { class: 'ew-hval live' }, lc);
      el('span', { class: 'v ew-num', text: leftVal == null ? '–' : nf(leftVal) }, lv);
      el('span', { class: 'u', text: 'W' }, lv);
      el('div', { class: 'ew-hsub', dir: 'auto', text: leftSub }, lc);

      const rc = el('div', { class: 'ew-hcol' }, header);
      const rv = el('div', { class: 'ew-hval price' }, rc);
      el('span', { class: 'v ew-num', text: `${price == null ? '–' : nf(price, 2)} ${cur.value}` }, rv);
      el('span', { class: 'u', text: '/kWh' }, rv);
      el('div', { class: 'ew-hsub', dir: 'auto', text: priceSub }, rc);
    }

    function chip(parent, kind, label, unit) {
      const c = el('span', { class: `ew-chip ${kind}` }, parent);
      el('i', null, c);
      const s = el('span', { text: label }, c);
      el('span', { class: 'unit', text: ` – ${unit}` }, s);
    }

    function text(svg, x, y, label, anchor, baseline) {
      return el('svg:text', { x: f1(x), y: f1(y), 'text-anchor': anchor, 'dominant-baseline': baseline, text: label }, svg);
    }

    function gradient(svg, cls, stops, attrs) {
      const id = `${uid}g${++gradientCounter}`;
      const defs = el('svg:defs', null, svg);
      const g = el('svg:linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1, ...attrs }, defs);
      for (const [offset, opacity] of stops) el('svg:stop', { class: cls, offset, 'stop-opacity': opacity }, g);
      return `url(#${id})`;
    }

    function dot(svg, x, y, kind, small) {
      el('svg:circle', { class: `dot-ring ${kind}`, cx: f1(x), cy: f1(y), r: small ? 6.5 : 7 }, svg);
      el('svg:circle', { class: `dot-core ${kind}`, cx: f1(x), cy: f1(y), r: small ? 3.5 : 4 }, svg);
    }

    function prepareSvg(svg, w, h) {
      clear(svg);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    /** Left W scale for a plot of height `h` starting at `top`: grid, thinned labels, axis. */
    function wattScale(svg, max, h, top, pw, rightExt) {
      const step = niceStep(max / 3), k = Math.ceil(max / step - 1e-9), axisMax = step * k;
      const y = v => top + h * (1 - Math.max(0, v) / axisMax);
      let grid = '';
      const every = Math.max(1, Math.ceil(LABEL_MIN_GAP / (h / k)));
      for (let j = 0; j <= k; j++) {
        if (j > 0) grid += `M${L - 6} ${f1(y(step * j))}H${L + pw + rightExt}`;
        if ((k - j) % every === 0) text(svg, L - LABEL_PAD, y(step * j), kW(step * j), 'end', 'central');
      }
      el('svg:path', { class: 'grid', d: grid }, svg);
      return { y, axisMax };
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
      const { y } = wattScale(svg, Math.max(1, ...live.map(p => p.w)), LIVE_H, top, pw, 0);
      el('svg:path', { class: 'axis', d: `M${L} ${top - 6}V${base}H${L + pw}M${L - 6} ${base}H${L}` }, svg);

      // With `smooth`, the line (and the dot) follow the smoothed values; the header keeps the real ones.
      const ws = state.settings.smooth ? smoothValues(live.map(p => p.w)) : live.map(p => p.w);
      const pts = ws.map((w, i) => [xs[i], y(w)]);
      const line = `M${f1(pts[0][0])} ${f1(pts[0][1])}` + (state.settings.smooth
        ? monotonePath(pts) : pts.slice(1).map(([x, yy]) => `L${f1(x)} ${f1(yy)}`).join(''));
      el('svg:path', { d: `${line}L${f1(xs[xs.length - 1])} ${base}L${f1(xs[0])} ${base}Z`, fill }, svg);
      el('svg:path', { class: 'live-line', d: line }, svg);

      const idx = state.liveIdx == null ? live.length - 1 : Math.min(state.liveIdx, live.length - 1);
      if (state.liveIdx != null) el('svg:path', { class: 'cursor', d: `M${f1(xs[idx])} ${top}V${base}` }, svg);
      dot(svg, pts[idx][0], pts[idx][1], 'live');

      const ly = base + X_LABEL_GAP;
      text(svg, L, ly, ago(m.windowMs), 'start', 'hanging');
      text(svg, L + pw / 2, ly, ago(m.windowMs / 2), 'middle', 'hanging');
      text(svg, L + pw, ly, t('now'), 'end', 'hanging');
    }

    /** Vertical lines at midnight (day boundaries) on a slot chart. */
    function midnightLines(svg, slots, sw, top, base) {
      let d = '';
      slots.forEach((s, i) => {
        if (i > 0 && new Date(s.start).getHours() === 0) d += `M${f1(L + i * sw)} ${top - 6}V${base}`;
      });
      if (d) el('svg:path', { class: 'midnight', d }, svg);
    }

    /** Band marking the selected (or current) hour on a slot chart. */
    function slotBand(svg, sw, top, h) {
      const selIdx = state.slotIdx == null ? NOW_SLOT : state.slotIdx;
      el('svg:rect', { class: 'band', x: f1(L + selIdx * sw), y: top - 6, width: f1(sw), height: h + 6 }, svg);
      return selIdx;
    }

    /**
     * Usage trace path(s), broken over gaps; returns { line, area, yAt }, where yAt maps a
     * 5-min index to the trace's y (the smoothed one with `smooth`), for the dots.
     */
    function usagePaths(m, fx, y, base) {
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
        const d = `M${f1(pts[0][0])} ${f1(pts[0][1])}` + (smooth
          ? monotonePath(pts) : pts.slice(1).map(([x, yy]) => `L${f1(x)} ${f1(yy)}`).join(''));
        line += d;
        area += `${d}V${base}H${f1(pts[0][0])}Z`;
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

      const scale = wattScale(svg, Math.max(1, p985(m.usageByIdx.values())), USAGE_H, top, pw, 0);
      const y = v => Math.max(top - 2, scale.y(v));
      const fx = j => L + (j + 0.5) / 12 * sw;
      midnightLines(svg, slots, sw, top, base);
      slotBand(svg, sw, top, USAGE_H);
      el('svg:path', { class: 'axis', d: `M${L} ${top - 6}V${base}H${L + pw}M${L - 6} ${base}H${L}` }, svg);

      const { line, area, yAt } = usagePaths(m, fx, y, base);
      el('svg:path', { d: area, fill: gradient(svg, 'usage-stop', [[0, 0.22], [1, 0.02]]) }, svg);
      el('svg:path', { class: 'usage-line solo', d: line }, svg);

      // Marker at the scrubbed 5 min, else at the latest reading, like the live and price dots.
      const idx = state.fineIdx != null && m.usageByIdx.has(state.fineIdx)
        ? state.fineIdx : Math.max(-1, ...m.usageByIdx.keys());
      if (idx >= 0) dot(svg, fx(idx), yAt.get(idx), 'usage', true);
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
      const known = slots.map(s => s.price).filter(p => p != null);
      const maxP = Math.max(0.01, ...known), minP = Math.min(0, ...known);
      const pst = niceStep((maxP - minP) / 3);
      const kPos = Math.ceil(maxP / pst - 1e-9), kNeg = Math.ceil(-minP / pst - 1e-9);
      const k = kPos + kNeg, pMax = pst * kPos, pMin = -pst * kNeg;
      const py = p => top + PRICE_H * (1 - (p - pMin) / (pMax - pMin));

      // Usage scale (right): same number of steps, sized from the 98.5th percentile.
      const ust = niceStep(Math.max(1, p985(m.usageByIdx.values())) / k), uMax = ust * k;
      const uy = v => Math.max(top - 2, top + PRICE_H * (1 - v / uMax));
      const fx = j => L + (j + 0.5) / 12 * sw;

      const fill = gradient(svg, 'price-stop', [[0, 0.24], [0.35, 0.16], [0.6, 0.096], [1, 0.02]],
        { gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: f1(py(maxP)), y2: base });

      // 1. Grid + y labels
      let grid = '';
      const xr = L + pw + (showUsage ? 6 : 0);
      for (let j = 0; j <= k; j++) {
        const yy = py(pMin + pst * j);
        if (j > 0) grid += `M${L - 6} ${f1(yy)}H${xr}`;
        text(svg, L - LABEL_PAD, yy, nf(pMin + pst * j, 2), 'end', 'central');
        if (showUsage) text(svg, L + pw + LABEL_PAD, yy, kW(ust * j), 'start', 'central');
      }
      el('svg:path', { class: 'grid', d: grid }, svg);

      midnightLines(svg, slots, sw, top, base);

      // 2. Hover / current-hour band
      const selIdx = slotBand(svg, sw, top, PRICE_H);

      // 3. Axes
      let axis = `M${L} ${top - 6}V${base}H${L + pw}`;
      if (showUsage) axis += `V${top - 6}M${L + pw} ${base}H${L + pw + 6}`;
      axis += `M${L - 6} ${base}H${L}`;
      el('svg:path', { class: 'axis', d: axis }, svg);

      // 4. Usage trace
      const usage = showUsage ? usagePaths(m, fx, uy, base) : null;
      if (usage) el('svg:path', { class: 'usage-line', d: usage.line }, svg);

      // 5–6. Price area + step line, broken where prices are missing. With `smooth`, the steps'
      // corners are rounded.
      let line = '', area = '', pts = null, lastKnown = -1;
      for (let i = 0; i <= n; i++) {
        const p = i < n ? slots[i].price : null;
        if (p != null) {
          const yy = py(p), x0 = L + i * sw, x1 = L + (i + 1) * sw;
          if (!pts) pts = [[x0, yy]];
          else if (yy !== pts[pts.length - 1][1]) pts.push([x0, yy]);
          else pts.pop(); // same price: extend the previous step
          pts.push([x1, yy]);
          lastKnown = i;
        } else if (pts) {
          const seg = `M${f1(pts[0][0])} ${f1(pts[0][1])}` + (state.settings.smooth
            ? roundedPath(pts, STEP_RADIUS) : pts.slice(1).map(([x, yy]) => `L${f1(x)} ${f1(yy)}`).join(''));
          line += seg;
          area += `${seg}V${base}H${f1(pts[0][0])}Z`;
          pts = null;
        }
      }
      el('svg:path', { d: area, fill }, svg);
      el('svg:path', { class: 'price-line', d: line }, svg);

      // 7. Future overlay, up to the last published hour
      const fStart = L + (NOW_SLOT + 1) * sw, fEnd = L + (lastKnown + 1) * sw;
      if (fEnd > fStart) el('svg:rect', { class: 'future', x: f1(fStart), y: top - 6, width: f1(fEnd - fStart), height: PRICE_H + 6 }, svg);

      // 8. Usage scrub dot
      if (usage && state.fineIdx != null && usage.yAt.has(state.fineIdx)) {
        el('svg:circle', { class: 'usage-dot', cx: f1(fx(state.fineIdx)), cy: f1(usage.yAt.get(state.fineIdx)), r: 4 }, svg);
      }

      // 9. Price dot
      const sel = slots[selIdx];
      if (sel && sel.price != null) dot(svg, L + selIdx * sw + sw / 2, py(sel.price), 'price');

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

    /** Index of the cheapest known slot from now through `hours` ahead, or -1. */
    function lowestSlot(slots, hours) {
      let low = -1;
      for (let i = NOW_SLOT; i <= NOW_SLOT + hours && i < slots.length; i++) {
        const p = slots[i].price;
        if (p != null && (low < 0 || p < slots[low].price - 1e-9)) low = i;
      }
      return low;
    }

    /**
     * `mode` is '12', '24' or 'both'. Both: `03:00 • 1,22 / 03:00 • 1,22`, without the unit;
     * when the 12h and 24h lowest are the same slot it's shown once, with the unit.
     */
    function renderFooter(footer, m, mode) {
      const slots = m.allSlots;
      const lows = (mode === 'both' ? [12, 24] : [mode === '24' ? 24 : 12])
        .map(h => lowestSlot(slots, h)).filter((i, k, a) => i >= 0 && a.indexOf(i) === k);
      clear(footer);
      if (!lows.length) { show(footer, false); return; }
      const both = lows.length > 1;
      const cur = currencyUnits(m.d.currency);
      el('span', { class: 'l', dir: 'auto', text: t(mode === 'both' ? 'lowestBoth' : mode === '24' ? 'lowestNext24h' : 'lowestNext12h') }, footer);
      const r = el('span', { class: 'r' }, footer);
      lows.forEach((low, k) => {
        const s = slots[low];
        if (k) el('span', { class: 'div', text: '/' }, r);
        el('span', { class: 'when ew-num', text: low === NOW_SLOT ? t('now') : hhmm(s.start) }, r);
        el('span', { class: 'sep', text: '•' }, r);
        el('span', { class: 'price ew-num', text: both ? nf(s.price, 2) : `${nf(s.price, 2)} ${cur.value}` }, r);
      });
    }

    // ------------------------------------------------------------------ interaction

    const pointerX = (e, svg) => e.clientX - svg.getBoundingClientRect().left;

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

    // The usage and price charts share the 37-slot x axis, so they share scrub state.
    // Mouse: scrub on hover, reset on leave. Touch: a tap or drag selects; the selection stays
    // TOUCH_HOLD_MS after the finger lifts. That also makes taps work on Homey's Android app,
    // whose dashboard takes over a drag (pointercancel) about 100 ms in, whatever the page does.
    const TOUCH_HOLD_MS = 3000;
    const liveHold = { timer: null }, slotsHold = { timer: null }; // usage + price share one
    for (const [svg, scrub, reset, hold] of [
      [ui.live.svg, e => scrubLive(e), resetLive, liveHold],
      [ui.usage.svg, e => scrubSlots(e, ui.usage.svg), resetSlots, slotsHold],
      [ui.price.svg, e => scrubSlots(e, ui.price.svg), resetSlots, slotsHold],
    ]) {
      svg.addEventListener('pointerdown', e => { clearTimeout(hold.timer); scrub(e); });
      svg.addEventListener('pointermove', scrub);
      svg.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse') reset(); });
      for (const ev of ['pointerup', 'pointercancel']) {
        svg.addEventListener(ev, e => {
          if (e.pointerType === 'mouse') return;
          clearTimeout(hold.timer);
          hold.timer = setTimeout(reset, TOUCH_HOLD_MS);
        });
      }
      // Without this, Homey's dashboard scrolls and cancels the touch (iOS honours it; Android doesn't).
      for (const ev of ['touchstart', 'touchmove']) {
        svg.addEventListener(ev, e => { if (e.cancelable) e.preventDefault(); }, { passive: false });
      }
    }

    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0].contentRect.width);
      if (w && w !== state.width) { state.width = w; render(); }
    });
    ro.observe(root);

    // Scroll the live chart with time: about one pixel per tick, at most once a second.
    let scrollTimer = null;
    function restartScroll() {
      if (scrollTimer) clearInterval(scrollTimer);
      scrollTimer = setInterval(() => { if (state.data && !state.message) render(); }, Math.max(1000, liveWindowMs() / 300));
    }
    restartScroll();
    render();

    // ------------------------------------------------------------------ public API

    return {
      setData(snapshot) { state.data = snapshot; state.message = null; render(); },
      setSettings(settings) { state.settings = { ...state.settings, ...settings }; restartScroll(); render(); },
      setMessage(message) { state.message = message; render(); },
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
        render();
      },
      t,
      destroy() { ro.disconnect(); clearInterval(scrollTimer); },
    };
  }

  window.createElectricityWidget = createElectricityWidget;
})();
