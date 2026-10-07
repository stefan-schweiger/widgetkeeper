/* Mock electricity snapshots for the dev pages (preview.html, screenshots.html). */
// Mock data, ported from the prototype's generator (Handoff/prototype/Electricity Widget.dc.html).
function rng(seed) { return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
const PB = [1.30, 1.25, 1.22, 1.20, 1.22, 1.35, 1.75, 2.25, 2.38, 2.05, 1.75, 1.50, 1.30, 1.22, 1.25, 1.40, 1.85, 2.30, 2.58, 2.50, 2.15, 1.80, 1.60, 1.42];
const UB = [0.32, 0.30, 0.28, 0.29, 0.30, 0.35, 0.70, 1.10, 0.85, 0.55, 0.48, 0.52, 0.60, 0.50, 0.48, 0.55, 0.95, 1.60, 1.85, 1.40, 1.05, 0.80, 0.60, 0.42];

// `solar`: solar panels export (negative power) around midday, and for the last 20 min of live readings.
function mockSnapshot({ futureHours = 24, solar = false } = {}) {
  const now = Date.now(), r = rng(4242);
  const hs = Math.floor(now / 3600e3) * 3600e3, mins = new Date(now).getMinutes();
  const prices = [];
  for (let i = 0; i < 49; i++) {
    const t = hs + (i - 24) * 3600e3, d = new Date(t), h = d.getHours();
    const dayF = d.getDate() % 2 ? 0.94 : 1.04;
    const price = +(PB[h] * dayF + (r() - 0.5) * 0.08).toFixed(2);
    r();
    prices.push({ start: t, price: i > 24 + futureHours ? null : price });
  }
  const usage = [];
  const nFine = 24 * 12 + Math.floor(mins / 5) + 1;
  let fridge = 0, spike = 0, spikeW = 0;
  for (let j = 0; j < nFine; j++) {
    const h = new Date(prices[Math.floor(j / 12)].start).getHours();
    if (j % 3 === 0) fridge = (fridge + 1) % 5;
    if (spike <= 0 && r() < (h >= 6 && h <= 22 ? 0.05 : 0.01)) { spike = 1 + Math.floor(r() * 4); spikeW = 350 + r() * 650; }
    let v = 120 + UB[h] * 1300 * (0.8 + r() * 0.4) + (fridge < 2 ? 110 : 0) + (r() - 0.5) * 60;
    if (spike > 0) { v += spikeW * (0.85 + r() * 0.3); spike--; }
    let w = Math.max(120, v);
    if (solar && h >= 10 && h < 17) w -= 2600 * Math.sin((h - 10 + (j % 12) / 12) / 7 * Math.PI);
    usage.push({ t: prices[0].start + j * 300e3, w: Math.round(w) });
  }
  // Raw meter readings every ~5–15 s for the last hour.
  const live = [];
  for (let t = now - 3600e3; t <= now; t += 5e3 + r() * 10e3) {
    const m = (t - now) / 60e3;
    let v = 285 + r() * 30;
    if (Math.floor((m + 60) / 13) % 2 === 0) v += 115;
    if (m > -38 && m < -27) v += 1820 + r() * 60;
    if (m > -9) v += 560 + r() * 25;
    if (m > -4 && m < -2) v += 900;
    if (solar && m > -20) v -= 1900;
    live.push({ t: Math.round(t), w: Math.round(v) });
  }
  return { now, deviceName: 'Meter', live, prices, usage, currency: 'DKK' };
}
