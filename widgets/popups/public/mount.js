/*
 * Wires createPopupsWidget to Homey: the screen name, `/state` (on load, every 5 min and when the page is shown again)
 * and the realtime `popups:show`, each popup opened with `Homey.popup()`. On a web dashboard (`web-…`) it does
 * nothing: the page draws popups itself. index.html calls it with the frame's own Homey and body.
 */
window.mountPopupsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3;

  const { wireFrame } = window.WidgetkeeperKit;
  const link = wireFrame(Homey, frame);
  const settings = Homey.getSettings() || {};
  // The prompt page, on the address this frame came from (the Homey at home, its cloud relay away).
  const appId = (location.pathname.match(/\/app\/([^/]+)\//) || [])[1] || 'com.thomassidor.widgetkeeper';
  const widget = window.createPopupsWidget(root, {
    name: settings.name,
    page: `${location.origin}/app/${appId}/settings/popup.html`,
    open: (url) => { try { Homey.popup(url); } catch (err) { console.error(err); } },
  });

  let asked = '';
  try { asked = Homey.getWidgetInstanceId(); } catch (e) { /* older apps */ }
  Promise.resolve(asked).catch(() => '').then((instance) => {
    link.ready();
    if (typeof instance === 'string' && instance.startsWith('web-')) return;

    let loadedAt = 0;
    async function load() {
      loadedAt = Date.now();
      try {
        // The name as typed, so the Flow cards list it as the user wrote it.
        const name = typeof settings.name === 'string' ? settings.name : '';
        widget.setState(await Homey.api('GET', `/state?name=${encodeURIComponent(name)}${link.perfParam()}`));
      } catch (err) {
        console.error(err);
      }
    }
    Homey.on('popups:show', popup => widget.show(popup));
    load();
    setInterval(load, REFRESH_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && Date.now() - loadedAt > 2000) load();
    });
  });
};
/** The classes index.html puts on its body. */
window.mountPopupsWidget.frameClass = 'homey-widget-full';
