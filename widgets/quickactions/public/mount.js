/*
 * Wires createQuickActionsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountQuickActionsWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireTileNames, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createQuickActionsWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    activeStyle: settings.activeStyle,
    color: settings.color,
    colorStyle: settings.colorStyle,
    press: settings.press,
    pressFor: settings.pressFor,
    onTrigger: (deviceId, value) => Homey.api('POST', '/trigger', { deviceId, value }),
    onHaptic: () => {
      try { if (Homey.hapticFeedback) Homey.hapticFeedback(); } catch (e) { /* not on every platform */ }
    },
    onHeight: link.setHeight,
  });

  // The devices' state with their tile names, now and every 5 min, and their realtime changes.
  wireDeviceState(Homey, link, widget, { event: 'quickactions:state', tileNames });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountQuickActionsWidget.frameClass = 'homey-widget-full';
