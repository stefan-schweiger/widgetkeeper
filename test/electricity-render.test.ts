// @vitest-environment happy-dom
/*
 * The Electricity Overview's whole rendered markup, compared against a fixture recorded before its chart code
 * moved to the shared module (widgets/electricity/public/chart.js). Same markup, same look: any change to the
 * drawing shows up here. Delete the fixture to record it again, deliberately.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadWidget } from './helpers/loadWidget.js';

const FIXTURE = 'test/fixtures/electricity-render.json';
const MIN = 60e3;
const HOUR = 60 * MIN;
const NOW = new Date('2026-01-15T10:20:00').getTime();
const HOUR_START = new Date('2026-01-15T10:00:00').getTime();

let win: any;
beforeAll(() => { win = loadWidget('electricity'); });

/** A made-up day: a varying live trace, 49 hourly prices and 5-min usage for the last 24 h; `solar` dips below zero. */
function snapshot({ solar = false, quarters = false, fixed = false, noPrices = false } = {}) {
  const live = Array.from({ length: 70 }, (_, i) => ({
    t: NOW - (69 - i) * 10e3,
    w: Math.round(600 + 400 * Math.sin(i / 6) + (i % 7) * 37 - (solar ? 1400 : 0)),
  }));
  const prices = Array.from({ length: 49 }, (_, i) => ({
    start: HOUR_START + (i - 24) * HOUR,
    price: noPrices || i > 37 ? null : Math.round((1.5 + Math.sin(i / 4) + (i % 3) * 0.2 - (i === 30 ? 2.4 : 0)) * 100) / 100,
  }));
  const usage = Array.from({ length: 24 * 12 }, (_, i) => ({
    t: HOUR_START - 14 * HOUR + i * 5 * MIN,
    w: Math.round(500 + 300 * Math.cos(i / 9) + (i % 5) * 41 - (solar && i > 100 && i < 160 ? 1500 : 0)),
  })).filter(u => u.t <= NOW && (u.t < HOUR_START - 6 * HOUR || u.t > HOUR_START - 5 * HOUR)); // with a gap
  return {
    now: NOW,
    deviceName: 'Meter',
    meterError: null,
    live,
    prices,
    quarters: quarters ? prices.flatMap((p, i) => [0, 1, 2, 3].map(q => ({
      start: p.start + q * 15 * MIN, price: p.price == null ? null : Math.round((p.price + (q - 1.5) * 0.1 * ((i % 2) ? 1 : -1)) * 100) / 100,
    }))) : null,
    fixedPrice: fixed ? 2.1 : null,
    usage,
    currency: 'DKK',
    language: 'da',
  };
}

type Case = { snap?: Parameters<typeof snapshot>[0], settings?: Record<string, unknown>, layout?: string, width?: number,
  scrub?: { chart: 'live' | 'usage' | 'price', x: number } };

const CASES: Record<string, Case> = {
  standard: {},
  compact: { layout: 'compact' },
  smooth: { settings: { smooth: true } },
  compactSmooth: { layout: 'compact', settings: { smooth: true } },
  narrow: { width: 300 },
  solar: { snap: { solar: true } },
  solarSeparate: { snap: { solar: true }, settings: { separateUsage: true } },
  solarCompactSmooth: { snap: { solar: true }, layout: 'compact', settings: { smooth: true } },
  quarters: { snap: { quarters: true } },
  quartersSmooth: { snap: { quarters: true }, settings: { smooth: true, nextLow: 'both' } },
  separate: { settings: { separateUsage: true, usageColor: 'purple' } },
  fixed: { snap: { fixed: true } },
  noPrices: { snap: { noPrices: true } },
  pricesOff: { settings: { showPrices: false, liveWindow: 60 } },
  noUsage: { settings: { showUsage: false, liveWindow: 1, nextLow: '24' } },
  scrubLive: { scrub: { chart: 'live', x: 150 } },
  scrubPrice: { scrub: { chart: 'price', x: 200 } },
  scrubQuarters: { snap: { quarters: true }, scrub: { chart: 'price', x: 290 } },
  scrubUsage: { settings: { separateUsage: true }, scrub: { chart: 'usage', x: 120 } },
};

function render(c: Case): string {
  const root = document.createElement('div');
  if (c.width) Object.defineProperty(root, 'clientWidth', { value: c.width });
  document.body.append(root);
  let seed = 1;
  const random = vi.spyOn(Math, 'random').mockImplementation(() => (seed = (seed * 16807) % 2147483647) / 2147483647);
  const w = win.createElectricityWidget(root, { locale: 'da-DK', layout: c.layout });
  random.mockRestore();
  if (c.settings) w.setSettings(c.settings);
  w.setData(snapshot(c.snap));
  if (c.scrub) {
    const index = { live: 0, usage: 1, price: 2 }[c.scrub.chart];
    const svg = root.querySelectorAll('.ew-chart svg')[index];
    svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: c.scrub.x, pointerType: 'touch', bubbles: true }));
  }
  const html = root.innerHTML;
  w.destroy();
  return html;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  document.body.innerHTML = '';
});
afterEach(() => { vi.useRealTimers(); });

describe('Electricity Overview markup', () => {
  const recorded: Record<string, string> | null = existsSync(FIXTURE) ? JSON.parse(readFileSync(FIXTURE, 'utf8')) : null;

  it('matches the recorded fixture in every case', () => {
    const now = Object.fromEntries(Object.entries(CASES).map(([k, c]) => [k, render(c)]));
    if (!recorded) {
      mkdirSync('test/fixtures', { recursive: true });
      writeFileSync(FIXTURE, JSON.stringify(now, null, 1) + '\n');
      return;
    }
    expect(Object.keys(now)).toEqual(Object.keys(recorded));
    for (const k of Object.keys(CASES)) expect(now[k], k).toBe(recorded[k]);
  });

  it('draws what the cases are meant to show', () => {
    const solar = render(CASES.solar);
    expect(solar).toContain('live-line export');
    expect(solar).toContain('usage-line export');
    expect(render(CASES.solarSeparate)).toContain('usage-line solo export');
    expect(render(CASES.scrubLive)).toContain('class="cursor"');
    expect(render(CASES.scrubPrice)).toContain('–'); // the scrubbed hour's range in the header
    expect(render(CASES.smooth)).toContain('C');
    expect(render(CASES.fixed)).toContain('Fixed price');
  });
});
