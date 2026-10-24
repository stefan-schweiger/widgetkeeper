import { readFile } from 'node:fs/promises';
import type Homey from 'homey';
import { repeatKeys, type default as TileNameService } from './TileNameService.js';
import { devicesAndZones, matches, withNone, type AutocompleteItem } from './autocomplete.js';
import { describeCapability } from './capabilities.js';
import { driverIconPath, libraryIconUrl } from './deviceIcon.js';
import { deviceApp } from './MediaService.js';
import { sparkCaps } from './SparklineService.js';
import { isReservedKey } from './storedSetting.js';
import { valueCaps } from './ValueService.js';
import type { AutocompleteListener, SettingItem } from './widgetAutocompletes.js';

/** The app setting with the web dashboards (`WebDashboard[]`). */
export const WEB_DASHBOARDS_SETTING = 'webDashboards';
/** The app setting that turns the web dashboards on (`true`); off by default. Set from the app settings page. */
export const WEB_ENABLED_SETTING = 'webDashboardsEnabled';
/**
 * The app setting that lets the page work away from home (`true`), through Homey's cloud relay
 * (`https://<homeyId>.connect.athom.com`); off by default. Homey doesn't tell a route which address a request came in
 * on, so the page says it (`?away=1`, `isAway()`): the key still guards everything, this keeps the dashboards home.
 */
export const WEB_REMOTE_SETTING = 'webRemoteAccess';
/** The app setting with the front page's own choices (`WebFront`), made in its edit mode. */
export const WEB_FRONT_SETTING = 'webFront';

const LOCALES_DIR = new URL('../locales/', import.meta.url);
const LANGUAGES = ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar'];

export const MAX_DASHBOARDS = 64;
export const MAX_SECTIONS = 20;
const MAX_COLUMNS = 6;
const MAX_WIDGETS = 60; // per dashboard
const MAX_DEVICES = 100; // per widget
const MAX_TEXT = 2000;
const MAX_FOREIGN_SETTINGS = 60; // per widget of another app
const ID = /^[A-Za-z0-9_-]{1,40}$/;
/**
 * Another app's widget type: its id on Homey's dashboards (`homey:app:<appId>:<widgetId>`). The app id never starts with
 * a dot: `.` or `..` would make the page's `/app/<appId>/widgets/…` frame point elsewhere on the Homey.
 */
const FOREIGN = /^homey:app:([A-Za-z0-9][A-Za-z0-9._-]{0,99}):([A-Za-z0-9_-]{1,60})$/;

export type WebTheme = 'auto' | 'dark' | 'light';

/** A dashboard's backdrop: a tint with a light and a dark shade (the page's CSS), following its theme. */
export const WEB_BACKGROUNDS = ['default', 'black', 'slate', 'ocean', 'forest', 'plum', 'berry', 'sand'] as const;
export type WebBackground = typeof WEB_BACKGROUNDS[number];

/**
 * How wide a dashboard's columns are (the page's `COLUMN_WIDTHS`): `narrow` is a phone's widget width, as on Homey's
 * dashboard; `fit` shares the window's width between them. `normal` (440 px) isn't stored.
 */
export const WEB_COLUMN_WIDTHS = ['narrow', 'normal', 'wide', 'fit'] as const;
export type WebColumnWidth = typeof WEB_COLUMN_WIDTHS[number];

/**
 * One widget on a web dashboard: its type (our widget id, or another app's `homey:app:<appId>:<widgetId>`), settings and
 * devices, as Homey keeps a dashboard widget's. `trusted`: another app's widget the user lets run unsandboxed; `scaled`:
 * another app's widget laid out at a phone's width and scaled to its column, as on Homey's dashboard. `span`: a wide
 * widget's columns (its own and those to its right); `at`: in each column it covers, the index of that column's widget it
 * sits before (the column's length: under them all).
 */
export type WebWidget = {
  id: string, type: string, title: string, settings: Record<string, unknown>, deviceIds: string[], trusted?: true,
  scaled?: true, span?: number, at?: number[],
};

/** The device filter the page sends for another app's widget (its `devices.filter`; `app`: only that app's devices). */
export type ForeignDeviceFilter = { class?: string, capabilities?: string, app?: boolean };

/** A heading on the front page that dashboards are grouped under (`WebDashboard.section`). */
export type WebSection = { id: string, name: string };

/**
 * The front page's choices: whether it shows the widgets' carousel under the dashboards, and its sections, in order
 * (the dashboards in none come first, under Your dashboards).
 */
export type WebFront = { widgets: boolean, sections: WebSection[] };

/**
 * A web dashboard: columns of widgets, top to bottom; `section`: the front page's section it's under; `columnWidth`: its
 * columns' width when not `normal`.
 */
export type WebDashboard = {
  id: string, name: string, theme: WebTheme, background: WebBackground, columns: WebWidget[][], section?: string,
  columnWidth?: Exclude<WebColumnWidth, 'normal'>,
};

/** What a web dashboards backup file is (`format`, `version`), as the web dashboards page downloads it. */
export const WEB_BACKUP_FORMAT = 'widgetkeeper-web-dashboards';
const WEB_BACKUP_VERSION = 1;

/**
 * A backup of web dashboards (every one, or those the user chose): the dashboards, the front page's choices and the tile
 * names typed on their widgets (by widget instance, `web-<dashboard>-<widget>`). Not Notes' texts or Days Since's
 * counters: Homey's own dashboards share those.
 */
export type WebBackup = {
  format: typeof WEB_BACKUP_FORMAT,
  version: typeof WEB_BACKUP_VERSION,
  app: string,
  exportedAt: string,
  dashboards: WebDashboard[],
  front: WebFront,
  tileNames: Record<string, Record<string, string>>,
};

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

const SUB_ROW = /^\s+–\s*/; // `\u2003\u2003– Colour`: a row under the group head above it
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

/** Another app's widget type (`homey:app:<appId>:<widgetId>`), split; null for ours, a malformed one or our own app's. */
export function foreignWidget(type: unknown, ownAppId: string): { appId: string, widgetId: string } | null {
  const m = typeof type === 'string' ? FOREIGN.exec(type) : null;
  return m && m[1] !== ownAppId ? { appId: m[1], widgetId: m[2] } : null;
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
    /** The tile names, which a duplicate, a backup and a restore take along. */
    private tileNames?: TileNameService,
  ) {}

  /** The manifest's widgets, by id. */
  private get manifestWidgets(): Record<string, any> {
    return (this.homey.manifest as any)?.widgets ?? {};
  }

  private get ownAppId(): string {
    return String((this.homey.manifest as any)?.id ?? '');
  }

  /** Whether the web dashboards are turned on (the app settings page). Off, every `/web/…` route but the setup refuses. */
  get enabled(): boolean {
    return this.homey.settings.get(WEB_ENABLED_SETTING) === true;
  }

  /** Whether the page may work away from home, through Homey's cloud (the app settings page's Remote access). */
  get remote(): boolean {
    return this.homey.settings.get(WEB_REMOTE_SETTING) === true;
  }

  /** Refuses while turned off, or away from home (`away`, the page's `?away=1`) without remote access. */
  assertEnabled(away = false) {
    if (!this.enabled) throw new Error('Web dashboards are turned off');
    if (away && !this.remote) throw new Error('Web dashboards are turned off away from home');
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

  /** The front page's choices (the carousel shows unless turned off; no sections until some are added). */
  front(): WebFront {
    const saved = this.homey.settings.get(WEB_FRONT_SETTING);
    return frontOf(saved);
  }

  /**
   * The front page's edit mode: `sections` (all of them, in order; a dashboard in one left out goes to none), `placement`
   * (`{dashboardId: sectionId | null}`, only the dashboards it names), `order` (dashboard ids, first to last: those it
   * doesn't name keep their order after them) and `widgets` (the carousel), each only when given. Answers the
   * dashboards and the choices as kept.
   */
  saveFront(input: unknown): { dashboards: WebDashboard[], front: WebFront } {
    const body = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    const front = this.front();
    if (Array.isArray(body.sections)) front.sections = sectionsOf(body.sections);
    if (typeof body.widgets === 'boolean') front.widgets = body.widgets;
    if (Array.isArray(body.sections) || typeof body.widgets === 'boolean') this.homey.settings.set(WEB_FRONT_SETTING, front);
    const placement = body.placement && typeof body.placement === 'object' && !Array.isArray(body.placement)
      ? body.placement as Record<string, unknown> : null;
    if (placement || Array.isArray(body.sections)) {
      const known = new Set(front.sections.map(x => x.id));
      let changed = false;
      const all = this.list().map((d) => {
        const given = placement && Object.prototype.hasOwnProperty.call(placement, d.id) ? placement[d.id] : d.section;
        const section = typeof given === 'string' && known.has(given) ? given : undefined;
        if (section === d.section) return d;
        changed = true;
        const { section: _, ...rest } = d;
        return section ? { ...rest, section } : rest;
      });
      if (changed) this.homey.settings.set(WEB_DASHBOARDS_SETTING, all);
    }
    if (Array.isArray(body.order)) {
      const ids: unknown[] = body.order;
      const all = this.list();
      const rank = new Map<unknown, number>();
      ids.forEach((id, i) => { if (!rank.has(id)) rank.set(id, i); });
      const sorted = all
        .map((d, i) => ({ d, key: rank.has(d.id) ? rank.get(d.id)! : ids.length + i }))
        .sort((a, b) => a.key - b.key)
        .map(x => x.d);
      if (sorted.some((d, i) => d !== all[i])) this.homey.settings.set(WEB_DASHBOARDS_SETTING, sorted);
    }
    return { dashboards: this.list(), front: this.front() };
  }

  /**
   * Copies a dashboard, named `<name> (copy)`, right after it. Its widgets keep their ids (unique per dashboard only) and
   * their tile names; running timers stay with the original.
   */
  duplicate(id: string): { dashboard: WebDashboard, dashboards: WebDashboard[] } {
    const all = this.list();
    const i = all.findIndex(d => d.id === id);
    if (i < 0) throw new Error('No such dashboard');
    if (all.length >= MAX_DASHBOARDS) throw new Error(`At most ${MAX_DASHBOARDS} dashboards`);
    const from = all[i];
    let copyId = newId();
    while (all.some(d => d.id === copyId)) copyId = newId();
    const original = from.name || this.homey.__('web.untitled') || 'Dashboard';
    const name = this.homey.__('web.copyName', { name: original }) || `${original} (copy)`;
    const dashboard = this.normalize({ ...from, id: copyId, name });
    all.splice(i + 1, 0, dashboard);
    this.homey.settings.set(WEB_DASHBOARDS_SETTING, all);
    for (const w of dashboard.columns.flat()) this.tileNames?.copy(`web-${from.id}-${w.id}`, `web-${dashboard.id}-${w.id}`);
    return { dashboard, dashboards: all };
  }

  /** The web dashboards as one file (`WebBackup`): every one, or only those `ids` names (in their stored order). */
  backup(ids?: string[]): WebBackup {
    const dashboards = ids ? this.list().filter(d => ids.includes(d.id)) : this.list();
    const instances = instanceIds(dashboards);
    return {
      format: WEB_BACKUP_FORMAT,
      version: WEB_BACKUP_VERSION,
      app: String((this.homey.manifest as any)?.version ?? ''),
      exportedAt: new Date().toISOString(),
      dashboards,
      front: this.front(),
      tileNames: this.tileNames?.entries(id => instances.has(id)) ?? {},
    };
  }

  /**
   * Restores a backup's dashboards (`backup()`, or the ones the page let through), each checked as a saved one is, ids
   * kept, so the tile names and Dashboard Shortcuts' choices match again: one with a stored id replaces that dashboard
   * in place, a new one goes at the end while there's room (at most 64; the rest are skipped). The other dashboards stay
   * as they are. The restored dashboards' tile names are the file's; the front page's choices only when `complete`
   * (the page sent every dashboard in the file), else the file's sections they're in that aren't here yet. Answers the
   * counts.
   */
  restore(input: unknown): { dashboards: number, widgets: number, skipped: number } {
    const b = (input && typeof input === 'object' ? input : {}) as Record<string, any>;
    if (b.format !== WEB_BACKUP_FORMAT || b.version !== WEB_BACKUP_VERSION || !Array.isArray(b.dashboards)) {
      throw new Error('Not a Widgetkeeper backup');
    }
    const all = this.list();
    const restored: WebDashboard[] = [];
    const replaced: WebDashboard[] = [];
    let skipped = 0;
    for (const d of b.dashboards) {
      if (!d || typeof d !== 'object') continue;
      const dashboard = this.normalize(d, true);
      while (restored.some(x => x.id === dashboard.id)) dashboard.id = newId(); // its names stay with the first
      const i = all.findIndex(x => x.id === dashboard.id);
      if (i >= 0) {
        replaced.push(all[i]);
        all[i] = dashboard;
      } else if (all.length < MAX_DASHBOARDS) {
        all.push(dashboard);
      } else {
        skipped++;
        continue;
      }
      restored.push(dashboard);
    }
    this.homey.settings.set(WEB_DASHBOARDS_SETTING, all);
    const fileFront = frontOf(b.front);
    if (b.complete === true) {
      this.homey.settings.set(WEB_FRONT_SETTING, fileFront);
    } else {
      const front = this.front();
      const wanted = fileFront.sections.filter(x => restored.some(d => d.section === x.id) && !front.sections.some(y => y.id === x.id));
      if (wanted.length) this.homey.settings.set(WEB_FRONT_SETTING, { ...front, sections: sectionsOf([...front.sections, ...wanted]) });
    }
    const instances = instanceIds(restored);
    const before = instanceIds(replaced);
    const given = b.tileNames && typeof b.tileNames === 'object' && !Array.isArray(b.tileNames) ? b.tileNames : {};
    const names = Object.fromEntries(Object.keys(given).filter(id => instances.has(id)).map(id => [id, given[id]]));
    if (restored.length) this.tileNames?.replace(id => instances.has(id) || before.has(id), names);
    const widgets = restored.reduce((n, d) => n + d.columns.reduce((m, c) => m + c.length, 0), 0);
    this.log(`Web dashboards: restored ${restored.length} dashboards (${replaced.length} replaced), ${widgets} widgets, ${skipped} skipped`);
    return { dashboards: restored.length, widgets, skipped };
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
          label: labels.get(String(s.id))!, // settingSections() labels every setting
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

  /**
   * The devices a widget's `devices` setting may pick (its manifest filter), by name, with their rooms and icons. For
   * another app's widget the page sends its filter (`foreign`), as only the page can read that app's manifest.
   */
  async devices(type: string, query = '', foreign: ForeignDeviceFilter = {}): Promise<WebDevice[]> {
    const other = foreignWidget(type, this.ownAppId);
    const w = other ? null : this.manifestWidgets[type];
    if (!other && !w?.devices) throw new Error(`No devices setting: ${type}`);
    const filter = other ? { class: foreign.class || undefined, capabilities: foreign.capabilities || undefined } : w.devices.filter;
    const [devices, zones] = await devicesAndZones(this.homey);
    return devices
      .filter(d => passesDeviceFilter(d, filter))
      .filter(d => !other || !foreign.app || deviceApp(d) === `homey:app:${other.appId}`)
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
    const own = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
    const listener = own(this.autocompletes, type) && own(this.autocompletes[type], setting) ? this.autocompletes[type][setting] : undefined;
    if (typeof listener !== 'function') throw new Error(`No autocomplete: ${type} ${setting}`);
    return listener(String(query ?? ''), settings && typeof settings === 'object' ? settings : {});
  }

  /**
   * Dashboard Shortcuts' state: each picked dashboard's name (`missing` for a deleted one), and `current`, the dashboard
   * holding the widget instance (`web-<dashboard>-<widget>`, as the page names its frames; both ids may hold `-`, so
   * it's matched against every Dashboard Shortcuts widget rather than split).
   */
  shortcuts(ids: string[], instance?: string): { current: string | null, tiles: ({ id: string, name: string } | { id: string, missing: true })[] } {
    const all = this.list();
    const byId = new Map(all.map(d => [d.id, d]));
    const holder = typeof instance === 'string' && instance.startsWith('web-')
      ? all.find(d => d.columns.some(col => col.some(w => w.type === 'shortcuts' && instance === `web-${d.id}-${w.id}`)))
      : undefined;
    return {
      current: holder?.id ?? null,
      tiles: ids.map((id) => {
        const d = byId.get(id);
        return d ? { id, name: d.name || this.homey.__('web.untitled') || 'Dashboard' } : { id, missing: true as const };
      }),
    };
  }

  /** Dashboard Shortcuts' `dashboardN` autocomplete: `None`, then every web dashboard by name, with its widget count. */
  dashboardItems(query: string): AutocompleteItem[] {
    return withNone(this.homey.__('shortcuts.none') || 'None', query, this.dashboardList(query));
  }

  /** Every web dashboard matching the query, by name, with its widget count (also the Popups cards' screens). */
  dashboardList(query: string): AutocompleteItem[] {
    return this.list()
      .map((d) => {
        const name = d.name || this.homey.__('web.untitled') || 'Dashboard';
        const count = d.columns.reduce((n, c) => n + c.length, 0);
        return { id: d.id, name, description: this.homey.__('web.widgetCount', { count }) || `${count} widgets` };
      })
      .filter(i => matches(query, i.name))
      .sort((a, b) => a.name.localeCompare(b.name));
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
      remote: this.remote,
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
    const background: WebBackground = (WEB_BACKGROUNDS as readonly unknown[]).includes(d.background) ? d.background : 'default';
    const width: WebColumnWidth = (WEB_COLUMN_WIDTHS as readonly unknown[]).includes(d.columnWidth) ? d.columnWidth : 'normal';
    const columnsIn: unknown[] = Array.isArray(d.columns) ? d.columns.slice(0, MAX_COLUMNS) : [];
    const ids = new Set<string>();
    const given = new Map<WebWidget, Record<string, any>>();
    let count = 0;
    const columns = columnsIn.map((col) => {
      const widgets: WebWidget[] = [];
      for (const w of Array.isArray(col) ? col : []) {
        if (count >= MAX_WIDGETS) break;
        const widget = this.normalizeWidget(w, ids);
        if (!widget) continue;
        widgets.push(widget);
        given.set(widget, w as Record<string, any>);
        count += 1;
      }
      return widgets;
    });
    if (!columns.length) columns.push([]);
    // A wide widget's columns, now that every column's widgets are known: no further than the last column.
    columns.forEach((col, c) => col.forEach((widget, i) => {
      const w = given.get(widget)!;
      const span = Number.isFinite(w.span) ? Math.min(Math.max(Math.round(w.span), 1), columns.length - c) : 1;
      if (span < 2) return;
      const at = Array.isArray(w.at) ? w.at : [];
      widget.span = span;
      widget.at = Array.from({ length: span - 1 }, (_, j) => {
        const n = columns[c + 1 + j].length;
        return Number.isFinite(at[j]) ? Math.min(Math.max(Math.round(at[j]), 0), n) : Math.min(i, n);
      });
    }));
    const section = typeof d.section === 'string' && ID.test(d.section) ? d.section : null;
    return { id, name, theme, background, columns, ...(section ? { section } : {}), ...(width !== 'normal' ? { columnWidth: width } : {}) };
  }

  private normalizeWidget(input: unknown, ids: Set<string>): WebWidget | null {
    if (!input || typeof input !== 'object') return null;
    const w = input as Record<string, any>;
    const def = typeof w.type === 'string' && Object.prototype.hasOwnProperty.call(this.manifestWidgets, w.type)
      ? this.manifestWidgets[w.type] : null;
    const foreign = def ? null : foreignWidget(w.type, this.ownAppId);
    if (!def && !foreign) return null;
    let id = typeof w.id === 'string' && ID.test(w.id) ? w.id : newId();
    while (ids.has(id)) id = newId();
    ids.add(id);
    const title = typeof w.title === 'string' ? w.title.trim().slice(0, 60) : '';
    if (!def) {
      // Another app's widget: only the page can read its manifest (with its key), so its settings are kept as plain values.
      const deviceIds = Array.isArray(w.deviceIds) ? deviceIdList(w.deviceIds, MAX_DEVICES) : [];
      return {
        id, type: w.type, title, settings: foreignSettings(w.settings), deviceIds,
        ...(w.trusted === true ? { trusted: true as const } : {}), ...(w.scaled === true ? { scaled: true as const } : {}),
      };
    }
    const given = w.settings && typeof w.settings === 'object' ? w.settings as Record<string, unknown> : {};
    const settings: Record<string, unknown> = {};
    for (const s of Array.isArray(def.settings) ? def.settings : []) {
      const value = Object.prototype.hasOwnProperty.call(given, s.id) ? settingValue(s, given[s.id]) : undefined;
      settings[s.id] = value === undefined ? (s.value ?? null) : value;
    }
    const deviceIds = def.devices && Array.isArray(w.deviceIds)
      ? deviceIdList(w.deviceIds, def.devices.singular ? 1 : MAX_DEVICES)
      : [];
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
    case 'autocomplete':
      return value === null ? null : autocompleteItem(value);
    default:
      return undefined;
  }
}

/**
 * An autocomplete's choice as Homey keeps it: the item's own fields (an `id`, or the thermostat's `capabilityId` and
 * `value`), without the image (Flow Buttons' icons are data URLs); undefined for what isn't one.
 */
function autocompleteItem(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>).slice(0, 10)) {
    if (k === 'image' || k.length > 40 || isReservedKey(k)) continue;
    if (typeof v === 'string') item[k] = v.slice(0, 200);
    else if (v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) item[k] = v;
  }
  return typeof item.name === 'string' ? item : undefined;
}

/**
 * Another app's widget settings, without its manifest: at most `MAX_FOREIGN_SETTINGS`, each a plain value (a
 * checkbox's, number's, text's or dropdown's) or an autocomplete's choice; anything else is dropped.
 */
function foreignSettings(input: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) return out;
  let count = 0;
  for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
    if (count >= MAX_FOREIGN_SETTINGS) break;
    if (k.length > 40 || isReservedKey(k)) continue;
    const value = v === null || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v)) ? v
      : typeof v === 'string' ? v.slice(0, MAX_TEXT)
        : autocompleteItem(v);
    if (value === undefined) continue;
    out[k] = value;
    count += 1;
  }
  return out;
}

/** The dashboards' widget instances, as the page names their frames (`web-<dashboard>-<widget>`). */
function instanceIds(dashboards: WebDashboard[]): Set<string> {
  return new Set(dashboards.flatMap(d => d.columns.flat().map(w => `web-${d.id}-${w.id}`)));
}

/** Device ids, each once, at most `max`. */
function deviceIdList(list: unknown[], max: number): string[] {
  return [...new Set(list.filter((x: unknown): x is string => typeof x === 'string' && ID.test(x)))].slice(0, max);
}

/** The front page's choices as kept (`WebFront`), from what's stored or a backup's. */
function frontOf(saved: unknown): WebFront {
  const f = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  return { widgets: f.widgets !== false, sections: sectionsOf(Array.isArray(f.sections) ? f.sections : []) };
}

/** Sections as kept: an id (unique) and a name each, at most `MAX_SECTIONS`. */
function sectionsOf(input: unknown[]): WebSection[] {
  const out: WebSection[] = [];
  for (const x of input) {
    if (out.length >= MAX_SECTIONS) break;
    const s = (x && typeof x === 'object' ? x : {}) as Record<string, unknown>;
    if (typeof s.id !== 'string' || !ID.test(s.id) || out.some(y => y.id === s.id)) continue;
    out.push({ id: s.id, name: typeof s.name === 'string' ? s.name.trim().slice(0, 60) : '' });
  }
  return out;
}

function newId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}
