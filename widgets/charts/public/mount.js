/*
 * Wires createChartsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountChartsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs the histories

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  // '2': stacked; 'overlay': both on one chart, over chart 1's time span.
  const overlay = settings.charts === 'overlay';
  const count = settings.charts === '2' || overlay ? 2 : 1;
  // Each chart setting is an autocomplete item whose id is `<deviceId>:<capabilityId>`; empty ones are left out.
  const charts = [1, 2].slice(0, count).map(n => ({
    slot: settings[`chart${n}`] && settings[`chart${n}`].id,
    span: settings[`span${n}`],
    style: settings[`style${n}`],
    color: settings[`color${n}`] || (n === 2 ? 'green' : 'blue'),
    range: settings[`range${n}`],
    negative: settings[`negative${n}`] === true,
    smooth: settings[`smooth${n}`] === true,
    title: settings[`title${n}`],
  })).filter(c => typeof c.slot === 'string' && c.slot.indexOf(':') > 0 && !c.slot.endsWith(':')); // as parseSlot()
  // On one chart, series 2 takes chart 1's span (its scale too, in the widget); a lone chart keeps its own.
  if (overlay && charts.length === 2) charts[1].span = charts[0].span;
  let loaded = false;

  const widget = window.createChartsWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    charts,
    overlay: overlay && charts.length === 2,
    showHeader: settings.showHeader !== false, // missing: on
    onHeight: link.setHeight,
  });

  function ready() {
    return link.ready();
  }

  async function load() {
    if (!charts.length) {
      widget.setMessage(widget.t('selectChart'));
      ready();
      return;
    }
    try {
      const list = charts.map(c => `${encodeURIComponent(c.slot)}~${encodeURIComponent(c.span || '24h')}`).join(',');
      const res = await Homey.api('GET', `/state?charts=${list}${link.perfParam()}`);
      widget.setState(res && res.charts, res && res.language);
      loaded = true;
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the charts; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  // The live values come from the Device Values service, which the app's Sparklines service (behind /state) uses.
  Homey.on('values:state', (data) => {
    if (data) widget.pushChange(data);
  });

  setInterval(load, REFRESH_MS);
  load();

  return {
    /** The Smart Stack: whether this page is the one on screen. */
    setVisible: (v) => widget.setVisible(v),
  };
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountChartsWidget.frameClass = 'homey-widget';
