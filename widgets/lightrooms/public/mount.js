/*
 * Wires createLightRoomsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body. `frame` is the element whose height Homey gets.
 */
window.mountLightRoomsWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  /** The lights in Homey group devices among the picked ones: their realtime events count too. */
  let groupLights = new Set();

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

  // The lights' state and their rooms' icons, now and every 5 min (then their rooms' Moods), and their realtime changes.
  const lightsOf = res => (res && Array.isArray(res.lights) ? res.lights : []);
  wireDeviceState(Homey, link, widget, {
    event: 'lights:state',
    watches: id => groupLights.has(id),
    setState: res => widget.setState(lightsOf(res), res && res.zoneIcons),
    onState: (res) => {
      const lights = lightsOf(res);
      groupLights = new Set();
      for (const d of lights) for (const m of (d && d.groupLights) || []) groupLights.add(m.id);
      loadMoods(lights);
    },
  });
};
/** The classes index.html puts on its body. */
window.mountLightRoomsWidget.frameClass = 'homey-widget-full';
