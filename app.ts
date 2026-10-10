import Homey from 'homey';
import Diagnostics, { DEBUG_LOG_SETTING } from './lib/Diagnostics.js';
import { getAppApi } from './lib/appApi.js';
import CameraService from './lib/CameraService.js';
import CurtainService from './lib/CurtainService.js';
import ElectricityService from './lib/ElectricityService.js';
import FlowService from './lib/FlowService.js';
import HeatmapService from './lib/HeatmapService.js';
import LightService from './lib/LightService.js';
import LockService from './lib/LockService.js';
import MediaService from './lib/MediaService.js';
import PersonalApiKey from './lib/PersonalApiKey.js';
import QuickActionService from './lib/QuickActionService.js';
import SensorAlarmService from './lib/SensorAlarmService.js';
import SparklineService from './lib/SparklineService.js';
import StackService, { STACK_RESUME_CARD, STACK_SHOW_CARD } from './lib/StackService.js';
import ThermostatService from './lib/ThermostatService.js';
import TimerService, { TIMER_FINISHED_CARD, timerDurationText, type Timer } from './lib/TimerService.js';
import ValueService from './lib/ValueService.js';
import VariableService from './lib/VariableService.js';
import WeatherService from './lib/WeatherService.js';
import WebDashboardService from './lib/WebDashboardService.js';
import { widgetAutocompletes } from './lib/widgetAutocompletes.js';

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
  variables!: VariableService;
  flows!: FlowService;
  timers!: TimerService;
  locks!: LockService;
  curtains!: CurtainService;
  media!: MediaService;
  stack!: StackService;
  web!: WebDashboardService;
  /** The user's personal API key, shared by Flow Variables, Flow Buttons, Media and the Smart Stack (the app's token may only read). */
  apiKey!: PersonalApiKey;

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
    this.quickActions = new QuickActionService(this.homey, log, debug);
    this.quickActions.start();
    this.sensorAlarms = new SensorAlarmService(this.homey, log, debug);
    this.sensorAlarms.start();
    this.weather = new WeatherService(this.homey, log, debug);
    this.weather.start();
    this.heatmap = new HeatmapService(this.homey, log, debug);
    this.heatmap.start();
    this.cameras = new CameraService(this.homey, log, debug);
    this.values = new ValueService(this.homey, log, debug);
    this.values.start();
    this.registerValueFlows();
    this.lights = new LightService(this.homey, log, debug);
    this.lights.start();
    this.sparklines = new SparklineService(this.homey, this.values, log, debug);
    this.sparklines.start();
    this.apiKey = PersonalApiKey.for(this.homey, log);
    this.variables = new VariableService(this.homey, log, debug, this.apiKey);
    this.variables.start();
    this.flows = new FlowService(this.homey, log, debug, this.apiKey);
    this.timers = new TimerService(this.homey, log, debug, timer => this.timerFinished(timer));
    this.timers.start();
    this.locks = new LockService(this.homey, log, debug);
    this.locks.start();
    this.curtains = new CurtainService(this.homey, log, debug);
    this.curtains.start();
    this.media = new MediaService(this.homey, this.flows, log, debug, this.apiKey);
    this.media.start();
    this.stack = new StackService(this.homey, log, debug, this.apiKey);
    this.registerStackFlows();
    this.web = new WebDashboardService(this.homey, log, widgetAutocompletes(this));
    this.registerAutocompletes();
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
    await this.variables?.stop();
    await this.timers?.stop();
    await this.locks?.stop();
    await this.curtains?.stop();
    await this.media?.stop();
  }

  /** Every widget's autocomplete settings (`lib/widgetAutocompletes.ts`, which the web dashboards' editor uses too). */
  private registerAutocompletes() {
    for (const [type, listeners] of Object.entries(this.web.autocompletes)) {
      const widget = this.homey.dashboards.getWidget(type);
      for (const [setting, listener] of Object.entries(listeners)) {
        widget.registerSettingAutocompleteListener(setting, (query, settings) => listener(query, settings));
      }
    }
  }

  /** The Flow card that colours the device values tiles showing one value. */
  private registerValueFlows() {
    const card = this.homey.flow.getActionCard('values_set_color');
    card.registerArgumentAutocompleteListener('slot', query => this.values.listColorSlots(query));
    card.registerRunListener(async (args: { slot?: { id?: string }, color: string }) => {
      this.values.setColor(args.slot?.id ?? '', args.color);
    });
  }

  /** The Flow cards that bring a widget forward on every Smart Stack, and that end it. */
  private registerStackFlows() {
    this.homey.flow.getActionCard(STACK_SHOW_CARD)
      .registerRunListener(async (args: { widget: string, minutes: number }) => this.stack.show(args.widget, args.minutes));
    this.homey.flow.getActionCard(STACK_RESUME_CARD)
      .registerRunListener(async () => this.stack.resume());
  }

  /** The Flow card *A timer finished*: the timer's name (or its duration, as the widget shows it) and its minutes. */
  private timerFinished(timer: Timer) {
    const minutes = Math.round(timer.duration / 6e3) / 10;
    const name = timer.label
      || timerDurationText(timer.duration / 60e3, (key, tokens) => this.homey.__(key, tokens), this.homey.i18n.getLanguage());
    return this.homey.flow.getTriggerCard(TIMER_FINISHED_CARD).trigger({ timer: name, minutes });
  }

}
