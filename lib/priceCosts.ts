/**
 * Homey Energy's own costs on top of the spot price ("user costs"): a math expression such as
 * `{{([[price]]+0.515)*1.25}}` (tariffs and taxes, then VAT; read on the Homey 2026-10-10). Homey's
 * Energy tab shows the prices with it applied, but `fetchDynamicElectricityPrices` returns the bare
 * spot prices, so the app applies it itself.
 *
 * A small parser, not `eval`: numbers, `[[price]]`, `+ - * / % ^`, brackets and a few functions.
 * Anything else throws, and the caller then keeps the spot prices.
 */

type Fn = (price: number) => number;

const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  min: Math.min,
  max: Math.max,
  abs: Math.abs,
  round: (x, decimals = 0) => Math.round(x * 10 ** decimals) / 10 ** decimals,
  floor: Math.floor,
  ceil: Math.ceil,
};

/** The price function for Homey's expression, or null when there's none (the spot price as it is). */
export function parsePriceCosts(expression: unknown): Fn | null {
  if (typeof expression !== 'string') return null;
  let src = expression.trim();
  const braces = /^\{\{([\s\S]*)\}\}$/.exec(src);
  if (braces) src = braces[1];
  if (!src.trim() || /^\s*\[\[price\]\]\s*$/.test(src)) return null;

  const tokens = src.match(/\[\[price\]\]|\d+(?:\.\d+)?|\.\d+|[a-z]+|[-+*/%^(),]|\S/gi) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];
  const expect = (t: string) => {
    if (next() !== t) throw new Error(`Expected "${t}" in the price expression`);
  };

  // expr := term (('+'|'-') term)*;  term := unary (('*'|'/'|'%') unary)*;
  // unary := '-' unary | '+' unary | power;  power := atom ('^' unary)?
  const expr = (): Fn => {
    let left = term();
    while (peek() === '+' || peek() === '-') {
      const op = next(), a = left, b = term();
      left = op === '+' ? p => a(p) + b(p) : p => a(p) - b(p);
    }
    return left;
  };
  const term = (): Fn => {
    let left = unary();
    while (peek() === '*' || peek() === '/' || peek() === '%') {
      const op = next(), a = left, b = unary();
      left = op === '*' ? p => a(p) * b(p) : op === '/' ? p => a(p) / b(p) : p => a(p) % b(p);
    }
    return left;
  };
  const unary = (): Fn => {
    if (peek() === '-') { next(); const a = unary(); return p => -a(p); }
    if (peek() === '+') { next(); return unary(); }
    return power();
  };
  const power = (): Fn => {
    const base = atom();
    if (peek() !== '^') return base;
    next();
    const exp = unary();
    return p => base(p) ** exp(p);
  };
  const atom = (): Fn => {
    const t = next();
    if (t == null) throw new Error('Unexpected end of the price expression');
    if (t.toLowerCase() === '[[price]]') return p => p;
    if (/^(\d|\.\d)/.test(t)) { const n = Number(t); return () => n; }
    if (t === '(') { const a = expr(); expect(')'); return a; }
    const fn = FUNCTIONS[t.toLowerCase()];
    if (fn) {
      expect('(');
      const args: Fn[] = [expr()];
      while (peek() === ',') { next(); args.push(expr()); }
      expect(')');
      return p => fn(...args.map(a => a(p)));
    }
    throw new Error(`Unsupported "${t}" in the price expression`);
  };

  const fn = expr();
  if (i < tokens.length) throw new Error(`Unexpected "${tokens[i]}" in the price expression`);
  return fn;
}
