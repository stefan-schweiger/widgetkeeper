import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import type Homey from 'homey';

/**
 * Where the secrets live: the app's own `/userdata` folder. App settings won't do: Homey's API hands them to any
 * session with `homey.app.control` (`getAppSettings`, `setAppSetting`), the *Apps → Control* box of a personal API key,
 * so such a key could have read the stored key or cleared the web password. No API serves `/userdata`.
 */
export const SECRETS_FILE = '/userdata/secrets.json';

/** The app settings that held secrets before they moved here: moved over once, then unset. */
export const MOVED_SETTINGS = ['variablesApiKey', 'webPassword', 'webSessions'] as const;

/** How the secrets are read and written: the file on the Homey, memory in the tests. */
export type SecretStorage = { read(): string | null, write(text: string): void };

export function fileStorage(file: string): SecretStorage {
  return {
    read() {
      try {
        return readFileSync(file, 'utf8');
      } catch (err) {
        if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
        throw err;
      }
    },
    write(text) {
      // A new file, then a rename: a crash mid-write never leaves half a file.
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
      renameSync(tmp, file);
    },
  };
}

const shared = new WeakMap<object, Secrets>();

/**
 * The app's secrets (the personal API key, the web dashboards' password hash and sessions), one JSON object kept in
 * memory and written whole on every change. Read and written synchronously, like `homey.settings`.
 */
export default class Secrets {

  /** The app's one instance; the first call picks the storage (the tests pass memory). */
  static for(homey: Homey.App['homey'], log: (...args: any[]) => void = () => {}, storage?: SecretStorage): Secrets {
    let secrets = shared.get(homey);
    if (!secrets) {
      secrets = new Secrets(homey, log, storage ?? fileStorage(SECRETS_FILE));
      shared.set(homey, secrets);
    }
    return secrets;
  }

  private values: Record<string, unknown> = {};

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void,
    private storage: SecretStorage,
  ) {
    try {
      const parsed = JSON.parse(storage.read() ?? '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) this.values = parsed;
    } catch (err) {
      this.log('The secrets file could not be read:', String((err as any)?.message ?? err));
    }
    this.moveSettings();
  }

  get(key: string): unknown {
    return Object.prototype.hasOwnProperty.call(this.values, key) ? this.values[key] : null;
  }

  set(key: string, value: unknown) {
    this.values[key] = JSON.parse(JSON.stringify(value));
    this.save();
  }

  unset(key: string) {
    if (!Object.prototype.hasOwnProperty.call(this.values, key)) return;
    delete this.values[key];
    this.save();
  }

  private save() {
    this.storage.write(JSON.stringify(this.values));
  }

  /**
   * Moves what older versions kept in the app settings. A setting is unset only once the file holds it, so a failed
   * write loses nothing. One the file already has (from an earlier move) is just unset.
   */
  private moveSettings() {
    const found = MOVED_SETTINGS.filter(key => this.homey.settings.get(key) !== null && this.homey.settings.get(key) !== undefined);
    if (!found.length) return;
    let changed = false;
    for (const key of found) {
      if (Object.prototype.hasOwnProperty.call(this.values, key)) continue;
      this.values[key] = this.homey.settings.get(key);
      changed = true;
    }
    try {
      if (changed) this.save();
    } catch (err) {
      this.log('The secrets could not be moved out of the app settings:', String((err as any)?.message ?? err));
      return;
    }
    for (const key of found) this.homey.settings.unset(key);
    this.log(`Moved ${found.join(', ')} out of the app settings`);
  }
}
