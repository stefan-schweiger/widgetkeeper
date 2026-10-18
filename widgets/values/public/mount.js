/*
 * Wires createValuesWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountValuesWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state

  // Load marks for the app's diagnostics log, sent with the first request only.
  let perf = '';
  const { loadMarks, wireTileNames } = window.WidgetkeeperKit;
  function perfParam() {
    const p = perf ? `&perf=${perf}` : '';
    perf = '';
    return p;
  }

  const sdkAt = performance.now();
  const settings = Homey.getSettings() || {};
  // Each slot setting is an autocomplete item whose id is `<deviceId>:<capabilityId>`.
  const slots = [1, 2, 3, 4, 5, 6]
    .map(n => settings[`slot${n}`] && settings[`slot${n}`].id)
    .filter(id => typeof id === 'string' && id.indexOf(':') > 0 && !id.endsWith(':')); // as parseSlot()
  let readySent = false;
  let loaded = false;

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createValuesWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    columns: settings.columns,
    tileStyle: settings.tileStyle,
    colorStyle: settings.colorStyle,
    percentFill: settings.percentFill === true,
    redBelow: settings.redBelow,
    yellowBelow: settings.yellowBelow,
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in after the icons.
  let readyStarted = false;
  async function ready() {
    if (readyStarted) return;
    readyStarted = true;
    if (document.fonts && document.fonts.ready) {
      await Promise.race([document.fonts.ready, new Promise(r => setTimeout(r, 1000))]);
    }
    readySent = true;
    Homey.ready({ height: bodyHeight() });
  }

  async function load() {
    if (!slots.length) {
      widget.setMessage(widget.t('selectSlots'));
      ready();
      return;
    }
    try {
      const state = await tileNames.state(`/state?slots=${slots.map(encodeURIComponent).join(',')}${perfParam()}`);
      widget.setState(state);
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the tiles; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('values:state', (data) => {
    if (data) widget.pushChange(data);
  });

  // A Flow set (or reset) the colour of a value's tiles.
  Homey.on('values:color', (data) => {
    if (data) widget.pushColor(data);
  });

  perf = loadMarks(sdkAt);
  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountValuesWidget.frameClass = 'homey-widget-full';
