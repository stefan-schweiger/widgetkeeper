/*
 * Wires createKeypadWidget to Homey: the settings, the app's API and the state's realtime events (Device Values' for a
 * capability, Variables' for a variable). index.html calls it with the frame's own Homey and body. `frame` is the
 * element whose height Homey gets.
 */
window.mountKeypadWidget = function (Homey, { root, frame }) {
  // The events keep it current; this keeps the app's interest in the state alive and catches a missed one.
  const REFRESH_MS = 5 * 60e3;

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const { sourceId, codeId, keypad, buttons } = window.keypadSettings(settings);
  const flowIds = [...new Set(buttons.map(b => b.flow).filter(Boolean))];
  // `cap:<deviceId>:<capabilityId>` or `var:<id>`
  const cap = sourceId && sourceId.startsWith('cap:') ? /^cap:([^:]+):(.+)$/.exec(sourceId) : null;
  const variableId = sourceId && sourceId.startsWith('var:') ? sourceId.slice(4) : null;
  let loaded = false;
  let loadedAt = 0;

  const widget = window.createKeypadWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    layout: settings.layout, // standard unless compact
    colorStyle: settings.colorStyle,
    title: settings.title,
    sourceId,
    codeId,
    keypad, // tap unless always
    buttons,
    onPress: body => Homey.api('POST', '/press', body),
    onHaptic: () => {
      if (typeof Homey.hapticFeedback === 'function') Homey.hapticFeedback();
    },
    // The widget's height changes with the pad; Homey needs the frame's, which adds the widget padding.
    onHeight: link.setHeight,
  });

  async function load() {
    if (!sourceId && !flowIds.length && !codeId) {
      widget.setState({ source: null, flows: [], code: null });
      link.ready();
      return;
    }
    try {
      const query = `source=${encodeURIComponent(sourceId || '')}&flows=${encodeURIComponent(flowIds.join(','))}&code=${encodeURIComponent(codeId || '')}`;
      const state = await Homey.api('GET', `/state?${query}${link.perfParam()}`);
      loadedAt = Date.now();
      loaded = true;
      widget.setState(state);
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the buttons; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    link.ready({ fonts: true });
  }

  Homey.on('values:state', (data) => {
    if (!cap || !data || data.deviceId !== cap[1] || data.capabilityId !== cap[2]) return;
    if (loaded) widget.pushValue(data.value);
    else load();
  });
  Homey.on('variables:state', (data) => {
    if (!variableId || !data || data.id !== variableId) return;
    if (loaded && !data.missing && 'value' in data) widget.pushValue(data.value);
    else load(); // deleted, or it came back, or the first load failed
  });

  // A wall tablet waking up: catch up at once rather than at the next refresh.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - loadedAt >= REFRESH_MS) load();
  });
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body. */
window.mountKeypadWidget.frameClass = 'homey-widget kp-frame';
