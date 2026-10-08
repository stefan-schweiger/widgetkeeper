import type Homey from 'homey';
import { HomeyAPI } from 'homey-api';

/**
 * The app setting with the user's personal API key. Homey gives an app's own token `homey.logic.readonly` and
 * `homey.flow.readonly`, but not `homey.logic` or `homey.flow.start` (checked on the Homey, 2026-10-07/08:
 * `Missing Scopes`), so changing a variable or starting a flow goes through a key the user makes.
 * The setting's name predates Flow Buttons; it's kept so saved keys still work.
 */
export const API_KEY_SETTING = 'variablesApiKey';

/** What the key is used for, and the scopes that allow it (an owner's key may list only `homey`, which covers all). */
const USES = {
  variables: ['homey.logic', 'homey'],
  flows: ['homey.flow.start', 'homey.flow', 'homey'],
} as const;

export type KeyUse = keyof typeof USES;

/** Why a write can't happen: no key, a key without the permission, or a key Homey doesn't accept. */
export type KeyProblem = 'noKey' | 'keyScope' | 'keyInvalid';

export class KeyError extends Error {
  constructor(public reason: KeyProblem, message?: string) {
    super(message ?? reason);
  }
}

export const isMissingScopes = (err: unknown) => /missing scopes/i.test(String((err as any)?.message ?? err));
/** A key revoked after it was saved: `createLocalAPI` only pings, so it's the write that finds out. */
export const isUnauthorized = (err: unknown) => (err as any)?.statusCode === 401
  || /invalid (session|token)|unauthori[sz]ed/i.test(String((err as any)?.message ?? err));

export type SaveResult = { ok: true, variables: boolean, flows: boolean } | { ok: false, reason: KeyProblem };

const shared = new WeakMap<object, PersonalApiKey>();

/**
 * The user's personal API key (Flow Variables and Flow Buttons): checked when saved, kept in the app settings,
 * never sent back or logged. The services share one instance (`PersonalApiKey.for(homey)`), so a save resets
 * the API they all use.
 */
export default class PersonalApiKey {

  /** The app's one instance. */
  static for(homey: Homey.App['homey'], log: (...args: any[]) => void): PersonalApiKey {
    let key = shared.get(homey);
    if (!key) {
      key = new PersonalApiKey(homey, log);
      shared.set(homey, key);
    }
    return key;
  }

  /** The API made with the key, rebuilt when the key changes. */
  private cached: { key: string, api: Promise<any> } | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void,
  ) {}

  /** Whether a key is saved. */
  has() {
    const key = this.homey.settings.get(API_KEY_SETTING);
    return typeof key === 'string' && key.length > 0;
  }

  /**
   * Checks a key and saves it (an empty key removes it). A key Homey doesn't accept, or one that may neither
   * change variables nor start flows, isn't saved. The result says what the saved key may do.
   */
  async save(key: string): Promise<SaveResult> {
    key = key.trim();
    if (!key) {
      this.homey.settings.unset(API_KEY_SETTING);
      this.cached = null;
      return { ok: true, variables: false, flows: false };
    }
    let scopes: string[] = [];
    try {
      const api = await this.create(key);
      scopes = (await api.sessions.getSessionMe())?.scopes ?? [];
    } catch (err) {
      this.log('The API key was not accepted:', String((err as any)?.message ?? err));
      return { ok: false, reason: 'keyInvalid' };
    }
    const may = (use: KeyUse) => scopes.some(sc => (USES[use] as readonly string[]).includes(sc));
    const variables = may('variables');
    const flows = may('flows');
    if (!variables && !flows) return { ok: false, reason: 'keyScope' };
    this.homey.settings.set(API_KEY_SETTING, key);
    this.cached = null;
    return { ok: true, variables, flows };
  }

  /**
   * Runs `fn` with the key's API. Homey's answers become a KeyError: `keyScope` for a key without the permission,
   * `keyInvalid` for a key it doesn't (or no longer) accept, which also drops the cached API.
   */
  async run<T>(fn: (api: any) => Promise<T>): Promise<T> {
    const api = await this.api();
    try {
      return await fn(api);
    } catch (err) {
      const message = String((err as any)?.message ?? err);
      if (isMissingScopes(err)) throw new KeyError('keyScope', message);
      if (isUnauthorized(err)) {
        if (this.cached?.key === this.homey.settings.get(API_KEY_SETTING)) this.cached = null;
        throw new KeyError('keyInvalid', message);
      }
      throw err;
    }
  }

  private api(): Promise<any> {
    const key = this.homey.settings.get(API_KEY_SETTING);
    if (typeof key !== 'string' || !key) return Promise.reject(new KeyError('noKey'));
    if (this.cached?.key !== key) {
      const api = this.create(key).catch(err => {
        if (this.cached?.api === api) this.cached = null;
        throw new KeyError('keyInvalid', String(err?.message ?? err));
      });
      this.cached = { key, api };
    }
    return this.cached.api;
  }

  private async create(token: string) {
    const address = await this.homey.api.getLocalUrl();
    return HomeyAPI.createLocalAPI({ address, token, debug: null });
  }

}
