/*
 * Wires createTextLineWidget (the Notes widget) to Homey: the settings, the app's API and the realtime events (a
 * named note's text from a Flow card, a variable's value). A typed message needs neither. index.html calls it with the frame's own Homey and body; the Smart Stack calls it
 * with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountTextLineWidget = function (Homey, { root, frame }) {
  // The events keep it current; this catches a missed one (a screen that slept).
  const REFRESH_MS = 5 * 60e3;

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const style = settings.style === 'postit' ? 'postit' : 'tile';
  const source = ['flow', 'variable'].includes(settings.source) ? settings.source : 'typed';
  const board = typeof settings.board === 'string' ? settings.board : '';
  const variableId = source === 'variable' && settings.variable && settings.variable.id && settings.variable.id !== 'none'
    ? settings.variable.id : null;
  let instanceId = 'default';
  try { instanceId = Homey.getWidgetInstanceId() || 'default'; } catch (e) { /* older apps */ }

  const widget = window.createTextLineWidget(root, {
    colorStyle: settings.colorStyle,
    style,
    source,
    align: settings.align,
    size: settings.size,
    overflow: settings.overflow,
    icon: settings.icon && settings.icon.id,
    color: settings.color,
    message: typeof settings.message === 'string' ? settings.message : '',
    variableChosen: source !== 'variable' || !!variableId,
    seed: instanceId,
    t: (key, tokens) => Homey.__(key, tokens),
    onHeight: link.setHeight,
  });

  // Shown once the fonts have loaded (at most 1 s), so the text doesn't pop in. The note's handwriting only loads
  // once something asks for it, so ask.
  function ready() {
    return link.ready({
      fonts: true,
      waitFor: () => (style === 'postit' && document.fonts && document.fonts.load
        ? [document.fonts.load("500 30px 'Widgetkeeper Caveat'").catch(() => {})] : []),
      before: () => widget.render(),
    });
  }

  const key = window.textLineBoardKey(board);
  let loadedAt = 0;
  async function load() {
    // A typed message is all in the settings: nothing to ask the app.
    if (source === 'typed') return ready();
    loadedAt = Date.now();
    const query = source === 'variable'
      ? (variableId ? `variable=${encodeURIComponent(variableId)}` : '')
      : `board=${encodeURIComponent(board)}`;
    try {
      widget.setState(await Homey.api('GET', `/state?${query}${link.perfParam()}`));
    } catch (err) {
      console.error(err);
      widget.setError(); // the widget's own message: an error's text is Homey's, in English
    }
    ready();
  }

  if (source === 'flow') {
    Homey.on('textline:state', (entry) => {
      if (entry && entry.key === key) widget.setState({ board: entry });
    });
  } else if (variableId) {
    Homey.on('variables:state', (v) => {
      if (v && v.id === variableId) widget.setState({ variable: v });
    });
  }

  load();
  if (source === 'typed') return;
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && Date.now() - loadedAt >= REFRESH_MS) load();
  });
  setInterval(load, REFRESH_MS);
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountTextLineWidget.frameClass = 'homey-widget-full';
