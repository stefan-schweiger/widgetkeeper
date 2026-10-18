import type Homey from 'homey';
import { matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { localHour } from './heatmap.js';
import { DebouncedSetting, isReservedKey } from './storedSetting.js';

const SECOND = 1e3;
const MINUTE = 60 * SECOND;
export const DAY = 24 * 60 * MINUTE;
/** Overdue is checked this often (a timeout can't wait longer than about 24.8 days). */
const TICK = MINUTE;
const SAVE_DELAY = 2 * SECOND;
/** How long a widget's reset can be undone: it offers Undo for 5 s, the rest is for a slow request. */
const UNDO_KEEP = 60 * SECOND;
/** A counter a widget shows is marked as seen (for the oldest-first limit) in the saved setting at most this often. */
const SEEN_SAVE = 60 * MINUTE;
const MAX_NAME = 60;
const MAX_COUNTERS = 50;
/** The longest interval and the furthest back a Flow can set a counter, in days (10 years). */
export const MAX_DAYS = 3650;
/** The most counters a widget shows. */
export const MAX_WIDGET_COUNTERS = 8;

export const DAYS_SINCE_SETTING = 'daysSince';
export const DAYS_SINCE_STATE_EVENT = 'dayssince:state';
export const DAYS_SINCE_RESET_CARD = 'dayssince_reset';
export const DAYS_SINCE_SET_CARD = 'dayssince_set';
export const DAYS_SINCE_OVERDUE_CARD = 'dayssince_overdue';
export const DAYS_SINCE_IS_OVERDUE_CARD = 'dayssince_is_overdue';
/** The id of the Flow cards' "Any counter" item (it's recognised by `any`, the id only has to differ from a name). */
const ANY_ID = 'dayssince:any';

export type Counter = {
  /** As a widget's setting (or a Flow) last spelled it. */
  name: string,
  /** The last reset (ms), or null while it was never reset. */
  resetAt: number | null,
  /** Days after the reset it turns amber and red, as the widget that last showed it set them; null = off. */
  amber: number | null,
  red: number | null,
  /** Red at the last check: the trigger fires when this turns true, so a restart doesn't fire it again. */
  overdue: boolean,
  /** The last reset, change or widget showing it (ms): the oldest go first past MAX_COUNTERS. */
  updatedAt: number,
};

/** What `/state`, `/reset`, `/undo` and the realtime event carry for a counter. */
export type CounterEntry = { key: string, name: string, resetAt: number | null, amber: number | null, red: number | null };

/** A widget's counter: its name and intervals (days). */
export type CounterDef = { name: string, amber?: unknown, red?: unknown };

/** A Flow card's counter argument: the autocomplete item Homey kept. */
export type CounterArg = { name?: string, id?: string, any?: boolean } | null | undefined;

/** What the trigger *… became overdue* gets: the counter and its calendar days since the reset. */
export type OverdueCounter = { key: string, name: string, days: number };

/** A counter's key: its name trimmed and lower-cased, so `Plants` and ` plants` are one counter; null without a name. */
export function counterKey(name: unknown): string | null {
  const n = typeof name === 'string' ? name.trim() : '';
  if (!n) return null;
  const key = n.toLowerCase().slice(0, MAX_NAME);
  return isReservedKey(key) ? null : key;
}

/** An interval in days: a positive number up to MAX_DAYS, else null (off). */
export function intervalDays(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.min(value, MAX_DAYS) : null;
}

/** The calendar days from `from` to `to` in `timeZone`: 0 the same day, 1 the next, also across DST. */
export function calendarDays(from: number, to: number, timeZone: string): number {
  const day = (t: number) => {
    const [y, m, d] = localHour(t, timeZone).date.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / DAY;
  };
  return Math.round(day(to) - day(from));
}

/** Whether the counter is red at `now`: `red` days (of 24 h) after its reset. */
export function isOverdueAt(c: Pick<Counter, 'resetAt' | 'red'>, now: number): boolean {
  return c.red != null && c.resetAt != null && now >= c.resetAt + c.red * DAY;
}

function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME);
}

function parseCounter(c: any): Counter | null {
  if (!c || typeof c !== 'object' || typeof c.name !== 'string' || !c.name.trim()) return null;
  return {
    name: cleanName(c.name),
    resetAt: typeof c.resetAt === 'number' && Number.isFinite(c.resetAt) ? c.resetAt : null,
    amber: intervalDays(c.amber),
    red: intervalDays(c.red),
    overdue: c.overdue === true,
    updatedAt: typeof c.updatedAt === 'number' ? c.updatedAt : 0,
  };
}

/**
 * The Days Since widget's counters: the time since something was last done (plants watered, a filter changed), shared
 * by name, so every widget and Flow card with that name has the same counter. Each turns amber, then red, the given
 * number of days after its reset; the Flow card *… became overdue* fires when one turns red, even with no dashboard
 * open. Kept in the app setting `daysSince` across restarts.
 */
export default class DaysSinceService {

  private counters = new Map<string, Counter>();
  /** The last widget reset of each counter, while it can be undone. */
  private undos = new Map<string, { at: number, previous: { resetAt: number | null, overdue: boolean }, until: number }>();
  private tickTimer: NodeJS.Timeout | null = null;
  private saved: DebouncedSetting;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    /** Fires the trigger card; app.ts passes the card's. */
    private onOverdue: (counter: OverdueCounter) => Promise<unknown> | void = () => {},
  ) {
    this.saved = new DebouncedSetting({
      homey, setting: DAYS_SINCE_SETTING, delay: SAVE_DELAY, value: () => Object.fromEntries(this.counters), log, what: 'the Days Since counters',
    });
  }

  /** Loads the saved counters; one that turned red while the app was stopped fires now. */
  start() {
    const saved = this.homey.settings.get(DAYS_SINCE_SETTING);
    if (saved && typeof saved === 'object') {
      for (const [key, value] of Object.entries(saved as Record<string, unknown>)) {
        const counter = parseCounter(value);
        if (counter && counterKey(counter.name) === key) this.counters.set(key, counter);
      }
    }
    this.tick();
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    this.tickTimer = null;
    this.saved.flush();
  }

  /**
   * A widget's counters (`/state`): each is created when it's new, takes the widget's intervals when it sends them (at
   * a widget's first load: the last widget to load wins, for the Flow cards; a counter in two slots takes the first's)
   * and is answered in the order asked, with the Homey's clock. A refresh sends only the names, so two widgets that
   * disagree don't take turns, each turn firing the overdue trigger again.
   */
  sync(defs: CounterDef[]): { now: number, counters: CounterEntry[] } {
    const now = Date.now();
    const out: CounterEntry[] = [];
    const seen = new Set<string>();
    for (const def of defs) {
      const key = counterKey(def.name);
      if (!key) continue;
      const name = cleanName(def.name);
      const intervals = !seen.has(key) && (def.amber !== undefined || def.red !== undefined)
        ? { amber: intervalDays(def.amber), red: intervalDays(def.red) }
        : null;
      seen.add(key);
      let c = this.counters.get(key);
      if (!c) {
        c = { name, resetAt: null, amber: intervals?.amber ?? null, red: intervals?.red ?? null, overdue: false, updatedAt: now };
        this.counters.set(key, c);
        this.debug(`Days Since: new counter ${name}`);
        this.changed(key, c);
      } else if (c.name !== name || (intervals && (c.amber !== intervals.amber || c.red !== intervals.red))) {
        Object.assign(c, { name, ...intervals, updatedAt: now });
        this.evaluate(key, c, now);
        this.changed(key, c);
      } else if (now - c.updatedAt > SEEN_SAVE) {
        c.updatedAt = now;
        this.saved.schedule();
      }
      out.push(this.entry(key, c));
    }
    this.prune();
    return { now, counters: out };
  }

  /**
   * Starts a counter again from now (a tap on its tile, or the Flow card *Reset …*). A widget's reset (`undoable`) can
   * be undone for a minute. A counter nothing has shown yet is created.
   */
  reset(name: unknown, undoable = false): { now: number, counter: CounterEntry } {
    const key = this.keyOf(name);
    const now = Date.now();
    const c = this.counterFor(key, name as string, now);
    const previous = { resetAt: c.resetAt, overdue: c.overdue };
    c.resetAt = now;
    c.updatedAt = now;
    this.evaluate(key, c, now);
    if (undoable) this.undos.set(key, { at: now, previous, until: now + UNDO_KEEP });
    else this.undos.delete(key);
    this.debug(`Days Since: ${c.name} reset${undoable ? '' : ' by a Flow'}`);
    this.changed(key, c);
    return { now, counter: this.entry(key, c) };
  }

  /**
   * Undoes a widget's reset: `at` is the `resetAt` its `/reset` answered. Only while it's the counter's last reset
   * (a Flow's reset since stays) and within a minute; the counter is overdue again if it was, without firing again.
   */
  undo(name: unknown, at: unknown): { now: number, undone: boolean, counter: CounterEntry | null } {
    const key = this.keyOf(name);
    const now = Date.now();
    const c = this.counters.get(key);
    const u = this.undos.get(key);
    if (!c || !u || u.at !== at || c.resetAt !== at || now > u.until) {
      return { now, undone: false, counter: c ? this.entry(key, c) : null };
    }
    this.undos.delete(key);
    c.resetAt = u.previous.resetAt;
    c.overdue = u.previous.overdue;
    c.updatedAt = now;
    this.debug(`Days Since: ${c.name} reset undone`);
    this.changed(key, c);
    return { now, undone: true, counter: this.entry(key, c) };
  }

  /** The Flow card *Set … to … days ago*: as if it was reset that long ago (for what was done before the widget). */
  setDaysAgo(name: unknown, days: unknown): CounterEntry {
    if (typeof days !== 'number' || !Number.isFinite(days) || days < 0 || days > MAX_DAYS) {
      throw new Error(`Invalid days ${JSON.stringify(days)}`);
    }
    const key = this.keyOf(name);
    const now = Date.now();
    const c = this.counterFor(key, name as string, now);
    c.resetAt = now - Math.round(days * DAY);
    c.updatedAt = now;
    this.undos.delete(key);
    this.evaluate(key, c, now);
    this.debug(`Days Since: ${c.name} set to ${days} days ago`);
    this.changed(key, c);
    return this.entry(key, c);
  }

  /** The condition card: whether the counter (or with "Any counter", any) is red now. */
  isOverdue(arg: CounterArg): boolean {
    const now = Date.now();
    if (arg?.any) return [...this.counters.values()].some(c => isOverdueAt(c, now));
    const key = counterKey(arg?.id ?? arg?.name);
    const c = key ? this.counters.get(key) : undefined;
    return c ? isOverdueAt(c, now) : false;
  }

  /** The trigger card's filter: whether its argument is the counter that turned red (or "Any counter"). */
  matches(arg: CounterArg, key: unknown): boolean {
    if (arg?.any) return true;
    return typeof key === 'string' && counterKey(arg?.id ?? arg?.name) === key;
  }

  /** The name a Flow card's argument stands for; "Any counter" isn't one (it's only for the trigger and the condition). */
  argName(arg: CounterArg): string | undefined {
    if (arg?.any) throw new Error('Pick a counter');
    return arg?.id ?? arg?.name;
  }

  /**
   * The counters by name for an autocomplete (described by their days, or *Not started*), with what's typed as a new
   * counter (`create`), *Any counter* (`any`, for the trigger and the condition) and *None* first (`none`, a widget slot).
   */
  listCounters(query: string, { none = false, create = false, any = false } = {}): (AutocompleteItem & { any?: boolean })[] {
    const q = (query || '').trim().slice(0, MAX_NAME);
    const now = Date.now();
    const items: (AutocompleteItem & { any?: boolean })[] = [...this.counters.values()]
      .filter(c => matches(q, c.name))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(c => ({ name: c.name, id: c.name, description: this.describeDays(c, now) }));
    const typed = counterKey(q);
    if (create && typed && !this.counters.has(typed)) {
      items.push({ name: q, id: q, description: this.homey.__('dayssince.newCounter') || 'New counter' });
    }
    const anyName = this.homey.__('dayssince.anyCounter') || 'Any counter';
    if (any && matches(q, anyName)) items.unshift({ name: anyName, id: ANY_ID, any: true });
    return none ? withNone(this.homey.__('values.none') || 'None', q, items) : items;
  }

  /** For the diagnostics report: counts only, never names. */
  describe() {
    const all = [...this.counters.values()];
    return {
      counters: all.length,
      started: all.filter(c => c.resetAt != null).length,
      withRed: all.filter(c => c.red != null).length,
      overdue: all.filter(c => c.overdue).length,
    };
  }

  // ---------------------------------------------------------------- internals

  private keyOf(name: unknown): string {
    const key = counterKey(name);
    if (!key) throw new Error('Missing counter');
    return key;
  }

  private counterFor(key: string, name: string, now: number): Counter {
    let c = this.counters.get(key);
    if (!c) {
      c = { name: cleanName(name), resetAt: null, amber: null, red: null, overdue: false, updatedAt: now };
      this.counters.set(key, c);
      this.prune();
    }
    return c;
  }

  private entry(key: string, c: Counter): CounterEntry {
    return { key, name: c.name, resetAt: c.resetAt, amber: c.amber, red: c.red };
  }

  /** `6 days` (calendar days in Homey's timezone and language), `Today`, or *Not started*. */
  private describeDays(c: Counter, now: number): string {
    if (c.resetAt == null) return this.homey.__('dayssince.notStarted') || 'Not started';
    const days = calendarDays(c.resetAt, now, this.homey.clock.getTimezone());
    if (days <= 0) return this.homey.__('dayssince.today') || 'Today';
    try {
      return new Intl.NumberFormat(this.homey.i18n.getLanguage(), { style: 'unit', unit: 'day', unitDisplay: 'long' }).format(days);
    } catch (err) {
      return `${days} d`;
    }
  }

  /** Updates the overdue flag; firing the trigger when it turns red. */
  private evaluate(key: string, c: Counter, now: number) {
    const overdue = isOverdueAt(c, now);
    if (overdue === c.overdue) return;
    c.overdue = overdue;
    this.saved.schedule();
    if (!overdue) return;
    const counter: OverdueCounter = { key, name: c.name, days: calendarDays(c.resetAt!, now, this.homey.clock.getTimezone()) };
    this.debug(`Days Since: ${c.name} is overdue (${counter.days} days)`);
    Promise.resolve()
      .then(() => this.onOverdue(counter))
      .catch(err => this.log('Days Since Flow card failed:', err));
  }

  private tick() {
    const now = Date.now();
    for (const [key, c] of this.counters) this.evaluate(key, c, now);
    for (const [key, u] of this.undos) if (now > u.until) this.undos.delete(key);
  }

  /** The oldest counters go when there are too many. */
  private prune() {
    if (this.counters.size <= MAX_COUNTERS) return;
    const oldest = [...this.counters.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    for (const [key] of oldest.slice(0, this.counters.size - MAX_COUNTERS)) {
      this.counters.delete(key);
      this.undos.delete(key);
    }
    this.saved.schedule();
  }

  /** Sends the counter to the widgets showing it and saves (debounced). */
  private changed(key: string, c: Counter) {
    this.homey.api.realtime(DAYS_SINCE_STATE_EVENT, this.entry(key, c));
    this.saved.schedule();
  }

}
