import Homey from 'homey';
import Diagnostics, { DEBUG_LOG_SETTING } from './lib/Diagnostics.js';
import { getAppApi } from './lib/appApi.js';
import ElectricityService from './lib/ElectricityService.js';
import QuickActionService from './lib/QuickActionService.js';
import ThermostatService from './lib/ThermostatService.js';

export default class WidgetkeeperApp extends Homey.App {

  diagnostics!: Diagnostics;
  electricity!: ElectricityService;
  thermostat!: ThermostatService;
  quickActions!: QuickActionService;

  async onInit() {
    this.diagnostics = new Diagnostics(this.homey);
    const log = this.log.bind(this);
    const debug = this.debug.bind(this);
    this.electricity = new ElectricityService(this.homey, log, debug);
    this.electricity.start();
    // Connect to Homey's API and fetch the prices now, not when the first widget asks.
    getAppApi(this.homey).catch(err => this.log('Could not connect to the Homey API', err));
    this.electricity.warmUp();
    this.thermostat = new ThermostatService(this.homey, log, debug);
    this.thermostat.start();
    this.registerThermostatSettings();
    this.quickActions = new QuickActionService(this.homey, log, debug);
    this.quickActions.start();
    this.debug('Widgetkeeper has been initialized');
  }

  /** Everything logged also goes to the in-memory diagnostics log (app settings page). */
  log(...args: any[]) {
    super.log(...args);
    this.diagnostics?.add(args.some(a => a instanceof Error) ? 'error' : 'info', args);
  }

  /**
   * Routine detail (tracking, timings, applies): logged only while the `debugLog` app setting is on.
   * `npm run diagnostics -- --debug on` turns it on.
   */
  debug(...args: any[]) {
    if (this.homey.settings.get(DEBUG_LOG_SETTING) === true) this.log(...args);
  }

  error(...args: any[]) {
    super.error(...args);
    this.diagnostics?.add('error', args);
  }

  async onUninit() {
    await this.electricity?.stop();
    await this.thermostat?.stop();
    await this.quickActions?.stop();
  }

  /** Autocomplete for the thermostat widget: the device, then per-button options read from it. */
  private registerThermostatSettings() {
    const widget = this.homey.dashboards.getWidget('thermostat');
    widget.registerSettingAutocompleteListener('device', query => this.thermostat.listDevices(query));
    for (const n of [1, 2, 3]) {
      widget.registerSettingAutocompleteListener(`b${n}Temp`, (query, settings) => this.thermostat.listTemperatures(settings?.device?.id, query));
      for (const field of ['Mode', 'Extra']) {
        widget.registerSettingAutocompleteListener(`b${n}${field}`, (query, settings) => this.thermostat.listEnumOptions(settings?.device?.id, query));
      }
    }
  }

}
