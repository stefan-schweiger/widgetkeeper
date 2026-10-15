/*
 * Wires createLightsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountLightsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state

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

  /**
   * The names typed on the tiles (`renameTiles`), which the app keeps per widget instance: `load()` reads them (a
   * failure keeps the last ones; it never fails), realtime keeps them current, and `rename(key, name)` saves one.
   * `setNames` is the widget's.
   */
  function wireTileNames(setNames) {
    let instance = 'default';
    let asked = '';
    try { asked = typeof Homey.getWidgetInstanceId === 'function' ? Homey.getWidgetInstanceId() : ''; } catch (e) { /* stays 'default' */ }
    const known = Promise.resolve(asked)
      .then((id) => { if (typeof id === 'string' && id) instance = id; })
      .catch(() => {});
    Homey.on('tilenames:state', (data) => {
      if (data && data.instance === instance) setNames(data.names);
    });
    return {
      load: () => known
        .then(() => Homey.api('GET', `/names?instance=${encodeURIComponent(instance)}`))
        .then(res => setNames(res && res.names), err => console.error(err)),
      rename: (key, name) => known.then(() => Homey.api('POST', '/names', { instance, key, name })),
    };
  }

  const sdkAt = performance.now();
  let deviceIds = [];
  /** The lights whose realtime events count: the picked ones, and the lights in Homey group devices among them. */
  let watched = new Set();
  let readySent = false;
  let loaded = false;

  const settings = Homey.getSettings() || {};
  const tileNames = wireTileNames(names => widget.setNames(names));
  const widget = window.createLightsWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    groupByZone: settings.groupByZone === true,
    palette: settings.palette,
    barMin: settings.barMin,
    onSet: (deviceId, change) => Homey.api('POST', '/set', { deviceId, ...change }),
    onMood: async (id) => {
      const res = await Homey.api('POST', '/mood', { id });
      // No usable API key: the widget says what to do (see the app settings).
      if (res && res.ok === false) throw Object.assign(new Error(res.reason), { reason: res.reason });
    },
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  // Shown once the text font has loaded (at most 1 s), so the names don't pop in after the icons.
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
    if (!deviceIds.length) {
      widget.setMessage(widget.t('selectDevices'));
      ready();
      return;
    }
    const namesRead = tileNames.load();
    try {
      const state = await Homey.api('GET', `/state?deviceIds=${deviceIds.map(encodeURIComponent).join(',')}${perfParam()}`);
      await namesRead;
      widget.setState(state);
      watched = new Set(deviceIds);
      for (const d of Array.isArray(state) ? state : []) for (const m of (d && d.groupLights) || []) watched.add(m.id);
      loaded = true;
      loadMoods(state);
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the tiles; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  /** `palette: moods`: the Moods of the lights' rooms. A failed read keeps the last ones. */
  async function loadMoods(state) {
    if (settings.palette !== 'moods' || !Array.isArray(state)) return;
    const zones = [...new Set(state.map(d => d.zone && d.zone.id).filter(Boolean))];
    if (!zones.length) return;
    try {
      const res = await Homey.api('GET', `/moods?zones=${zones.map(encodeURIComponent).join(',')}`);
      widget.setMoods(res && res.moods);
    } catch (err) {
      console.error(err);
    }
  }

  Homey.on('lights:state', (data) => {
    if (data && (watched.has(data.deviceId) || deviceIds.includes(data.deviceId))) widget.pushChange(data);
  });

  Promise.resolve(typeof Homey.getDeviceIds === 'function' ? Homey.getDeviceIds() : [])
    .then((ids) => { deviceIds = Array.isArray(ids) ? ids : []; })
    .catch(() => { deviceIds = []; })
    .then(() => {
      perf = loadMarks(sdkAt);
      setInterval(load, REFRESH_MS);
      load();
    });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountLightsWidget.frameClass = 'homey-widget-full';
