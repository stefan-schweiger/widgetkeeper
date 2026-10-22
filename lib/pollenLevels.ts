/** Open-Meteo's pollen types (its air-quality API's `<type>_pollen`), in the widget's order: trees, grass, weeds. */
export const POLLEN_TYPES = ['alder', 'birch', 'olive', 'grass', 'mugwort', 'ragweed'] as const;
export type PollenType = typeof POLLEN_TYPES[number];

/**
 * Where each level starts, in grains/m³ (a day's mean): low, moderate, high, very high. Astma-Allergi Danmark's bands
 * (birch 1–29 / 30–100 / >100, grass and mugwort 1–9 / 10–50 / >50) with a "very high" band on top; alder and olive go
 * with birch, ragweed with mugwort.
 */
const BANDS: Record<PollenType, number[]> = {
  alder: [1, 30, 101, 1001],
  birch: [1, 30, 101, 1001],
  olive: [1, 30, 101, 1001],
  grass: [1, 10, 51, 251],
  mugwort: [1, 10, 51, 251],
  ragweed: [1, 10, 51, 251],
};

/** 0 none, 1 low, 2 moderate, 3 high, 4 very high, from the value rounded to whole grains. */
export function pollenLevel(type: PollenType, value: number): number {
  const v = Math.round(value);
  return BANDS[type].filter(b => v >= b).length;
}

/** The WHO's UV bands, of the index rounded: 1 low (0–2), 2 moderate (3–5), 3 high (6–7), 4 very high (8–10), 5 extreme. */
export function uvLevel(value: number): number {
  const v = Math.round(value);
  return v < 3 ? 1 : v < 6 ? 2 : v < 8 ? 3 : v < 11 ? 4 : 5;
}
