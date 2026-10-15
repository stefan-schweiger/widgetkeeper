// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('textline'); });
afterEach(() => { document.body.innerHTML = ''; });

/**
 * happy-dom has no layout, so the text's height is stubbed: `lines(px)` lines of handwriting at that font size,
 * cut to three while the CSS clamp holds (anything but `display: block`, which fitNote() sets while it measures).
 */
function note(message: string, lines: (px: number) => number) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createTextLineWidget(root, { reducedMotion: true, source: 'flow', style: 'postit' });
  const textEl = root.querySelector<HTMLElement>('.tl-text')!;
  const seen: string[] = [];
  Object.defineProperty(textEl, 'offsetHeight', {
    configurable: true,
    get() {
      const px = parseFloat(textEl.style.fontSize);
      const lifted = textEl.style.display === 'block';
      seen.push(lifted ? 'lifted' : 'clamped');
      const n = lifted ? lines(px) : Math.min(3, lines(px));
      return Math.round(n * px * 1.1);
    },
  });
  // The tilted note's bounding box is taller than the text (a 3° tilt adds ~12 px at 228 px wide): never measured.
  textEl.getBoundingClientRect = () => { throw new Error('measured the tilted box'); };
  w.setState({ board: { key: 'note', name: 'Note', text: message, color: null, updatedAt: 1 } });
  return { textEl, seen };
}

describe('Post-it fit', () => {
  it('shrinks the handwriting until a long note fits three lines', () => {
    // 5 lines at 30 px, 4 at 26 px, 3 at 22 px.
    const { textEl, seen } = note('A long shopping list', px => (px >= 30 ? 5 : px >= 26 ? 4 : 3));
    expect(textEl.style.fontSize).toBe('22px');
    expect(seen.every(s => s === 'lifted')).toBe(true);
  });

  it('keeps the largest size for a note that fits, and puts the clamp back', () => {
    const { textEl } = note('Milk', () => 1);
    expect(textEl.style.fontSize).toBe('30px');
    expect(textEl.style.display).toBe('');
    expect(textEl.style.overflow).toBe('');
  });

  it('stops at the smallest size when nothing fits', () => {
    const { textEl } = note('Far too long', () => 8);
    expect(textEl.style.fontSize).toBe('19px');
  });
});
