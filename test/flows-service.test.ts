import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import FlowService, { FLOW_COLORS_SETTING, FLOW_ICONS, FLOWS_COLOR_EVENT, parseFlowId } from '../lib/FlowService.js';
import { FLOW_ICON_IMAGES } from '../lib/flowIconImages.js';
import { FLOW_ICON_PATHS } from './helpers/flowIcons.js';
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

  it('shares a read between keystrokes, but reads a minute-old one again', async () => {
    const { service, flow } = setup();
    await service.getState(['flow:f1']);
    vi.advanceTimersByTime(30e3);
    await service.listFlows('');
    expect(flow.getFlows).toHaveBeenCalledTimes(2);
    await service.listFlows('g');
    await service.listFlows('go');
    await service.getState(['flow:f1']);
    expect(flow.getFlows).toHaveBeenCalledTimes(2);
  });

  it('lists the icons', () => {
    const { service } = setup();
    // Alphabetical by name (the fake Homey has no strings, so the names are the ids).
    expect(service.listIcons('').map(i => i.id)).toEqual([...FLOW_ICONS].sort());
    expect(service.listIcons('moo').map(i => i.id)).toEqual(['moon']);
    expect(service.listIcons('moo')[0].image).toMatch(/^data:image\/png;base64,/);
    // The media widget's icons are optional: None first.
    expect(service.listIcons('', { none: true })[0]).toEqual({ name: 'None', id: 'none' });
    expect(service.listIcons('moo', { none: true }).map(i => i.id)).toEqual(['moon']);
  });

  it('has a preview of every icon, rendered from its current path (else run `npm run flow-icons`)', () => {
    expect(Object.keys(FLOW_ICON_IMAGES)).toEqual(Object.keys(FLOW_ICON_PATHS));
    for (const id of FLOW_ICONS) expect(FLOW_ICON_IMAGES[id].d, id).toBe(FLOW_ICON_PATHS[id].d);
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

describe('setColor (the Flow card)', () => {
  it('stores the colour, sends it over realtime and serves it with the state', async () => {
    const { service, homey } = setup();
    service.setColor('flow:f1', 'green');
    expect(homey.settings.get(FLOW_COLORS_SETTING)).toEqual({ 'flow:f1': 'green' });
    expect(homey.api.realtime).toHaveBeenCalledWith(FLOWS_COLOR_EVENT, { id: 'flow:f1', color: 'green' });
    const [f1, a1] = await service.getState(['flow:f1', 'advanced:a1']);
    expect(f1).toMatchObject({ name: 'Good night', color: 'green' });
    expect(a1).not.toHaveProperty('color');
    expect(service.describe()).toMatchObject({ colors: 1 });
  });

  it('keeps the colours for a new service (an app restart), but not on a deleted flow', async () => {
    const { service, homey } = setup();
    service.setColor('flow:f1', 'red');
    service.setColor('flow:gone', 'red');
    expect(await new FlowService(homey, () => {}).getState(['flow:f1', 'flow:gone'])).toEqual([
      expect.objectContaining({ color: 'red' }),
      { id: 'flow:gone', missing: true },
    ]);
  });

  it('removes the colour with default, and sends nothing when it is unchanged', async () => {
    const { service, homey } = setup();
    service.setColor('advanced:a1', 'purple');
    service.setColor('advanced:a1', 'purple');
    expect(homey.api.realtime).toHaveBeenCalledTimes(1);
    service.setColor('advanced:a1', 'default');
    expect(homey.settings.get(FLOW_COLORS_SETTING)).toEqual({});
    expect(homey.api.realtime).toHaveBeenLastCalledWith(FLOWS_COLOR_EVENT, { id: 'advanced:a1', color: null });
    expect((await service.getState(['advanced:a1']))[0]).not.toHaveProperty('color');
  });

  it('rejects an unknown colour or an id that is no flow', () => {
    const { service } = setup();
    expect(() => service.setColor('flow:f1', 'grey')).toThrow();
    expect(() => service.setColor('none', 'red')).toThrow();
  });

  it("lists the flows without the settings' None", async () => {
    const { service } = setup();
    expect((await service.listColorFlows('')).map(i => i.id)).toEqual(['flow:f3', 'flow:f1', 'advanced:a1']);
  });
});
