/*
 * Wires createValueMatrixWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountValueMatrixWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state
  const COLUMNS = [1, 2, 3, 4, 5, 6];

  const { wireFrame, getDeviceIds, wireTileNames } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  let deviceIds = [];
  let loaded = false;

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

  // Shown once the text font has loaded (at most 1 s), so the names don't pop in after the values.
  function ready() {
    return link.ready({ fonts: true });
  }

  async function load() {
    if (!deviceIds.length || !columns.length) {
      widget.setMessage(widget.t(deviceIds.length ? 'selectColumns' : 'selectDevices'));
      ready();
      return;
    }
    try {
      const ids = deviceIds.map(encodeURIComponent).join(',');
      const caps = columns.map(c => encodeURIComponent(c.capabilityId)).join(',');
      const state = await tileNames.state(`/state?deviceIds=${ids}&capabilityIds=${caps}${link.perfParam()}`);
      widget.setState(state);
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the table; only a failed first load replaces it with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('valuematrix:state', (data) => {
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
window.mountValueMatrixWidget.frameClass = 'homey-widget-full';
