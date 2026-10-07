import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import VariableService, { API_KEY_SETTING, checkValue, VARIABLES_STATE_EVENT } from '../lib/VariableService.js';

vi.mock('homey-api', () => homeyApiMock);

const VARIABLES = [
  { id: 'v1', name: 'Guest mode', type: 'boolean', value: false },
  { id: 'v2', name: 'Night setpoint', type: 'number', value: 18 },
  { id: 'v3', name: 'Last message', type: 'string', value: 'Hello' },
  { id: 'v4', name: 'Broken', type: 'object', value: {} },
];

function setup() {
  const homey = fakeHomey(fakeApi({ variables: VARIABLES }));
  const service = new VariableService(homey, () => {});
  service.start();
  return { homey, service, logic: homey.fakeApi.logic };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

describe('checkValue', () => {
  it('only accepts a value of the variable type', () => {
    expect(checkValue('boolean', true)).toBe(true);
    expect(checkValue('number', 2.5)).toBe(2.5);
    expect(checkValue('string', '')).toBe('');
    expect(() => checkValue('boolean', 'true')).toThrow();
    expect(() => checkValue('number', NaN)).toThrow();
    expect(() => checkValue('number', '3')).toThrow();
    expect(() => checkValue('string', 3)).toThrow();
    expect(() => checkValue('string', 'x'.repeat(1001))).toThrow();
  });
});

describe('listVariables', () => {
  it('lists every variable by name with its type and value, None first', async () => {
    const { service } = setup();
    expect(await service.listVariables('')).toEqual([
      { name: 'None', id: 'none' },
      { name: 'Guest mode', description: 'Yes/No · No', id: 'v1' },
      { name: 'Last message', description: 'Text · Hello', id: 'v3' },
      { name: 'Night setpoint', description: 'Number · 18', id: 'v2' },
    ]);
  });

  it('filters on the name', async () => {
    const { service } = setup();
    expect((await service.listVariables('night')).map(i => i.id)).toEqual(['v2']);
  });
});

describe('getState', () => {
  it('connects once and returns the variables in order, missing ones marked', async () => {
    const { service, logic } = setup();
    const [a, b] = await Promise.all([service.getState(['v2', 'gone', 'v1']), service.getState(['v1'])]);
    expect(a).toEqual([
      { id: 'v2', name: 'Night setpoint', type: 'number', value: 18 },
      { id: 'gone', missing: true },
      { id: 'v1', name: 'Guest mode', type: 'boolean', value: false },
    ]);
    expect(b).toEqual([{ id: 'v1', name: 'Guest mode', type: 'boolean', value: false }]);
    expect(logic.connect).toHaveBeenCalledTimes(1);
    expect(logic.listenerCount('variable.update')).toBe(1);
  });

  it('re-reads every few minutes, so a missed event is caught up', async () => {
    const { service, logic } = setup();
    await service.getState(['v1']);
    logic.vars.get('v1')!.value = true; // changed without an event
    expect((await service.getState(['v1']))[0]).toMatchObject({ value: false });
    vi.advanceTimersByTime(5 * 60e3);
    expect((await service.getState(['v1']))[0]).toMatchObject({ value: true });
  });

  it('sends updates of requested variables as realtime events', async () => {
    const { service, homey, logic } = setup();
    await service.getState(['v1']);
    logic.emit('variable.update', { id: 'v1', value: true }); // raw data, only the changed field
    logic.emit('variable.update', { id: 'v2', value: 19 }); // not requested
    expect(homey.api.realtime).toHaveBeenCalledTimes(1);
    expect(homey.api.realtime).toHaveBeenCalledWith(VARIABLES_STATE_EVENT, { id: 'v1', name: 'Guest mode', type: 'boolean', value: true });
    expect((await service.getState(['v1', 'v2'])).map((v: any) => v.value)).toEqual([true, 19]);
  });

  it('marks a deleted variable missing', async () => {
    const { service, homey, logic } = setup();
    await service.getState(['v3']);
    logic.emit('variable.delete', { id: 'v3' });
    expect(homey.api.realtime).toHaveBeenCalledWith(VARIABLES_STATE_EVENT, { id: 'v3', missing: true });
    expect(await service.getState(['v3'])).toEqual([{ id: 'v3', missing: true }]);
  });

  it('disconnects after 10 minutes without a request, and connects again on the next', async () => {
    const { service, logic } = setup();
    await service.getState(['v1']);
    vi.advanceTimersByTime(11 * 60e3);
    await vi.waitFor(() => expect(logic.disconnect).toHaveBeenCalledTimes(1));
    expect(logic.listenerCount('variable.update')).toBe(0);
    expect(service.describe()).toMatchObject({ connected: false, requested: 0 });
    await service.getState(['v1']);
    expect(logic.connect).toHaveBeenCalledTimes(2);
  });
});

/** A personal API key's API: the scopes it has, and Logic writes that land in the app's fake Logic manager. */
function keyApi(logic: any, scopes = ['homey.logic', 'homey.logic.readonly']) {
  return {
    sessions: { getSessionMe: vi.fn(async () => ({ scopes })) },
    logic: {
      updateVariable: vi.fn(async (args: any) => {
        if (!scopes.includes('homey.logic')) throw new Error('Missing Scopes');
        return logic.updateVariable(args);
      }),
    },
  };
}

describe('set', () => {
  afterEach(() => { keyApis.clear(); });

  function withKey(scopes?: string[]) {
    const s = setup();
    const api = keyApi(s.logic, scopes);
    keyApis.set('key-1', api);
    s.homey.settings.set(API_KEY_SETTING, 'key-1');
    return { ...s, keyApi: api };
  }

  it('writes through the API key, with a value of the right type', async () => {
    const { service, logic, keyApi: api } = withKey();
    await service.getState(['v2']);
    await service.set('v2', 20.5);
    expect(api.logic.updateVariable).toHaveBeenCalledWith({ id: 'v2', variable: { value: 20.5 } });
    expect(logic.vars.get('v2')!.value).toBe(20.5);
    expect((await service.getState(['v2']))[0]).toMatchObject({ value: 20.5 });
  });

  it('reads the variable when it is not cached yet', async () => {
    const { service, keyApi: api } = withKey();
    await service.set('v1', true);
    expect(api.logic.updateVariable).toHaveBeenCalledWith({ id: 'v1', variable: { value: true } });
  });

  it('rejects a wrong type and an unknown variable', async () => {
    const { service, keyApi: api } = withKey();
    await expect(service.set('v1', 'yes')).rejects.toThrow();
    await expect(service.set('v2', Number.NaN)).rejects.toThrow();
    await expect(service.set('gone', true)).rejects.toThrow();
    await expect(service.set('v4', {})).rejects.toThrow();
    expect(api.logic.updateVariable).not.toHaveBeenCalled();
  });

  it("says why it can't write: no key, a key without the scope, a key Homey refuses", async () => {
    const { service, homey } = setup();
    await expect(service.set('v1', true)).rejects.toMatchObject({ reason: 'noKey' });
    const { service: scoped } = withKey(['homey.logic.readonly']);
    await expect(scoped.set('v1', true)).rejects.toMatchObject({ reason: 'keyScope' });
    homey.settings.set(API_KEY_SETTING, 'unknown');
    await expect(service.set('v1', true)).rejects.toMatchObject({ reason: 'keyInvalid' });
    // The app's own token never writes: Homey refuses it (`homey.logic.readonly` only).
    expect(homey.fakeApi.logic.updateVariable).not.toHaveBeenCalled();
  });

  it('says the key was not accepted when it is revoked after saving, and drops the cached API', async () => {
    const { service, keyApi: api, logic } = withKey();
    await service.set('v1', true);
    api.logic.updateVariable.mockRejectedValueOnce(Object.assign(new Error('Invalid Session'), { statusCode: 401 }));
    await expect(service.set('v1', false)).rejects.toMatchObject({ reason: 'keyInvalid' });
    // The next write makes a new API with the key (here accepted again).
    const fresh = keyApi(logic);
    keyApis.set('key-1', fresh);
    await service.set('v1', false);
    expect(fresh.logic.updateVariable).toHaveBeenCalledWith({ id: 'v1', variable: { value: false } });
  });
});

describe('saveApiKey', () => {
  afterEach(() => { keyApis.clear(); });

  it('saves a key that may change variables, and removes it again', async () => {
    const { service, homey, logic } = setup();
    keyApis.set('good', keyApi(logic));
    expect(await service.saveApiKey(' good ')).toEqual({ ok: true });
    expect(homey.settings.get(API_KEY_SETTING)).toBe('good');
    expect(service.hasApiKey()).toBe(true);
    expect(await service.saveApiKey('')).toEqual({ ok: true });
    expect(service.hasApiKey()).toBe(false);
  });

  it("doesn't save a key Homey refuses or one without the variables scope", async () => {
    const { service, logic } = setup();
    keyApis.set('readonly', keyApi(logic, ['homey.logic.readonly']));
    expect(await service.saveApiKey('readonly')).toEqual({ ok: false, reason: 'keyScope' });
    expect(await service.saveApiKey('nope')).toEqual({ ok: false, reason: 'keyInvalid' });
    expect(service.hasApiKey()).toBe(false);
  });

  it('switches to a new key at once', async () => {
    const { service, logic } = setup();
    const a = keyApi(logic), b = keyApi(logic);
    keyApis.set('a', a); keyApis.set('b', b);
    await service.saveApiKey('a');
    await service.set('v1', true);
    await service.saveApiKey('b');
    await service.set('v1', false);
    expect(a.logic.updateVariable).toHaveBeenCalledTimes(1);
    expect(b.logic.updateVariable).toHaveBeenCalledTimes(1);
  });
});
