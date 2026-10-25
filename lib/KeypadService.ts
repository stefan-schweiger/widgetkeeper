import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { devicesAndZones, matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { describeCapability, type CapabilityDescription } from './capabilities.js';
import type FlowService from './FlowService.js';
import { parseFlowId, type FlowEntry } from './FlowService.js';
import Secrets from './secrets.js';
import type ValueService from './ValueService.js';
import type { ValueCapability } from './ValueService.js';
import type VariableService from './VariableService.js';
import { MAX_PRESET_TEXT, parseNumber, type VariableType } from './VariableService.js';

/** The secret the codes are hashed with (`/userdata/secrets.json`), 32 random bytes as hex, made with the first code. */
export const KEYPAD_SECRET = 'keypadKey';
/** The codes, made on the app settings page: `[{id, name, digits, salt, mac}]`, in the secrets file, never the digits. */
export const KEYPAD_CODES = 'keypadCodes';

/** The `code` setting's Any code: every code made on the app settings page, the one typed telling whose it was. */
export const ANY_CODE = 'any';
/** The trigger's *Anyone*: every press, with a code or without. */
export const ANY_PRESS = 'anyone';
/** The trigger *A Keypad button was tapped by …*, its tokens the code's name, the button and the widget. */
export const KEYPAD_TAPPED_CARD = 'keypad_tapped';

/** Wrong codes in a row before the pad locks, then 30 s, doubling with each further wrong one up to 15 min (the web password's rule). */
const FREE_TRIES = 5;
const LOCK_MS = 30e3;
const MAX_LOCK_MS = 15 * 60e3;
/**
 * Codes added or changed in a row, which may tell whether digits are taken (no two codes share theirs, so Any code
 * knows whose was typed): ten, then locked as wrong codes are; forgotten after an hour without one.
 */
const EDITS = 'edits';
const FREE_EDITS = 10;
const FORGET_EDITS_MS = 60 * 60e3;
/** The codes there may be, and the longest name. */
export const MAX_CODES = 20;
const MAX_NAME = 40;
const CODE = /^\d{3,6}$/;

/**
 * The words a yes/no capability's values are shown with (`keypad.<word>`), where On/Off would read wrong. The widget has
 * the same table (`window.keypadBooleanWords`); test/keypad-widget.test.ts checks they match.
 */
export const BOOLEAN_WORDS: Record<string, [string, string]> = {
  locked: ['locked', 'unlocked'],
  garagedoor_closed: ['closed', 'open'],
  windowcoverings_closed: ['closed', 'open'],
  alarm_contact: ['open', 'closed'],
};

/** The `state` setting's choice: a Logic variable (`var:<id>`) or a device's capability (`cap:<deviceId>:<capabilityId>`). */
export type KeypadSource = { kind: 'variable', id: string } | { kind: 'capability', deviceId: string, capabilityId: string };

export function parseSource(id: unknown): KeypadSource | null {
  if (typeof id !== 'string') return null;
  if (/^var:./.test(id)) return { kind: 'variable', id: id.slice(4) };
  const m = /^cap:([^:]+):(.+)$/.exec(id);
  return m ? { kind: 'capability', deviceId: m[1], capabilityId: m[2] } : null;
}

export type SourceState =
  | { kind: 'variable', id: string, name: string, type: VariableType, value: boolean | number | string }
  | { kind: 'capability', deviceId: string, capabilityId: string, name: string, capability: ValueCapability, value: unknown }
  | { kind: 'variable', id: string, missing: true }
  | { kind: 'capability', deviceId: string, capabilityId: string, missing: true };

/** A code as the settings page and the widgets see it: never the digits or the hash. */
export type CodeInfo = { id: string, name: string, digits: number };

/** A widget's code: one code, or Any code (`digits` null when the codes' lengths differ, so the keypad needs OK). */
export type WidgetCode = { id: string, name: string, digits: number | null };

/**
 * `/state`: the source (null without one), the buttons' flows (null when they couldn't be read) and the widget's code
 * (its length, so the pad knows when it's complete; `missing` once removed; null without one).
 */
export type KeypadState = { source: SourceState | null, flows: FlowEntry[] | null, code: WidgetCode | { id: string, missing: true } | null };

export type CodeRefusal = { result: 'wrongCode', left: number } | { result: 'locked', retryAfter: number } | { result: 'codeMissing' };

/** What a press did: `done`, a refused code, or a capability that can't be set (the button wants a Flow). */
export type PressResult = { result: 'done' } | { result: 'notSetable' } | CodeRefusal;

/**
 * A press: a Flow to start, the source and the value to set it to, or neither (a button that only fires the trigger);
 * with the button's code when it wants one, and its label and the widget's title for the trigger's tokens.
 */
export type PressBody = {
  flow?: unknown, source?: unknown, value?: unknown, codeId?: unknown, code?: unknown, button?: unknown, title?: unknown,
};

/** The trigger's tokens: the code's name (empty without one), the button's label and the widget's title. */
export type PressTokens = { code: string, button: string, keypad: string };
/** What the trigger's run listener matches its argument with. */
export type PressState = { codeId: string | null, name: string };
/** The trigger's `code` argument: an item of `pressCodeItems()`. */
export type PressArg = { id?: string, name?: string } | null | undefined;

/** The settings page's answer: the codes, or why not. */
export type CodesResult = { ok: true, codes: CodeInfo[] }
  | { ok: false, reason: 'name' | 'nameTaken' | 'digits' | 'codeTaken' | 'full' | 'missing' | 'wrongCode' }
  | { ok: false, reason: 'locked', retryAfter: number };

type StoredCode = CodeInfo & { salt: string, mac: string };
/** A typed code checked: right (with the code it was, null where none was wanted), or why not. */
type Checked = { result: 'right', entry: StoredCode | null } | CodeRefusal;
/** Text from a press for a token: a string, trimmed, at most 100 characters. */
const tokenText = (v: unknown) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
type Item = AutocompleteItem & Record<string, unknown>;

/** A value for a capability: its type's, an enum's own, a number within its range, a text of a sensible length; else it throws. */
export function checkCapabilityValue(cap: CapabilityDescription, value: unknown): boolean | number | string {
  switch (cap.type) {
    case 'boolean':
      if (typeof value === 'boolean') return value;
      break;
    case 'number':
      if (typeof value === 'number' && Number.isFinite(value)
        && (cap.min == null || value >= cap.min) && (cap.max == null || value <= cap.max)) return value;
      break;
    case 'enum':
      if (typeof value === 'string' && (cap.values ?? []).some(v => v.id === value)) return value;
      break;
    case 'string':
      if (typeof value === 'string' && value.length <= MAX_PRESET_TEXT) return value;
      break;
  }
  throw new Error(`Invalid value ${JSON.stringify(value)} for ${cap.title}`);
}

/**
 * The Keypad widget: buttons behind an optional code that start a Flow or set the state the widget shows, a Logic
 * variable (Variables' service) or a device capability (Device Values' tracking). The codes are made on the app settings
 * page, each with a name the widget's setting picks (or Any code); only an HMAC of each is kept, keyed with a secret only
 * the app has, and the app checks a typed code, counting wrong ones. A press fires the trigger with the code's name.
 */
export default class KeypadService {

  private secrets: Secrets;
  /** Wrong tries in a row per code (Any code and the edits have their own), until when it's locked, and the last. */
  private counted = new Map<string, { failures: number, lockedUntil: number, at: number }>();
  private pressed = 0;
  private wrongCodes = 0;
  private lockouts = 0;
  private lastError: string | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private deps: {
      flows: FlowService, values: ValueService, variables: VariableService,
      /** Fires the trigger *A Keypad button was tapped by …*. */
      onPress?: (tokens: PressTokens, state: PressState) => Promise<unknown>,
    },
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {
    this.secrets = Secrets.for(homey, log);
  }

  private __(key: string, fallback: string, tokens?: Record<string, unknown>): string {
    return this.homey.__(key, tokens) || fallback;
  }

  private booleanWord(capabilityId: string | null, value: boolean): string {
    const [yes, no] = capabilityId === null ? ['yes', 'no'] : BOOLEAN_WORDS[capabilityId] ?? ['on', 'off'];
    const word = value ? yes : no;
    return this.__(`keypad.${word}`, word[0].toUpperCase() + word.slice(1));
  }

  // ---------------------------------------------------------------- settings autocomplete

  /** "State from": `None`, the Logic variables, then every device value (Device Values' list), each id prefixed by its kind. */
  async listSources(query: string): Promise<Item[]> {
    const [variables, slots] = await Promise.all([this.deps.variables.listVariables(query), this.deps.values.listSlots(query)]);
    const variable = this.__('keypad.variable', 'Variable');
    const items: Item[] = [
      ...variables.filter(i => i.id !== 'none')
        .map(i => ({ ...i, id: `var:${i.id}`, description: [variable, i.description].filter(Boolean).join(' · ') })),
      ...slots.filter(i => i.id !== 'none').map(i => ({ ...i, id: `cap:${i.id}` })),
    ];
    return withNone(this.__('variables.none', 'None'), query, items);
  }

  /**
   * A button's value (`valueN`), read from the widget's source: a variable's as Variable Presets' buttons; a list
   * capability's values by title; yes/no in the capability's words; a number or text as typed, then the current
   * value. Each item keeps its `value` and `type`. A capability that can't be set says so: such a button needs a Flow.
   */
  async listStateValues(sourceId: unknown, query: string): Promise<Item[]> {
    const source = parseSource(sourceId);
    if (!source) throw new Error(this.__('keypad.selectStateFirst', 'Pick State from first, then open this setting again.'));
    if (source.kind === 'variable') return this.deps.variables.listPresetValues(source.id, query);
    const [devices] = await devicesAndZones(this.homey);
    const raw = devices.find(d => d.id === source.deviceId)?.capabilitiesObj?.[source.capabilityId];
    if (!raw) throw new Error(this.__('keypad.missing', 'Device or variable not found'));
    const cap = describeCapability(raw, source.capabilityId);
    const notes = (value: unknown) => [
      value === raw.value ? this.__('varpresets.currentValue', 'Current value') : null,
      raw.setable === false ? this.__('keypad.cantSet', 'Can’t be set: give the button a Flow') : null,
    ].filter(Boolean).join(' · ') || undefined;
    const item = (value: boolean | number | string, name: string): Item => ({
      id: `${typeof value}:${JSON.stringify(value)}`, name, description: notes(value), value, type: typeof value,
    });
    const items: Item[] = [];
    if (cap.type === 'enum') {
      for (const v of cap.values ?? []) if (matches(query, v.title, v.id)) items.push(item(v.id, v.title));
    } else if (cap.type === 'boolean') {
      for (const value of [true, false]) {
        const name = this.booleanWord(source.capabilityId, value);
        if (matches(query, name)) items.push(item(value, name));
      }
    } else if (cap.type === 'number' || cap.type === 'string') {
      const q = (query || '').trim();
      const typed = cap.type === 'number' ? parseNumber(q) : q.slice(0, MAX_PRESET_TEXT) || null;
      if (typed !== null) items.push(item(typed, cap.type === 'number' ? q : String(typed)));
      const current = raw.value;
      const usable = cap.type === 'number'
        ? typeof current === 'number' && Number.isFinite(current)
        : typeof current === 'string' && current !== '' && current.length <= MAX_PRESET_TEXT;
      if (usable && current !== typed && matches(query, String(current))) items.push(item(current, String(current)));
    }
    return withNone(this.__('variables.none', 'None'), query, items);
  }

  /** The `code` setting: `None`, Any code, then the codes made on the app settings page by name (`A 4-digit code`). */
  codeItems(query: string): Item[] {
    const none = this.__('variables.none', 'None');
    const codes = this.stored();
    if (!codes.length) return [{ name: none, description: this.__('keypad.codeNone', 'No codes yet: add one in the app settings'), id: 'none' }];
    const any = { name: this.anyName(), description: this.__('keypad.anyCodes', `Any of the ${codes.length} codes`, { n: codes.length }), id: ANY_CODE };
    return withNone(none, query, [...(matches(query, any.name) ? [any] : []), ...this.codeList(query)]);
  }

  /** The trigger's `code` argument: Anyone (every press), Anyone with a code, then the codes. */
  pressCodeItems(query: string): Item[] {
    const items = [
      { name: this.__('keypad.anyone', 'Anyone'), id: ANY_PRESS },
      { name: this.__('keypad.anyoneWithCode', 'Anyone with a code'), id: ANY_CODE },
    ].filter(i => matches(query, i.name));
    return [...items, ...this.codeList(query)];
  }

  private codeList(query: string): Item[] {
    return this.listCodes().filter(c => matches(query, c.name)).map(c => ({
      name: c.name, description: this.__('keypad.codeDigits', `A ${c.digits}-digit code`, { n: c.digits }), id: c.id,
    }));
  }

  private anyName() {
    return this.__('keypad.anyCode', 'Any code');
  }

  // ---------------------------------------------------------------- the codes (the app settings page)

  private stored(): StoredCode[] {
    const list = this.secrets.get(KEYPAD_CODES);
    return Array.isArray(list) ? list.filter((c): c is StoredCode => !!c && typeof c.id === 'string' && typeof c.mac === 'string') : [];
  }

  private store(codes: StoredCode[]) {
    this.secrets.set(KEYPAD_CODES, codes);
  }

  private key(): Buffer {
    const hex = this.secrets.get(KEYPAD_SECRET);
    if (typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex)) return Buffer.from(hex, 'hex');
    const key = randomBytes(32);
    this.secrets.set(KEYPAD_SECRET, key.toString('hex'));
    return key;
  }

  private mac(salt: string, code: string): string {
    return createHmac('sha256', this.key()).update(`${salt}:${code}`).digest('hex').slice(0, 32);
  }

  /** The codes, by name, without their hashes. */
  listCodes(): CodeInfo[] {
    return this.stored().map(({ id, name, digits }) => ({ id, name, digits })).sort((a, b) => a.name.localeCompare(b.name));
  }

  /** A new code: a name of its own and 3–6 digits no other code has. */
  addCode(name: unknown, code: unknown): CodesResult {
    const codes = this.stored();
    const n = typeof name === 'string' ? name.trim() : '';
    if (!n || n.length > MAX_NAME) return { ok: false, reason: 'name' };
    if (codes.some(c => c.name.toLowerCase() === n.toLowerCase())) return { ok: false, reason: 'nameTaken' };
    if (typeof code !== 'string' || !CODE.test(code)) return { ok: false, reason: 'digits' };
    if (codes.length >= MAX_CODES) return { ok: false, reason: 'full' };
    const busy = this.countEdit();
    if (busy) return busy;
    if (this.find(codes, code)) return { ok: false, reason: 'codeTaken' };
    const salt = randomBytes(8).toString('hex');
    this.store([...codes, { id: randomBytes(6).toString('hex'), name: n, digits: code.length, salt, mac: this.mac(salt, code) }]);
    this.debug(`Keypad code ${n} added`);
    return { ok: true, codes: this.listCodes() };
  }

  /**
   * A code's new digits, which take its current ones: the settings page can't tell the owner from anyone whose key
   * may call the app, and a changed code would let them in at the widget. Wrong ones count toward its lock.
   */
  changeCode(id: unknown, current: unknown, code: unknown): CodesResult {
    const codes = this.stored();
    const entry = codes.find(c => c.id === id);
    if (!entry) return { ok: false, reason: 'missing' };
    if (typeof code !== 'string' || !CODE.test(code)) return { ok: false, reason: 'digits' };
    const refused = this.checkCode(entry.id, current);
    if (refused) return refused.result === 'locked' ? { ok: false, reason: 'locked', retryAfter: refused.retryAfter } : { ok: false, reason: 'wrongCode' };
    const busy = this.countEdit();
    if (busy) return busy;
    if (this.find(codes.filter(c => c.id !== entry.id), code)) return { ok: false, reason: 'codeTaken' };
    const salt = randomBytes(8).toString('hex');
    this.store(codes.map(c => (c.id === entry.id ? { ...c, digits: code.length, salt, mac: this.mac(salt, code) } : c)));
    this.debug(`Keypad code ${entry.name} changed`);
    return { ok: true, codes: this.listCodes() };
  }

  /**
   * Removes a code, without its digits: that only locks its buttons (a widget whose code is gone refuses them until
   * another is picked in its settings), so a forgotten code can go.
   */
  removeCode(id: unknown): CodesResult {
    const codes = this.stored();
    if (!codes.some(c => c.id === id)) return { ok: false, reason: 'missing' };
    this.store(codes.filter(c => c.id !== id));
    this.counted.delete(String(id));
    return { ok: true, codes: this.listCodes() };
  }

  /**
   * A widget's code: its name and length, `missing` once removed (Any code: while there's none), null without one. Any
   * code's length is the codes' while they all have one, else null.
   */
  codeInfo(id: unknown): KeypadState['code'] {
    if (typeof id !== 'string' || !id || id === 'none') return null;
    const codes = this.stored();
    if (id === ANY_CODE) {
      if (!codes.length) return { id, missing: true };
      const lengths = new Set(codes.map(c => c.digits));
      return { id, name: this.anyName(), digits: lengths.size === 1 ? codes[0].digits : null };
    }
    const c = codes.find(x => x.id === id);
    return c ? { id: c.id, name: c.name, digits: c.digits } : { id, missing: true };
  }

  /**
   * Checks a typed code: null when it's right (or there's no code to check), else why not. Wrong ones count per code,
   * Any code's together; the fifth in a row locks it. A code that was removed is `codeMissing`.
   */
  checkCode(codeId: unknown, code: unknown): CodeRefusal | null {
    const checked = this.check(codeId, code);
    return checked.result === 'right' ? null : checked;
  }

  /** `checkCode()`, with the code that was typed when it was right: Any code's tells whose. */
  check(codeId: unknown, code: unknown): Checked {
    if (codeId == null || codeId === '' || codeId === 'none') return { result: 'right', entry: null };
    const codes = this.stored();
    const any = codeId === ANY_CODE;
    const candidates = any ? codes : codes.filter(c => c.id === codeId);
    if (!candidates.length) return { result: 'codeMissing' };
    const bucket = any ? ANY_CODE : candidates[0].id;
    const locked = this.lockedFor(bucket);
    if (locked) return locked;
    const entry = typeof code === 'string' && CODE.test(code) ? this.find(candidates, code) : null;
    if (entry) {
      this.counted.delete(bucket);
      return { result: 'right', entry };
    }
    this.wrongCodes++;
    const refused = this.count(bucket, FREE_TRIES);
    if (refused.result === 'locked') this.log(`Keypad: ${this.counted.get(bucket)!.failures} wrong codes in a row, locked for ${refused.retryAfter} s`);
    return refused;
  }

  /** The code these digits are, of those given; every one of their length is compared, so the time tells no more. */
  private find(codes: StoredCode[], code: string): StoredCode | null {
    let hit: StoredCode | null = null;
    for (const c of codes) {
      if (c.digits !== code.length) continue;
      if (timingSafeEqual(Buffer.from(this.mac(c.salt, code), 'hex'), Buffer.from(c.mac, 'hex')) && !hit) hit = c;
    }
    return hit;
  }

  /** The lock on a code (or Any code, or the edits), while it lasts. */
  private lockedFor(bucket: string): { result: 'locked', retryAfter: number } | null {
    const count = this.counted.get(bucket);
    const now = Date.now();
    if (count && bucket === EDITS && now - count.at > FORGET_EDITS_MS) this.counted.delete(bucket);
    else if (count && now < count.lockedUntil) return { result: 'locked', retryAfter: Math.ceil((count.lockedUntil - now) / 1000) };
    return null;
  }

  /** One more try counted: the tries left, or the lock it starts (30 s, doubling with each further one up to 15 min). */
  private count(bucket: string, free: number): Exclude<CodeRefusal, { result: 'codeMissing' }> {
    const now = Date.now();
    const count = this.counted.get(bucket) ?? { failures: 0, lockedUntil: 0, at: now };
    count.failures++;
    count.at = now;
    this.counted.set(bucket, count);
    if (count.failures < free) return { result: 'wrongCode', left: free - count.failures };
    const wait = Math.min(LOCK_MS * 2 ** (count.failures - free), MAX_LOCK_MS);
    count.lockedUntil = now + wait;
    this.lockouts++;
    return { result: 'locked', retryAfter: Math.ceil(wait / 1000) };
  }

  /**
   * An add or a change, which says whether its digits are taken: refused while the edits are locked, else counted (the
   * one that starts the lock still goes through), so the settings route can't be used to guess the codes.
   */
  private countEdit(): { ok: false, reason: 'locked', retryAfter: number } | null {
    const locked = this.lockedFor(EDITS);
    if (locked) return { ok: false, reason: 'locked', retryAfter: locked.retryAfter };
    this.count(EDITS, FREE_EDITS);
    return null;
  }

  // ---------------------------------------------------------------- state and presses

  /** The source's state, the buttons' flows and the code's length. Flows that can't be read don't fail the state (`flows: null`). */
  async getState(sourceId: string | null, flowIds: string[], codeId: string | null = null): Promise<KeypadState> {
    const source = parseSource(sourceId);
    const ids = flowIds.filter(id => parseFlowId(id));
    const [state, flows] = await Promise.all([
      source ? this.sourceState(source) : null,
      ids.length ? this.deps.flows.getState(ids).catch((err) => {
        this.log('Keypad: could not read the flows:', err);
        return null;
      }) : [],
    ]);
    return { source: state, flows, code: this.codeInfo(codeId) };
  }

  private async sourceState(source: KeypadSource): Promise<SourceState> {
    if (source.kind === 'variable') {
      const [v] = await this.deps.variables.getState([source.id]);
      return !v || 'missing' in v ? { kind: 'variable', id: source.id, missing: true } : { kind: 'variable', ...v };
    }
    const { deviceId, capabilityId } = source;
    const [slot] = await this.deps.values.getState([`${deviceId}:${capabilityId}`]);
    if (!slot || 'missing' in slot) return { kind: 'capability', deviceId, capabilityId, missing: true };
    return { kind: 'capability', deviceId, capabilityId, name: slot.name, capability: slot.capability, value: slot.value };
  }

  /**
   * A button: its code first (when it sends one), then its Flow (the personal API key's Start Flows), or else the
   * source set to its value (a variable through the key, as Variable Presets; a capability with the app's own token, as
   * Locks and Doors). A missing key throws `KeyError`, which the route answers as `{ok: false, reason}`.
   */
  async press(body: PressBody): Promise<PressResult> {
    const checked = this.check(body.codeId, body.code);
    if (checked.result !== 'right') return checked;
    try {
      const result = await this.act(body);
      this.lastError = null;
      if (result.result === 'done') {
        this.pressed++;
        this.fire(body, checked.entry);
      }
      return result;
    } catch (err) {
      this.lastError = String((err as any)?.message ?? err);
      throw err;
    }
  }

  private async act(body: PressBody): Promise<PressResult> {
    if (typeof body.flow === 'string' && parseFlowId(body.flow)) {
      await this.deps.flows.trigger(body.flow);
      return { result: 'done' };
    }
    if (body.flow === undefined && body.source === undefined && body.value === undefined) return { result: 'done' }; // the trigger only
    const source = parseSource(body.source);
    if (!source) throw new Error('Nothing to do: no flow or state');
    if (source.kind === 'variable') {
      await this.deps.variables.set(source.id, body.value);
      return { result: 'done' };
    }
    const api = await getAppApi(this.homey);
    const device = await api.devices.getDevice({ id: source.deviceId, $cache: false });
    const raw = device.capabilitiesObj?.[source.capabilityId];
    if (!raw) throw new Error(`${device.name} has no ${source.capabilityId}`);
    if (raw.setable === false) return { result: 'notSetable' };
    const value = checkCapabilityValue(describeCapability(raw, source.capabilityId), body.value);
    await device.setCapabilityValue({ capabilityId: source.capabilityId, value });
    this.debug(`Keypad set ${source.capabilityId} of ${device.name} to ${JSON.stringify(value)}`);
    return { result: 'done' };
  }

  /** The trigger, after a press that worked; it never fails the press. */
  private fire(body: PressBody, entry: StoredCode | null) {
    const fire = this.deps.onPress;
    if (!fire) return;
    const tokens = { code: entry?.name ?? '', button: tokenText(body.button), keypad: tokenText(body.title) };
    fire(tokens, { codeId: entry?.id ?? null, name: entry?.name ?? '' })
      .catch(err => this.log('Keypad: the trigger failed:', err));
  }

  /**
   * The trigger's run listener: Anyone matches every press, Anyone with a code those with one, a code its own (by id,
   * else by name, so a code removed and added again under the same name still does).
   */
  pressMatches(arg: PressArg, state: Partial<PressState> | undefined): boolean {
    const id = typeof arg?.id === 'string' ? arg.id : '';
    if (!id || id === ANY_PRESS) return true;
    if (!state?.codeId) return false;
    if (id === ANY_CODE || id === state.codeId) return true;
    return typeof arg?.name === 'string' && !!state.name && arg.name.toLowerCase() === state.name.toLowerCase();
  }

  /** For the diagnostics report: counts, never codes, names or hashes. */
  describe() {
    const now = Date.now();
    return {
      codes: this.stored().length,
      pressed: this.pressed,
      wrongCodes: this.wrongCodes,
      lockouts: this.lockouts,
      lockedNow: [...this.counted.values()].filter(e => now < e.lockedUntil).length,
      lastError: this.lastError,
    };
  }

}
