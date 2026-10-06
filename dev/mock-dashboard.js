// The mock widgets of dev/screenshots.html and dev/showcase.html: the real widget code with fixed mock data,
// mounted into the elements with the ids w-elec, w-thermo, w-qa, w-sa, w-weather, w-heatmap, w-cameras, w-values,
// w-lights and w-sparklines. Needs the widget scripts, the mock-*.js files and temp/screenshot-icons.js loaded first.
const icon = name => (window.ICONS && ICONS[name]) || null;

const elec = createElectricityWidget(document.getElementById('w-elec'), { locale: 'en-GB' });
elec.setSettings({ liveWindow: 10, nextLow: 'both' });
elec.setData(mockSnapshot());

const FAN = { title: 'Fan level', units: null, values: ['AUTO', 'LEVEL1', 'LEVEL2', 'LEVEL3', 'LEVEL4', 'LEVEL5'].map((id, i) => ({ id, title: i ? `Level ${i}` : 'Auto' })) };
const MODE = { title: 'Mode', units: null, values: [['COOL', 'Cool'], ['HEAT', 'Heat'], ['AUTO', 'Auto'], ['OFF', 'Off']].map(([id, title]) => ({ id, title })) };
const thermo = createThermostatWidget(document.getElementById('w-thermo'), { locale: 'en-GB' });
thermo.setButtons(thermostatPresetsFromSettings({
  b1Power: 'off',
  b2Power: 'keep', b2Temp: { capabilityId: 'target_temperature', value: 21 }, b2Mode: { capabilityId: 'ac_mode', value: 'HEAT' }, b2Extra: { capabilityId: 'fan_level', value: 'LEVEL1' },
  b3Power: 'keep', b3Temp: { capabilityId: 'target_temperature', value: 24 }, b3Mode: { capabilityId: 'ac_mode', value: 'HEAT' }, b3Extra: { capabilityId: 'fan_level', value: 'LEVEL5' },
}));
thermo.setState({
  name: 'Aircon | Garage', icon: icon('climate'),
  values: { target_temperature: 21, ac_mode: 'HEAT', fan_level: 'LEVEL1' },
  caps: { target_temperature: { title: 'Target temperature', units: '°C', values: null }, ac_mode: MODE, fan_level: FAN },
});

const qa = (capabilityId, value) => ({ capabilityId, value, actionable: true, momentary: false, icon: null });
createQuickActionsWidget(document.getElementById('w-qa'), {}).setState([
  { id: '1', name: 'Dinoer', icon: icon('christmas-lights'), quickAction: qa('onoff', true) },
  { id: '2', name: 'Hoveddør', icon: icon('lock'), quickAction: qa('locked', true) },
  { id: '3', name: 'Bryggersdør', icon: icon('lock'), quickAction: qa('locked', false) },
  { id: '4', name: 'Floor lamp', icon: icon('light-standing'), quickAction: qa('onoff', false) },
  { id: '5', name: 'Kitchen', icon: icon('speaker'), quickAction: qa('speaker_playing', true) },
  { id: '6', name: 'Pendant', icon: icon('light-hanging'), quickAction: qa('onoff', false) },
]);

const alarm = (capabilityId, value, title, state = false) => ({ capabilityId, title, value, state });
const vcap = (type, extra = {}) => ({ title: '', type, units: null, decimals: null, values: null, icon: null, ...extra });
createValuesWidget(document.getElementById('w-values'), { percentFill: true }).setState([
  { deviceId: '1', capabilityId: 'measure_temperature', name: 'Living room', capability: vcap('number', { units: '°C', decimals: 1 }), value: 21.5 },
  { deviceId: '1', capabilityId: 'measure_humidity', name: 'Living room', capability: vcap('number', { units: '%', decimals: 0 }), value: 48 },
  { deviceId: '2', capabilityId: 'onoff', name: 'Floor lamp', capability: vcap('boolean'), value: true },
  { deviceId: '3', capabilityId: 'measure_battery', name: 'Back door', capability: vcap('number', { units: '%', decimals: 0 }), value: 7 },
  { deviceId: '4', capabilityId: 'measure_battery', name: 'Hallway', capability: vcap('number', { units: '%', decimals: 0 }), value: 16 },
  { deviceId: '5', capabilityId: 'measure_power', name: 'Meter', capability: vcap('number', { units: 'W', decimals: 0 }), value: 812 },
]);

// A fixed clock and series built from formulas, so the shot is the same on every render.
const SPARK_NOW = Date.UTC(2026, 9, 6, 12);
const DAY = 24 * 3600e3;
const spark = f => Array.from({ length: 120 }, (_, i) => [SPARK_NOW - DAY + (i + 0.5) * DAY / 120, f(i / 119)]);
const sround = (v, d) => Math.round(v * 10 ** d) / 10 ** d;
const sday = x => Math.sin((x - 0.3) * 2 * Math.PI);
const sparkSlot = (deviceId, capabilityId, name, extra, points) =>
  ({ deviceId, capabilityId, name, capability: vcap('number', extra), value: points[points.length - 1][1], points });
createSparklinesWidget(document.getElementById('w-sparklines'), { now: () => SPARK_NOW }).setState([
  sparkSlot('1', 'measure_temperature', 'Living room', { units: '°C', decimals: 1 }, spark(x => sround(21.2 + 1.6 * sday(x) + 0.2 * Math.sin(x * 40), 1))),
  sparkSlot('2', 'measure_power', 'Meter', { units: 'W', decimals: 0 }, spark(x => Math.round(450 + (Math.sin(x * 23) > 0.6 ? 2400 : 0) + 120 * Math.sin(x * 90)))),
  sparkSlot('3', 'measure_humidity', 'Bathroom', { units: '%', decimals: 0 }, spark(x => Math.round(62 - 14 * x + 3 * Math.sin(x * 17)))),
  sparkSlot('4', 'measure_co2', 'Bedroom', { units: 'ppm', decimals: 0 }, spark(x => Math.round(620 + 380 * Math.max(0, sday(x)) + 30 * Math.sin(x * 31)))),
]);

const lcap = value => ({ value, setable: true });
createLightsWidget(document.getElementById('w-lights'), {}).setState([
  { id: '1', name: 'Living Room', icon: icon('light-standing'), caps: { onoff: lcap(true), dim: lcap(0.35), light_temperature: lcap(0.8), light_mode: lcap('temperature') } },
  { id: '2', name: 'Spots | Dining room', icon: icon('light-hanging'), caps: { onoff: lcap(false), dim: lcap(0.25), light_temperature: lcap(0.5) } },
  { id: '3', name: 'Kitchen', icon: icon('light-hanging'), caps: { onoff: lcap(true), dim: lcap(0.2), light_temperature: lcap(0.9) } },
  { id: '4', name: 'Hue Go', icon: icon('light-standing'), caps: { onoff: lcap(true), dim: lcap(0.6), light_hue: lcap(0.75), light_saturation: lcap(0.7), light_temperature: lcap(0.2), light_mode: lcap('color') } },
  { id: '5', name: 'Office', icon: icon('light-hanging'), caps: { onoff: lcap(true), dim: lcap(1), light_temperature: lcap(0.1), light_mode: lcap('temperature') } },
  { id: '6', name: 'Bedroom', icon: icon('light-standing'), caps: { onoff: lcap(false), dim: lcap(0.5) } },
]);

createSensorAlarmsWidget(document.getElementById('w-sa'), {}).setState([
  { id: '1', name: 'Kitchen', icon: icon('smoke-detector'), alarms: [alarm('alarm_smoke', false, 'Smoke alarm'), alarm('alarm_battery', false, 'Battery alarm')] },
  { id: '2', name: 'Hallway', icon: icon('smoke-detector'), alarms: [alarm('alarm_smoke', false, 'Smoke alarm')] },
  { id: '3', name: "Kid's Room", icon: icon('air-purifier'), alarms: [alarm('alarm_co2', true, 'CO₂ Alarm'), alarm('alarm_radon', false, 'Radon alarm')] },
  { id: '4', name: 'Bedroom', icon: icon('air-purifier'), alarms: [alarm('alarm_co2', false, 'CO₂ Alarm'), alarm('alarm_radon', false, 'Radon alarm')] },
  { id: '5', name: 'Laundry', icon: icon('washing-machine'), alarms: [alarm('alarm_water', false, 'Water alarm')] },
  { id: '6', name: 'Front door', icon: icon('door'), alarms: [alarm('alarm_contact', true, 'Contact alarm', true), alarm('alarm_tamper', false, 'Tamper alarm')] },
]);

const cams = createCamerasWidget(document.getElementById('w-cameras'), {});
cams.setState(mockCameras().slice(0, 4));
cams.refresh();

const lux = mockHeatmapLux('2026-10-04', 9);
createHeatmapWidget(document.getElementById('w-heatmap'), { locale: 'en-GB', period: 'week', step: 2 })
  .setData({ ...lux, name: 'Living room sensor', icon: icon('motion-sensor') || lux.icon });

// A fixed afternoon, so the shot doesn't change with the time it's rendered.
const weatherNow = new Date().setHours(13, 20, 0, 0);
createWeatherWidget(document.getElementById('w-weather'), { locale: 'en-GB', iconBase: '../widgets/weather/public/icons/', now: () => weatherNow })
  .setForecast({ hours: mockWeatherHours(weatherNow), language: 'en' });
