/*
 * Wires createRoomHealthWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountRoomHealthWidget = function (Homey, { root, frame }) {
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
   * The names typed on the tiles (`renameTiles`), which the app keeps per widget instance: `state(path)` reads
   * `/state` with them (a failure keeps the last ones), realtime keeps them current, and `rename(key, name)` saves one.
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
      // `/state` with the instance answers `{state, tileNames}`: the names come with every read, in one request.
      state: path => known
        .then(() => Homey.api('GET', `${path}&instance=${encodeURIComponent(instance)}`))
        .then((res) => {
          if (!res || typeof res !== 'object' || !('tileNames' in res)) return res;
          setNames(res.tileNames);
          return res.state;
        }),
      rename: (key, name) => known.then(() => Homey.api('POST', '/names', { instance, key, name })),
    };
  }

  const sdkAt = performance.now();
  const settings = Homey.getSettings() || {};
  let deviceIds = [];
  let readySent = false;
  let loaded = false;

  const tileNames = wireTileNames(names => widget.setNames(names));
  // The comfortable ranges, as the settings give them (the widget puts in the defaults).
  const ranges = {};
  for (const id of ['tempMin', 'tempMax', 'humidityMin', 'humidityMax', 'co2Max', 'radonMax', 'pm25Max', 'pm10Max', 'vocMax']) ranges[id] = settings[id];
  const widget = window.createRoomHealthWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    ...ranges,
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  // Shown once the text font has loaded (at most 1 s), so the names don't pop in after the rings.
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
    try {
      const state = await tileNames.state(`/state?deviceIds=${deviceIds.map(encodeURIComponent).join(',')}${perfParam()}`);
      widget.setState(state);
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the rings; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('roomhealth:state', (data) => {
    if (data && deviceIds.includes(data.deviceId)) widget.pushChange(data);
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
window.mountRoomHealthWidget.frameClass = 'homey-widget-full';
