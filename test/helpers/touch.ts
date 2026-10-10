/**
 * Dispatches a bubbling, cancelable touch event (`touchstart`, `touchmove`, `touchend` …) at `target`, with one
 * changed touch at (x, y), as the widgets' touch-tap logic (`onTap()`) reads it. Needs a DOM environment (happy-dom).
 */
export function touch(target: EventTarget, type: string, x: number, y = 0): Event {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(e, { changedTouches: [{ clientX: x, clientY: y }] });
  target.dispatchEvent(e);
  return e;
}
