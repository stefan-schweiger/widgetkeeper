/*
 * Wires createValueMatrixWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountValueMatrixWidget = function (Homey, { root, frame }) {
  const COLUMNS = [1, 2, 3, 4, 5, 6];

  const { wireFrame, wireTileNames, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};

  // The picked columns in order, skipping empty ones and `None`: the capability, its range and its header.
  const columns = [];
  for (const n of COLUMNS) {
    const col = settings[`col${n}`];
    if (!col || !col.id || col.id === 'none') continue;
    columns.push({ capabilityId: col.id, title: col.name, range: settings[`range${n}`], header: settings[`header${n}`] });
  }

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createValueMatrixWidget(root, {
    colorStyle: settings.colorStyle,
    rows: settings.rows,
    showLegend: settings.showLegend !== false,
    columns,
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    onHeight: link.setHeight,
  });

  // The devices' values in the picked columns with the rows' names, now and every 5 min, and their realtime changes.
  wireDeviceState(Homey, link, widget, {
    event: 'valuematrix:state',
    tileNames,
    need: () => (columns.length ? null : 'selectColumns'),
    query: () => `&capabilityIds=${columns.map(c => encodeURIComponent(c.capabilityId)).join(',')}`,
  });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountValueMatrixWidget.frameClass = 'homey-widget-full';
