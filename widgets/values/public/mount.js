/*
 * Wires createValuesWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountValuesWidget = function (Homey, { root, frame }) {
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
    const known = Promise.resolve(typeof Homey.getWidgetInstanceId === 'function' ? Homey.getWidgetInstanceId() : '')
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
  const settings = Homey.getSettings() || {};
  // Each slot setting is an autocomplete item whose id is `<deviceId>:<capabilityId>`.
  // An optional name per tile (`nameN`, text) replaces the device's.
  const picked = [1, 2, 3, 4, 5, 6]
    .map(n => ({ id: settings[`slot${n}`] && settings[`slot${n}`].id, name: settings[`name${n}`] }))
    .filter(s => typeof s.id === 'string' && s.id.indexOf(':') > 0 && !s.id.endsWith(':')); // as parseSlot(), so the names stay in line
  const slots = picked.map(s => s.id);
  let readySent = false;
  let loaded = false;

  const tileNames = wireTileNames(names => widget.setNames(names));
  const widget = window.createValuesWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    columns: settings.columns,
    percentFill: settings.percentFill === true,
    redBelow: settings.redBelow,
    yellowBelow: settings.yellowBelow,
    names: picked.map(s => s.name),
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in after the icons.
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
    if (!slots.length) {
      widget.setMessage(widget.t('selectSlots'));
      ready();
      return;
    }
    const namesRead = tileNames.load();
    try {
      const state = await Homey.api('GET', `/state?slots=${slots.map(encodeURIComponent).join(',')}${perfParam()}`);
      await namesRead;
      widget.setState(state);
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the tiles; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('values:state', (data) => {
    if (data) widget.pushChange(data);
  });

  // A Flow set (or reset) the colour of a value's tiles.
  Homey.on('values:color', (data) => {
    if (data) widget.pushColor(data);
  });

  perf = loadMarks(sdkAt);
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountValuesWidget.frameClass = 'homey-widget-full';
