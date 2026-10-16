import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// The App Store images are rendered from the widget previews by `npm run app-images` (scripts/app-images.mjs).
const config = JSON.parse(readFileSync('dev/app-images.json', 'utf8'));

describe('app store images', () => {
  it('are made from widgets that have a preview, each once', () => {
    const ids: string[] = config.columns.flat();
    expect(ids.length).toBeGreaterThan(0);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(existsSync(`widgets/${id}/preview-${config.theme}.png`), id).toBe(true);
    expect(existsSync(config.background.image)).toBe(true);
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
