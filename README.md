# Widgetkeeper

Extra dashboard widgets for Homey Pro.

I built these to replace a few native Homey widgets that didn't quite behave the way I wanted. The aim is widgets that sit naturally next to Homey's own: the same look, the same feel, and no sense that they came from somewhere else.

## Widgets

### Electricity
<img src="widgets/electricity/preview-dark.png" alt="Electricity widget preview" width="320">

Your power use and electricity price together on one card:
- **Live power**, updated every few seconds, over the last 30 seconds to 1 hour.
- **Hourly electricity price**, from yesterday to 12 hours ahead, with midnight marked.
- **Usage history** for the last 24 hours, drawn on the price chart or as its own chart.
- **Cheapest upcoming hour** in the next 12 hours, the next 24 hours, or both.

Tap and drag (or hover) over a chart to see the exact value at any moment.

**What you need**
- A power meter in Homey, such as a P1 meter or an energy-monitoring smart plug. Any device that reports power will work.
- Dynamic electricity prices switched on in **Homey Energy**. This needs Homey Pro 12.6 or later. The widget shows the price Homey provides. Whether your own fees and tariffs are included depends on your Homey Energy price settings.

**Settings**
| Setting | Options |
| --- | --- |
| Power meter | Any device that reports power |
| Live power window | 30 seconds, 1, 5, 10 or 30 minutes, or 1 hour |
| Show usage history | On / off, and optionally as a separate chart |
| Show lowest price | Off, next 12 hours, next 24 hours, or both |

### Thermostat shortcuts
<img src="widgets/thermostat/preview-dark.png" alt="Thermostat shortcuts widget preview" width="320">

Three one-tap presets for a thermostat, heat pump or air conditioner. For example: *Off*, *Heat 21°* and *Cool 23° · Fan auto*.

Each button can:
- turn the device on or off, or leave it as it is
- set the target temperature
- set the mode, such as heat, cool or auto
- set one extra option, such as the fan speed

The button that matches the device's current state lights up. When no preset matches, the widget shows what the device is doing right now.

**Setting it up**
1. Add the widget to a dashboard and pick your thermostat or aircon.
2. Configure each button. The temperature, mode and extra lists show only what your device supports. Pick the device first, then reopen these settings.

## Installation
Widgetkeeper isn't in the Homey App Store yet. For now you can install it from source with the Homey CLI. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting
- **"Select a power meter" / "Select a thermostat"**: open the widget's settings and pick a device.
- **"No electricity prices available"**: switch on dynamic prices in Homey Energy.
- **A thermostat preset doesn't apply**: open the Homey app, go to **Apps → Widgetkeeper → Configure**, and pick the device. The page shows recent log lines and your device's capabilities. Include that report when you [open an issue](https://github.com/thomassidor/widgetkeeper/issues).

## Changelog
See [CHANGELOG.md](CHANGELOG.md) for what's new in each version.

## License
[MIT](LICENSE)
