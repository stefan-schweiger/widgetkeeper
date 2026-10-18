/*
 * Wires createCamerasWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountCamerasWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // re-reads the devices (names, image and video ids)

  const { wireFrame, getDeviceIds, wireTileNames } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const snapshotMs = (Number(settings.refresh) || 10) * 1000;
  let deviceIds = [];
  let loaded = false;
  let snapshotTimer = null;
  let visible = true; // false while the Smart Stack shows another page

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createCamerasWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    refreshMs: snapshotMs,
    liveFor: settings.liveFor,
    layout: settings.layout,
    api:(method, path, body) => Homey.api(method, path, body),
    report: (text, warn) => { Homey.api('POST', '/report', { text, warn: !!warn }).catch(() => {}); },
    onHeight: link.setHeight,
  });

  function ready() {
    return link.ready({ fonts: true });
  }

  // Snapshots refresh on their own timer, and not while the dashboard is in the background (or the stack's
  // slide is off screen). Live view until tapped comes back first, so the refresh skips the tiles it covers.
  function startSnapshots() {
    if (snapshotTimer || document.hidden || !visible || !loaded) return;
    widget.resume();
    widget.refresh();
    snapshotTimer = setInterval(() => widget.refresh(), snapshotMs);
  }
  function stopSnapshots() {
    if (snapshotTimer) clearInterval(snapshotTimer);
    snapshotTimer = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { stopSnapshots(); widget.pause(); } else startSnapshots();
  });

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
      startSnapshots();
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the tiles; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  getDeviceIds(Homey)
    .then((ids) => { deviceIds = ids; })
    .then(() => {
      setInterval(load, REFRESH_MS);
      load();
    });

  return {
    /** The Smart Stack: whether this page is the one on screen. */
    setVisible(v) {
      visible = !!v;
      if (visible) startSnapshots();
      else { stopSnapshots(); widget.pause(); }
    },
  };
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountCamerasWidget.frameClass = 'homey-widget-full';
