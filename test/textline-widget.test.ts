// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { FLOW_ICON_PATHS } from '../lib/FlowService.js';
import { boardKey } from '../lib/TextLineService.js';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('textline'); });
afterEach(() => { document.body.innerHTML = ''; });

const board = (text: string, color: string | null = null) => ({ key: 'note', name: 'Note', text, color, updatedAt: 1 });

function widget(opts: object = {}, state: any = { language: 'en', board: board('Dinner at 6'), variable: null }) {
  const root = document.createElement('div');
  document.body.append(root);
  // A Flow's note unless a test says otherwise (the widget's own default is the typed message).
  const w = win.createTextLineWidget(root, { reducedMotion: true, source: 'flow', ...opts });
  if (state) w.setState(state);
  const text = () => root.querySelector('.tl-text')!.textContent;
  const box = () => root.querySelector<HTMLElement>('.tl-tile, .tl-note')!;
  return { w, root, text, box };
}

describe('text', () => {
  it('shows the typed message, or asks for one', () => {
    const typed = widget({ source: 'typed', message: '  Back at 5  ' }, null);
    expect(typed.text()).toBe('Back at 5');
    expect(typed.root.classList.contains('muted')).toBe(false);
    const none = widget({ source: undefined, message: ' ' }, null);
    expect(none.text()).toBe('Type your note in the widget settings.');
    expect(none.root.classList.contains('muted')).toBe(true);
  });

  it("keeps a typed message's line breaks for the note", () => {
    expect(widget({ source: 'typed', style: 'postit', message: 'Milk\nEggs' }, null).text()).toBe('Milk\nEggs');
  });

  it("shows the note's text, and the typed message or a muted No message without one", () => {
    expect(widget().text()).toBe('Dinner at 6');
    const empty = widget({}, { board: board('') });
    expect(empty.text()).toBe('No message');
    expect(empty.root.classList.contains('muted')).toBe(true);
    const fixed = widget({ message: 'Back at 5' }, { board: board('  ') });
    expect(fixed.text()).toBe('Back at 5');
    expect(fixed.root.classList.contains('muted')).toBe(false);
  });

  it("follows a realtime entry", () => {
    const { w, text } = widget();
    w.setState({ board: board('Pizza in the oven') });
    expect(text()).toBe('Pizza in the oven');
  });

  it("shows a variable's value, a missing variable, or asks for one", () => {
    expect(widget({ source: 'variable' }, { variable: { id: 'v1', name: 'Note', type: 'string', value: 'Hi' } }).text()).toBe('Hi');
    expect(widget({ source: 'variable' }, { variable: { id: 'v1', missing: true } }).text()).toBe('Variable not found');
    expect(widget({ source: 'variable', variableChosen: false }, { variable: null }).text()).toBe('Pick a text variable in the widget settings.');
  });

  it('shows an error only when nothing has loaded', () => {
    const { w, text } = widget({}, null);
    w.setError('offline');
    expect(text()).toBe('offline');
    w.setState({ board: board('Hello') });
    w.setError('offline');
    expect(text()).toBe('Hello');
  });

  it('uses the strings Homey gives', () => {
    const t = (key: string) => (key === 'textline.noMessage' ? 'Ingen besked' : key);
    expect(widget({ t }, { board: null }).text()).toBe('Ingen besked');
  });
});

describe('tile', () => {
  it("sets alignment, size, the icon and the setting's colour, a Flow's winning", () => {
    const { root, box, w } = widget({ align: 'center', size: 'large', icon: 'bell', color: 'blue' });
    expect(root.dataset).toMatchObject({ style: 'tile', align: 'center', size: 'large' });
    expect(root.querySelector('.tl-icon path')!.getAttribute('d')).toBe(win.TEXTLINE_ICON_PATHS.bell.d);
    expect(box().dataset.color).toBe('blue');
    w.setState({ board: board('Dryer done', 'red') });
    expect(box().dataset.color).toBe('red');
    w.setState({ board: board('Dryer done') });
    expect(box().dataset.color).toBe('blue');
  });

  it('falls back for unknown settings and has no colour by default', () => {
    const { root, box } = widget({ align: 'up', size: 'huge', icon: 'nope', color: 'pink' });
    expect(root.dataset).toMatchObject({ align: 'left', size: 'default' });
    expect(root.querySelector('.tl-icon')).toBeNull();
    expect(box().dataset.color).toBeUndefined();
  });

  it("doesn't scroll text that fits", () => {
    const { root } = widget({ overflow: 'scroll', reducedMotion: false });
    expect(root.querySelector('.tl-wrap')!.classList.contains('scrolling')).toBe(false);
  });

  it("copies Flow Buttons' icons", () => {
    expect(win.TEXTLINE_ICON_PATHS).toEqual(FLOW_ICON_PATHS);
  });
});

describe('Post-it', () => {
  it('is yellow paper by default, tilted the same way for the same widget', () => {
    const { root, box } = widget({ style: 'postit', seed: 'w1', icon: 'bell' });
    expect(root.dataset.style).toBe('postit');
    expect(box().dataset.color).toBe('yellow');
    expect(root.querySelector('.tl-paper .tl-text')).not.toBeNull();
    expect(root.querySelector('.tl-icon')).toBeNull(); // the tile's only
    expect(box().style.getPropertyValue('--tl-tilt')).toBe(`${win.textLineTilt('w1')}deg`);
  });

  it('tilts a little, one way or the other', () => {
    const tilts = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map(s => win.textLineTilt(s));
    for (const d of tilts) expect(Math.abs(d)).toBeGreaterThanOrEqual(2);
    for (const d of tilts) expect(Math.abs(d)).toBeLessThanOrEqual(3.5);
    expect(tilts.some(d => d > 0) && tilts.some(d => d < 0)).toBe(true);
  });

  it("takes a Flow's colour as its paper", () => {
    expect(widget({ style: 'postit' }, { board: board('Buy milk', 'green') }).box().dataset.color).toBe('green');
  });
});

it("finds a board by the service's key", () => {
  for (const name of ['Kitchen', ' kitchen ', '', 'Note', 'ÆBLE']) expect(win.textLineBoardKey(name)).toBe(boardKey(name));
});
