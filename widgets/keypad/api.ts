import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { idList, keyResult, logged, logPerf } from '../../lib/widgetApi.js';
import type { PressBody } from '../../lib/KeypadService.js';

type Homey = App['homey'];

/** Keypad: buttons behind an optional code that start a Flow or set the state the widget shows. */
export default {
  /**
   * `source`: the `state` setting's id (`var:<id>` or `cap:<deviceId>:<capabilityId>`; none without one), `flows`: the
   * buttons' flows. Answers `{source, flows}`.
   */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Keypad', query);
    return logged(app, 'Keypad state failed:', () => app.keypad.getState(query.source || null, idList(query.flows)));
  },

  /**
   * A button: `{flow}` or `{source, value}`, with `{codeId, code}` when it wants the code. Answers `{ok: true, result}`
   * (`done`, `wrongCode` with `left`, `locked` with `retryAfter`, `codeReset`, `notSetable`), or without a usable API
   * key `{ok: false, reason}`.
   */
  async press({ homey, body }: {
    homey: Homey,
    body: PressBody,
  }) {
    const app = homey.app as WidgetkeeperApp;
    return keyResult(app, 'Keypad button failed', () => app.keypad.press(body ?? {}));
  },
};
