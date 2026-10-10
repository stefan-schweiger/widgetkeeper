/*
 * Mock forecast for dev/weather-preview.html (the screenshots and showcase use showcase-data.js): an autumn day with sun,
 * showers, an evening of rain and a frosty clear night, from the current hour on.
 * `mockWeatherFromMet(json)` turns a real MET compact response (e.g. `?snap=/temp/met-compact.json`)
 * into the app's `/forecast` shape, like `hoursFrom()` in lib/WeatherService.ts. Needs mock-util.js.
 */
(function () {
  // [symbol (day/night picked by hour), °C, wind m/s, wind from °, precipitation mm]
  const DAY = [
    ['fair', 7.2, 3.1, 220, 0], ['partlycloudy', 8.4, 3.8, 225, 0], ['partlycloudy', 9.6, 4.6, 230, 0],
    ['cloudy', 10.1, 5.4, 235, 0], ['lightrainshowers', 9.8, 6.2, 240, 0.3], ['rainshowers', 9.1, 7.1, 245, 1.2],
    ['rain', 8.3, 8.4, 250, 2.4], ['heavyrain', 7.6, 9.6, 255, 4.8], ['rain', 6.9, 8.7, 260, 1.9],
    ['lightrain', 6.1, 7.2, 270, 0.4], ['cloudy', 5.2, 6.1, 280, 0], ['partlycloudy', 4.0, 4.9, 290, 0],
    ['fair', 2.6, 3.8, 300, 0], ['clearsky', 1.3, 3.0, 310, 0], ['clearsky', 0.2, 2.4, 315, 0],
    ['clearsky', -0.8, 2.0, 320, 0], ['clearsky', -1.6, 1.6, 320, 0], ['fair', -2.1, 1.4, 330, 0],
    ['fair', -2.4, 1.2, 340, 0], ['fog', -2.2, 0.8, 350, 0], ['fog', -1.4, 1.0, 0, 0],
    ['partlycloudy', 0.6, 1.8, 10, 0], ['partlycloudy', 2.9, 2.6, 20, 0], ['fair', 4.8, 3.2, 30, 0],
  ];
  function mockWeatherHours(start) {
    const from = Math.floor((start || Date.now()) / 3600e3) * 3600e3;
    return Array.from({ length: 48 }, (_, i) => {
      const [sym, temp, wind, windDir, precip] = DAY[i % DAY.length];
      const t = new Date(from + i * 3600e3);
      return { t: t.toISOString(), symbol: mockWeatherSymbol(sym, t), temp, wind, windDir, precip };
    });
  }

  function mockWeatherFromMet(json, now) {
    const from = Math.floor((now || Date.now()) / 3600e3) * 3600e3;
    return json.properties.timeseries
      .filter(e => Date.parse(e.time) >= from && e.data.next_1_hours)
      .slice(0, 48)
      .map((e) => {
        const d = e.data.instant.details;
        const n = e.data.next_1_hours;
        return {
          t: new Date(e.time).toISOString(), symbol: n.summary.symbol_code, temp: d.air_temperature,
          wind: d.wind_speed, windDir: d.wind_from_direction, precip: n.details.precipitation_amount,
        };
      });
  }

  window.mockWeatherHours = mockWeatherHours;
  window.mockWeatherFromMet = mockWeatherFromMet;
})();
