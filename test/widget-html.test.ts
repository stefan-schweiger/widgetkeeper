import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { DEPS, type WidgetName } from './helpers/loadWidget.js';

// The widget tests load widget.js but not index.html, whose inline script wires it to Homey. A syntax
// error there leaves the widget on Homey's spinner forever (a raw line break inside a regex did).
const WIDGETS = readdirSync('widgets', { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name);

describe('widget index.html', () => {
  it.each(WIDGETS)('%s: the inline scripts parse', (id) => {
    const html = readFileSync(`widgets/${id}/public/index.html`, 'utf8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    expect(scripts.length).toBeGreaterThan(0);
    for (const code of scripts) expect(() => new Script(code)).not.toThrow();
  });
});

// Homey serves each widget's files separately, so shared helpers are copied; these must stay equal.
describe('copied widget helpers', () => {
  const read = (id: string, file: string) => readFileSync(`widgets/${id}/public/${file}`, 'utf8').replace(/\r\n/g, '\n');
  /** A function's source, from its `function` line to its closing brace, dedented (copies nest at different depths). */
  const source = (id: string, fn: string, file = 'widget.js') => {
    const m = read(id, file).match(new RegExp(String.raw`\n( *)function ${fn}\([\s\S]*?\n\1}\n`));
    return m ? m[0].replace(new RegExp(`\n${m[1]}`, 'g'), '\n') : null;
  };
  /** Every copy is found and equal to the first, after `normalise`. */
  const expectSame = (copies: (string | null)[], normalise = (s: string) => s) => {
    expect(copies[0]).not.toBeNull();
    for (const c of copies) expect(c === null ? c : normalise(c)).toBe(normalise(copies[0]!));
  };

  it('withName() is the same in every widget that has one', () => {
    expectSame(['values', 'flows', 'sensoralarms'].map(id => source(id, 'withName')));
  });

  it('undoTextZoom() is the same in every index.html', () => {
    expectSame(WIDGETS.map(id => source(id, 'undoTextZoom', 'index.html')));
  });

  it('loadMarks() is the same in every mount.js that makes requests, and perfParam() in every one that has it', () => {
    // The spacer makes no requests, so it has neither.
    const requesting = WIDGETS.filter(id => id !== 'spacer');
    expectSame(requesting.map(id => source(id, 'loadMarks', 'mount.js')));
    // The stack's own requests carry no load marks. Weather's endpoint has no other query, so its perf= starts it.
    expectSame(requesting.filter(id => id !== 'stack').map(id => source(id, 'perfParam', 'mount.js')),
      s => s.replace('`?perf=', '`&perf='));
  });

  it('onTap() is the same in the widgets that share a version', () => {
    // Deliberately different: Media's and Variables' have no keydown (their rows hold buttons and inputs
    // whose keys would bubble to it), and the stack's is its own design.
    expectSame(['lights', 'curtains'].map(id => source(id, 'onTap'))); // in the widget's closure
    expectSame(['flows', 'sensordots', 'roomhealth'].map(id => source(id, 'onTap')));
    expectSame(['timers', 'locks', 'dayssince'].map(id => source(id, 'onTap'))); // stops the tap at a button inside a row
  });

  it('scaled() and formatNumber() are the same in Sparklines and Charts', () => {
    for (const fn of ['scaled', 'formatNumber']) expectSame(['sparklines', 'charts'].map(id => source(id, fn)));
  });

  it('tileNames(), wireTileNames() and nameKeys() are the same in every widget with tile names', () => {
    const named = ['lights', 'curtains', 'quickactions', 'sensoralarms', 'values', 'sparklines', 'locks', 'cameras', 'variables', 'roomhealth'];
    expectSame(named.map(id => source(id, 'tileNames')));
    expectSame(named.map(id => source(id, 'wireTileNames', 'mount.js')));
    expectSame(['values', 'sparklines', 'variables'].map(id => source(id, 'nameKeys')));
  });

  it('wireBar() is the same in Light Controls and Curtains', () => {
    expectSame(['lights', 'curtains'].map(id => source(id, 'wireBar')));
  });

  it('formatSince(), baseTitle(), lowestSlot() and setMask() are the same in every copy', () => {
    expectSame(['locks', 'sensordots'].map(id => source(id, 'formatSince')));
    expectSame(['sensoralarms', 'sensordots'].map(id => source(id, 'baseTitle')));
    expectSame(['electricity', 'price'].map(id => source(id, 'lowestSlot')));
    // Each sets its own widget's mask variable.
    expectSame(['cameras', 'lights', 'locks', 'quickactions', 'sensoralarms', 'sparklines', 'values'].map(id => source(id, 'setMask')),
      s => s.replace(/--\w+-mask/g, '--x-mask'));
  });

  /** The CSS without comments, with each widget's class prefix (`tw-`, `hm-` …) made `x-`. */
  const css = (id: string, prefix: string, file = 'widget.css') => read(id, file).replace(/\/\*[\s\S]*?\*\//g, '').replace(new RegExp(String.raw`\b${prefix}-`, 'g'), 'x-');

  it("the non-transparent widgets' dark frame is the same", () => {
    const frame = (id: string, prefix: string, file?: string) => {
      const m = css(id, prefix, file).match(/\.homey-dark-mode \.x-frame, \.x-frame\.homey-dark-mode \{[\s\S]*?body\.x-frame\.homey-dark-mode::after \{ position: fixed; \}\n/);
      return m ? m[0].replace(/\n+/g, '\n') : null;
    };
    // Thermostat Presets' is in the presets module, which Variable Presets loads too.
    expectSame([['thermostat', 'tw', 'presets.css'], ['heatmap', 'hm'], ['media', 'mw'], ['weather', 'wf']].map(([id, p, file]) => frame(id, p, file)));
  });

  it("the native tiles' rim is the same everywhere", () => {
    // Every stylesheet of a widget: the shared presets.css has Thermostat Presets' frame.
    const sheets = (id: string) => readdirSync(`widgets/${id}/public`).filter(f => f.endsWith('.css'));
    const rims = WIDGETS.flatMap(id => sheets(id).flatMap(f => [...read(id, f).matchAll(/\{([^{}]*inset 0 1px 0 rgb\(255 255 255[^{}]*)\}/g)].map(m => m[1].trim())));
    expect(rims.length).toBeGreaterThanOrEqual(16);
    // A tile's rim follows its own radius; a frame's (thermostat, heatmap, media, weather) the frame's 10 px.
    const tile = "content: ''; position: absolute; inset: 0; pointer-events: none; border-radius: inherit;\n  box-shadow: inset 0 1px 0 rgb(255 255 255 / .05), inset 0 0 0 1px rgb(255 255 255 / .03);";
    for (const r of rims) expect([tile, tile.replace('inherit', '10px')]).toContain(r);
  });
});

describe('shared files', () => {
  /** The files an index.html loads besides its own widget.*, mount.js: `<widget>/<name>` (`../electricity/chart.js` → `electricity/chart.js`). */
  const shared = (id: string, ext: string) => {
    const html = readFileSync(`widgets/${id}/public/index.html`, 'utf8');
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(m => m[1]).filter(r => r.endsWith(`.${ext}`));
    return refs.filter(r => !['widget.js', 'widget.css', 'mount.js'].includes(r))
      .map(r => (r.startsWith('../') ? r.slice(3) : `${id}/${r}`));
  };
  const stackDeps: Record<string, string[]> = new Function(`return ${readFileSync('widgets/stack/public/mount.js', 'utf8')
    .match(/const DEPS = (\{[\s\S]*?\});/)![1]}`)();

  it.each(WIDGETS)('%s: the Smart Stack and the tests load what its index.html loads first', (id) => {
    const js = shared(id, 'js'), css = shared(id, 'css');
    expect(js).toEqual(DEPS[id as WidgetName] || []);
    expect(js.map(f => f.replace(/\.js$/, ''))).toEqual(stackDeps[id] || []);
    expect(css.map(f => f.replace(/\.css$/, ''))).toEqual(stackDeps[id] || []);
    for (const f of [...js, ...css]) expect(existsSync(`widgets/${f.replace('/', '/public/')}`)).toBe(true);
  });

  it('the chart module is loaded by the Electricity Overview and Charts, the presets module by both preset widgets', () => {
    expect(Object.keys(stackDeps).sort()).toEqual(['charts', 'electricity', 'thermostat', 'varpresets']);
  });
});

describe('fallback strings', () => {
  const en = JSON.parse(readFileSync('locales/en.json', 'utf8'));
  // The stack has no fallback table: it shows the key. The clock has no strings (its text is all Intl's), nor
  // has the spacer.
  it.each(WIDGETS.filter(id => id !== 'stack' && id !== 'clock' && id !== 'spacer'))("%s: DEFAULT_STRINGS are en.json's", (id) => {
    const js = readFileSync(`widgets/${id}/public/widget.js`, 'utf8').replace(/\r\n/g, '\n');
    const table = js.match(/\n( *)const DEFAULT_STRINGS = (\{[\s\S]*?\n\1\});/);
    const ns = js.match(/opts\.t\(`(\w+)\.\$\{/);
    expect(table && ns).toBeTruthy();
    const strings = new Function(`return ${table![2]}`)();
    for (const [key, value] of Object.entries(strings)) expect([key, value]).toEqual([key, en[ns![1]][key]]);
  });
});
