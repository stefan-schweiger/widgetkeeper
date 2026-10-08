import type Homey from 'homey';

const SECOND = 1e3;
const MINUTE = 60 * SECOND;
const TICK = MINUTE;
/** A finished timer stays (ringing in the widget) until it's dismissed, or this long. */
const DONE_KEEP = 10 * MINUTE;
/** A timer that ran out while the app was stopped still fires its Flow card when it ended at most this long ago. */
const LATE_FIRE = 5 * MINUTE;
export const MAX_MINUTES = 24 * 60;
const SAVE_DELAY = 2 * SECOND;

export const TIMERS_SETTING = 'timers';
export const TIMERS_STATE_EVENT = 'timers:state';
export const TIMER_FINISHED_CARD = 'timers_finished';

export type Timer = {
  id: string,
  /** The preset's label, or empty (the widget then shows the duration). */
  label: string,
  /** The whole duration in ms, +1 min steps included (for the progress). */
  duration: number,
  /** When it runs out (ms); null while paused. */
  endsAt: number | null,
  /** What's left while paused (ms); null while running. */
  remaining: number | null,
  /** When it ran out (ms), or null. */
  doneAt: number | null,
};

export type TimerAction = 'pause' | 'resume' | 'add' | 'cancel' | 'dismiss';
export const TIMER_ACTIONS: TimerAction[] = ['pause', 'resume', 'add', 'cancel', 'dismiss'];

/** One widget's timer (a list of at most one), with the Homey's clock so the widget can correct its own. */
export type TimersState = { instance: string, timers: Timer[], now: number };

/**
 * The Timers widget: kitchen timers that run in the app, so every screen showing the dashboard sees the same
 * one, and the Flow card *A timer finished* fires even with no dashboard open. Each widget instance
 * (`Homey.getWidgetInstanceId()`) has at most one timer; they're kept in the app setting `timers` across restarts.
 */
export default class TimerService {

  private instances = new Map<string, Timer[]>();
  private timeouts = new Map<string, NodeJS.Timeout>();
  private tickTimer: NodeJS.Timeout | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private nextId = 1;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
    /** Fires the Flow card; app.ts passes the trigger card's. */
    private onFinished: (timer: Timer) => Promise<unknown> | void = () => {},
  ) {}

  /** Loads the saved timers: one that ran out while the app was stopped is finished now. */
  start() {
    const saved = this.homey.settings.get(TIMERS_SETTING);
    const now = Date.now();
    if (saved && typeof saved === 'object') {
      for (const [instance, list] of Object.entries(saved as Record<string, Timer[]>)) {
        if (!Array.isArray(list)) continue;
        const timers = list.filter(isTimer).map(t => ({ ...t, label: typeof t.label === 'string' ? t.label : '' }));
        if (timers.length) this.instances.set(instance, timers);
        for (const timer of timers) {
          if (timer.doneAt == null && timer.endsAt != null && timer.endsAt <= now) {
            this.finish(instance, timer, now - timer.endsAt <= LATE_FIRE);
          } else {
            this.schedule(instance, timer);
          }
        }
      }
    }
    this.tickTimer = this.homey.setInterval(() => this.tick(), TICK);
  }

  async stop() {
    if (this.tickTimer) this.homey.clearInterval(this.tickTimer);
    for (const t of this.timeouts.values()) this.homey.clearTimeout(t);
    this.timeouts.clear();
    if (this.saveTimer) {
      this.homey.clearTimeout(this.saveTimer);
      this.save();
    }
  }

  getState(instance: string): TimersState {
    return { instance, timers: (this.instances.get(instance) ?? []).map(t => ({ ...t })), now: Date.now() };
  }

  /**
   * Starts a timer of `minutes` (fractions allowed: 0.5 is 30 s). A widget has one timer at a time, so this
   * replaces the one it had (two screens starting one at once: the last start wins).
   */
  startTimer(instance: string, minutes: unknown, label: unknown): TimersState {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0 || minutes > MAX_MINUTES) {
      throw new Error(`Invalid minutes ${JSON.stringify(minutes)}`);
    }
    for (const old of this.instances.get(instance) ?? []) this.unschedule(old);
    const duration = Math.round(minutes * MINUTE);
    const timer: Timer = {
      id: `${Date.now().toString(36)}${(this.nextId++).toString(36)}`,
      label: typeof label === 'string' ? label.trim().slice(0, 40) : '',
      duration,
      endsAt: Date.now() + duration,
      remaining: null,
      doneAt: null,
    };
    this.instances.set(instance, [timer]);
    this.schedule(instance, timer);
    this.debug(`Timer ${timer.label || `${minutes} min`} started (${instance})`);
    return this.changed(instance);
  }

  /** Pauses, resumes, adds a minute to, cancels or dismisses (once it rang) one timer. */
  act(instance: string, id: string, action: TimerAction): TimersState {
    const timers = this.instances.get(instance) ?? [];
    const timer = timers.find(t => t.id === id);
    if (!timer) return this.getState(instance); // already gone (another screen cancelled it)
    const now = Date.now();
    switch (action) {
      case 'pause':
        if (timer.endsAt != null && timer.doneAt == null) {
          timer.remaining = Math.max(0, timer.endsAt - now);
          timer.endsAt = null;
        }
        break;
      case 'resume':
        if (timer.remaining != null) {
          timer.endsAt = now + timer.remaining;
          timer.remaining = null;
        }
        break;
      case 'add':
        if (timer.doneAt != null) break;
        timer.duration += MINUTE;
        if (timer.endsAt != null) timer.endsAt += MINUTE;
        if (timer.remaining != null) timer.remaining += MINUTE;
        break;
      case 'cancel':
      case 'dismiss':
        timers.splice(timers.indexOf(timer), 1);
        break;
      default:
        throw new Error(`Unknown action ${JSON.stringify(action)}`);
    }
    this.unschedule(timer);
    if (timers.includes(timer)) this.schedule(instance, timer);
    if (!timers.length) this.instances.delete(instance);
    return this.changed(instance);
  }

  /** For the diagnostics report: counts only, never labels. */
  describe() {
    let running = 0;
    let paused = 0;
    let done = 0;
    for (const timers of this.instances.values()) {
      for (const t of timers) {
        if (t.doneAt != null) done++;
        else if (t.endsAt == null) paused++;
        else running++;
      }
    }
    return { widgets: this.instances.size, running, paused, done };
  }

  // ---------------------------------------------------------------- internals

  private schedule(instance: string, timer: Timer) {
    if (timer.endsAt == null || timer.doneAt != null) return;
    // setTimeout counts in 32-bit ms (about 24.8 days); timers are at most a day.
    const ms = Math.max(0, timer.endsAt - Date.now());
    this.timeouts.set(timer.id, this.homey.setTimeout(() => {
      this.timeouts.delete(timer.id);
      this.finish(instance, timer, true);
    }, ms));
  }

  private unschedule(timer: Timer) {
    const t = this.timeouts.get(timer.id);
    if (t) this.homey.clearTimeout(t);
    this.timeouts.delete(timer.id);
  }

  private finish(instance: string, timer: Timer, fire: boolean) {
    timer.doneAt = timer.endsAt ?? Date.now();
    this.debug(`Timer ${timer.label || `${timer.duration / MINUTE} min`} finished (${instance})`);
    this.changed(instance);
    if (!fire) return;
    Promise.resolve()
      .then(() => this.onFinished({ ...timer }))
      .catch(err => this.log('Timer Flow card failed:', err));
  }

  /** Drops timers that rang more than DONE_KEEP ago. */
  private tick() {
    const now = Date.now();
    for (const [instance, timers] of [...this.instances]) {
      const keep = timers.filter(t => t.doneAt == null || now - t.doneAt < DONE_KEEP);
      if (keep.length === timers.length) continue;
      if (keep.length) this.instances.set(instance, keep);
      else this.instances.delete(instance);
      this.changed(instance);
    }
  }

  /** Sends the instance's timers to its widgets and saves them (debounced). */
  private changed(instance: string): TimersState {
    const state = this.getState(instance);
    this.homey.api.realtime(TIMERS_STATE_EVENT, state);
    if (!this.saveTimer) {
      this.saveTimer = this.homey.setTimeout(() => {
        this.saveTimer = null;
        this.save();
      }, SAVE_DELAY);
    }
    return state;
  }

  private save() {
    try {
      this.homey.settings.set(TIMERS_SETTING, Object.fromEntries(this.instances));
    } catch (err) {
      this.log('Could not save the timers:', err);
    }
  }

}

function isTimer(t: any): t is Timer {
  return t && typeof t.id === 'string' && typeof t.duration === 'number'
    && (typeof t.endsAt === 'number' || typeof t.remaining === 'number' || typeof t.doneAt === 'number');
}
