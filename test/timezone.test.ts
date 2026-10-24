import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { calendarDays } from '../lib/DaysSinceService.js';
import { heatmapDates, localHour } from '../lib/heatmap.js';

/**
 * The app's dates are Homey's (`homey.clock.getTimezone()`), never the app process's: the tests run in
 * Europe/Copenhagen (vitest.config.ts), like the Homey they were checked on, so a process-local date in the app would
 * pass them and be wrong on a Homey whose app process keeps another zone. The widgets (browser code) use the screen's
 * zone on purpose and aren't checked here.
 */
const LOCAL_DATE_METHODS = /\.(getHours|setHours|getMinutes|setMinutes|getDate|setDate|getDay|getMonth|setMonth|getFullYear|setFullYear|getTimezoneOffset|toLocaleDateString|toLocaleTimeString|toLocaleString|toDateString|toTimeString)\(|new Date\(\s*\d+\s*,/;

/** Code lines only: comments and doc comments may mention the methods. */
const codeLines = (source: string) => source.split('\n')
  .map((line, i) => [i + 1, line] as const)
  .filter(([, line]) => !/^\s*(\/\/|\*|\/\*)/.test(line));

const BACK_END = [
  ...readdirSync('lib').filter(f => f.endsWith('.ts')).map(f => `lib/${f}`), 'app.ts', 'api.ts',
  ...readdirSync('widgets').map(id => `widgets/${id}/api.ts`).filter(f => { try { readFileSync(f); return true; } catch { return false; } }),
];

describe("the app's time zone", () => {
  it('has no process-local date in the back end', () => {
    const found = BACK_END.flatMap(file => codeLines(readFileSync(file, 'utf8'))
      .filter(([, line]) => LOCAL_DATE_METHODS.test(line.replace(/'[^']*'|`[^`]*`/g, "''")))
      .map(([n, line]) => `${file}:${n}: ${line.trim()}`));
    expect(found).toEqual([]);
  });

  it('would find one', () => {
    expect(LOCAL_DATE_METHODS.test('const h = new Date(t).getHours();')).toBe(true);
    expect(LOCAL_DATE_METHODS.test('midnight.setHours(0, 0, 0, 0);')).toBe(true);
    expect(LOCAL_DATE_METHODS.test('new Date(2026, 0, 1)')).toBe(true);
    expect(codeLines(' * like `Date.getDay()`.\nconst d = x.getDay();')).toHaveLength(1);
  });

  it("dates by Homey's zone, whatever the process's", () => {
    // 23:30 UTC on 31 Dec: still 2026-12-31 in New York, already 2027-01-01 in Copenhagen and Auckland.
    const t = Date.UTC(2026, 11, 31, 23, 30);
    expect(localHour(t, 'America/New_York')).toMatchObject({ date: '2026-12-31', hour: 18 });
    expect(localHour(t, 'Europe/Copenhagen')).toMatchObject({ date: '2027-01-01', hour: 0 });
    expect(heatmapDates(t, 'Pacific/Auckland', 1)[0].date).toBe('2027-01-01');
    expect(calendarDays(Date.UTC(2026, 11, 31, 12), t, 'America/New_York')).toBe(0);
    expect(calendarDays(Date.UTC(2026, 11, 31, 12), t, 'Europe/Copenhagen')).toBe(1);
  });
});
