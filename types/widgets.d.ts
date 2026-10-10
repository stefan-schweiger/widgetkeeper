// Globals the widget scripts (widgets/*/public/widget.js and mount.js) put on `window` for their index.html.

/** A widget's mount.js: wires it to a Homey (the frame's own, or the Smart Stack's stand-in for one). */
type MountWidget = ((Homey: any, el: { root: HTMLElement, frame: HTMLElement }) => void | { setVisible?: (visible: boolean) => void })
  & { frameClass?: string };

interface Window {
  /** settings/dashboard.js, the web dashboards page; `io` is the vendored socket.io-client (settings/socket.io.js). */
  mountWebDashboards: (root: HTMLElement) => void;
  io: (url: string, opts?: object) => any;
  createElectricityWidget: (root: HTMLElement, opts?: object) => any;
  createThermostatWidget: (root: HTMLElement, opts?: object) => any;
  createQuickActionsWidget: (root: HTMLElement, opts?: object) => any;
  createSensorAlarmsWidget: (root: HTMLElement, opts?: object) => any;
  createSensorDotsWidget: (root: HTMLElement, opts?: object) => any;
  createWeatherWidget: (root: HTMLElement, opts?: object) => any;
  createCamerasWidget: (root: HTMLElement, opts?: object) => any;
  createHeatmapWidget: (root: HTMLElement, opts?: object) => any;
  createValuesWidget: (root: HTMLElement, opts?: object) => any;
  createLightsWidget: (root: HTMLElement, opts?: object) => any;
  createSparklinesWidget: (root: HTMLElement, opts?: object) => any;
  createVariablesWidget: (root: HTMLElement, opts?: object) => any;
  variableStepValue: (value: unknown, step: number, dir: number) => number;
  parseVariableNumber: (text: string) => number | null;
  createFlowsWidget: (root: HTMLElement, opts?: object) => any;
  FLOW_BUTTON_ICONS: string[];
  FLOW_BUTTON_ICON_PATHS: Record<string, { d: string, fill?: boolean }>;
  createPriceWidget: (root: HTMLElement, opts?: object) => any;
  electricityPriceLevel: (price: number | null, prices: (number | null)[]) => 'low' | 'medium' | 'high' | null;
  createTimersWidget: (root: HTMLElement, opts?: object) => any;
  formatTimerRemaining: (ms: number) => string;
  timerPresetsFromSettings: (settings: Record<string, any>) => { minutes: number, label: string }[];
  createLocksWidget: (root: HTMLElement, opts?: object) => any;
  lockLevel: (device: object) => 'secure' | 'insecure' | 'unknown' | 'missing';
  createCurtainsWidget: (root: HTMLElement, opts?: object) => any;
  curtainAction: (c: object, rule?: string) => 'open' | 'close' | 'stop' | null;
  createMediaWidget: (root: HTMLElement, opts?: object) => any;
  mediaSource: (caps: object) => 'tv' | 'lineIn' | null;
  mediaButtonsFromSettings: (settings: object) => { id: string, name: string, icon: string | null }[];
  MEDIA_BUTTON_ICON_PATHS: Record<string, { d: string, fill?: boolean }>;
  sparkPath: (points: [number, number][], from: number, to: number, w: number, h: number) => { line: string, area: string, dot: { x: number, y: number }, min: number, max: number } | null;
  formatCapabilityValue: (cap: object, value: unknown, t: (key: string) => string) => string;
  heatmapPeriodDays: (period: string | undefined) => number;
  thermostatPresetsFromSettings: (settings: Record<string, any>) => { values: object[] }[];
  mountCamerasWidget: MountWidget;
  mountCurtainsWidget: MountWidget;
  mountElectricityWidget: MountWidget;
  mountFlowsWidget: MountWidget;
  mountHeatmapWidget: MountWidget;
  mountLightsWidget: MountWidget;
  mountLocksWidget: MountWidget;
  mountMediaWidget: MountWidget;
  mountPriceWidget: MountWidget;
  mountQuickActionsWidget: MountWidget;
  mountSensorAlarmsWidget: MountWidget;
  mountSensorDotsWidget: MountWidget;
  mountSparklinesWidget: MountWidget;
  mountThermostatWidget: MountWidget;
  mountTimersWidget: MountWidget;
  mountValuesWidget: MountWidget;
  mountVariablesWidget: MountWidget;
  mountWeatherWidget: MountWidget;
  mountStackWidget: MountWidget;
  createStackWidget: (root: HTMLElement, opts?: object) => any;
  createStackAttentionWatcher: (pages: any[], io: object) => { refresh: () => Promise<unknown>, attention: (id: string) => boolean };
  stackAttention: (page: { type: string, settings?: object }, state: object) => boolean;
  STACK_TYPES: Record<string, string>;
  STACK_KEY_PROBLEMS: string[];
}
