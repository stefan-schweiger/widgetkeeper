import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs a widget's `public/widget.js` (a plain-browser IIFE that assigns its API to `window`) in
 * the current DOM environment, unchanged, and returns `window`.
 */
export function loadWidget(name: 'electricity' | 'thermostat' | 'quickactions' | 'sensoralarms' | 'weather' | 'heatmap' | 'cameras' | 'values'): any {
  const path = resolve(import.meta.dirname, `../../widgets/${name}/public/widget.js`);
  new Function(readFileSync(path, 'utf8'))();
  return window;
}
