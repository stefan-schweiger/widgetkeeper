import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import PersonalApiKey from './PersonalApiKey.js';
import type { AutocompleteItem } from './HeatmapService.js';
import Timings from './Timings.js';

const MINUTE = 60e3;
const TICK = MINUTE;
const IDLE_TIMEOUT = 10 * MINUTE;
/** The events keep the cache current; a full re-read this often is the safety net for a missed one. */
const REREAD = 4 * MINUTE;
const MAX_STRING = 1000;

export const VARIABLES_STATE_EVENT = 'variables:state';
// The key's setting and errors, for the widget API and the tests.
export { API_KEY_SETTING, KeyError as VariableWriteError, type KeyProblem as WriteProblem } from './PersonalApiKey.js';

export type VariableType = 'boolean' | 'number' | 'string';

export type Variable = { id: string, name: string, type: VariableType, value: boolean | number | string };

export type VariableEntry = Variable | { id: string, missing: true };

const TYPES = new Set(['boolean', 'number', 'string']);

/** A Logic variable from homey-api (an item instance or the raw event data), or null when it isn't one. */
export function toVariable(v: any): Variable | null {
  if (!v || typeof v.id !== 'string' || !TYPES.has(v.type)) return null;
  return { id: v.id, name: typeof v.name === 'string' ? v.name : v.id, type: v.type, value: v.value };
}

/** The value checked against the variable's type, or an error. */
export function checkValue(type: VariableType, value: unknown): boolean | number | string {
  if (type === 'boolean' && typeof value === 'boolean') return value;
  if (type === 'number' && typeof value === 'number' && Number.isFinite(value)) return value;
  if (type === 'string' && typeof value === 'string' && value.length <= MAX_STRING) return value;
  throw new Error(`Not a valid ${type}: ${JSON.stringify(value)}`);
}

function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

/**
 * The Flow Variables widget: Homey's Logic variables, read and set. The service subscribes to the Logic
 * manager while a widget asks (`variable.update`/`create`/`delete`) and lets go after 10 idle minutes.
 */
export default class VariableService {

  private vars = new Map<string, Variable>();
  /** Variable id → when a widget last asked for it. Only those are sent out as realtime events. */
  private requested = new Map<string, number>();
  private connecting: Promise<any> | null = null;
  private connectedApi: any = null;
  private lastRead = 0;
  private lastRequest = 0;
  private lastError: string | null = null;
  private tickTimer: NodeJS.Timeout | null = null;
  private lastWriteError: string | null = null;

  private onUpdate = (data: any) => this.received(data);
  private onDelete = (data: any) => {
    const id = data?.id;
    if (typeof id !== 'string') return;
    this.vars.delete(id);
    if (this.requested.has(id)) this.homey.api.realtime(VARIABLES_STATE_EVENT, { id, missing: true });
  };

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    /** Writes go through the user's personal API key (the app's token may only read variables). */
    private key = new PersonalApiKey(homey, log),
  ) {}

  start() {
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    await this.disconnect();
  }

  // ---------------------------------------------------------------- settings autocomplete

  /** Every variable, sorted by name, described by its type and current value. */
  async listVariables(query: string): Promise<AutocompleteItem[]> {
    const api = await getAppApi(this.homey);
    const all = Object.values(await api.logic.getVariables({ $cache: false }) as Record<string, any>)
      .map(toVariable).filter((v): v is Variable => v !== null);
    const items = all
      .filter(v => matches(query, v.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(v => ({ name: v.name, description: `${this.typeTitle(v.type)} · ${this.valueText(v)}`, id: v.id }));
    // "None" first, so a slot can be emptied again; the widget skips the id `none`.
    const none = this.homey.__('variables.none') || 'None';
    return matches(query, none) ? [{ name: none, id: 'none' }, ...items] : items;
  }

  private typeTitle(type: VariableType) {
    const key = { boolean: 'typeBoolean', number: 'typeNumber', string: 'typeString' }[type];
    return this.homey.__(`variables.${key}`) || { boolean: 'Yes/No', number: 'Number', string: 'Text' }[type];
  }

  private valueText(v: Variable) {
    if (v.type === 'boolean') return v.value ? (this.homey.__('variables.yes') || 'Yes') : (this.homey.__('variables.no') || 'No');
    const s = String(v.value ?? '');
    return s.length > 40 ? `${s.slice(0, 39)}…` : s;
  }

  // ---------------------------------------------------------------- state

  /** One entry per id, in the order asked for; a deleted variable is `missing`. */
  async getState(ids: string[]): Promise<VariableEntry[]> {
    const tm = new Timings();
    const now = Date.now();
    this.lastRequest = now;
    for (const id of ids) this.requested.set(id, now);
    await this.ensureConnected(tm);
    if (Date.now() - this.lastRead > REREAD) await this.readAll(tm);
    this.debug(`Variables state for ${ids.length} ids: ${tm.summary()}`);
    return ids.map(id => {
      const v = this.vars.get(id);
      return v ? { ...v } : { id, missing: true as const };
    });
  }

  /** Sets a variable, checking the value against its type first. Writes need the user's API key (see API_KEY_SETTING). */
  async set(id: string, value: unknown) {
    const api = await getAppApi(this.homey);
    let v = this.vars.get(id);
    if (!v) {
      v = toVariable(await api.logic.getVariable({ id })) ?? undefined;
      if (!v) throw new Error(`No variable ${id}`);
    }
    const checked = checkValue(v.type, value);
    try {
      await this.key.run(keyApi => keyApi.logic.updateVariable({ id, variable: { value: checked } }));
    } catch (err) {
      this.lastWriteError = String((err as any)?.message ?? err);
      throw err;
    }
    this.lastWriteError = null;
    this.debug(`Set variable ${v.name} (${id}) = ${JSON.stringify(checked)}`);
    // The update event follows, but the next /state shouldn't show the old value until it does.
    const cached = this.vars.get(id);
    if (cached) cached.value = checked;
  }

  /** For the diagnostics report: never the values. */
  describe() {
    return {
      connected: !!this.connectedApi,
      variables: this.vars.size,
      requested: this.requested.size,
      lastError: this.lastError,
      apiKey: this.key.has(),
      lastWriteError: this.lastWriteError,
    };
  }

  private ensureConnected(tm: Timings): Promise<any> {
    if (!this.connecting) {
      this.connecting = (async () => {
        const api = await tm.time('api', () => getAppApi(this.homey));
        await tm.time('connect', () => api.logic.connect());
        api.logic.on('variable.update', this.onUpdate);
        api.logic.on('variable.create', this.onUpdate);
        api.logic.on('variable.delete', this.onDelete);
        this.connectedApi = api;
        this.lastRead = 0;
        this.debug('Subscribed to Logic variables');
        return api;
      })().catch(err => {
        this.connecting = null;
        this.lastError = String(err?.message ?? err);
        this.log('Could not subscribe to Logic variables:', err);
        throw err;
      });
    }
    return this.connecting;
  }

  private async readAll(tm: Timings) {
    const api = await this.ensureConnected(tm);
    const all = await tm.time('getVariables', () => api.logic.getVariables({ $cache: false })) as Record<string, any>;
    this.vars.clear();
    for (const raw of Object.values(all)) {
      const v = toVariable(raw);
      if (v) this.vars.set(v.id, v);
    }
    this.lastRead = Date.now();
    this.lastError = null;
  }

  /** `variable.update`/`create`: an item instance when cached, else the raw data, possibly partial. */
  private received(data: any) {
    const id = data?.id;
    if (typeof id !== 'string') return;
    const prev = this.vars.get(id);
    const v = toVariable({ ...prev, ...data }); // an item's properties are its own enumerable fields
    if (!v) return;
    this.vars.set(id, v);
    if (this.requested.has(id)) this.homey.api.realtime(VARIABLES_STATE_EVENT, { ...v });
  }

  private tick() {
    const now = Date.now();
    for (const [id, at] of this.requested) {
      if (now - at > IDLE_TIMEOUT) this.requested.delete(id);
    }
    if (this.connecting && now - this.lastRequest > IDLE_TIMEOUT) this.disconnect();
  }

  private async disconnect() {
    const api = this.connectedApi;
    this.connecting = null;
    this.connectedApi = null;
    this.vars.clear();
    this.lastRead = 0;
    if (!api) return;
    api.logic.off?.('variable.update', this.onUpdate);
    api.logic.off?.('variable.create', this.onUpdate);
    api.logic.off?.('variable.delete', this.onDelete);
    try { await api.logic.disconnect(); } catch (err) { /* ignore */ }
    this.debug('Stopped following Logic variables');
  }

}
