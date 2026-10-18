/*
 * Wires createRoomHealthWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountRoomHealthWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state

  const { wireFrame, getDeviceIds, wireTileNames } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  let deviceIds = [];
  let loaded = false;

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

  // Shown once the text font has loaded (at most 1 s), so the names don't pop in after the values.
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
      const state = await tileNames.state(`/state?deviceIds=${deviceIds.map(encodeURIComponent).join(',')}${link.perfParam()}`);
      widget.setState(state);
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the rooms; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('roomhealth:state', (data) => {
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
window.mountRoomHealthWidget.frameClass = 'homey-widget-full';
