/*
 * Wires createLightRoomsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body. `frame` is the element whose height Homey gets.
 */
window.mountLightRoomsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state

  const { wireFrame, getDeviceIds } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  let deviceIds = [];
  /** The lights whose realtime events count: the picked ones, and the lights in Homey group devices among them. */
  let watched = new Set();
  let loaded = false;

  const settings = Homey.getSettings() || {};
  // A widget placed before the setting existed shows its rooms' Moods.
  const showMoods = settings.showMoods !== false;
  const widget = window.createLightRoomsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    showMoods,
    palette: settings.palette,
    barMin: settings.barMin,
    onSet: (deviceId, change) => Homey.api('POST', '/set', { deviceId, ...change }),
    onMood: async (id) => {
      const res = await Homey.api('POST', '/mood', { id });
      // No usable API key: the widget says what to do (see the app settings).
      if (res && res.ok === false) throw Object.assign(new Error(res.reason), { reason: res.reason });
    },
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
      const res = await Homey.api('GET', `/state?deviceIds=${deviceIds.map(encodeURIComponent).join(',')}${link.perfParam()}`);
      const lights = res && Array.isArray(res.lights) ? res.lights : [];
      widget.setState(lights, res && res.zoneIcons);
      watched = new Set(deviceIds);
      for (const d of lights) for (const m of (d && d.groupLights) || []) watched.add(m.id);
      loaded = true;
      loadMoods(lights);
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the rooms; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  /** The Moods of the lights' rooms. A failed read keeps the last ones. */
  async function loadMoods(lights) {
    if (!showMoods) return;
    const zones = [...new Set(lights.map(d => d.zone && d.zone.id).filter(Boolean))];
    if (!zones.length) return;
    try {
      const res = await Homey.api('GET', `/moods?zones=${zones.map(encodeURIComponent).join(',')}`);
      widget.setMoods(res && res.moods);
    } catch (err) {
      console.error(err);
    }
  }

  Homey.on('lights:state', (data) => {
    if (data && (watched.has(data.deviceId) || deviceIds.includes(data.deviceId))) widget.pushChange(data);
  });

  getDeviceIds(Homey)
    .then((ids) => { deviceIds = ids; })
    .then(() => {
      setInterval(load, REFRESH_MS);
      load();
    });
};
/** The classes index.html puts on its body. */
window.mountLightRoomsWidget.frameClass = 'homey-widget-full';
