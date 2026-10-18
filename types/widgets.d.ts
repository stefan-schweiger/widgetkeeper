// Globals the widget scripts (widgets/*/public/widget.js and mount.js) put on `window` for their index.html.

/** A widget's mount.js: wires it to a Homey (the frame's own, or the Smart Stack's stand-in for one). */
type MountWidget = ((Homey: any, el: { root: HTMLElement, frame: HTMLElement }) => void | { setVisible?: (visible: boolean) => void })
  & { frameClass?: string };

interface Window {
  /** settings/dashboard.js, the web dashboards page; `io` is the vendored socket.io-client (settings/socket.io.js). */
  mountWebDashboards: (root: HTMLElement) => void;
  io: (url: string, opts?: object) => any;
  createElectricityWidget: (root: HTMLElement, opts?: object) => any;
  /** The chart module shared by the Electricity Overview and Charts (widgets/electricity/public/chart.js). */
  WidgetkeeperChart: any;
  createChartsWidget: (root: HTMLElement, opts?: object) => any;
  chartBuckets: (points: [number, number][], from: number, to: number, bucketMs: number, current?: number | null) => { t: number, end: number, v: number | null }[];
  createThermostatWidget: (root: HTMLElement, opts?: object) => any;
  createQuickActionsWidget: (root: HTMLElement, opts?: object) => any;
  createSensorAlarmsWidget: (root: HTMLElement, opts?: object) => any;
  createSensorDotsWidget: (root: HTMLElement, opts?: object) => any;
  createRoomHealthWidget: (root: HTMLElement, opts?: object) => any;
  roomHealthRange: (settings: Record<string, unknown>) => Record<string, { min: number | null, max: number }>;
  roomHealthScore: (measure: string, value: unknown, ranges: Record<string, { min: number | null, max: number }>) => { score: number, side: 'low' | 'high' | null } | null;
  createValueMatrixWidget: (root: HTMLElement, opts?: object) => any;
  valueMatrixRange: (text: unknown, column?: { capabilityId?: string, units?: string | null } | null) => { min: number | null, max: number | null } | null;
  valueMatrixLevel: (value: unknown, range: { min: number | null, max: number | null } | null) => 'good' | 'out' | 'far' | 'plain' | 'none';
  valueMatrixRows: (devices: object[], mode?: string) => { key: string, name?: string, missing?: true, devices: object[], values: Record<string, number | null> }[];
  roomHealthRooms: (devices: object[]) => { key: string, name?: string, missing?: true, sensors: object[], values: Record<string, number | null> }[];
  createWeatherWidget: (root: HTMLElement, opts?: object) => any;
  createCamerasWidget: (root: HTMLElement, opts?: object) => any;
  createHeatmapWidget: (root: HTMLElement, opts?: object) => any;
  createValuesWidget: (root: HTMLElement, opts?: object) => any;
  createLightsWidget: (root: HTMLElement, opts?: object) => any;
  createSparklinesWidget: (root: HTMLElement, opts?: object) => any;
  createVariablesWidget: (root: HTMLElement, opts?: object) => any;
  variableNameKeys: (slots: { id: string }[]) => string[];
  variableStepValue: (value: unknown, step: number, dir: number) => number;
  parseVariableNumber: (text: string) => number | null;
  /** The preset buttons shared by Thermostat Presets and Variable Presets (widgets/thermostat/public/presets.js). */
  WidgetkeeperPresets: { create: (root: HTMLElement, hooks: any) => any };
  /** The shared kit (widgets/spacer/public/kit.js), which every widget's index.html loads first. */
  WidgetkeeperKit: {
    icons: Record<string, { d: string, fill?: boolean }>,
    TIGHT_UNITS: RegExp,
    KEY_PROBLEMS: string[],
    scaled: (cap: any, value: number) => number,
    formatNumber: (cap: any, value: number) => string,
    formatValue: (cap: any, value: unknown, t?: (key: string) => string) => string,
    undoTextZoom: () => void,
    el: (tag: string, attrs?: object | null, parent?: Element | null, ns?: string) => any,
    setMask: (node: HTMLElement, url: string | null | undefined, name: string) => void,
    tileNames: (opts: any, render: () => void, failed: (key: string) => void) => any,
    formatSince: (ms: number, now: number, language?: string, locale?: string) => string,
    baseTitle: (title: unknown) => string,
    lowestSlot: (slots: any[], from: number, hours: number) => number,
    wireFrame: (Homey: any, frame: HTMLElement) => {
      height: () => number,
      setHeight: () => void,
      ready: (opts?: { fonts?: boolean, waitFor?: (() => Promise<unknown>[]) | null, maxMs?: number, before?: (() => void) | null }) => Promise<void>,
      perfParam: (sep?: string) => string,
    },
    getDeviceIds: (Homey: any) => Promise<string[]>,
    wireTileNames: (Homey: any, setNames: (names: any) => void) => { state: (path: string) => Promise<any>, rename: (key: string, name: string) => Promise<any> },
    COLORS: string[],
    colorStyle: (value: unknown) => 'soft' | 'deep',
    applyColors: (root: HTMLElement, opts?: { style?: unknown, color?: unknown, fallback?: string | null }) => 'soft' | 'deep',
  };
  createVarPresetsWidget: (root: HTMLElement, opts?: object) => any;
  varPresetsFromSettings: (settings: Record<string, any>) => { value: boolean | number | string, type: string, label: string }[];
  createFlowsWidget:(root: HTMLElement, opts?: object) => any;
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
  createClockWidget: (root: HTMLElement, opts?: object) => any;
  createTextLineWidget: (root: HTMLElement, opts?: object) => any;
  textLineBoardKey: (name: unknown) => string;
  textLineTilt: (seed: unknown) => number;
  createDaysSinceWidget: (root: HTMLElement, opts?: object) => any;
  daysSinceCountersFromSettings: (settings: Record<string, any>) => { key: string, name: string, icon: string | null, amber: number | null, red: number | null }[];
  daysSinceKey: (name: unknown) => string | null;
  daysSinceText: (days: number, units?: string, language?: string | null, locale?: string, today?: string) => string;
  daysSinceCalendarDays: (from: number, to: number) => number;
  daysSinceLevel: (counter: { amber: number | null, red: number | null }, resetAt: number | null, now: number) => 'amber' | 'red' | null;
  daysSinceProgress: (counter: { amber: number | null, red: number | null }, resetAt: number | null, now: number) => { fill: number, left: number | null, over: number | null } | null;
  createSpacerWidget: (root: HTMLElement, opts?: { height?: unknown }) => { height: number };
  spacerHeight: (value: unknown) => number;
  mediaSource: (caps: object) => 'tv' | 'lineIn' | null;
  mediaButtonsFromSettings: (settings: object) => { id: string, name: string, icon: string | null }[];
  sparkPath: (points: [number, number][], from: number, to: number, w: number, h: number) => { line: string, area: string, dot: { x: number, y: number }, min: number, max: number } | null;
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
  mountClockWidget: MountWidget;
  mountTextLineWidget: MountWidget;
  mountSpacerWidget: MountWidget;
  mountDaysSinceWidget: MountWidget;
  mountPriceWidget: MountWidget;
  mountQuickActionsWidget: MountWidget;
  mountSensorAlarmsWidget: MountWidget;
  mountSensorDotsWidget: MountWidget;
  mountRoomHealthWidget: MountWidget;
  mountValueMatrixWidget: MountWidget;
  mountSparklinesWidget: MountWidget;
  mountChartsWidget: MountWidget;
  mountThermostatWidget: MountWidget;
  mountTimersWidget: MountWidget;
  mountValuesWidget: MountWidget;
  mountVariablesWidget: MountWidget;
  mountVarPresetsWidget: MountWidget;
  mountWeatherWidget: MountWidget;
  mountStackWidget: MountWidget;
  createStackWidget: (root: HTMLElement, opts?: object) => any;
  createStackAttentionWatcher: (pages: any[], io: object) => { refresh: () => Promise<unknown>, attention: (id: string) => boolean };
  stackAttention: (page: { type: string, settings?: object }, state: object) => boolean;
  STACK_TYPES: Record<string, string>;
}
