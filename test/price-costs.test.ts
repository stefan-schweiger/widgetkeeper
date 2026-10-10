import { describe, expect, it } from 'vitest';
import { parsePriceCosts } from '../lib/priceCosts.js';

describe('parsePriceCosts', () => {
  it("applies Homey's expression to the spot price", () => {
    const f = parsePriceCosts('{{([[price]]+0.515)*1.25}}')!;
    expect(f(0.029)).toBeCloseTo(0.68, 3); // the Energy tab at 13:00 on 2026-10-10
    expect(f(1.245)).toBeCloseTo(2.2, 3);
  });

  it('follows the usual precedence', () => {
    expect(parsePriceCosts('[[price]] + 2 * 3 ^ 2')!(1)).toBe(19);
    expect(parsePriceCosts('-[[price]] - -1')!(3)).toBe(-2);
    expect(parsePriceCosts('10 % 4 / 2')!(0)).toBe(1);
    expect(parsePriceCosts('.5*[[price]]')!(4)).toBe(2);
  });

  it('knows a few functions', () => {
    expect(parsePriceCosts('{{max([[price]], 0) + 1}}')!(-2)).toBe(1);
    expect(parsePriceCosts('round([[price]] * 1.25, 2)')!(0.333)).toBe(0.42);
  });

  it('is null without costs', () => {
    for (const e of [null, undefined, '', '{{}}', '{{[[price]]}}', ' [[price]] ', 42]) expect(parsePriceCosts(e)).toBeNull();
  });

  it('throws on anything it does not understand', () => {
    for (const e of ['{{[[price]] + }}', '([[price]]', '[[price]] [[price]]', 'foo([[price]])', '[[hour]] * 2', 'process.exit()']) {
      expect(() => parsePriceCosts(e), e).toThrow();
    }
  });
});
