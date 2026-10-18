---
paths:
  - "widgets/clock/**"
  - "test/clock-*.test.ts"
  - "dev/clock-preview.html"
---
# Clock widget (`clock`)

- The time over the date, and optionally the weather on the right, in one transparent tile (the Energy Price Strip's; 76 px). The user picked this over a centred layout, and the icon, temperature now and today's high and low over a condition text and rain/wind.
- The time is `Intl` in the screen's locale (`opts.locale`, else the browser's), which picks 24 or 12 hours (the user chose no setting); 24 hours always has two digits (`00:00`); Danish shows `18.40`, as the locale does. The date: weekday, day and month in Homey's language, in the screen region's order (`en` alone is American, `Tuesday, October 6`; `en` + `da-DK` → `en-DK`, `Tuesday, 6 October`); an unknown language falls back to English in that order. No strings, so no `DEFAULT_STRINGS` (left out of the fallback-strings test) and no locale keys but `web.about.clock`.
- It ticks just after each minute and re-renders when the page becomes visible. `opts.now` replaces the clock.
- `showWeather` (on); off asks `/clock?weather=0`, which reads no forecast. `GET /clock?weather=1` → `{language, weather}`: no service; `app.weather.getForecast()` (so no extra MET traffic, and Weather Forecast's idle drop) reduced by `clockWeather()` to `{symbol, temp, high, low, icon}` (the current hour; the high and low of the rest of the local day in Homey's timezone, as the Weather footer) or `{noLocation: true}`. The weather hides without a location or temperature; a failed read keeps what's shown, and the clock never shows an error. Refetch every 5 min. `ready` waits for the first `/clock` at most 1.5 s (`WEATHER_WAIT_MS`), so a slow MET doesn't hide the time.
- The icon is a data URL of the SVG, else `../weather/icons/<symbol>.svg` (the Weather Forecast's files, served next to this widget). The showcase reduces its weather the same way (`clockWeather()` in `dev/showcase-data.js`).
