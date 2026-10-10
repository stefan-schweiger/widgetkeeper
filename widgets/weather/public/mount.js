/*
 * Wires createWeatherWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountWeatherWidget = function (Homey, { root, frame }) {
  // The app only refetches from MET when its forecast expires (~30 min); this picks that up.
  const REFRESH_MS = 5 * 60e3;

  // Load marks for the app's diagnostics log, sent with the first request only.
  let perf = '';
  function loadMarks(sdkAt) {
    const nav = /** @type {PerformanceNavigationTiming | null} */ (performance.getEntriesByType ? performance.getEntriesByType('navigation')[0] : null);
    return [Math.round(performance.timeOrigin), nav ? Math.round(nav.responseEnd) : -1,
      Math.round(sdkAt), Math.round(performance.now())].join(',');
  }
  function perfParam() {
    const p = perf ? `?perf=${perf}` : '';
    perf = '';
    return p;
  }

  perf = loadMarks(performance.now());
  const settings = Homey.getSettings() || {};
  let readySent = false;

  const widget = window.createWeatherWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    density: settings.density,
    rows: settings.rows,
    step: settings.step,
    theme: settings.theme,
    frame: frame,
    // The widget reports its own height; Homey needs the body's, which adds the widget padding.
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  function ready() {
    if (readySent) return;
    readySent = true;
    Homey.ready({ height: bodyHeight() });
  }

  let loaded = false;
  async function load() {
    try {
      widget.setForecast(await Homey.api('GET', `/forecast${perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the forecast already shown.
      if (!loaded) widget.setMessage(widget.t('error'));
    }
    ready();
  }

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountWeatherWidget.frameClass = 'homey-widget wf-frame';
