import type { App } from 'homey';
import type WidgetkeeperApp from '../../app.js';
import { TIMER_ACTIONS, type TimerAction } from '../../lib/TimerService.js';
import { logPerf } from '../../lib/widgetApi.js';

type Homey = App['homey'];

/** The widget instance's id (`Homey.getWidgetInstanceId()`): the timers belong to it. */
function instanceOf(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > 100) throw new Error('Missing instance');
  return value;
}

export default {
  /** `instance`: the widget instance. Its timers and the Homey's clock (`{instance, timers, now}`). */
  async getState({ homey, query }: {
    homey: Homey,
    query: Record<string, string>,
  }) {
    const app = homey.app as WidgetkeeperApp;
    logPerf(app, 'Timers', query);
    return app.timers.getState(instanceOf(query.instance));
  },

  /** `{instance, minutes, label}`: starts a timer. Answers with the instance's timers. */
  async start({ homey, body }: {
    homey: Homey,
    body: { instance?: unknown, minutes?: unknown, label?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    return app.timers.startTimer(instanceOf(body?.instance), body?.minutes, body?.label);
  },

  /** `{instance, id, action}`: pause, resume, add (a minute), cancel or dismiss. Answers with the instance's timers. */
  async action({ homey, body }: {
    homey: Homey,
    body: { instance?: unknown, id?: unknown, action?: unknown },
  }) {
    const app = homey.app as WidgetkeeperApp;
    if (typeof body?.id !== 'string' || !body.id) throw new Error('Missing id');
    if (!TIMER_ACTIONS.includes(body?.action as TimerAction)) throw new Error(`Unknown action ${JSON.stringify(body?.action)}`);
    return app.timers.act(instanceOf(body.instance), body.id, body.action as TimerAction);
  },
};
