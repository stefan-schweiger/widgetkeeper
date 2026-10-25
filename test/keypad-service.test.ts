import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import KeypadService, { BOOLEAN_WORDS, KEYPAD_SECRET, checkCapabilityValue, parseSource } from '../lib/KeypadService.js';
import { KeyError } from '../lib/PersonalApiKey.js';
import Secrets from '../lib/secrets.js';

vi.mock('homey-api', () => homeyApiMock);

/** Heimdall's surveillance switch, a lock that can't be set from outside, and a dimmer. */
function devices() {
  return [
    fakeDevice({
      id: 'alarm', name: 'Surveillance', caps: {
        homealarm_state: { type: 'enum', title: 'Home Alarm state', value: 'armed', values: [
          { id: 'armed', title: 'Armed' }, { id: 'disarmed', title: 'Disarmed' }, { id: 'partially_armed', title: 'Partially armed' },
        ] },
      },
    }),
    fakeDevice({ id: 'door', name: 'Front door', caps: { locked: { type: 'boolean', title: 'Locked', value: true, setable: false } } }),
    fakeDevice({ id: 'dim', name: 'Hall', caps: { dim: { type: 'number', title: 'Dim level', value: 0.5, min: 0, max: 1, units: '%' } } }),
  ];
}

function setup() {
  const devs = devices();
  const homey = fakeHomey(fakeApi({ devices: devs }));
  const flows = {
    getState: vi.fn(async (ids: string[]) => ids.map(id => ({ id, name: `Flow ${id}`, enabled: true, triggerable: true, advanced: false }))),
    trigger: vi.fn(async (_id: string) => {}),
  };
  const values = {
    getState: vi.fn(async (slots: string[]) => slots.map((slot) => {
      const [deviceId, capabilityId] = slot.split(':');
      const d = devs.find(x => x.id === deviceId);
      const cap = d?.capabilitiesObj[capabilityId];
      return cap
        ? { deviceId, capabilityId, name: d!.name, capability: { title: cap.title, type: cap.type, values: cap.values ?? null, icon: null }, value: cap.value }
        : { deviceId, capabilityId, missing: true };
    })),
    listSlots: vi.fn(async () => [{ name: 'None', id: 'none' }, { name: 'Surveillance · Home Alarm state', id: 'alarm:homealarm_state' }]),
  };
  const variables = {
    getState: vi.fn(async (ids: string[]) => ids.map(id => (id === 'v1' ? { id, name: 'TV time', type: 'boolean', value: false } : { id, missing: true }))),
    set: vi.fn(async (_id: string, _value: unknown) => {}),
    listVariables: vi.fn(async () => [{ name: 'None', id: 'none' }, { name: 'TV time', description: 'Yes/No · No', id: 'v1', type: 'boolean' }]),
    listPresetValues: vi.fn(async () => [{ name: 'Yes', id: 'boolean:true', value: true, type: 'boolean' }]),
  };
  const log = vi.fn();
  const keypad = new KeypadService(homey, { flows, values, variables } as any, log);
  return { homey, keypad, flows, values, variables, devs, log };
}

/** A code's id as the `code` setting keeps it. */
function codeId(keypad: KeypadService, digits: string) {
  const [item] = keypad.codeItems(digits);
  return item.id;
}

afterEach(() => { vi.useRealTimers(); });

describe('Keypad: the state source', () => {
  it('parses the state setting', () => {
    expect(parseSource('var:v1')).toEqual({ kind: 'variable', id: 'v1' });
    expect(parseSource('cap:alarm:homealarm_state')).toEqual({ kind: 'capability', deviceId: 'alarm', capabilityId: 'homealarm_state' });
    for (const bad of ['none', 'var:', 'cap:alarm', '', null, 3]) expect(parseSource(bad)).toBeNull();
  });

  it('lists None, the variables, then the device values, each id prefixed by its kind', async () => {
    const { keypad } = setup();
    expect(await keypad.listSources('')).toEqual([
      { name: 'None', id: 'none' },
      { name: 'TV time', description: 'Variable · Yes/No · No', id: 'var:v1', type: 'boolean' },
      { name: 'Surveillance · Home Alarm state', id: 'cap:alarm:homealarm_state' },
    ]);
  });

  it("answers the variable's or the capability's state, and the flows", async () => {
    const { keypad, flows } = setup();
    expect(await keypad.getState('var:v1', [])).toEqual({ source: { kind: 'variable', id: 'v1', name: 'TV time', type: 'boolean', value: false }, flows: [] });
    const state = await keypad.getState('cap:alarm:homealarm_state', ['flow:f1', 'nope']);
    expect(state.source).toMatchObject({ kind: 'capability', deviceId: 'alarm', capabilityId: 'homealarm_state', name: 'Surveillance', value: 'armed' });
    expect(flows.getState).toHaveBeenCalledWith(['flow:f1']); // only flow ids
    expect(state.flows).toEqual([{ id: 'flow:f1', name: 'Flow flow:f1', enabled: true, triggerable: true, advanced: false }]);
    expect((await keypad.getState('var:gone', [])).source).toEqual({ kind: 'variable', id: 'gone', missing: true });
    expect((await keypad.getState('cap:alarm:nope', [])).source).toEqual({ kind: 'capability', deviceId: 'alarm', capabilityId: 'nope', missing: true });
    expect(await keypad.getState(null, [])).toEqual({ source: null, flows: [] });
  });

  it("keeps the state when the flows can't be read", async () => {
    const { keypad, flows } = setup();
    flows.getState.mockRejectedValueOnce(new Error('busy'));
    expect(await keypad.getState('var:v1', ['flow:f1'])).toMatchObject({ source: { kind: 'variable' }, flows: null });
  });
});

describe("Keypad: the buttons' values", () => {
  it("lists a list capability's values by title, keeping each value and its type", async () => {
    const { keypad } = setup();
    expect(await keypad.listStateValues('cap:alarm:homealarm_state', '')).toEqual([
      { name: 'None', id: 'none' },
      { id: 'string:"armed"', name: 'Armed', description: 'Current value', value: 'armed', type: 'string' },
      { id: 'string:"disarmed"', name: 'Disarmed', description: undefined, value: 'disarmed', type: 'string' },
      { id: 'string:"partially_armed"', name: 'Partially armed', description: undefined, value: 'partially_armed', type: 'string' },
    ]);
    expect((await keypad.listStateValues('cap:alarm:homealarm_state', 'part')).map(i => i.name)).toEqual(['Partially armed']);
  });

  it("names a yes/no capability's values in its words, and says when it can't be set", async () => {
    const { keypad } = setup();
    expect((await keypad.listStateValues('cap:door:locked', '')).slice(1)).toEqual([
      { id: 'boolean:true', name: 'Locked', description: 'Current value · Can’t be set: give the button a Flow', value: true, type: 'boolean' },
      { id: 'boolean:false', name: 'Unlocked', description: 'Can’t be set: give the button a Flow', value: false, type: 'boolean' },
    ]);
  });

  it('offers a number as typed, a decimal comma too, then the current value', async () => {
    const { keypad } = setup();
    expect((await keypad.listStateValues('cap:dim:dim', '0,25')).map(i => [i.name, i.value])).toEqual([['0,25', 0.25]]);
    expect((await keypad.listStateValues('cap:dim:dim', '')).map(i => [i.name, i.value])).toEqual([['None', undefined], ['0.5', 0.5]]);
  });

  it("asks a variable's values of Variable Presets' list, and wants the state first", async () => {
    const { keypad, variables } = setup();
    expect(await keypad.listStateValues('var:v1', 'y')).toEqual([{ name: 'Yes', id: 'boolean:true', value: true, type: 'boolean' }]);
    expect(variables.listPresetValues).toHaveBeenCalledWith('v1', 'y');
    await expect(keypad.listStateValues(undefined, '')).rejects.toThrow(/State from first/);
    await expect(keypad.listStateValues('cap:alarm:nope', '')).rejects.toThrow(/not found/);
  });

  it('checks a value against the capability', () => {
    const cap = (type: string, more = {}) => ({ title: 'X', type, units: null, decimals: null, min: null, max: null, values: null, ...more });
    expect(checkCapabilityValue(cap('enum', { values: [{ id: 'armed', title: 'Armed' }] }), 'armed')).toBe('armed');
    expect(() => checkCapabilityValue(cap('enum', { values: [{ id: 'armed', title: 'Armed' }] }), 'off')).toThrow(/Invalid value/);
    expect(checkCapabilityValue(cap('number', { min: 0, max: 1 }), 1)).toBe(1);
    expect(() => checkCapabilityValue(cap('number', { min: 0, max: 1 }), 2)).toThrow(/Invalid value/);
    expect(() => checkCapabilityValue(cap('boolean'), 'true')).toThrow(/Invalid value/);
    expect(() => checkCapabilityValue(cap('string'), 'x'.repeat(201))).toThrow(/Invalid value/);
  });
});

describe('Keypad: the code', () => {
  it('offers typed digits as dots, never keeping them; anything else offers None with how', () => {
    const { keypad, homey } = setup();
    const secrets = Secrets.for(homey);
    expect(keypad.codeItems('')).toEqual([{ name: 'None', description: 'Type a code of 3 to 6 digits', id: 'none' }]);
    expect(keypad.codeItems('12')).toEqual([{ name: 'None', description: 'Type a code of 3 to 6 digits', id: 'none' }]);
    expect(keypad.codeItems('12a4')[0].id).toBe('none');
    expect(keypad.codeItems('1234567')[0].id).toBe('none');
    expect(secrets.get(KEYPAD_SECRET)).toBeNull(); // no key until the first code
    const [item] = keypad.codeItems(' 4711 ');
    expect(item).toMatchObject({ name: '••••', description: 'A 4-digit code', digits: 4 });
    expect(item.id).toMatch(/^code:v1:[0-9a-f]{8}:[0-9a-f]{16}:[0-9a-f]{32}$/);
    expect(JSON.stringify(item)).not.toContain('4711');
    expect(secrets.get(KEYPAD_SECRET)).toMatch(/^[0-9a-f]{64}$/);
    // A salt each time: the same code twice gives two ids.
    expect(codeId(keypad, '4711')).not.toBe(item.id);
  });

  it('takes the right code, counts wrong ones, and locks the fifth for 30 s, doubling', () => {
    vi.useFakeTimers();
    const { keypad, log } = setup();
    const id = codeId(keypad, '4711');
    expect(keypad.checkCode(id, '4711')).toBeNull();
    expect([1, 2, 3, 4].map(() => keypad.checkCode(id, '1234'))).toEqual([
      { result: 'wrongCode', left: 4 }, { result: 'wrongCode', left: 3 }, { result: 'wrongCode', left: 2 }, { result: 'wrongCode', left: 1 },
    ]);
    expect(keypad.checkCode(id, '1234')).toEqual({ result: 'locked', retryAfter: 30 });
    expect(log).toHaveBeenCalledWith('Keypad: 5 wrong codes in a row, locked for 30 s');
    // Locked: even the right code waits.
    vi.advanceTimersByTime(10e3);
    expect(keypad.checkCode(id, '4711')).toEqual({ result: 'locked', retryAfter: 20 });
    vi.advanceTimersByTime(20e3);
    expect(keypad.checkCode(id, '0000')).toEqual({ result: 'locked', retryAfter: 60 });
    vi.advanceTimersByTime(60e3);
    expect(keypad.checkCode(id, '4711')).toBeNull();
    // The right one starts the count again.
    expect(keypad.checkCode(id, '1234')).toEqual({ result: 'wrongCode', left: 4 });
    expect(keypad.describe()).toMatchObject({ key: true, wrongCodes: 7, lockouts: 2, lockedNow: 0 });
  });

  it('counts each code apart, and takes no code for a button without one', () => {
    const { keypad } = setup();
    const a = codeId(keypad, '111');
    const b = codeId(keypad, '222');
    for (let i = 0; i < 5; i++) keypad.checkCode(a, '999');
    expect(keypad.checkCode(a, '111')).toMatchObject({ result: 'locked' });
    expect(keypad.checkCode(b, '222')).toBeNull();
    expect(keypad.checkCode(undefined, undefined)).toBeNull();
    expect(keypad.checkCode('none', '')).toBeNull();
  });

  it("wants the code set again when it was made with another key, or isn't one", () => {
    const { keypad, homey } = setup();
    const id = codeId(keypad, '4711');
    expect(keypad.checkCode('code:v1:nonsense', '4711')).toEqual({ result: 'codeReset' });
    Secrets.for(homey).unset(KEYPAD_SECRET); // the app reinstalled: a new key with the next code
    expect(keypad.checkCode(id, '4711')).toEqual({ result: 'codeReset' });
    codeId(keypad, '123');
    expect(keypad.checkCode(id, '4711')).toEqual({ result: 'codeReset' });
  });

  it('turns down what isn\'t 3–6 digits as a wrong code', () => {
    const { keypad } = setup();
    const id = codeId(keypad, '4711');
    expect(keypad.checkCode(id, 4711)).toEqual({ result: 'wrongCode', left: 4 });
    expect(keypad.checkCode(id, '47110000')).toEqual({ result: 'wrongCode', left: 3 });
  });
});

describe('Keypad: a press', () => {
  it('starts the Flow once the code is right, and not before', async () => {
    const { keypad, flows } = setup();
    const id = codeId(keypad, '4711');
    expect(await keypad.press({ flow: 'flow:f1', codeId: id, code: '0000' })).toEqual({ result: 'wrongCode', left: 4 });
    expect(flows.trigger).not.toHaveBeenCalled();
    expect(await keypad.press({ flow: 'flow:f1', codeId: id, code: '4711' })).toEqual({ result: 'done' });
    expect(flows.trigger).toHaveBeenCalledWith('flow:f1');
    expect(await keypad.press({ flow: 'advanced:a1' })).toEqual({ result: 'done' }); // a button without the code
    expect(keypad.describe().pressed).toBe(2);
  });

  it("sets a variable through Variables' service, and a capability with the app's token", async () => {
    const { keypad, variables, devs } = setup();
    expect(await keypad.press({ source: 'var:v1', value: true })).toEqual({ result: 'done' });
    expect(variables.set).toHaveBeenCalledWith('v1', true);
    expect(await keypad.press({ source: 'cap:alarm:homealarm_state', value: 'disarmed' })).toEqual({ result: 'done' });
    expect(devs[0].sent).toEqual(['homealarm_state="disarmed"']);
  });

  it("won't set a capability that can't be set, or to a value it doesn't have", async () => {
    const { keypad, devs } = setup();
    expect(await keypad.press({ source: 'cap:door:locked', value: false })).toEqual({ result: 'notSetable' });
    await expect(keypad.press({ source: 'cap:alarm:homealarm_state', value: 'panic' })).rejects.toThrow(/Invalid value/);
    await expect(keypad.press({ source: 'cap:alarm:nope', value: 'x' })).rejects.toThrow(/has no nope/);
    await expect(keypad.press({})).rejects.toThrow(/Nothing to do/);
    expect(devs.flatMap(d => d.sent)).toEqual([]);
    expect(keypad.describe().lastError).toMatch(/Nothing to do/);
  });

  it("passes a missing API key on, so the route can say so", async () => {
    const { keypad, flows } = setup();
    flows.trigger.mockRejectedValueOnce(new KeyError('noKey'));
    await expect(keypad.press({ flow: 'flow:f1' })).rejects.toBeInstanceOf(KeyError);
  });

  it('reports counts, never codes or their hashes', () => {
    const { keypad } = setup();
    const id = codeId(keypad, '4711');
    keypad.checkCode(id, '1234');
    const text = JSON.stringify(keypad.describe());
    expect(text).not.toContain(id.split(':')[4]);
    expect(text).not.toContain('4711');
  });
});

describe('Keypad: the words a yes/no is shown with', () => {
  it('are known by the strings', () => {
    const en = JSON.parse(readFileSync('locales/en.json', 'utf8'));
    for (const words of Object.values(BOOLEAN_WORDS)) for (const w of words) expect(en.keypad[w], w).toBeTruthy();
  });
});
