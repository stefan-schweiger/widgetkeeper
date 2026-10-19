/*
 * Wires createShortcutsWidget to Homey: the settings and the app's API. index.html calls it with the frame's own Homey
 * and body. `frame` is the element whose height Homey gets. Only a web dashboard (a frame of settings/dashboard.html,
 * whose widget instances are `web-<dashboard>-<widget>`) can open another one: the page takes `popup('#/d/<id>')`.
 */
window.mountShortcutsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // picks up renamed and deleted dashboards

  const { wireFrame, wireTileNames } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  // Each tile: a dashboard (an autocomplete item whose id is the dashboard's; `none` empties it), a colour (dropdown)
  // and an icon (an autocomplete item whose id is the icon's).
  const tiles = [1, 2, 3, 4, 5, 6, 7, 8]
    .map(n => ({
      id: settings[`dashboard${n}`] && settings[`dashboard${n}`].id,
      color: settings[`color${n}`],
      icon: settings[`icon${n}`] && settings[`icon${n}`].id,
    }))
    .filter(s => typeof s.id === 'string' && s.id && s.id !== 'none');
  const ids = tiles.map(s => s.id);
  let loaded = false;

  let instance = '';
  try { instance = typeof Homey.getWidgetInstanceId === 'function' ? Homey.getWidgetInstanceId() : ''; } catch (e) { /* not on the web */ }
  const web = Promise.resolve(instance).then(id => typeof id === 'string' && id.startsWith('web-'), () => false);

  const tileNames = wireTileNames(Homey, names => widget.setNames(names));
  const widget = window.createShortcutsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    renameTiles: settings.renameTiles === true,
    onRename: (key, name) => tileNames.rename(key, name),
    columns: settings.columns,
    tiles,
    onOpen: (id) => {
      try { Homey.popup(`#/d/${encodeURIComponent(id)}`); } catch (e) { console.error(e); }
    },
    onHaptic: () => {
      try { if (Homey.hapticFeedback) Homey.hapticFeedback(); } catch (e) { /* not on every platform */ }
    },
    onHeight: link.setHeight,
  });

  // Shown once the text font has loaded (at most 1 s), so the text doesn't pop in after the icons.
  function ready() {
    return link.ready({ fonts: true });
  }

  async function load() {
    if (!await web) {
      widget.setMessage(widget.t('webOnly'));
      ready();
      return;
    }
    if (!ids.length) {
      widget.setMessage(widget.t('selectSlots'));
      ready();
      return;
    }
    try {
      widget.setState(await tileNames.state(`/state?ids=${ids.map(encodeURIComponent).join(',')}${link.perfParam()}`));
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the tiles; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body. */
window.mountShortcutsWidget.frameClass = 'homey-widget-full';
