// Globals the widget scripts (widgets/*/public/widget.js) put on `window` for their index.html.
interface Window {
  createElectricityWidget: (root: HTMLElement, opts?: object) => object;
  createThermostatWidget: (root: HTMLElement, opts?: object) => object;
  createQuickActionsWidget: (root: HTMLElement, opts?: object) => object;
  createSensorAlarmsWidget: (root: HTMLElement, opts?: object) => object;
  createWeatherWidget: (root: HTMLElement, opts?: object) => object;
  createCamerasWidget: (root: HTMLElement, opts?: object) => object;
  createHeatmapWidget: (root: HTMLElement, opts?: object) => object;
  createValuesWidget: (root: HTMLElement, opts?: object) => object;
  createLightsWidget: (root: HTMLElement, opts?: object) => object;
  formatCapabilityValue: (cap: object, value: unknown, t: (key: string) => string) => string;
  heatmapPeriodDays: (period: string | undefined) => number;
  thermostatPresetsFromSettings: (settings: Record<string, any>) => { values: object[] }[];
}
