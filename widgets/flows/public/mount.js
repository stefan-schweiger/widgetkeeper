/*
 * Wires createFlowsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountFlowsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // picks up renamed, turned-off and deleted flows

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  // Each button: a flow (an autocomplete item whose id is `flow:<id>` or `advanced:<id>`; `none` empties it),
  // a colour (dropdown), an icon (an autocomplete item whose id is the icon's) and an optional name (text).
  const buttons = [1, 2, 3, 4, 5, 6, 7, 8]
    .map(n => ({
      id: settings[`flow${n}`] && settings[`flow${n}`].id,
      color: settings[`color${n}`],
      icon: settings[`icon${n}`] && settings[`icon${n}`].id,
      name: settings[`name${n}`],
    }))
    .filter(b => typeof b.id === 'string' && b.id && b.id !== 'none');
  const ids = buttons.map(b => b.id);
  let loaded = false;

  const widget = window.createFlowsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    columns: settings.columns,
    buttons,
    onTrigger: async (id) => {
      const res = await Homey.api('POST', '/trigger', { id });
      // No usable API key: the widget says what to do (see the app settings).
      if (res && res.ok === false) throw Object.assign(new Error(res.reason), { reason: res.reason });
    },
    onHaptic: () => {
      try { if (Homey.hapticFeedback) Homey.hapticFeedback(); } catch (e) { /* not on every platform */ }
    },
    onHeight: link.setHeight,
  });

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in after the icons.
  function ready() {
    return link.ready({ fonts: true });
  }

  async function load() {
    if (!ids.length) {
      widget.setMessage(widget.t('selectSlots'));
      ready();
      return;
    }
    try {
      widget.setState(await Homey.api('GET', `/state?ids=${ids.map(encodeURIComponent).join(',')}${link.perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the buttons; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  // A Flow set (or reset) the colour of a flow's buttons.
  Homey.on('flows:color', (data) => {
    if (data) widget.pushColor(data);
  });

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountFlowsWidget.frameClass = 'homey-widget-full';
