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

describe("formatValue (the kit's)", () => {
  const f = (c: object, v: unknown) => win.WidgetkeeperKit.formatValue(c, v, (k: string) => ({ on: 'On', off: 'Off' } as any)[k]);

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

  describe('deep colours', () => {
    const battery = (value: number) => ({ deviceId: 'c', capabilityId: 'measure_battery', name: 'Sensor', capability: cap('number', { units: '%' }), value });
    const ink = (t: HTMLElement) => t.querySelector<HTMLElement>('.vt-ink');

    it('is the default unless the setting says deep (or the old bright)', () => {
      for (const colorStyle of [undefined, 'soft', 'bogus']) {
        const { root, tiles } = widget([battery(50)], undefined, { colorStyle, percentFill: true });
        expect(root.classList.contains('wk-deep')).toBe(false);
        expect(ink(tiles()[0])).toBeNull();
      }
      for (const colorStyle of ['deep', 'bright']) {
        const { root } = widget([temp()], undefined, { colorStyle });
        expect([...root.classList]).toEqual(expect.arrayContaining(['vt', 'wk', 'wk-deep']));
      }
    });

    it("copies each tile's icon, value and name into its ink layer, and follows changes", () => {
      const { w, tiles } = widget([battery(50), temp()], undefined, { colorStyle: 'deep', percentFill: true });
      const copy = (t: HTMLElement) => {
        const layer = ink(t)!;
        expect(layer.getAttribute('aria-hidden')).toBe('true');
        expect((layer.querySelector('.vt-icon') as HTMLElement).style.getPropertyValue('--vt-mask'))
          .toBe((t.querySelector('.vt-icon') as HTMLElement).style.getPropertyValue('--vt-mask'));
        return [layer.querySelector('.vt-value')!.textContent, layer.querySelector('.vt-name')!.textContent];
      };
      expect(tiles().map(copy)).toEqual([['50%', 'Sensor'], [`${dec(21.5)}°C`, 'Stue']]);
      w.pushChange({ deviceId: 'c', capabilityId: 'measure_battery', value: 8 });
      w.setNames({ 'c:measure_battery': 'Back door' });
      expect(copy(tiles()[0])).toEqual(['8%', 'Back door']);
    });
  });

  describe('pill style', () => {
    const battery = (value: number) => ({ deviceId: 'c', capabilityId: 'measure_battery', name: 'Sensor', capability: cap('number', { units: '%' }), value });
    // The classes of a tile's (or its ink layer's) children, nested ones as arrays.
    const layout = (node: Element): unknown[] => [...node.children]
      .filter(c => !c.classList.contains('vt-ink'))
      .map(c => (c.children.length ? [c.className, layout(c)] : c.className));
    const second = ['vt-second', ['vt-second-icon', 'vt-second-value']];
    const pillLayout = ['vt-icon', ['vt-text', ['vt-name', ['vt-row', ['vt-value', second]]]]];

    it('is compact unless the setting says pill', () => {
      for (const tileStyle of [undefined, 'compact', 'bogus']) {
        const { root, tiles } = widget([temp()], undefined, { tileStyle });
        expect(root.classList.contains('vt-pill')).toBe(false);
        expect(layout(tiles()[0])).toEqual([['vt-top', ['vt-icon', 'vt-value']], ['vt-row', ['vt-name', second]]]);
      }
      expect(widget([temp()], undefined, { tileStyle: 'pill' }).root.classList.contains('vt-pill')).toBe(true);
    });

    it('puts the icon beside the name over the value, with the same text', () => {
      const { tiles, text } = widget([temp(), lamp()], undefined, { tileStyle: 'pill' });
      expect(layout(tiles()[0])).toEqual(pillLayout);
      expect(text('.vt-name')).toEqual(['Stue', 'Lamp']);
      expect(text('.vt-value')).toEqual([`${dec(21.5)}°C`, 'On']);
    });

    it('lays out the deep ink layer the same way', () => {
      const { tiles } = widget([battery(50)], undefined, { tileStyle: 'pill', colorStyle: 'deep', percentFill: true });
      const layer = tiles()[0].querySelector('.vt-ink')!;
      expect(layout(layer)).toEqual(pillLayout);
      expect([layer.querySelector('.vt-name')!.textContent, layer.querySelector('.vt-value')!.textContent]).toEqual(['Sensor', '50%']);
    });

    it('puts the rename field right after the name', () => {
      const { tiles } = widget([temp()], undefined, { tileStyle: 'pill', renameTiles: true, onRename: async () => ({}) });
      expect(tiles()[0].querySelector('.wk-rename')!.previousElementSibling!.className).toBe('vt-name');
    });

    it('still follows the tiles per row', () => {
      expect(widget([temp()], undefined, { tileStyle: 'pill' }).root.dataset.columns).toBe('3');
      expect(widget([temp()], '2', { tileStyle: 'pill' }).root.dataset.columns).toBe('2');
    });
  });

  it("uses the capability's own icon, else a built-in glyph", () => {
    const icon = 'data:image/svg+xml;base64,QUJD';
    const { tiles } = widget([{ ...temp(), capability: cap('number', { icon }) }, temp()]);
    const mask = (t: HTMLElement) => (t.querySelector('.vt-icon') as HTMLElement).style.getPropertyValue('--vt-mask');
    expect(mask(tiles()[0])).toBe(`url("${icon}")`);
    expect(mask(tiles()[1])).toMatch(/^url\("data:image\/svg\+xml;base64,/);
  });

  describe('second value', () => {
    const humidity = (value: unknown = 48) => ({ capabilityId: 'measure_humidity', capability: cap('number', { title: 'Humidity', units: '%', decimals: 0 }), value });
    const pair = (second: object = humidity()) => ({ ...temp(), capability: cap('number', { title: 'Temperature', units: '°C', decimals: 1 }), second });
    const seconds = (tiles: HTMLElement[]) => tiles.map(t => {
      const el = t.querySelector<HTMLElement>(':scope > .vt-row .vt-second, :scope > .vt-text .vt-second')!;
      return el.hidden ? null : el.textContent;
    });

    it('ends the name row with it, and stays hidden on a tile without one', () => {
      const { tiles } = widget([pair(), temp()]);
      expect(seconds(tiles())).toEqual(['48%', null]);
      expect(tiles()[0].querySelector('.vt-row .vt-name')!.textContent).toBe('Stue');
      const icon = tiles()[0].querySelector<HTMLElement>('.vt-second-icon')!;
      expect(icon.style.getPropertyValue('--vt-mask')).toMatch(/^url\("data:image\/svg\+xml/);
      expect(tiles()[0].title).toBe('Temperature · Humidity');
    });

    it('sits in the value row of a pill tile', () => {
      const { tiles } = widget([pair()], undefined, { tileStyle: 'pill' });
      expect(tiles()[0].querySelector('.vt-text > .vt-row > .vt-second')!.textContent).toBe('48%');
    });

    it('goes when a refresh brings the tile without it', () => {
      const { w, tiles } = widget([pair()]);
      w.setState([temp()]);
      expect(seconds(tiles())).toEqual([null]);
    });

    it('takes realtime changes of its own capability', () => {
      const { w, tiles, text } = widget([pair(), pair()]);
      w.pushChange({ deviceId: 'a', capabilityId: 'measure_humidity', value: 55 });
      expect(seconds(tiles())).toEqual(['55%', '55%']);
      expect(text('.vt-value')).toEqual([`${dec(21.5)}°C`, `${dec(21.5)}°C`]);
      w.pushChange({ deviceId: 'other', capabilityId: 'measure_humidity', value: 10 });
      expect(seconds(tiles())).toEqual(['55%', '55%']);
    });

    it('leaves the colour to the first value', () => {
      const on = { capabilityId: 'onoff', capability: cap('boolean'), value: true };
      const battery = { capabilityId: 'measure_battery', capability: cap('number', { units: '%' }), value: 5 };
      const { tiles } = widget([pair(on), pair(battery)], undefined, { percentFill: true });
      expect(seconds(tiles())).toEqual(['On', '5%']);
      expect(tiles().map(t => [t.classList.contains('active'), t.classList.contains('filled')])).toEqual([[false, false], [false, false]]);
    });

    it('is in the deep ink layer too', () => {
      const battery = { deviceId: 'c', capabilityId: 'measure_battery', name: 'Sensor', capability: cap('number', { units: '%' }), value: 50, second: humidity() };
      const { tiles } = widget([battery], undefined, { colorStyle: 'deep', percentFill: true });
      const layer = tiles()[0].querySelector('.vt-ink')!;
      expect(layer.querySelector<HTMLElement>('.vt-second')!.hidden).toBe(false);
      expect(layer.querySelector('.vt-second-value')!.textContent).toBe('48%');
    });
  });

  it('always uses the built-in glyph for batteries, whatever the driver ships', () => {
    const icon = 'data:image/svg+xml;base64,QUJD';
    const battery = (extra: object) => ({ deviceId: 'c', capabilityId: 'measure_battery', name: 'Sensor', capability: cap('number', { units: '%', ...extra }), value: 80 });
    const { tiles } = widget([battery({ icon }), battery({})]);
    const mask = (t: HTMLElement) => (t.querySelector('.vt-icon') as HTMLElement).style.getPropertyValue('--vt-mask');
    expect(mask(tiles()[0])).not.toBe(`url("${icon}")`);
    expect(mask(tiles()[0])).toBe(mask(tiles()[1]));
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
