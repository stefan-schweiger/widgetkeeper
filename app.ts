import Homey from 'homey';
import Diagnostics from './lib/Diagnostics.js';
import ElectricityService from './lib/ElectricityService.js';
import ThermostatService from './lib/ThermostatService.js';

export default class WidgetkeeperApp extends Homey.App {

  diagnostics!: Diagnostics;
  electricity!: ElectricityService;
  thermostat!: ThermostatService;

  async onInit() {
    this.diagnostics = new Diagnostics(this.homey);
    const log = this.log.bind(this);
    this.electricity = new ElectricityService(this.homey, log);
    this.electricity.start();
    this.thermostat = new ThermostatService(this.homey, log);
    this.thermostat.start();
    this.registerThermostatSettings();
    this.log('Widgetkeeper has been initialized');
  }

  /** Everything logged also goes to the in-memory diagnostics log (app settings page). */
  log(...args: any[]) {
    super.log(...args);
    this.diagnostics?.add(args.some(a => a instanceof Error) ? 'error' : 'info', args);
  }

  error(...args: any[]) {
    super.error(...args);
    this.diagnostics?.add('error', args);
  }

  async onUninit() {
    await this.electricity?.stop();
    await this.thermostat?.stop();
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
