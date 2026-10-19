import type Homey from 'homey';
import { getAppApi } from './appApi.js';
import { matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { FLOW_ICON_IMAGES } from './flowIconImages.js';
import PersonalApiKey from './PersonalApiKey.js';
import { sharedCache } from './sharedCache.js';
import Timings from './Timings.js';
import { TILE_COLORS, type TileColor } from './ValueService.js';

/** How long a read of every flow is reused: renames and enabling show on the widget's next refresh. */
const CACHE_MS = 60e3;
/** The settings' autocomplete reads fresher (a flow made a moment ago should be there), but not per keystroke. */
const AUTOCOMPLETE_CACHE_MS = 5e3;

export const FLOWS_COLOR_EVENT = 'flows:color';
/** The app setting holding the button colours set by Flows: `{ '<kind>:<flow id>': colour }`. */
export const FLOW_COLORS_SETTING = 'flowColors';

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
  /** A colour set by the Flow card, which wins over the button's own. */
  color?: TileColor,
};

export type FlowEntry = FlowInfo | { id: string, missing: true };

/** `flow:<id>` or `advanced:<id>` → its kind and flow id, or null. */
export function parseFlowId(id: string): { kind: FlowKind, flowId: string } | null {
  const m = /^(flow|advanced):(.+)$/.exec(id || '');
  return m ? { kind: m[1] as FlowKind, flowId: m[2] } : null;
}

/**
 * The Flow Buttons widget: Homey's flows by name, and starting one. Reading uses the app's own token
 * (`homey.flow.readonly`); starting needs `homey.flow.start`, which apps don't get, so it goes through the
 * user's personal API key, as Variables' writes do.
 */
export default class FlowService {

  /** Every flow and Advanced Flow, keyed by slot id: the shared read (see `read`). */
  private cache = sharedCache(() => this.readAll().catch((err) => {
    this.lastError = String(err?.message ?? err);
    this.log('Could not read the flows:', err);
    throw err;
  }));
  private lastError: string | null = null;
  private lastTriggerError: string | null = null;
  private triggered = 0;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    private key = PersonalApiKey.for(homey, log),
  ) {}

  // ---------------------------------------------------------------- settings autocomplete

  /**
   * The flows that can be started by hand (`triggerable`), sorted by name and described by their type and
   * folder. "None" first, so a slot can be emptied again; the widget skips the id `none`.
   */
  async listFlows(query: string): Promise<AutocompleteItem[]> {
    const { flows, folders } = await this.read(AUTOCOMPLETE_CACHE_MS);
    const advanced = this.homey.__('flows.advanced') || 'Advanced Flow';
    const standard = this.homey.__('flows.standard') || 'Flow';
    const items = [...flows.values()]
      .filter(f => f.triggerable && matches(query, f.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(f => {
        const folder = f.folder ? folders.get(f.folder) : undefined;
        return { name: f.name, description: [f.advanced ? advanced : standard, folder].filter(Boolean).join(' · '), id: f.id };
      });
    return withNone(this.homey.__('flows.none') || 'None', query, items);
  }

  /** The Flow card's flow argument: the settings' list without `None`. */
  async listColorFlows(query: string): Promise<AutocompleteItem[]> {
    return (await this.listFlows(query)).filter(i => i.id !== 'none');
  }

  /**
   * The built-in icons, by their names in Homey's language and in its alphabetical order, each with a preview of
   * the button (`iconImage()`). The widget draws them (`ICONS` in widget.js). With `none` (the media widget's
   * optional icons), "None" comes first, so an icon can be removed again; the widgets skip the id `none`.
   */
  listIcons(query: string, { none = false } = {}): AutocompleteItem[] {
    const language = this.homey.i18n.getLanguage();
    const items = FLOW_ICONS
      .map(id => ({ id, name: this.homey.__(`flows.icons.${id}`) || id, image: iconImage(id) }))
      .filter(i => matches(query, i.name, i.id))
      .sort((a, b) => a.name.localeCompare(b.name, language));
    return none ? withNone(this.homey.__('flows.none') || 'None', query, items) : items;
  }

  // ---------------------------------------------------------------- state

  /** One entry per slot id, in the order asked for; a deleted flow is `missing`. */
  async getState(ids: string[]): Promise<FlowEntry[]> {
    const tm = new Timings();
    const { flows } = await tm.time('flows', () => this.read(CACHE_MS));
    const colors = this.colors();
    this.debug(`Flows state for ${ids.length} ids: ${tm.summary()}`);
    return ids.map(id => {
      const f = flows.get(id);
      if (!f) return { id, missing: true as const };
      const { folder, ...info } = f;
      const color = colors[id];
      return color ? { ...info, color } : info;
    });
  }
  // ---------------------------------------------------------------- button colours (Flow)

  /** The colours set by Flows, per slot id. Kept in an app setting, so they survive restarts. */
  private colors(): Record<string, TileColor> {
    const v = this.homey.settings.get(FLOW_COLORS_SETTING);
    return v && typeof v === 'object' ? v : {};
  }

  /**
   * The Flow card "Set the button colour of … to …": every button starting that flow takes the colour (a Flow can't
   * address a widget instance). `default` removes it, so the buttons have their own colour again.
   */
  setColor(id: string, color: string) {
    if (!parseFlowId(id)) throw new Error(`Not a flow: ${id}`);
    const next = color === 'default' ? null : (TILE_COLORS as readonly string[]).includes(color) ? color as TileColor : undefined;
    if (next === undefined) throw new Error(`Unknown colour: ${color}`);
    const colors = { ...this.colors() };
    if ((colors[id] ?? null) === next) return; // the buttons have it already
    if (next) colors[id] = next;
    else delete colors[id];
    this.homey.settings.set(FLOW_COLORS_SETTING, colors);
    this.homey.api.realtime(FLOWS_COLOR_EVENT, { id, color: next });
    this.debug(`Button colour of ${id} set to ${color}`);
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
      cached: this.cache.cached,
      lastError: this.lastError,
      apiKey: this.key.has(),
      triggered: this.triggered,
      lastTriggerError: this.lastTriggerError,
      colors: Object.keys(this.colors()).length,
    };
  }

  /** A read (or one on its way) is shared while it's at most `maxAge` old. */
  private read(maxAge: number) {
    return this.cache.get(maxAge);
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

/**
 * The icons a button can have, by id: those of the pre-rendered previews (`npm run flow-icons` renders them from the
 * widgets' kit, which draws them; a test checks they match). The settings list them by `flows.icons.<id>`.
 */
export const FLOW_ICONS = Object.keys(FLOW_ICON_IMAGES);

/**
 * An icon as the settings' preview: a PNG data URL of the widget's button, the white glyph on Homey's blue, which
 * reads on a light or a dark settings sheet. Pre-rendered (`npm run flow-icons`): the iOS app showed nothing for an
 * SVG data URL (2026-10-08).
 */
export function iconImage(id: string): string | undefined {
  return FLOW_ICON_IMAGES[id]?.image;
}
