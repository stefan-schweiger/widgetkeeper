/*
 * Wires createRoomHealthWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountRoomHealthWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireTileNames, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  // The comfortable ranges, as the settings give them (the widget puts in the defaults).
  const ranges = {};
  for (const id of ['tempMin', 'tempMax', 'humidityMin', 'humidityMax', 'co2Max', 'radonMax', 'pm25Max', 'pm10Max', 'vocMax']) ranges[id] = settings[id];
  const widget = window.createRoomHealthWidget(root, {
    colorStyle: settings.colorStyle,
    layout: settings.layout,
    columns: settings.columns,
    greenWhenFine: settings.greenWhenFine === true,
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    ...ranges,
    onHeight: link.setHeight,
  });

  // The devices' state with their tile names, now and every 5 min, and their realtime changes.
  wireDeviceState(Homey, link, widget, { event: 'roomhealth:state', tileNames });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountRoomHealthWidget.frameClass = 'homey-widget-full';
