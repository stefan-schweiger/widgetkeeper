// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

let win: any;
beforeAll(() => { win = loadWidget('flows'); });
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

const flow = (id: string, name: string, extra: object = {}) => ({ id, name, enabled: true, triggerable: true, advanced: false, ...extra });

function widget(flows: any[], extra: object = {}) {
  const root = document.createElement('div');
  document.body.append(root);
  const onTrigger = vi.fn(async (_id: string) => {});
  const onHaptic = vi.fn();
  const w = win.createFlowsWidget(root, { onTrigger, onHaptic, ...extra });
  w.setState(flows);
  const rows = () => [...root.querySelectorAll<HTMLElement>('.fb-row')];
  const row = (i: number) => rows()[i];
  const message = () => root.querySelector<HTMLElement>('.fb-message')!;
  return { w, root, rows, row, onTrigger, onHaptic, message };
}

describe('render', () => {
  it('shows one row per button: its colour and icon, then the name', () => {
    const { rows, row } = widget([flow('flow:1', 'Good night'), flow('advanced:2', 'Movie time'), { id: 'flow:3', missing: true }], {
      buttons: [{ id: 'flow:1', color: 'purple', icon: 'moon' }, { id: 'advanced:2', color: 'nope', icon: 'nope' }, { id: 'flow:3' }],
    });
    expect(rows().map(r => r.querySelector('.fb-name')!.textContent)).toEqual(['Good night', 'Movie time', 'Flow not found']);
    expect(rows().map(r => r.dataset.color)).toEqual(['purple', 'blue', 'blue']);
    expect(row(0).querySelector('.fb-button svg path')!.getAttribute('d')).not.toBe(row(1).querySelector('.fb-button svg path')!.getAttribute('d'));
    expect(row(2).classList.contains('missing')).toBe(true);
  });

  it("dims a flow that is turned off or can't be started by hand", () => {
    const { row } = widget([flow('flow:1', 'Away', { enabled: false }), flow('flow:2', 'Motion', { triggerable: false }), flow('flow:3', 'Ok')]);
    expect(row(0).classList.contains('unavailable')).toBe(true);
    expect(row(1).classList.contains('unavailable')).toBe(true);
    expect(row(2).classList.contains('unavailable')).toBe(false);
  });

  it('sets the column count', () => {
    expect(widget([flow('flow:1', 'A')], { columns: '2' }).root.dataset.columns).toBe('2');
    expect(widget([flow('flow:1', 'A')]).root.dataset.columns).toBe('1');
  });

  it('shows a persistent message instead of the rows', () => {
    const { w, rows, message } = widget([flow('flow:1', 'A')]);
    w.setMessage('Pick flows in the widget settings.');
    expect(rows()).toHaveLength(0);
    expect(message().textContent).toBe('Pick flows in the widget settings.');
  });

  it('knows every icon the settings offer', async () => {
    const { FLOW_ICON_PATHS } = await import('../lib/FlowService.js');
    // The same paths too: the settings' previews are drawn from the service's copy.
    expect(win.FLOW_BUTTON_ICON_PATHS).toEqual(FLOW_ICON_PATHS);
  });
});

describe('start', () => {
  it('starts the flow on a tap, with a spinner, then a check mark', async () => {
    const { row, onTrigger, onHaptic } = widget([flow('flow:1', 'Good night')]);
    row(0).click();
    expect(onTrigger).toHaveBeenCalledWith('flow:1');
    expect(onHaptic).toHaveBeenCalled();
    expect(row(0).classList.contains('running')).toBe(true);
    await vi.advanceTimersByTimeAsync(400);
    expect(row(0).classList.contains('running')).toBe(false);
    expect(row(0).classList.contains('done')).toBe(true);
    await vi.advanceTimersByTimeAsync(1500);
    expect(row(0).classList.contains('done')).toBe(false);
  });

  it('ignores taps while it is starting', async () => {
    const { row, onTrigger } = widget([flow('flow:1', 'Good night')]);
    row(0).click();
    row(0).click();
    expect(onTrigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(400);
  });

  it('starts on a touch tap, but not on a drag', () => {
    const { row, onTrigger } = widget([flow('flow:1', 'Good night')]);
    const touch = (type: string, x: number, y: number) => {
      const e = new Event(type, { bubbles: true, cancelable: true }) as any;
      e.changedTouches = [{ clientX: x, clientY: y }];
      row(0).dispatchEvent(e);
    };
    touch('touchstart', 10, 10); touch('touchmove', 10, 40); touch('touchend', 10, 40);
    expect(onTrigger).not.toHaveBeenCalled();
    touch('touchstart', 10, 10); touch('touchend', 12, 11);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("says why it couldn't start: the API key, or a failure", async () => {
    const { row, onTrigger, message } = widget([flow('flow:1', 'Good night')]);
    onTrigger.mockRejectedValueOnce(Object.assign(new Error('noKey'), { reason: 'noKey' }));
    row(0).click();
    await vi.advanceTimersByTimeAsync(400);
    expect(message().textContent).toBe('To start flows, add an API key in the app settings.');
    expect(row(0).classList.contains('shake')).toBe(true);
    onTrigger.mockRejectedValueOnce(new Error('boom'));
    row(0).click();
    await vi.advanceTimersByTimeAsync(400);
    expect(message().textContent).toBe('Could not start Good night.');
    expect(row(0).classList.contains('done')).toBe(false);
  });

  it("doesn't send a flow that is turned off or can't be started by hand, and says so", () => {
    const { row, onTrigger, message } = widget([flow('flow:1', 'Away', { enabled: false }), flow('flow:2', 'Motion', { triggerable: false })]);
    row(0).click();
    expect(message().textContent).toBe('Away is turned off.');
    row(1).click();
    expect(message().textContent).toBe("Motion can't be started by hand.");
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it('does nothing for a missing flow', () => {
    const { row, onTrigger } = widget([{ id: 'flow:1', missing: true }]);
    row(0).click();
    expect(onTrigger).not.toHaveBeenCalled();
  });
});
