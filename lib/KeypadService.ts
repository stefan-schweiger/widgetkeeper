import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
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

/** Wrong codes in a row before the pad locks, then 30 s, doubling with each further wrong one up to 15 min (the web password's rule). */
const FREE_TRIES = 5;
const LOCK_MS = 30e3;
const MAX_LOCK_MS = 15 * 60e3;
/** The codes whose wrong tries are counted, at most: the oldest goes first. */
const MAX_COUNTED = 200;

/** A code item's id: `code:v1:<key tag>:<salt>:<hmac>`, so a code made with another key (the app reinstalled) shows as such. */
const CODE_ID = /^code:v1:([0-9a-f]{8}):([0-9a-f]{16}):([0-9a-f]{32})$/;
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

/** `/state`: the source (null without one) and the buttons' flows (null when they couldn't be read). */
export type KeypadState = { source: SourceState | null, flows: FlowEntry[] | null };

export type CodeRefusal = { result: 'wrongCode', left: number } | { result: 'locked', retryAfter: number } | { result: 'codeReset' };

/** What a press did: `done`, a refused code, or a capability that can't be set (the button wants a Flow). */
export type PressResult = { result: 'done' } | { result: 'notSetable' } | CodeRefusal;

/** A press: a Flow to start, or the source and the value to set it to; with the button's code when it wants one. */
export type PressBody = { flow?: unknown, source?: unknown, value?: unknown, codeId?: unknown, code?: unknown };

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
 * variable (Variables' service) or a device capability (Device Values' tracking). The code is never kept: the widget's
 * setting holds an HMAC of it, keyed with a secret only the app has, and the app checks it, counting wrong ones.
 */
export default class KeypadService {

  private secrets: Secrets;
  /** Wrong tries in a row per code id, and until when it's locked. */
  private counted = new Map<string, { failures: number, lockedUntil: number }>();
  private pressed = 0;
  private wrongCodes = 0;
  private lockouts = 0;
  private lastError: string | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private deps: { flows: FlowService, values: ValueService, variables: VariableService },
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

  /**
   * The `code` setting: typing 3–6 digits offers one item for them, named by dots only, whose id is the code's HMAC
   * (`makeCodeId()`), with `digits` so the pad knows when it's complete. Anything else offers `None` with how to set one.
   */
  codeItems(query: string): Item[] {
    const q = (query || '').trim();
    if (!CODE.test(q)) return [{ name: this.__('variables.none', 'None'), description: this.__('keypad.codeHint', 'Type a code of 3 to 6 digits'), id: 'none' }];
    return [{
      name: '•'.repeat(q.length),
      description: this.__('keypad.codeDigits', `A ${q.length}-digit code`, { n: q.length }),
      id: this.makeCodeId(q),
      digits: q.length,
    }];
  }

  // ---------------------------------------------------------------- the code

  /** The stored key, or null before the first code (or after the secrets file was lost). */
  private storedKey(): Buffer | null {
    const hex = this.secrets.get(KEYPAD_SECRET);
    return typeof hex === 'string' && /^[0-9a-f]{64}$/.test(hex) ? Buffer.from(hex, 'hex') : null;
  }

  private key(): Buffer {
    const stored = this.storedKey();
    if (stored) return stored;
    const key = randomBytes(32);
    this.secrets.set(KEYPAD_SECRET, key.toString('hex'));
    return key;
  }

  private static tag(key: Buffer): string {
    return createHash('sha256').update(key).digest('hex').slice(0, 8);
  }

  private static mac(key: Buffer, salt: string, code: string): string {
    return createHmac('sha256', key).update(`${salt}:${code}`).digest('hex').slice(0, 32);
  }

  /** A code's id for the widget's setting: the key's tag, a random salt and the HMAC; never the digits. */
  makeCodeId(code: string): string {
    const key = this.key();
    const salt = randomBytes(8).toString('hex');
    return `code:v1:${KeypadService.tag(key)}:${salt}:${KeypadService.mac(key, salt, code)}`;
  }

  /**
   * Checks a typed code against its id: null when it's right (or there's no code to check), else why not. Wrong ones
   * count per code id; the fifth in a row locks it. A code made with another key is `codeReset`: set it again.
   */
  checkCode(codeId: unknown, code: unknown): CodeRefusal | null {
    if (codeId == null || codeId === '' || codeId === 'none') return null;
    const m = CODE_ID.exec(String(codeId));
    const key = this.storedKey();
    if (!m || !key || KeypadService.tag(key) !== m[1]) return { result: 'codeReset' };
    const id = String(codeId);
    const now = Date.now();
    const entry = this.counted.get(id) ?? { failures: 0, lockedUntil: 0 };
    if (now < entry.lockedUntil) return { result: 'locked', retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
    const right = typeof code === 'string' && CODE.test(code)
      && timingSafeEqual(Buffer.from(KeypadService.mac(key, m[2], code), 'hex'), Buffer.from(m[3], 'hex'));
    if (right) {
      this.counted.delete(id);
      return null;
    }
    this.wrongCodes++;
    entry.failures++;
    // Kept newest last, so the oldest goes first when there are too many.
    this.counted.delete(id);
    this.counted.set(id, entry);
    if (this.counted.size > MAX_COUNTED) this.counted.delete(this.counted.keys().next().value!);
    if (entry.failures < FREE_TRIES) return { result: 'wrongCode', left: FREE_TRIES - entry.failures };
    const wait = Math.min(LOCK_MS * 2 ** (entry.failures - FREE_TRIES), MAX_LOCK_MS);
    entry.lockedUntil = now + wait;
    this.lockouts++;
    this.log(`Keypad: ${entry.failures} wrong codes in a row, locked for ${wait / 1000} s`);
    return { result: 'locked', retryAfter: Math.ceil(wait / 1000) };
  }

  // ---------------------------------------------------------------- state and presses

  /** The source's state and the buttons' flows. Flows that can't be read don't fail the state (`flows: null`). */
  async getState(sourceId: string | null, flowIds: string[]): Promise<KeypadState> {
    const source = parseSource(sourceId);
    const ids = flowIds.filter(id => parseFlowId(id));
    const [state, flows] = await Promise.all([
      source ? this.sourceState(source) : null,
      ids.length ? this.deps.flows.getState(ids).catch((err) => {
        this.log('Keypad: could not read the flows:', err);
        return null;
      }) : [],
    ]);
    return { source: state, flows };
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
    const refused = this.checkCode(body.codeId, body.code);
    if (refused) return refused;
    try {
      const result = await this.act(body);
      this.lastError = null;
      if (result.result === 'done') this.pressed++;
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

  /** For the diagnostics report: counts, never codes or their hashes. */
  describe() {
    const now = Date.now();
    return {
      key: this.storedKey() !== null,
      pressed: this.pressed,
      wrongCodes: this.wrongCodes,
      lockouts: this.lockouts,
      lockedNow: [...this.counted.values()].filter(e => now < e.lockedUntil).length,
      lastError: this.lastError,
    };
  }

}
