/*
 * Wires createThermostatWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountThermostatWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscription alive and resyncs state

  // Load marks for the app's diagnostics log, sent with the first request only.
  let perf = '';
  function loadMarks(sdkAt) {
    const nav = /** @type {PerformanceNavigationTiming | null} */ (performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null);
    return [Math.round(performance.timeOrigin), nav ? Math.round(nav.responseEnd) : -1,
      Math.round(sdkAt), Math.round(performance.now())].join(',');
  }
  function perfParam() {
    const p = perf ? `&perf=${perf}` : '';
    perf = '';
    return p;
  }

  perf = loadMarks(performance.now());
  const settings = Homey.getSettings() || {};
  const deviceId = (settings.device && settings.device.id) || null;
  let readySent = false;
  let loaded = false;

  const widget = window.createThermostatWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    layout: settings.layout, // missing on widgets placed before the setting: standard
    onApply: (values) => Homey.api('POST', '/apply', {
      deviceId, values: values.map(({ capabilityId, value }) => ({ capabilityId, value })),
    }),
    // The widget reports its own height; Homey needs the body's, which adds the widget padding.
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });
  widget.setButtons(window.thermostatPresetsFromSettings(settings));

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  function ready() {
    if (readySent) return;
    readySent = true;
    Homey.ready({ height: bodyHeight() });
  }

  async function load() {
    if (!deviceId) {
      widget.setMessage(widget.t('selectDevice'));
      ready();
      return;
    }
    try {
      const state = await Homey.api('GET', `/state?deviceId=${encodeURIComponent(deviceId)}${perfParam()}`);
      loaded = !state.missing; // a deleted device: the buttons go, the next error is persistent too
      if (state.missing) widget.setMessage(widget.t('error'));
      else widget.setState(state);
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the buttons; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('thermostat:state', (data) => {
    if (data && data.deviceId === deviceId) widget.pushChange(data);
  });

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountThermostatWidget.frameClass = 'homey-widget tw-frame';
