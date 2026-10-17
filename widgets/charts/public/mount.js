/*
 * Wires createChartsWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountChartsWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscriptions alive and resyncs the histories

  // Load marks for the app's diagnostics log, sent with the first request only.
  let perf = '';
  const { loadMarks } = window.WidgetkeeperKit;
  function perfParam() {
    const p = perf ? `&perf=${perf}` : '';
    perf = '';
    return p;
  }

  const sdkAt = performance.now();
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
  let readySent = false;
  let loaded = false;

  const widget = window.createChartsWidget(root, {
    t: (key, tokens) => Homey.__(key, tokens),
    charts,
    overlay: overlay && charts.length === 2,
    showHeader: settings.showHeader !== false, // missing: on
    onHeight: () => {
      if (!readySent) return;
      Homey.setHeight(bodyHeight());
    },
  });

  function bodyHeight() {
    return Math.ceil(frame.getBoundingClientRect().height);
  }

  function ready() {
    if (readySent) return;
    readySent = true;
    Homey.ready({ height: bodyHeight() });
  }

  async function load() {
    if (!charts.length) {
      widget.setMessage(widget.t('selectChart'));
      ready();
      return;
    }
    try {
      const list = charts.map(c => `${encodeURIComponent(c.slot)}~${encodeURIComponent(c.span || '24h')}`).join(',');
      const res = await Homey.api('GET', `/state?charts=${list}${perfParam()}`);
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

  perf = loadMarks(sdkAt);
  setInterval(load, REFRESH_MS);
  load();

  return {
    /** The Smart Stack: whether this page is the one on screen. */
    setVisible: (v) => widget.setVisible(v),
  };
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountChartsWidget.frameClass = 'homey-widget';
