/*
 * Wires createSensorDotsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountSensorDotsWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const widget = window.createSensorDotsWidget(root, {
    colorStyle: settings.colorStyle,
    timeFormat: settings.timeFormat,
    t: (key, tokens) => Homey.__(key, tokens),
    title: typeof settings.title === 'string' ? settings.title : '',
    idleColor: settings.idleColor,
    activeColor: settings.activeColor,
    onHeight: link.setHeight,
  });

  // The devices' alarms, now and every 5 min, and their changes: Sensor Alarms' tracking and events, shared with that widget.
  wireDeviceState(Homey, link, widget, { event: 'sensoralarms:state' });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountSensorDotsWidget.frameClass = 'homey-widget-full';
