import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { listDevicesWhere, matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { capabilityValues, presentCaps } from './capabilities.js';
import DeviceTracker, { type TrackedEntry } from './DeviceTracker.js';
import { deviceImage, fetchDeviceIcon, fetchImageBase64 } from './deviceIcon.js';
import type FlowService from './FlowService.js';
import PersonalApiKey from './PersonalApiKey.js';
import { sharedCache } from './sharedCache.js';
import Timings from './Timings.js';
/** The flow card list is long (every device's cards); the settings' autocomplete reuses a read this long. */
const CARDS_CACHE_MS = 60e3;
/**
 * After a track change the device is read again for its album art, which a driver often sets a moment after the
 * track: once soon, once later, sending the art only when it changed.
 */
const ART_RECHECKS = [1500, 6000];

export const MEDIA_STATE_EVENT = 'media:state';
export const MEDIA_ART_EVENT = 'media:art';

/**
 * The capabilities the card reads. `speaker_next`/`speaker_prev` aren't getable (buttons); `sonos_sound_input`
 * is the Sonos (LocalAPI) app's read-only input (a string).
 */
export const MEDIA_CAPS = [
  'speaker_playing', 'speaker_track', 'speaker_artist', 'speaker_album', 'speaker_position', 'speaker_duration',
  'speaker_prev', 'speaker_next', 'speaker_shuffle', 'speaker_repeat', 'volume_set', 'volume_mute', 'sonos_sound_input',
] as const;

/** What a widget may set, and the type each takes. */
const SETTABLE: Record<string, 'boolean' | 'true' | 'volume' | 'enum'> = {
  speaker_playing: 'boolean',
  speaker_next: 'true',
  speaker_prev: 'true',
  speaker_shuffle: 'boolean',
  speaker_repeat: 'enum',
  volume_mute: 'boolean',
  volume_set: 'volume',
};

/** A speaker's own Flow cards that the card already has a control for, so the button list leaves them out. */
const BUILT_IN_CARDS = /:(volume_|speaker_)/;

const TRACK_CAPS = new Set(['speaker_track', 'speaker_artist', 'speaker_album']);

export type MediaCap = { value: unknown, setable: boolean, values?: { id: string, title: string }[] };

/** The album art: `device.images`' `media` entry (`/api/image/<id>`, no auth needed on the LAN). */
export type MediaArt = { url: string, lastUpdated: number | null };

export type MediaDevice =
  | { id: string, name: string, icon: string | null, caps: Record<string, MediaCap>, art: MediaArt | null, cards?: string[] }
  | { id: string, missing: true };

/** A speaker in the widget's switcher: enough to show what it plays. */
export type SpeakerItem = {
  id: string,
  name: string,
  icon: string | null,
  zone: string | null,
  caps: Record<string, { value: unknown }>,
};

/** What the switcher shows of each speaker. */
const SUMMARY_CAPS = ['speaker_playing', 'speaker_track', 'speaker_artist', 'sonos_sound_input'];

export type Art = { type: string, data: string };

type Tracked = TrackedEntry & {
  name: string,
  icon: string | null,
  caps: Record<string, MediaCap>,
  art: MediaArt | null,
  artTimers: NodeJS.Timeout[],
};

/** The media capabilities the device has, in `MEDIA_CAPS` order. */
export function mediaCaps(device: any): string[] {
  return presentCaps(device, MEDIA_CAPS);
}

/** A speaker: anything with play/pause or a volume. */
export function isSpeaker(device: any): boolean {
  const caps = device?.capabilitiesObj || {};
  return !!(caps.speaker_playing || caps.volume_set || caps.volume_mute);
}

export function mediaArt(device: any): MediaArt | null {
  const img = deviceImage(device, 'media');
  return img && { url: img.url, lastUpdated: img.lastUpdated };
}

function readCaps(device: any): Record<string, MediaCap> {
  const out: Record<string, MediaCap> = {};
  for (const id of mediaCaps(device)) {
    const c = device.capabilitiesObj[id];
    const cap: MediaCap = { value: c.value ?? null, setable: c.setable === true || (c.setable !== false && id in SETTABLE) };
    const values = capabilityValues(c);
    if (values) cap.values = values;
    out[id] = cap;
  }
  return out;
}

/** `card:<flow card id>` → the card id (`homey:device:<deviceId>:<card>`), or null. */
export function parseCardId(id: string): string | null {
  const m = /^card:(.+)$/.exec(id || '');
  return m ? m[1] : null;
}

/** A device card's own part: `homey:device:<deviceId>:<card>` → `<card>` (the same on every speaker of one app). */
export function cardSuffix(cardId: string): string {
  const m = /^homey:device:[^:]+:(.+)$/.exec(cardId || '');
  return m ? m[1] : cardId;
}


const sameArt = (a: MediaArt | null, b: MediaArt | null) => a?.url === b?.url && a?.lastUpdated === b?.lastUpdated;

/**
 * The Media widget: one speaker's track, album art, transport, volume and mute, plus buttons that run the
 * speaker's own Flow cards (Set source to TV …) or flows. Running a card needs `homey.flow`, which the app's
 * token lacks, so it goes through the personal API key, as Flow Buttons' starts do.
 */
export default class MediaService {

  private tracker: DeviceTracker<Tracked>;
  /** Every device's Flow action cards (a long list); the settings' autocomplete reuses a read for a minute. */
  private cards = sharedCache(() => getAppApi(this.homey)
    .then(api => api.flow.getFlowCardActions({ $cache: false }))
    .then((all: Record<string, any>) => Object.values(all ?? {}))
    .catch((err: unknown) => {
      this.log('Could not read the Flow cards:', err);
      throw err;
    }));
  private lastCardError: string | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private flows: FlowService,
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    private key = PersonalApiKey.for(homey, log),
  ) {
    this.tracker = new DeviceTracker<Tracked>({
      homey,
      debug,
      what: 'Media capabilities',
      signature: device => mediaCaps(device).join(),
      create: async (device, api, tm) => {
        if (!isSpeaker(device)) throw new Error(`${device.name} is not a speaker`);
        const icon = await tm.time('icon', () => fetchDeviceIcon(api, device, this.log));
        return { name: device.name, icon, caps: readCaps(device), art: mediaArt(device), artTimers: [] };
      },
      listen: (t, device) => {
        const instances = Object.keys(t.caps)
          .filter(id => id !== 'speaker_next' && id !== 'speaker_prev') // buttons: nothing to report
          .map(id => device.makeCapabilityInstance(id, (value: unknown) => {
            if (t.caps[id]) t.caps[id].value = value;
            this.homey.api.realtime(MEDIA_STATE_EVENT, { deviceId: t.key, capabilityId: id, value });
            if (TRACK_CAPS.has(id)) this.recheckArt(t);
          }));
        this.debug(`Tracking speaker ${device.name} (${t.key}): ${Object.keys(t.caps).join()}`);
        return instances;
      },
      refresh: async (t, device, api, tm) => {
        t.name = device.name;
        t.icon = await tm.time('icon', () => fetchDeviceIcon(api, device, this.log)); // cached per URL
        t.caps = readCaps(device);
        t.art = mediaArt(device);
      },
      label: t => `speaker ${t.name}`,
      onDispose: (t) => { for (const timer of t.artTimers) this.homey.clearTimeout(timer); },
    });
  }

  start() {
    this.tracker.start();
  }

  async stop() {
    this.tracker.stop();
  }
  // ---------------------------------------------------------------- settings autocomplete

  /** Every speaker, by name, described by its zone. */
  listDevices(query: string): Promise<AutocompleteItem[]> {
    return listDevicesWhere(this.homey, query, isSpeaker);
  }

  /**
   * A button: `None`, then the speaker's own Flow cards that need nothing more than the device (Set source to TV,
   * Leave current group …) but not the ones the card already has a control for, then every flow that can be
   * started by hand.
   */
  async listButtons(deviceId: string | undefined, query: string): Promise<AutocompleteItem[]> {
    const action = this.homey.__('media.speakerAction') || 'Speaker action';
    const cards = deviceId ? (await this.deviceCards(deviceId).catch(() => []))
      .filter(c => matches(query, c.title))
      .map(c => ({ name: c.title as string, description: action, id: `card:${c.id}` })) : [];
    const flows = (await this.flows.listFlows(query).catch(() => [])).filter(f => f.id !== 'none');
    return withNone(this.homey.__('flows.none') || 'None', query, [...cards, ...flows]);
  }

  // ---------------------------------------------------------------- state and control

  /**
   * One speaker's state. With `cards` it also lists the speaker's own argument-free Flow cards (their `<card>`
   * part), so a widget switched to another speaker knows which of its buttons that speaker has.
   */
  async getState(deviceId: string, opts: { cards?: boolean } = {}): Promise<MediaDevice> {
    const tm = new Timings();
    try {
      const t = await this.tracker.current(deviceId, tm);
      const state: MediaDevice = { id: deviceId, name: t.name, icon: t.icon, caps: structuredClone(t.caps), art: t.art && { ...t.art } };
      if (opts.cards) {
        state.cards = await tm.time('cards', () => this.deviceCards(deviceId)
          .then(cards => cards.map(c => cardSuffix(c.id)))
          .catch(() => []));
      }
      return state;
    } catch (err) {
      this.log(`Speaker ${deviceId} unavailable:`, err);
      return { id: deviceId, missing: true };
    } finally {
      this.debug(`Media state for ${deviceId}: ${tm.summary()}`);
    }
  }

  /** Every speaker, for the widget's switcher: its icon, zone and what it plays, sorted by name. */
  async listSpeakers(): Promise<SpeakerItem[]> {
    const api = await getAppApi(this.homey);
    const [devices, zones] = await Promise.all([
      api.devices.getDevices(),
      api.zones.getZones().catch(() => ({})),
    ]);
    const speakers = (Object.values(devices) as any[]).filter(isSpeaker);
    const items = await Promise.all(speakers.map(async (d): Promise<SpeakerItem> => {
      const caps: Record<string, { value: unknown }> = {};
      for (const id of SUMMARY_CAPS) {
        const c = d.capabilitiesObj?.[id];
        if (c) caps[id] = { value: c.value ?? null };
      }
      return {
        id: d.id,
        name: d.name,
        icon: await fetchDeviceIcon(api, d, this.log),
        zone: (zones as any)[d.zone]?.name ?? null,
        caps,
      };
    }));
    return items.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * One control: play/pause, next, previous, shuffle, repeat, mute or the volume (0–1). `maxVolume` (0–1) caps the
   * volume, so a widget's limit holds however the value was sent.
   */
  async set(deviceId: string, capabilityId: string, value: unknown, maxVolume?: unknown) {
    const kind = SETTABLE[capabilityId];
    if (!kind) throw new Error(`Not a media control: ${capabilityId}`);
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: deviceId });
    const cap = device.capabilitiesObj?.[capabilityId];
    if (!cap || cap.setable === false) throw new Error(`${device.name} has no settable ${capabilityId}`);
    if (kind === 'boolean' && typeof value !== 'boolean') throw new Error(`Invalid ${capabilityId} ${JSON.stringify(value)}`);
    if (kind === 'true') value = true;
    if (kind === 'enum' && !(Array.isArray(cap.values) ? cap.values.some((v: any) => v.id === value) : typeof value === 'string')) {
      throw new Error(`Invalid ${capabilityId} ${JSON.stringify(value)}`);
    }
    if (kind === 'volume') {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Invalid volume ${JSON.stringify(value)}`);
      const max = typeof maxVolume === 'number' && maxVolume > 0 && maxVolume < 1 ? maxVolume : 1;
      value = Math.round(Math.min(max, Math.max(0, value)) * 100) / 100;
    }
    await device.setCapabilityValue({ capabilityId, value });
    this.debug(`Speaker ${device.name}: ${capabilityId}=${JSON.stringify(value)}`);
  }

  /**
   * A button: a flow (`flow:`/`advanced:`, through Flow Buttons' start) or one of this speaker's own argument-free
   * Flow cards (`card:`), run with the user's API key. A KeyError says why it can't. A card picked for another
   * speaker (the widget switched speaker) runs this speaker's card of the same kind, if it has one.
   */
  async runButton(deviceId: string, id: string) {
    const cardId = parseCardId(id);
    if (!cardId) {
      await this.flows.trigger(id);
      return;
    }
    const suffix = cardSuffix(cardId);
    const card = (await this.deviceCards(deviceId)).find(c => cardSuffix(c.id) === suffix);
    if (!card) throw new Error(`${cardId} is not an action of speaker ${deviceId}`);
    try {
      await this.key.run(api => api.flow.runFlowCardAction({ uri: card.ownerUri, id: card.id, args: {} }));
    } catch (err) {
      this.lastCardError = String((err as any)?.message ?? err);
      throw err;
    }
    this.lastCardError = null;
    this.debug(`Ran ${card.title} on ${deviceId}`);
  }

  /** The album art through the app, for a frame that can't load `/api/image/…` itself. */
  async getArt(deviceId: string): Promise<Art> {
    const api = await getAppApi(this.homey);
    const art = this.tracker.get(deviceId)?.art ?? mediaArt(await api.devices.getDevice({ id: deviceId, $cache: false }));
    if (!art) throw new Error(`Speaker ${deviceId} has no album art`);
    return fetchImageBase64(api, art.url, 'Album art');
  }

  /** For the diagnostics report: what each tracked speaker has, never track names. */
  describe() {
    return {
      tracked: [...this.tracker.values()].map(t => ({ id: t.key, caps: Object.keys(t.caps), art: !!t.art })),
      apiKey: this.key.has(),
      lastCardError: this.lastCardError,
    };
  }

  /** The speaker's own Flow action cards that take no arguments, except those the card already covers. */
  private async deviceCards(deviceId: string): Promise<any[]> {
    const owner = `homey:device:${deviceId}`;
    return (await this.readCards()).filter(c => c?.ownerUri === owner
      && typeof c.id === 'string'
      && !(Array.isArray(c.args) && c.args.length)
      && !BUILT_IN_CARDS.test(c.id)
      && !c.deprecated);
  }

  private readCards(): Promise<any[]> {
    return this.cards.get(CARDS_CACHE_MS);
  }

  // ---------------------------------------------------------------- live state

  /** A new track: read the device again (twice) for its album art, and send it when it changed. */
  private recheckArt(t: Tracked) {
    for (const timer of t.artTimers) this.homey.clearTimeout(timer);
    t.artTimers = ART_RECHECKS.map(ms => this.homey.setTimeout(async () => {
      if (!this.tracker.isCurrent(t)) return;
      try {
        const api = await getAppApi(this.homey);
        const art = mediaArt(await api.devices.getDevice({ id: t.key, $cache: false }));
        if (sameArt(art, t.art)) return;
        t.art = art;
        this.homey.api.realtime(MEDIA_ART_EVENT, { deviceId: t.key, art });
      } catch (err) {
        this.debug(`Album art of ${t.name} unavailable:`, err);
      }
    }, ms));
  }

}
