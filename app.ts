import Homey from 'homey';
import Diagnostics, { DEBUG_LOG_SETTING } from './lib/Diagnostics.js';
import { getAppApi } from './lib/appApi.js';
import CameraService from './lib/CameraService.js';
import ElectricityService from './lib/ElectricityService.js';
import HeatmapService from './lib/HeatmapService.js';
import LightService from './lib/LightService.js';
import QuickActionService from './lib/QuickActionService.js';
import SensorAlarmService from './lib/SensorAlarmService.js';
import SparklineService from './lib/SparklineService.js';
import ThermostatService from './lib/ThermostatService.js';
import ValueService from './lib/ValueService.js';
import WeatherService from './lib/WeatherService.js';

const VALUE_SLOTS = [1, 2, 3, 4, 5, 6];

export default class WidgetkeeperApp extends Homey.App {

  diagnostics!: Diagnostics;
  electricity!: ElectricityService;
  thermostat!: ThermostatService;
  quickActions!: QuickActionService;
  sensorAlarms!: SensorAlarmService;
  weather!: WeatherService;
  heatmap!: HeatmapService;
  cameras!: CameraService;
  values!: ValueService;
  lights!: LightService;
  sparklines!: SparklineService;

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
    this.sensorAlarms = new SensorAlarmService(this.homey, log, debug);
    this.sensorAlarms.start();
    this.weather = new WeatherService(this.homey, log, debug);
    this.weather.start();
    this.heatmap = new HeatmapService(this.homey, log, debug);
    this.heatmap.start();
    this.registerHeatmapSettings();
    this.cameras = new CameraService(this.homey, log, debug);
    this.values = new ValueService(this.homey, log, debug);
    this.values.start();
    this.registerValueSettings();
    this.lights = new LightService(this.homey, log, debug);
    this.lights.start();
    this.sparklines = new SparklineService(this.homey, this.values, log, debug);
    this.sparklines.start();
    this.registerSparklineSettings();
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
    await this.sensorAlarms?.stop();
    await this.weather?.stop();
    await this.heatmap?.stop();
    await this.cameras?.stop();
    await this.values?.stop();
    await this.lights?.stop();
    await this.sparklines?.stop();
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

  /** Autocomplete for the heatmap widget: the device, then one of its logged capabilities. */
  private registerHeatmapSettings() {
    const widget = this.homey.dashboards.getWidget('heatmap');
    widget.registerSettingAutocompleteListener('device', query => this.heatmap.listDevices(query));
    widget.registerSettingAutocompleteListener('capability', (query, settings) => this.heatmap.listCapabilities(settings?.device?.id, query));
  }

  /** Autocomplete for the device values widget: every tile slot lists all `Device · Capability` pairs. */
  private registerValueSettings() {
    const widget = this.homey.dashboards.getWidget('values');
    for (const n of VALUE_SLOTS) {
      widget.registerSettingAutocompleteListener(`slot${n}`, query => this.values.listSlots(query));
    }
  }

  /** Autocomplete for the sparklines widget: every tile slot lists all logged `Device · Capability` numbers. */
  private registerSparklineSettings() {
    const widget = this.homey.dashboards.getWidget('sparklines');
    for (const n of VALUE_SLOTS) {
      widget.registerSettingAutocompleteListener(`slot${n}`, query => this.sparklines.listSlots(query));
    }
  }

}
