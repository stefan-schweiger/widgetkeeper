/*
 * Wires createSensorAlarmsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountSensorAlarmsWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireTileNames, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createSensorAlarmsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    includeStates: settings.includeStates === true,
    onHeight: link.setHeight,
  });

  // The devices' state with their tile names, now and every 5 min, and their realtime changes.
  wireDeviceState(Homey, link, widget, { event: 'sensoralarms:state', tileNames });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountSensorAlarmsWidget.frameClass = 'homey-widget-full';
