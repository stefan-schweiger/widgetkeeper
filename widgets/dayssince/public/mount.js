/*
 * Wires createDaysSinceWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body. `frame` is the element whose height Homey gets (the body).
 */
window.mountDaysSinceWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // resyncs in case a realtime event was missed

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

  const sdkAt = performance.now();
  const settings = Homey.getSettings() || {};
  const counters = window.daysSinceCountersFromSettings(settings);
  const keys = new Set(counters.map(c => c.key));
  // The app learns each counter's intervals from the widgets showing it (for the Flow cards).
  const defs = encodeURIComponent(JSON.stringify(counters.map(c => ({ name: c.name, amber: c.amber, red: c.red }))));
  let readySent = false;
  let loaded = false;
  let loadedAt = 0;

  const widget = window.createDaysSinceWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    counters,
    units: settings.units,
    onReset: name => Homey.api('POST', '/reset', { name }),
    onUndo: (name, at) => Homey.api('POST', '/undo', { name, at }),
    onHaptic: () => {
      try { if (Homey.hapticFeedback) Homey.hapticFeedback(); } catch (e) { /* not on every platform */ }
    },
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in.
  let readyStarted = false;
  async function ready() {
    if (readyStarted) return;
    readyStarted = true;
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1000))]);
    }
    readySent = true;
    Homey.ready({ height: bodyHeight() });
  }

  async function load() {
    loadedAt = Date.now();
    if (!counters.length) { ready(); return; }
    try {
      widget.setState(await Homey.api('GET', `/state?counters=${defs}${perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the counters; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  // Every screen showing one of these counters gets each reset: the app sends them to all widgets.
  Homey.on('dayssince:state', (entry) => {
    if (entry && keys.has(entry.key)) widget.update(entry);
  });
  // A tablet waking up: the days at once, and the app's counters when they're due.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    widget.render();
    if (loaded && Date.now() - loadedAt >= REFRESH_MS) load();
  });

  perf = loadMarks(sdkAt);
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body. */
window.mountDaysSinceWidget.frameClass = 'homey-widget-full';
