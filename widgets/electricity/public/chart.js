/*
 * The chart drawing shared by the Electricity Overview and Charts widgets: scales, traces, bars, dots, chips,
 * the export (below zero) split and the tap-to-inspect wiring. Plain browser JS (served as-is), on
 * `window.WidgetkeeperChart`. Charts loads it from here (`../electricity/chart.js`), as does the Smart Stack.
 * The class names are the Electricity Overview's (chart.css, scoped by `.ew`), so its markup didn't change.
 */
(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const MIN = 60e3;
  const HOUR = 60 * MIN;

  const L = 38; // left gutter
  const X_LABEL_GAP = 5;
  const X_LABEL_H = 14;
  const LABEL_PAD = 8; // y label ↔ axis
  const LABEL_MIN_GAP = 16; // min vertical distance between y labels
  const SMOOTH_PASSES = 6; // `smooth`: averaging passes over a trace
  const STEP_RADIUS = 5; // `smooth`: corner radius on step lines
  const TOUCH_HOLD_MS = 3000; // a touch selection stays this long after the finger lifts

  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
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

  /** A whole line through `pts`: straight segments, or with `smooth` the monotone cubic. */
  function linePath(pts, smooth) {
    return `M${f1(pts[0][0])} ${f1(pts[0][1])}` + (smooth
      ? monotonePath(pts) : pts.slice(1).map(([x, y]) => `L${f1(x)} ${f1(y)}`).join(''));
  }

  /** A step line through `pts`: straight corners, or with `smooth` rounded ones. */
  function stepPath(pts, smooth) {
    return `M${f1(pts[0][0])} ${f1(pts[0][1])}` + (smooth
      ? roundedPath(pts, STEP_RADIUS) : pts.slice(1).map(([x, y]) => `L${f1(x)} ${f1(y)}`).join(''));
  }

  /** 98.5th percentile, used to size usage scales so single spikes don't flatten the trace. */
  function p985(values) {
    const v = [...values].sort((a, b) => a - b);
    return v.length ? v[Math.min(v.length - 1, Math.floor(v.length * 0.985))] : 1;
  }

  /** 1.5th percentile, or 0 when that's not negative: how far a usage scale reaches below zero (solar export). */
  function p015(values) {
    const v = [...values].sort((a, b) => a - b);
    return v.length ? Math.min(0, v[Math.floor(v.length * 0.015)]) : 0;
  }

  /** `nf(v)` with thousands as k and a real minus sign: −1,5k, 850, 12k. */
  function compactNumber(nf, v) {
    return v < 0 ? '−' + compactNumber(nf, -v)
      : v >= 1000 ? nf(v / 1000, v % 1000 ? 1 : 0) + 'k' : nf(Math.round(v));
  }

  /** Relative time-axis label: 1h, 30m, 2,5m, 30s. `nf(v, decimals)` formats the number. */
  function ago(ms, nf) {
    return ms >= HOUR && ms % HOUR === 0 ? `${ms / HOUR}h`
      : ms >= MIN ? `${nf(ms / MIN, ms % MIN ? 1 : 0)}m`
        : `${Math.round(ms / 1000)}s`;
  }

  /**
   * The SVG drawing functions of one widget. Gradient and clip ids are unique per kit, so several
   * widgets can share a page (the Smart Stack).
   */
  function createKit() {
    let counter = 0;
    const uid = 'ew' + Math.random().toString(36).slice(2, 7);

    function text(svg, x, y, label, anchor, baseline) {
      return el('svg:text', { x: f1(x), y: f1(y), 'text-anchor': anchor, 'dominant-baseline': baseline, text: label }, svg);
    }

    function gradient(svg, cls, stops, attrs) {
      const id = `${uid}g${++counter}`;
      const defs = el('svg:defs', null, svg);
      const g = el('svg:linearGradient', { id, x1: 0, y1: 0, x2: 0, y2: 1, ...attrs }, defs);
      for (const [offset, opacity] of stops) el('svg:stop', { class: cls, offset, 'stop-opacity': opacity }, g);
      return `url(#${id})`;
    }

    function dot(svg, x, y, kind, small) {
      el('svg:circle', { class: `dot-ring ${kind}`, cx: f1(x), cy: f1(y), r: small ? 6.5 : 7 }, svg);
      el('svg:circle', { class: `dot-core ${kind}`, cx: f1(x), cy: f1(y), r: small ? 3.5 : 4 }, svg);
    }

    /** A chart's title chip: a coloured dot (`kind`), the label and ` – unit`. */
    function chip(parent, kind, label, unit) {
      const c = el('span', { class: `ew-chip ${kind}` }, parent);
      el('i', null, c);
      const s = el('span', { text: label }, c);
      if (unit) el('span', { class: 'unit', text: ` – ${unit}` }, s);
    }

    /**
     * Draws `draw(clip, exp)` twice when a scale reaches below zero: clipped above `zeroY`
     * as usual, and below it with the `export` look (yellow). Otherwise once, unclipped.
     */
    function exportSplit(svg, zeroY, base, draw) {
      if (!(zeroY < base)) { draw(null, false); return; }
      const defs = el('svg:defs', null, svg);
      const clip = (y, h) => {
        const id = `${uid}c${++counter}`;
        el('svg:rect', { x: -1000, y: f1(y), width: 1e4, height: f1(h) }, el('svg:clipPath', { id }, defs));
        return `url(#${id})`;
      };
      draw(clip(-1000, zeroY + 1000), false);
      draw(clip(zeroY, 1000), true);
    }

    function prepareSvg(svg, w, h) {
      clear(svg);
      svg.setAttribute('width', w);
      svg.setAttribute('height', h);
      svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    }

    /** The left axis and the plot's base line, with the tick left of the base. */
    function axis(svg, top, base, pw) {
      el('svg:path', { class: 'axis', d: `M${L} ${top - 6}V${base}H${L + pw}M${L - 6} ${base}H${L}` }, svg);
    }

    /** Dashed vertical lines at the x positions given (midnights). */
    function midnightLines(svg, xs, top, base) {
      const d = xs.map(x => `M${f1(x)} ${top - 6}V${base}`).join('');
      if (d) el('svg:path', { class: 'midnight', d }, svg);
    }

    /**
     * The left value scale for a plot of height `h` starting at `top`: grid, thinned labels (`format(v, step)`).
     * From zero (`fit` off): 0 at the base, and a negative `min` extends it below zero in whole steps, with a
     * zero line. With `fit`, it runs in whole steps from just below `min` to just above `max`; a zero line
     * shows when that range crosses zero. Returns `y(v)`, `zeroY` (the y of 0, which may lie outside the plot),
     * `baseY` (where areas and bars close: 0, or the nearer edge when 0 is outside) and the axis range.
     */
    function valueScale(svg, { max, min = 0, h, top, pw, rightExt = 0, format, fit = false }) {
      if (fit) return fitScale(svg, { max, min, h, top, pw, rightExt, format });
      min = Math.min(0, min); // from zero: 0 is always on the scale
      max = Math.max(0, max);
      if (max === min) max = 1;
      const step = niceStep((max - min) / 3);
      const kPos = Math.ceil(max / step - 1e-9), kNeg = Math.ceil(-min / step - 1e-9), k = kPos + kNeg;
      const axisMax = step * kPos, axisMin = -step * kNeg;
      const y = kNeg
        ? v => Math.min(top + h + 2, top + h * (1 - (v - axisMin) / (axisMax - axisMin)))
        : v => top + h * (1 - Math.max(0, v) / axisMax);
      let grid = '';
      const every = Math.max(1, Math.ceil(LABEL_MIN_GAP / (h / k)));
      for (let j = 0; j <= k; j++) {
        const v = axisMin + step * j;
        if (j > 0) grid += `M${L - 6} ${f1(y(v))}H${L + pw + rightExt}`;
        if ((kNeg ? j - kNeg : k - j) % every === 0) text(svg, L - LABEL_PAD, y(v), format(v, step), 'end', 'central');
      }
      el('svg:path', { class: 'grid', d: grid }, svg);
      const zeroY = y(0);
      if (kNeg) el('svg:path', { class: 'axis', d: `M${L - 6} ${f1(zeroY)}H${L + pw + rightExt}` }, svg);
      return { y, axisMax, axisMin, zeroY, baseY: zeroY, step };
    }

    function fitScale(svg, { max, min, h, top, pw, rightExt, format }) {
      let step, axisMin, k;
      if (max === min) {
        // Flat: one small step either side, so the line sits in the middle.
        step = niceStep(Math.abs(max) / 20 || 1);
        axisMin = max - step;
        k = 2;
      } else {
        step = niceStep((max - min) / 3);
        const kLo = Math.floor(min / step + 1e-9);
        axisMin = kLo * step;
        k = Math.ceil(max / step - 1e-9) - kLo;
      }
      const axisMax = axisMin + k * step;
      const y = v => top + h * (1 - (v - axisMin) / (axisMax - axisMin));
      const crosses = axisMin < 0 && axisMax > 0;
      const jZero = Math.round(-axisMin / step); // the zero line's index, when it crosses
      let grid = '';
      const every = Math.max(1, Math.ceil(LABEL_MIN_GAP / (h / k)));
      for (let j = 0; j <= k; j++) {
        const v = axisMin + j * step;
        if (j > 0) grid += `M${L - 6} ${f1(y(v))}H${L + pw + rightExt}`;
        if ((crosses ? j - jZero : k - j) % every === 0) text(svg, L - LABEL_PAD, y(v), format(v, step), 'end', 'central');
      }
      el('svg:path', { class: 'grid', d: grid }, svg);
      const zeroY = y(0);
      if (crosses) el('svg:path', { class: 'axis', d: `M${L - 6} ${f1(zeroY)}H${L + pw + rightExt}` }, svg);
      const baseY = axisMin >= 0 ? top + h : axisMax <= 0 ? top : zeroY;
      return { y, axisMax, axisMin, zeroY, baseY, step };
    }

    /**
     * Two value scales on one plot (Charts' two series on one chart): `a` on the left, `b` on the right
     * (each `{max, min, format}`), on one shared grid. From zero (`fit` off), as the Electricity Overview's
     * price and usage scales: each side its own step, sharing the zero line and the steps above and below it.
     * With `fit`, side a fits as `valueScale` does and b fits the same number of steps. Also draws the right
     * axis. Returns `{a, b}`, each with `y(v)`, `zeroY`, `baseY` and the axis range.
     */
    function dualScale(svg, { a, b, h, top, pw, fit = false }) {
      const sides = fit ? fitPair(a, b) : zeroPair(a, b);
      const { k, anchor } = sides;
      const xr = L + pw + 6;
      const every = Math.max(1, Math.ceil(LABEL_MIN_GAP / (h / k)));
      const side = (s) => {
        const axisMax = s.axisMin + k * s.step;
        const y = v => top + h * (1 - (v - s.axisMin) / (axisMax - s.axisMin));
        const zeroY = y(0);
        const crosses = s.axisMin < 0 && axisMax > 0;
        const baseY = s.axisMin >= 0 ? top + h : axisMax <= 0 ? top : zeroY;
        return { y, zeroY, baseY, axisMin: s.axisMin, axisMax, step: s.step, crosses };
      };
      const out = { a: side(sides.a), b: side(sides.b) };
      let grid = '';
      for (let j = 0; j <= k; j++) {
        const yy = out.a.y(sides.a.axisMin + j * sides.a.step);
        if (j > 0) grid += `M${L - 6} ${f1(yy)}H${xr}`;
        if ((anchor == null ? k - j : j - anchor) % every !== 0) continue;
        text(svg, L - LABEL_PAD, yy, a.format(sides.a.axisMin + j * sides.a.step, sides.a.step), 'end', 'central');
        text(svg, L + pw + LABEL_PAD, yy, b.format(sides.b.axisMin + j * sides.b.step, sides.b.step), 'start', 'central');
      }
      el('svg:path', { class: 'grid', d: grid }, svg);
      // Zero lines: one shared from zero; with `fit`, each side's own where its range crosses zero.
      const zeros = [...new Set([out.a, out.b].filter(s => s.crosses).map(s => f1(s.zeroY)))];
      for (const zy of zeros) el('svg:path', { class: 'axis', d: `M${L - 6} ${zy}H${xr}` }, svg);
      el('svg:path', { class: 'axis', d: `M${L + pw} ${top - 6}V${top + h}H${xr}` }, svg);
      return out;
    }

    /** From zero: `{a, b}` as `{step, axisMin}`, `k` steps in all, `anchor` the zero line's index (or null). */
    function zeroPair(a, b) {
      const span = s => {
        const lo = Math.min(0, s.min), hi = Math.max(0, s.max);
        return hi === lo ? { lo, hi: 1 } : { lo, hi };
      };
      const A = span(a), B = span(b);
      const stepA = niceStep((A.hi - A.lo) / 3);
      let kPos = Math.ceil(A.hi / stepA - 1e-9), kNeg = Math.ceil(-A.lo / stepA - 1e-9);
      let stepB;
      if ((B.lo < 0 && !kNeg) || (B.hi > 0 && !kPos)) {
        // b needs a side a doesn't have: both get as many steps as either needs.
        stepB = niceStep((B.hi - B.lo) / 3);
        kPos = Math.max(kPos, Math.ceil(B.hi / stepB - 1e-9));
        kNeg = Math.max(kNeg, Math.ceil(-B.lo / stepB - 1e-9));
      } else {
        stepB = niceStep(Math.max(kPos ? B.hi / kPos : 0, kNeg ? -B.lo / kNeg : 0));
      }
      return { a: { step: stepA, axisMin: -stepA * kNeg }, b: { step: stepB, axisMin: -stepB * kNeg }, k: kPos + kNeg, anchor: kNeg ? kNeg : null };
    }

    /** Fitted: a as `fitScale`, b in the same number of steps (its step raised until its values fit). */
    function fitPair(a, b) {
      let stepA, minA, k;
      if (a.max === a.min) {
        stepA = niceStep(Math.abs(a.max) / 20 || 1);
        minA = a.max - stepA;
        k = 2;
      } else {
        stepA = niceStep((a.max - a.min) / 3);
        const kLo = Math.floor(a.min / stepA + 1e-9);
        minA = kLo * stepA;
        k = Math.ceil(a.max / stepA - 1e-9) - kLo;
      }
      let stepB, minB;
      if (b.max === b.min) {
        stepB = niceStep(Math.abs(b.max) / 20 || 1);
        minB = (Math.round(b.max / stepB) - Math.floor(k / 2)) * stepB;
      } else {
        stepB = niceStep((b.max - b.min) / k);
        for (;;) {
          minB = Math.floor(b.min / stepB + 1e-9) * stepB;
          if (minB + k * stepB >= b.max - 1e-9) break;
          stepB = niceStep(stepB * 1.001);
        }
      }
      const maxA = minA + k * stepA;
      const anchor = minA < 0 && maxA > 0 ? Math.round(-minA / stepA) : null;
      return { a: { step: stepA, axisMin: minA }, b: { step: stepB, axisMin: minB }, k, anchor };
    }

    /**
     * A trace: its area (`area`, a closed path; none for a bare line) with a gradient fading from `stops[0]`
     * to `stops[1]` in `${kind}-stop`, then the line in `lineClass`. With `split` and a scale below zero,
     * each side is drawn on its own (`exportSplit`), the part below zero yellow and fading towards the zero line.
     * `fill` is the plain gradient when the caller made it already.
     */
    function trace(svg, { line, area, kind, lineClass, stops, zeroY, top, base, split = true, fill }) {
      const [a, b] = stops || [0.45, 0];
      const stopClass = `${kind}-stop`;
      const run = split ? (draw) => exportSplit(svg, zeroY, base, draw) : (draw) => draw(null, false);
      if (area) {
        run((clip, exp) => {
          const f = !clip ? fill || gradient(svg, stopClass, [[0, a], [1, b]])
            : gradient(svg, exp ? `${stopClass} export` : stopClass, [[0, exp ? b : a], [1, exp ? a : b]],
              { gradientUnits: 'userSpaceOnUse', x1: 0, x2: 0, y1: f1(exp ? zeroY : top), y2: f1(exp ? base : zeroY) });
          el('svg:path', { d: area, fill: f, 'clip-path': clip }, svg);
        });
      }
      run((clip, exp) => {
        el('svg:path', { class: `${lineClass}${exp ? ' export' : ''}`, d: line, 'clip-path': clip }, svg);
      });
    }

    /**
     * Bars (`{x, w, v}`, x their left edge) from `baseY` to `y(v)`, in `cls`. With `split` and a scale below
     * zero, the parts below zero are drawn in `${cls} export`. `selected` (an index) is drawn at full strength.
     */
    function bars(svg, { list, y, baseY, zeroY, base, cls, split = false, selected = null }) {
      const draw = (clip, exp) => {
        const g = el('svg:g', { class: `${cls}${exp ? ' export' : ''}`, 'clip-path': clip }, svg);
        list.forEach((bar, i) => {
          if (bar.v == null) return;
          const yv = y(bar.v);
          const y0 = Math.min(yv, baseY), hh = Math.max(1, Math.abs(yv - baseY));
          el('svg:rect', { class: i === selected ? 'bar selected' : 'bar', x: f1(bar.x), y: f1(y0), width: f1(bar.w), height: f1(hh), rx: Math.min(2, bar.w / 4) }, g);
        });
      };
      if (split) exportSplit(svg, zeroY, base, draw); else draw(null, false);
    }

    return { uid, text, gradient, dot, chip, exportSplit, prepareSvg, axis, midnightLines, valueScale, dualScale, trace, bars };
  }

  /**
   * Tap-to-inspect on a chart's persistent <svg>. Mouse: `scrub` on hover, `reset` on leave. Touch: a tap or
   * drag selects; the selection stays TOUCH_HOLD_MS after the finger lifts. That also makes taps work on Homey's
   * Android app, whose dashboard takes over a drag (pointercancel) about 100 ms in, whatever the page does.
   * Charts that share a selection share one `hold` ({timer}).
   */
  function attachScrub(svg, scrub, reset, hold) {
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

  /** The pointer's x in the <svg>'s own coordinates. */
  const pointerX = (e, svg) => e.clientX - svg.getBoundingClientRect().left;

  window.WidgetkeeperChart = {
    MIN, HOUR, L, X_LABEL_GAP, X_LABEL_H, LABEL_PAD, LABEL_MIN_GAP, TOUCH_HOLD_MS,
    niceStep, el, clear, show, f1, smoothValues, monotonePath, roundedPath, linePath, stepPath, p985, p015,
    compactNumber, ago, createKit, attachScrub, pointerX,
  };
})();
