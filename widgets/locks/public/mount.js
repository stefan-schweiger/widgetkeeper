/*
 * Wires createLocksWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountLocksWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireTileNames, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  // The capability that opens (unlatches) a lock, if one was picked ("None" is `none`).
  const pick = settings.openCapability;
  const openCap = pick && typeof pick.id === 'string' && pick.id !== 'none' ? pick.id : null;

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createLocksWidget(root, {
    colorStyle: settings.colorStyle,
    timeFormat: settings.timeFormat,
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

  // The devices' state with their tile names (and which of them the Open capability opens), now and every 5 min,
  // and their realtime changes.
  wireDeviceState(Homey, link, widget, {
    event: 'locks:state',
    tileNames,
    query: () => (openCap ? `&open=${encodeURIComponent(openCap)}` : ''),
  });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountLocksWidget.frameClass = 'homey-widget-full';
