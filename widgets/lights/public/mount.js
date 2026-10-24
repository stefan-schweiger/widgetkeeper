/*
 * Wires createLightsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountLightsWidget = function (Homey, { root, frame }) {
  const { wireFrame, wireTileNames, wireDeviceState } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  /** The lights in Homey group devices among the picked ones: their realtime events count too. */
  let groupLights = new Set();

  const settings = Homey.getSettings() || {};
  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createLightsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    groupByZone: settings.groupByZone === true,
    wideLast: settings.wideLast === true,
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

  /** `palette: moods`: the Moods of the lights' rooms. A failed read keeps the last ones. */
  async function loadMoods(state) {
    if (settings.palette !== 'moods' || !Array.isArray(state)) return;
    const zones = [...new Set(state.map(d => d.zone && d.zone.id).filter(Boolean))];
    if (!zones.length) return;
    try {
      const res = await Homey.api('GET', `/moods?zones=${zones.map(encodeURIComponent).join(',')}`);
      widget.setMoods(res && res.moods);
    } catch (err) {
      console.error(err);
    }
  }

  // The lights' state with their tile names, now and every 5 min (then their rooms' Moods), and their realtime changes.
  wireDeviceState(Homey, link, widget, {
    event: 'lights:state',
    tileNames,
    watches: id => groupLights.has(id),
    onState: (state) => {
      groupLights = new Set();
      for (const d of Array.isArray(state) ? state : []) for (const m of (d && d.groupLights) || []) groupLights.add(m.id);
      loadMoods(state);
    },
  });
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountLightsWidget.frameClass = 'homey-widget-full';
