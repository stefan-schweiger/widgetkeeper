import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { fetchDeviceIcon } from './deviceIcon.js';
import type FlowService from './FlowService.js';
import type { AutocompleteItem } from './HeatmapService.js';
import PersonalApiKey from './PersonalApiKey.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;
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

type Tracked = {
  deviceId: string,
  name: string,
  icon: string | null,
  caps: Record<string, MediaCap>,
  art: MediaArt | null,
  instances: any[],
  artTimers: NodeJS.Timeout[],
  lastRequested: number,
};

/** The media capabilities the device has, in `MEDIA_CAPS` order. */
export function mediaCaps(device: any): string[] {
  const caps = device?.capabilitiesObj || {};
  return MEDIA_CAPS.filter(id => caps[id]);
}

/** A speaker: anything with play/pause or a volume. */
export function isSpeaker(device: any): boolean {
  const caps = device?.capabilitiesObj || {};
  return !!(caps.speaker_playing || caps.volume_set || caps.volume_mute);
}

export function mediaArt(device: any): MediaArt | null {
  const images: any[] = Array.isArray(device?.images) ? device.images : [];
  const img = images.find(i => i?.type === 'media' && i.imageObj?.url);
  if (!img) return null;
  const o = img.imageObj;
  return { url: o.url, lastUpdated: typeof o.lastUpdated === 'number' ? o.lastUpdated : null };
}

function readCaps(device: any): Record<string, MediaCap> {
  const out: Record<string, MediaCap> = {};
  for (const id of mediaCaps(device)) {
    const c = device.capabilitiesObj[id];
    const cap: MediaCap = { value: c.value ?? null, setable: c.setable === true || (c.setable !== false && id in SETTABLE) };
    if (Array.isArray(c.values)) cap.values = c.values.map((v: any) => ({ id: String(v.id), title: String(v.title ?? v.id) }));
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

function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

const sameArt = (a: MediaArt | null, b: MediaArt | null) => a?.url === b?.url && a?.lastUpdated === b?.lastUpdated;

/**
 * The Media widget: one speaker's track, album art, transport, volume and mute, plus buttons that run the
 * speaker's own Flow cards (Set source to TV …) or flows. Running a card needs `homey.flow`, which the app's
 * token lacks, so it goes through the personal API key, as Flow Buttons' starts do.
 */
export default class MediaService {

  private tracked = new Map<string, Tracked>();
  private trackPromises = new Map<string, Promise<Tracked>>();
  private tickTimer: NodeJS.Timeout | null = null;
  private cards: { at: number, cards: Promise<any[]> } | null = null;
  private lastCardError: string | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private flows: FlowService,
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    private key = PersonalApiKey.for(homey, log),
  ) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    for (const t of this.tracked.values()) this.dispose(t);
  }

  // ---------------------------------------------------------------- settings autocomplete

  /** Every speaker, by name, described by its zone. */
  async listDevices(query: string): Promise<AutocompleteItem[]> {
    const api = await getAppApi(this.homey);
    const [devices, zones] = await Promise.all([
      api.devices.getDevices(),
      api.zones.getZones().catch(() => ({})),
    ]);
    return (Object.values(devices) as any[])
      .filter(isSpeaker)
      .map(d => ({ name: d.name as string, description: (zones as any)[d.zone]?.name, id: d.id as string }))
      .filter(d => matches(query, d.name, d.description))
      .sort((a, b) => a.name.localeCompare(b.name));
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
    const none = this.homey.__('flows.none') || 'None';
    return [...(matches(query, none) ? [{ name: none, id: 'none' }] : []), ...cards, ...flows];
  }

  // ---------------------------------------------------------------- state and control

  /**
   * One speaker's state. With `cards` it also lists the speaker's own argument-free Flow cards (their `<card>`
   * part), so a widget switched to another speaker knows which of its buttons that speaker has.
   */
  async getState(deviceId: string, opts: { cards?: boolean } = {}): Promise<MediaDevice> {
    const tm = new Timings();
    try {
      const t = await this.current(deviceId, tm);
      t.lastRequested = Date.now();
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
    const art = this.tracked.get(deviceId)?.art ?? mediaArt(await api.devices.getDevice({ id: deviceId, $cache: false }));
    if (!art) throw new Error(`Speaker ${deviceId} has no album art`);
    const res = await fetch(/^https?:/.test(art.url) ? art.url : `${await api.baseUrl}${art.url}`);
    if (!res.ok) throw new Error(`Album art HTTP ${res.status}`);
    const type = res.headers.get('content-type') || 'image/jpeg';
    if (!type.startsWith('image/')) throw new Error(`Album art is ${type}`);
    return { type, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
  }

  /** For the diagnostics report: what each tracked speaker has, never track names. */
  describe() {
    return {
      tracked: [...this.tracked.values()].map(t => ({ id: t.deviceId, caps: Object.keys(t.caps), art: !!t.art })),
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
    const now = Date.now();
    if (!this.cards || now - this.cards.at > CARDS_CACHE_MS) {
      const cards = getAppApi(this.homey)
        .then(api => api.flow.getFlowCardActions({ $cache: false }))
        .then((all: Record<string, any>) => Object.values(all ?? {}))
        .catch((err: unknown) => {
          if (this.cards?.cards === cards) this.cards = null;
          this.log('Could not read the Flow cards:', err);
          throw err;
        });
      this.cards = { at: now, cards };
    }
    return this.cards.cards;
  }

  // ---------------------------------------------------------------- live state

  private async current(deviceId: string, tm: Timings): Promise<Tracked> {
    const t = this.tracked.get(deviceId);
    if (!t) return this.ensureTracked(deviceId, tm);
    const api = await getAppApi(this.homey);
    let device: any;
    try {
      device = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId, $cache: false }));
    } catch (err) {
      this.dispose(t);
      throw err;
    }
    const caps = mediaCaps(device);
    if (caps.join() !== Object.keys(t.caps).join()) {
      this.debug(`Media capabilities of ${device.name} changed: ${Object.keys(t.caps).join()} → ${caps.join()}`);
      this.dispose(t);
      return this.ensureTracked(deviceId, tm);
    }
    t.name = device.name;
    t.caps = readCaps(device);
    t.art = mediaArt(device);
    return t;
  }

  private ensureTracked(deviceId: string, tm: Timings): Promise<Tracked> {
    const existing = this.tracked.get(deviceId);
    if (existing) return Promise.resolve(existing);
    let p = this.trackPromises.get(deviceId);
    if (!p) {
      p = this.track(deviceId, tm).finally(() => this.trackPromises.delete(deviceId));
      this.trackPromises.set(deviceId, p);
    }
    return p;
  }

  private async track(deviceId: string, tm: Timings): Promise<Tracked> {
    const api = await tm.time('api', () => getAppApi(this.homey));
    const device: any = await tm.time('getDevice', () => api.devices.getDevice({ id: deviceId }));
    if (!isSpeaker(device)) throw new Error(`${device.name} is not a speaker`);
    const icon = await tm.time('icon', () => fetchDeviceIcon(api, device, this.log));
    const t: Tracked = {
      deviceId,
      name: device.name,
      icon,
      caps: readCaps(device),
      art: mediaArt(device),
      instances: [],
      artTimers: [],
      lastRequested: Date.now(),
    };
    for (const id of Object.keys(t.caps)) {
      if (id === 'speaker_next' || id === 'speaker_prev') continue; // buttons: nothing to report
      t.instances.push(device.makeCapabilityInstance(id, (value: unknown) => {
        if (t.caps[id]) t.caps[id].value = value;
        this.homey.api.realtime(MEDIA_STATE_EVENT, { deviceId, capabilityId: id, value });
        if (TRACK_CAPS.has(id)) this.recheckArt(t);
      }));
    }
    this.tracked.set(deviceId, t);
    this.debug(`Tracking speaker ${device.name} (${deviceId}): ${Object.keys(t.caps).join()}`);
    return t;
  }

  /** A new track: read the device again (twice) for its album art, and send it when it changed. */
  private recheckArt(t: Tracked) {
    for (const timer of t.artTimers) this.homey.clearTimeout(timer);
    t.artTimers = ART_RECHECKS.map(ms => this.homey.setTimeout(async () => {
      if (this.tracked.get(t.deviceId) !== t) return;
      try {
        const api = await getAppApi(this.homey);
        const art = mediaArt(await api.devices.getDevice({ id: t.deviceId, $cache: false }));
        if (sameArt(art, t.art)) return;
        t.art = art;
        this.homey.api.realtime(MEDIA_ART_EVENT, { deviceId: t.deviceId, art });
      } catch (err) {
        this.debug(`Album art of ${t.name} unavailable:`, err);
      }
    }, ms));
  }

  private tick() {
    const now = Date.now();
    for (const t of this.tracked.values()) {
      if (now - t.lastRequested > IDLE_TIMEOUT) this.dispose(t);
    }
  }

  private dispose(t: Tracked) {
    for (const i of t.instances) {
      try { i?.destroy(); } catch (err) { /* ignore */ }
    }
    for (const timer of t.artTimers) this.homey.clearTimeout(timer);
    if (this.tracked.get(t.deviceId) === t) this.tracked.delete(t.deviceId);
    this.debug(`Stopped tracking speaker ${t.name}`);
  }

}
