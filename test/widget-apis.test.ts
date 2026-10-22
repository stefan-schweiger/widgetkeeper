import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WEB_APIS } from '../api.js';

describe("the web dashboards' widget APIs", () => {
  it('has every widget whose manifest declares routes, with a handler for each', () => {
    const app = JSON.parse(readFileSync('app.json', 'utf8'));
    for (const [id, widget] of Object.entries<any>(app.widgets)) {
      if (!widget.api) continue;
      expect([id, id in WEB_APIS]).toEqual([id, true]);
      for (const name of Object.keys(widget.api)) expect([id, name, typeof (WEB_APIS as any)[id][name]]).toEqual([id, name, 'function']);
    }
  });
});
