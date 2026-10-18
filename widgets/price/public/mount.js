/*
 * Wires createPriceWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountPriceWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // picks up tomorrow's prices and a changed price type

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  let loaded = false;

  const widget = window.createPriceWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    hours: settings.hours,
    tint: settings.tint !== false,
    onHeight: link.setHeight,
  });

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in.
  function ready() {
    return link.ready({ fonts: true });
  }

  async function load() {
    try {
      widget.setState(await Homey.api('GET', `/price?${[settings.priceCosts === false ? 'costs=0' : '', Number(settings.hours) > 24 ? 'hours=36' : '', link.perfParam('')].filter(Boolean).join('&')}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the prices; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountPriceWidget.frameClass = 'homey-widget-full';
