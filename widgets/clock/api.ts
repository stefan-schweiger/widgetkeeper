import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { localHour } from '../../lib/heatmap.js';
import type { Forecast } from '../../lib/WeatherService.js';
import { logged, logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

export type ClockWeather = {
  symbol: string | null,
  temp: number | null,
  /** Today's highest and lowest temperature from the current hour on (the forecast starts there). */
  high: number | null,
  low: number | null,
  /** The SVG of `symbol`, so the widget needs no request for the icon. */
  icon: string | null,
} | { noLocation: true };

/**
 * What the Clock shows of the Weather Forecast's data: the current hour and the rest of today (in `timeZone`).
 * Null without any hours.
 */
export function clockWeather(forecast: Forecast, timeZone: string): ClockWeather | null {
  if (forecast.noLocation) return { noLocation: true };
  const [now] = forecast.hours;
  if (!now) return null;
  const today = localHour(Date.parse(now.t), timeZone).date;
  const temps = forecast.hours
    .filter(h => typeof h.temp === 'number' && localHour(Date.parse(h.t), timeZone).date === today)
    .map(h => h.temp as number);
  return {
    symbol: now.symbol,
    temp: now.temp,
    high: temps.length ? Math.max(...temps) : null,
    low: temps.length ? Math.min(...temps) : null,
    icon: (now.symbol && forecast.icons?.[now.symbol]) || null,
  };
}

export default {
  /** `{language, weather}`; the weather (the Weather Forecast's, so no extra MET traffic) only with `weather=1`. */
  async getClock({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Clock', query);
    const language = homey.i18n.getLanguage();
    if (query.weather !== '1') return { language, weather: null };
    const forecast = await logged(app, 'Clock weather failed:', () => app.weather.getForecast());
    return { language, weather: clockWeather(forecast, homey.clock.getTimezone()) };
  },
};
