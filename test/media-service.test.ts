import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeDevice, fakeHomey, homeyApiMock, keyApis } from './helpers/fakeHomey.js';
import FlowService from '../lib/FlowService.js';
import MediaService, { MEDIA_ART_EVENT, MEDIA_STATE_EVENT, mediaArt, parseCardId } from '../lib/MediaService.js';
import { API_KEY_SETTING, KeyError } from '../lib/PersonalApiKey.js';

vi.mock('homey-api', () => homeyApiMock);

const art = (lastUpdated: number) => [{ type: 'media', id: 'albumart', title: 'Artwork', imageObj: { id: 'img1', url: '/api/image/img1', lastUpdated } }];

function sonos() {
  const d: any = fakeDevice({
    id: 'tv', name: 'TV', class: 'speaker',
    caps: {
      speaker_playing: { type: 'boolean', value: false },
      speaker_track: { type: 'string', value: 'HDMI', setable: false },
      speaker_artist: { type: 'string', value: null, setable: false },
      speaker_next: { type: 'boolean', value: null },
      speaker_prev: { type: 'boolean', value: null },
      speaker_repeat: { type: 'enum', value: 'none', values: [{ id: 'none' }, { id: 'track' }, { id: 'playlist' }] },
      volume_set: { type: 'number', value: 0.08, min: 0, max: 1 },
      volume_mute: { type: 'boolean', value: false },
      sonos_group: { type: 'string', value: 'TV', setable: false },
    },
  });
  d.images = art(1000);
  return d;
}
const lamp = () => fakeDevice({ id: 'lamp', name: 'Lamp', class: 'light', caps: { onoff: { type: 'boolean', value: true } } });

const card = (device: string, id: string, title: string, args: object[] = []) => ({
  id: `homey:device:${device}:${id}`, ownerUri: `homey:device:${device}`, title, args,
});
const CARDS = {
  a: card('tv', 'cloud_play_home_theater', 'Set source to TV'),
  b: card('tv', 'cloud_leave_current_group', 'Leave current group'),
  c: card('tv', 'volume_mute', 'Mute the volume'), // the card has a control for it
  d: card('tv', 'cloud_play_url', 'Play an URL', [{ name: 'url', type: 'text' }]), // needs an argument
  e: card('kitchen', 'cloud_play_line_in', 'Set source to Line-In'), // another speaker's
};

function setup(devices: any[] = [sonos(), lamp()]) {
  const api: any = fakeApi({ devices, zones: { z1: { name: 'Stue' } } });
  api.baseUrl = Promise.resolve('http://127.0.0.1:80');
  api.flow = {
    getFlowCardActions: vi.fn(async () => CARDS),
    // The app's own token may only read flows.
    runFlowCardAction: vi.fn(async () => { throw new Error('Missing Scopes'); }),
    getFlows: vi.fn(async () => ({ f1: { id: 'f1', name: 'Movie time', enabled: true, triggerable: true, folder: null } })),
    getAdvancedFlows: vi.fn(async () => ({})),
    getFlowFolders: vi.fn(async () => ({})),
    triggerFlow: vi.fn(async () => { throw new Error('Missing Scopes'); }),
  };
  const homey = fakeHomey(api);
  const flows = new FlowService(homey, () => {});
  const service = new MediaService(homey, flows, () => {});
  return { homey, service, devices, api };
}

/** A personal API key that may manage flows (or, with other scopes, gets `Missing Scopes`). */
function keyApi(scopes = ['homey.flow']) {
  return {
    sessions: { getSessionMe: vi.fn(async () => ({ scopes })) },
    flow: {
      runFlowCardAction: vi.fn(async (_args: object) => { if (!scopes.includes('homey.flow')) throw new Error('Missing Scopes'); }),
      triggerFlow: vi.fn(async () => {}),
    },
  };
}

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); keyApis.clear(); });

describe('helpers', () => {
  it('reads the media image and the card ids', () => {
    expect(mediaArt({ images: art(5) })).toEqual({ url: '/api/image/img1', lastUpdated: 5 });
    expect(mediaArt({ images: [{ type: 'camera', imageObj: { url: '/x' } }] })).toBeNull();
    expect(parseCardId('card:homey:device:tv:x')).toBe('homey:device:tv:x');
    expect(parseCardId('flow:f1')).toBeNull();
  });
});

describe('getState', () => {
  it('returns the media capabilities, the icon and the album art', async () => {
    const { service } = setup();
    const state: any = await service.getState('tv');
    expect(state).toMatchObject({ id: 'tv', name: 'TV', art: { url: '/api/image/img1', lastUpdated: 1000 } });
    expect(Object.keys(state.caps)).toEqual([
      'speaker_playing', 'speaker_track', 'speaker_artist', 'speaker_prev', 'speaker_next', 'speaker_repeat', 'volume_set', 'volume_mute',
    ]);
    expect(state.caps.speaker_track).toEqual({ value: 'HDMI', setable: false });
    expect(state.caps.speaker_repeat.values.map((v: any) => v.id)).toEqual(['none', 'track', 'playlist']);
  });

  it('marks a missing device and a device that is not a speaker', async () => {
    const { service } = setup();
    expect(await service.getState('nope')).toEqual({ id: 'nope', missing: true });
    expect(await service.getState('lamp')).toEqual({ id: 'lamp', missing: true });
  });
});

describe('tracking', () => {
  it('sends changes as realtime events, but not for the buttons', async () => {
    const { service, homey, devices } = setup();
    await service.getState('tv');
    devices[0].report('volume_set', 0.2);
    expect(homey.api.realtime).toHaveBeenCalledWith(MEDIA_STATE_EVENT, { deviceId: 'tv', capabilityId: 'volume_set', value: 0.2 });
    expect(devices[0].listenerCount('speaker_next')).toBe(0);
    expect(devices[0].listenerCount('sonos_group')).toBe(0);
  });

  it('re-reads the album art after a track change and sends it once it changed', async () => {
    const { service, homey, devices } = setup();
    await service.getState('tv');
    devices[0].report('speaker_track', 'Song 2');
    await vi.advanceTimersByTimeAsync(1600);
    // The driver hasn't set the new art yet: nothing to send.
    expect(homey.api.realtime).not.toHaveBeenCalledWith(MEDIA_ART_EVENT, expect.anything());
    devices[0].images = art(2000);
    await vi.advanceTimersByTimeAsync(5000);
    expect(homey.api.realtime).toHaveBeenCalledWith(MEDIA_ART_EVENT, { deviceId: 'tv', art: { url: '/api/image/img1', lastUpdated: 2000 } });
    expect(((await service.getState('tv')) as any).art.lastUpdated).toBe(2000);
  });

  it('stops tracking after 10 minutes without a request', async () => {
    const { service, devices } = setup();
    service.start();
    await service.getState('tv');
    expect(devices[0].listenerCount('volume_set')).toBe(1);
    await vi.advanceTimersByTimeAsync(11 * 60e3);
    expect(devices[0].listenerCount('volume_set')).toBe(0);
    await service.stop();
  });
});

describe('set', () => {
  it('sets the controls, with next and previous always true', async () => {
    const { service, devices } = setup();
    await service.set('tv', 'speaker_playing', true);
    await service.set('tv', 'speaker_next', false);
    await service.set('tv', 'volume_mute', true);
    await service.set('tv', 'speaker_repeat', 'track');
    expect(devices[0].sent).toEqual(['speaker_playing=true', 'speaker_next=true', 'volume_mute=true', 'speaker_repeat="track"']);
  });

  it('caps the volume at the widget limit and rounds it', async () => {
    const { service, devices } = setup();
    await service.set('tv', 'volume_set', 0.9, 0.4);
    await service.set('tv', 'volume_set', 0.333);
    await service.set('tv', 'volume_set', -1);
    expect(devices[0].sent).toEqual(['volume_set=0.4', 'volume_set=0.33', 'volume_set=0']);
  });

  it('refuses anything else', async () => {
    const { service } = setup();
    await expect(service.set('tv', 'sonos_group', 'x')).rejects.toThrow(/Not a media control/);
    await expect(service.set('tv', 'speaker_playing', 'yes')).rejects.toThrow(/Invalid/);
    await expect(service.set('tv', 'speaker_repeat', 'forever')).rejects.toThrow(/Invalid/);
    await expect(service.set('tv', 'speaker_shuffle', true)).rejects.toThrow(/no settable/);
    await expect(service.set('tv', 'volume_set', Number.NaN)).rejects.toThrow(/Invalid volume/);
  });
});

describe('buttons', () => {
  it('lists the speaker’s own argument-free cards, then the flows', async () => {
    const { service } = setup();
    expect(await service.listButtons('tv', '')).toEqual([
      { name: 'None', id: 'none' },
      { name: 'Set source to TV', description: 'Speaker action', id: 'card:homey:device:tv:cloud_play_home_theater' },
      { name: 'Leave current group', description: 'Speaker action', id: 'card:homey:device:tv:cloud_leave_current_group' },
      { name: 'Movie time', description: 'Flow', id: 'flow:f1' },
    ]);
    expect((await service.listButtons('tv', 'source')).map(i => i.id)).toEqual(['card:homey:device:tv:cloud_play_home_theater']);
    // Without a speaker picked yet, only flows.
    expect((await service.listButtons(undefined, '')).map(i => i.id)).toEqual(['none', 'flow:f1']);
  });

  it('runs a card through the API key', async () => {
    const { service, homey } = setup();
    const key = keyApi();
    keyApis.set('k', key);
    homey.settings.set(API_KEY_SETTING, 'k');
    await service.runButton('tv', 'card:homey:device:tv:cloud_play_home_theater');
    expect(key.flow.runFlowCardAction).toHaveBeenCalledWith({
      uri: 'homey:device:tv', id: 'homey:device:tv:cloud_play_home_theater', args: {},
    });
  });

  it('says why a card can’t run: no key, or a key that may only start flows', async () => {
    const { service, homey } = setup();
    await expect(service.runButton('tv', 'card:homey:device:tv:cloud_play_home_theater')).rejects.toMatchObject({ reason: 'noKey' });
    keyApis.set('k', keyApi(['homey.flow.start']));
    homey.settings.set(API_KEY_SETTING, 'k');
    const err = await service.runButton('tv', 'card:homey:device:tv:cloud_play_home_theater').catch(e => e);
    expect(err).toBeInstanceOf(KeyError);
    expect(err.reason).toBe('keyScope');
  });

  it('only runs this speaker’s own argument-free cards', async () => {
    const { service, homey } = setup();
    const key = keyApi();
    keyApis.set('k', key);
    homey.settings.set(API_KEY_SETTING, 'k');
    await expect(service.runButton('tv', 'card:homey:device:kitchen:cloud_play_line_in')).rejects.toThrow(/not an action/);
    await expect(service.runButton('tv', 'card:homey:device:tv:cloud_play_url')).rejects.toThrow(/not an action/);
    expect(key.flow.runFlowCardAction).not.toHaveBeenCalled();
  });

  it('starts a flow through Flow Buttons', async () => {
    const { service, homey } = setup();
    const key = keyApi(['homey.flow.start']);
    keyApis.set('k', key);
    homey.settings.set(API_KEY_SETTING, 'k');
    await service.runButton('tv', 'flow:f1');
    expect(key.flow.triggerFlow).toHaveBeenCalledWith({ id: 'f1' });
  });
});
