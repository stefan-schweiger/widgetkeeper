import { vi } from 'vitest';

/**
 * `lib/appApi.ts` calls `HomeyAPI.createAppAPI({ homey })`. Service tests mock `homey-api` with
 * this so it hands back the fake API attached to the fake homey:
 * `vi.mock('homey-api', () => homeyApiMock)` (vi.mock must be in the test file to be hoisted).
 */
export const homeyApiMock = {
  HomeyAPI: { createAppAPI: async ({ homey }: any) => homey.fakeApi },
};

export type FakeCap = {
  value?: unknown,
  type?: string,
  setable?: boolean,
  title?: string,
  units?: string,
  values?: { id: string, title?: string }[],
  min?: number,
  max?: number,
  step?: number,
  iconObj?: { id?: string, url?: string } | null,
  /** Whether Homey logs it in Insights. */
  insights?: boolean,
  decimals?: number,
};

export type FakeDeviceOptions = {
  id?: string,
  name?: string,
  zone?: string,
  caps: Record<string, FakeCap>,
  ui?: { quickAction?: string | null, quickActionOverride?: string | null },
  /** ms before a set value is reported back; `null` = never reported. */
  reportDelay?: number | null,
};

export type FakeDevice = ReturnType<typeof fakeDevice>;

export function fakeDevice({ id = 'dev1', name = 'Aircon', zone = 'z1', caps, ui, reportDelay = 0 }: FakeDeviceOptions) {
  const listeners = new Map<string, ((value: unknown) => void)[]>();
  const device = {
    id,
    name,
    zone,
    iconObj: null,
    ui: ui ?? {},
    capabilities: Object.keys(caps),
    capabilitiesObj: Object.fromEntries(Object.entries(caps).map(([k, c]) => [k, { id: k, ...c }])) as Record<string, any>,
    /** Every value sent, in order, as `capabilityId=value`. */
    sent: [] as string[],
    reportDelay,
    setCapabilityValue: vi.fn(async ({ capabilityId, value }: { capabilityId: string, value: unknown }) => {
      device.sent.push(`${capabilityId}=${JSON.stringify(value)}`);
      if (device.reportDelay == null) return;
      setTimeout(() => device.report(capabilityId, value), device.reportDelay);
    }),
    /** The device reports a new value (as if it changed on its own or confirmed a set). */
    report(capabilityId: string, value: unknown) {
      device.capabilitiesObj[capabilityId].value = value;
      for (const cb of listeners.get(capabilityId) ?? []) cb(value);
    },
    makeCapabilityInstance: vi.fn((capabilityId: string, cb: (value: unknown) => void) => {
      listeners.set(capabilityId, [...(listeners.get(capabilityId) ?? []), cb]);
      return {
        destroy: vi.fn(() => {
          listeners.set(capabilityId, (listeners.get(capabilityId) ?? []).filter(x => x !== cb));
        }),
      };
    }),
    listenerCount(capabilityId: string) {
      return listeners.get(capabilityId)?.length ?? 0;
    },
  };
  return device;
}

export type FakeApiOptions = {
  devices?: FakeDevice[],
  zones?: Record<string, { name: string }>,
  logs?: { id: string, ownerUri: string, ownerId: string }[],
  logEntries?: (args: { uri: string, id: string, resolution: string }) => unknown,
  prices?: (args: { date: string }) => unknown,
  currency?: unknown,
  priceType?: unknown, // Homey's electricity price type: 'dynamic' (the default) or 'fixed'
  fixedPrice?: unknown, // the `electricityPriceFixed` option
  variables?: FakeVariable[], // Logic variables
};

export type FakeVariable = { id: string, name: string, type: string, value: unknown };

/** Homey's Logic manager: variables, a connection and the `variable.*` events. */
export function fakeLogic(variables: FakeVariable[] = []) {
  const vars = new Map(variables.map(v => [v.id, { ...v }]));
  const listeners = new Map<string, ((data: any) => void)[]>();
  const logic = {
    vars,
    connected: false,
    connect: vi.fn(async () => { logic.connected = true; }),
    disconnect: vi.fn(async () => { logic.connected = false; }),
    getVariables: vi.fn(async (_opts?: object) => Object.fromEntries([...vars].map(([id, v]) => [id, { ...v }]))),
    getVariable: vi.fn(async ({ id }: { id: string }) => {
      const v = vars.get(id);
      if (!v) throw new Error(`No variable ${id}`);
      return { ...v };
    }),
    updateVariable: vi.fn(async ({ id, variable }: { id: string, variable: { value: unknown } }) => {
      const v = vars.get(id);
      if (!v) throw new Error(`No variable ${id}`);
      v.value = variable.value;
    }),
    on: vi.fn((event: string, cb: (data: any) => void) => { listeners.set(event, [...(listeners.get(event) ?? []), cb]); }),
    off: vi.fn((event: string, cb: (data: any) => void) => { listeners.set(event, (listeners.get(event) ?? []).filter(x => x !== cb)); }),
    /** Homey sends a `variable.<op>` event (as if a flow changed it). */
    emit(event: string, data: any) {
      if (event === 'variable.update' || event === 'variable.create') vars.set(data.id, { ...vars.get(data.id), ...data });
      if (event === 'variable.delete') vars.delete(data.id);
      for (const cb of listeners.get(event) ?? []) cb(data);
    },
    listenerCount(event: string) {
      return listeners.get(event)?.length ?? 0;
    },
  };
  return logic;
}

export function fakeApi(opts: FakeApiOptions = {}) {
  const byId = () => Object.fromEntries((opts.devices ?? []).map(d => [d.id, d]));
  return {
    devices: {
      getDevice: vi.fn(async ({ id }: { id: string }) => {
        const d = byId()[id];
        if (!d) throw new Error(`No device ${id}`);
        return d;
      }),
      getDevices: vi.fn(async () => byId()),
    },
    zones: { getZones: vi.fn(async () => opts.zones ?? {}) },
    insights: {
      getLogs: vi.fn(async () => Object.fromEntries((opts.logs ?? []).map(l => [l.id, l]))),
      // Like Homey, reading a log that doesn't exist throws.
      getLogEntries: vi.fn(async (args: any) => {
        if (opts.logs && !opts.logs.some(l => l.id === args.id)) throw new Error(`Log not found: ${args.id}`);
        return opts.logEntries?.(args) ?? { values: [] };
      }),
    },
    energy: {
      fetchDynamicElectricityPrices: vi.fn(async (args: { date: string }) => opts.prices?.(args) ?? {}),
      getCurrency: vi.fn(async () => opts.currency ?? 'DKK'),
      getElectricityPriceType: vi.fn(async () => opts.priceType ?? 'dynamic'),
      getOptionElectricityPriceFixed: vi.fn(async () => opts.fixedPrice ?? { value: null }),
    },
    logic: fakeLogic(opts.variables),
  };
}

export function fakeHomey(api: ReturnType<typeof fakeApi>) {
  const settings = new Map<string, unknown>();
  return {
    fakeApi: api,
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (t: any) => clearTimeout(t),
    setInterval: (fn: () => void, ms: number) => setInterval(fn, ms),
    clearInterval: (t: any) => clearInterval(t),
    api: { realtime: vi.fn() },
    clock: { getTimezone: () => 'Europe/Copenhagen' },
    i18n: { getLanguage: () => 'en' },
    settings: {
      get: (key: string) => settings.get(key) ?? null,
      set: vi.fn((key: string, value: unknown) => { settings.set(key, JSON.parse(JSON.stringify(value))); }),
    },
    geolocation: { getLatitude: () => 55.6761234, getLongitude: () => 12.5683456, on: vi.fn(), off: vi.fn() },
    manifest: { id: 'com.thomassidor.widgetkeeper', version: '0.3.0' },
    __: () => undefined,
  } as any;
}
