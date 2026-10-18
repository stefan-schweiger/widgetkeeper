/*
 * Wires createLocksWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountLocksWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state

  const { wireFrame, getDeviceIds, wireTileNames } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  // The capability that opens (unlatches) a lock, if one was picked ("None" is `none`).
  const pick = settings.openCapability;
  const openCap = pick && typeof pick.id === 'string' && pick.id !== 'none' ? pick.id : null;
  let deviceIds = [];
  let loaded = false;

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createLocksWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    view: settings.view,
    allowUnlock: settings.allowUnlock === true,
    onSet: (deviceId, capabilityId, value) => Homey.api('POST', '/set', { deviceId, capabilityId, value }),
    allowOpen: settings.allowUnlock === true && !!openCap,
    onOpen: (deviceId, capabilityId) => Homey.api('POST', '/open', { deviceId, capabilityId }),
    onHaptic: () => {
      try { if (Homey.hapticFeedback) Homey.hapticFeedback(); } catch (e) { /* not on every platform */ }
    },
    onHeight: link.setHeight,
  });

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in after the icons.
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
      const open = openCap ? `&open=${encodeURIComponent(openCap)}` : '';
      const state = await tileNames.state(`/state?deviceIds=${deviceIds.map(encodeURIComponent).join(',')}${open}${link.perfParam()}`);
      widget.setState(state);
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the devices; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('locks:state', (data) => {
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
window.mountLocksWidget.frameClass = 'homey-widget-full';
