import type WidgetkeeperApp from '../app.js';

/**
 * An item of an autocomplete setting: a `name`, and what the widget reads from the choice Homey keeps (usually an
 * `id`; the thermostat's presets carry `capabilityId` and `value` instead).
 */
export type SettingItem = { name: string, description?: string, image?: string, id?: string, [key: string]: unknown };

/** An autocomplete setting's listener: the typed query and the widget's other settings (an autocomplete as the item chosen). */
export type AutocompleteListener = (query: string, settings: Record<string, any> | undefined) => Promise<SettingItem[]>;

const VALUE_SLOTS = [1, 2, 3, 4, 5, 6];
const VARIABLE_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
const FLOW_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];
const MEDIA_BUTTONS = [1, 2, 3, 4];

/**
 * Every autocomplete setting's listener, by widget and setting id. `app.ts` registers them with Homey (the widget
 * settings in the Homey app) and the web dashboards' editor calls the same ones (`/web/autocomplete`).
 */
export function widgetAutocompletes(app: WidgetkeeperApp): Record<string, Record<string, AutocompleteListener>> {
  const table: Record<string, Record<string, AutocompleteListener>> = {};
  const add = (widget: string, setting: string, fn: AutocompleteListener) => {
    (table[widget] ??= {})[setting] = fn;
  };

  // Thermostat: the device, then per-button options read from it.
  add('thermostat', 'device', query => app.thermostat.listDevices(query));
  for (const n of [1, 2, 3]) {
    add('thermostat', `b${n}Temp`, (query, settings) => app.thermostat.listTemperatures(settings?.device?.id, query));
    for (const field of ['Mode', 'Extra']) {
      add('thermostat', `b${n}${field}`, (query, settings) => app.thermostat.listEnumOptions(settings?.device?.id, query));
    }
  }

  // Heatmap: the device, then one of its logged capabilities.
  add('heatmap', 'device', query => app.heatmap.listDevices(query));
  add('heatmap', 'capability', (query, settings) => app.heatmap.listCapabilities(settings?.device?.id, query));

  // Device values and sparklines: every tile slot lists the `Device · Capability` pairs.
  for (const n of VALUE_SLOTS) {
    add('values', `slot${n}`, query => app.values.listSlots(query));
    add('sparklines', `slot${n}`, query => app.sparklines.listSlots(query));
  }

  // Flow variables: every slot lists all Logic variables.
  for (const n of VARIABLE_SLOTS) add('variables', `slot${n}`, query => app.variables.listVariables(query));

  // Flow buttons: each button's flow and icon.
  for (const n of FLOW_SLOTS) {
    add('flows', `flow${n}`, query => app.flows.listFlows(query));
    add('flows', `icon${n}`, async query => app.flows.listIcons(query));
  }

  // Media: the speaker, then each button's Flow card of that speaker or flow, and its icon.
  add('media', 'device', query => app.media.listDevices(query));
  for (const n of MEDIA_BUTTONS) {
    add('media', `button${n}`, (query, settings) => app.media.listButtons(settings?.device?.id, query));
    add('media', `button${n}Icon`, async query => app.flows.listIcons(query, { none: true }));
  }

  // Smart Stack: the dashboard whose widgets it shows.
  add('stack', 'dashboard', query => app.stack.listDashboards(query));

  return table;
}
