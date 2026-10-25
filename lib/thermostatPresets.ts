/*
 * Thermostat Presets' device model on the app's side, for its Flow cards: what `widgets/thermostat/public/widget.js` does
 * with a button (`presetsFromSettings()`, `modeCap()`, `deviceValues()`, `presetMatches()`, `presetText()`), copied.
 * `test/thermostat-presets.test.ts` runs both on the same cases, so they stay equal.
 */
import type { CapValue } from './ThermostatService.js';

const TEMP_TOLERANCE = 0.25;

export type PresetSlot = 'power' | 'mode' | 'temp' | 'extra';
export type PresetValue = CapValue & { slot: PresetSlot, name?: string };
/** A button: the values it sets, in the order the widget sends them. */
export type Preset = { values: PresetValue[] };

/** A device's capabilities as `ThermostatService.getState()` gives them (only what's read here). */
export type PresetCaps = Record<string, { title?: string, values?: { id: string, title: string }[] | null }>;

export function sameValue(capabilityId: string, a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return capabilityId === 'target_temperature' ? Math.abs(a - b) <= TEMP_TOLERANCE : a === b;
  }
  return a === b || (a != null && b != null && String(a) === String(b));
}

/** The widget's flat settings as its three buttons. */
export function presetsFromSettings(settings: Record<string, any>): Preset[] {
  const out: Preset[] = [];
  for (const n of [1, 2, 3]) {
    const values: PresetValue[] = [];
    const power = settings[`b${n}Power`];
    if (power === 'on' || power === 'off') values.push({ slot: 'power', capabilityId: 'onoff', value: power === 'on' });
    // Mode first: some drivers check other values (like fan speed) against the current mode.
    for (const [slot, key] of [['mode', `b${n}Mode`], ['temp', `b${n}Temp`], ['extra', `b${n}Extra`]] as const) {
      const item = settings[key];
      if (item && typeof item.capabilityId === 'string' && item.capabilityId && !values.some(v => v.capabilityId === item.capabilityId)) {
        values.push({ slot, capabilityId: item.capabilityId, value: item.value, name: typeof item.name === 'string' ? item.name : undefined });
      }
    }
    out.push({ values });
  }
  return out;
}

/** The capability the widget's Mode fields set (the first button's that sets one), or null when none does. */
export function widgetModeCap(presets: Preset[]): string | null {
  for (const p of presets) {
    const m = p.values.find(v => v.slot === 'mode');
    if (m) return m.capabilityId;
  }
  return null;
}

function offValue(caps: PresetCaps, id: string) {
  return caps[id]?.values?.find(x => /^off$/i.test(x.id) || /^off$/i.test(x.title)) ?? null;
}

/** The mode capability: the widget's (`widgetModeCap()`), else `thermostat_mode`, or the first enum with an `off` value. */
export function modeCapOf(widgetMode: string | null, caps: PresetCaps): string {
  if (widgetMode) return widgetMode;
  if (!caps.thermostat_mode) {
    const id = Object.keys(caps).find(k => offValue(caps, k));
    if (id) return id;
  }
  return 'thermostat_mode';
}

function offMode(caps: PresetCaps, modeCap: string): CapValue | null {
  const off = offValue(caps, modeCap);
  return off ? { capabilityId: modeCap, value: off.id } : null;
}

function isOff(values: Record<string, unknown>, caps: PresetCaps, modeCap: string) {
  if ('onoff' in values) return values.onoff === false;
  const off = offMode(caps, modeCap);
  return !!off && sameValue(off.capabilityId, values[off.capabilityId], off.value);
}

/**
 * The values to send and match against for this device. Many aircons have no `onoff` and turn off through their mode
 * instead; turning them on is then implied by the other values. Empty when the button can't be done on the device.
 */
export function deviceValues(preset: Preset, caps: PresetCaps, modeCap: string): PresetValue[] {
  if (caps.onoff) return preset.values;
  if (preset.values.some(v => v.capabilityId === 'onoff' && v.value === false)) {
    const off = offMode(caps, modeCap);
    if (!off) return [];
    // Turning off wins over any mode the preset also sets.
    return [{ slot: 'mode', ...off }, ...preset.values.filter(v => v.capabilityId !== 'onoff' && v.capabilityId !== off.capabilityId)];
  }
  return preset.values.filter(v => v.capabilityId !== 'onoff');
}

/** True when the device's values equal everything the button sets (`deviceValues()`'s); what lights it on the widget. */
export function presetMatches(values: Record<string, unknown>, presetValues: CapValue[], caps: PresetCaps, modeCap: string): boolean {
  if (!presetValues.length) return false;
  const off = offMode(caps, modeCap);
  const turnsOff = presetValues.some(v => (v.capabilityId === 'onoff' && v.value === false)
    || (off && v.capabilityId === off.capabilityId && sameValue(v.capabilityId, v.value, off.value)));
  // A preset that doesn't turn the device off only counts while it's on.
  if (!turnsOff && isOff(values, caps, modeCap)) return false;
  return presetValues.every(v => sameValue(v.capabilityId, values[v.capabilityId], v.value));
}

/** Values sent without their slots (a tap's), slotted as the widget would have: power, the mode, the temperature, the rest. */
export function slotted(values: CapValue[], modeCap: string): Preset {
  const slot = (id: string): PresetSlot => (id === 'onoff' ? 'power' : id === modeCap ? 'mode' : id === 'target_temperature' ? 'temp' : 'extra');
  return { values: values.map(v => ({ ...v, slot: slot(v.capabilityId) })) };
}

/** "Fan speed" + "Slow" → "Fan slow". */
function shortSetting(capTitle: string, valueTitle: string) {
  const word = String(capTitle || '').split(/\s+/)[0];
  if (!word || valueTitle.toLowerCase().startsWith(word.toLowerCase())) return valueTitle;
  const v = valueTitle === valueTitle.toUpperCase() ? valueTitle : valueTitle.charAt(0).toLowerCase() + valueTitle.slice(1);
  return `${word} ${v}`;
}

/**
 * A button's text on one line, as its tile shows it: `21° · Heat · Fan low`, `Cool`, `Off`. The titles come from the
 * device's capabilities, else from the settings' item names (`Mode: Cool`), as the widget's do before its state loads.
 */
export function presetLabel(preset: Preset, caps: PresetCaps, modeCap: string, words: { off: string, on: string }, locale?: string): string {
  const numberFmt = new Intl.NumberFormat(locale, { maximumFractionDigits: 1 });
  const enumTitle = (v: PresetValue) => {
    const match = caps[v.capabilityId]?.values?.find(x => String(x.id) === String(v.value));
    if (match) return match.title;
    if (v.name?.includes(': ')) return v.name.split(': ').slice(1).join(': ');
    return v.value == null ? '' : String(v.value);
  };
  const capTitle = (v: PresetValue) => caps[v.capabilityId]?.title
    || (v.name?.includes(': ') ? v.name.split(': ')[0] : v.capabilityId);
  const slot = (name: PresetSlot) => preset.values.find(v => v.slot === name);
  const onoff = slot('power'), tt = slot('temp'), mode = slot('mode');
  const off = offMode(caps, modeCap);
  if ((onoff && onoff.value === false) || (mode && off && mode.capabilityId === off.capabilityId && sameValue(mode.capabilityId, mode.value, off.value))) {
    return words.off;
  }
  const extras = preset.values.filter(v => v.slot === 'extra').map(v => shortSetting(capTitle(v), enumTitle(v)));
  const parts = [
    tt && typeof tt.value === 'number' ? `${numberFmt.format(tt.value)}°` : '',
    mode ? enumTitle(mode) : '',
    ...extras,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : onoff ? words.on : '';
}
