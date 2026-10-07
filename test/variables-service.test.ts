import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock } from './helpers/fakeHomey.js';
import VariableService, { checkValue, VARIABLES_STATE_EVENT } from '../lib/VariableService.js';

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

describe('set', () => {
  it('sets a value of the right type', async () => {
    const { service, logic } = setup();
    await service.getState(['v2']);
    await service.set('v2', 20.5);
    expect(logic.updateVariable).toHaveBeenCalledWith({ id: 'v2', variable: { value: 20.5 } });
    expect((await service.getState(['v2']))[0]).toMatchObject({ value: 20.5 });
  });

  it('reads the variable when it is not cached yet', async () => {
    const { service, logic } = setup();
    await service.set('v1', true);
    expect(logic.updateVariable).toHaveBeenCalledWith({ id: 'v1', variable: { value: true } });
  });

  it('rejects a wrong type and an unknown variable', async () => {
    const { service, logic } = setup();
    await expect(service.set('v1', 'yes')).rejects.toThrow();
    await expect(service.set('v2', Number.NaN)).rejects.toThrow();
    await expect(service.set('gone', true)).rejects.toThrow();
    await expect(service.set('v4', {})).rejects.toThrow();
    expect(logic.updateVariable).not.toHaveBeenCalled();
  });
});
