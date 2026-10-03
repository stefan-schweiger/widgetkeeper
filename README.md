# Widgetkeeper

Extra dashboard widgets for Homey Pro.

I built these to replace a few native Homey widgets that didn't quite behave the way I wanted. The aim is widgets that sit naturally next to Homey's own: the same look, the same feel, and no sense that they came from somewhere else.

| Widget | What it does |
| --- | --- |
| [Electricity Overview](#electricity-overview) | Live power use, hourly electricity prices and usage history on one card |
| [Thermostat Shortcuts](#thermostat-shortcuts) | Three one-tap presets for a thermostat, heat pump or air conditioner |
| [Device Quick Actions](#device-quick-actions) | Compact tiles that run a device's quick action with one tap |

## Electricity Overview
<img src="docs/screenshots/electricity.png" alt="Electricity Overview on a Homey dashboard" width="390">

Your power use and electricity price together on one card:
- **Live power**, updated every few seconds, over the last 30 seconds to 1 hour.
- **Hourly electricity price**, from yesterday to 12 hours ahead, with midnight marked.
- **Usage history** for the last 24 hours, drawn on the price chart or as its own chart.
- **Cheapest upcoming hour** in the next 12 hours, the next 24 hours, or both.

Tap or drag on a chart (or hover with a mouse) to see the exact value at any moment. On Android, Homey's dashboard takes over drags, so tap instead; the value stays for 3 seconds.

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

## Thermostat Shortcuts
<img src="docs/screenshots/thermostat.png" alt="Thermostat Shortcuts on a Homey dashboard" width="390">

Three one-tap presets for a thermostat, heat pump or air conditioner. For example: *Off*, *Heat 21° · Fan level 1* and *Heat 24° · Fan level 5*.

Each button can:
- turn the device on or off, or leave it as it is
- set the target temperature
- set the mode, such as heat, cool or auto
- set one extra option, such as the fan speed

The button that matches the device's current state lights up. When no preset matches, the widget shows what the device is doing right now.

**Setting it up**
1. Add the widget to a dashboard and pick your thermostat or aircon.
2. Configure each button. The temperature, mode and extra lists show only what your device supports. Pick the device first, then reopen these settings.

## Device Quick Actions
<img src="docs/screenshots/quickactions.png" alt="Device Quick Actions on a Homey dashboard" width="390">

Half-height device tiles for as many devices as you like. Tap anywhere on a tile to run the device's quick action, the same action as the round button on Homey's own device tile:
- turn a light, plug or other device on or off
- lock or unlock a door
- play or pause a speaker
- press a button, such as a scene or alarm button

The whole tile shows the state: it's highlighted while the device is on, locked or playing. The tiles use the same icons as Homey's own tiles, including icons you picked for a device.

**Setting it up**
1. Add the widget to a dashboard and pick the devices. They're shown in the order you pick them.
2. Optionally pick the active tile style: **Blue tint** (the default) or **Lighter tile**.

The quick action is the one Homey uses for the device, including one you changed in the device's settings. Devices without a quick action, such as sensors, are shown dimmed. The tiles don't react while the dashboard is in edit mode.

## Languages
English, Dutch, German, French, Italian, Swedish, Norwegian, Spanish, Danish, Russian, Polish, Korean and Arabic. The widgets follow Homey's language.

## Installation
Widgetkeeper isn't in the Homey App Store yet. For now you can install it from source with the Homey CLI. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting
- **"Select a power meter" / "Select a thermostat" / "Select devices"**: open the widget's settings and pick a device.
- **"No electricity prices available"**: switch on dynamic prices in Homey Energy.
- **A thermostat preset or quick action doesn't apply**: open the Homey app, go to **Apps → Widgetkeeper → Configure**, and pick the device. The page shows recent log lines and your device's capabilities. Include that report when you [open an issue](https://github.com/thomassidor/widgetkeeper/issues).

## Changelog
See [CHANGELOG.md](CHANGELOG.md) for what's new in each version.

## License
[MIT](LICENSE)

The screenshots show the real widgets with mock data, rendered by `npm run screenshots`.
