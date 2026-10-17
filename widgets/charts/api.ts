import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, logged, logPerf } from '../../lib/widgetApi.js';
import { parseSlot } from '../../lib/ValueService.js';

type Homey = App['homey'];

export default {
  /**
   * `charts`: comma-separated `<deviceId>:<capabilityId>~<span>` (the span as Sparklines': `1h` … `7d`).
   * `{charts, language}`: one entry per chart, in order, Sparklines' slot state with its history (Device Values'
   * name and value), and Homey's language (the weekday labels).
   */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Charts', query);
    return logged(app, 'Charts state failed:', async () => ({
      language: homey.i18n.getLanguage(),
      charts: await Promise.all(idList(query.charts).map(async (chart) => {
        const at = chart.lastIndexOf('~');
        const slot = at > 0 ? chart.slice(0, at) : chart;
        const span = at > 0 ? chart.slice(at + 1) : undefined;
        const [state] = await app.sparklines.getState([slot], span);
        return state ?? { ...(parseSlot(slot) ?? { deviceId: slot, capabilityId: '' }), missing: true as const };
      })),
    }));
  },
};
