/*
 * Wires createSensorDotsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountSensorDotsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state

  const { wireFrame, getDeviceIds } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  let deviceIds = [];
  let loaded = false;

  const settings = Homey.getSettings() || {};
  const widget = window.createSensorDotsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    title: typeof settings.title === 'string' ? settings.title : '',
    idleColor: settings.idleColor,
    activeColor: settings.activeColor,
    onHeight: link.setHeight,
  });

  // Shown once the text font has loaded (at most 1 s), so the names don't pop in after the icons.
  function ready() {
    return link.ready({ fonts: true });
  }

  async function load() {
    if (!deviceIds.length) {
      widget.setMessage(widget.t('selectDevices'));
      ready();
      return;
    }
    try {
      widget.setState(await Homey.api('GET', `/state?deviceIds=${deviceIds.map(encodeURIComponent).join(',')}${link.perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the tiles; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  // Sensor Alarms' tracking and events, shared with that widget.
  Homey.on('sensoralarms:state', (data) => {
    if (data && deviceIds.includes(data.deviceId)) widget.pushChange(data);
  });

  getDeviceIds(Homey)
    .then((ids) => { deviceIds = ids; })
    .then(() => {
      setInterval(load, REFRESH_MS);
      load();
    });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountSensorDotsWidget.frameClass = 'homey-widget-full';
