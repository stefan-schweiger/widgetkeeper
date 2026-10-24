import type Homey from 'homey';

/**
 * The colours a Flow can give a tile: Device Values' tiles, Flow Buttons' buttons and Notes (the cards'
 * `color` argument, which also has `default`; `test/locales.test.ts` checks the three cards list these). The kit's
 * `COLORS` are the same names.
 */
export const TILE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple'] as const;
export type TileColor = typeof TILE_COLORS[number];

/** A Flow card's `color` argument: a tile colour, or null for `default` (the widget's own). Anything else throws. */
export function parseTileColor(color: string): TileColor | null {
  if (color === 'default') return null;
  if ((TILE_COLORS as readonly string[]).includes(color)) return color as TileColor;
  throw new Error(`Unknown colour: ${color}`);
}

/**
 * Colours set by a Flow card, per key (a device value, a flow): a Flow can't address a widget instance, so the colour
 * belongs to what the tile shows, in every widget showing it. Kept in an app setting, so they survive restarts.
 */
export class FlowColors {

  constructor(private homey: Homey.App['homey'], private setting: string) {}

  all(): Record<string, TileColor> {
    const v = this.homey.settings.get(this.setting);
    return v && typeof v === 'object' ? v : {};
  }

  /** Sets a key's colour (null removes it); false when it had that colour already, so nothing was written. */
  set(key: string, color: TileColor | null): boolean {
    const colors = { ...this.all() };
    const had = Object.prototype.hasOwnProperty.call(colors, key) ? colors[key] : null;
    if (had === color) return false;
    if (color) colors[key] = color;
    else delete colors[key];
    this.homey.settings.set(this.setting, colors);
    return true;
  }

}
