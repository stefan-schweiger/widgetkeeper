/*
 * Wires createCamerasWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountCamerasWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // re-reads the devices (names, image and video ids)

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
  const snapshotMs = (Number(settings.refresh) || 10) * 1000;
  let deviceIds = [];
  let readySent = false;
  let loaded = false;
  let snapshotTimer = null;
  let visible = true; // false while the Smart Stack shows another page

  const widget = window.createCamerasWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    refreshMs: snapshotMs,
    api: (method, path, body) => Homey.api(method, path, body),
    report: (text) => { Homey.api('POST', '/report', { text }).catch(() => {}); },
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

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

  // Snapshots refresh on their own timer, and not while the dashboard is in the background (or the stack's
  // slide is off screen).
  function startSnapshots() {
    if (snapshotTimer || document.hidden || !visible || !loaded) return;
    widget.refresh();
    snapshotTimer = setInterval(() => widget.refresh(), snapshotMs);
  }
  function stopSnapshots() {
    if (snapshotTimer) clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopSnapshots(); widget.pause(); } else startSnapshots();
  });

  async function load() {
    if (!deviceIds.length) {
      widget.setMessage(widget.t('selectDevices'));
      ready();
      return;
    }
    try {
      widget.setState(await Homey.api('GET', `/state?deviceIds=${deviceIds.map(encodeURIComponent).join(',')}${perfParam()}`));
      loaded = true;
      startSnapshots();
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the tiles; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Promise.resolve(typeof Homey.getDeviceIds === 'function' ? Homey.getDeviceIds() : [])
    .then((ids) => { deviceIds = Array.isArray(ids) ? ids : []; })
    .catch(() => { deviceIds = []; })
    .then(() => {
      perf = loadMarks(sdkAt);
      setInterval(load, REFRESH_MS);
      load();
    });

  return {
    /** The Smart Stack: whether this page is the one on screen. */
    setVisible(v) {
      visible = !!v;
      if (visible) startSnapshots();
      else { stopSnapshots(); widget.pause(); }
    },
  };
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountCamerasWidget.frameClass = 'homey-widget-full';
