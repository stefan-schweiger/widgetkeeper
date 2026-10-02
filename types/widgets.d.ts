// Globals the widget scripts (widgets/*/public/widget.js) put on `window` for their index.html.
interface Window {
  createElectricityWidget: (root: HTMLElement, opts?: object) => object;
  createThermostatWidget: (root: HTMLElement, opts?: object) => object;
  thermostatPresetsFromSettings: (settings: Record<string, any>) => { values: object[] }[];
}
