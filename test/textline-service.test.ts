import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeApi, fakeHomey } from './helpers/fakeHomey.js';
import TextLineService, { boardKey, TEXT_LINES_SETTING, TEXTLINE_STATE_EVENT } from '../lib/TextLineService.js';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-15T12:00:00Z')); });
afterEach(() => { vi.useRealTimers(); });

function setup() {
  const homey = fakeHomey(fakeApi());
  const service = new TextLineService(homey as any, () => {});
  return { homey, service };
}

describe('boardKey', () => {
  it('trims and lower-cases, with Note for no name', () => {
    expect(boardKey(' Kitchen ')).toBe('kitchen');
    expect(boardKey('')).toBe('note');
    expect(boardKey(undefined)).toBe('note');
    expect(boardKey('__proto__')).toBe('');
    expect(boardKey(' Constructor ')).toBe('');
  });
});

describe('set and clear (the Flow cards)', () => {
  it('stores the text, sends it over realtime and serves it', () => {
    const { service, homey } = setup();
    service.set('Kitchen', 'Dinner at 6');
    const entry = { key: 'kitchen', name: 'Kitchen', text: 'Dinner at 6', color: null, updatedAt: Date.now() };
    expect(homey.api.realtime).toHaveBeenCalledWith(TEXTLINE_STATE_EVENT, entry);
    expect(service.get(' kitchen')).toEqual(entry);
  });

  it('keeps the colour, and default removes it', () => {
    const { service } = setup();
    service.set('Kitchen', 'Dryer done', 'red');
    expect(service.get('Kitchen').color).toBe('red');
    service.set('Kitchen', 'Dryer done');
    expect(service.get('Kitchen').color).toBeNull();
    expect(() => service.set('Kitchen', 'x', 'pink')).toThrow();
  });

  it('survives a restart', () => {
    const { service, homey } = setup();
    service.set('Kitchen', 'Buy milk');
    expect(new TextLineService(homey as any, () => {}).get('Kitchen').text).toBe('Buy milk');
  });

  it('forgets a cleared board', () => {
    const { service, homey } = setup();
    service.set('Kitchen', 'Buy milk', 'green');
    service.clear('Kitchen');
    expect(homey.settings.get(TEXT_LINES_SETTING)).toEqual({});
    expect(homey.api.realtime).toHaveBeenLastCalledWith(TEXTLINE_STATE_EVENT,
      { key: 'kitchen', name: 'Kitchen', text: '', color: null, updatedAt: Date.now() });
    expect(service.get('Kitchen')).toEqual({ key: 'kitchen', name: 'Kitchen', text: '', color: null, updatedAt: 0 });
  });

  it('cuts long texts and keeps at most 50 boards, dropping the oldest', () => {
    const { service } = setup();
    service.set('Long', 'x'.repeat(600));
    expect(service.get('Long').text).toHaveLength(500);
    for (let i = 0; i < 55; i++) {
      vi.advanceTimersByTime(1000);
      service.set(`Board ${i}`, 'hi');
    }
    expect(service.describe().boards).toBe(50);
    expect(service.get('Long').text).toBe('');
    expect(service.get('Board 54').text).toBe('hi');
  });
});

describe('listBoards', () => {
  it('lists Note, the notes with a text and what is typed', () => {
    const { service } = setup();
    service.set('Kitchen', 'Buy milk');
    expect(service.listBoards('').map(i => i.id)).toEqual(['Kitchen', 'Note']);
    expect(service.listBoards('kit').map(i => i.id)).toEqual(['Kitchen', 'kit']);
    expect(service.listBoards('Garage ').map(i => i.id)).toEqual(['Garage']);
    expect(service.listBoards('Garage').at(-1)!.description).toBe('New note');
  });

  it('never counts the diagnostics text', () => {
    const { service } = setup();
    service.set('Kitchen', 'Secret', 'blue');
    expect(JSON.stringify(service.describe())).not.toContain('Secret');
    expect(service.describe()).toEqual({ boards: 1, coloured: 1 });
  });
});
