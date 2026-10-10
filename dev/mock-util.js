/*
 * Helpers shared by the dev pages' mock data (mock-electricity.js, mock-weather.js, mock-heatmap.js and
 * showcase-data.js). Load it before them.
 */
(function () {
  /** A fixed pseudo-random sequence in [0, 1) (Park–Miller), so the mock data is the same on every render. */
  function mockRng(seed) {
    return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  }

  // MET's symbols with a _day/_night variant (the files in widgets/weather/public/icons/): clear sky, fair, partly
  // cloudy and every kind of showers. The rest (cloudy, rain, fog …) have one icon.
  const NIGHT_CAPABLE = /^(clearsky|fair|partlycloudy|\w+showers\w*)$/;
  /** The symbol code as MET sends it for the hour starting at `date`: night from 19:00 to 07:00, local time. */
  function mockWeatherSymbol(symbol, date) {
    if (!NIGHT_CAPABLE.test(symbol)) return symbol;
    const hour = date.getHours();
    return `${symbol}_${hour >= 19 || hour < 7 ? 'night' : 'day'}`;
  }

  /**
   * The heatmap's `/history` days: for each of `dates` (`{date, weekday, …}`), 24 hourly values from
   * `fn(hour, day, r)`, where `r` is one seeded sequence for all of them. The last day stops after `lastHour`
   * (later hours are null, still to come).
   */
  function mockHeatmapDays(dates, lastHour, fn, seed) {
    const r = mockRng(seed);
    return dates.map((d, i) => ({
      date: d.date,
      weekday: d.weekday,
      hours: Array.from({ length: 24 }, (_, h) => (i === dates.length - 1 && h > lastHour ? null : fn(h, d, r))),
    }));
  }

  window.mockRng = mockRng;
  window.mockWeatherSymbol = mockWeatherSymbol;
  window.mockHeatmapDays = mockHeatmapDays;
})();
