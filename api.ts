import type { App } from 'homey';
import type WidgetkeeperApp from './app.js';

type Homey = App['homey'];

export default {
  /**
   * Used by the app settings page: `GET /diagnostics[?device=<id or name>]`. With `heatmap=<deviceId>:<capabilityId>[:<days>]`,
   * the report also has the heatmap widget's history for it (`npm run diagnostics -- --heatmap …`).
   */
  async getDiagnostics({ homey, query }: { homey: Homey, query: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    const report: Record<string, unknown> = await app.diagnostics.report(query.device || undefined);
    if (query.heatmap) {
      const [deviceId, capabilityId, days] = query.heatmap.split(':');
      try {
        report.heatmapHistory = await app.heatmap.getHistory(deviceId, capabilityId, Number(days) || 7);
      } catch (err) {
        report.heatmapHistory = { error: err instanceof Error ? err.message : String(err) };
      }
    }
    return report;
  },

  /**
   * Used by the app settings page: whether the personal API key (Flow Variables and Flow Buttons) is saved, never
   * the key itself. The path predates Flow Buttons.
   */
  async getVariablesKey({ homey }: { homey: Homey }) {
    const app = homey.app as WidgetkeeperApp;
    return { set: app.apiKey.has() };
  },

  /**
   * Used by the app settings page: checks and saves the personal API key (`{key: ''}` removes it). The answer says
   * whether it may change variables and start flows, or why it wasn't saved.
   */
  async putVariablesKey({ homey, body }: { homey: Homey, body: { key?: unknown } }) {
    const app = homey.app as WidgetkeeperApp;
    return app.apiKey.save(typeof body?.key === 'string' ? body.key : '');
  },
};
