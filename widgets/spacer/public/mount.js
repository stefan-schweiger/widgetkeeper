/*
 * Wires createSpacerWidget to Homey: only the height setting. It makes no requests, so it has no load marks.
 * index.html calls it with the frame's own Homey and body.
 */
window.mountSpacerWidget = function (Homey, { root }) {
  const settings = Homey.getSettings() || {};
  const { height } = window.createSpacerWidget(root, { height: settings.height });
  Homey.ready({ height });
};
/** The classes index.html puts on its body. */
window.mountSpacerWidget.frameClass = 'homey-widget-full';
