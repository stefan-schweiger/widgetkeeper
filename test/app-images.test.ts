import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The App Store images are rendered from the widget previews by `npm run app-images` (scripts/app-images.mjs).
const config = JSON.parse(readFileSync('dev/app-images.json', 'utf8'));
// A column's item: a widget id, a row of ids, or the browser window with columns of its own (and maybe its own theme).
type Item = string | string[] | { browser: string[][], span?: number, theme?: string };
const previews = (config.columns as Item[][]).flat().flatMap(item => typeof item === 'string' || Array.isArray(item)
  ? [item].flat().map(id => ({ id, theme: config.theme }))
  : item.browser.flat().map(id => ({ id, theme: item.theme ?? config.theme })));

describe('app store images', () => {
  it('are made from widgets that have a preview, each once', () => {
    const ids = previews.map(p => p.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const { id, theme } of previews) expect(existsSync(`widgets/${id}/preview-${theme}.png`), id).toBe(true);
    expect(config.background.stops.length).toBeGreaterThanOrEqual(2);
  });

  it("are the app's images, in Homey's sizes", () => {
    const { images } = JSON.parse(readFileSync('.homeycompose/app.json', 'utf8'));
    const sizes: Record<string, [number, number]> = { small: [250, 175], large: [500, 350], xlarge: [1000, 700] };
    expect(Object.keys(images).sort()).toEqual(Object.keys(sizes).sort());
    for (const [size, path] of Object.entries<string>(images)) {
      // A PNG's width and height are the first two fields of its IHDR chunk, right after the signature.
      const png = readFileSync(path.slice(1));
      expect(png.subarray(12, 16).toString('latin1'), path).toBe('IHDR');
      expect([png.readUInt32BE(16), png.readUInt32BE(20)], path).toEqual(sizes[size]);
    }
  });
});
