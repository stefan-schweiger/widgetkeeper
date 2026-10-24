import { randomBytes, timingSafeEqual } from 'node:crypto';
import type Homey from 'homey';
import { listDevicesWhere, matches, type AutocompleteItem } from './autocomplete.js';
import { cameraImage, type Snapshot } from './CameraService.js';
import type CameraService from './CameraService.js';
import { DebouncedSetting, isReservedKey } from './storedSetting.js';
import type WebDashboardService from './WebDashboardService.js';

export const POPUP_SHOW_EVENT = 'popups:show';
export const POPUP_CLOSE_EVENT = 'popups:close';
/** The Popups widgets' screen names seen so far, for the Flow cards' list: `{ '<key>': {name, seenAt} }`. */
export const POPUP_NAMES_SETTING = 'popupNames';
export const POPUP_SHOW_CARD = 'popup_show';
export const POPUP_ASK_CARD = 'popup_ask';
export const POPUP_SHOW_IMAGE_CARD = 'popup_show_image';
export const POPUP_ASK_IMAGE_CARD = 'popup_ask_image';
export const POPUP_CLOSE_CARD = 'popup_close';
/** The screen name a Popups widget answers to unless its `name` setting says another. */
export const DEFAULT_SCREEN = 'Screen';
/**
 * The longest a question waits. Homey ends an app's action card after 90 s (its error output then runs; measured in
 * an Advanced Flow on the Homey, 2026-10-22), so a question closes as unanswered a little before that.
 */
export const MAX_ASK_SECONDS = 85;
export const MAX_SHOW_SECONDS = 24 * 3600;
/** The sounds a popup can open with, the cards' `sound` dropdown (drawn by the kit's `sound`, widgets/spacer/public/kit.js). */
export const POPUP_SOUNDS = ['chime', 'doorbell', 'alert'] as const;
export type PopupSound = typeof POPUP_SOUNDS[number];

const MAX_OPEN = 20;
const MAX_TEXT = 500;
const MAX_NAME = 60;
const MAX_NAMES = 50;
/** Image tags and pictures from an address are kept in memory while their popup is open. */
const MAX_PICTURE = 3 * 1024 * 1024;
const FETCH_TIMEOUT = 10e3;
/** A closed popup is remembered this long, so a prompt page still open says how it ended. */
const CLOSED_KEPT = 10 * 60e3;
const MAX_CLOSED = 50;
/** A known screen name's `seenAt` is only rewritten after this, so a widget's `/state` doesn't write the setting. */
const NAME_REFRESH = 24 * 3600e3;

export type PopupKind = 'message' | 'ask';
export type CloseReason = 'answered' | 'expired' | 'replaced' | 'closed';
/** What a Flow gives as the picture: a camera, an image tag (`getStream()`), or an address. */
export type PictureInput = { camera: string } | { image: { getStream: () => Promise<any> } } | { url: string } | null;
type Picture = { source: 'camera', deviceId: string } | { source: 'stored', type: string, data: string };

type Popup = {
  id: string,
  token: string,
  target: string,
  kind: PopupKind,
  text: string,
  picture: Picture | null,
  sound: PopupSound | null,
  createdAt: number,
  until: number,
  timer: NodeJS.Timeout,
  resolve?: (result: AskResult) => void,
};

type Closed = { token: string, kind: PopupKind, answer: boolean | null, reason: CloseReason, closedAt: number };

/** What a Flow card gives: the screen, the text, the picture and the sound (`soundArg()`). */
type PopupInput = { target: unknown, text: unknown, picture?: PictureInput, sound?: unknown };

export type AskResult = { answer: boolean, answered: boolean };
export type AnswerResult = { ok: true, answer: boolean } | { ok: false, reason: 'closed' | 'notAsk', answer: boolean | null };

/** A popup as the screens get it (`popups:show`, `/web/popups`, the widget's `/state`): the picture's source only. */
export type PopupView = {
  id: string, token: string, target: string, kind: PopupKind, text: string,
  picture: { source: 'camera' | 'stored' } | null, sound: PopupSound | null, createdAt: number, until: number,
};

/** A screen name's key: trimmed and lower-cased, as Notes' `boardKey()`; a reserved name has none, `''`. */
export function screenKey(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  const key = (n || DEFAULT_SCREEN).toLowerCase().slice(0, MAX_NAME);
  return isReservedKey(key) ? '' : key;
}

function sameToken(a: string, b: unknown): boolean {
  if (typeof b !== 'string' || b.length !== a.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/**
 * Popups (wk-084): a Flow shows a message, or asks Yes/No, on web dashboards (the page draws it over everything) and on
 * the screens of Homey's own dashboards that have a Popups widget (it opens a prompt page in the app's in-app browser).
 * A Flow names where: everywhere (`all`), one web dashboard (`web:<id>`) or a Popups widget's screen name
 * (`name:<key>`). Popups are kept in memory only; the first answer to a question closes it on every screen.
 */
export default class PopupService {

  private open = new Map<string, Popup>();
  private closed = new Map<string, Closed>();
  private names: Record<string, { name: string, seenAt: number }>;
  private namesSetting: DebouncedSetting;

  constructor(
    private homey: Homey.App['homey'],
    private deps: { cameras: CameraService, web: WebDashboardService },
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    const stored = homey.settings.get(POPUP_NAMES_SETTING);
    this.names = stored && typeof stored === 'object' ? { ...stored } : {};
    this.namesSetting = new DebouncedSetting({
      homey, setting: POPUP_NAMES_SETTING, delay: 5000, value: () => this.names, log, what: 'the popup screen names',
    });
  }

  stop() {
    for (const id of [...this.open.keys()]) this.finish(id, null, 'closed');
    this.namesSetting.flush();
  }

  /** The Flow card *Show … on … for …*. */
  async show(input: PopupInput & { seconds: number }): Promise<void> {
    const seconds = Math.min(Math.max(Number(input.seconds) || 0, 1), MAX_SHOW_SECONDS);
    await this.add('message', input, seconds);
  }

  /**
   * The Flow card *Ask … on …*: waits for the first answer from any screen, or until `seconds` (at most
   * `MAX_ASK_SECONDS`) have passed, which is `{answer: false, answered: false}`.
   */
  async ask(input: PopupInput & { seconds: number }): Promise<AskResult> {
    const seconds = Math.min(Math.max(Number(input.seconds) || 0, 5), MAX_ASK_SECONDS);
    let resolve!: (result: AskResult) => void;
    const answered = new Promise<AskResult>((r) => { resolve = r; });
    await this.add('ask', input, seconds, resolve);
    return answered;
  }

  /** The Flow card *Close the popups on …*: everywhere closes every popup, else those sent to that screen. */
  close(target: unknown) {
    const t = this.target(target);
    const ids = [...this.open.values()].filter(p => t === 'all' || p.target === t).map(p => p.id);
    for (const id of ids) this.finish(id, null, 'closed');
    this.debug(`Popups closed on ${t}: ${ids.length}`);
  }

  /**
   * A web dashboard's answer to a question (its session was checked). The first one wins; later ones (and a message,
   * which has none) get `{ok: false, reason}` with the answer that closed it, if any.
   */
  answerFromSession(id: string, yes: unknown): AnswerResult {
    return this.answerAs(id, yes, null);
  }

  /** The prompt page's answer (no login): only with the popup's token, else `Not found`. */
  answerWithToken(id: string, yes: unknown, token: unknown): AnswerResult {
    return this.answerAs(id, yes, t => sameToken(t, token));
  }

  /** Every open popup, oldest first, and the Homey's clock (the page moves `until` into its own). */
  all(): { popups: PopupView[], now: number } {
    return { popups: [...this.open.values()].map(p => this.view(p)), now: Date.now() };
  }

  /** A Popups widget's `/state`: the popups for everywhere and for its screen name, which is remembered for the Flow cards. */
  forScreen(name: unknown): { popups: PopupView[], now: number } {
    const key = screenKey(name);
    if (key) this.remember(key, typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME) : DEFAULT_SCREEN);
    const popups = [...this.open.values()].filter(p => p.target === 'all' || (key && p.target === `name:${key}`));
    return { popups: popups.map(p => this.view(p)), now: Date.now() };
  }

  /** The prompt page (no login, so the popup's token): the popup, or how it ended. */
  page(id: string, token: unknown) {
    const p = this.open.get(id);
    if (p && sameToken(p.token, token)) {
      return {
        closed: false, kind: p.kind, text: p.text, picture: p.picture ? { source: p.picture.source } : null, sound: p.sound,
        until: p.until, now: Date.now(),
      };
    }
    const c = this.closed.get(id);
    if (c && sameToken(c.token, token)) return { closed: true, kind: c.kind, answer: c.answer, reason: c.reason, now: Date.now() };
    throw new Error('Not found');
  }

  /** A popup's picture for a web dashboard (its session was checked): the one kept, or the camera's snapshot now. */
  imageFromSession(id: string): Promise<Snapshot> {
    return this.imageAs(id, null);
  }

  /** A popup's picture for the prompt page (no login): only with the popup's token, else `Not found`. */
  imageWithToken(id: string, token: unknown): Promise<Snapshot> {
    return this.imageAs(id, t => sameToken(t, token));
  }

  /**
   * The Flow cards' screen argument: everywhere, then the Popups widgets' screen names (with `Screen`, the default; a
   * web dashboard is reached through its Popups widget's name), then what's typed as a new name. A `web:<id>` chosen
   * while the list still offered the web dashboards keeps working.
   */
  targetItems(query: string): AutocompleteItem[] {
    const q = (query || '').trim().slice(0, MAX_NAME);
    const t = (key: string, fallback: string) => this.homey.__(key) || fallback;
    const items: AutocompleteItem[] = [];
    const everywhere = t('popups.everywhere', 'Everywhere');
    if (matches(q, everywhere)) items.push({ id: 'all', name: everywhere, description: t('popups.everywhereHint', 'Every web dashboard and Popups widget') });
    const names = new Map<string, string>([[screenKey(DEFAULT_SCREEN), DEFAULT_SCREEN]]);
    for (const [key, n] of Object.entries(this.names)) names.set(key, n.name);
    // The web dashboards' Popups widgets, which never call `/state` (the page shows their popups itself).
    for (const d of this.deps.web.list()) {
      for (const w of d.columns.flat()) {
        if (w.type !== 'popups') continue;
        const name = typeof w.settings?.name === 'string' && w.settings.name.trim() ? w.settings.name.trim().slice(0, MAX_NAME) : DEFAULT_SCREEN;
        const key = screenKey(name);
        if (key && !names.has(key)) names.set(key, name);
      }
    }
    const screen = t('popups.screenName', 'Popups widget');
    for (const [, name] of [...names.entries()].filter(([, n]) => matches(q, n)).sort((a, b) => a[1].localeCompare(b[1]))) {
      items.push({ id: `name:${name}`, name, description: screen });
    }
    if (q && !names.has(screenKey(q))) items.push({ id: `name:${q}`, name: q, description: t('popups.screenNew', 'New screen name') });
    return items;
  }

  /** The Flow cards' picture argument: none, a picture from the address typed, then the cameras. */
  async pictureItems(query: string): Promise<AutocompleteItem[]> {
    const q = (query || '').trim();
    const items: AutocompleteItem[] = [{ id: 'none', name: this.homey.__('popups.noPicture') || 'No picture' }];
    if (/^https?:\/\/\S+$/i.test(q)) {
      items.push({ id: `url:${q}`, name: q.length > 80 ? `${q.slice(0, 79)}…` : q, description: this.homey.__('popups.pictureUrl') || 'Picture from this address' });
      return items;
    }
    const cameras = await listDevicesWhere(this.homey, q, d => !!cameraImage(d));
    return items.concat(cameras.map(c => ({ ...c, id: `camera:${c.id}` })));
  }

  /** The picture argument's choice (`none`, `camera:<id>`, `url:<address>`) as `show()`/`ask()` take it. */
  static pictureArg(item: { id?: unknown } | null | undefined): PictureInput {
    const id = typeof item?.id === 'string' ? item.id : '';
    if (id.startsWith('camera:')) return { camera: id.slice(7) };
    if (id.startsWith('url:')) return { url: id.slice(4) };
    return null;
  }

  /** The sound dropdown's choice, or null for *no sound* (and for a card saved before it had one). */
  static soundArg(value: unknown): PopupSound | null {
    return (POPUP_SOUNDS as readonly unknown[]).includes(value) ? value as PopupSound : null;
  }

  /** A card's droptoken: an image tag as it is, a text tag as an address. */
  static droptokenArg(token: unknown): PictureInput {
    if (token && typeof (token as any).getStream === 'function') return { image: token as { getStream: () => Promise<any> } };
    if (typeof token === 'string' && token.trim()) return { url: token.trim() };
    return null;
  }

  /** For the diagnostics report: never the texts, addresses or tokens. */
  describe() {
    const now = Date.now();
    return {
      open: [...this.open.values()].map(p => ({
        kind: p.kind,
        target: p.target === 'all' ? 'all' : p.target.split(':')[0],
        picture: p.picture ? p.picture.source : null,
        sound: p.sound,
        secondsLeft: Math.round((p.until - now) / 1000),
      })),
      recentlyClosed: [...this.closed.values()].map(c => c.reason),
      screens: Object.values(this.names).map(n => n.name),
    };
  }

  // ---- Inside -----------------------------------------------------------------------------------------------

  /** `may`: whether a token is the one the caller gave (the prompt page); null for a signed-in web dashboard. */
  private answerAs(id: string, yes: unknown, may: ((token: string) => boolean) | null): AnswerResult {
    const p = this.open.get(id);
    if (!p || (may && !may(p.token))) {
      const c = this.closed.get(id);
      if (may && !(c && may(c.token))) throw new Error('Not found');
      return { ok: false, reason: 'closed', answer: c ? c.answer : null };
    }
    if (p.kind !== 'ask') return { ok: false, reason: 'notAsk', answer: null };
    const answer = yes === true;
    this.finish(id, answer, 'answered');
    return { ok: true, answer };
  }

  private async imageAs(id: string, may: ((token: string) => boolean) | null): Promise<Snapshot> {
    const p = this.open.get(id);
    if (!p || !p.picture || (may && !may(p.token))) throw new Error('Not found');
    if (p.picture.source === 'stored') return { type: p.picture.type, data: p.picture.data };
    return this.deps.cameras.getSnapshot(p.picture.deviceId);
  }

  /** A Flow's screen choice (`all`, `web:<id>`, `name:<name>`) as a target; a deleted web dashboard throws. */
  private target(input: unknown): string {
    const id = typeof input === 'string' ? input : typeof (input as any)?.id === 'string' ? (input as any).id : '';
    if (!id || id === 'all') return 'all';
    if (id.startsWith('web:')) {
      const dash = id.slice(4);
      if (!this.deps.web.list().some(d => d.id === dash)) throw new Error(this.homey.__('popups.dashboardMissing') || 'Dashboard not found');
      return id;
    }
    const key = screenKey(id.startsWith('name:') ? id.slice(5) : id);
    if (!key) throw new Error(`Not a screen name: ${id}`);
    return `name:${key}`;
  }

  private async add(kind: PopupKind, input: PopupInput, seconds: number, resolve?: (r: AskResult) => void) {
    const target = this.target(input.target);
    const text = String(input.text ?? '').trim().slice(0, MAX_TEXT);
    const picture = await this.picture(input.picture ?? null);
    if (!text && !picture) throw new Error(this.homey.__('popups.empty') || 'Nothing to show: no text or picture');
    while (this.open.size >= MAX_OPEN) this.finish(this.open.keys().next().value as string, null, 'replaced');
    const now = Date.now();
    const id = randomBytes(8).toString('hex');
    const popup: Popup = {
      id,
      token: randomBytes(16).toString('hex'),
      target,
      kind,
      text,
      picture,
      sound: PopupService.soundArg(input.sound),
      createdAt: now,
      until: now + seconds * 1000,
      timer: this.homey.setTimeout(() => this.finish(id, null, 'expired'), seconds * 1000),
      resolve,
    };
    this.open.set(id, popup);
    this.homey.api.realtime(POPUP_SHOW_EVENT, { ...this.view(popup), now });
    this.debug(`Popup ${kind} on ${target === 'all' ? 'all' : target.split(':')[0]} for ${seconds} s${picture ? `, ${picture.source} picture` : ''}${popup.sound ? `, ${popup.sound}` : ''}`);
  }

  private finish(id: string, answer: boolean | null, reason: CloseReason) {
    const p = this.open.get(id);
    if (!p) return;
    this.open.delete(id);
    this.homey.clearTimeout(p.timer);
    const now = Date.now();
    this.closed.set(id, { token: p.token, kind: p.kind, answer, reason, closedAt: now });
    for (const [cid, c] of this.closed) {
      if (now - c.closedAt > CLOSED_KEPT || this.closed.size > MAX_CLOSED) this.closed.delete(cid);
      else break;
    }
    p.resolve?.({ answer: answer === true, answered: answer !== null });
    this.homey.api.realtime(POPUP_CLOSE_EVENT, { id, answer, reason });
  }

  private view(p: Popup): PopupView {
    return {
      id: p.id, token: p.token, target: p.target, kind: p.kind, text: p.text,
      picture: p.picture ? { source: p.picture.source } : null, sound: p.sound, createdAt: p.createdAt, until: p.until,
    };
  }

  private remember(key: string, name: string) {
    const known = Object.prototype.hasOwnProperty.call(this.names, key) ? this.names[key] : null;
    const now = Date.now();
    if (known && known.name === name && now - known.seenAt < NAME_REFRESH) return;
    this.names[key] = { name, seenAt: now };
    const keys = Object.keys(this.names).sort((a, b) => this.names[a].seenAt - this.names[b].seenAt);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_NAMES))) delete this.names[k];
    this.namesSetting.schedule();
  }

  /** Reads the picture a Flow gave: an image tag's or an address's bytes are kept (up to 3 MB); a camera is read later. */
  private async picture(input: PictureInput): Promise<Picture | null> {
    if (!input) return null;
    if ('camera' in input) {
      if (!input.camera) return null;
      return { source: 'camera', deviceId: input.camera };
    }
    if ('image' in input) {
      const stream = await input.image.getStream();
      const bytes = await this.readPicture(stream);
      const type = typeof stream.contentType === 'string' && stream.contentType.startsWith('image/') ? stream.contentType : 'image/jpeg';
      return { source: 'stored', type, data: bytes.toString('base64') };
    }
    return this.fetchPicture(input.url);
  }

  /**
   * A picture's bytes, up to 3 MB: past that it throws and reads no more (leaving the loop ends the stream), whatever
   * the sender said its size was.
   */
  private async readPicture(stream: AsyncIterable<Uint8Array> | null): Promise<Buffer> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of stream ?? []) {
      size += chunk.length;
      if (size > MAX_PICTURE) throw new Error(this.homey.__('popups.pictureTooLarge') || 'The picture is larger than 3 MB');
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  private async fetchPicture(address: string): Promise<Picture> {
    let url: URL;
    try {
      url = new URL(address);
    } catch (err) {
      throw new Error(`${this.homey.__('popups.pictureBadUrl') || 'Not a picture address'}: ${address.slice(0, 100)}`);
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error(`${this.homey.__('popups.pictureBadUrl') || 'Not a picture address'}: ${url.protocol}`);
    const signal = typeof AbortSignal?.timeout === 'function' ? AbortSignal.timeout(FETCH_TIMEOUT) : undefined;
    let res: Response;
    try {
      res = await fetch(url, { signal });
    } catch (err) {
      this.log('Popup picture not loaded:', err instanceof Error ? err.message : err);
      throw new Error(`${this.homey.__('popups.pictureFailed') || 'The picture could not be loaded'} (${err instanceof Error ? err.message : err})`);
    }
    if (!res.ok) throw new Error(`${this.homey.__('popups.pictureFailed') || 'The picture could not be loaded'} (HTTP ${res.status})`);
    const type = (res.headers.get('content-type') || '').split(';')[0].trim();
    if (!type.startsWith('image/')) throw new Error(`${this.homey.__('popups.pictureFailed') || 'The picture could not be loaded'} (${type || 'no type'})`);
    if (Number(res.headers.get('content-length')) > MAX_PICTURE) throw new Error(this.homey.__('popups.pictureTooLarge') || 'The picture is larger than 3 MB');
    const bytes = await this.readPicture(res.body as AsyncIterable<Uint8Array> | null);
    return { source: 'stored', type, data: bytes.toString('base64') };
  }

}
