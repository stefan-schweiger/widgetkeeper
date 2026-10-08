import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import FlowService, { FLOW_ICONS, parseFlowId } from '../lib/FlowService.js';
import { API_KEY_SETTING } from '../lib/PersonalApiKey.js';

vi.mock('homey-api', () => homeyApiMock);

const FLOWS = {
  f1: { id: 'f1', name: 'Good night', enabled: true, triggerable: true, folder: 'fo1' },
  f2: { id: 'f2', name: 'Motion in hallway', enabled: true, triggerable: false, folder: null },
  f3: { id: 'f3', name: 'Away', enabled: false, triggerable: true, folder: null },
};
const ADVANCED = {
  a1: { id: 'a1', name: 'Movie time', enabled: true, triggerable: true, folder: null },
};

function setup() {
  const api: any = fakeApi();
  api.flow = {
    getFlows: vi.fn(async () => FLOWS),
    getAdvancedFlows: vi.fn(async () => ADVANCED),
    getFlowFolders: vi.fn(async () => ({ fo1: { id: 'fo1', name: 'Bedtime' } })),
    // The app's own token may only read flows.
    triggerFlow: vi.fn(async () => { throw new Error('Missing Scopes'); }),
    triggerAdvancedFlow: vi.fn(async () => { throw new Error('Missing Scopes'); }),
  };
  const homey = fakeHomey(api);
  const service = new FlowService(homey, () => {});
  return { homey, service, flow: api.flow };
}

/** A personal API key's API that may start flows (or, with `scopes` lacking it, gets `Missing Scopes`). */
function keyApi(scopes = ['homey.flow.start']) {
  const start = vi.fn(async (_args: { id: string }) => {
    if (!scopes.includes('homey.flow.start')) throw new Error('Missing Scopes');
  });
  return {
    sessions: { getSessionMe: vi.fn(async () => ({ scopes })) },
    flow: { triggerFlow: start, triggerAdvancedFlow: vi.fn(start) },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); keyApis.clear(); });

describe('parseFlowId', () => {
  it('splits the kind from the flow id', () => {
    expect(parseFlowId('flow:f1')).toEqual({ kind: 'flow', flowId: 'f1' });
    expect(parseFlowId('advanced:a1')).toEqual({ kind: 'advanced', flowId: 'a1' });
    expect(parseFlowId('none')).toBeNull();
    expect(parseFlowId('device:x')).toBeNull();
  });
});

describe('listFlows', () => {
  it('lists the flows that can be started, by name, with their type and folder, None first', async () => {
    const { service } = setup();
    expect(await service.listFlows('')).toEqual([
      { name: 'None', id: 'none' },
      { name: 'Away', description: 'Flow', id: 'flow:f3' },
      { name: 'Good night', description: 'Flow · Bedtime', id: 'flow:f1' },
      { name: 'Movie time', description: 'Advanced Flow', id: 'advanced:a1' },
    ]);
  });

  it('filters on the name', async () => {
    const { service } = setup();
    expect((await service.listFlows('movie')).map(i => i.id)).toEqual(['advanced:a1']);
  });

  it('lists the icons', () => {
    const { service } = setup();
    expect(service.listIcons('').map(i => i.id)).toEqual([...FLOW_ICONS]);
    expect(service.listIcons('moo').map(i => i.id)).toEqual(['moon']);
  });
});

describe('getState', () => {
  it('returns the flows in order, deleted ones missing', async () => {
    const { service } = setup();
    expect(await service.getState(['advanced:a1', 'flow:f2', 'flow:f3', 'flow:gone'])).toEqual([
      { id: 'advanced:a1', name: 'Movie time', enabled: true, triggerable: true, advanced: true },
      { id: 'flow:f2', name: 'Motion in hallway', enabled: true, triggerable: false, advanced: false },
      { id: 'flow:f3', name: 'Away', enabled: false, triggerable: true, advanced: false },
      { id: 'flow:gone', missing: true },
    ]);
  });

  it('reuses one read for a minute, then reads again', async () => {
    const { service, flow } = setup();
    await Promise.all([service.getState(['flow:f1']), service.getState(['flow:f3'])]);
    await service.getState(['flow:f1']);
    expect(flow.getFlows).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61e3);
    await service.getState(['flow:f1']);
    expect(flow.getFlows).toHaveBeenCalledTimes(2);
  });

  it('reads again after a failed read', async () => {
    const { service, flow } = setup();
    flow.getFlows.mockRejectedValueOnce(new Error('busy'));
    await expect(service.getState(['flow:f1'])).rejects.toThrow('busy');
    expect((await service.getState(['flow:f1']))[0]).toMatchObject({ name: 'Good night' });
  });
});

describe('trigger', () => {
  function withKey(scopes?: string[]) {
    const s = setup();
    const api = keyApi(scopes);
    keyApis.set('key-1', api);
    s.homey.settings.set(API_KEY_SETTING, 'key-1');
    return { ...s, keyApi: api };
  }

  it('starts a flow or an Advanced Flow through the API key', async () => {
    const { service, keyApi: api, flow } = withKey();
    await service.trigger('flow:f1');
    await service.trigger('advanced:a1');
    expect(api.flow.triggerFlow).toHaveBeenCalledWith({ id: 'f1' });
    expect(api.flow.triggerAdvancedFlow).toHaveBeenCalledWith({ id: 'a1' });
    expect(flow.triggerFlow).not.toHaveBeenCalled();
    expect(service.describe()).toMatchObject({ apiKey: true, triggered: 2, lastTriggerError: null });
  });

  it("says why it can't: no key, a key that may not start flows", async () => {
    const { service } = setup();
    await expect(service.trigger('flow:f1')).rejects.toMatchObject({ reason: 'noKey' });
    const { service: scoped } = withKey(['homey.logic']);
    await expect(scoped.trigger('flow:f1')).rejects.toMatchObject({ reason: 'keyScope' });
    expect(scoped.describe().lastTriggerError).toMatch(/Missing Scopes/);
  });

  it('rejects an id that is no flow', async () => {
    const { service, keyApi: api } = withKey();
    await expect(service.trigger('none')).rejects.toThrow();
    expect(api.flow.triggerFlow).not.toHaveBeenCalled();
  });
});
