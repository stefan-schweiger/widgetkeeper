// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { loadMount, loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('spacer'); loadMount('spacer'); });
afterEach(() => { document.body.innerHTML = ''; });

describe('spacerHeight', () => {
  it('takes whole px within 0–800', () => {
    expect(win.spacerHeight(48)).toBe(48);
    expect(win.spacerHeight(0)).toBe(0);
    expect(win.spacerHeight(12.6)).toBe(13);
    expect(win.spacerHeight(-5)).toBe(0);
    expect(win.spacerHeight(5000)).toBe(800);
    expect(win.spacerHeight('24')).toBe(24);
  });

  it('falls back to 32 for anything that is not a number', () => {
    for (const v of [undefined, null, '', ' ', 'abc', NaN, Infinity, {}, true]) expect(win.spacerHeight(v)).toBe(32);
  });
});

describe('Spacer widget', () => {
  function mount(settings: object | null) {
    const root = document.createElement('div');
    document.body.append(root);
    const Homey = { getSettings: () => settings, ready: vi.fn(), api: vi.fn(), on: vi.fn() };
    win.mountSpacerWidget(Homey, { root, frame: document.body });
    return { Homey, box: root.querySelector<HTMLElement>('.sp')! };
  }

  it('is an empty box of the set height, and tells Homey that height', () => {
    const { Homey, box } = mount({ height: 120 });
    expect(box.style.height).toBe('120px');
    expect(box.childElementCount).toBe(0);
    expect(box.textContent).toBe('');
    expect(Homey.ready).toHaveBeenCalledWith({ height: 120 });
    expect(Homey.api).not.toHaveBeenCalled();
  });

  it('takes 0, and the default without a setting', () => {
    expect(mount({ height: 0 }).Homey.ready).toHaveBeenCalledWith({ height: 0 });
    expect(mount({}).Homey.ready).toHaveBeenCalledWith({ height: 32 });
    expect(mount(null).Homey.ready).toHaveBeenCalledWith({ height: 32 });
  });

  it('a re-created widget replaces the box', () => {
    const root = document.createElement('div');
    win.createSpacerWidget(root, { height: 10 });
    win.createSpacerWidget(root, { height: 20 });
    expect(root.querySelectorAll('.sp')).toHaveLength(1);
    expect(root.querySelector<HTMLElement>('.sp')!.style.height).toBe('20px');
  });
});
