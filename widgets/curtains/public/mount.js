/*
 * Wires createCurtainsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountCurtainsWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireTileNames, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createCurtainsWidget(root, {
    colorStyle: settings.colorStyle,
    color: settings.color,
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    groupByZone: settings.groupByZone === true,
    between: settings.between,
    invert: settings.invert === true,
    openAt: settings.openAt,
    showState: settings.showState !== false,
    // A percentage (`5`); unset (a widget placed before the setting) is the widget's default, 5 %.
    ends: settings.ends != null && settings.ends !== '' ? Number(settings.ends) / 100 : undefined,
    onSet: (deviceId, change) => Homey.api('POST', '/set', { deviceId, ...change }),
    onHeight: link.setHeight,
  });

  // The devices' state with their tile names, now and every 5 min, and their realtime changes.
  wireDeviceState(Homey, link, widget, { event: 'curtains:state', tileNames });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountCurtainsWidget.frameClass = 'homey-widget-full';
