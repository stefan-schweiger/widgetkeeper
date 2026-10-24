// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('thermostat'); loadMount('thermostat'); });

const MODE = { title: 'Mode', units: null, values: [{ id: 'heat', title: 'Heat' }, { id: 'cool', title: 'Cool' }, { id: 'off', title: 'Off' }] };
const FAN = { title: 'Fan speed', units: null, values: [{ id: 'auto', title: 'Auto' }, { id: 'low', title: 'Low' }, { id: 'high', title: 'High' }] };

// Autocomplete items, as the widget settings store them.
const item = (capabilityId: string, value: unknown, name: string) => ({ capabilityId, value, name });
const heat = item('thermostat_mode', 'heat', 'Mode: Heat');
const cool = item('thermostat_mode', 'cool', 'Mode: Cool');
const t21 = item('target_temperature', 21, '21 °C');
const t23 = item('target_temperature', 23, '23 °C');
const fanLow = item('fan_speed', 'low', 'Fan speed: Low');
const fanHigh = item('fan_speed', 'high', 'Fan speed: High');

function aircon(values: Record<string, unknown> = {}, caps: Record<string, any> = {}) {
  return {
    name: 'Aircon',
    icon: null,
    values: { onoff: true, thermostat_mode: 'cool', target_temperature: 23, fan_speed: 'auto', ...values },
    caps: {
      onoff: { title: 'Turned on', units: null, values: null },
      thermostat_mode: MODE,
      target_temperature: { title: 'Target temperature', units: '°C', values: null },
      fan_speed: FAN,
      ...caps,
    },
  };
}

/** A device without `onoff` that turns off through its own mode capability. */
function noOnoff(mode = 'cool') {
  const s = aircon({ aircon_mode: mode });
  delete (s.values as any).onoff;
  delete (s.values as any).thermostat_mode;
  delete (s.caps as any).onoff;
  delete (s.caps as any).thermostat_mode;
  (s.caps as any).aircon_mode = { ...MODE, title: 'Aircon mode' };
  return s;
}

function widget(settings: Record<string, unknown>, state: any = aircon(), onApply = vi.fn(async () => {}), layout?: string, title?: string) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createThermostatWidget(root, { locale: 'en', onApply, layout, title });
  w.setButtons(win.thermostatPresetsFromSettings(settings));
  if (state) w.setState(state);
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('.tw-btn')].map(b => ({
    big: b.querySelector('.tw-big')!.textContent,
    mode: b.querySelector('.tw-modetext')?.textContent ?? null,
    extras: [...b.querySelectorAll('.tw-extra')].map(x => x.textContent),
    kind: b.dataset.kind,
    active: b.classList.contains('active'),
    disabled: b.disabled,
  }));
  const sub = () => {
    const el = root.querySelector<HTMLElement>('.tw-sub')!;
    return el.style.display === 'none' ? null : el.textContent;
  };
  const press = (i: number) => root.querySelectorAll<HTMLButtonElement>('.tw-btn')[i].click();
  return { w, root, buttons, sub, press, onApply };
}

const sent = (fn: any, call = 0) => fn.mock.calls[call][0].map((v: any) => `${v.capabilityId}=${v.value}`);

beforeEach(() => { document.body.innerHTML = ''; });
afterEach(() => { vi.useRealTimers(); });

describe('presetsFromSettings', () => {
  it('turns the flat settings into three presets, power first, then mode, temperature and extra', () => {
    const presets = win.thermostatPresetsFromSettings({
      b1Power: 'on', b1Temp: t21, b1Extra: fanLow, b1Mode: heat,
      b2Power: 'keep', b2Temp: t23,
      b3Power: 'off',
    });
    expect(presets.map((p: any) => p.values.map((v: any) => `${v.slot}:${v.capabilityId}=${v.value}`))).toEqual([
      ['power:onoff=true', 'mode:thermostat_mode=heat', 'temp:target_temperature=21', 'extra:fan_speed=low'],
      ['temp:target_temperature=23'],
      ['power:onoff=false'],
    ]);
  });

  it('keeps only the first value for a capability', () => {
    const [p] = win.thermostatPresetsFromSettings({ b1Mode: heat, b1Extra: item('thermostat_mode', 'cool', 'Mode: Cool') });
    expect(p.values).toHaveLength(1);
    expect(p.values[0].value).toBe('heat');
  });

  it('ignores "Don\'t change" items, which carry no capability', () => {
    const [p] = win.thermostatPresetsFromSettings({ b1Temp: { name: "Don't change" } });
    expect(p.values).toEqual([]);
  });
});

describe('button text', () => {
  it('shows the temperature, the mode and the extra settings', () => {
    const { buttons } = widget({ b1Mode: heat, b1Temp: t21, b1Extra: fanLow, b2Power: 'off', b3Mode: cool });
    expect(buttons()).toMatchObject([
      { big: '21°', mode: 'Heat', extras: ['Fan low'], kind: 'heat' },
      { big: 'Off', mode: null, extras: [], kind: 'off' },
      { big: 'Cool', mode: null, kind: 'cool' },
    ]);
  });

  it('promotes an extra setting when there is no temperature or mode', () => {
    const { buttons } = widget({ b1Extra: fanHigh, b2Power: 'on' });
    expect(buttons()[0]).toMatchObject({ big: 'Fan high', extras: [] });
    expect(buttons()[1]).toMatchObject({ big: 'On' });
  });

  it('does not repeat the capability word when the value already starts with it', () => {
    const fan = { ...FAN, values: [{ id: 'fa', title: 'Fan auto' }, { id: 'q', title: 'QUIET' }] };
    const { buttons } = widget(
      { b1Extra: item('fan_speed', 'fa', 'x'), b2Extra: item('fan_speed', 'q', 'x') },
      aircon({}, { fan_speed: fan }),
    );
    expect(buttons().map(b => b.big)).toEqual(['Fan auto', 'Fan QUIET', '']);
  });

  it('uses the autocomplete names until the state loads, with the buttons disabled', () => {
    const { buttons } = widget({ b1Mode: heat, b1Temp: t21, b1Extra: fanLow }, null);
    expect(buttons()[0]).toMatchObject({ big: '21°', mode: 'Heat', extras: ['Fan low'], disabled: true });
  });
});

describe('highlighting', () => {
  it('highlights the preset the device matches', () => {
    const { buttons, sub } = widget({ b1Mode: heat, b2Mode: cool, b2Temp: t23 });
    expect(buttons().map(b => b.active)).toEqual([false, true, false]);
    expect(sub()).toBeNull();
  });

  it('matches the temperature within 0.25°', () => {
    const { w, buttons } = widget({ b1Temp: t23 });
    w.pushChange({ capabilityId: 'target_temperature', value: 23.25 });
    expect(buttons()[0].active).toBe(true);
    w.pushChange({ capabilityId: 'target_temperature', value: 23.5 });
    expect(buttons()[0].active).toBe(false);
  });

  it('does not match a preset that leaves the device on while it is off', () => {
    const { buttons } = widget({ b1Mode: cool, b2Power: 'off' }, aircon({ onoff: false }));
    expect(buttons().map(b => b.active)).toEqual([false, true, false]);
  });

  it('matches string and number enum values alike', () => {
    const { buttons } = widget({ b1Extra: item('fan_speed', '2', 'Fan speed: 2') }, aircon({ fan_speed: 2 }));
    expect(buttons()[0].active).toBe(true);
  });

  it('lights a tapped button until the device matches, or for 10 s', async () => {
    vi.useFakeTimers();
    const { w, press, buttons, onApply } = widget({ b1Mode: heat, b2Extra: fanHigh });
    press(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(onApply).toHaveBeenCalledTimes(1);
    expect(buttons()[0].active).toBe(true);
    w.pushChange({ capabilityId: 'thermostat_mode', value: 'heat' });
    expect(buttons()[0].active).toBe(true); // now a real match

    press(1); // the device never reports fan_speed=high
    await vi.advanceTimersByTimeAsync(9000);
    expect(buttons().map(b => b.active)).toEqual([false, true, false]);
    await vi.advanceTimersByTimeAsync(1100);
    expect(buttons().map(b => b.active)).toEqual([true, false, false]);
  });
});

describe('a device without onoff', () => {
  it('turns off through the mode capability and drops "turn on"', async () => {
    const { press, onApply, buttons } = widget(
      { b1Power: 'off', b2Power: 'on', b2Mode: item('aircon_mode', 'heat', 'Aircon mode: Heat'), b3Power: 'on' },
      noOnoff(),
    );
    press(0);
    press(1);
    await Promise.resolve();
    expect(sent(onApply, 0)).toEqual(['aircon_mode=off']);
    expect(sent(onApply, 1)).toEqual(['aircon_mode=heat']);
    expect(buttons()[2].disabled).toBe(true); // "on" alone sends nothing
  });

  it('lets "off" win over a mode the preset also sets', async () => {
    const { press, onApply } = widget({ b1Power: 'off', b1Mode: item('aircon_mode', 'heat', 'x'), b1Extra: fanLow }, noOnoff());
    press(0);
    await Promise.resolve();
    expect(sent(onApply)).toEqual(['aircon_mode=off', 'fan_speed=low']);
  });

  it('finds the off mode even when no button sets a mode', async () => {
    const { press, onApply } = widget({ b1Power: 'off' }, noOnoff());
    press(0);
    await Promise.resolve();
    expect(sent(onApply)).toEqual(['aircon_mode=off']);
  });

  it('treats the off mode as off', () => {
    const { buttons } = widget({ b1Power: 'off', b2Mode: item('aircon_mode', 'cool', 'x') }, noOnoff('off'));
    expect(buttons().map(b => b.active)).toEqual([true, false, false]);
    const { sub } = widget({ b1Mode: item('aircon_mode', 'heat', 'x') }, noOnoff('off'));
    expect(sub()).toBe('Currently off');
  });

  it('disables "off" when the device has no way to turn off', () => {
    const s = noOnoff();
    (s.caps as Record<string, unknown>).aircon_mode = { ...MODE, values: MODE.values.filter(v => v.id !== 'off') };
    const { buttons } = widget({ b1Power: 'off', b2Mode: item('aircon_mode', 'heat', 'x') }, s);
    expect(buttons().map(b => b.disabled)).toEqual([true, false, true]);
  });
});

describe('subtitle', () => {
  it('says what the device is doing when no preset matches', () => {
    const { sub } = widget({ b1Mode: heat, b1Extra: fanLow });
    expect(sub()).toBe('Currently Cool 23° · Fan auto');
  });

  it('says when the device is off', () => {
    const { sub } = widget({ b1Mode: heat }, aircon({ onoff: false }));
    expect(sub()).toBe('Currently off');
  });
});

describe('press', () => {
  it('shows a failed apply for 8 seconds', async () => {
    vi.useFakeTimers();
    const onApply = vi.fn(async () => { throw new Error('Driver says no'); });
    const { press, sub, buttons } = widget({ b1Mode: heat }, aircon(), onApply);
    vi.spyOn(console, 'error').mockImplementation(() => {});
    press(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(sub()).toBe('Could not change the thermostat. Driver says no');
    expect(buttons()[0].active).toBe(false);
    await vi.advanceTimersByTimeAsync(8000);
    expect(sub()).toBe('Currently Cool 23°');
  });

  it('does nothing for an empty preset', () => {
    const { press, onApply } = widget({});
    press(0);
    expect(onApply).not.toHaveBeenCalled();
  });
});

describe('layout', () => {
  const settings = { b1Power: 'off', b2Mode: heat, b2Temp: t21, b2Extra: fanLow, b3Mode: cool };

  it('marks the compact layout, and leaves the standard one (or a missing setting) alone', () => {
    expect(widget(settings, aircon(), undefined, 'compact').root.classList.contains('tw-compact')).toBe(true);
    expect(widget(settings, aircon(), undefined, 'standard').root.classList.contains('tw-compact')).toBe(false);
    expect(widget(settings).root.classList.contains('tw-compact')).toBe(false);
  });

  it('keeps the same buttons and subtitle in compact', () => {
    const standard = widget(settings);
    const compact = widget(settings, aircon(), undefined, 'compact');
    expect(compact.buttons()).toEqual(standard.buttons());
    expect(compact.sub()).toBe(standard.sub());
  });

  it('flags a subtitle beside the name, but not an error', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onApply = vi.fn(async () => { throw new Error('No'); });
    const { root, press } = widget({ b1Mode: heat }, aircon(), onApply, 'compact');
    const header = root.querySelector('.tw-header')!;
    expect(header.classList.contains('has-sub')).toBe(true); // "Currently Cool 23°"
    press(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(header.classList.contains('has-sub')).toBe(false);
  });
});

describe('the sensor beside the name', () => {
  const settings = { b1Power: 'off', b2Mode: heat, b3Mode: cool };
  const withSensor = (value: unknown = 21) => ({ ...aircon(), sensor: { deviceId: 'room', capabilityId: 'measure_temperature', capability: { type: 'number', units: '°C', decimals: 1 }, value } });
  const aside = (root: HTMLElement) => {
    const el = root.querySelector<HTMLElement>('.tw-aside')!;
    return el.style.display === 'none' ? null : el.textContent;
  };

  it('shows the value at the end of the header, in both layouts', () => {
    expect(aside(widget(settings, withSensor()).root)).toBe('21°C');
    const { root } = widget(settings, withSensor(), undefined, 'compact');
    expect([...root.querySelector('.tw-header')!.children].map(c => c.className)).toEqual(['tw-device-icon fallback', 'tw-titles', 'tw-aside', 'tw-chevron']);
    expect(aside(root)).toBe('21°C');
  });

  it('follows realtime values', () => {
    const { w, root } = widget(settings, withSensor());
    w.pushSensor(22);
    expect(aside(root)).toBe('22°C');
    w.pushSensor(null);
    expect(aside(root)).toBe('–');
  });

  it('is hidden without a sensor, a state or with only a message', () => {
    const { w, root } = widget(settings);
    expect(aside(root)).toBeNull();
    w.pushSensor(20); // no sensor in the state: ignored
    expect(aside(root)).toBeNull();
    w.setState(withSensor());
    w.setMessage('Could not load the thermostat.');
    expect(aside(root)).toBeNull();
  });
});

describe('mount: the sensor beside the name', () => {
  const SENSOR = { type: 'number', title: 'Temperature', units: '°C', decimals: 1 };
  function mount(sensor: unknown) {
    const listeners: Record<string, (data: any) => void> = {};
    const api = vi.fn(async (_method: string, _path: string) => ({ ...aircon(), sensor: { deviceId: 'room', capabilityId: 'measure_temperature', capability: SENSOR, value: 21 } }));
    const Homey = {
      api, on: (event: string, fn: (data: any) => void) => { listeners[event] = fn; }, ready: vi.fn(), setHeight: vi.fn(),
      getSettings: () => ({ device: { id: 'dev1' }, sensor, b1Power: 'off' }), getDeviceIds: () => [], getWidgetInstanceId: () => 'w1',
      __: (key: string) => key,
    };
    const root = document.createElement('div');
    document.body.append(root);
    win.mountThermostatWidget(Homey, { root, frame: root });
    return { api, listeners, root };
  }

  it('asks /state for the slot and follows its values:state', async () => {
    const { api, listeners, root } = mount({ id: 'room:measure_temperature', name: 'Living room · Temperature' });
    await vi.waitFor(() => expect(root.querySelector('.tw-aside')!.textContent).toBe('21°C'));
    expect(api.mock.calls[0][1]).toContain('&sensor=room%3Ameasure_temperature');
    listeners['values:state']({ deviceId: 'other', capabilityId: 'measure_temperature', value: 30 });
    listeners['values:state']({ deviceId: 'room', capabilityId: 'measure_temperature', value: 22 });
    expect(root.querySelector('.tw-aside')!.textContent).toBe('22°C');
  });

  it('sends no sensor for None', async () => {
    const { api } = mount({ id: 'none', name: 'None' });
    await vi.waitFor(() => expect(api).toHaveBeenCalled());
    expect(api.mock.calls[0][1]).not.toContain('sensor=');
  });
});

describe('title', () => {
  const settings = { b1Power: 'off', b2Mode: heat, b3Mode: cool };
  const name = (root: HTMLElement) => root.querySelector('.tw-name')!.textContent;

  it('replaces the device name, and an empty one keeps it', () => {
    expect(name(widget(settings, aircon(), undefined, undefined, '  Living room  ').root)).toBe('Living room');
    expect(name(widget(settings, aircon(), undefined, undefined, '   ').root)).toBe('Aircon');
    expect(name(widget(settings).root)).toBe('Aircon');
  });

  it('stays through a refresh and realtime changes', () => {
    const { w, root } = widget(settings, aircon(), undefined, 'compact', 'Upstairs');
    w.setState(aircon({ thermostat_mode: 'heat' }));
    w.pushChange({ capabilityId: 'target_temperature', value: 22 });
    expect(name(root)).toBe('Upstairs');
  });
});

describe('the setpoint under the name', () => {
  const modes = { b1Power: 'off', b2Mode: heat, b3Mode: cool };

  it('shows the device setpoint while a lit preset sets no temperature', () => {
    expect(widget(modes, aircon({ thermostat_mode: 'cool', target_temperature: 23 })).sub()).toBe('Set to 23°');
    expect(widget(modes, aircon({ thermostat_mode: 'cool', target_temperature: 23 }), undefined, 'compact').sub()).toBe('Set to 23°');
  });

  it('is left out when the lit preset sets the temperature, or the device is off', () => {
    expect(widget({ b1Mode: heat, b1Temp: t21 }, aircon({ thermostat_mode: 'heat', target_temperature: 21 })).sub()).toBeNull();
    expect(widget(modes, aircon({ onoff: false })).sub()).toBeNull();
  });
});

describe('the controls panel', () => {
  const settings = { b1Power: 'off', b2Mode: heat, b3Mode: cool };
  const SWING = { title: 'Swing', units: null, values: ['off', '1', '2', '3', '4', 'auto'].map(id => ({ id, title: id === 'off' ? 'Off' : id === 'auto' ? 'Auto' : `Position ${id}` })) };
  const device = (values: Record<string, unknown> = {}) => aircon(values, {
    target_temperature: { title: 'Target temperature', units: '°C', values: null, setable: true, min: 16, max: 30, step: 0.5 },
    measure_temperature: { title: 'Temperature', units: '°C', values: null, setable: false },
    swing: SWING,
    display: { title: 'Display', units: null, values: [{ id: 'on', title: 'On' }], setable: false },
  });

  function opened(state = device(), onApply: any = vi.fn(async () => {})) {
    vi.useFakeTimers();
    const ui = widget(settings, state, onApply);
    (ui.root.querySelector('.tw-header') as HTMLElement).click();
    const rows = () => [...ui.root.querySelectorAll<HTMLElement>('.tw-ctl-row')];
    const row = (label: string) => rows().find(r => r.querySelector('.tw-ctl-label')!.textContent === label)!;
    const buttons = (label: string) => [...row(label).querySelectorAll<HTMLButtonElement>('button')];
    const lit = (label: string) => buttons(label).filter(b => b.classList.contains('active')).map(b => b.textContent);
    const value = (label: string) => row(label).querySelector('.tw-ctl-value')!.textContent;
    const isOpen = () => ui.root.classList.contains('tw-open');
    return { ...ui, rows, row, buttons, lit, value, isOpen };
  }

  it('makes the header a button with a chevron; a presets widget without the hook has neither', () => {
    const { root } = widget(settings);
    const header = root.querySelector('.tw-header')!;
    expect(header.getAttribute('role')).toBe('button');
    expect(header.getAttribute('aria-label')).toBe('Show the controls');
    expect(header.querySelector('.tw-chevron')).not.toBeNull();
    const plain = document.createElement('div');
    win.WidgetkeeperPresets.create(plain, { text: () => ({ big: '' }), matches: () => false, failed: () => '', current: () => '' });
    expect(plain.querySelector('.tw-header')!.hasAttribute('role')).toBe(false);
    expect(plain.querySelector('.tw-chevron')).toBeNull();
  });

  it('opens in the widget’s place with a row per settable setting, the mode first among the enums', () => {
    const { rows, isOpen, root } = opened();
    expect(isOpen()).toBe(true);
    expect(root.querySelector('.tw-ctl-name')!.textContent).toBe('Aircon');
    expect(rows().map(r => r.querySelector('.tw-ctl-label')!.textContent)).toEqual(['Power', 'Target temperature', 'Mode', 'Fan speed', 'Swing']);
  });

  it('shows the values, the mode in its colour', () => {
    const { lit, value, buttons } = opened(device({ thermostat_mode: 'heat', fan_speed: 'low', swing: '2', target_temperature: 21.5 }));
    expect(lit('Power')).toEqual(['On']);
    expect(lit('Mode')).toEqual(['Heat']);
    expect(buttons('Mode').find(b => b.textContent === 'Heat')!.dataset.kind).toBe('heat');
    expect(lit('Fan speed')).toEqual(['Low']);
    expect(value('Target temperature')).toBe('21.5°');
    expect(value('Swing')).toBe('Position 2'); // more than four values: a stepper
  });

  it('closes with ✕, Escape or after 30 s untouched', async () => {
    const a = opened();
    a.root.querySelector<HTMLButtonElement>('.tw-close')!.click();
    expect(a.isOpen()).toBe(false);
    const b = opened();
    b.root.querySelector('.tw-controls')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(b.isOpen()).toBe(false);
    const c = opened();
    await vi.advanceTimersByTimeAsync(29e3);
    expect(c.isOpen()).toBe(true);
    await vi.advanceTimersByTimeAsync(1e3);
    expect(c.isOpen()).toBe(false);
  });

  it('sends a segment at once, one value', () => {
    const { buttons, onApply, lit } = opened();
    buttons('Fan speed').find(b => b.textContent === 'High')!.click();
    expect(sent(onApply)).toEqual(['fan_speed=high']);
    expect(lit('Fan speed')).toEqual(['High']); // shown while the device hasn't reported it
  });

  it('steps the temperature by its step and sends the taps together', async () => {
    const { buttons, onApply, value } = opened(device({ target_temperature: 23 }));
    const [, plus] = buttons('Target temperature');
    plus.click();
    plus.click();
    expect(value('Target temperature')).toBe('24°');
    await vi.advanceTimersByTimeAsync(699);
    expect(onApply).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(sent(onApply)).toEqual(['target_temperature=24']);
    expect(onApply).toHaveBeenCalledTimes(1);
  });

  it('stops at the range', () => {
    const { buttons, value } = opened(device({ target_temperature: 29.5 }));
    const [minus, plus] = buttons('Target temperature');
    plus.click();
    expect(value('Target temperature')).toBe('30°');
    expect(plus.disabled).toBe(true);
    expect(minus.disabled).toBe(false);
  });

  it('steps through an enum with many values, wrapping round', async () => {
    const { buttons, onApply, value } = opened(device({ swing: 'auto' }));
    buttons('Swing')[1].click();
    expect(value('Swing')).toBe('Off');
    await vi.advanceTimersByTimeAsync(700);
    expect(sent(onApply)).toEqual(['swing=off']);
  });

  it('follows realtime changes while open', () => {
    const { w, value } = opened(device({ target_temperature: 22 }));
    w.pushChange({ capabilityId: 'target_temperature', value: 25 });
    expect(value('Target temperature')).toBe('25°');
  });

  it('shows a failure and goes back to the device value', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onApply = vi.fn(async () => { throw new Error('Busy'); });
    const { buttons, lit, root } = opened(device({ fan_speed: 'auto' }), onApply);
    buttons('Fan speed').find(b => b.textContent === 'High')!.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(lit('Fan speed')).toEqual(['Auto']);
    const msg = root.querySelector<HTMLElement>('.tw-ctl-msg')!;
    expect(msg.textContent).toBe('Could not change the thermostat. Busy');
    expect(msg.style.display).toBe('');
    await vi.advanceTimersByTimeAsync(8000);
    expect(msg.style.display).toBe('none');
  });

  it('has no panel without onApply, and closes when the device is gone', () => {
    const root = document.createElement('div');
    const w = win.createThermostatWidget(root, { locale: 'en' });
    w.setButtons(win.thermostatPresetsFromSettings(settings));
    w.setState(aircon());
    expect(root.querySelector('.tw-header')!.hasAttribute('role')).toBe(false);
    const a = opened();
    a.w.setMessage('Could not load the thermostat.');
    expect(a.isOpen()).toBe(false);
  });
});
