/*
 * Wires createClockWidget to Homey: the settings and the app's API. index.html calls it with the frame's own Homey
 * and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountClockWidget = function (Homey, { root, frame }) {
  // The app only refetches from MET when its forecast expires (~30 min); this picks that up.
  const REFRESH_MS = 5 * 60e3;
  // The time needn't wait for the weather: shown with it, or without it this long in (the weather follows).
  const WEATHER_WAIT_MS = 1500;

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
  const showWeather = settings.showWeather !== false;
  let readySent = false;

  const widget = window.createClockWidget(root, {
    showWeather,
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

  let loadedAt = 0;
  async function load() {
    if (!loadedAt) setTimeout(ready, WEATHER_WAIT_MS);
    loadedAt = Date.now();
    try {
      widget.setState(await Homey.api('GET', `/clock?weather=${showWeather ? 1 : 0}${perfParam()}`));
    } catch (err) {
      // The clock runs on without the app: a failed read keeps the weather shown (none on the first).
      console.error(err);
    }
    ready();
  }

  // A screen waking up (a tablet) gets the time at once, and the weather when it's due.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    widget.render();
    if (Date.now() - loadedAt >= REFRESH_MS) load();
  });

  perf = loadMarks(sdkAt);
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountClockWidget.frameClass = 'homey-widget-full';
