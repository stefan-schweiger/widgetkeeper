/*
 * Wires createVariablesWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountVariablesWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's Logic subscription alive and resyncs state

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
  // Each slot setting is an autocomplete item whose id is the Logic variable's id (`none` empties it).
  // An optional name per row (`nameN`, text) replaces the variable's.
  const picked = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map(n => ({ id: settings[`slot${n}`] && settings[`slot${n}`].id, name: settings[`name${n}`] }))
    .filter(s => typeof s.id === 'string' && s.id && s.id !== 'none');
  const ids = picked.map(s => s.id);
  let readySent = false;
  let loaded = false;

  const widget = window.createVariablesWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    columns: settings.columns,
    step: settings.step,
    names: picked.map(s => s.name),
    onSet: async (id, value) => {
      const res = await Homey.api('POST', '/set', { id, value });
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
    if (!ids.length) {
      widget.setMessage(widget.t('selectSlots'));
      ready();
      return;
    }
    try {
      widget.setState(await Homey.api('GET', `/state?ids=${ids.map(encodeURIComponent).join(',')}${perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the rows; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('variables:state', (data) => {
    if (data) widget.pushChange(data);
  });

  perf = loadMarks(sdkAt);
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountVariablesWidget.frameClass = 'homey-widget-full';
