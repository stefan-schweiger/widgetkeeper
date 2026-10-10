import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs a widget's `public/widget.js` (a plain-browser IIFE that assigns its API to `window`) in
 * the current DOM environment, unchanged, and returns `window`.
 */
export function loadWidget(name: WidgetName): any {
  return loadScript(name, 'widget.js');
}

/** Runs a widget's `public/mount.js` (which wires it to a Homey) the same way; load its widget.js first. */
export function loadMount(name: WidgetName): any {
  return loadScript(name, 'mount.js');
}

export type WidgetName = 'electricity' | 'thermostat' | 'quickactions' | 'sensoralarms' | 'sensordots' | 'weather' | 'heatmap'
  | 'cameras' | 'values' | 'lights' | 'sparklines' | 'variables' | 'flows' | 'price' | 'timers' | 'locks' | 'curtains' | 'media'
  | 'stack';

function loadScript(name: WidgetName, file: string): any {
  const path = resolve(import.meta.dirname, `../../widgets/${name}/public/${file}`);
  new Function(readFileSync(path, 'utf8'))();
  return window;
}
