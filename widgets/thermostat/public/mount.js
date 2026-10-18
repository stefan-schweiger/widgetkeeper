/*
 * Wires createThermostatWidget to Homey: the settings, the app's API and its realtime events. index.html calls it
 * with the frame's own Homey and body; the Smart Stack calls it with a slide of its page and a Homey of its own.
 * `frame` is the element whose height Homey gets (the body, or the slide).
 */
window.mountThermostatWidget = function (Homey, { root, frame }) {
  const REFRESH_MS = 5 * 60e3; // keeps the app's device subscription alive and resyncs state

  const { wireFrame } = window.WidgetkeeperKit;
  // Homey's frame: ready, the height, and the load marks sent with the first request.
  const link = wireFrame(Homey, frame);

  const settings = Homey.getSettings() || {};
  const deviceId = (settings.device && settings.device.id) || null;
  let loaded = false;

  const widget = window.createThermostatWidget(root, {
    colorStyle: settings.colorStyle,
    t: (key, tokens) => Homey.__(key, tokens),
    layout: settings.layout, // missing on widgets placed before the setting: standard
    onApply: (values) => Homey.api('POST', '/apply', {
      deviceId, values: values.map(({ capabilityId, value }) => ({ capabilityId, value })),
    }),
    // The widget reports its own height; Homey needs the body's, which adds the widget padding.
    onHeight: link.setHeight,
  });
  widget.setButtons(window.thermostatPresetsFromSettings(settings));

  function ready() {
    return link.ready();
  }

  async function load() {
    if (!deviceId) {
      widget.setMessage(widget.t('selectDevice'));
      ready();
      return;
    }
    try {
      const state = await Homey.api('GET', `/state?deviceId=${encodeURIComponent(deviceId)}${link.perfParam()}`);
      loaded = !state.missing; // a deleted device: the buttons go, the next error is persistent too
      if (state.missing) widget.setMessage(widget.t('error'));
      else widget.setState(state);
    } catch (err) {
      console.error(err);
      // A failed refresh keeps the buttons; only a failed first load replaces them with the error.
      widget.setMessage(widget.t('error'), loaded);
    }
    ready();
  }

  Homey.on('thermostat:state', (data) => {
    if (data && data.deviceId === deviceId) widget.pushChange(data);
  });

  setInterval(load, REFRESH_MS);
  load();
};
/** The classes index.html puts on its body; the Smart Stack puts them on the slide. */
window.mountThermostatWidget.frameClass = 'homey-widget tw-frame';
