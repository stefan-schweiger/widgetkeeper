/*
 * Mock `/history` responses for the heatmap previews: a light sensor (daylight through a window) and a
 * motion sensor (busy mornings and evenings). The last day is "today" up to `hour`; later hours are null.
 */
(function () {
  const svg = body => 'data:image/svg+xml;base64,' + btoa(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="#000" stroke-width="1.5" stroke-linecap="round">${body}</svg>`);
  const SENSOR = svg('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>');

  // A fixed pseudo-random sequence, so the previews don't change between renders.
  function rng(seed) {
    let s = seed;
    return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
  }

  /** `count` days ending on `today` (YYYY-MM-DD). */
  function dates(today, count) {
    const out = [];
    for (let k = count - 1; k >= 0; k--) {
      const d = new Date(`${today}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() - k);
      out.push({ date: d.toISOString().slice(0, 10), weekday: d.getUTCDay() });
    }
    return out;
  }

  function days(today, hour, fn, seed, count = 7) {
    const r = rng(seed);
    return dates(today, count).map((d, i) => ({
      ...d,
      hours: Array.from({ length: 24 }, (_, h) => (i === count - 1 && h > hour ? null : fn(h, d.weekday, r))),
    }));
  }

  window.mockHeatmapLux = function (today = '2026-10-04', hour = 9, count = 7) {
    return {
      name: 'Hue motion sensor',
      icon: SENSOR,
      capability: { id: 'measure_luminance', title: 'Luminance', type: 'number', units: 'lx', decimals: null },
      value: 5.2,
      language: 'en',
      days: days(today, hour, (h, wd, r) => {
        if (h < 7 || h > 19) return 1 + r() * 0.3;
        const sun = Math.sin(((h - 7) / 12) * Math.PI);
        const cloud = wd === 2 ? 0.6 : 0.85 + r() * 0.3;
        return Math.max(1, sun * 38 * cloud);
      }, 7, count),
    };
  };

  window.mockHeatmapMotion = function (today = '2026-10-04', hour = 9) {
    const data = days(today, hour, (h, wd, r) => {
      const weekend = wd === 0 || wd === 6;
      const busy = (h >= 6 && h <= 8 && !weekend) || (h >= 8 && h <= 11 && weekend) || (h >= 16 && h <= 21);
      return busy ? 0.2 + r() * 0.5 : h < 6 ? 0 : r() * 0.08;
    }, 11);
    // On/off values are recorded from when the widget was added: nothing before that.
    for (let h = 0; h < 15; h++) data[0].hours[h] = null;
    return {
      name: 'Motion sensor | Kitchen',
      icon: SENSOR,
      capability: { id: 'alarm_motion', title: 'Motion alarm', type: 'boolean', units: null, decimals: null },
      value: false,
      language: 'en',
      days: data,
    };
  };
})();
