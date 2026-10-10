/*
 * Wires createTimersWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountTimersWidget = function (Homey, { root, frame }) {
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
  let readySent = false;
  let loaded = false;
  let instance = '';

  const widget = window.createTimersWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    presets: window.timerPresetsFromSettings(settings),
    sound: settings.sound !== false,
    onStart: (minutes, label) => Homey.api('POST', '/start', { instance, minutes, label }),
    onAction: (id, action) => Homey.api('POST', '/action', { instance, id, action }),
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
    try {
      widget.setState(await Homey.api('GET', `/state?instance=${encodeURIComponent(instance)}${perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the timers; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  // Every screen showing this widget gets the same timers: the app sends each change to all of them.
  Homey.on('timers:state', (data) => {
    if (data && data.instance === instance) widget.setState(data);
  });
  // A tablet waking up: its timers may have moved on while it slept.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && loaded) load(); });

  Promise.resolve(typeof Homey.getWidgetInstanceId === 'function' ? Homey.getWidgetInstanceId() : '')
    .then((id) => { instance = typeof id === 'string' && id ? id : 'default'; })
    .catch(() => { instance = 'default'; })
    .then(() => {
      perf = loadMarks(sdkAt);
      setInterval(load, REFRESH_MS);
      load();
    });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountTimersWidget.frameClass = 'homey-widget-full';
