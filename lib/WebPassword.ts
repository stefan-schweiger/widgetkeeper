import { randomBytes, scrypt, timingSafeEqual, createHash } from 'node:crypto';
import type Homey from 'homey';

/** The app setting with the web dashboards' password: `{salt, hash}` (hex, scrypt), never the password itself. */
export const WEB_PASSWORD_SETTING = 'webPassword';
/** The app setting with the signed-in browsers: `[{hash, created, used}]`, a SHA-256 of each session token. */
export const WEB_SESSIONS_SETTING = 'webSessions';

export const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_SESSIONS = 50;
/** A browser that hasn't been used for this long has to sign in again. */
const SESSION_IDLE_MS = 180 * 24 * 3600e3;
/** `used` is saved at most this often. */
const SAVE_USED_MS = 3600e3;
/** After this many wrong passwords in a row, every login waits: 30 s, doubling to 15 min. */
const FREE_TRIES = 5;
const LOCK_MS = 30e3;
const MAX_LOCK_MS = 15 * 60e3;

type Session = { hash: string, created: number, used: number };
type Stored = { salt: string, hash: string };

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, 32, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

/**
 * The web dashboards' password (optional; the app settings page sets it): a second step after the personal API key.
 * While it's set, the web routes only answer a browser that also signed in with it: `login()` gives a session
 * token, which the page sends with every request (`?session=`). Wrong passwords lock the login for a while.
 */
export default class WebPassword {

  private failures = 0;
  private lockedUntil = 0;
  private sessions: Session[];

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void,
    private now: () => number = Date.now,
  ) {
    const saved = homey.settings.get(WEB_SESSIONS_SETTING);
    this.sessions = Array.isArray(saved) ? saved.filter(s => s && typeof s.hash === 'string') : [];
  }

  get isSet(): boolean {
    const stored = this.homey.settings.get(WEB_PASSWORD_SETTING) as Stored | null;
    return !!(stored && typeof stored.salt === 'string' && typeof stored.hash === 'string');
  }

  /** Sets the password (`''` removes it). Either way every browser signed in with the old one has to sign in again. */
  async setPassword(password: string): Promise<{ ok: true } | { ok: false, reason: 'tooShort' | 'tooLong' }> {
    if (password && password.length < MIN_PASSWORD) return { ok: false, reason: 'tooShort' };
    if (password.length > MAX_PASSWORD) return { ok: false, reason: 'tooLong' };
    if (!password) {
      this.homey.settings.unset(WEB_PASSWORD_SETTING);
    } else {
      const salt = randomBytes(16);
      const hash = await derive(password, salt);
      this.homey.settings.set(WEB_PASSWORD_SETTING, { salt: salt.toString('hex'), hash: hash.toString('hex') });
    }
    this.sessions = [];
    this.saveSessions();
    this.failures = 0;
    this.lockedUntil = 0;
    this.log(password ? 'Web dashboards: password set' : 'Web dashboards: password removed');
    return { ok: true };
  }

  /** Signs a browser in: a new session token for the right password. */
  async login(password: unknown): Promise<{ ok: true, token: string } | { ok: false, reason: 'notSet' | 'wrong' | 'locked', retryAfter?: number }> {
    const stored = this.homey.settings.get(WEB_PASSWORD_SETTING) as Stored | null;
    if (!stored || !this.isSet) return { ok: false, reason: 'notSet' };
    const now = this.now();
    if (now < this.lockedUntil) return { ok: false, reason: 'locked', retryAfter: Math.ceil((this.lockedUntil - now) / 1000) };
    const given = typeof password === 'string' && password.length <= MAX_PASSWORD ? password : '';
    const expected = Buffer.from(stored.hash, 'hex');
    const actual = await derive(given, Buffer.from(stored.salt, 'hex'));
    if (!given || actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      this.failures++;
      if (this.failures >= FREE_TRIES) {
        const wait = Math.min(LOCK_MS * 2 ** (this.failures - FREE_TRIES), MAX_LOCK_MS);
        this.lockedUntil = this.now() + wait;
        this.log(`Web dashboards: ${this.failures} wrong passwords in a row, login locked for ${wait / 1000} s`);
        return { ok: false, reason: 'locked', retryAfter: Math.ceil(wait / 1000) };
      }
      return { ok: false, reason: 'wrong' };
    }
    this.failures = 0;
    const token = randomBytes(32).toString('base64url');
    const at = this.now();
    this.sessions = this.sessions.filter(s => at - s.used < SESSION_IDLE_MS);
    this.sessions.push({ hash: sha256(token), created: at, used: at });
    this.sessions.sort((a, b) => b.used - a.used);
    this.sessions.length = Math.min(this.sessions.length, MAX_SESSIONS);
    this.saveSessions();
    return { ok: true, token };
  }

  /** Whether a session token is signed in (with the password still set). */
  check(token: unknown): boolean {
    if (typeof token !== 'string' || !token || !this.isSet) return false;
    const hash = sha256(token);
    const session = this.sessions.find(s => s.hash === hash);
    const now = this.now();
    if (!session || now - session.used >= SESSION_IDLE_MS) return false;
    if (now - session.used > SAVE_USED_MS) {
      session.used = now;
      this.saveSessions();
    }
    return true;
  }

  logout(token: unknown) {
    if (typeof token !== 'string') return;
    const hash = sha256(token);
    const before = this.sessions.length;
    this.sessions = this.sessions.filter(s => s.hash !== hash);
    if (this.sessions.length !== before) this.saveSessions();
  }

  private saveSessions() {
    this.homey.settings.set(WEB_SESSIONS_SETTING, this.sessions);
  }

  describe() {
    return { set: this.isSet, sessions: this.sessions.length, locked: this.now() < this.lockedUntil, failures: this.failures };
  }
}
