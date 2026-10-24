// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('pollen'); });
afterEach(() => { document.body.innerHTML = ''; });

const SIX = ['alder', 'birch', 'olive', 'grass', 'mugwort', 'ragweed'];
const p = (value: number, level: number) => ({ value, level });
const none = Object.fromEntries(SIX.map(t => [t, p(0, 0)]));

function day(date: string, pollen: Record<string, unknown>, uv: any = { max: 6.1, level: 3, at: Date.parse(`${date}T11:00:00Z`) }) {
  return { date, pollen: { ...none, ...pollen }, uv };
}

const JUNE = {
  language: 'en', outside: false, uvNow: 3,
  days: [
    day('2026-06-15', { birch: p(4, 1), grass: p(64, 3) }),
    day('2026-06-16', { birch: p(2, 1), grass: p(38, 2) }, { max: 4.8, level: 2, at: Date.parse('2026-06-16T11:00:00Z') }),
    day('2026-06-17', { grass: p(120, 3), mugwort: p(3, 1) }, { max: 7.2, level: 3, at: Date.parse('2026-06-17T12:00:00Z') }),
    day('2026-06-18', { grass: p(22, 2), mugwort: p(12, 2) }, null),
  ],
};

function widget(data: any = JUNE, opts: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createPollenWidget(root, { locale: 'en-GB', timeFormat: '24', ...opts });
  if (data) w.setData(data);
  const text = (sel: string) => root.querySelector(sel)?.textContent ?? null;
  const rows = () => [...root.querySelectorAll<HTMLElement>('.pw-row')];
  return { w, root, text, rows };
}

describe('pollenTypes()', () => {
  it('reads the checkboxes, a missing one as its default (birch, grass, mugwort)', () => {
    expect(win.pollenTypes({})).toEqual(['birch', 'grass', 'mugwort']);
    expect(win.pollenTypes({ showAlder: true, showGrass: false, showRagweed: true })).toEqual(['alder', 'birch', 'mugwort', 'ragweed']);
  });
});

describe('compact', () => {
  it("shows today's UV peak and when, then a row per type with its level", () => {
    const { text, rows, root } = widget();
    expect(text('.pw-uv-value')).toBe('UV 6');
    expect(text('.pw-uv-level')).toBe('High');
    expect(text('.pw-uv-peak')).toBe(`· peak at ${new Intl.DateTimeFormat('en-GB', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23' }).format(new Date(JUNE.days[0].uv.at))}`);
    expect(root.querySelector<HTMLElement>('.pw-uv')!.dataset.level).toBe('3');
    expect(rows().map(r => [r.dataset.type, r.querySelector('.pw-name')!.textContent, r.querySelector('.pw-word')!.textContent, r.dataset.level]))
      .toEqual([['birch', 'Birch', 'Low', '1'], ['grass', 'Grass', 'High', '3'], ['mugwort', 'Mugwort', 'None', '0']]);
    // The bar is lit up to the level.
    expect(rows()[1].querySelectorAll('.pw-bar i.on')).toHaveLength(3);
    expect(rows()[1].querySelectorAll('.pw-bar i')).toHaveLength(4);
    expect(root.querySelector('.pw-grains')).toBeNull();
    expect(root.querySelector('.pw-days')).toBeNull();
    expect(rows().every(r => r.querySelector('svg.pw-icon path'))).toBe(true);
  });

  it('shows the types picked, in their order, and the time in 12 hours when set', () => {
    const withAlder = { ...JUNE, days: [day('2026-06-15', { alder: p(40, 2) }), ...JUNE.days.slice(1)] };
    const { rows, text } = widget(withAlder, { types: ['ragweed', 'alder', 'nope'], timeFormat: '12' });
    expect(rows().map(r => r.dataset.type)).toEqual(['ragweed', 'alder']);
    expect(text('.pw-uv-peak')).toMatch(/pm/i);
  });

  it("writes the peak time in Homey's language when the screen gives no locale", () => {
    const { text } = widget({ ...JUNE, language: 'da' }, { locale: undefined, timeFormat: undefined });
    const at = new Date(JUNE.days[0].uv.at);
    expect(text('.pw-uv-peak')).toBe(`· peak at ${new Intl.DateTimeFormat('da', { hour: 'numeric', minute: '2-digit' }).format(at)}`);
  });

  it('leaves the UV out when switched off, and shows only the UV without types', () => {
    expect(widget(JUNE, { showUv: false }).root.querySelector('.pw-uv')).toBeNull();
    const uvOnly = widget(JUNE, { types: [] });
    expect(uvOnly.root.querySelector('.pw-uv')).not.toBeNull();
    expect(uvOnly.rows()).toHaveLength(0);
    expect(uvOnly.root.querySelector('.pw-sep')).toBeNull();
  });

  it('asks for a choice when there is nothing to show', () => {
    expect(widget(JUNE, { types: [], showUv: false }).text('.pw-message')).toBe('Choose what to show in the widget settings.');
  });
});

describe('detailed', () => {
  it('adds the grains (not under None), the UV now and the next three days', () => {
    const { rows, text, root } = widget(JUNE, { density: 'detailed' });
    expect(rows().map(r => r.querySelector('.pw-grains')?.textContent ?? null)).toEqual(['4 /m³', '64 /m³', null]);
    expect(text('.pw-uv-peak')).toMatch(/· now 3$/);
    const days = root.querySelector<HTMLElement>('.pw-days')!;
    expect([...days.querySelectorAll('.pw-day')].map(d => d.textContent)).toEqual(['Tue', 'Wed', 'Thu']);
    // Birch, grass, mugwort: a dot and the level in words each, None as a dash (its word as the title).
    const cells = [...days.querySelectorAll<HTMLElement>('.pw-cell')]
      .map(c => [c.dataset.level, c.querySelector('.pw-cell-word')!.textContent, c.title, c.querySelectorAll('i').length]);
    expect(cells).toEqual([
      ['1', 'Low', 'Low', 1], ['0', '–', 'None', 1], ['0', '–', 'None', 1],
      ['2', 'Moderate', 'Moderate', 1], ['3', 'High', 'High', 1], ['2', 'Moderate', 'Moderate', 1],
      ['0', '–', 'None', 1], ['1', 'Low', 'Low', 1], ['2', 'Moderate', 'Moderate', 1],
    ]);
    // The UV peaks as plain numbers (none on the last day).
    expect([...days.querySelectorAll('.pw-cell-uv')].map(c => c.textContent)).toEqual(['5', '7', '–']);
  });
});

describe('messages', () => {
  it('says the forecast only covers Europe, with the UV still shown', () => {
    const outside = { ...JUNE, outside: true, days: JUNE.days.map(d => ({ ...d, pollen: Object.fromEntries(SIX.map(t => [t, null])) })) };
    const { text, rows } = widget(outside);
    expect(text('.pw-note')).toBe('Pollen forecasts only cover Europe.');
    expect(text('.pw-uv-value')).toBe('UV 6');
    expect(rows()).toHaveLength(0);
  });

  it('says there is no pollen today out of season, but shows the rows when Detailed has pollen coming', () => {
    const season = { ...JUNE, days: [day('2026-03-01', {}), day('2026-03-02', {}), day('2026-03-03', { birch: p(12, 1) })] };
    expect(widget(season).text('.pw-note')).toBe('No pollen in the air today.');
    const detailed = widget(season, { density: 'detailed' });
    expect(detailed.text('.pw-note')).toBeNull();
    expect(detailed.rows()).toHaveLength(3);
    // Only the types shown count.
    expect(widget(season, { types: ['grass'], density: 'detailed' }).text('.pw-note')).toBe('No pollen in the air today.');
  });

  it("asks for Homey's location", () => {
    expect(widget({ noLocation: true, language: 'en' }).text('.pw-message')).toBe("Set Homey's location to see pollen and UV.");
  });

  it('shows an error on a failed first load, and keeps the data on a failed refresh', () => {
    const empty = widget(null);
    empty.w.setMessage(empty.w.t('error'));
    expect(empty.text('.pw-message')).toBe('Could not load the pollen forecast.');
    const loaded = widget();
    loaded.w.setMessage('Could not load the pollen forecast.', true);
    expect(loaded.rows()).toHaveLength(3);
  });

  it('translates through opts.t, under pollen.*', () => {
    const t = (key: string, tokens?: any) => ({ 'pollen.birch': 'Birk', 'pollen.uv': `UV ${tokens?.value}` } as Record<string, string>)[key] ?? key;
    expect(widget(JUNE, { t }).rows()[0].querySelector('.pw-name')!.textContent).toBe('Birk');
  });
});

describe('colours', () => {
  it('puts the root on the kit palette, Vivid as wk-deep', () => {
    expect(widget().root.className).toBe('pw wk');
    expect(widget(JUNE, { colorStyle: 'deep', density: 'detailed' }).root.className).toBe('pw pw-detailed wk wk-deep');
  });

  it('reports its height', () => {
    const heights: number[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    Object.defineProperty(root, 'getBoundingClientRect', { value: () => ({ height: root.children.length * 32 }) });
    win.createPollenWidget(root, { onHeight: (h: number) => heights.push(h) }).setData(JUNE);
    expect(heights.at(-1)).toBeGreaterThan(0);
  });
});
