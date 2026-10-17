import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Every language Homey supports.
const LANGS = ['en', 'nl', 'de', 'fr', 'it', 'sv', 'no', 'es', 'da', 'ru', 'pl', 'ko', 'ar'];
const COMPOSE = [
  '.homeycompose/app.json',
  ...readdirSync('widgets').map(id => `widgets/${id}/widget.compose.json`),
  ...readdirSync('.homeycompose/flow').flatMap(kind => readdirSync(`.homeycompose/flow/${kind}`).map(f => `.homeycompose/flow/${kind}/${f}`)),
];

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

  // Widget settings have no headings (see CLAUDE.md, Widget settings): a button's first row is flush left, the rest
  // are indented with two em spaces under it, and the number keeps a non-breaking space so iOS doesn't drop it.
  it("groups Thermostat Presets' settings per button", () => {
    const settings: { id: string, title: Record<string, string> }[] = readJson('widgets/thermostat/widget.compose.json').settings;
    for (const n of [1, 2, 3]) {
      for (const lang of LANGS) {
        const title = (part: string) => settings.find(s => s.id === `b${n}${part}`)!.title[lang];
        expect(title('Power'), `b${n}Power.${lang}`).toMatch(new RegExp(`\\S ${n}: \\S`));
        for (const part of ['Mode', 'Temp', 'Extra']) expect(title(part), `b${n}${part}.${lang}`).toMatch(/^  – \S/);
      }
    }
  });

  it("groups Room Health's ranges: the units in every title, the highest temperature and humidity under the lowest", () => {
    const settings: { id: string, title: Record<string, string> }[] = readJson('widgets/roomhealth/widget.compose.json').settings;
    for (const lang of LANGS) {
      const title = (id: string) => settings.find(s => s.id === id)!.title[lang];
      for (const id of ['tempMin', 'humidityMin', 'co2Max', 'radonMax', 'pm25Max', 'pm10Max', 'vocMax']) expect(title(id), `${id}.${lang}`).toMatch(/^\S.*\(.+\)$/);
      for (const id of ['tempMax', 'humidityMax']) expect(title(id), `${id}.${lang}`).toMatch(/^  – \S.*\(.+\)$/);
    }
  });

  it("groups Variable Presets' settings per button", () => {
    const settings: { id: string, title: Record<string, string> }[] = readJson('widgets/varpresets/widget.compose.json').settings;
    for (const n of [1, 2, 3, 4]) {
      for (const lang of LANGS) {
        const title = (id: string) => settings.find(s => s.id === id)!.title[lang];
        expect(title(`value${n}`), `value${n}.${lang}`).toMatch(new RegExp(`\\S\\u00a0${n}: \\S`));
        expect(title(`label${n}`), `label${n}.${lang}`).toMatch(/^  – \S/);
      }
    }
  });
});
