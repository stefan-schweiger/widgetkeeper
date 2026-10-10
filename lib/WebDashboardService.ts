import { readFile } from 'node:fs/promises';
import type Homey from 'homey';
import { listDevicesWhere, type AutocompleteItem } from './autocomplete.js';
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
  hint: string | null,
  value: unknown,
  min?: number,
  max?: number,
  values?: { id: string, title: string }[],
};

/** A widget type as the editor offers it. */
export type WebWidgetType = {
  type: string,
  name: string,
  height: number | null,
  transparent: boolean,
  devices: { singular: boolean } | null,
  settings: WebSettingDef[],
};

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
    return Object.entries(this.manifestWidgets).map(([type, w]) => ({
      type,
      name: loc(w.name, language) || type,
      height: typeof w.height === 'number' ? w.height : null,
      transparent: w.transparent === true,
      devices: w.devices ? { singular: w.devices.singular === true } : null,
      settings: (Array.isArray(w.settings) ? w.settings : []).map((s: any): WebSettingDef => ({
        id: s.id,
        type: s.type,
        title: loc(s.title, language) || s.id,
        hint: loc(s.hint, language) || null,
        value: s.value ?? null,
        ...(typeof s.min === 'number' ? { min: s.min } : {}),
        ...(typeof s.max === 'number' ? { max: s.max } : {}),
        ...(Array.isArray(s.values) ? { values: s.values.map((v: any) => ({ id: String(v.id), title: loc(v.title, language) || String(v.id) })) } : {}),
      })),
    }));
  }

  /** The devices a widget's `devices` setting may pick (its manifest filter), by name. */
  async devices(type: string, query = ''): Promise<AutocompleteItem[]> {
    const w = this.manifestWidgets[type];
    if (!w?.devices) throw new Error(`No devices setting: ${type}`);
    return listDevicesWhere(this.homey, query, d => passesDeviceFilter(d, w.devices.filter));
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
