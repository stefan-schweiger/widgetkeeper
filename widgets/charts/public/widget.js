/*
 * Charts: one chart, two stacked, or two series on one chart, of any logged number, drawn like the Electricity Overview's charts by the
 * shared chart module (../electricity/chart.js, `window.WidgetkeeperChart`, loaded first).
 * Plain browser JS (served as-is).
 */
(function () {
  'use strict';

  const C = window.WidgetkeeperChart;
  const { MIN, HOUR, L, X_LABEL_GAP, X_LABEL_H, el, clear, show, f1, smoothValues } = C;

  const CHIP_H = 38; // chip row → top grid line, as the Electricity Overview's
  const PLOT_H = { 1: 122, 2: 83 }; // one chart: the price chart's height; two: the live chart's
  const R = 34; // right gutter for the second scale on one chart, as the Electricity Overview's usage scale
  const SPAN_MS = { '1h': HOUR, '6h': 6 * HOUR, '24h': 24 * HOUR, '2d': 48 * HOUR, '3d': 72 * HOUR, '5d': 120 * HOUR, '7d': 168 * HOUR };
  /** Each bar's length per span: about 12–28 bars, on the clock. */
  const BAR_MS = { '1h': 5 * MIN, '6h': 15 * MIN, '24h': HOUR, '2d': 2 * HOUR, '3d': 3 * HOUR, '5d': 6 * HOUR, '7d': 6 * HOUR };
  const STYLES = ['area', 'line', 'bars'];
  const COLORS = ['blue', 'red', 'orange', 'yellow', 'green', 'purple'];

  const DEFAULT_STRINGS = {
    now: 'Now',
    selectChart: 'Pick a device value in the widget settings.',
    error: 'Could not load the chart.',
    unavailable: 'Unavailable',
    noHistory: 'No history yet.',
  };

  // scaled(), formatNumber() and formatValue() are copied from widgets/values/public/widget.js (as Sparklines'),
  // trimmed to numbers: only those have charts. test/widget-html.test.ts checks the copies.
  const TIGHT_UNITS = /^(°|%)/;

  /** A `%` number as 0–100 (a 0–1 range, like Homey's `dim`, is scaled up), else the number itself. */
  function scaled(cap, value) {
    return cap.units === '%' && cap.max === 1 && (cap.min == null || cap.min === 0) ? value * 100 : value;
  }

  /** The number in the device locale, to the capability's decimals (at most 1 without them). */
  function formatNumber(cap, value) {
    const percent = scaled(cap, value) !== value;
    const digits = percent ? 0 : cap.decimals != null ? Math.max(0, Math.min(cap.decimals, 4)) : null;
    return scaled(cap, value).toLocaleString(undefined, digits != null
      ? { minimumFractionDigits: 0, maximumFractionDigits: digits }
      : { maximumFractionDigits: 1 });
  }

  /**
   * Bars of `bucketMs` on the local clock over `[from, to]`: each the average of the points in it, or the last
   * value before it (Homey doesn't log unchanged values); null before the first value. The first and last
   * bars are cut to the span. `current` (the value now) only stands in for a last bar without points of its
   * own, so it doesn't count as a sample and the bar doesn't jump with each live value. `{t, end, v}`, oldest first.
   * @param {[number, number][]} points
   * @param {number | null} [current]
   */
  function chartBuckets(points, from, to, bucketMs, current = null) {
    const offset = new Date(from).getTimezoneOffset() * MIN;
    const align = t => Math.floor((t - offset) / bucketMs) * bucketMs + offset;
    const out = [];
    let j = 0, last = null;
    while (j < points.length && points[j][0] < from) last = points[j++][1];
    for (let b = align(from); b < to; b += bucketMs) {
      let sum = 0, n = 0;
      while (j < points.length && points[j][0] < b + bucketMs) {
        if (points[j][0] <= to) { sum += points[j][1]; n++; }
        last = points[j++][1];
      }
      const end = Math.min(b + bucketMs, to);
      out.push({ t: Math.max(b, from), end, v: n ? sum / n : end === to && current != null ? current : last });
    }
    return out;
  }

  /** The number of decimals in a scale step: 2.5 → 1, 0.25 → 2, 50 → 0. */
  function stepDecimals(step) {
    let d = 0;
    while (d < 4 && Math.abs(step * Math.pow(10, d) - Math.round(step * Math.pow(10, d))) > 1e-6) d++;
    return d;
  }

  /**
   * @param {HTMLElement} root
   * @param {{ t?: (key: string, tokens?: object) => string, locale?: string, language?: string, now?: () => number,
   *   charts?: { span?: string, style?: string, color?: string, range?: string, negative?: boolean, smooth?: boolean, title?: string }[],
   *   overlay?: boolean, showHeader?: boolean, onHeight?: (h: number) => void }} opts
   */
  function createChartsWidget(root, opts = {}) {
    const t = (key, tokens) => {
      const s = opts.t ? opts.t(`charts.${key}`, tokens) : null;
      if (s && s !== `charts.${key}`) return s;
      return (DEFAULT_STRINGS[key] || key).replace(/__(\w+)__/g, (_, k) => (tokens && tokens[k] != null ? tokens[k] : ''));
    };
    const now = opts.now || (() => Date.now());
    const locale = opts.locale || navigator.language || 'en';
    let language = opts.language || 'en';
    const nfCache = {};
    const nf = (v, d) => {
      const key = d == null ? 'int' : d;
      nfCache[key] = nfCache[key] || new Intl.NumberFormat(locale, d == null
        ? { maximumFractionDigits: 0 }
        : { minimumFractionDigits: d, maximumFractionDigits: d });
      return nfCache[key].format(v);
    };
    const pad2 = n => String(n).padStart(2, '0');
    const hhmm = ms => { const d = new Date(ms); return pad2(d.getHours()) + ':' + pad2(d.getMinutes()); };
    const weekday = ms => new Intl.DateTimeFormat(language || 'en', { weekday: 'short' }).format(new Date(ms));

    /** The charts' settings, with fallbacks for anything missing or unknown. */
    const charts = (opts.charts && opts.charts.length ? opts.charts : [{}]).slice(0, 2).map(c => ({
      span: SPAN_MS[c.span] ? c.span : '24h',
      style: STYLES.includes(c.style) ? c.style : 'area',
      color: COLORS.includes(c.color) ? c.color : 'blue',
      fit: c.range !== 'zero',
      negative: c.negative === true,
      smooth: c.smooth === true,
      title: typeof c.title === 'string' ? c.title.trim() : '',
    }));
    // Two series on one chart share chart 1's time axis and kind of scale.
    const overlay = opts.overlay === true && charts.length === 2;
    if (overlay) Object.assign(charts[1], { span: charts[0].span, fit: charts[0].fit });
    const showHeader = opts.showHeader !== false;

    const state = {
      entries: [], // per chart: Sparklines' slot ({deviceId, capabilityId, name, capability, value, points} | {missing})
      message: null,
      transient: null,
      width: root.clientWidth || 368,
      lastHeight: 0,
      // The tapped point's time, or a time inside the tapped bar (its end), per chart: not an index, since the
      // points move along with the window and the live values.
      sel: charts.map(() => null),
    };
    let messageTimer = null;

    const kit = C.createKit();
    const wrap = el('div', { class: 'ew ch' }, root);
    const message = el('div', { class: 'ew-message', dir: 'auto' }, wrap);
    const header = el('div', { class: 'ew-header' }, wrap);
    const ui = charts.map((c) => {
      const box = el('div', { class: 'ew-chart ch-chart', 'data-color': c.color }, wrap);
      const chips = el('div', { class: 'ew-chips' }, box);
      const svg = el('svg:svg', null, box);
      const note = el('div', { class: 'ew-message ch-note', dir: 'auto' }, box);
      return { box, chips, svg, note };
    });
    const transientEl = el('div', { class: 'ew-message ch-transient', dir: 'auto' }, wrap);
    const geom = charts.map(() => null); // the latest render's x positions, for the pointer math

    // ------------------------------------------------------------------ derived data

    function spanMs(i) { return SPAN_MS[charts[i].span]; }

    /** The chart's logged (and live) points over its span. */
    function loggedPoints(i, to) {
      const s = state.entries[i];
      if (!s || 'missing' in s) return [];
      const from = to - spanMs(i);
      return (s.points || []).filter(p => p[0] >= from && p[0] <= to && typeof p[1] === 'number' && isFinite(p[1]));
    }

    /** The chart's current value, or null. */
    function currentOf(i) {
      const s = state.entries[i];
      return s && !('missing' in s) && typeof s.value === 'number' && isFinite(s.value) ? s.value : null;
    }

    /** The chart's points over its span, with the current value carried on to now. */
    function pointsOf(i, to) {
      const pts = loggedPoints(i, to);
      const last = pts.length ? pts[pts.length - 1][0] : -Infinity;
      const v = currentOf(i);
      return v != null && last < to ? pts.concat([[to, v]]) : pts;
    }

    function titleOf(i) {
      const s = state.entries[i];
      if (charts[i].title) return charts[i].title;
      if (!s || 'missing' in s) return t('unavailable');
      return [s.name, s.capability.title].filter(Boolean).join(' · ');
    }

    /** The axis labels: a number to the step's decimals, thousands as `1,5k` once the step is that coarse. */
    function axisLabel(v, step) {
      if (Math.abs(v) < step / 1e6) v = 0;
      if (step >= 100 && Math.abs(v) >= 1000) return C.compactNumber(nf, v);
      return (v < 0 ? '−' : '') + nf(Math.abs(v), stepDecimals(step));
    }

    // ------------------------------------------------------------------ render

    function render() {
      const ready = !state.message;
      show(message, !!state.message);
      message.textContent = state.message || '';
      show(header, ready && showHeader && state.entries.length > 0);
      if (overlay) {
        show(ui[0].box, ready && state.entries.length > 0);
        show(ui[1].box, false);
        if (ready && state.entries.length) renderOverlay();
      } else {
        ui.forEach((u, i) => {
          show(u.box, ready && i < state.entries.length);
          if (ready && i < state.entries.length) renderChart(i);
        });
      }
      if (ready && showHeader && state.entries.length) renderHeader();
      show(transientEl, !!state.transient);
      transientEl.textContent = state.transient || '';
      reportHeight();
    }

    function reportHeight() {
      if (!opts.onHeight) return;
      const h = Math.ceil(root.getBoundingClientRect().height);
      if (h && h !== state.lastHeight) { state.lastHeight = h; opts.onHeight(h); }
    }

    /** The value and time a chart shows: the tapped point or bar, else the current value. */
    function shown(i) {
      const s = state.entries[i];
      const g = geom[i];
      if (g && g.sel != null && g.items[g.sel]) {
        const item = g.items[g.sel];
        const long = spanMs(i) > 24 * HOUR;
        const at = ms => (long ? `${weekday(ms)} ${hhmm(ms)}` : hhmm(ms));
        return { value: item.v, sub: item.end != null ? `${at(item.t)}–${hhmm(item.end)}` : at(item.t) };
      }
      return { value: s && !('missing' in s) ? s.value : null, sub: s && 'missing' in s ? t('unavailable') : t('now') };
    }

    function renderHeader() {
      clear(header);
      header.classList.toggle('one', state.entries.length < 2);
      state.entries.forEach((s, i) => {
        const { value, sub } = shown(i);
        const col = el('div', { class: 'ew-hcol', 'data-color': charts[i].color }, header);
        const ok = s && !('missing' in s) && typeof value === 'number' && isFinite(value);
        const units = ok && s.capability.units ? s.capability.units : '';
        const below = ok && charts[i].negative && scaled(s.capability, value) < 0;
        const hv = el('div', { class: `ew-hval ch-value${below ? ' export' : ''}${TIGHT_UNITS.test(units) ? ' tight' : ''}` }, col);
        el('span', { class: 'v ew-num', text: ok ? formatNumber(s.capability, value) : '–' }, hv);
        if (units) el('span', { class: 'u', text: units }, hv);
        el('div', { class: 'ew-hsub', dir: 'auto', text: sub }, col);
      });
    }

    function renderChart(i) {
      const c = charts[i];
      const u = ui[i];
      const s = state.entries[i];
      const w = state.width;
      const pw = Math.max(40, w - L - 4);
      const plotH = PLOT_H[state.entries.length > 1 ? 2 : 1];
      const top = CHIP_H, base = top + plotH;
      const H = base + X_LABEL_GAP + X_LABEL_H;
      const to = now(), span = spanMs(i), from = to - span;
      const missing = !s || 'missing' in s;

      clear(u.chips);
      chip(u.chips, i);

      const data = seriesData(i, from, to);
      show(u.svg, !missing && data.drawable);
      // A missing device's chip already says Unavailable, unless the chart has a title of its own.
      show(u.note, missing ? !!c.title : !data.drawable);
      u.note.textContent = missing ? t('unavailable') : t('noHistory');
      geom[i] = null;
      if (missing || !data.drawable) { u.box.classList.add('empty'); return; }
      u.box.classList.remove('empty');

      const svg = u.svg;
      kit.prepareSvg(svg, w, H);
      const x = ms => L + pw * (ms - from) / span;
      const scale = kit.valueScale(svg, { max: data.max, min: data.min, h: plotH, top, pw, format: axisLabel, fit: c.fit });
      xLabels(svg, from, to, pw, top, base);
      kit.axis(svg, top, base, pw);

      const drawn = drawSeries(i, svg, { data, x, scale, top, base });
      geom[i] = drawn.geom;
      if (drawn.cursorX != null) el('svg:path', { class: 'cursor', d: `M${f1(drawn.cursorX)} ${top}V${base}` }, svg);
      if (drawn.dot) drawn.dot(svg);
    }

    /** Two series on one chart (`overlay`): one plot, chart 1's scale on the left and chart 2's on the right. */
    function renderOverlay() {
      const u = ui[0];
      const w = state.width;
      const pw = Math.max(40, w - L - R);
      const plotH = PLOT_H[1];
      const top = CHIP_H, base = top + plotH;
      const H = base + X_LABEL_GAP + X_LABEL_H;
      const to = now(), span = spanMs(0), from = to - span;

      clear(u.chips);
      chip(u.chips, 0);
      chip(u.chips, 1);

      const missing = [0, 1].map(i => !state.entries[i] || 'missing' in state.entries[i]);
      const data = [0, 1].map(i => seriesData(i, from, to));
      const any = data[0].drawable || data[1].drawable;
      show(u.svg, any);
      // Missing devices' chips already say Unavailable, unless a chart has a title of its own.
      show(u.note, !any && missing.some((m, i) => !m || !!charts[i].title));
      u.note.textContent = missing.every(Boolean) ? t('unavailable') : t('noHistory');
      geom[0] = geom[1] = null;
      u.box.classList.toggle('empty', !any);
      if (!any) return;

      const svg = u.svg;
      kit.prepareSvg(svg, w, H);
      const x = ms => L + pw * (ms - from) / span;
      // A side with nothing to draw still gets a scale, so the other series keeps its place.
      const side = d => (d.drawable ? { max: d.max, min: d.min, format: axisLabel } : { max: 1, min: 0, format: () => '' });
      const scales = kit.dualScale(svg, { a: side(data[0]), b: side(data[1]), h: plotH, top, pw, fit: charts[0].fit });
      xLabels(svg, from, to, pw, top, base);
      kit.axis(svg, top, base, pw);

      const bothBars = !!(data[0].bars && data[1].bars && data[0].drawable && data[1].drawable);
      const drawn = data.map((d, i) => {
        if (!d.drawable) return null;
        const g = el('svg:g', { 'data-color': charts[i].color }, svg);
        const r = drawSeries(i, g, { data: d, x, scale: scales[i ? 'b' : 'a'], top, base, half: bothBars ? i : null });
        geom[i] = r.geom;
        return r;
      });
      const cursor = drawn.find(r => r && r.cursorX != null);
      if (cursor) el('svg:path', { class: 'cursor', d: `M${f1(cursor.cursorX)} ${top}V${base}` }, svg);
      // The dots go last, so neither series' trace covers the other's dot.
      drawn.forEach((r, i) => { if (r && r.dot) r.dot(el('svg:g', { 'data-color': charts[i].color }, svg)); });
    }

    /** A chart's title chip, in its colour. */
    function chip(parent, i) {
      const s = state.entries[i];
      const cap = !s || 'missing' in s ? null : s.capability;
      kit.chip(parent, 'series', titleOf(i), cap && cap.units ? cap.units : null);
      parent.lastChild.setAttribute('data-color', charts[i].color);
    }

    /** A series' points (or bars) over `[from, to]`, the display scaling and the range of what's drawn. */
    function seriesData(i, from, to) {
      const s = state.entries[i];
      if (!s || 'missing' in s) return { drawable: false };
      const bars = charts[i].style === 'bars' ? chartBuckets(loggedPoints(i, to), from, to, BAR_MS[charts[i].span], currentOf(i)) : null;
      const pts = bars ? null : pointsOf(i, to);
      const drawable = bars ? bars.some(b => b.v != null) : pts.length >= 2;
      if (!drawable) return { drawable };
      const disp = v => scaled(s.capability, v);
      const values = bars ? bars.filter(b => b.v != null).map(b => disp(b.v)) : pts.map(p => disp(p[1]));
      return { drawable, pts, bars, disp, from, max: Math.max(...values), min: Math.min(...values) };
    }

    /**
     * Series i's tapped item (an index into its bars or points) for this render, from the time kept in
     * `state.sel`: the bar holding it, or the point nearest it. A time that has left the window drops the selection.
     */
    function selectedIndex(i, data) {
      const at = state.sel[i];
      if (at == null) return null;
      let k = null;
      if (at >= data.from) {
        if (data.bars) {
          k = data.bars.findIndex(b => b.v != null && b.t < at && at <= b.end);
          if (k < 0) k = null;
        } else {
          k = 0;
          for (let j = 1; j < data.pts.length; j++) if (Math.abs(data.pts[j][0] - at) < Math.abs(data.pts[k][0] - at)) k = j;
        }
      }
      if (k == null) state.sel[i] = null;
      return k;
    }

    /**
     * Draws series i into `parent` on `scale`. `half` (0 or 1) puts its bars in that half of each bar slot, for
     * two series of bars on one chart. Returns the pointer geometry, the cursor's x (a tapped line point) and
     * `dot(parent)`, which draws the line's dot where the caller wants it.
     */
    function drawSeries(i, parent, { data, x, scale, top, base, half = null }) {
      const c = charts[i];
      const { pts, bars, disp } = data;
      const sel = selectedIndex(i, data);
      const y = v => Math.min(base + 2, Math.max(top - 2, scale.y(v)));
      if (bars) {
        const list = bars.map((b) => {
          const bx = x(b.t), bw = x(b.end) - bx;
          const gap = bw > 6 ? 2 : bw > 3 ? 1 : 0;
          let lx = bx + gap / 2, lw = Math.max(1, bw - gap);
          if (half != null) {
            const inner = lw > 4 ? 1 : 0;
            lw = Math.max(1, (lw - inner) / 2);
            lx += half * (lw + inner);
          }
          return { x: lx, w: lw, v: b.v == null ? null : disp(b.v) };
        });
        kit.bars(parent, { list, y, baseY: scale.baseY, zeroY: scale.zeroY, base, cls: 'series-bars', split: c.negative, selected: sel });
        return { geom: { kind: 'bars', sel, items: bars.map((b, k) => ({ t: b.t, end: b.end, v: b.v, x0: list[k].x, x1: list[k].x + list[k].w })) } };
      }

      const xs = pts.map(p => x(p[0]));
      const vs = pts.map(p => disp(p[1]));
      // With `smooth`, the line (and the dot) follow the smoothed values; the header keeps the real ones.
      const ws = c.smooth ? smoothValues(vs) : vs;
      const xy = ws.map((v, k) => [xs[k], y(v)]);
      const line = C.linePath(xy, c.smooth);
      const area = c.style === 'area'
        ? `${line}L${f1(xs[xs.length - 1])} ${f1(scale.baseY)}L${f1(xs[0])} ${f1(scale.baseY)}Z` : null;
      kit.trace(parent, { line, area, kind: 'series', lineClass: 'series-line', stops: [0.45, 0], zeroY: scale.zeroY, top, base, split: c.negative });
      const idx = sel == null ? xy.length - 1 : Math.min(sel, xy.length - 1);
      return {
        geom: { kind: 'line', xs, sel, items: pts.map(p => ({ t: p[0], v: p[1] })) },
        cursorX: sel != null ? xs[idx] : null,
        dot: g => kit.dot(g, xy[idx][0], xy[idx][1], c.negative && ws[idx] < 0 ? 'series export' : 'series'),
      };
    }

    /**
     * Time labels: up to 6 h relative (`1h · 30m · Now`, as the live power chart), 24 h the clock hours every
     * 6 h, longer spans the weekday at each day's noon; Now always at the right end. Midnights are dashed lines.
     */
    function xLabels(svg, from, to, pw, top, base) {
      const span = to - from;
      const ly = base + X_LABEL_GAP;
      if (span <= 6 * HOUR) {
        kit.text(svg, L, ly, C.ago(span, nf), 'start', 'hanging');
        kit.text(svg, L + pw / 2, ly, C.ago(span / 2, nf), 'middle', 'hanging');
        kit.text(svg, L + pw, ly, t('now'), 'end', 'hanging');
        return;
      }
      const x = ms => L + pw * (ms - from) / span;
      const midnights = [];
      const d = new Date(from);
      d.setHours(24, 0, 0, 0);
      for (; d.getTime() < to; d.setDate(d.getDate() + 1)) midnights.push(d.getTime());
      kit.midnightLines(svg, midnights.map(x), top, base);
      const kept = [{ x: L + pw, cx: L + pw - 15, anchor: 'end', label: t('now') }];
      const candidates = [];
      if (span <= 24 * HOUR) {
        const h = new Date(from);
        h.setMinutes(0, 0, 0);
        for (h.setHours(h.getHours() + 1); h.getTime() < to; h.setHours(h.getHours() + 1)) {
          if (h.getHours() % 6 === 0) candidates.push({ at: h.getTime(), label: h.getHours() + ':00' });
        }
      } else {
        const noon = new Date(from);
        noon.setHours(12, 0, 0, 0);
        if (noon.getTime() < from) noon.setDate(noon.getDate() + 1);
        for (; noon.getTime() < to; noon.setDate(noon.getDate() + 1)) candidates.push({ at: noon.getTime(), label: weekday(noon.getTime()) });
      }
      for (const cnd of candidates) {
        const cx = x(cnd.at);
        if (cx - L >= 18 && kept.every(q => Math.abs(q.cx - cx) >= 40)) kept.push({ x: cx, cx, anchor: 'middle', label: cnd.label });
      }
      for (const q of kept) kit.text(svg, q.x, ly, q.label, q.anchor, 'hanging');
    }

    // ------------------------------------------------------------------ interaction

    /** The point nearest the pointer (a line) or the bar under it, or null. */
    function pick(g, px) {
      if (!g) return null;
      let k = null;
      if (g.kind === 'line') {
        if (px >= L && px <= g.xs[g.xs.length - 1] + 1) {
          k = 0;
          for (let j = 1; j < g.xs.length; j++) if (Math.abs(g.xs[j] - px) < Math.abs(g.xs[k] - px)) k = j;
        }
      } else {
        g.items.forEach((b, j) => { if (b.v != null && px >= b.x0 - 1 && px <= b.x1 + 1) k = j; });
      }
      return k;
    }

    // On one chart, a tap selects both series at that x (two bars in a slot: either half picks the slot).
    const scrubbed = overlay ? [0, 1] : null;
    function scrub(i, e) {
      const px = C.pointerX(e, ui[i].svg);
      let changed = false;
      for (const j of scrubbed || [i]) {
        const g = geom[j];
        let k = pick(g, px);
        if (k == null && overlay && g && g.kind === 'bars') {
          const other = geom[1 - j];
          const o = other && other.kind === 'bars' ? pick(other, px) : null;
          if (o != null && g.items[o] && g.items[o].v != null) k = o;
        }
        // Kept as a time (a bar's end lies inside it, also as the window moves on), not as an index.
        const at = k == null ? null : g.kind === 'bars' ? g.items[k].end : g.items[k].t;
        if (at !== state.sel[j]) { state.sel[j] = at; changed = true; }
      }
      if (changed) render();
    }
    ui.forEach((u, i) => {
      const reset = () => {
        const js = scrubbed || [i];
        if (js.some(j => state.sel[j] != null)) { js.forEach((j) => { state.sel[j] = null; }); render(); }
      };
      C.attachScrub(u.svg, e => scrub(i, e), reset, { timer: null });
    });

    if (typeof ResizeObserver === 'function') {
      new ResizeObserver((entries) => {
        const w = Math.round(entries[0].contentRect.width);
        if (w && w !== state.width) { state.width = w; render(); }
      }).observe(root);
    }

    // The line scrolls with time: about a pixel per redraw, at most once a second.
    const shortest = Math.min(...charts.map((c) => SPAN_MS[c.span]));
    const scrollTimer = setInterval(() => { if (state.entries.length && !state.message) render(); },
      Math.max(1000, Math.min(60e3, shortest / 300)));

    // ------------------------------------------------------------------ public API

    return {
      /** One entry per chart, in order. Live points newer than a refreshed history are kept (it's cached up to 5 min). */
      setState(list, lang) {
        if (lang) language = lang;
        const previous = state.entries;
        state.entries = (Array.isArray(list) ? list : []).slice(0, charts.length).map((s, i) => {
          if (!s || 'missing' in s) return s || { missing: true };
          const points = Array.isArray(s.points) ? s.points.slice() : [];
          const old = previous[i] && !('missing' in previous[i]) && previous[i].deviceId === s.deviceId
            && previous[i].capabilityId === s.capabilityId ? previous[i].points : [];
          const after = points.length ? points[points.length - 1][0] : -Infinity;
          return { ...s, points: points.concat(old.filter(p => p[0] > after)) };
        });
        state.message = null;
        render();
      },
      /** A realtime value (Device Values' `values:state`): appended to every chart that shows it. */
      pushChange({ deviceId, capabilityId, value }) {
        let changed = false;
        const at = now();
        state.entries.forEach((s, i) => {
          if (!s || 'missing' in s || s.deviceId !== deviceId || s.capabilityId !== capabilityId) return;
          s.value = value;
          if (typeof value === 'number' && isFinite(value)) {
            s.points.push([at, value]);
            while (s.points.length && s.points[0][0] < at - spanMs(i)) s.points.shift();
          }
          changed = true;
        });
        if (changed) render();
      },
      /** A message in place of the charts, or with `transient` under them for 8 s (a failed refresh). */
      setMessage(text, transient) {
        if (messageTimer) clearTimeout(messageTimer);
        messageTimer = null;
        if (transient) {
          state.transient = text;
          messageTimer = setTimeout(() => { state.transient = null; render(); }, 8000);
        } else {
          state.message = text;
          state.entries = [];
        }
        render();
      },
      render,
      t,
      destroy() { clearInterval(scrollTimer); },
    };
  }

  window.createChartsWidget = createChartsWidget;
  window.chartBuckets = chartBuckets;
})();
