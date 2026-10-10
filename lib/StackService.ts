import type Homey from 'homey';
import type { AutocompleteItem } from './HeatmapService.js';
import PersonalApiKey, { KeyError } from './PersonalApiKey.js';
import Timings from './Timings.js';

/** How long a read of the dashboards is reused. A widget re-reads its pages every 5 min. */
const CACHE_MS = 60e3;
/** The settings' autocomplete reads fresher (a dashboard made a moment ago should be there), but not per keystroke. */
const AUTOCOMPLETE_CACHE_MS = 5e3;
/** How long the diagnostics report waits for its trial read of the dashboards. */
const DESCRIBE_TIMEOUT_MS = 5e3;
/** The longest a Flow may bring a page forward. */
const MAX_SHOW_MINUTES = 24 * 60;

/** The widgets a stack can show: every widget of this app but the stack itself. Keep in step with `TYPES` in widget.js. */
export const STACK_TYPES = [
  'electricity', 'thermostat', 'quickactions', 'sensoralarms', 'sensordots', 'weather', 'heatmap', 'cameras', 'values',
  'lights', 'sparklines', 'variables', 'flows', 'price', 'timers', 'locks', 'curtains', 'media',
] as const;

export type StackType = typeof STACK_TYPES[number];

export const STACK_SHOW_EVENT = 'stack:show';
export const STACK_RESUME_EVENT = 'stack:resume';
export const STACK_SHOW_CARD = 'stack_show';
export const STACK_RESUME_CARD = 'stack_resume';

/**
 * One of this app's widgets on the stack's dashboard, as the stack rebuilds it. `id` is the dashboard widget's own
 * id, which the page uses as its widget instance id (so a stack's Timers page shares the original's timer).
 */
export type StackPage = {
  id: string,
  type: StackType,
  title: string | null,
  settings: Record<string, unknown>,
  deviceIds: string[],
};

/** A Flow's request to bring a widget type forward, until `until` (ms). */
export type StackRequest = { type: StackType, until: number };

export const isStackType = (type: unknown): type is StackType => (STACK_TYPES as readonly unknown[]).includes(type);

function matches(query: string, ...texts: (string | undefined)[]) {
  const q = (query || '').trim().toLowerCase();
  return !q || texts.some(t => t?.toLowerCase().includes(q));
}

/**
 * The pages of a dashboard: this app's widgets (`type: 'app_webview'`, `data.appWidgetId` =
 * `homey:app:<appId>:<widget>`), column by column, top to bottom. Homey's own widgets and other apps' can't be
 * rebuilt in a widget frame, and a stack inside a stack is left out.
 */
export function dashboardPages(dashboard: any, appId: string): StackPage[] {
  const prefix = `homey:app:${appId}:`;
  const pages: StackPage[] = [];
  for (const column of Array.isArray(dashboard?.columns) ? dashboard.columns : []) {
    for (const w of Array.isArray(column?.widgets) ? column.widgets : []) {
      const appWidgetId = w?.type === 'app_webview' ? w.data?.appWidgetId : null;
      if (typeof appWidgetId !== 'string' || !appWidgetId.startsWith(prefix)) continue;
      const type = appWidgetId.slice(prefix.length);
      if (!isStackType(type) || typeof w.id !== 'string') continue;
      pages.push({
        id: w.id,
        type,
        title: typeof w.title === 'string' ? w.title : null,
        settings: w.data?.settings && typeof w.data.settings === 'object' ? w.data.settings : {},
        deviceIds: Array.isArray(w.data?.deviceIds) ? w.data.deviceIds.filter((id: unknown) => typeof id === 'string') : [],
      });
    }
  }
  return pages;
}

/**
 * The Smart Stack widget: the pages it rotates through are this app's widgets on a dashboard the user picks.
 * Reading a dashboard needs `homey.dashboard.readonly`, which the app's own token lacks (2026-10-10), so it goes
 * through the user's personal API key. Also holds the Flow cards' requests to bring a widget forward.
 */
export default class StackService {

  private cache: { at: number, dashboards: Promise<any[]> } | null = null;
  private requests = new Map<StackType, number>();
  private lastError: string | null = null;
  private reads = 0;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    private key = PersonalApiKey.for(homey, log),
  ) {}

  // ---------------------------------------------------------------- settings autocomplete

  /**
   * Every dashboard by name, described by how many of this app's widgets it has (what the stack will show). Without
   * a usable API key, one item (id `none`, which the widget treats as no dashboard) says what to do instead.
   */
  async listDashboards(query: string): Promise<AutocompleteItem[]> {
    let dashboards: any[];
    try {
      dashboards = await this.read(AUTOCOMPLETE_CACHE_MS);
    } catch (err) {
      if (!(err instanceof KeyError)) throw err;
      return [{ id: 'none', name: this.homey.__(`stack.${err.reason}`) || err.reason, description: this.homey.__('stack.keyHint') || '' }];
    }
    const appId = this.homey.manifest.id;
    return dashboards
      .filter(d => matches(query, d.name))
      .sort((a, b) => String(a.name).localeCompare(String(b.name)))
      .map(d => ({
        id: d.id,
        name: d.name,
        description: this.homey.__('stack.pageCount', { count: dashboardPages(d, appId).length }) || '',
      }));
  }

  // ---------------------------------------------------------------- state

  /** The dashboard's pages (`missing` when it's gone) and the Flow requests still running. */
  async getPages(dashboardId: string): Promise<{ pages: StackPage[], missing?: true, requests: StackRequest[], now: number }> {
    const tm = new Timings();
    const dashboards = await tm.time('dashboards', () => this.read(CACHE_MS));
    const dashboard = dashboards.find(d => d.id === dashboardId);
    const pages = dashboard ? dashboardPages(dashboard, this.homey.manifest.id) : [];
    this.debug(`Stack pages of ${dashboardId}: ${pages.length} ${tm.summary()}`);
    // `now`: the requests' `until` is this clock; the widget moves it into the screen's.
    const now = Date.now();
    return dashboard ? { pages, requests: this.activeRequests(now), now } : { pages, missing: true, requests: this.activeRequests(now), now };
  }

  // ---------------------------------------------------------------- Flow cards

  /** *Bring [widget] forward on stacks for [minutes]*: every stack page of that type, on every screen. */
  show(type: string, minutes: number) {
    if (!isStackType(type)) throw new Error(`Not a widget: ${type}`);
    const ms = Math.min(Math.max(Number(minutes) || 0, 0), MAX_SHOW_MINUTES) * 60e3;
    if (!(ms > 0)) throw new Error('The time must be above 0 minutes');
    const until = Date.now() + ms;
    this.requests.set(type, until);
    this.homey.api.realtime(STACK_SHOW_EVENT, { type, until, now: Date.now() });
    this.debug(`Stack: bring ${type} forward for ${Math.round(ms / 1000)} s`);
  }

  /** *Return stacks to rotation*: ends every request. */
  resume() {
    this.requests.clear();
    this.homey.api.realtime(STACK_RESUME_EVENT, {});
    this.debug('Stack: back to rotation');
  }

  /** The requests that haven't run out, newest first. */
  activeRequests(now = Date.now()): StackRequest[] {
    for (const [type, until] of this.requests) if (until <= now) this.requests.delete(type);
    return [...this.requests].map(([type, until]) => ({ type, until })).sort((a, b) => b.until - a.until);
  }

  /**
   * For the diagnostics report: counts, never names. With a key saved, it also tries a read, so the report says
   * whether the key may read dashboards (`dashboards`: how many, or the problem).
   */
  async describe() {
    let dashboards: number | string | null = null;
    if (this.key.has()) {
      // With a time limit: a hanging read mustn't hold up the whole report.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<string>((resolve) => { timer = setTimeout(() => resolve('timeout'), DESCRIBE_TIMEOUT_MS); });
      dashboards = await Promise.race([
        this.read(CACHE_MS).then(d => d.length, (err: unknown) => String((err as any)?.reason ?? (err as any)?.message ?? err)),
        timeout,
      ]);
      clearTimeout(timer);
    }
    return {
      cached: !!this.cache,
      reads: this.reads,
      lastError: this.lastError,
      apiKey: this.key.has(),
      dashboards,
      requests: this.activeRequests().map(r => ({ type: r.type, seconds: Math.round((r.until - Date.now()) / 1000) })),
    };
  }

  /** Every dashboard, through the API key. A read (or one on its way) is shared while it's at most `maxAge` old. */
  private read(maxAge: number): Promise<any[]> {
    if (this.cache && Date.now() - this.cache.at < maxAge) return this.cache.dashboards;
    const dashboards = this.key.run(api => api.dashboards.getDashboards())
      .then((all: any) => {
        this.lastError = null;
        this.reads++;
        return Object.values(all ?? {}) as any[];
      })
      .catch((err: unknown) => {
        if (this.cache?.dashboards === dashboards) this.cache = null;
        this.lastError = String((err as any)?.reason ?? (err as any)?.message ?? err);
        throw err;
      });
    this.cache = { at: Date.now(), dashboards };
    return dashboards;
  }

}
