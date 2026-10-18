import type Homey from 'homey';
import { matches, type AutocompleteItem } from './autocomplete.js';
import { isReservedKey } from './storedSetting.js';
import { TILE_COLORS, type TileColor } from './ValueService.js';

export const TEXTLINE_STATE_EVENT = 'textline:state';
/** The app setting holding the boards' texts: `{ '<board key>': TextLine }`. */
export const TEXT_LINES_SETTING = 'textLines';
export const TEXTLINE_SET_CARD = 'textline_set';
export const TEXTLINE_SET_COLOR_CARD = 'textline_set_color';
export const TEXTLINE_CLEAR_CARD = 'textline_clear';
/** The board a widget shows unless its `board` setting names another. */
export const DEFAULT_BOARD = 'Note';

const MAX_TEXT = 500;
const MAX_NAME = 60;
const MAX_BOARDS = 50;

export type TextLine = { name: string, text: string, color: TileColor | null, updatedAt: number };

/** What `/state` and the realtime event carry for a board. */
export type TextLineEntry = TextLine & { key: string };

/**
 * A note's key: its name trimmed and lower-cased, so `Kitchen` and ` kitchen` are one note. Empty is the default note;
 * a reserved name (`__proto__` …) has none, `''`.
 */
export function boardKey(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : '';
  const key = (n || DEFAULT_BOARD).toLowerCase().slice(0, MAX_NAME);
  return isReservedKey(key) ? '' : key;
}

/**
 * The Notes widget's named notes ("boards" in the code): texts that Flows write by a note's name (a Flow can't address
 * a widget instance), shown by every Notes widget with that name. Kept in an app setting, so they survive restarts.
 */
export default class TextLineService {

  constructor(
    private homey: Homey.App['homey'],
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  private boards(): Record<string, TextLine> {
    const v = this.homey.settings.get(TEXT_LINES_SETTING);
    return v && typeof v === 'object' ? v : {};
  }

  /** A board's text, or an empty one for a board nothing has set. */
  get(board: unknown): TextLineEntry {
    const key = boardKey(board);
    const line = key ? this.boards()[key] : undefined;
    if (line) return { key, ...line };
    const name = typeof board === 'string' && board.trim() ? board.trim().slice(0, MAX_NAME) : DEFAULT_BOARD;
    return { key, name, text: '', color: null, updatedAt: 0 };
  }

  /**
   * The Flow cards "Set the text of … to …" (`color` `default`, the widget's own) and "Clear the text of …" (`''`).
   * Text past 500 characters is cut. A board that's cleared is forgotten.
   */
  set(board: unknown, text: unknown, color: string = 'default') {
    const next = color === 'default' ? null : (TILE_COLORS as readonly string[]).includes(color) ? color as TileColor : undefined;
    if (next === undefined) throw new Error(`Unknown colour: ${color}`);
    const key = boardKey(board);
    if (!key) throw new Error(`Not a note name: ${String(board)}`);
    const name = typeof board === 'string' && board.trim() ? board.trim().slice(0, MAX_NAME) : DEFAULT_BOARD;
    const value = String(text ?? '').slice(0, MAX_TEXT);
    const boards = { ...this.boards() };
    const entry: TextLineEntry = { key, name, text: value, color: value ? next : null, updatedAt: Date.now() };
    const prev = Object.prototype.hasOwnProperty.call(boards, key) ? boards[key] : null;
    if (prev ? prev.text === value && prev.color === entry.color && prev.name === name : !value) return; // as it is
    if (value) {
      boards[key] = { name, text: value, color: entry.color, updatedAt: entry.updatedAt };
      // The oldest boards go first when there are too many.
      const keys = Object.keys(boards).sort((a, b) => boards[a].updatedAt - boards[b].updatedAt);
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_BOARDS))) delete boards[k];
    } else {
      delete boards[key];
    }
    this.homey.settings.set(TEXT_LINES_SETTING, boards);
    this.homey.api.realtime(TEXTLINE_STATE_EVENT, entry);
    this.debug(`Note ${name}: ${value ? `${value.length} characters${entry.color ? `, ${entry.color}` : ''}` : 'cleared'}`);
  }

  clear(board: unknown) {
    this.set(board, '');
  }

  /**
   * The Flow cards' note argument: the notes that have a text, `Note` (the default), and what's typed as a new note.
   */
  listBoards(query: string): AutocompleteItem[] {
    const q = (query || '').trim().slice(0, MAX_NAME);
    const boards = this.boards();
    const names = new Map<string, string>([[boardKey(DEFAULT_BOARD), DEFAULT_BOARD]]);
    for (const [key, line] of Object.entries(boards)) names.set(key, line.name);
    const items: AutocompleteItem[] = [...names.entries()]
      .filter(([, name]) => matches(q, name))
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([key, name]) => ({
        name,
        id: name,
        description: boards[key] ? this.homey.__('textline.boardInUse') || 'Has a text' : undefined,
      }));
    if (q && !names.has(boardKey(q))) {
      items.push({ name: q, id: q, description: this.homey.__('textline.boardNew') || 'New note' });
    }
    return items;
  }

  /** For the diagnostics report: counts only, never the texts. */
  describe() {
    const boards = Object.values(this.boards());
    return { boards: boards.length, coloured: boards.filter(b => b.color).length };
  }

}
