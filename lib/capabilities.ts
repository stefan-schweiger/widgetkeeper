/** A capability as most widgets read it: its value and whether the widget may set it. */
export type CapState = { value: unknown, setable: boolean };

/** An enum's values with their titles (a value without a title is named by its id). */
export type CapValues = { id: string, title: string }[];

export type CapabilityDescription = {
  title: string,
  type: string,
  units: string | null,
  decimals: number | null,
  /** A number's range, when the capability has one (`dim` is 0–1 with `%` units). */
  min: number | null,
  max: number | null,
  /** An enum's values with their titles. */
  values: CapValues | null,
};

/** A capability's `values` list, normalised, or null when it has none. */
export function capabilityValues(cap: any): CapValues | null {
  return Array.isArray(cap?.values)
    ? cap.values.map((v: any) => ({ id: String(v.id), title: typeof v.title === 'string' && v.title ? v.title : String(v.id) }))
    : null;
}

/** A capability's `capabilitiesObj` entry, normalised. An empty title or units count as none (the title falls back to the id). */
export function describeCapability(cap: any, id: string): CapabilityDescription {
  return {
    title: typeof cap?.title === 'string' && cap.title ? cap.title : id,
    type: cap?.type,
    units: typeof cap?.units === 'string' && cap.units ? cap.units : null,
    decimals: typeof cap?.decimals === 'number' ? cap.decimals : null,
    min: typeof cap?.min === 'number' ? cap.min : null,
    max: typeof cap?.max === 'number' ? cap.max : null,
    values: cap?.type === 'enum' ? capabilityValues(cap) : null,
  };
}

/** The capabilities of `ids` the device has, in that order. */
export function presentCaps<T extends string>(device: any, ids: readonly T[]): T[] {
  const caps = device?.capabilitiesObj || {};
  return ids.filter(id => caps[id]);
}

/** The value and settability of each of `ids` the device has. */
export function readCaps(device: any, ids: readonly string[]): Record<string, CapState> {
  const out: Record<string, CapState> = {};
  for (const id of presentCaps(device, ids)) {
    const c = device.capabilitiesObj[id];
    out[id] = { value: c.value ?? null, setable: c.setable !== false };
  }
  return out;
}
