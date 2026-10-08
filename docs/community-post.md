<!--
The first post of the Homey Community topic (homeyCommunityTopicId 160453).
Paste everything below this comment into the forum editor.

- Preview images are the README's (docs/previews/*-dark.png on GitHub main); Discourse copies
  them on save. So are the dashboards (docs/showcase/*.png, 2816 × 1864, shown at 690 × 457).
  upload:// images are ones already in the topic.
- Mark anything that's only in the test version with ":soon: **Next version**". When a version
  goes live, remove its marks, update "What's new in the next version" and the version numbers.
-->

# 

![Widgetkeeper widgets on a Homey dashboard on a tablet|690x457](upload://hfq6wmR7epDOiBus9DcPc7f1E31.jpeg)

Hi all,

I've been building **Widgetkeeper**, an app with dashboard widgets for Homey Pro. My aim was widgets that sit next to Homey's own without standing out: the same tile sizes, fonts, colours and dark mode, so a dashboard still looks like one dashboard.

> :white_check_mark: **Widgetkeeper 0.7.0 is live in the Homey App Store:** https://homey.app/a/com.thomassidor.widgetkeeper/
>
> :test_tube: **Test version:** the next version (0.8.0) with six new widgets is in testing. Widgets and changes marked :soon: **Next version** below are only in the test version for now: https://homey.app/a/com.thomassidor.widgetkeeper/test/

## The widgets

Tap a name for the full description and settings on GitHub.

| | Widget |
|---|---|
| [![Electricity Overview|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/electricity-dark.png)](https://github.com/thomassidor/widgetkeeper#electricity-overview) | :zap: **[Electricity Overview](https://github.com/thomassidor/widgetkeeper#electricity-overview)**<br>Live power use, hourly electricity prices and usage history on one card |
| [![Thermostat Shortcuts|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/thermostat-dark.png)](https://github.com/thomassidor/widgetkeeper#thermostat-shortcuts) | :thermometer: **[Thermostat Shortcuts](https://github.com/thomassidor/widgetkeeper#thermostat-shortcuts)**<br>Three one-tap presets for a thermostat, heat pump or air conditioner |
| [![Device Quick Actions|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/quickactions-dark.png)](https://github.com/thomassidor/widgetkeeper#device-quick-actions) | :radio_button: **[Device Quick Actions](https://github.com/thomassidor/widgetkeeper#device-quick-actions)**<br>Compact tiles that run a device's quick action with one tap |
| [![Sensor Alarms|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/sensoralarms-dark.png)](https://github.com/thomassidor/widgetkeeper#sensor-alarms) | :rotating_light: **[Sensor Alarms](https://github.com/thomassidor/widgetkeeper#sensor-alarms)**<br>Tiles that show a sensor's alarm and turn red when one is on |
| [![Sensor Dots|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/sensordots-dark.png)](https://github.com/thomassidor/widgetkeeper#sensor-dots) | :large_blue_circle: **[Sensor Dots](https://github.com/thomassidor/widgetkeeper#sensor-dots)** :soon: **Next version**<br>Many motion and contact sensors at a glance, as dots that change colour when active |
| [![Weather Forecast|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/weather-dark.png)](https://github.com/thomassidor/widgetkeeper#weather-forecast) | :sun_behind_rain_cloud: **[Weather Forecast](https://github.com/thomassidor/widgetkeeper#weather-forecast)**<br>The next 36 hours, hour by hour, from MET Norway (yr.no) |
| [![Insights Heatmap|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/heatmap-dark.png)](https://github.com/thomassidor/widgetkeeper#insights-heatmap) | :calendar: **[Insights Heatmap](https://github.com/thomassidor/widgetkeeper#insights-heatmap)**<br>A week of one value (light, temperature, motion …) as a grid of weekdays and hours |
| [![Cameras|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/cameras-dark.png)](https://github.com/thomassidor/widgetkeeper#cameras) | :movie_camera: **[Cameras](https://github.com/thomassidor/widgetkeeper#cameras)**<br>Two to six cameras in one grid of snapshots; tap one to watch it live |
| [![Device Values|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/values-dark.png)](https://github.com/thomassidor/widgetkeeper#device-values) | :1234: **[Device Values](https://github.com/thomassidor/widgetkeeper#device-values)**<br>Compact tiles that each show one value, such as a temperature, power or on/off |
| [![Light Controls|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/lights-dark.png)](https://github.com/thomassidor/widgetkeeper#light-controls) | :bulb: **[Light Controls](https://github.com/thomassidor/widgetkeeper#light-controls)**<br>Compact light tiles with brightness, colour and colour temperature: six lights in the space of three |
| [![Sparklines|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/sparklines-dark.png)](https://github.com/thomassidor/widgetkeeper#sparklines) | :chart_with_upwards_trend: **[Sparklines](https://github.com/thomassidor/widgetkeeper#sparklines)**<br>Tiles with a small chart of a value over the last hour, day or week, with its lowest and highest |
| [![Flow Variables|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/variables-dark.png)](https://github.com/thomassidor/widgetkeeper#flow-variables) | :twisted_rightwards_arrows: **[Flow Variables](https://github.com/thomassidor/widgetkeeper#flow-variables)** :soon: **Next version**<br>Compact rows to switch flow variables on and off or change a number or text, with the full name |
| [![Flow Buttons|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/flows-dark.png)](https://github.com/thomassidor/widgetkeeper#flow-buttons) | :arrow_forward: **[Flow Buttons](https://github.com/thomassidor/widgetkeeper#flow-buttons)** :soon: **Next version**<br>Start flows with one tap: a round button in the colour and icon you pick, with the flow's name |
| [![Price Badge|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/price-dark.png)](https://github.com/thomassidor/widgetkeeper#price-badge) | :moneybag: **[Price Badge](https://github.com/thomassidor/widgetkeeper#price-badge)** :soon: **Next version**<br>The electricity price now, the next hour's and the cheapest hour ahead in one compact tile |
| [![Timers|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/timers-dark.png)](https://github.com/thomassidor/widgetkeeper#timers) | :stopwatch: **[Timers](https://github.com/thomassidor/widgetkeeper#timers)** :soon: **Next version**<br>Kitchen timers from one-tap presets, with a Flow card when one runs out |
| [![Locks and Doors|120x105](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/previews/locks-dark.png)](https://github.com/thomassidor/widgetkeeper#locks-and-doors) | :lock: **[Locks and Doors](https://github.com/thomassidor/widgetkeeper#locks-and-doors)** :soon: **Next version**<br>One line that says whether every lock and door is locked and closed |

Every widget follows Homey's light and dark mode and is translated into all 13 of Homey's languages.

## :soon: What's new in the next version (0.8.0)

Besides the six new widgets above:

* **Electricity Overview:** supports a fixed electricity price set in Homey Energy, shows solar export below zero in yellow, and the prices can be hidden.
* **Device Values:** a Flow can colour a tile, such as red when the fridge is too warm.
* **Light Controls:** plugs and wall switches set up as lights can be picked too, and a setting stops the brightness bar at 1 % instead of turning the light off.
* **Insights Heatmap:** pick the colour.
* **Thermostat Shortcuts:** a preset now always sets its temperature, also on aircons that keep a temperature per mode.
* Clearer setting names and help texts, and a brief connection problem no longer hides a widget.

Flow Buttons and Flow Variables need a Homey API key, which you add in the app's settings (**Apps → Widgetkeeper → Configure**).

## Dashboard examples

Seven dashboards from a made-up house, on a tablet in Homey's dark mode. Swipe through them:

[grid mode=carousel]

![Home dashboard|690x457](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/showcase/home.png)

![Energy dashboard|690x457](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/showcase/energy.png)

![Security dashboard|690x457](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/showcase/security.png)

![Climate dashboard|690x457](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/showcase/climate.png)

![Evening dashboard|690x457](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/showcase/evening.png)

![Garden dashboard|690x457](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/showcase/garden.png)

![Kitchen dashboard|690x457](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/showcase/kitchen.png)

[/grid]

**Home**, **Energy**, **Security**, **Climate**, **Evening**, **Garden** and **Kitchen**. Some of them use widgets from the next version. What's on each one: https://github.com/thomassidor/widgetkeeper#dashboard-examples

## :speech_balloon: Feedback wanted

All feedback is welcome. I'm especially interested in:

* **Does it look and feel like Homey?** Spacing, fonts or colours that look off next to Homey's own widgets, on a phone or on a tablet.
* **Your devices.** A thermostat, alarm or light that doesn't show up or behaves oddly. Please tell me the brand and model.
* **Translations.** If you speak one of the languages, wording that sounds wrong.
* **What's missing.** A widget you'd like to see next.

If something doesn't work, open **Apps → Widgetkeeper → Configure** in the Homey app and pick the device. That page has a diagnostics report you can paste here (it doesn't include passwords, API keys or camera URLs).

The source is on GitHub, and you can also open issues there: https://github.com/thomassidor/widgetkeeper

I hope you find this useful :slight_smile:
