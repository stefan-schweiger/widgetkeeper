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

  // The app's own strings (`homey.__('…')`): the key is in en.json, and the English it falls back to is en.json's text
  // (the tests' Homey has no strings, so service tests see the fallbacks).
  describe("the app's strings", () => {
    const SOURCES = [
      ...readdirSync('lib').filter(f => f.endsWith('.ts')).map(f => `lib/${f}`), 'app.ts', 'api.ts',
      ...readdirSync('widgets').map(id => `widgets/${id}/api.ts`).filter(f => { try { readFileSync(f); return true; } catch { return false; } }),
    ];
    const uses = SOURCES.flatMap(file => [...readFileSync(file, 'utf8')
      .matchAll(/__\(\s*'([\w.]+)'(?:\s*,\s*\{[^}]*\})?\s*\)(?:\s*\|\|\s*(['`])((?:[^'`\\]|\\.)*)\2)?/g)]
      .map(m => ({ file, key: m[1], fallback: m[2] ? m[3] : null })));

    it('finds them', () => {
      expect(uses.length).toBeGreaterThan(40);
    });

    it('uses only keys en.json has', () => {
      expect(uses.filter(u => !(u.key in en)).map(u => `${u.file}: ${u.key}`)).toEqual([]);
    });

    it("falls back to en.json's text", () => {
      const asWildcards = (s: string) => s.replace(/__\w+__/g, '*').replace(/\$\{[^}]*\}/g, '*').replace(/\\'/g, "'");
      const differ = uses.filter(u => u.fallback !== null && u.key in en && asWildcards(u.fallback) !== asWildcards(en[u.key]));
      expect(differ.map(u => `${u.file}: ${u.key}: ${JSON.stringify(u.fallback)} vs ${JSON.stringify(en[u.key])}`)).toEqual([]);
    });

    it('has the strings built from a name: the key problems, the variable types, the Flow icons', async () => {
      for (const reason of ['noKey', 'keyScope', 'keyInvalid']) expect(en).toHaveProperty([`stack.${reason}`]);
      for (const type of ['typeBoolean', 'typeNumber', 'typeString']) expect(en).toHaveProperty([`variables.${type}`]);
      const { FLOW_ICONS } = await import('../lib/FlowService.js');
      expect(FLOW_ICONS.filter(id => !(`flows.icons.${id}` in en))).toEqual([]);
    });
  });

  // Homey's compose has no shared Flow card arguments, so the three colour cards each carry the list.
  it("the Flow colour cards list `default` and TILE_COLORS, each named alike, and the kit's COLORS are the same", async () => {
    const { TILE_COLORS } = await import('../lib/tileColors.js');
    const lists = ['values_set_color', 'flows_set_color', 'textline_set_color'].map((card) => {
      const arg = readJson(`.homeycompose/flow/actions/${card}.json`).args.find((a: { name: string }) => a.name === 'color');
      return arg.values as { id: string, title: Record<string, string> }[];
    });
    expect(lists[0].map(v => v.id)).toEqual(['default', ...TILE_COLORS]);
    for (const list of lists.slice(1)) expect(list).toEqual(lists[0]);
    const kit = readFileSync('widgets/spacer/public/kit.js', 'utf8').match(/const COLORS = (\[[^\]]*\]);/)![1];
    expect(JSON.parse(kit.replace(/'/g, '"')).sort()).toEqual([...TILE_COLORS].sort());
  });
});
