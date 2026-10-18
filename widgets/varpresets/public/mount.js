/*
 * Wires createVarPresetsWidget to Homey: the settings, the app's API and the variable's realtime events. index.html
 * calls it with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its
 * own. `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountVarPresetsWidget = function (Homey, { root, frame }) {
  // The events keep it current; this keeps the app's interest in the variable alive and catches a missed one.
  const REFRESH_MS = 5 * 60e3;

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const variableId = settings.variable && settings.variable.id && settings.variable.id !== 'none' ? settings.variable.id : null;
  let loaded = false;
  let loadedAt = 0;

  const widget = window.createVarPresetsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    layout: settings.layout, // standard unless compact
    color: settings.color, // missing or unknown: blue
    icon: settings.icon && settings.icon.id,
    title: settings.title,
    onSet: async (value) => {
      const res = await Homey.api('POST', '/set', { id: variableId, value });
      if (res && res.ok === false) throw Object.assign(new Error(res.reason), { reason: res.reason });
      return res;
    },
    // The widget reports its own height; Homey needs the frame's, which adds the widget padding.
    onHeight: link.setHeight,
  });
  widget.setPresets(window.varPresetsFromSettings(settings));

  function ready() {
    return link.ready();
  }

  async function load() {
    if (!variableId) {
      widget.setMessage(widget.t('selectVariable'));
      ready();
      return;
    }
    try {
      const state = await Homey.api('GET', `/state?id=${encodeURIComponent(variableId)}${link.perfParam()}`);
      loadedAt = Date.now();
      loaded = !!state && !state.missing; // a deleted variable: the buttons go, the next error is persistent too
      if (!loaded) widget.setMessage(widget.t('missing'));
      else widget.setState(state);
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the buttons; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('variables:state', (data) => {
    if (!data || data.id !== variableId) return;
    if (data.missing) {
      loaded = false;
      widget.setMessage(widget.t('missing'));
    } else if (loaded) widget.pushChange(data);
    else load(); // it came back, or the first load failed
  });

  // A wall tablet waking up: catch up at once rather than at the next refresh.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && variableId && Date.now() - loadedAt >= REFRESH_MS) load();
  });
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountVarPresetsWidget.frameClass = 'homey-widget tw-frame';
