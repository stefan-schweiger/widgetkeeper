// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';
import { touch as fireTouch } from './helpers/touch.js';

let win: any;
beforeAll(() => { win = loadWidget('sensordots'); });
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-08T18:40:00')); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const at = (s: string) => new Date(s).getTime();
const time = (s: string) => new Date(s).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const alarm = (capabilityId: string, value: boolean | null, title = capabilityId, lastUpdated: number | null = null) =>
  ({ capabilityId, title, value, state: true, lastUpdated });
const door = (open: boolean | null = true, since = '2026-10-08T18:32:00') => ({
  id: 'door', name: 'Back door', icon: null, alarms: [alarm('alarm_contact', open, 'Contact alarm', at(since))],
});
const hall = (moving = false) => ({ id: 'hall', name: 'Hall', icon: null, alarms: [alarm('alarm_motion', moving, 'Motion alarm', at('2026-10-08T17:05:00'))] });
const cam = (person = false, motion = false) => ({
  id: 'cam', name: 'Driveway', icon: null,
  alarms: [alarm('alarm_motion', motion, 'Motion alarm', at('2026-10-08T18:00:00')), alarm('alarm_person', person, 'Person Detected', at('2026-10-08T18:10:00'))],
});

function widget(state: any) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createSensorDotsWidget(root);
  w.setState(state);
  const cell = (id: string) => root.querySelector<HTMLElement>(`.sd-cell[data-device="${id}"]`)!;
  const panel = () => root.querySelector<HTMLElement>('.sd-panel')!;
  const shown = () => panel().style.display !== 'none';
  const panelText = () => `${panel().querySelector('.sd-panel-name')!.textContent}|${panel().querySelector('.sd-panel-state')!.textContent}`;
  const cells = () => [...root.querySelectorAll<HTMLElement>('.sd-cell')];
  return { w, root, cell, panel, shown, panelText, cells };
}

describe('dots', () => {
  it('shows one dot per device, in order, and keeps the overlay last', () => {
    const { root, cells } = widget({ devices: [hall(), door(), cam()] });
    expect(cells().map(c => c.dataset.device)).toEqual(['hall', 'door', 'cam']);
    expect(root.querySelector('.sd-grid')!.lastElementChild!.classList.contains('sd-panel')).toBe(true);
  });

  it('is red while any detection is on, blue while idle, grey without a value', () => {
    const { cell } = widget([door(true), hall(false), { ...cam(true), id: 'cam' }, { ...door(null), id: 'new' }, { id: 'gone', missing: true }]);
    expect(cell('door').dataset.level).toBe('active');
    expect(cell('hall').dataset.level).toBe('idle');
    expect(cell('cam').dataset.level).toBe('active');
    expect(cell('new').dataset.level).toBe('unknown');
    expect(cell('gone').dataset.level).toBe('missing');
  });

  it('shows the title as a header in the tile, or none', () => {
    const root = document.createElement('div');
    win.createSensorDotsWidget(root, { title: '  Doors and motion ' }).setState([door()]);
    expect(root.querySelector('.sd-tile > .sd-header')!.textContent).toBe('Doors and motion');
    expect(widget([door()]).root.querySelector('.sd-header')).toBeNull();
  });

  it('uses the colour settings, grey and blue by default', () => {
    expect(widget([door()]).root.dataset).toMatchObject({ idle: 'grey', active: 'blue' });
    const root = document.createElement('div');
    win.createSensorDotsWidget(root, { idleColor: 'green', activeColor: 'red' });
    expect(root.dataset).toMatchObject({ idle: 'green', active: 'red' });
    const unknown = document.createElement('div');
    win.createSensorDotsWidget(unknown, { idleColor: 'pink', activeColor: '' });
    expect(unknown.dataset).toMatchObject({ idle: 'grey', active: 'blue' });
  });

  it('labels each dot with its name and state', () => {
    const { cell } = widget([door(true)]);
    expect(cell('door').getAttribute('aria-label')).toBe(`Back door: Open since ${time('2026-10-08T18:32:00')}`);
  });
});

describe('overlay', () => {
  it('opens on a tap over the dot\'s row, and a tap on it closes it', () => {
    const { cell, panel, shown, panelText } = widget([door(), hall()]);
    expect(shown()).toBe(false);
    cell('hall').click();
    expect(shown()).toBe(true);
    expect(cell('hall').classList.contains('open')).toBe(true);
    expect(panel().style.top).toBe(`${cell('hall').offsetTop}px`);
    expect(panelText()).toBe(`Hall|No motion since ${time('2026-10-08T17:05:00')}`);
    panel().click();
    expect(shown()).toBe(false);
    expect(cell('hall').classList.contains('open')).toBe(false);
  });

  it('moves to another dot, and closes on a second tap on the same dot', () => {
    const { cell, shown, panelText } = widget([door(), hall()]);
    cell('door').click();
    cell('hall').click();
    expect(panelText()).toMatch(/^Hall\|/);
    expect(cell('door').classList.contains('open')).toBe(false);
    cell('hall').click();
    expect(shown()).toBe(false);
  });

  it('says what is active, using the camera titles, since the latest change', () => {
    const one = widget([cam(true)]);
    one.cell('cam').click();
    expect(one.panelText()).toBe(`Driveway|Person Detected since ${time('2026-10-08T18:10:00')}`);
    document.body.innerHTML = '';
    const both = widget([cam(true, true)]);
    both.cell('cam').click();
    expect(both.panelText()).toBe(`Driveway|Motion, Person Detected since ${time('2026-10-08T18:10:00')}`);
    document.body.innerHTML = '';
    const idle = widget([cam()]);
    idle.cell('cam').click();
    expect(idle.panelText()).toBe(`Driveway|No motion since ${time('2026-10-08T18:10:00')}`);
    document.body.innerHTML = '';
    const personOnly = widget([{ ...cam(), alarms: [cam().alarms[1]] }]);
    personOnly.cell('cam').click();
    expect(personOnly.panelText()).toBe(`Driveway|Nothing detected since ${time('2026-10-08T18:10:00')}`);
  });

  it('says closed, and a dash without a value', () => {
    const closed = widget([door(false)]);
    closed.cell('door').click();
    expect(closed.panelText()).toBe(`Back door|Closed since ${time('2026-10-08T18:32:00')}`);
    document.body.innerHTML = '';
    const unknown = widget([door(null)]);
    unknown.cell('door').click();
    expect(unknown.panelText()).toBe('Back door|–');
  });

  it('adds the weekday for an earlier day this week, the date before that', () => {
    const lang = widget({ devices: [door(true, '2026-10-06T07:15:00')], language: 'en' });
    lang.cell('door').click();
    expect(lang.panelText()).toBe(`Back door|Open since Tue ${time('2026-10-06T07:15:00')}`);
    document.body.innerHTML = '';
    const old = widget({ devices: [door(false, '2026-09-28T07:15:00')], language: 'en' });
    old.cell('door').click();
    expect(old.panelText()).toBe('Back door|Closed since Sep 28');
  });

  it('shows a missing device as unavailable, and closes when its device is removed', () => {
    const { w, cell, shown, panel } = widget([{ id: 'gone', missing: true }, door()]);
    cell('gone').click();
    expect(panel().querySelector('.sd-panel-state')!.textContent).toBe('Unavailable');
    w.setState([door()]);
    expect(shown()).toBe(false);
  });

  it('opens on a touch tap but not on a drag', () => {
    const { cell, shown } = widget([door()]);
    const touch = (type: string, x: number) => fireTouch(cell('door'), type, x);
    touch('touchstart', 0); touch('touchmove', 30); touch('touchend', 30);
    expect(shown()).toBe(false);
    touch('touchstart', 0); touch('touchend', 4);
    expect(shown()).toBe(true);
  });
});

describe('updates', () => {
  it('applies realtime changes with their time, and keeps the dot element', () => {
    const { w, cell, panelText } = widget([door(false)]);
    const node = cell('door');
    cell('door').click();
    w.pushChange({ deviceId: 'door', capabilityId: 'alarm_contact', value: true, t: at('2026-10-08T18:39:00') });
    expect(cell('door')).toBe(node);
    expect(node.dataset.level).toBe('active');
    expect(panelText()).toBe(`Back door|Open since ${time('2026-10-08T18:39:00')}`);
    w.pushChange({ deviceId: 'door', capabilityId: 'alarm_smoke', value: true });
    w.pushChange({ deviceId: 'other', capabilityId: 'alarm_contact', value: false });
    expect(node.dataset.level).toBe('active');
  });

  it('a persistent message replaces the dots, a transient one keeps them', () => {
    const { w, root, cells } = widget([door()]);
    w.setMessage('Oops', true);
    expect(cells()).toHaveLength(1);
    expect(root.querySelector('.sd-message')!.classList.contains('error')).toBe(true);
    w.setMessage('Select sensors');
    expect(cells()).toHaveLength(0);
    expect(root.querySelector('.sd-message')!.textContent).toBe('Select sensors');
  });

  it('uses the translations', () => {
    const root = document.createElement('div');
    const w = win.createSensorDotsWidget(root, { t: (k: string, tk: any) => (k === 'sensordots.open' ? 'Offen' : k === 'sensordots.since' ? `seit ${tk.time}` : k) });
    w.setState([door()]);
    w.open('door');
    expect(root.querySelector('.sd-panel-state')!.textContent).toBe(`Offen seit ${time('2026-10-08T18:32:00')}`);
  });
});
