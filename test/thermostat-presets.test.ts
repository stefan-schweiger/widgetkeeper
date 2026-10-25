// @vitest-environment happy-dom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';
import { KeyError } from '../lib/PersonalApiKey.js';
import ThermostatPresetService from '../lib/ThermostatPresetService.js';
import {
  deviceValues, modeCapOf, presetLabel, presetMatches, presetsFromSettings, widgetModeCap,
} from '../lib/thermostatPresets.js';
import thermostatApi from '../widgets/thermostat/api.js';

let win: any;
beforeAll(() => { win = loadWidget('thermostat'); loadMount('thermostat'); });
beforeEach(() => { document.body.innerHTML = ''; });

const APP = 'com.thomassidor.widgetkeeper';
const MODE = { title: 'Mode', units: null, values: [{ id: 'heat', title: 'Heat' }, { id: 'cool', title: 'Cool' }, { id: 'off', title: 'Off' }] };
const FAN = { title: 'Fan speed', units: null, values: [{ id: 'auto', title: 'Auto' }, { id: 'low', title: 'Low' }, { id: 'high', title: 'High' }] };

// Autocomplete items, as the widget settings store them.
const item = (capabilityId: string, value: unknown, name: string) => ({ capabilityId, value, name });
const heat = item('thermostat_mode', 'heat', 'Mode: Heat');
const cool = item('thermostat_mode', 'cool', 'Mode: Cool');
const t21 = item('target_temperature', 21, '21 °C');
const t23 = item('target_temperature', 23, '23 °C');
const fanLow = item('fan_speed', 'low', 'Fan speed: Low');
const airHeat = item('aircon_mode', 'heat', 'Aircon mode: Heat');
const airCool = item('aircon_mode', 'cool', 'Aircon mode: Cool');

/** A device's state as `ThermostatService.getState()` gives it. */
function aircon(values: Record<string, unknown> = {}) {
  return {
    name: 'Aircon',
    icon: null,
    values: { onoff: true, thermostat_mode: 'cool', target_temperature: 23, fan_speed: 'auto', ...values } as Record<string, unknown>,
    caps: {
      onoff: { title: 'Turned on', units: null, values: null },
      thermostat_mode: MODE,
      target_temperature: { title: 'Target temperature', units: '°C', values: null },
      fan_speed: FAN,
    } as Record<string, any>,
  };
}

/** A device without `onoff` that turns off through its own mode capability (`noOff`: it has no off value). */
function noOnoff(mode = 'cool', noOff = false) {
  const s = aircon({ aircon_mode: mode });
  delete s.values.onoff;
  delete s.values.thermostat_mode;
  delete s.caps.onoff;
  delete s.caps.thermostat_mode;
  s.caps.aircon_mode = { ...MODE, title: 'Aircon mode', values: MODE.values.filter(v => !noOff || v.id !== 'off') };
  return s;
}

const MIXED = { b1Power: 'on', b1Mode: heat, b1Temp: t21, b1Extra: fanLow, b2Mode: cool, b2Temp: t23, b3Power: 'off' };
const NO_ONOFF = { b1Power: 'off', b2Power: 'on', b2Mode: airHeat, b3Power: 'on' };

/** Settings and a device state: what the widget shows and sends, and what the app's copy must say alike. */
const CASES: [string, Record<string, unknown>, ReturnType<typeof aircon>][] = [
  ['heat with a temperature and fan, cool, off', MIXED, aircon()],
  ['the same, matching the heat button', MIXED, aircon({ thermostat_mode: 'heat', target_temperature: 21, fan_speed: 'low' })],
  ['the same while off', MIXED, aircon({ onoff: false })],
  ['a temperature within 0.25°', { b1Mode: cool, b1Temp: t23 }, aircon({ target_temperature: 23.2 })],
  ['a temperature past 0.25°', { b1Mode: cool, b1Temp: t23 }, aircon({ target_temperature: 23.3 })],
  ['only an extra setting, and only "on"', { b1Extra: fanLow, b2Power: 'on' }, aircon({ fan_speed: 'low' })],
  ['no onoff: off through the mode, "on" dropped', NO_ONOFF, noOnoff()],
  ['no onoff: off wins over a mode', { b1Power: 'off', b1Mode: airHeat, b1Extra: fanLow }, noOnoff()],
  ['no onoff: the off mode without a mode button', { b1Power: 'off', b2Extra: fanLow }, noOnoff()],
  ['no onoff, and off now', { b1Power: 'off', b2Mode: airCool }, noOnoff('off')],
  ['no onoff and no off mode', { b1Power: 'off', b2Mode: airHeat }, noOnoff('cool', true)],
];

/** The app's copy on a case: each button's lit state, values for the device and text. */
function appSide(settings: Record<string, unknown>, state: ReturnType<typeof aircon>) {
  const presets = presetsFromSettings(settings);
  const modeCap = modeCapOf(widgetModeCap(presets), state.caps);
  return presets.map((p) => {
    const values = deviceValues(p, state.caps, modeCap);
    return {
      active: presetMatches(state.values, values, state.caps, modeCap),
      sent: values.length ? values.map(v => `${v.capabilityId}=${v.value}`) : null,
      text: presetLabel(p, state.caps, modeCap, { off: 'Off', on: 'On' }, 'en'),
    };
  });
}

/** The widget on a case: the same, read from its buttons and what a press sends. */
async function widgetSide(settings: Record<string, unknown>, state: ReturnType<typeof aircon>) {
  const root = document.createElement('div');
  document.body.append(root);
  const onApply = vi.fn(async (_values: any[], _press?: { button: number }) => {});
  const w = win.createThermostatWidget(root, { locale: 'en', onApply });
  w.setButtons(win.thermostatPresetsFromSettings(settings));
  w.setState(structuredClone(state));
  const tiles = [...root.querySelectorAll<HTMLButtonElement>('.tw-btn')];
  const shown = tiles.map(b => ({
    active: b.classList.contains('active'),
    text: [b.querySelector('.tw-big')!.textContent, b.querySelector('.tw-modetext')?.textContent,
      ...[...b.querySelectorAll('.tw-extra')].map(x => x.textContent)].filter(Boolean).join(' · '),
  }));
  const out = [];
  for (const [i, tile] of tiles.entries()) {
    onApply.mockClear();
    tile.click();
    await Promise.resolve();
    const call = onApply.mock.calls[0];
    if (call) expect(call[1]).toEqual({ button: i + 1 });
    out.push({ ...shown[i], sent: call ? call[0].map((v: any) => `${v.capabilityId}=${v.value}`) : null });
  }
  return out;
}

describe("the app's copy of the widget's device model", () => {
  it.each(CASES)('%s: lights, sends and names each button as the widget does', async (_, settings, state) => {
    expect(appSide(settings, state)).toEqual(await widgetSide(settings, state));
  });

  it('reads the cases as the widget is meant to', () => {
    expect(appSide(MIXED, aircon())).toEqual([
      { active: false, sent: ['onoff=true', 'thermostat_mode=heat', 'target_temperature=21', 'fan_speed=low'], text: '21° · Heat · Fan low' },
      { active: true, sent: ['thermostat_mode=cool', 'target_temperature=23'], text: '23° · Cool' },
      { active: false, sent: ['onoff=false'], text: 'Off' },
    ]);
    expect(appSide(NO_ONOFF, noOnoff()).map(b => b.sent)).toEqual([['aircon_mode=off'], ['aircon_mode=heat'], null]);
    expect(appSide({ b1Power: 'off', b2Mode: airHeat }, noOnoff('cool', true)).map(b => b.sent)).toEqual([null, ['aircon_mode=heat'], null]);
  });

  it('names a button from the settings alone, before any device is read', () => {
    const presets = presetsFromSettings(MIXED);
    const modeCap = modeCapOf(widgetModeCap(presets), {});
    expect(presets.map(p => presetLabel(p, {}, modeCap, { off: 'Off', on: 'On' }, 'en'))).toEqual(['21° · Heat · Fan low', '23° · Cool', 'Off']);
  });
});

// ---------------------------------------------------------------- the Flow cards' service

const nativeWidget = (id: string, settings: Record<string, unknown>) => ({
  id, type: 'app_webview', title: 'Thermostat', data: { appWidgetId: `homey:app:${APP}:thermostat`, settings },
});
const AIRCON = { device: { id: 'ac', name: 'Aircon' } };
const DASHBOARDS = [
  {
    id: 'd2',
    name: 'Upstairs',
    columns: [{ id: 'c1', widgets: [nativeWidget('w2', { ...AIRCON, title: 'Bedroom', b1Mode: cool, b1Temp: t21 }), { id: 'x', type: 'light_group' }] }],
  },
  {
    id: 'd1',
    name: 'Living',
    columns: [{ id: 'c1', widgets: [nativeWidget('w1', { ...AIRCON, ...MIXED })] }, { id: 'c2', widgets: [nativeWidget('w3', { b1Mode: heat })] }],
  },
];
const WEB = [{
  id: 'wd', name: 'Hall', theme: 'auto', background: 'default',
  columns: [[{ id: 'x1', type: 'thermostat', title: '', settings: { ...AIRCON, b1Power: 'off' }, deviceIds: [] }, { id: 'x2', type: 'clock', title: '', settings: {}, deviceIds: [] }]],
}];

function setup({ dashboards = DASHBOARDS as any[], fail = null as unknown, web = WEB as any[], enabled = true, state = aircon() as any } = {}) {
  const thermostat = { getState: vi.fn(async (_id: string) => state), apply: vi.fn(async (_id: string, _values: any[]) => {}) };
  const stack = { dashboards: vi.fn(async (_fresh?: boolean) => { if (fail) throw fail; return dashboards; }) };
  const onTap = vi.fn(async (_tokens: object, _state: object) => {});
  const log = vi.fn();
  const homey = { __: () => undefined, i18n: { getLanguage: () => 'en' }, manifest: { id: APP } } as any;
  const service = new ThermostatPresetService(homey, { thermostat, stack, web: { list: () => web, enabled }, onTap }, log);
  return { service, thermostat, stack, onTap, log };
}

const rows = (items: any[]) => items.map(i => [i.id, i.name, i.description]);
const sentTo = (fn: any) => [fn.mock.calls[0][0], fn.mock.calls[0][1].map((v: any) => `${v.capabilityId}=${v.value}`)];

describe('Thermostat Presets cards: the button list', () => {
  it("lists every button that sets something: Homey's dashboards by name, then the web ones", async () => {
    const { service, stack } = setup();
    const items = await service.listButtons('');
    expect(stack.dashboards).toHaveBeenCalledWith(true);
    expect(rows(items)).toEqual([
      ['w1:1', 'Aircon · 21° · Heat · Fan low', 'Living · Button 1'],
      ['w1:2', 'Aircon · 23° · Cool', 'Living · Button 2'],
      ['w1:3', 'Aircon · Off', 'Living · Button 3'],
      ['w2:1', 'Bedroom · 21° · Cool', 'Upstairs · Button 1'],
      ['web-wd-x1:1', 'Aircon · Off', 'Hall (web) · Button 1'],
    ]);
    // What the card runs while the widget can't be read.
    expect(items[1]).toMatchObject({ preset: { deviceId: 'ac', modeCap: 'thermostat_mode', values: [{ capabilityId: 'thermostat_mode', value: 'cool' }, { capabilityId: 'target_temperature', value: 23 }] } });
  });

  it('searches the names and the dashboards', async () => {
    const { service } = setup();
    expect(rows(await service.listButtons('upstairs')).map(r => r[0])).toEqual(['w2:1']);
    expect(rows(await service.listButtons('off')).map(r => r[0])).toEqual(['w1:3', 'web-wd-x1:1']);
  });

  it('puts Any button first for the trigger', async () => {
    const { service } = setup();
    const items = await service.listButtons('', { any: true });
    expect(items[0]).toEqual({ id: 'thermostat:any', name: 'Any button', any: true });
    expect(items).toHaveLength(6);
  });

  it("says why Homey's dashboards are missing without a usable key", async () => {
    const { service } = setup({ fail: new KeyError('noKey') });
    expect(rows(await service.listButtons(''))).toEqual([
      ['web-wd-x1:1', 'Aircon · Off', 'Hall (web) · Button 1'],
      ['none', "Buttons on Homey's dashboards need an API key", 'Widgetkeeper → Configure: an API key with the Homey permission.'],
    ]);
    const { service: scoped } = setup({ fail: new KeyError('keyScope') });
    expect((await scoped.listButtons('')).at(-1)!.description).toBe('keyScope');
  });

  it('logs any other failed read and lists the web buttons, and leaves the web ones out while they are off', async () => {
    const { service, log } = setup({ fail: new Error('Too many requests') });
    expect(rows(await service.listButtons('')).map(r => r[0])).toEqual(['web-wd-x1:1']);
    expect(log).toHaveBeenCalled();
    const { service: off } = setup({ enabled: false });
    expect(rows(await off.listButtons('')).map(r => r[0])).toEqual(['w1:1', 'w1:2', 'w1:3', 'w2:1']);
  });
});

describe('Thermostat Presets cards: running a button', () => {
  const stale = { deviceId: 'old', modeCap: null, values: [{ slot: 'temp', capabilityId: 'target_temperature', value: 30 }] };

  it("sets the device from the button's current settings", async () => {
    const { service, thermostat } = setup();
    await service.run({ id: 'w1:1', preset: stale as any });
    expect(thermostat.getState).toHaveBeenCalledWith('ac');
    expect(sentTo(thermostat.apply)).toEqual(['ac', ['onoff=true', 'thermostat_mode=heat', 'target_temperature=21', 'fan_speed=low']]);
  });

  it("follows a web dashboard's widget, even while the web dashboards are off", async () => {
    const { service, thermostat, stack } = setup({ enabled: false });
    await service.run({ id: 'web-wd-x1:1', preset: stale as any });
    expect(stack.dashboards).not.toHaveBeenCalled();
    expect(sentTo(thermostat.apply)).toEqual(['ac', ['onoff=false']]);
  });

  it('runs the button as saved when its widget is gone, or the dashboards cannot be read', async () => {
    for (const opts of [{ dashboards: [] }, { fail: new KeyError('noKey') }, { fail: new Error('busy') }]) {
      const { service, thermostat } = setup(opts);
      await service.run({ id: 'w1:2', preset: stale as any });
      expect(sentTo(thermostat.apply)).toEqual(['old', ['target_temperature=30']]);
    }
    const { service } = setup({ dashboards: [] });
    await expect(service.run({ id: 'w1:2' })).rejects.toThrow('Button not found');
    expect(service.describe()).toMatchObject({ runs: 0, saved: 0, lastError: 'Button not found' });
  });

  it('turns a device without onoff off through its mode, also from a saved button', async () => {
    const { service, thermostat } = setup({ dashboards: [], state: noOnoff() });
    await service.run({ id: 'w9:1', preset: { deviceId: 'ac', modeCap: 'aircon_mode', values: [{ slot: 'power', capabilityId: 'onoff', value: false }] } });
    expect(sentTo(thermostat.apply)).toEqual(['ac', ['aircon_mode=off']]);
  });

  it("refuses Any button, the key item, an emptied button and one the device can't do", async () => {
    const { service, thermostat } = setup();
    await expect(service.run({ id: 'thermostat:any', any: true })).rejects.toThrow('Pick a button');
    await expect(service.run({ id: 'none' })).rejects.toThrow('Pick a button');
    await expect(service.run(undefined)).rejects.toThrow('Pick a button');
    await expect(service.run({ id: 'w2:3', preset: stale as any })).rejects.toThrow('This button sets nothing');
    await expect(service.run({ id: 'w3:1' })).rejects.toThrow('The widget has no thermostat');
    const { service: noOff } = setup({ state: noOnoff('cool', true) });
    await expect(noOff.run({ id: 'w1:3' })).rejects.toThrow("This button can't be set on this device");
    const { service: gone } = setup({ state: { missing: true } });
    await expect(gone.run({ id: 'w1:1' })).rejects.toThrow('Thermostat not found');
    expect(thermostat.apply).not.toHaveBeenCalled();
  });
});

describe('Thermostat Presets cards: active, and taps', () => {
  it('is active while the device matches the button', async () => {
    const { service } = setup({ state: aircon({ thermostat_mode: 'cool', target_temperature: 23.1 }) });
    expect(await service.isActive({ id: 'w1:2' })).toBe(true);
    expect(await service.isActive({ id: 'w1:1' })).toBe(false);
    expect(await service.isActive({ id: 'w1:3' })).toBe(false);
  });

  it("fires the trigger with the device's name and the button's text, for that button's Flows", async () => {
    const { service, onTap } = setup();
    await service.tapped({ instance: 'w1', button: 2, deviceId: 'ac', values: [{ capabilityId: 'thermostat_mode', value: 'cool' }, { capabilityId: 'target_temperature', value: 23 }] });
    expect(onTap).toHaveBeenCalledWith({ device: 'Aircon', preset: '23° · Cool', button: 2 }, { id: 'w1:2' });
    expect(service.matches({ id: 'w1:2' }, 'w1:2')).toBe(true);
    expect(service.matches({ id: 'w1:1' }, 'w1:2')).toBe(false);
    expect(service.matches({ id: 'thermostat:any', any: true }, 'w1:2')).toBe(true);
    expect(service.matches(undefined, 'w1:2')).toBe(false);
  });

  it('ignores a tap without a widget or button, and never throws', async () => {
    const { service, onTap, log } = setup();
    for (const [instance, button] of [['', 1], ['w1', 4], ['w1', '1'], [7, 1], ['x'.repeat(201), 1]]) {
      await service.tapped({ instance, button, deviceId: 'ac', values: [] });
    }
    expect(onTap).not.toHaveBeenCalled();
    onTap.mockRejectedValueOnce(new Error('no Flows'));
    await expect(service.tapped({ instance: 'w1', button: 3, deviceId: 'ac', values: [{ capabilityId: 'onoff', value: false }] })).resolves.toBeUndefined();
    expect(onTap.mock.calls[0][0]).toEqual({ device: 'Aircon', preset: 'Off', button: 3 });
    expect(log).toHaveBeenCalled();
  });
});

describe('Thermostat Presets: a tap reaches the trigger', () => {
  it('the /apply route passes a button tap on once applied, and a panel change not at all', async () => {
    const app = { thermostat: { apply: vi.fn(async () => {}) }, thermostatPresets: { tapped: vi.fn(async () => {}) }, log: vi.fn() };
    const homey = { app } as any;
    const values = [{ capabilityId: 'onoff', value: false }];
    await thermostatApi.apply({ homey, body: { deviceId: 'ac', values, instance: 'w1', button: 3 } });
    expect(app.thermostatPresets.tapped).toHaveBeenCalledWith({ instance: 'w1', button: 3, deviceId: 'ac', values });
    await thermostatApi.apply({ homey, body: { deviceId: 'ac', values } });
    expect(app.thermostatPresets.tapped).toHaveBeenCalledTimes(1);
    app.thermostat.apply.mockRejectedValueOnce(new Error('Driver says no'));
    await expect(thermostatApi.apply({ homey, body: { deviceId: 'ac', values, instance: 'w1', button: 3 } })).rejects.toThrow('Driver says no');
    expect(app.thermostatPresets.tapped).toHaveBeenCalledTimes(1);
  });

  it('the widget sends its instance and the button with a tap, and neither with a change in the controls', async () => {
    const api = vi.fn(async (method: string, _path: string, _body?: any) => (method === 'GET' ? aircon() : { ok: true }));
    const Homey = {
      api, on: vi.fn(), ready: vi.fn(), setHeight: vi.fn(), __: (key: string) => key,
      getSettings: () => ({ device: { id: 'ac' }, ...MIXED }), getDeviceIds: () => [], getWidgetInstanceId: () => 'w1',
    };
    const root = document.createElement('div');
    document.body.append(root);
    win.mountThermostatWidget(Homey, { root, frame: root });
    await vi.waitFor(() => expect(root.querySelector('.tw-btn:not([disabled])')).toBeTruthy());
    root.querySelectorAll<HTMLButtonElement>('.tw-btn')[2].click();
    await vi.waitFor(() => expect(api).toHaveBeenCalledWith('POST', '/apply', { deviceId: 'ac', values: [{ capabilityId: 'onoff', value: false }], instance: 'w1', button: 3 }));
    (root.querySelector('.tw-header') as HTMLElement).click();
    const power = [...root.querySelectorAll<HTMLElement>('.tw-ctl-row')].find(r => r.querySelector('.tw-ctl-label')!.textContent === 'Power')!;
    [...power.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Off')!.click();
    await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(3));
    expect(api.mock.calls[2]).toEqual(['POST', '/apply', { deviceId: 'ac', values: [{ capabilityId: 'onoff', value: false }] }]);
  });
});
