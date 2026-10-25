import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { compileFunction } from 'node:vm';

/**
 * Runs a widget's `public/widget.js` (a plain-browser IIFE that assigns its API to `window`) in
 * the current DOM environment, unchanged, and returns `window`.
 */
export function loadWidget(name: WidgetName): any {
  loadFile(KIT);
  for (const dep of DEPS[name] || []) loadFile(dep);
  return loadScript(name, 'widget.js');
}

/** The shared kit, which every index.html loads first (`../spacer/kit.js`). */
export const KIT = 'spacer/kit.js';

/**
 * The scripts a widget's index.html loads from another widget's folder (or a shared file in its own) before its
 * widget.js, besides the kit, as `<widget>/<file>`. The Smart Stack's `DEPS` (widgets/stack/public/mount.js) must match;
 * test/widget-html.test.ts checks both against the index.html files.
 */
export const DEPS: Partial<Record<WidgetName, string[]>> = {
  electricity: ['electricity/chart.js'],
  charts: ['electricity/chart.js'],
  thermostat: ['thermostat/presets.js'],
  varpresets: ['thermostat/presets.js'],
};

/** Runs a widget's `public/mount.js` (which wires it to a Homey) the same way; load its widget.js first. */
export function loadMount(name: WidgetName): any {
  if (!(window as any).WidgetkeeperKit) loadFile(KIT);
  return loadScript(name, 'mount.js');
}

export type WidgetName = 'electricity' | 'thermostat' | 'quickactions' | 'sensoralarms' | 'sensordots' | 'roomhealth' | 'valuematrix' | 'weather' | 'heatmap'
  | 'cameras' | 'values' | 'lights' | 'lightrooms' | 'sparklines' | 'charts' | 'variables' | 'varpresets' | 'flows' | 'price' | 'timers' | 'locks' | 'curtains' | 'media' | 'clock'
  | 'spacer' | 'textline' | 'dayssince' | 'stack' | 'shortcuts' | 'webpage' | 'pollen' | 'popups' | 'keypad';

function loadScript(name: WidgetName, file: string): any {
  loadFile(`${name}/${file}`);
  return window;
}

function loadFile(file: string) {
  const [widget, name] = file.split('/');
  runFile(`widgets/${widget}/public/${name}`);
}

/**
 * Runs a plain-browser script of the repo (`path` from its root) unchanged in the current environment, as a function
 * (its top-level names stay its own, as `new Function` would keep them) of `args`' names, and returns what it returns.
 * It runs under its file's name, so a coverage report (`npm run coverage`) counts its lines.
 */
export function runFile(path: string, args: Record<string, unknown> = {}): any {
  const file = resolve(import.meta.dirname, '../..', path);
  const fn = compileFunction(readFileSync(file, 'utf8'), Object.keys(args), { filename: pathToFileURL(file).href });
  return fn(...Object.values(args));
}
