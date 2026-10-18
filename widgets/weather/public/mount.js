/*
 * Wires createWeatherWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountWeatherWidget = function (Homey, { root, frame }) {
  // The app only refetches from MET when its forecast expires (~30 min); this picks that up.
  const REFRESH_MS = 5 * 60e3;

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};

  const widget = window.createWeatherWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    density: settings.density,
    rows: settings.rows,
    step: settings.step,
    theme: settings.theme,
    frame: frame,
    // The widget reports its own height; Homey needs the body's, which adds the widget padding.
    onHeight: link.setHeight,
  });

  function ready() {
    return link.ready();
  }

  let loaded = false;
  async function load() {
    try {
      widget.setForecast(await Homey.api('GET', `/forecast${link.perfParam('?')}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the forecast already shown.
      if (!loaded) widget.setMessage(widget.t('error'));
    }
    ready();
  }

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountWeatherWidget.frameClass = 'homey-widget wf-frame';
