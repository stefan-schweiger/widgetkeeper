/*
 * Wires createElectricityWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountElectricityWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // usage history resolution; also keeps the app's meter subscription alive

  const { wireFrame, getDeviceIds } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const costsParam = settings.priceCosts === false ? '&costs=0' : ''; // missing on older widgets: with costs
  let deviceId = null;
  let loaded = false;

  const widget = window.createElectricityWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    layout: settings.layout, // missing on widgets placed before the setting: standard
    colorStyle: settings.colorStyle,
    onHeight: link.setHeight,
  });
  widget.setSettings({
    showPrices: settings.showPrices !== false,
    showUsage: settings.showUsage !== false,
    nextLow: settings.nextLow || (settings.showNextLow === false ? 'none' : '12'), // showNextLow: pre-dropdown setting
    separateUsage: settings.separateUsage === true,
    liveWindow: Number(settings.liveWindow) || 10,
    smooth: settings.smooth === true,
    usageColor: settings.usageColor === 'purple' ? 'purple' : 'neutral',
  });

  function ready() {
    return link.ready();
  }

  /** Reads the snapshot; true when it loaded (or there's no meter to load). */
  async function load() {
    let ok = false;
    try {
      const snapshot = await Homey.api('GET', `/snapshot?deviceId=${encodeURIComponent(deviceId || '')}${costsParam}${link.perfParam()}`);
      // Without readings (or with a meter error) the prices still show; the widget notes the meter.
      if (!deviceId) widget.setMessage(widget.t('selectMeter'));
      else {
        widget.setData(snapshot);
        loaded = true;
      }
      ok = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the last snapshot (the live readings still arrive); only a failed first load shows the error.
      if (!loaded) widget.setMessage(widget.t('error'));
    }
    ready();
    return ok;
  }

  Homey.on('electricity:live', (data) => {
    if (data && data.deviceId === deviceId) widget.pushLive(data);
  });

  // Minute tick, just after each minute on the clock: "minutes remaining" countdown. Hour boundary and every 5 min: a
  // fresh snapshot (the new hour's is tried each minute until one loads).
  let lastHour = new Date().getHours();
  let lastLoad = Date.now();
  function tick() {
    const now = new Date();
    if (now.getHours() !== lastHour || Date.now() - lastLoad >= REFRESH_MS) {
      const hour = now.getHours();
      lastLoad = Date.now();
      load().then((ok) => { if (ok) lastHour = hour; });
    } else {
      widget.render();
    }
  }
  setTimeout(() => { tick(); setInterval(tick, 60e3); }, 60e3 - (Date.now() % 60e3) + 50);

  getDeviceIds(Homey)
    .then((ids) => { deviceId = ids[0] || null; })
    .then(load);

  return {
    /** The Smart Stack: whether this page is the one on screen. */
    setVisible: (v) => widget.setVisible(v),
  };
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountElectricityWidget.frameClass = 'homey-widget';
