import type { App } from 'homey';
import type WidgetkeeperApp from './app.js';

type Homey = App['homey'];

export default {
  /** Used by the app settings page: `GET /diagnostics[?device=<id or name>]`. */
  async getDiagnostics({ homey, query }: { homey: Homey, query: Record<string, string> }) {
    const app = homey.app as WidgetkeeperApp;
    return app.diagnostics.report(query.device || undefined);
  },
};
