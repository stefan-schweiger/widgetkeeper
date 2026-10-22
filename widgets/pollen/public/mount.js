/*
 * Wires createPollenWidget to Homey: the settings and the app's API. index.html calls it with the frame's own Homey and
 * body; the Smart Stack calls it with a slide of its page and a Homey of its own. `frame` is the element whose height
 * Homey gets (the body, or the slide).
 */
window.mountPollenWidget = function (Homey, { root, frame }) {
  // The app refetches from Open-Meteo at most hourly; this picks that up, and a new day.
  const REFRESH_MS = 5 * 60e3;

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};

  const widget = window.createPollenWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    density: settings.density,
    types: window.pollenTypes(settings),
    showUv: settings.showUv !== false,
    colorStyle: settings.colorStyle,
    timeFormat: settings.timeFormat,
    // The widget reports its own height; Homey needs the body's, which adds the widget padding.
    onHeight: link.setHeight,
  });

  let loaded = false;
  async function load() {
    try {
      widget.setData(await Homey.api('GET', `/pollen${link.perfParam('?')}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps what's shown; only a failed first load shows the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    link.ready();
  }

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountPollenWidget.frameClass = 'homey-widget pw-frame';
