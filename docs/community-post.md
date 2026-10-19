<!--
The first post of the Homey Community topic (homeyCommunityTopicId 160453).
Paste everything below this comment into the forum editor.

- Preview images are the README's (docs/previews/*-dark.png on GitHub main); Discourse copies
  them on save. So are the dashboards (docs/showcase/*.png, 2816 × 1864, shown at 690 × 457).
  The web dashboards are docs/web/*.png (3040 × 2070, shown at 690 × 470).
  upload:// images are ones already in the topic.
- Mark anything that's only in the test version with ":soon: **Next version**". When a version
  goes live, remove its marks, update "What's new in the next version" and the version numbers.
-->

# 


![Widgetkeeper widgets on a Homey dashboard on a tablet|690x457](upload://hfq6wmR7epDOiBus9DcPc7f1E31.jpeg)

Hi all,

I've been building **Widgetkeeper**, an app with dashboard widgets for Homey Pro. My aim was widgets that sit next to Homey's own without standing out: the same tile sizes, fonts, colours and dark mode, so a dashboard still looks like one dashboard.

> :white_check_mark: **Widgetkeeper 0.8.0 is live in the Homey App Store:** https://homey.app/a/com.thomassidor.widgetkeeper/
>
> :test_tube: **Test version:** the next version (0.9.0), with four new widgets and web dashboards, is in testing. Widgets and changes marked :soon: **Next version** below are only in the test version for now: https://homey.app/a/com.thomassidor.widgetkeeper/test/

## The widgets

Tap a name for the full description and settings on GitHub.

| | Widget |
|---|---|
| [![Electricity Overview|120x105](upload://oMEhI5X6oylOIbhUrqxxiyUoxzf.png)](https://github.com/thomassidor/widgetkeeper#electricity-overview) | **[Electricity Overview](https://github.com/thomassidor/widgetkeeper#electricity-overview)**<br>Live power use, hourly electricity prices and usage history on one card |
| [![Thermostat Shortcuts|120x105](upload://g66Fnaa42AMdem0f5uFgnQ3hR5q.png)](https://github.com/thomassidor/widgetkeeper#thermostat-shortcuts) | **[Thermostat Shortcuts](https://github.com/thomassidor/widgetkeeper#thermostat-shortcuts)**<br>Three one-tap presets for a thermostat, heat pump or air conditioner |
| [![Device Quick Actions|120x105](upload://yTXsDGAub174pYWjS1DGcv7xqsu.png)](https://github.com/thomassidor/widgetkeeper#device-quick-actions) | **[Device Quick Actions](https://github.com/thomassidor/widgetkeeper#device-quick-actions)**<br>Compact tiles that run a device's quick action with one tap |
| [![Sensor Alarms|120x105](upload://m4NlWt6CsNVfv1DykQjmhPlBGu4.png)](https://github.com/thomassidor/widgetkeeper#sensor-alarms) | **[Sensor Alarms](https://github.com/thomassidor/widgetkeeper#sensor-alarms)**<br>Tiles that show a sensor's alarm and turn red when one is on |
| [![Sensor Dots|120x105](upload://iK67QdGwZXYwsSxzTNqUiFBwG5b.png)](https://github.com/thomassidor/widgetkeeper#sensor-dots) | **[Sensor Dots](https://github.com/thomassidor/widgetkeeper#sensor-dots)**<br>Many motion and contact sensors at a glance, as dots that change colour when active |
| [![Weather Forecast|120x105](upload://mSq2ChXKzi7UUZf9yHQwzP4NNpe.png)](https://github.com/thomassidor/widgetkeeper#weather-forecast) | **[Weather Forecast](https://github.com/thomassidor/widgetkeeper#weather-forecast)**<br>The next 36 hours, hour by hour, from MET Norway (yr.no) |
| [![Insights Heatmap|120x105](upload://3gUl8mI2CJoJV7zKr6tEYUYoeYl.png)](https://github.com/thomassidor/widgetkeeper#insights-heatmap) | **[Insights Heatmap](https://github.com/thomassidor/widgetkeeper#insights-heatmap)**<br>A week of one value (light, temperature, motion …) as a grid of weekdays and hours |
| [![Cameras|120x105](upload://6Q5LXvEo1fkSIC3v4ggQGBZTySd.png)](https://github.com/thomassidor/widgetkeeper#cameras) | **[Cameras](https://github.com/thomassidor/widgetkeeper#cameras)**<br>Two to six cameras in one grid of snapshots; tap one to watch it live |
| [![Device Values|120x105](upload://zgUYM1Up2RJzfH0SpDCXRe65zL0.png)](https://github.com/thomassidor/widgetkeeper#device-values) | **[Device Values](https://github.com/thomassidor/widgetkeeper#device-values)**<br>Compact tiles that each show one value, such as a temperature, power or on/off |
| [![Light Controls|120x105](upload://AjYtZ7AZ1HgIlONXnxY3mLs3bZQ.png)](https://github.com/thomassidor/widgetkeeper#light-controls) | **[Light Controls](https://github.com/thomassidor/widgetkeeper#light-controls)**<br>Compact light tiles with brightness, colour and colour temperature: six lights in the space of three |
| [![Sparklines|120x105](upload://2O6XmLisgL4by57eSyvK95N9CCK.png)](https://github.com/thomassidor/widgetkeeper#sparklines) | **[Sparklines](https://github.com/thomassidor/widgetkeeper#sparklines)**<br>Tiles with a small chart of a value over the last hour, day or week, with its lowest and highest |
| [![Flow Variables|120x105](upload://2yC3iwyQorF7EgKbHAXj0DVeaPb.png)](https://github.com/thomassidor/widgetkeeper#flow-variables) | **[Flow Variables](https://github.com/thomassidor/widgetkeeper#flow-variables)**<br>Compact rows to switch flow variables on and off or change a number or text, with the full name |
| [![Flow Buttons|120x105](upload://7AaGEulpsjMyTI3zoYF2EWrkwmf.png)](https://github.com/thomassidor/widgetkeeper#flow-buttons) | **[Flow Buttons](https://github.com/thomassidor/widgetkeeper#flow-buttons)**<br>Start flows with one tap: a round button in the colour and icon you pick, with the flow's name |
| [![Price Badge|120x105](upload://5Xmn0ECgCKhB40sSbviTcahARlf.png)](https://github.com/thomassidor/widgetkeeper#price-badge) | **[Price Badge](https://github.com/thomassidor/widgetkeeper#price-badge)** :soon: **New look in the next version**<br>The electricity price now and the coming hours as small bars, green, yellow or red |
| [![Timers|120x105](upload://pPwDIqa3j2tlueBKsKXFT86XgQk.png)](https://github.com/thomassidor/widgetkeeper#timers) | **[Timers](https://github.com/thomassidor/widgetkeeper#timers)**<br>Kitchen timers from one-tap presets, with a Flow card when one runs out |
| [![Locks and Doors|120x105](upload://hgmETIkMBWjejFXPGKqlK1gzA2V.png)](https://github.com/thomassidor/widgetkeeper#locks-and-doors) | **[Locks and Doors](https://github.com/thomassidor/widgetkeeper#locks-and-doors)**<br>One line that says whether every lock and door is locked and closed |
| [![Curtains|120x105](upload://c7Ts2WESAOFNDvSR3EWjtK6HC6S.png)](https://github.com/thomassidor/widgetkeeper#curtains) | **[Curtains](https://github.com/thomassidor/widgetkeeper#curtains)** :soon: **Next version**<br>Curtains and blinds that open or close with one tap, with a slider for anything in between |
| [![Media|120x105](upload://wfOiqyLxN4q6jDaR3sH882KUFfb.png)](https://github.com/thomassidor/widgetkeeper#media) | **[Media](https://github.com/thomassidor/widgetkeeper#media)** :soon: **Next version**<br>A speaker with its album art, mute, a volume that never overshoots and buttons for its sources |
| [![Smart Stack|120x105](upload://rkz2e2MTZCVtjdXnP8rHfJn9bmu.png)](https://github.com/thomassidor/widgetkeeper#smart-stack) | **[Smart Stack](https://github.com/thomassidor/widgetkeeper#smart-stack)** :soon: **Next version**<br>Several widgets in one spot, one at a time, with the one that matters brought forward |
| [![Clock|120x105](upload://Au77bM2bOsXN2R2tuxqz84JLrqq.png)](https://github.com/thomassidor/widgetkeeper#clock) | **[Clock](https://github.com/thomassidor/widgetkeeper#clock)** :soon: **Next version**<br>The time and the date, with the weather now and today's high and low |

Every widget follows Homey's light and dark mode and is translated into all 13 of Homey's languages.

## :soon: What's new in the next version (0.9.0)

Besides the four new widgets above:

* **Web dashboards:** your Widgetkeeper widgets in any browser on your home network, such as a wall tablet, an old iPad, a computer or a TV. Build the dashboards on the page itself; turn them on under **Apps → Widgetkeeper → Configure**.
* **Electricity prices** now include the tariffs and taxes set up in Homey Energy, so they match Homey's own Energy tab (can be turned off).
* **Price Badge:** a new look, with the coming 12, 24 or 36 hours as small bars and a dot over the cheapest.
* **Tile names:** give tiles, rows and buttons your own names in Device Values, Flow Variables, Flow Buttons and Sensor Alarms.
* **Electricity Overview** and **Thermostat Shortcuts:** a compact layout.
* **Sparklines:** 2, 3 and 5 day spans. **Cameras:** cameras with only a video stream (such as Aqara) show a still from it.
* **Locks and Doors:** a calmer list, with secure states in green and the rest in red.

Flow Buttons, Flow Variables, Smart Stack and Media's buttons need a Homey API key, which you add in the app's settings (**Apps → Widgetkeeper → Configure**).

## Dashboard examples

Seven dashboards from a made-up house, on a tablet in Homey's dark mode. Swipe through them:

[grid mode=carousel]

![Home dashboard|690x457](upload://hfq6wmR7epDOiBus9DcPc7f1E31.jpeg)

![Energy dashboard|690x457](upload://fuKGZXGJqUzp85f6iROFWPo45Y0.jpeg)

![Security dashboard|690x457](upload://eh7PyyQ9xdT3nAzCGlIZmyNW53L.jpeg)

![Climate dashboard|690x457](upload://dZdzZlrILehWKSAXPECn8BVbBu4.jpeg)

![Evening dashboard|690x457](upload://1Ip9LoGsmwR18kPaOFx7ssFlp2J.jpeg)

![Garden dashboard|690x457](upload://5NRipDaEKeUr5FFmjH14KDkcfCn.jpeg)

![Kitchen dashboard|690x457](upload://vl8vZH8aqRAFRijdxw1w2dT3MBp.jpeg)

[/grid]

**Home**, **Energy**, **Security**, **Climate**, **Evening**, **Garden** and **Kitchen**. Some of them use widgets from the next version (the Kitchen has the new Clock, the Evening the Curtains and Media). What's on each one: https://github.com/thomassidor/widgetkeeper#dashboard-examples

## :speech_balloon: Feedback wanted

All feedback is welcome. I'm especially interested in:

* **Does it look and feel like Homey?** Spacing, fonts or colours that look off next to Homey's own widgets, on a phone or on a tablet.
* **Your devices.** A thermostat, alarm or light that doesn't show up or behaves oddly. Please tell me the brand and model.
* **Translations.** If you speak one of the languages, wording that sounds wrong.
* **What's missing.** A widget you'd like to see next.

If something doesn't work, open **Apps → Widgetkeeper → Configure** in the Homey app and pick the device. That page has a diagnostics report you can paste here (it doesn't include passwords, API keys or camera URLs).

The source is on GitHub, and you can also open issues there: https://github.com/thomassidor/widgetkeeper

I hope you find this useful :slight_smile: