import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey, memoryStorage } from './helpers/fakeHomey.js';
import Secrets, { fileStorage, MOVED_MARK, MOVED_SETTINGS } from '../lib/secrets.js';

describe('secrets', () => {
  it('moves the key, the password hash and the sessions out of the app settings', () => {
    const homey = fakeHomey(fakeApi({}));
    homey.settings.set('variablesApiKey', 'the-key');
    homey.settings.set('webPassword', { salt: 'aa', hash: 'bb' });
    homey.settings.set('webSessions', [{ hash: 'cc', created: 1, used: 1 }]);
    homey.settings.set('webDashboardsEnabled', true);
    const storage = memoryStorage();
    const log = vi.fn();
    const secrets = new Secrets(homey, log, storage);
    expect(secrets.get('variablesApiKey')).toBe('the-key');
    expect(secrets.get('webPassword')).toEqual({ salt: 'aa', hash: 'bb' });
    expect(JSON.parse(storage.text!)).toMatchObject({ variablesApiKey: 'the-key', webSessions: [{ hash: 'cc' }] });
    for (const key of MOVED_SETTINGS) expect(homey.settings.get(key)).toBeNull();
    // Other settings stay where they are.
    expect(homey.settings.get('webDashboardsEnabled')).toBe(true);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Moved variablesApiKey, webPassword, webSessions/));
  });

  it('keeps what the file has over a setting written later, which is only unset', () => {
    const homey = fakeHomey(fakeApi({}));
    homey.settings.set('variablesApiKey', 'planted');
    const secrets = new Secrets(homey, vi.fn(), memoryStorage(JSON.stringify({ variablesApiKey: 'the-key' })));
    expect(secrets.get('variablesApiKey')).toBe('the-key');
    expect(homey.settings.get('variablesApiKey')).toBeNull();
  });

  it('moves once: a setting written after that is unset, never taken, even where the file has none', () => {
    const homey = fakeHomey(fakeApi({}));
    const storage = memoryStorage();
    new Secrets(homey, vi.fn(), storage);
    // A first start with nothing to move marks the file too.
    expect(JSON.parse(storage.text!)).toEqual({ [MOVED_MARK]: true });
    homey.settings.set('variablesApiKey', 'planted');
    homey.settings.set('webPassword', { salt: 'aa', hash: 'bb' });
    const log = vi.fn();
    const secrets = new Secrets(homey, log, storage);
    expect(secrets.get('variablesApiKey')).toBeNull();
    expect(secrets.get('webPassword')).toBeNull();
    expect(homey.settings.get('variablesApiKey')).toBeNull();
    expect(homey.settings.get('webPassword')).toBeNull();
    expect(JSON.parse(storage.text!)).toEqual({ [MOVED_MARK]: true });
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/Ignored and unset variablesApiKey, webPassword/));
  });

  it('leaves the settings when the file can\'t be written, so nothing is lost', () => {
    const homey = fakeHomey(fakeApi({}));
    homey.settings.set('variablesApiKey', 'the-key');
    const log = vi.fn();
    const secrets = new Secrets(homey, log, { read: () => null, write: () => { throw new Error('EROFS'); } });
    expect(secrets.get('variablesApiKey')).toBe('the-key');
    expect(homey.settings.get('variablesApiKey')).toBe('the-key');
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not be moved/), 'EROFS');
  });

  it('sets and unsets, and reads a broken file as empty', () => {
    const homey = fakeHomey(fakeApi({}));
    const log = vi.fn();
    const storage = memoryStorage('{not json');
    const secrets = new Secrets(homey, log, storage);
    expect(secrets.get('variablesApiKey')).toBeNull();
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/could not be read/), expect.any(String));
    // Not rewritten at start: nothing needed moving.
    expect(storage.text).toBe('{not json');
    secrets.set('variablesApiKey', 'k');
    expect(JSON.parse(storage.text!)).toEqual({ [MOVED_MARK]: true, variablesApiKey: 'k' });
    secrets.unset('variablesApiKey');
    expect(JSON.parse(storage.text!)).toEqual({ [MOVED_MARK]: true });
    expect(secrets.get('__proto__')).toBeNull();
  });

  it('after a broken file, the first save keeps the mark, so a setting written later is never taken', () => {
    const homey = fakeHomey(fakeApi({}));
    const storage = memoryStorage('{not json');
    new Secrets(homey, vi.fn(), storage).set('webSessions', []);
    homey.settings.set('webPassword', { salt: 'aa', hash: 'bb' });
    homey.settings.set('variablesApiKey', 'planted');
    const secrets = new Secrets(homey, vi.fn(), storage);
    expect(secrets.get('webPassword')).toBeNull();
    expect(secrets.get('variablesApiKey')).toBeNull();
    expect(homey.settings.get('webPassword')).toBeNull();
    expect(homey.settings.get('variablesApiKey')).toBeNull();
  });

  describe('the file', () => {
    let dir = '';
    afterEach(() => { if (dir) rmSync(dir, { recursive: true, force: true }); });

    it('is written whole through a temporary file, and read back', () => {
      dir = mkdtempSync(join(tmpdir(), 'wk-secrets-'));
      const file = join(dir, 'secrets.json');
      const storage = fileStorage(file);
      expect(storage.read()).toBeNull();
      storage.write('{"a":1}');
      expect(readFileSync(file, 'utf8')).toBe('{"a":1}');
      expect(storage.read()).toBe('{"a":1}');
      expect(readdirSync(dir)).toEqual(['secrets.json']);
    });
  });
});
