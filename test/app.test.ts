import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { homeyApiMock } from './helpers/fakeHomey.js';
import { bootApp, manifest } from './helpers/fakeApp.js';
import { DEBUG_LOG_SETTING } from '../lib/Diagnostics.js';
import { DAYS_SINCE_SETTING } from '../lib/DaysSinceService.js';
import { POPUP_NAMES_SETTING } from '../lib/PopupService.js';

vi.mock('homey', () => import('./helpers/homeySdk.js').then(m => m.homeyMock));
vi.mock('homey-api', () => homeyApiMock);
// The app's own files (/userdata: the secrets, the heatmap history) are kept in memory here.
vi.mock('../lib/secrets.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/secrets.js')>(),
  fileStorage: () => {
    let text: string | null = null;
    return { read: () => text, write: (t: string) => { text = t; } };
  },
}));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T10:00:00Z'));
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const KINDS = ['triggers', 'conditions', 'actions'] as const;

describe('the app: start', () => {
  it('starts on a Homey with only its own Flow cards and widgets (an unknown id would throw)', async () => {
    const { app } = await bootApp();
    expect(app.web).toBeTruthy();
    expect(app.popups).toBeTruthy();
    // Its files are the memory ones above: the real ones would fail to write to /userdata here.
    const { fileStorage } = await import('../lib/secrets.js');
    const file = fileStorage('/userdata/not-here/test.json');
    file.write('{}');
    expect(file.read()).toBe('{}');
  });

  it('listens to every Flow card that runs, and to every autocomplete argument, and to nothing else', async () => {
    const { flow } = await bootApp();
    for (const kind of KINDS) {
      for (const c of manifest.flow[kind] as any[]) {
        const card = flow.cards.get(`${kind}:${c.id}`);
        // A trigger without arguments needs no run listener: it fires for every Flow that uses it.
        const runs = kind !== 'triggers' || (c.args ?? []).length > 0;
        expect([c.id, !!card?.run]).toEqual([c.id, runs]);
        const autocompletes = (c.args ?? []).filter((a: any) => a.type === 'autocomplete').map((a: any) => a.name).sort();
        expect([c.id, Object.keys(card?.autocompletes ?? {}).sort()]).toEqual([c.id, autocompletes]);
      }
    }
  });

  it("registers every widget setting's autocomplete with Homey", async () => {
    const { dashboards } = await bootApp();
    const want: string[] = [];
    for (const [type, w] of Object.entries<any>(manifest.widgets)) {
      for (const s of w.settings ?? []) if (s.type === 'autocomplete') want.push(`${type}.${s.id}`);
    }
    const have = [...dashboards.widgets].flatMap(([type, w]) => Object.entries(w.autocompletes)
      .filter(([, fn]) => typeof fn === 'function').map(([id]) => `${type}.${id}`));
    expect(have.sort()).toEqual(want.sort());
  });
});

describe('the app: Flow cards', () => {
  /** Each action card's arguments, and the service call they become. */
  const RUNS: [card: string, service: string, method: string, args: Record<string, unknown>, call: unknown[]][] = [
    ['popup_show', 'popups', 'show', { screen: { id: 'all' }, text: 'Hi', duration: 2, unit: 'minutes', picture: { id: 'none' }, sound: 'chime' },
      [expect.objectContaining({ target: 'all', text: 'Hi', seconds: 120, sound: 'chime' })]],
    ['popup_show', 'popups', 'show', { screen: { id: 'all' }, text: 'Hi', duration: 45, unit: 'seconds' }, [expect.objectContaining({ seconds: 45 })]],
    ['popup_show_image', 'popups', 'show', { screen: { id: 'name:hall' }, text: 'Hi', duration: 1, unit: 'minutes', droptoken: null },
      [expect.objectContaining({ target: 'name:hall', seconds: 60 })]],
    ['popup_ask', 'popups', 'ask', { screen: { id: 'all' }, question: 'Open?', seconds: 30, picture: { id: 'none' } },
      [expect.objectContaining({ target: 'all', text: 'Open?', seconds: 30 })]],
    ['popup_ask_image', 'popups', 'ask', { screen: { id: 'all' }, question: 'Open?', seconds: 20, droptoken: null },
      [expect.objectContaining({ text: 'Open?', seconds: 20 })]],
    ['popup_close', 'popups', 'close', { screen: { id: 'name:hall' } }, ['name:hall']],
    ['textline_set', 'textLines', 'set', { board: { id: 'b1' }, text: 'Hello' }, ['b1', 'Hello']],
    ['textline_set_color', 'textLines', 'set', { board: { name: 'Kitchen' }, text: 'Hi', color: 'red' }, ['Kitchen', 'Hi', 'red']],
    ['textline_clear', 'textLines', 'clear', { board: { id: 'b1' } }, ['b1']],
    ['stack_show', 'stack', 'show', { widget: 'timers', minutes: 5 }, ['timers', 5]],
    ['stack_resume', 'stack', 'resume', {}, []],
    ['values_set_color', 'values', 'setColor', { slot: { id: 'd1:measure_temperature' }, color: 'red' }, ['d1:measure_temperature', 'red']],
    ['values_set_color', 'values', 'setColor', { color: 'red' }, ['', 'red']],
    ['thermostat_run_preset', 'thermostatPresets', 'run', { preset: { id: 'w1:2' } }, [{ id: 'w1:2' }]],
    ['flows_set_color', 'flows', 'setColor', { flow: { id: 'flow:f1' }, color: 'blue' }, ['flow:f1', 'blue']],
    // A counter argument is its id, or the name typed for a new one.
    ['dayssince_set', 'daysSince', 'setDaysAgo', { counter: { id: 'filter', name: 'Filter' }, days: 3 }, ['filter', 3]],
    ['dayssince_set', 'daysSince', 'setDaysAgo', { counter: { name: 'Boiler' }, days: 0 }, ['Boiler', 0]],
    ['dayssince_reset', 'daysSince', 'reset', { counter: { id: 'filter', name: 'Filter' } }, ['filter']],
  ];

  it.each(RUNS)('%s calls %s.%s with its arguments', async (id, service, method, args, call) => {
    const { app, flow } = await bootApp();
    const spy = vi.spyOn((app as any)[service], method).mockReturnValue(undefined as any);
    await flow.cards.get(`actions:${id}`)!.run!(args);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]).toEqual(call);
  });

  it('every action card is in the table above', () => {
    expect([...new Set(RUNS.map(r => r[0]))].sort()).toEqual((manifest.flow.actions as any[]).map(c => c.id).filter(id => id !== 'web_password_remove').sort());
  });

  it('removes a forgotten web dashboards password', async () => {
    const { app, flow } = await bootApp();
    await app.webPassword.setPassword('correct horse');
    const { token } = await app.webPassword.login('correct horse') as { token: string };
    await flow.cards.get('actions:web_password_remove')!.run!({});
    expect(app.webPassword.isSet).toBe(false);
    expect(app.webPassword.check(token)).toBe(false);
  });

  it('says when a timer finished, with its name and minutes', async () => {
    const { app, flow } = await bootApp();
    app.timers.startTimer('w1', 5, 'Tea');
    await vi.advanceTimersByTimeAsync(5 * 60e3 + 1000);
    expect(flow.cards.get('triggers:timers_finished')!.trigger).toHaveBeenCalledWith({ timer: 'Tea', minutes: 5 });
  });

  it("says when a Days Since counter became overdue, for that counter's Flows", async () => {
    const { app, flow } = await bootApp();
    await (app as any).daysSinceOverdue({ key: 'filter', name: 'Filter', days: 30 });
    const card = flow.cards.get('triggers:dayssince_overdue')!;
    expect(card.trigger).toHaveBeenCalledWith({ counter: 'Filter', days: 30 }, { key: 'filter' });
    const matches = vi.spyOn(app.daysSince, 'matches').mockReturnValue(true);
    await expect(card.run!({ counter: { id: 'filter' } }, { key: 'filter' })).resolves.toBe(true);
    expect(matches).toHaveBeenCalledWith({ id: 'filter' }, 'filter');
    const isOverdue = vi.spyOn(app.daysSince, 'isOverdue').mockReturnValue(false);
    await expect(flow.cards.get('conditions:dayssince_is_overdue')!.run!({ counter: { id: 'filter' } })).resolves.toBe(false);
    expect(isOverdue).toHaveBeenCalledWith({ id: 'filter' });
  });
});

describe('the app: Thermostat Presets cards', () => {
  it("says when a Thermostat Presets button was tapped, for that button's Flows, and whether one is active", async () => {
    const { app, flow } = await bootApp();
    vi.spyOn(app.thermostat, 'getState').mockResolvedValue({ name: 'Aircon', icon: null, values: {}, caps: {} });
    await app.thermostatPresets.tapped({ instance: 'w1', button: 2, deviceId: 'd1', values: [{ capabilityId: 'target_temperature', value: 21 }] });
    const card = flow.cards.get('triggers:thermostat_preset_tapped')!;
    expect(card.trigger).toHaveBeenCalledWith({ device: 'Aircon', preset: '21°', button: 2 }, { id: 'w1:2' });
    await expect(card.run!({ preset: { id: 'w1:2' } }, { id: 'w1:2' })).resolves.toBe(true);
    await expect(card.run!({ preset: { id: 'w1:1' } }, { id: 'w1:2' })).resolves.toBe(false);
    const isActive = vi.spyOn(app.thermostatPresets, 'isActive').mockResolvedValue(true);
    await expect(flow.cards.get('conditions:thermostat_preset_active')!.run!({ preset: { id: 'w1:2' } })).resolves.toBe(true);
    expect(isActive).toHaveBeenCalledWith({ id: 'w1:2' });
  });

  it("lists the web dashboards' buttons, and says the key is missing for Homey's", async () => {
    const { app, flow, homey } = await bootApp();
    homey.settings.set('webDashboardsEnabled', true);
    homey.settings.set('webDashboards', [{
      id: 'wd', name: 'Hall', columns: [[{ id: 'x1', type: 'thermostat', settings: { device: { id: 'ac', name: 'Aircon' }, b1Power: 'off' } }]],
    }]);
    // The web dashboards fill a missing setting with the manifest's default: buttons 2 and 3 turn the device on.
    const items = await flow.cards.get('actions:thermostat_run_preset')!.autocompletes.preset('') as any[];
    expect(items.map(i => [i.id, i.name])).toEqual([
      ['web-wd-x1:1', 'Aircon · Off'], ['web-wd-x1:2', 'Aircon · On'], ['web-wd-x1:3', 'Aircon · On'],
      ['none', "Buttons on Homey's dashboards need an API key"],
    ]);
    const any = await flow.cards.get('triggers:thermostat_preset_tapped')!.autocompletes.preset('') as any[];
    expect(any[0]).toMatchObject({ any: true });
    expect((await app.diagnostics.report(undefined)).thermostatPresets).toEqual({ runs: 0, saved: 0, taps: 0, lastError: null });
  });
});

describe('the app: logs', () => {
  it('keeps what it logs for the diagnostics, routine detail only with debug logging on', async () => {
    const { app, homey } = await bootApp();
    const lines = async () => (await app.diagnostics.report(undefined)).log as string[];
    app.debug('routine detail 1');
    expect((await lines()).some(l => l.includes('routine detail 1'))).toBe(false);
    homey.settings.set(DEBUG_LOG_SETTING, true);
    app.debug('routine detail 2');
    app.log('Something failed:', new Error('boom'));
    app.error('bad thing');
    const log = await lines();
    expect(log.some(l => l.includes('routine detail 2'))).toBe(true);
    expect(log.some(l => / ERROR Something failed: Error: boom\n\s+at /.test(l))).toBe(true);
    expect(log.some(l => l.endsWith(' ERROR bad thing'))).toBe(true);
    // The SDK's own log gets them too.
    expect((app as any).sdkLog.some((a: unknown[]) => a[0] === 'bad thing')).toBe(true);
  });
});

describe('the app: stop', () => {
  it('stops every service that has a stop(), writing what was waiting to be saved', async () => {
    const { app, homey } = await bootApp();
    const stops = Object.entries(app as any)
      .filter(([, v]) => v && typeof (v as any).stop === 'function')
      .map(([name, v]) => [name, vi.spyOn(v as any, 'stop')] as const);
    expect(stops.length).toBeGreaterThanOrEqual(19);
    app.popups.forScreen('Hall');
    app.daysSince.reset('Filter');
    homey.settings.set.mockClear();
    await app.onUninit();
    for (const [name, spy] of stops) expect([name, spy.mock.calls.length]).toEqual([name, 1]);
    const written = homey.settings.set.mock.calls.map((c: unknown[]) => c[0]);
    expect(written).toEqual(expect.arrayContaining([POPUP_NAMES_SETTING, DAYS_SINCE_SETTING]));
  });
});
