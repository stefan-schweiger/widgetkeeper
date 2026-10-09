// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('values'); });
afterEach(() => { document.body.innerHTML = ''; });

// Numbers follow the device locale (Danish here: 21,5), so the expected text is formatted the same way.
const dec = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 1 });
const cap = (type: string, extra: object = {}) => ({ title: 'T', type, units: null, decimals: null, values: null, icon: null, ...extra });
const temp = (value: unknown = 21.46) => ({ deviceId: 'a', capabilityId: 'measure_temperature', name: 'Stue', capability: cap('number', { units: '°C', decimals: 1 }), value });
const lamp = (value = true) => ({ deviceId: 'b', capabilityId: 'onoff', name: 'Lamp', capability: cap('boolean'), value });

function widget(slots: any[], columns?: unknown, extra: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createValuesWidget(root, { columns, ...extra });
  w.setState(slots);
  const tiles = () => [...root.querySelectorAll<HTMLElement>('.vt-tile')];
  const text = (sel: string) => tiles().map(t => t.querySelector(sel)!.textContent);
  return { w, root, tiles, text };
}

describe('formatCapabilityValue', () => {
  const f = (c: object, v: unknown) => win.formatCapabilityValue(c, v, (k: string) => ({ on: 'On', off: 'Off' } as any)[k]);

  it('rounds numbers to the decimals and adds the units', () => {
    expect(f(cap('number', { units: '°C', decimals: 1 }), 21.46)).toBe(`${dec(21.5)}°C`);
    expect(f(cap('number', { units: '%', decimals: 0 }), 48.2)).toBe('48%');
    expect(f(cap('number', { units: 'W', decimals: 0 }), 812)).toBe('812 W');
    expect(f(cap('number'), 5.25)).toBe(dec(5.25));
  });

  it("scales a 0–1 percentage (Homey's dim) to 0–100", () => {
    expect(f(cap('number', { units: '%', min: 0, max: 1, decimals: 2 }), 0.5)).toBe('50%');
    expect(f(cap('number', { units: '%', min: 0, max: 100 }), 50)).toBe('50%');
  });

  it('shows booleans as on/off, enums by title, and nothing as a dash', () => {
    expect(f(cap('boolean'), true)).toBe('On');
    expect(f(cap('boolean'), false)).toBe('Off');
    expect(f(cap('enum', { values: [{ id: 'heat', title: 'Heat' }] }), 'heat')).toBe('Heat');
    expect(f(cap('enum', { values: [] }), 'x')).toBe('x');
    expect(f(cap('number'), null)).toBe('–');
  });
});

describe('render', () => {
  it('shows one tile per slot, in order, the same slot twice if picked twice', () => {
    const { text } = widget([temp(), lamp(), temp()]);
    expect(text('.vt-name')).toEqual(['Stue', 'Lamp', 'Stue']);
    expect(text('.vt-value')).toEqual([`${dec(21.5)}°C`, 'On', `${dec(21.5)}°C`]);
  });

  it('uses 3 columns unless the setting says 2', () => {
    expect(widget([temp()]).root.dataset.columns).toBe('3');
    expect(widget([temp()], '2').root.dataset.columns).toBe('2');
    expect(widget([temp()], 2).root.dataset.columns).toBe('2');
    expect(widget([temp()], 'bogus').root.dataset.columns).toBe('3');
  });

  describe('percentage fill', () => {
    const battery = (value: number, extra: object = {}) => ({ deviceId: 'c', capabilityId: 'measure_battery', name: 'Sensor', capability: cap('number', { units: '%', ...extra }), value });
    const fill = (t: HTMLElement) => t.style.getPropertyValue('--vt-fill');

    it('is off unless the setting is on', () => {
      const { tiles } = widget([battery(50)]);
      expect(tiles()[0].classList.contains('filled')).toBe(false);
    });

    it('fills percentages from the left, red / yellow / green by the default thresholds', () => {
      const { tiles } = widget([battery(5), battery(10), battery(15), battery(20), battery(80), temp()], undefined, { percentFill: true });
      expect(tiles().map(t => t.dataset.level ?? null)).toEqual(['red', 'yellow', 'yellow', 'green', 'green', null]);
      expect(tiles().map(fill)).toEqual(['5%', '10%', '15%', '20%', '80%', '']);
      expect(tiles()[5].classList.contains('filled')).toBe(false);
    });

    it('uses the thresholds from the settings, as numbers or strings', () => {
      const { tiles } = widget([battery(25), battery(45), battery(60)], undefined, { percentFill: true, redBelow: '30', yellowBelow: 50 });
      expect(tiles().map(t => t.dataset.level)).toEqual(['red', 'yellow', 'green']);
    });

    it('scales a 0–1 percentage and clamps the fill', () => {
      const { tiles } = widget([battery(0.3, { min: 0, max: 1 }), battery(130)], undefined, { percentFill: true });
      expect(tiles().map(fill)).toEqual(['30%', '100%']);
    });

    it('follows realtime changes', () => {
      const { w, tiles } = widget([battery(50)], undefined, { percentFill: true });
      w.pushChange({ deviceId: 'c', capabilityId: 'measure_battery', value: 8 });
      expect(tiles()[0].dataset.level).toBe('red');
      expect(fill(tiles()[0])).toBe('8%');
    });
  });

  it('tints a boolean that is on', () => {
    const { tiles } = widget([temp(), lamp(true), lamp(false)]);
    expect(tiles().map(t => t.classList.contains('active'))).toEqual([false, true, false]);
  });

  describe('colour set by a Flow', () => {
    const color = (t: HTMLElement) => t.dataset.color ?? null;

    it('marks the tiles with their colour, ignoring unknown ones and missing slots', () => {
      const { tiles } = widget([{ ...temp(), color: 'red' }, { ...lamp(), color: 'pink' }, temp(), { deviceId: 'x', capabilityId: 'onoff', missing: true, color: 'red' }]);
      expect(tiles().map(color)).toEqual(['red', null, null, null]);
    });

    it('follows realtime colours on every tile showing the value, and resets with null', () => {
      const { w, tiles } = widget([temp(), lamp(), temp()]);
      w.pushColor({ deviceId: 'a', capabilityId: 'measure_temperature', color: 'blue' });
      expect(tiles().map(color)).toEqual(['blue', null, 'blue']);
      w.pushColor({ deviceId: 'a', capabilityId: 'measure_temperature', color: null });
      expect(tiles().map(color)).toEqual([null, null, null]);
    });

    it('drops the colour when a refresh no longer has it', () => {
      const { w, tiles } = widget([{ ...temp(), color: 'green' }]);
      w.setState([temp()]);
      expect(color(tiles()[0])).toBeNull();
    });
  });

  it("uses the capability's own icon, else a built-in glyph", () => {
    const icon = 'data:image/svg+xml;base64,QUJD';
    const { tiles } = widget([{ ...temp(), capability: cap('number', { icon }) }, temp()]);
    const mask = (t: HTMLElement) => (t.querySelector('.vt-icon') as HTMLElement).style.getPropertyValue('--vt-mask');
    expect(mask(tiles()[0])).toBe(`url("${icon}")`);
    expect(mask(tiles()[1])).toMatch(/^url\("data:image\/svg\+xml;base64,/);
  });

  it('marks missing slots as unavailable', () => {
    const { tiles, text } = widget([{ deviceId: 'x', capabilityId: 'onoff', missing: true }]);
    expect(text('.vt-name')).toEqual(['Unavailable']);
    expect(tiles()[0].classList.contains('missing')).toBe(true);
  });

  it('applies realtime changes to every tile showing the slot', () => {
    const { w, text } = widget([temp(), lamp(), temp()]);
    w.pushChange({ deviceId: 'a', capabilityId: 'measure_temperature', value: 19 });
    expect(text('.vt-value')).toEqual(['19°C', 'On', '19°C']);
  });

  it('keeps the tiles on a transient error, clears them on a persistent one', () => {
    const { w, tiles, root } = widget([temp()]);
    w.setMessage('Oops', true);
    expect(tiles()).toHaveLength(1);
    expect(root.querySelector('.vt-message')!.classList.contains('error')).toBe(true);
    w.setMessage('Pick');
    expect(tiles()).toHaveLength(0);
  });
});

describe('name override', () => {
  it("shows a tile's own name, by position, and keeps the device's when empty", () => {
    const { text } = widget([temp(), temp(), lamp()], undefined, { names: ['Living room', '', '  '] });
    expect(text('.vt-name')).toEqual(['Living room', 'Stue', 'Lamp']);
  });

  it('says a missing value is unavailable, whatever its name', () => {
    const { text } = widget([{ deviceId: 'x', capabilityId: 'onoff', missing: true }], undefined, { names: ['Lamp'] });
    expect(text('.vt-name')).toEqual(['Unavailable']);
  });
});
