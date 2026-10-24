import { describe, expect, it } from 'vitest';
import { runFile } from './helpers/loadWidget.js';

// settings/dashboard-layout.js as the page loads it: it puts WidgetkeeperLayout on window.
const win: any = {};
runFile('settings/dashboard-layout.js', { window: win });
const { expand, collapse, place } = win.WidgetkeeperLayout;

const W = (id: string, extra = {}) => ({ id, type: 'clock', ...extra });
const ids = (columns: any[][]) => columns.map(col => col.map(e => (e.cover ? `^${e.cover}` : e.id)));

describe('web dashboards: wide widgets', () => {
  it('puts a cover where a wide widget sits in each column it covers, and back', () => {
    const columns = [
      [W('a'), W('wide', { span: 3, at: [1, 0] })],
      [W('b'), W('c')],
      [W('d')],
    ];
    const expanded = expand(columns);
    expect(ids(expanded)).toEqual([['a', 'wide'], ['b', '^wide', 'c'], ['^wide', 'd']]);
    expect(expanded[0][1]).toBe(columns[0][1]); // the same object
    expect(collapse(expanded)).toEqual(columns);
  });

  it('keeps two covers at one index in the order of the column before', () => {
    const columns = [
      [W('x', { span: 3, at: [0, 0] }), W('y', { span: 3, at: [1, 0] })],
      [W('b')],
      [],
    ];
    expect(ids(expand(columns))).toEqual([['x', 'y'], ['^x', 'b', '^y'], ['^x', '^y']]);
    columns[1].length = 0;
    columns[0][1].at = [0, 0];
    expect(ids(expand(columns))).toEqual([['x', 'y'], ['^x', '^y'], ['^x', '^y']]);
  });

  it('writes at from where the covers moved, and drops what a narrow widget no longer needs', () => {
    const expanded = [[W('w', { span: 2, at: [0] }), W('n', { span: 1, at: [3] })], [W('b'), W('c'), { cover: 'w' }]];
    expect(collapse(expanded)).toEqual([[W('w', { span: 2, at: [2] }), W('n')], [W('b'), W('c')]]);
    // Fewer columns than its span: cut to what's there.
    expect(collapse([[W('w', { span: 3, at: [0, 0] })], [{ cover: 'w' }]])).toEqual([[W('w', { span: 2, at: [0] })], []]);
  });

  it('places a wide widget under the lowest column above it, and the columns on under it', () => {
    const h: Record<string, number> = { a: 100, b: 50, c: 30, wide: 200, d: 10 };
    const columns = expand([
      [W('a'), W('wide', { span: 2, at: [1] })],
      [W('b'), W('c')],
      [W('d')],
    ]);
    const out = place(columns, (e: any) => h[e.id], 10);
    const at = (k: number) => out[k].map((p: any) => [p.entry.cover ? `^${p.entry.cover}` : p.entry.id, p.top, p.margin, p.height]);
    expect(at(0)).toEqual([['a', 0, 0, 100], ['wide', 110, 0, 200]]);
    expect(at(1)).toEqual([['b', 0, 0, 50], ['^wide', 110, 50, 200], ['c', 320, 0, 30]]);
    expect(at(2)).toEqual([['d', 0, 0, 10]]);
  });

  it('places nothing differently without a wide widget', () => {
    const out = place([[W('a'), W('b')], [W('c')]], () => 40, 8);
    expect(out.map((col: any[]) => col.map(p => [p.top, p.margin]))).toEqual([[[0, 0], [48, 0]], [[0, 0]]]);
  });

  it('always ends: a cycle, a cover of nothing, a cover where its widget does not reach', () => {
    // a sits under y in column 1, but above it in column 2.
    const columns = [
      [W('a', { span: 3 }), W('y', { span: 3 })],
      [{ cover: 'y' }, { cover: 'a' }],
      [{ cover: 'a' }, { cover: 'y' }, { cover: 'ghost' }],
      [{ cover: 'a' }],
    ];
    const out = place(columns, () => 20, 0);
    expect(out.map((col: any[]) => col.length)).toEqual([2, 2, 3, 1]);
    expect(out[2][2].hidden).toBe(true);
    expect(out[3][0].hidden).toBe(true);
  });
});
