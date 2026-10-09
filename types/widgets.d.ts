// Globals the widget scripts (widgets/*/public/widget.js) put on `window` for their index.html.
interface Window {
  createElectricityWidget: (root: HTMLElement, opts?: object) => object;
  createThermostatWidget: (root: HTMLElement, opts?: object) => object;
  createQuickActionsWidget: (root: HTMLElement, opts?: object) => object;
  createSensorAlarmsWidget: (root: HTMLElement, opts?: object) => object;
  createSensorDotsWidget: (root: HTMLElement, opts?: object) => object;
  createWeatherWidget: (root: HTMLElement, opts?: object) => object;
  createCamerasWidget: (root: HTMLElement, opts?: object) => object;
  createHeatmapWidget: (root: HTMLElement, opts?: object) => object;
  createValuesWidget: (root: HTMLElement, opts?: object) => object;
  createLightsWidget: (root: HTMLElement, opts?: object) => object;
  createSparklinesWidget: (root: HTMLElement, opts?: object) => object;
  createVariablesWidget: (root: HTMLElement, opts?: object) => object;
  variableStepValue: (value: unknown, step: number, dir: number) => number;
  parseVariableNumber: (text: string) => number | null;
  createFlowsWidget: (root: HTMLElement, opts?: object) => object;
  FLOW_BUTTON_ICONS: string[];
  FLOW_BUTTON_ICON_PATHS: Record<string, { d: string, fill?: boolean }>;
  createPriceWidget: (root: HTMLElement, opts?: object) => object;
  electricityPriceLevel: (price: number | null, prices: (number | null)[]) => 'low' | 'medium' | 'high' | null;
  createTimersWidget: (root: HTMLElement, opts?: object) => object;
  formatTimerRemaining: (ms: number) => string;
  timerPresetsFromSettings: (settings: Record<string, any>) => { minutes: number, label: string }[];
  createLocksWidget: (root: HTMLElement, opts?: object) => object;
  lockLevel: (device: object) => 'secure' | 'insecure' | 'unknown' | 'missing';
  createCurtainsWidget: (root: HTMLElement, opts?: object) => object;
  curtainAction: (c: object, rule?: string) => 'open' | 'close' | 'stop' | null;
  createMediaWidget: (root: HTMLElement, opts?: object) => object;
  mediaSource: (caps: object) => 'tv' | 'lineIn' | null;
  mediaButtonsFromSettings: (settings: object) => { id: string, name: string }[];
  sparkPath: (points: [number, number][], from: number, to: number, w: number, h: number) => { line: string, area: string, dot: { x: number, y: number }, min: number, max: number } | null;
  formatCapabilityValue: (cap: object, value: unknown, t: (key: string) => string) => string;
  heatmapPeriodDays: (period: string | undefined) => number;
  thermostatPresetsFromSettings: (settings: Record<string, any>) => { values: object[] }[];
}
