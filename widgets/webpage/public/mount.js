/*
 * Wires createWebPageWidget to Homey: the settings, and Homey's location for an address with {lat} or {lon}.
 * index.html calls it with the frame's own Homey and body. `frame` is the element whose height Homey gets.
 */
window.mountWebPageWidget = function (Homey, { root, frame }) {
  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const buttons = [1, 2, 3, 4].map(n => ({ name: settings[`b${n}Name`], url: settings[`b${n}Url`] }));

  const widget = window.createWebPageWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    url: settings.url,
    pageWidth: settings.pageWidth,
    pageHeight: settings.pageHeight,
    interactive: settings.interactive === true,
    refresh: settings.refresh,
    buttons,
    onHeight: link.setHeight,
  });

  // The page's own loading isn't waited for: a slow site doesn't hold up the dashboard.
  if (!widget.needsLocation) {
    link.ready();
    return;
  }
  Homey.api('GET', `/location${link.perfParam('?')}`)
    .then(loc => widget.setLocation(loc), (err) => {
      console.error(err);
      widget.setLocation(null);
    })
    .then(() => link.ready());
};
/** The classes index.html puts on its body. */
window.mountWebPageWidget.frameClass = 'homey-widget-full';
