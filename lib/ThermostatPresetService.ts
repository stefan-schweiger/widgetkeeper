import type Homey from 'homey';
import { matches, type AutocompleteItem } from './autocomplete.js';
import { KeyError } from './PersonalApiKey.js';
import { dashboardPages } from './StackService.js';
import type { CapValue } from './ThermostatService.js';
import {
  deviceValues, modeCapOf, presetLabel, presetMatches, presetsFromSettings, slotted, widgetModeCap,
  type Preset, type PresetCaps, type PresetValue,
} from './thermostatPresets.js';
import type { WebDashboard } from './WebDashboardService.js';

export const THERMOSTAT_RUN_CARD = 'thermostat_run_preset';
export const THERMOSTAT_ACTIVE_CARD = 'thermostat_preset_active';
export const THERMOSTAT_TAPPED_CARD = 'thermostat_preset_tapped';

/** The trigger's "Any button" item (recognised by `any`; the id only has to differ from a button's). */
const ANY_ID = 'thermostat:any';
/** The item that says buttons on Homey's dashboards need the key. */
const KEY_ID = 'none';
/** The longest widget instance id a tap may carry (a web one is `web-<dashboardId>-<widgetId>`). */
const MAX_INSTANCE = 200;

/** A button as the Flow cards keep it, to run when its widget can't be read: its device, values and the widget's mode capability. */
type ButtonSnapshot = { deviceId: string, values: PresetValue[], modeCap: string | null };

/** The cards' `preset` argument: an item of `listButtons()`. */
export type ButtonArg = { id?: string, name?: string, any?: boolean, preset?: ButtonSnapshot } | null | undefined;

/** A Thermostat Presets widget on a dashboard; `instance` is what its `Homey.getWidgetInstanceId()` gives. */
type PresetWidget = { instance: string, dashboard: string, settings: Record<string, any> };

type Tokens = { device: string, preset: string, button: number };

type Deps = {
  thermostat: {
    getState(deviceId: string): Promise<{ name: string, values: Record<string, unknown>, caps: PresetCaps } | { missing: true }>,
    apply(deviceId: string, values: CapValue[]): Promise<void>,
  },
  stack: { dashboards(fresh?: boolean): Promise<any[]> },
  web: { list(): WebDashboard[], enabled: boolean },
  /** Fires the trigger *… was tapped* (`state.id`: the button's, for the Flows of that button). */
  onTap: (tokens: Tokens, state: { id: string }) => Promise<unknown>,
};

/** A web dashboard widget's instance id, as the web page gives its frame. */
const webInstance = (dashboardId: string, widgetId: string) => `web-${dashboardId}-${widgetId}`;

/**
 * Thermostat Presets' Flow cards: *Run …*, the condition *… is active* and the trigger *… was tapped*, each for one
 * button of a widget on a dashboard (Homey's own, read through the personal API key as the Smart Stack does, or a web
 * dashboard). A card follows the button's current settings, and runs what it saved when the button was picked while the
 * widget can't be read (no key, or the widget is gone).
 */
export default class ThermostatPresetService {

  private runs = 0;
  private saved = 0;
  private taps = 0;
  private lastError: string | null = null;

  constructor(
    private homey: Homey.App['homey'],
    private deps: Deps,
    private log: (...args: any[]) => void, // errors and warnings: always kept
    private debug: (...args: any[]) => void = () => {}, // routine detail: only with the `debugLog` setting on
  ) {}

  // ---------------------------------------------------------------- the argument

  /**
   * Every button of every Thermostat Presets widget: those on Homey's dashboards (by name), then the web dashboards'
   * (while they're on). Without a usable key, an item at the end says why Homey's are missing. `any` puts *Any button*
   * first (the trigger).
   */
  async listButtons(query: string, { any = false } = {}): Promise<(AutocompleteItem & { any?: boolean, preset?: ButtonSnapshot })[]> {
    const t = (key: string, fallback: string, tokens?: object) => this.homey.__(key, tokens) || fallback;
    let native: PresetWidget[] = [];
    let keyProblem: KeyError | null = null;
    try {
      native = this.nativeWidgets(await this.deps.stack.dashboards(true))
        .sort((a, b) => a.dashboard.localeCompare(b.dashboard));
    } catch (err) {
      if (err instanceof KeyError) keyProblem = err;
      else this.log("Thermostat Presets cards: Homey's dashboards could not be read:", err);
    }
    const web = this.deps.web.enabled ? this.webWidgets() : [];
    const words = { off: t('thermostat.off', 'Off'), on: t('thermostat.on', 'On') };
    const language = this.homey.i18n.getLanguage();
    const items: (AutocompleteItem & { any?: boolean, preset?: ButtonSnapshot })[] = [];
    for (const [widgets, isWeb] of [[native, false], [web, true]] as const) {
      for (const w of widgets) {
        const deviceId = w.settings.device?.id;
        if (typeof deviceId !== 'string' || !deviceId) continue;
        const presets = presetsFromSettings(w.settings);
        const modeCap = widgetModeCap(presets);
        const title = (typeof w.settings.title === 'string' && w.settings.title.trim())
          || (typeof w.settings.device?.name === 'string' ? w.settings.device.name : '');
        const where = isWeb ? t('thermostat.web', `${w.dashboard} (web)`, { name: w.dashboard }) : w.dashboard;
        presets.forEach((p, i) => {
          if (!p.values.length) return;
          const label = presetLabel(p, {}, modeCapOf(modeCap, {}), words, language);
          const button = t('thermostat.button', `Button ${i + 1}`, { n: i + 1 });
          const name = [title, label || button].filter(Boolean).join(' · ');
          const item = { id: `${w.instance}:${i + 1}`, name, description: `${where} · ${button}` };
          if (matches(query, item.name, item.description)) items.push({ ...item, preset: { deviceId, values: p.values, modeCap } });
        });
      }
    }
    const anyName = t('thermostat.anyButton', 'Any button');
    if (any && matches(query, anyName)) items.unshift({ id: ANY_ID, name: anyName, any: true });
    if (keyProblem) {
      items.push({
        id: KEY_ID,
        name: t('thermostat.keyItem', "Buttons on Homey's dashboards need an API key"),
        description: keyProblem.reason === 'noKey'
          ? t('stack.keyHint', 'Widgetkeeper → Configure: an API key with the Homey permission.')
          : t(`stack.${keyProblem.reason}`, keyProblem.reason),
      });
    }
    return items;
  }

  /** The Thermostat Presets widgets of Homey's dashboards, column by column. */
  private nativeWidgets(dashboards: any[]): PresetWidget[] {
    return dashboards.flatMap(d => dashboardPages(d, this.homey.manifest.id)
      .filter(p => p.type === 'thermostat')
      .map(p => ({ instance: p.id, dashboard: String(d?.name ?? ''), settings: p.settings as Record<string, any> })));
  }

  /** The web dashboards' Thermostat Presets widgets, in the dashboards' order, column by column. */
  private webWidgets(): PresetWidget[] {
    return this.deps.web.list().flatMap(d => d.columns.flat()
      .filter(w => w.type === 'thermostat')
      .map(w => ({ instance: webInstance(d.id, w.id), dashboard: d.name, settings: w.settings as Record<string, any> })));
  }

  /**
   * The button an argument names, from its widget's current settings; while the widget can't be read (the key, a
   * passing failure) or is gone, the button as it was when picked. Throws for *Any button*, the key item or an empty button.
   */
  async resolve(arg: ButtonArg): Promise<{ deviceId: string, preset: Preset, modeCap: string | null }> {
    const id = typeof arg?.id === 'string' ? arg.id : '';
    const at = id.lastIndexOf(':');
    const n = Number(id.slice(at + 1));
    if (arg?.any || at < 1 || !(n >= 1 && n <= 3)) throw new Error('Pick a button');
    let widget: PresetWidget | null = null;
    let why = 'its widget is gone';
    try {
      widget = await this.findWidget(id.slice(0, at));
    } catch (err) {
      why = `Homey's dashboards could not be read (${String((err as any)?.reason ?? (err as any)?.message ?? err)})`;
    }
    if (widget) {
      const deviceId = widget.settings.device?.id;
      if (typeof deviceId !== 'string' || !deviceId) throw new Error('The widget has no thermostat');
      const presets = presetsFromSettings(widget.settings);
      if (!presets[n - 1].values.length) throw new Error('This button sets nothing');
      return { deviceId, preset: presets[n - 1], modeCap: widgetModeCap(presets) };
    }
    const saved = arg?.preset;
    const values = Array.isArray(saved?.values) ? saved!.values.filter(v => v && typeof v.capabilityId === 'string') : [];
    if (typeof saved?.deviceId !== 'string' || !values.length) throw new Error('Button not found');
    this.saved++;
    this.debug(`Thermostat Presets card ${id}: the button as saved in the card, as ${why}`);
    return { deviceId: saved!.deviceId, preset: { values }, modeCap: typeof saved!.modeCap === 'string' ? saved!.modeCap : null };
  }

  /** The widget with that instance id, or null when it's gone. Throws when Homey's dashboards can't be read. */
  private async findWidget(instance: string): Promise<PresetWidget | null> {
    if (instance.startsWith('web-')) return this.webWidgets().find(w => w.instance === instance) ?? null;
    return this.nativeWidgets(await this.deps.stack.dashboards()).find(w => w.instance === instance) ?? null;
  }

  // ---------------------------------------------------------------- the cards

  /** *Run …*: sets the device as a tap on the button does (`ThermostatService.apply()`'s order and waits). */
  async run(arg: ButtonArg) {
    try {
      const { deviceId, values } = await this.deviceValues(arg);
      if (!values.length) throw new Error("This button can't be set on this device");
      await this.deps.thermostat.apply(deviceId, values.map(({ capabilityId, value }) => ({ capabilityId, value })));
      this.runs++;
    } catch (err) {
      this.lastError = String((err as any)?.message ?? err);
      throw err;
    }
  }

  /** *… is active*: whether the device matches everything the button sets, as when the widget lights it. */
  async isActive(arg: ButtonArg): Promise<boolean> {
    const { values, state, modeCap } = await this.deviceValues(arg);
    return presetMatches(state.values, values, state.caps, modeCap);
  }

  /** The button's values for its device as it is now (`deviceValues()`: without `onoff`, off through the mode). */
  private async deviceValues(arg: ButtonArg) {
    const b = await this.resolve(arg);
    const state = await this.deps.thermostat.getState(b.deviceId);
    if ('missing' in state) throw new Error('Thermostat not found');
    const modeCap = modeCapOf(b.modeCap, state.caps);
    return { deviceId: b.deviceId, values: deviceValues(b.preset, state.caps, modeCap), state, modeCap };
  }

  /**
   * A tap on a widget's button, once its values were applied (`/apply` with `instance` and `button`): fires *… was
   * tapped* with the device's name and the button's text from the values sent. Never fails the tap.
   */
  async tapped({ instance, button, deviceId, values }: { instance: unknown, button: unknown, deviceId: string, values: CapValue[] }) {
    if (typeof instance !== 'string' || !instance || instance.length > MAX_INSTANCE) return;
    if (button !== 1 && button !== 2 && button !== 3) return;
    try {
      const state = await this.deps.thermostat.getState(deviceId);
      const caps = 'missing' in state ? {} : state.caps;
      const words = { off: this.homey.__('thermostat.off') || 'Off', on: this.homey.__('thermostat.on') || 'On' };
      const modeCap = modeCapOf(null, caps);
      const preset = presetLabel(slotted(values, modeCap), caps, modeCap, words, this.homey.i18n.getLanguage());
      this.taps++;
      this.debug(`Thermostat Presets: button ${button} of ${instance} tapped`);
      await this.deps.onTap({ device: 'missing' in state ? '' : state.name, preset, button }, { id: `${instance}:${button}` });
    } catch (err) {
      this.log('Thermostat Presets: the tap trigger failed:', err);
    }
  }

  /** The trigger's run listener: the button's Flows, or every one with *Any button*. */
  matches(arg: ButtonArg, id: unknown): boolean {
    return !!arg?.any || (typeof arg?.id === 'string' && arg.id === id);
  }

  /** For the diagnostics report: counts, never names. */
  describe() {
    return { runs: this.runs, saved: this.saved, taps: this.taps, lastError: this.lastError };
  }

}
