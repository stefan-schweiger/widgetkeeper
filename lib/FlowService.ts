import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import type { AutocompleteItem } from './HeatmapService.js';
import PersonalApiKey from './PersonalApiKey.js';
import Timings from './Timings.js';

/** How long a read of every flow is reused: renames and enabling show on the widget's next refresh. */
const CACHE_MS = 60e3;

/** A slot's id: `flow:<id>` for a standard Flow, `advanced:<id>` for an Advanced Flow. */
export type FlowKind = 'flow' | 'advanced';

export type FlowInfo = {
  id: string, // the slot id, `<kind>:<flow id>`
  name: string,
  enabled: boolean,
  /**
   * Homey's own flag: whether it can be started by hand (its conditions, then its actions). Not only flows with
   * "This Flow is started": on the test Homey 32 of 33 flows had it, device and time triggers included (2026-10-08).
   */
  triggerable: boolean,
  advanced: boolean,
};

export type FlowEntry = FlowInfo | { id: string, missing: true };

/** `flow:<id>` or `advanced:<id>` → its kind and flow id, or null. */
export function parseFlowId(id: string): { kind: FlowKind, flowId: string } | null {
  const m = /^(flow|advanced):(.+)$/.exec(id || '');
  return m ? { kind: m[1] as FlowKind, flowId: m[2] } : null;
}

function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

/**
 * The Flow Buttons widget: Homey's flows by name, and starting one. Reading uses the app's own token
 * (`homey.flow.readonly`); starting needs `homey.flow.start`, which apps don't get, so it goes through the
 * user's personal API key, as Flow Variables' writes do.
 */
export default class FlowService {

  private cache: { at: number, flows: Promise<{ flows: Map<string, FlowInfo & { folder: string | null }>, folders: Map<string, string> }> } | null = null;
  private lastError: string | null = null;
  private lastTriggerError: string | null = null;
  private triggered = 0;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    private key = new PersonalApiKey(homey, log),
  ) {}

  // ---------------------------------------------------------------- settings autocomplete

  /**
   * The flows that can be started by hand (`triggerable`), sorted by name and described by their type and
   * folder. "None" first, so a slot can be emptied again; the widget skips the id `none`.
   */
  async listFlows(query: string): Promise<AutocompleteItem[]> {
    const { flows, folders } = await this.read(true);
    const advanced = this.homey.__('flows.advanced') || 'Advanced Flow';
    const standard = this.homey.__('flows.standard') || 'Flow';
    const items = [...flows.values()]
      .filter(f => f.triggerable && matches(query, f.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => {
        const folder = f.folder ? folders.get(f.folder) : undefined;
        return { name: f.name, description: [f.advanced ? advanced : standard, folder].filter(Boolean).join(' · '), id: f.id };
      });
    const none = this.homey.__('flows.none') || 'None';
    return matches(query, none) ? [{ name: none, id: 'none' }, ...items] : items;
  }

  /** The built-in icons, by their names in Homey's language. The widget draws them (`ICONS` in widget.js). */
  listIcons(query: string): AutocompleteItem[] {
    return FLOW_ICONS
      .map(id => ({ id, name: this.homey.__(`flows.icons.${id}`) || id }))
      .filter(i => matches(query, i.name, i.id));
  }

  // ---------------------------------------------------------------- state

  /** One entry per slot id, in the order asked for; a deleted flow is `missing`. */
  async getState(ids: string[]): Promise<FlowEntry[]> {
    const tm = new Timings();
    const { flows } = await tm.time('flows', () => this.read(false));
    this.debug(`Flows state for ${ids.length} ids: ${tm.summary()}`);
    return ids.map(id => {
      const f = flows.get(id);
      if (!f) return { id, missing: true as const };
      const { folder, ...info } = f;
      return info;
    });
  }

  /** Starts a flow through the user's API key (a KeyError says why it can't). */
  async trigger(id: string) {
    const parsed = parseFlowId(id);
    if (!parsed) throw new Error(`Not a flow: ${id}`);
    try {
      await this.key.run(api => parsed.kind === 'advanced'
        ? api.flow.triggerAdvancedFlow({ id: parsed.flowId })
        : api.flow.triggerFlow({ id: parsed.flowId }));
    } catch (err) {
      this.lastTriggerError = String((err as any)?.message ?? err);
      throw err;
    }
    this.lastTriggerError = null;
    this.triggered++;
    this.debug(`Started ${parsed.kind === 'advanced' ? 'Advanced Flow' : 'Flow'} ${parsed.flowId}`);
  }

  /** For the diagnostics report: counts, never names. */
  describe() {
    return {
      cached: !!this.cache,
      lastError: this.lastError,
      apiKey: this.key.has(),
      triggered: this.triggered,
      lastTriggerError: this.lastTriggerError,
    };
  }

  /** Every flow and Advanced Flow, keyed by slot id. Shared and reused for CACHE_MS; `fresh` reads again. */
  private read(fresh: boolean) {
    const now = Date.now();
    if (fresh || !this.cache || now - this.cache.at > CACHE_MS) {
      const flows = this.readAll().catch(err => {
        if (this.cache?.flows === flows) this.cache = null;
        this.lastError = String(err?.message ?? err);
        this.log('Could not read the flows:', err);
        throw err;
      });
      this.cache = { at: now, flows };
    }
    return this.cache.flows;
  }

  private async readAll() {
    const api = await getAppApi(this.homey);
    const [plain, advanced, folderList] = await Promise.all([
      api.flow.getFlows({ $cache: false }),
      api.flow.getAdvancedFlows({ $cache: false }),
      api.flow.getFlowFolders({ $cache: false }).catch(() => ({})), // only for the descriptions
    ]) as Record<string, any>[];
    const flows = new Map<string, FlowInfo & { folder: string | null }>();
    const add = (raw: any, isAdvanced: boolean) => {
      if (!raw || typeof raw.id !== 'string') return;
      const id = `${isAdvanced ? 'advanced' : 'flow'}:${raw.id}`;
      flows.set(id, {
        id,
        name: typeof raw.name === 'string' ? raw.name : raw.id,
        enabled: raw.enabled !== false,
        triggerable: raw.triggerable === true,
        advanced: isAdvanced,
        folder: typeof raw.folder === 'string' ? raw.folder : null,
      });
    };
    for (const f of Object.values(plain ?? {})) add(f, false);
    for (const f of Object.values(advanced ?? {})) add(f, true);
    const folders = new Map<string, string>();
    for (const f of Object.values(folderList ?? {})) {
      if (f && typeof f.id === 'string' && typeof f.name === 'string') folders.set(f.id, f.name);
    }
    this.lastError = null;
    return { flows, folders };
  }

}

/** The icons a button can have; the widget draws them and the settings list them by `flows.icons.<id>`. */
export const FLOW_ICONS = [
  'play', 'power', 'bulb', 'sun', 'moon', 'home', 'leave', 'bed', 'lock', 'shield',
  'bell', 'flame', 'snowflake', 'fan', 'drop', 'bolt', 'music', 'tv', 'clock', 'star', 'heart',
] as const;
