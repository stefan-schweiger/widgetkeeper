import { readFileSync } from 'node:fs';
import { vi } from 'vitest';

type Api = (method: string, path: string, body?: unknown) => Promise<unknown>;

/**
 * The `Homey` a widget's frame gets (the SDK's documented methods), for `mount.js`: its settings and devices, an `api`
 * (by default every request fails, so a widget takes its error path), realtime `on()` and the frame calls.
 * `emit(event, data)` sends a realtime event to what the widget registered.
 */
export function fakeFrame(settings: object = {}, {
  deviceIds = ['d1'] as string[],
  instance = 'w1' as string | (() => string),
  api = (async () => { throw new Error('offline'); }) as Api,
} = {}) {
  const listeners = new Map<string, ((data: unknown) => void)[]>();
  return {
    api: vi.fn(api),
    on: vi.fn((event: string, fn: (data: unknown) => void) => { listeners.set(event, [...(listeners.get(event) ?? []), fn]); }),
    ready: vi.fn(),
    setHeight: vi.fn(),
    popup: vi.fn(),
    hapticFeedback: vi.fn(),
    getSettings: () => settings,
    getDeviceIds: () => deviceIds,
    getWidgetInstanceId: typeof instance === 'function' ? instance : () => instance,
    __: (key: string) => key,
    emit(event: string, data: unknown) {
      for (const fn of listeners.get(event) ?? []) fn(data);
    },
  };
}

/** A widget's mount function's name (`window.mount<X>Widget`), read from its mount.js. */
export const mountName = (id: string) => readFileSync(`widgets/${id}/public/mount.js`, 'utf8').match(/window\.(mount\w+Widget) =/)![1];

/** A frame element with the widget's root in it, on the page. */
export function frameElements() {
  const frame = document.createElement('div');
  const root = document.createElement('div');
  frame.append(root);
  document.body.append(frame);
  return { frame, root };
}
