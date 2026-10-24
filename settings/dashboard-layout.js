/*
 * Wide widgets on the web dashboards (`settings/dashboard.js` loads this first): a widget with `span` covers its own
 * column and the `span - 1` to its right; `at[j]` is, in the j-th of those, the index of that column's widget it sits
 * before (the column's length: under them all). So each column keeps its own widgets above and below it.
 *
 * The page edits columns with a cover `{cover: <id>}` in each column a wide widget covers (`expand()`), so moving,
 * adding and removing widgets carries the covers along; it stores them as `at` again (`collapse()`). `place()` is where
 * every entry goes: tops from the widgets' heights.
 */
(function () {
  'use strict';

  /** How many columns a widget covers, within the `count` there are from its column `c`. */
  const spanOf = (w, c, count) => (w && w.span > 1 ? Math.max(1, Math.min(Math.round(w.span), count - c)) : 1);

  /** The columns with a cover where each wide widget sits in the columns it covers (widgets stay the same objects). */
  function expand(columns) {
    const out = [];
    columns.forEach((column, k) => {
      const real = column.filter(w => w && !w.cover);
      // The wide widgets reaching this column from the left, in the order the column before has them (ties keep it).
      const covers = [];
      for (let c = 0; c < k; c++) {
        for (const w of columns[c]) {
          if (!w || w.cover || c + spanOf(w, c, columns.length) - 1 < k) continue;
          const at = Array.isArray(w.at) ? Number(w.at[k - c - 1]) : NaN;
          const before = out[k - 1].findIndex(e => (e.cover || e.id) === w.id);
          covers.push({ id: w.id, at: Number.isFinite(at) ? Math.max(0, Math.min(Math.round(at), real.length)) : real.length, before });
        }
      }
      covers.sort((a, b) => a.at - b.at || a.before - b.before);
      const list = [];
      let n = 0;
      for (let i = 0; i <= real.length; i++) {
        while (n < covers.length && covers[n].at === i) list.push({ cover: covers[n++].id });
        if (i < real.length) list.push(real[i]);
      }
      out.push(list);
    });
    return out;
  }

  /**
   * The columns without covers, each wide widget's `at` from where its covers are (a copy of it; the others stay the
   * same objects). A span past the last column is cut; a widget of one column has neither field.
   */
  function collapse(columns) {
    const out = columns.map(column => column.filter(e => e && !e.cover));
    out.forEach((column, c) => column.forEach((w, i) => {
      const span = spanOf(w, c, columns.length);
      if (span < 2) {
        if ('span' in w || 'at' in w) {
          const copy = { ...w };
          delete copy.span;
          delete copy.at;
          column[i] = copy;
        }
        return;
      }
      const at = [];
      for (let k = c + 1; k < c + span; k++) {
        const j = columns[k].findIndex(e => e && e.cover === w.id);
        at.push(j < 0 ? out[k].length : columns[k].slice(0, j).filter(e => e && !e.cover).length);
      }
      column[i] = { ...w, span, at };
    }));
    return out;
  }

  /**
   * Where each entry of the expanded columns goes: per column, `{entry, top, margin, height, hidden}` in its order.
   * `margin` is the room above it besides the column's gap (what a wide widget waits for). A wide widget goes once it
   * heads every column it covers, at the lowest of their bottoms. A cover left over by a cycle (only in hand-made
   * data: a widget placed before its turn in another column) or of a widget that isn't there is `hidden`.
   */
  function place(columns, heightOf, gap) {
    const count = columns.length;
    const wide = new Map(); // id → {w, c, span}
    columns.forEach((column, c) => column.forEach((e) => {
      if (e && !e.cover && spanOf(e, c, count) > 1) wide.set(e.id, { w: e, c, span: spanOf(e, c, count) });
    }));
    const out = columns.map(() => []);
    const p = columns.map(() => 0);
    const y = columns.map(() => 0);
    const placed = new Set();
    const idOf = e => (e.cover || e.id);
    const put = (k, entry, top, height, hidden = false) => {
      out[k].push({ entry, top, margin: hidden ? 0 : top - y[k], height: hidden ? 0 : height, hidden });
      if (!hidden) y[k] = top + height + gap;
      p[k] += 1;
    };
    for (;;) {
      // Every column down to its next wide widget (or cover).
      columns.forEach((column, k) => {
        while (p[k] < column.length) {
          const e = column[p[k]];
          const id = idOf(e);
          if (e.cover && (!wide.has(id) || placed.has(id) || !covers(wide.get(id), k))) { put(k, e, y[k], 0, true); continue; }
          if (wide.has(id) && (e.cover || !placed.has(id))) break;
          put(k, e, y[k], heightOf(e));
        }
      });
      const heads = [];
      columns.forEach((column, k) => { if (p[k] < column.length) heads.push(idOf(column[p[k]])); });
      if (!heads.length) break;
      // The first wide widget heading all its columns; failing that (a cycle), the leftmost column's, always a widget
      // itself (a cover's widget is to its left, so it'd be placed or heading a column further left).
      const ready = heads.find(id => { const o = wide.get(id); return cols(o).every(k => p[k] < columns[k].length && idOf(columns[k][p[k]]) === id); });
      const o = wide.get(ready || heads[0]);
      const here = cols(o).filter(k => p[k] < columns[k].length && idOf(columns[k][p[k]]) === o.w.id);
      const top = Math.max(...here.map(k => y[k]));
      const height = heightOf(o.w);
      for (const k of here) put(k, columns[k][p[k]], top, height);
      placed.add(o.w.id);
    }
    return out;

    function cols(o) { return Array.from({ length: o.span }, (_, j) => o.c + j); }
    function covers(o, k) { return k > o.c && k < o.c + o.span; }
  }

  window.WidgetkeeperLayout = { spanOf, expand, collapse, place };
}());
