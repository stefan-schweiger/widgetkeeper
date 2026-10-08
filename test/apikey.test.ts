import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import PersonalApiKey, { API_KEY_SETTING } from '../lib/PersonalApiKey.js';
import VariableService from '../lib/VariableService.js';

vi.mock('homey-api', () => homeyApiMock);

/** A personal API key's API with these scopes; `logic.updateVariable` lands in `logic` (the app's fake). */
function keyApi(scopes: string[], logic?: any) {
  return {
    sessions: { getSessionMe: vi.fn(async () => ({ scopes })) },
    logic: { updateVariable: vi.fn(async (args: any) => logic?.updateVariable(args)) },
  };
}

function setup() {
  const homey = fakeHomey(fakeApi({ variables: [{ id: 'v1', name: 'Guest mode', type: 'boolean', value: false }] }));
  return { homey, key: new PersonalApiKey(homey, () => {}) };
}

afterEach(() => { keyApis.clear(); });

describe('save', () => {
  it('saves a key and says what it may do, and removes it again', async () => {
    const { homey, key } = setup();
    keyApis.set('both', keyApi(['homey.logic', 'homey.flow.start']));
    expect(await key.save(' both ')).toEqual({ ok: true, variables: true, flows: true });
    expect(homey.settings.get(API_KEY_SETTING)).toBe('both');
    expect(key.has()).toBe(true);
    expect(await key.save('')).toEqual({ ok: true, variables: false, flows: false });
    expect(key.has()).toBe(false);
  });

  it('saves a key that may do only one of the two', async () => {
    const { key } = setup();
    keyApis.set('vars', keyApi(['homey.logic']));
    keyApis.set('flows', keyApi(['homey.flow.start']));
    keyApis.set('owner', keyApi(['homey']));
    expect(await key.save('vars')).toEqual({ ok: true, variables: true, flows: false });
    expect(await key.save('flows')).toEqual({ ok: true, variables: false, flows: true });
    expect(await key.save('owner')).toEqual({ ok: true, variables: true, flows: true });
  });

  it("doesn't save a key Homey refuses or one that may do neither", async () => {
    const { key } = setup();
    keyApis.set('readonly', keyApi(['homey.logic.readonly', 'homey.flow.readonly']));
    expect(await key.save('readonly')).toEqual({ ok: false, reason: 'keyScope' });
    expect(await key.save('nope')).toEqual({ ok: false, reason: 'keyInvalid' });
    expect(key.has()).toBe(false);
  });

  it('switches to a new key at once', async () => {
    const { homey, key } = setup();
    const logic = homey.fakeApi.logic;
    const a = keyApi(['homey.logic'], logic), b = keyApi(['homey.logic'], logic);
    keyApis.set('a', a); keyApis.set('b', b);
    const service = new VariableService(homey, () => {}, () => {}, key);
    await key.save('a');
    await service.set('v1', true);
    await key.save('b');
    await service.set('v1', false);
    expect(a.logic.updateVariable).toHaveBeenCalledTimes(1);
    expect(b.logic.updateVariable).toHaveBeenCalledTimes(1);
  });
});

describe('run', () => {
  it('says why it failed: no key, a missing scope, a key Homey refuses', async () => {
    const { homey, key } = setup();
    await expect(key.run(async () => 1)).rejects.toMatchObject({ reason: 'noKey' });
    keyApis.set('k', keyApi(['homey.logic']));
    homey.settings.set(API_KEY_SETTING, 'k');
    await expect(key.run(async () => { throw new Error('Missing Scopes: homey.flow.start'); })).rejects.toMatchObject({ reason: 'keyScope' });
    await expect(key.run(async () => { throw Object.assign(new Error('Invalid Session'), { statusCode: 401 }); })).rejects.toMatchObject({ reason: 'keyInvalid' });
    homey.settings.set(API_KEY_SETTING, 'unknown');
    await expect(key.run(async () => 1)).rejects.toMatchObject({ reason: 'keyInvalid' });
  });

  it('passes other errors on unchanged', async () => {
    const { homey, key } = setup();
    keyApis.set('k', keyApi(['homey.flow.start']));
    homey.settings.set(API_KEY_SETTING, 'k');
    const err = new Error('Flow is disabled');
    await expect(key.run(async () => { throw err; })).rejects.toBe(err);
  });
});
