import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Runs a widget's `public/widget.js` (a plain-browser IIFE that assigns its API to `window`) in
 * the current DOM environment, unchanged, and returns `window`.
 */
export function loadWidget(name: WidgetName): any {
  for (const dep of DEPS[name] || []) loadFile(dep);
  return loadScript(name, 'widget.js');
}

/**
 * The scripts a widget's index.html loads from another widget's folder (or a shared file in its own) before its
 * widget.js, as `<widget>/<file>`. The Smart Stack's `DEPS` (widgets/stack/public/mount.js) must match;
 * test/widget-html.test.ts checks both against the index.html files.
 */
export const DEPS: Partial<Record<WidgetName, string[]>> = {
  electricity: ['electricity/chart.js'],
  charts: ['electricity/chart.js'],
};

/** Runs a widget's `public/mount.js` (which wires it to a Homey) the same way; load its widget.js first. */
export function loadMount(name: WidgetName): any {
  return loadScript(name, 'mount.js');
}

export type WidgetName = 'electricity' | 'thermostat' | 'quickactions' | 'sensoralarms' | 'sensordots' | 'weather' | 'heatmap'
  | 'cameras' | 'values' | 'lights' | 'sparklines' | 'charts' | 'variables' | 'flows' | 'price' | 'timers' | 'locks' | 'curtains' | 'media' | 'clock'
  | 'spacer' | 'textline' | 'stack';

function loadScript(name: WidgetName, file: string): any {
  loadFile(`${name}/${file}`);
  return window;
}

function loadFile(file: string) {
  const [widget, name] = file.split('/');
  new Function(readFileSync(resolve(import.meta.dirname, `../../widgets/${widget}/public/${name}`), 'utf8'))();
}
