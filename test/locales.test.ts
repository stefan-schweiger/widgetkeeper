import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every language Homey supports.
const LANGS = ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar'];
const COMPOSE = ['.homeycompose/app.json', 'widgets/electricity/widget.compose.json', 'widgets/thermostat/widget.compose.json', 'widgets/quickactions/widget.compose.json', 'widgets/sensoralarms/widget.compose.json', 'widgets/weather/widget.compose.json', 'widgets/heatmap/widget.compose.json', 'widgets/cameras/widget.compose.json'];

const readJson = (path: string) => JSON.parse(readFileSync(path, 'utf8'));

/** `{ 'electricity.price': 'Price', … }` */
function flatten(obj: Record<string, unknown>, prefix = ''): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === 'object') Object.assign(out, flatten(v as Record<string, unknown>, `${prefix}${k}.`));
    else out[prefix + k] = v as string;
  }
  return out;
}

const tokens = (s: string) => (s.match(/__\w+__/g) ?? []).sort();

/** Every `{ en: … }` object in a manifest, with its path. */
function i18nObjects(node: unknown, path = ''): [string, Record<string, string>][] {
  if (!node || typeof node !== 'object') return [];
  if (typeof (node as Record<string, unknown>).en === 'string') return [[path, node as Record<string, string>]];
  return Object.entries(node).flatMap(([k, v]) => i18nObjects(v, `${path}/${k}`));
}

describe('locales', () => {
  const en = flatten(readJson('locales/en.json'));

  it('has a file for every Homey language', () => {
    expect(readdirSync('locales').map(f => f.replace('.json', '')).sort()).toEqual([...LANGS].sort());
  });

  for (const lang of LANGS.filter(l => l !== 'en')) {
    it(`${lang} has the same keys and tokens as en`, () => {
      const strings = flatten(readJson(`locales/${lang}.json`));
      expect(Object.keys(strings).sort()).toEqual(Object.keys(en).sort());
      for (const [key, s] of Object.entries(strings)) {
        expect(s, key).toBeTruthy();
        expect(tokens(s), key).toEqual(tokens(en[key]));
      }
    });
  }

  for (const file of COMPOSE) {
    it(`${file} is translated into every language`, () => {
      const objects = i18nObjects(readJson(file));
      expect(objects.length).toBeGreaterThan(0);
      for (const [path, obj] of objects) {
        expect(Object.keys(obj).sort(), path).toEqual([...LANGS].sort());
        for (const lang of LANGS) expect(obj[lang], `${path}.${lang}`).toBeTruthy();
      }
    });
  }
});
