/*
 * Wires createHeatmapWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountHeatmapWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // the hour cells change at most hourly; keeps a recorded on/off value's request time fresh

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
  const capabilityId = (settings.capability && settings.capability.id) || null;
  let readySent = false;
  let loaded = false;

  const widget = window.createHeatmapWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    period: settings.period,
    step: Number(settings.step) || 2,
    color: settings.color,
    showScale: settings.showScale !== false,
    showLegend: settings.showLegend !== false,
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

  async function load() {
    if (!deviceId || !capabilityId) {
      widget.setMessage(widget.t('selectDevice'));
      ready();
      return;
    }
    try {
      widget.setData(await Homey.api('GET',
        `/history?deviceId=${encodeURIComponent(deviceId)}&capabilityId=${encodeURIComponent(capabilityId)}&days=${window.heatmapPeriodDays(settings.period)}${perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the heatmap; only a failed first load replaces it with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountHeatmapWidget.frameClass = 'homey-widget hm-frame';
