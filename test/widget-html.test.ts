import { readdirSync, readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import { describe, expect, it } from 'vitest';

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
  const source = (id: string, fn: string) => {
    const js = readFileSync(`widgets/${id}/public/widget.js`, 'utf8').replace(/\r\n/g, '\n');
    const m = js.match(new RegExp(String.raw`\n( *)function ${fn}\([\s\S]*?\n\1}\n`));
    return m ? m[0] : null;
  };

  it('withName() is the same in every widget that has one', () => {
    const copies = ['values', 'variables', 'flows', 'sensoralarms'].map(id => source(id, 'withName'));
    expect(copies[0]).not.toBeNull();
    for (const c of copies) expect(c).toBe(copies[0]);
  });
});
