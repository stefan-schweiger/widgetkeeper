import { readFile } from 'node:fs/promises';
import type Homey from 'homey';
import { repeatKeys } from './TileNameService.js';
import { devicesAndZones, matches } from './autocomplete.js';
import { describeCapability } from './capabilities.js';
import { driverIconPath, libraryIconUrl } from './deviceIcon.js';
import { sparkCaps } from './SparklineService.js';
import { valueCaps } from './ValueService.js';
import type { AutocompleteListener, SettingItem } from './widgetAutocompletes.js';

/** The app setting with the web dashboards (`WebDashboard[]`). */
export const WEB_DASHBOARDS_SETTING = 'webDashboards';
/** The app setting that turns the web dashboards on (`true`); off by default. Set from the app settings page. */
export const WEB_ENABLED_SETTING = 'webDashboardsEnabled';

const LOCALES_DIR = new URL('../locales/', import.meta.url);
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar'];

const MAX_DASHBOARDS = 30;
const MAX_COLUMNS = 6;
const MAX_WIDGETS = 60; // per dashboard
const MAX_DEVICES = 100; // per widget
const MAX_TEXT = 2000;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

export type WebTheme = 'auto' | 'dark' | 'light';

/** One widget on a web dashboard: its type (the widget id), settings and devices, as Homey keeps a dashboard widget's. */
export type WebWidget = { id: string, type: string, title: string, settings: Record<string, unknown>, deviceIds: string[] };

/** A web dashboard: columns of widgets, top to bottom. */
export type WebDashboard = { id: string, name: string, theme: WebTheme, columns: WebWidget[][] };

/** A widget setting as the editor draws it (the manifest's, in Homey's language). */
export type WebSettingDef = {
  id: string,
  type: string,
  title: string,
  /** Its own label in its section: `Colour` for `  – Colour`, `Flow` for `Button 1: flow`; else the title. */
  label: string,
  hint: string | null,
  value: unknown,
  min?: number,
  max?: number,
  values?: { id: string, title: string }[],
  /** `capability`: a `<deviceId>:<capabilityId>` slot, picked with the editor's device value picker (`/web/values`). */
  picker?: 'capability',
};

/** A widget type as the editor offers it. */
export type WebWidgetType = {
  type: string,
  name: string,
  height: number | null,
  transparent: boolean,
  devices: { singular: boolean } | null,
  settings: WebSettingDef[],
  /** How the editor groups the settings (`settingSections()`), in the manifest's order; every setting is in one. */
  sections: WebSettingSection[],
};

/**
 * A run of settings in the editor: `plain` ones, a `group` (a head and the rows under it: `Button 1: flow`,
 * `  – Colour` …; `numbered` when its title ends in a number) or `slots` (`Tile 1` … `Tile 6`, numbered rows without
 * rows under them).
 */
export type WebSettingSection =
  | { kind: 'plain', ids: string[] }
  | { kind: 'group', title: string, numbered: boolean, ids: string[] }
  | { kind: 'slots', ids: string[] };

/** A device the editor's device picker shows: its room (with the rooms above it) and its icon. */
export type WebDevice = {
  id: string,
  name: string,
  /** Its zone; `path` is the zones above it, below the top one (`['Ground floor']`). */
  zone: { id: string, name: string, path: string[] } | null,
  /** Same-origin `/api/icon/…` (Homey serves it without a login), or the user-picked icon from Homey's library. */
  icon: string | null,
};

/** A device in the editor's device value picker: the values a slot may show, with their current readings. */
export type WebValueDevice = WebDevice & {
  caps: { id: string, title: string, type: string, units: string | null, decimals: number | null, min: number | null, max: number | null, values: { id: string, title: string }[] | null, value: unknown }[],
};

/**
 * The autocomplete settings that pick one device value (`<deviceId>:<capabilityId>`), by widget: which settings and
 * which capabilities they list (the same as their autocomplete's, `listSlots()`).
 */
const CAPABILITY_SLOTS: Record<string, { setting: RegExp, caps: (device: any) => string[] }> = {
  values: { setting: /^slot\d+$/, caps: valueCaps },
  sparklines: { setting: /^slot\d+$/, caps: sparkCaps },
  charts: { setting: /^chart\d$/, caps: sparkCaps },
};

/** A device's icon for the page, as the widgets pick it: the user-picked library icon, else the driver's (on the Homey). */
function webIcon(device: any): string | null {
  const path = driverIconPath(device?.iconObj);
  return libraryIconUrl(device) ?? (path?.startsWith('/') ? path : null);
}

/** A device as the editor shows it: its name, room and icon. */
function webDevice(d: any, zones: Record<string, any>): WebDevice {
  return {
    id: String(d.id),
    name: String(d.name),
    zone: d.zone && zones[d.zone] ? { id: String(d.zone), name: String(zones[d.zone].name), path: zonePath(zones, d.zone) } : null,
    icon: webIcon(d),
  };
}

/** The zones above a zone, below the top one (the home), top-down. */
function zonePath(zones: Record<string, any>, zoneId: string): string[] {
  const path: string[] = [];
  const seen = new Set([zoneId]);
  let parent = zones[zoneId]?.parent;
  while (parent && zones[parent] && !seen.has(parent) && zones[parent].parent) {
    seen.add(parent);
    path.unshift(String(zones[parent].name));
    parent = zones[parent].parent;
  }
  return path;
}

/** A manifest text: the language's, else English. */
function loc(text: unknown, language: string): string {
  if (typeof text === 'string') return text;
  if (text && typeof text === 'object') {
    const t = text as Record<string, unknown>;
    if (typeof t[language] === 'string') return t[language] as string;
    if (typeof t.en === 'string') return t.en;
  }
  return '';
}

const SUB_ROW = /^[\s\u2003]+–\s*/; // `\u2003\u2003– Colour`: a row under the group head above it
const NUMBERED = /^(.*\S)\s+\d+$/; // `Tile 4` (with a no-break space before the number)

const capitalize = (text: string) => text.charAt(0).toLocaleUpperCase() + text.slice(1);

/**
 * The editor's sections of a widget's settings, from the titles' convention (CLAUDE.md, *Widget settings*): a group's
 * head is `Button 1: flow` (or a title without a colon) and the rows under it start with two em spaces and a dash.
 * The structure comes from the English titles, so a translation can't split a group; the labels are the language's.
 */
export function settingSections(settings: any[], language: string): { sections: WebSettingSection[], labels: Map<string, string> } {
  const en = settings.map(s => loc(s.title, 'en') || String(s.id));
  const sub = en.map(t => SUB_ROW.test(t));
  const labels = new Map<string, string>();
  const sections: WebSettingSection[] = [];
  let plain: string[] | null = null;
  const flat = (id: string) => {
    if (!plain) sections.push({ kind: 'plain', ids: plain = [] });
    plain.push(id);
  };
  for (let i = 0; i < settings.length;) {
    const id = String(settings[i].id);
    const title = loc(settings[i].title, language) || id;
    if (sub[i]) { // a row without a head: on its own
      labels.set(id, capitalize(title.replace(SUB_ROW, '')));
      flat(id);
      i++;
      continue;
    }
    let end = i + 1;
    while (end < settings.length && sub[end]) end++;
    if (end > i + 1) {
      // A group: the head's group part names it, the part after the colon labels the head.
      const enColon = en[i].indexOf(':');
      const colon = title.indexOf(':');
      const head = enColon < 0 || colon < 0 ? title : title.slice(0, colon).trim();
      labels.set(id, enColon < 0 || colon < 0 ? title : capitalize(title.slice(colon + 1).trim()));
      for (let j = i + 1; j < end; j++) {
        const sid = String(settings[j].id);
        labels.set(sid, capitalize((loc(settings[j].title, language) || sid).replace(SUB_ROW, '')));
      }
      sections.push({ kind: 'group', title: head, numbered: NUMBERED.test(enColon < 0 ? en[i] : en[i].slice(0, enColon)), ids: settings.slice(i, end).map(s => String(s.id)) });
      plain = null;
      i = end;
      continue;
    }
    // Slots: numbered rows of one kind (`Tile 1` … `Tile 6`), none with rows under it.
    const base = NUMBERED.exec(en[i])?.[1];
    let last = i;
    if (base && !en[i].includes(':')) {
      while (last + 1 < settings.length && !sub[last + 1] && !sub[last + 2] && settings[last + 1].type === settings[i].type
        && NUMBERED.exec(en[last + 1])?.[1] === base) last++;
    }
    if (last > i) {
      for (let j = i; j <= last; j++) labels.set(String(settings[j].id), loc(settings[j].title, language) || String(settings[j].id));
      sections.push({ kind: 'slots', ids: settings.slice(i, last + 1).map(s => String(s.id)) });
      plain = null;
      i = last + 1;
      continue;
    }
    labels.set(id, title);
    flat(id);
    i++;
  }
  return { sections, labels };
}

/** Whether a device passes a widget's `devices.filter` (`class` and `capabilities`, each `a|b`: any of them). */
export function passesDeviceFilter(device: any, filter: Record<string, unknown> | undefined): boolean {
  if (!filter) return true;
  const any = (list: unknown) => String(list).split('|').map(s => s.trim()).filter(Boolean);
  if (filter.class != null) {
    const classes = any(filter.class);
    if (!classes.includes(device?.class) && !classes.includes(device?.virtualClass)) return false;
  }
  if (filter.capabilities != null) {
    const caps: string[] = Array.isArray(device?.capabilities) ? device.capabilities : [];
    if (!any(filter.capabilities).some(c => caps.includes(c))) return false;
  }
  return true;
}

/**
 * The web dashboards: our widgets in any browser on the home network, each in a frame of its own (as on a Homey
 * dashboard), laid out by the user on the page itself. This keeps the dashboards (an app setting), checks them
 * against the manifest, and gives the page what Homey would give a widget frame: the widget types and their
 * settings, the devices to pick, the settings' autocompletes and the strings.
 */
export default class WebDashboardService {

  private strings = new Map<string, Promise<Record<string, unknown>>>();

  constructor(
    private homey: Homey.App['homey'],
    private log: (...args: any[]) => void,
    /** Every autocomplete setting's listener (`widgetAutocompletes()`), also registered with Homey by `app.ts`. */
    readonly autocompletes: Record<string, Record<string, AutocompleteListener>>,
  ) {}

  /** The manifest's widgets, by id. */
  private get manifestWidgets(): Record<string, any> {
    return (this.homey.manifest as any)?.widgets ?? {};
  }

  /** Whether the web dashboards are turned on (the app settings page). Off, every `/web/…` route but the setup refuses. */
  get enabled(): boolean {
    return this.homey.settings.get(WEB_ENABLED_SETTING) === true;
  }

  assertEnabled() {
    if (!this.enabled) throw new Error('Web dashboards are turned off');
  }

  list(): WebDashboard[] {
    const saved = this.homey.settings.get(WEB_DASHBOARDS_SETTING);
    if (!Array.isArray(saved)) return [];
    const out: WebDashboard[] = [];
    for (const d of saved) {
      try {
        out.push(this.normalize(d));
      } catch (err) {
        this.log('Web dashboards: dropped a saved dashboard:', String((err as any)?.message ?? err));
      }
    }
    return out;
  }

  /**
   * The row names Variables widgets had in their own settings (`nameN`, before Rename tiles), read from the saved
   * dashboards as they are: `list()` keeps only the manifest's settings, so a widget never sees them again. Per widget
   * instance (`web-<dashboard>-<widget>`, as the page names its frames), by tile key, for `TileNameService.adopt()`.
   */
  oldVariableNames(): { instance: string, names: Record<string, string> }[] {
    const saved = this.homey.settings.get(WEB_DASHBOARDS_SETTING);
    const out: { instance: string, names: Record<string, string> }[] = [];
    for (const d of Array.isArray(saved) ? saved : []) {
      if (!d || typeof d.id !== 'string' || !ID.test(d.id) || !Array.isArray(d.columns)) continue;
      for (const w of d.columns.flat()) {
        if (!w || w.type !== 'variables' || typeof w.id !== 'string' || !ID.test(w.id) || !w.settings || typeof w.settings !== 'object') continue;
        const picked = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
          .map(n => ({ id: w.settings[`slot${n}`]?.id, name: w.settings[`name${n}`] }))
          .filter(s => typeof s.id === 'string' && s.id && s.id !== 'none');
        const keys = repeatKeys(picked.map(s => s.id as string));
        const names: Record<string, string> = {};
        picked.forEach((s, i) => { if (typeof s.name === 'string' && s.name.trim()) names[keys[i]] = s.name.trim(); });
        if (Object.keys(names).length) out.push({ instance: `web-${d.id}-${w.id}`, names });
      }
    }
    return out;
  }

  /** Saves a dashboard (a new one without an id, or with an id not seen yet); answers it as saved. */
  save(input: unknown): WebDashboard {
    const dashboard = this.normalize(input, true);
    const all = this.list();
    const i = all.findIndex(d => d.id === dashboard.id);
    if (i >= 0) all[i] = dashboard;
    else if (all.length >= MAX_DASHBOARDS) throw new Error(`At most ${MAX_DASHBOARDS} dashboards`);
    else all.push(dashboard);
    this.homey.settings.set(WEB_DASHBOARDS_SETTING, all);
    return dashboard;
  }

  remove(id: string) {
    const all = this.list();
    const rest = all.filter(d => d.id !== id);
    if (rest.length !== all.length) this.homey.settings.set(WEB_DASHBOARDS_SETTING, rest);
    return { removed: rest.length !== all.length };
  }

  /** Every widget type, in the manifest's order, with its settings in Homey's language. */
  widgetTypes(language = this.homey.i18n.getLanguage()): WebWidgetType[] {
    return Object.entries(this.manifestWidgets).map(([type, w]) => {
      const settings = Array.isArray(w.settings) ? w.settings : [];
      const { sections, labels } = settingSections(settings, language);
      return {
        type,
        name: loc(w.name, language) || type,
        height: typeof w.height === 'number' ? w.height : null,
        transparent: w.transparent === true,
        devices: w.devices ? { singular: w.devices.singular === true } : null,
        settings: settings.map((s: any): WebSettingDef => ({
          id: s.id,
          type: s.type,
          title: loc(s.title, language) || s.id,
          label: labels.get(String(s.id)) ?? (loc(s.title, language) || s.id),
          hint: loc(s.hint, language) || null,
          value: s.value ?? null,
          ...(typeof s.min === 'number' ? { min: s.min } : {}),
          ...(typeof s.max === 'number' ? { max: s.max } : {}),
          ...(Array.isArray(s.values) ? { values: s.values.map((v: any) => ({ id: String(v.id), title: loc(v.title, language) || String(v.id) })) } : {}),
          ...(s.type === 'autocomplete' && CAPABILITY_SLOTS[type]?.setting.test(s.id) ? { picker: 'capability' as const } : {}),
        })),
        sections,
      };
    });
  }

  /** The devices a widget's `devices` setting may pick (its manifest filter), by name, with their rooms and icons. */
  async devices(type: string, query = ''): Promise<WebDevice[]> {
    const w = this.manifestWidgets[type];
    if (!w?.devices) throw new Error(`No devices setting: ${type}`);
    const [devices, zones] = await devicesAndZones(this.homey);
    return devices
      .filter(d => passesDeviceFilter(d, w.devices.filter))
      .map(d => webDevice(d, zones))
      .filter(d => matches(query, d.name, d.zone?.name))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * The device value picker of a widget's slots (Device Values, Sparklines, Charts): every device with a value the slots may
   * show, by name, with its room, icon and those values (in the device's order) as they read now.
   */
  async valueDevices(type: string): Promise<WebValueDevice[]> {
    const slots = Object.prototype.hasOwnProperty.call(CAPABILITY_SLOTS, type) ? CAPABILITY_SLOTS[type] : undefined;
    if (!slots) throw new Error(`No device value settings: ${type}`);
    const [devices, zones] = await devicesAndZones(this.homey);
    const out: WebValueDevice[] = [];
    for (const d of devices) {
      const caps = slots.caps(d).map((id) => {
        const c = describeCapability(d.capabilitiesObj?.[id], id);
        return { id, title: c.title, type: String(c.type ?? ''), units: c.units, decimals: c.decimals, min: c.min, max: c.max, values: c.values, value: d.capabilitiesObj?.[id]?.value ?? null };
      });
      if (caps.length) out.push({ ...webDevice(d, zones), caps });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** An autocomplete setting's items, from the same listener Homey's widget settings use. */
  async autocomplete(type: string, setting: string, query: string, settings: Record<string, any> | undefined): Promise<SettingItem[]> {
    const listener = Object.prototype.hasOwnProperty.call(this.autocompletes, type) ? this.autocompletes[type][setting] : undefined;
    if (!listener) throw new Error(`No autocomplete: ${type} ${setting}`);
    return listener(String(query ?? ''), settings && typeof settings === 'object' ? settings : {});
  }

  /** The app's strings (`locales/<lang>.json`) in Homey's language, as Homey gives a widget frame (`Homey.__`). */
  appStrings(language = this.homey.i18n.getLanguage()): Promise<Record<string, unknown>> {
    const lang = LANGUAGES.includes(language) ? language : 'en';
    let p = this.strings.get(lang);
    if (!p) {
      p = readFile(new URL(`${lang}.json`, LOCALES_DIR), 'utf8').then(text => JSON.parse(text));
      p.catch(() => this.strings.delete(lang));
      this.strings.set(lang, p);
    }
    return p;
  }

  /** For the diagnostics report: counts only. */
  describe() {
    const all = this.list();
    return {
      enabled: this.enabled,
      dashboards: all.length,
      widgets: all.reduce((n, d) => n + d.columns.reduce((m, c) => m + c.length, 0), 0),
    };
  }

  /**
   * A dashboard as it's kept: known widget types only, settings only of the widget's own ids (each of its type,
   * with the manifest's default where missing), at most `MAX_DEVICES` device ids. Throws on what can't be one.
   */
  private normalize(input: unknown, fresh = false): WebDashboard {
    if (!input || typeof input !== 'object') throw new Error('Not a dashboard');
    const d = input as Record<string, any>;
    const id = typeof d.id === 'string' && ID.test(d.id) ? d.id : (fresh ? newId() : null);
    if (!id) throw new Error('A dashboard needs an id');
    const name = typeof d.name === 'string' ? d.name.trim().slice(0, 60) : '';
    const theme: WebTheme = d.theme === 'dark' || d.theme === 'light' ? d.theme : 'auto';
    const columnsIn: unknown[] = Array.isArray(d.columns) ? d.columns.slice(0, MAX_COLUMNS) : [];
    const ids = new Set<string>();
    let count = 0;
    const columns = columnsIn.map((col) => {
      const widgets: WebWidget[] = [];
      for (const w of Array.isArray(col) ? col : []) {
        if (count >= MAX_WIDGETS) break;
        const widget = this.normalizeWidget(w, ids);
        if (!widget) continue;
        widgets.push(widget);
        count += 1;
      }
      return widgets;
    });
    if (!columns.length) columns.push([]);
    return { id, name, theme, columns };
  }

  private normalizeWidget(input: unknown, ids: Set<string>): WebWidget | null {
    if (!input || typeof input !== 'object') return null;
    const w = input as Record<string, any>;
    const def = typeof w.type === 'string' && Object.prototype.hasOwnProperty.call(this.manifestWidgets, w.type)
      ? this.manifestWidgets[w.type] : null;
    if (!def) return null;
    let id = typeof w.id === 'string' && ID.test(w.id) ? w.id : newId();
    while (ids.has(id)) id = newId();
    ids.add(id);
    const given = w.settings && typeof w.settings === 'object' ? w.settings as Record<string, unknown> : {};
    const settings: Record<string, unknown> = {};
    for (const s of Array.isArray(def.settings) ? def.settings : []) {
      const value = Object.prototype.hasOwnProperty.call(given, s.id) ? settingValue(s, given[s.id]) : undefined;
      settings[s.id] = value === undefined ? (s.value ?? null) : value;
    }
    const deviceIds = def.devices && Array.isArray(w.deviceIds)
      ? [...new Set(w.deviceIds.filter((x: unknown): x is string => typeof x === 'string' && ID.test(x)))]
        .slice(0, def.devices.singular ? 1 : MAX_DEVICES)
      : [];
    const title = typeof w.title === 'string' ? w.title.trim().slice(0, 60) : '';
    return { id, type: w.type, title, settings, deviceIds };
  }

}

/** A setting's value of its type, or undefined (then the manifest's default is kept). */
function settingValue(def: any, value: unknown): unknown {
  switch (def.type) {
    case 'checkbox':
      return typeof value === 'boolean' ? value : undefined;
    case 'number': {
      if (value === null || value === '') return null;
      const n = Number(value);
      if (!Number.isFinite(n)) return undefined;
      return Math.min(Math.max(n, typeof def.min === 'number' ? def.min : -Infinity), typeof def.max === 'number' ? def.max : Infinity);
    }
    case 'text':
    case 'textarea':
      return typeof value === 'string' ? value.slice(0, MAX_TEXT) : undefined;
    case 'dropdown':
      return (def.values ?? []).some((v: any) => String(v.id) === value) ? value : undefined;
    case 'autocomplete': {
      if (value === null) return null;
      if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
      // As Homey keeps an autocomplete's choice: the item's own fields (an `id`, or the thermostat's `capabilityId`
      // and `value`), without the image (Flow Buttons' icons are data URLs).
      const item: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 10)) {
        if (k === 'image' || k.length > 40) continue;
        if (typeof v === 'string') item[k] = v.slice(0, 200);
        else if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) item[k] = v;
      }
      return typeof item.name === 'string' ? item : undefined;
    }
    default:
      return undefined;
  }
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
