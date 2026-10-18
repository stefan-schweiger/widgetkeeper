import type Homey from 'homey';

/** Names that would reach (or read) `Object.prototype` as keys of a plain object: never a key in a stored setting. */
const RESERVED = new Set(['__proto__', 'constructor', 'prototype']);

export function isReservedKey(key: string): boolean {
  return RESERVED.has(key);
}

export type DebouncedSettingOptions = {
  homey: Homey.App['homey'],
  /** The app setting. */
  setting: string,
  /** How long after the first change it's written, so a burst of changes is one write. */
  delay: number,
  /** What to write, read when it's written. */
  value: () => unknown,
  log: (...args: any[]) => void,
  /** For the log line of a failed write: `Could not save <what>:`. */
  what: string,
};

/**
 * An app setting written a while after a change (`schedule()`). `flush()` writes a pending change at once: call it in
 * the service's `stop()`, or an app restart loses what changed since the last write.
 */
export class DebouncedSetting {

  private timer: NodeJS.Timeout | null = null;

  constructor(private opts: DebouncedSettingOptions) {}

  schedule() {
    if (this.timer) return;
    this.timer = this.opts.homey.setTimeout(() => {
      this.timer = null;
      this.write();
    }, this.opts.delay);
  }

  flush() {
    if (!this.timer) return;
    this.opts.homey.clearTimeout(this.timer);
    this.timer = null;
    this.write();
  }

  private write() {
    try {
      this.opts.homey.settings.set(this.opts.setting, this.opts.value());
    } catch (err) {
      this.opts.log(`Could not save ${this.opts.what}:`, err);
    }
  }

}
