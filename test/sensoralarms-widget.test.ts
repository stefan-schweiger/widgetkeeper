// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('sensoralarms'); });
afterEach(() => { document.body.innerHTML = ''; });

const alarm = (capabilityId: string, value: boolean | null, title = capabilityId, state = false) => ({ capabilityId, title, value, state });
const air = (co2 = false, radon = false) => ({
  id: 'air', name: 'Air quality', icon: 'data:image/svg+xml;base64,AA==',
  alarms: [alarm('alarm_co2', co2, 'CO₂ Alarm'), alarm('alarm_radon', radon, 'Radon alarm')],
});
const door = (open = true) => ({
  id: 'door', name: 'Back door', icon: null,
  alarms: [alarm('alarm_contact', open, 'Contact alarm', true), alarm('alarm_battery', false, 'Battery alarm')],
});
const motion = () => ({ id: 'motion', name: 'Hall', icon: null, alarms: [alarm('alarm_motion', true, 'Motion alarm', true)] });
const thermo = () => ({ id: 'thermo', name: 'Bedroom', icon: null, alarms: [] });

function widget(devices: any[], includeStates?: boolean) {
  const root = document.createElement('div');
  document.body.append(root);
  const w = win.createSensorAlarmsWidget(root, { includeStates });
  w.setState(devices);
  const tile = (id: string) => root.querySelector<HTMLElement>(`.sa-tile[data-device="${id}"]`)!;
  const status = (id: string) => tile(id).querySelector('.sa-status')!.textContent;
  const tiles = () => [...root.querySelectorAll<HTMLElement>('.sa-tile')];
  return { w, root, tile, status, tiles };
}

describe('render', () => {
  it('shows one tile per device, in order, with the name', () => {
    const { tiles } = widget([door(), air(), thermo()]);
    expect(tiles().map(t => t.querySelector('.sa-name')!.textContent)).toEqual(['Back door', 'Air quality', 'Bedroom']);
  });

  it('says no alarm, the one alarm, or how many', () => {
    expect(widget([air()]).status('air')).toBe('No alarm');
    expect(widget([air(true)]).status('air')).toBe('CO₂ Alarm');
    expect(widget([air(true, true)]).status('air')).toBe('2 alarms');
  });

  it('counts one alarm reported in several units once, without the unit', () => {
    const radon = (v: boolean, v2 = v) => ({
      id: 'aq', name: 'Air', icon: null,
      alarms: [alarm('alarm_radon_display', v, 'Radon alarm'), alarm('alarm_radon', v, 'Radon alarm (Bq/m³)'), alarm('alarm_radon_us', v2, 'Radon alarm (pCi/L)')],
    });
    expect(widget([radon(true)]).status('aq')).toBe('Radon alarm');
    expect(widget([{ ...radon(false, true) }]).status('aq')).toBe('Radon alarm');
    const both = radon(true);
    both.alarms.push(alarm('alarm_co2', true, 'CO₂ Alarm'));
    expect(widget([both]).status('aq')).toBe('2 alarms');
  });

  it('turns the tile red only while an alarm is on', () => {
    const { tile } = widget([air(), { ...air(false, true), id: 'air2' }]);
    expect(tile('air').classList.contains('alarm')).toBe(false);
    expect(tile('air2').classList.contains('alarm')).toBe(true);
  });

  it('ignores motion and contact unless the setting counts them', () => {
    const off = widget([door(true), motion()]);
    expect(off.status('door')).toBe('No alarm');
    expect(off.tile('door').classList.contains('alarm')).toBe(false);
    expect(off.status('motion')).toBe('No alarm sensors');
    const on = widget([door(true), motion()], true);
    expect(on.status('door')).toBe('Contact alarm');
    expect(on.tile('door').classList.contains('alarm')).toBe(true);
    expect(on.status('motion')).toBe('Motion alarm');
  });

  it('marks devices without alarms, and missing ones', () => {
    const { status, tile } = widget([thermo(), { id: 'gone', missing: true }]);
    expect(status('thermo')).toBe('No alarm sensors');
    expect(status('gone')).toBe('Unavailable');
    expect(tile('gone').classList.contains('missing')).toBe(true);
    expect(tile('gone').querySelector('.sa-icon')!.classList.contains('fallback')).toBe(true);
  });

  it('uses the device icon, or the fallback', () => {
    const { tile } = widget([air(), thermo()]);
    expect(tile('air').querySelector('.sa-icon')!.classList.contains('fallback')).toBe(false);
    expect(tile('thermo').querySelector('.sa-icon')!.classList.contains('fallback')).toBe(true);
  });

  it('uses the translations', () => {
    const root = document.createElement('div');
    const w = win.createSensorAlarmsWidget(root, { t: (k: string, tk: any) => (k === 'sensoralarms.alarms' ? `${tk.count} Alarme` : k) });
    w.setState([air(true, true)]);
    expect(root.querySelector('.sa-status')!.textContent).toBe('2 Alarme');
  });
});

describe('updates', () => {
  it('applies realtime changes, and ignores unknown capabilities', () => {
    const { w, tile, status } = widget([air()]);
    const node = tile('air');
    w.pushChange({ deviceId: 'air', capabilityId: 'alarm_radon', value: true });
    expect(status('air')).toBe('Radon alarm');
    expect(node.classList.contains('alarm')).toBe(true);
    w.pushChange({ deviceId: 'air', capabilityId: 'alarm_smoke', value: true });
    w.pushChange({ deviceId: 'other', capabilityId: 'alarm_radon', value: false });
    expect(status('air')).toBe('Radon alarm');
    w.pushChange({ deviceId: 'air', capabilityId: 'alarm_radon', value: false });
    expect(status('air')).toBe('No alarm');
    expect(tile('air')).toBe(node); // the tile element is kept
  });

  it('keeps tiles across refreshes and drops removed devices', () => {
    const { w, tile, tiles } = widget([air(), door()]);
    const node = tile('air');
    w.setState([air(true)]);
    expect(tile('air')).toBe(node);
    expect(tiles()).toHaveLength(1);
  });

  it('a persistent message replaces the tiles, a transient one keeps them', () => {
    const { w, root, tiles } = widget([air()]);
    w.setMessage('Oops', true);
    expect(tiles()).toHaveLength(1);
    expect(root.querySelector('.sa-message')!.classList.contains('error')).toBe(true);
    w.setMessage('Select sensors');
    expect(tiles()).toHaveLength(0);
    expect(root.querySelector('.sa-message')!.textContent).toBe('Select sensors');
  });
});

describe('alarm panel', () => {
  const tap = (node: HTMLElement) => node.click();
  const rows = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.sa-row')].map(r =>
    `${r.querySelector('.sa-row-title')!.textContent}: ${r.querySelector('.sa-row-state')!.textContent}${r.classList.contains('alarm') ? ' !' : ''}`);

  it('opens on a tap with every alarm, active or not, and closes on a second tap', () => {
    const { root, tile } = widget([air(true), door()]);
    tap(tile('air'));
    expect(tile('air').classList.contains('open')).toBe(true);
    expect(rows(root)).toEqual(['CO₂ Alarm: Active !', 'Radon alarm: Inactive']);
    tap(tile('air'));
    expect(root.querySelector('.sa-panel')).toBeNull();
    expect(tile('air').classList.contains('open')).toBe(false);
  });

  it("sits after the tapped tile's row and moves to another tile", () => {
    const { root, tile } = widget([air(), door(), thermo()]);
    tap(tile('air'));
    expect(root.querySelector('.sa-panel')!.previousElementSibling).toBe(tile('door'));
    tap(tile('thermo'));
    expect(root.querySelectorAll('.sa-panel')).toHaveLength(1);
    expect(root.querySelector('.sa-panel')!.previousElementSibling).toBe(tile('thermo'));
    expect(root.querySelector('.sa-empty')!.textContent).toBe('No alarm sensors');
    expect(tile('air').classList.contains('open')).toBe(false);
  });

  it('lists motion and contact, red only when they count', () => {
    const off = widget([door(true)]);
    tap(off.tile('door'));
    expect(rows(off.root)).toEqual(['Contact alarm: Active', 'Battery alarm: Inactive']);
    document.body.innerHTML = '';
    const on = widget([door(true)], true);
    tap(on.tile('door'));
    expect(rows(on.root)).toEqual(['Contact alarm: Active !', 'Battery alarm: Inactive']);
  });

  it('merges one alarm reported in several units', () => {
    const { root, tile } = widget([{ id: 'aq', name: 'Air', icon: null,
      alarms: [alarm('alarm_radon', false, 'Radon alarm (Bq/m³)'), alarm('alarm_radon_us', true, 'Radon alarm (pCi/L)'), alarm('alarm_x', null, 'X alarm')] }]);
    tap(tile('aq'));
    expect(rows(root)).toEqual(['Radon alarm: Active !', 'X alarm: –']);
  });

  it('follows realtime changes and closes when the device goes missing', () => {
    const { w, root, tile } = widget([air()]);
    tap(tile('air'));
    w.pushChange({ deviceId: 'air', capabilityId: 'alarm_radon', value: true });
    expect(rows(root)).toEqual(['CO₂ Alarm: Inactive', 'Radon alarm: Active !']);
    w.setState([{ id: 'air', missing: true }]);
    expect(root.querySelector('.sa-panel')).toBeNull();
    tap(tile('air'));
    expect(root.querySelector('.sa-panel')).toBeNull();
  });

  it('opens on a touch tap but not on a drag', () => {
    const { root, tile } = widget([air()]);
    const touch = (type: string, x: number) => {
      const e = new win.Event(type, { bubbles: true, cancelable: true });
      e.changedTouches = [{ clientX: x, clientY: 0 }];
      tile('air').dispatchEvent(e);
    };
    touch('touchstart', 0); touch('touchmove', 30); touch('touchend', 30);
    expect(root.querySelector('.sa-panel')).toBeNull();
    touch('touchstart', 0); touch('touchend', 4);
    expect(root.querySelector('.sa-panel')).not.toBeNull();
  });
});
