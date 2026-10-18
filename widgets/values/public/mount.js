/*
 * Wires createValuesWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountValuesWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs state

  const { wireFrame, wireTileNames } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  // Each slot setting is an autocomplete item whose id is `<deviceId>:<capabilityId>`, and so is its second value (`secondN`),
  // which counts only while it's another value of the same device: Tile N may have been changed since.
  const valid = id => typeof id === 'string' && id.indexOf(':') > 0 && !id.endsWith(':'); // as parseSlot()
  const pairs = [1, 2, 3, 4, 5, 6]
    .map(n => ({ slot: settings[`slot${n}`] && settings[`slot${n}`].id, second: settings[`second${n}`] && settings[`second${n}`].id }))
    .filter(p => valid(p.slot));
  const slots = pairs.map(p => p.slot);
  const seconds = pairs.map(({ slot, second }) => {
    const device = slot.slice(0, slot.indexOf(':'));
    return valid(second) && second !== slot && second.startsWith(`${device}:`) ? second.slice(device.length + 1) : '';
  });
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
    onHeight: link.setHeight,
  });

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in after the icons.
  function ready() {
    return link.ready({ fonts: true });
  }

  async function load() {
    if (!slots.length) {
      widget.setMessage(widget.t('selectSlots'));
      ready();
      return;
    }
    try {
      const secondsParam = seconds.some(Boolean) ? `&seconds=${seconds.map(encodeURIComponent).join(',')}` : '';
      const state = await tileNames.state(`/state?slots=${slots.map(encodeURIComponent).join(',')}${secondsParam}${link.perfParam()}`);
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

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountValuesWidget.frameClass = 'homey-widget-full';
