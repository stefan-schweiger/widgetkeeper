// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('thermostat'); });

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

function widget(settings: Record<string, unknown>, state: any = aircon(), onApply = vi.fn(async () => {})) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createThermostatWidget(root, { locale: 'en', onApply });
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
    s.caps.aircon_mode = { ...MODE, values: MODE.values.filter(v => v.id !== 'off') };
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
