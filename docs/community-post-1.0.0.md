<!--
A reply in the Homey Community topic (homeyCommunityTopicId 160453) on the status of 1.0.0.
Paste everything below this comment into the forum editor.

- Images are the README's on GitHub main (docs/screenshots/*.png, docs/clips/rename.webp is animated);
  Discourse copies them on save. Push them before posting.
- When 1.0.0 goes live, say so in a short reply of its own and update the first post.
-->

## :test_tube: Widgetkeeper 1.0.0 is in testing

Thanks for all the requests after 0.9.0: most of 1.0.0 comes from them. Try it in the test version: https://homey.app/a/com.thomassidor.widgetkeeper/test/

**Three new widgets**

* **Charts:** any value Homey logs in Insights, as a line, an area or bars over 1 hour to 7 days. One chart, two stacked, or two values on one chart with a scale each.
* **Notes:** a short message on a tile, or a handwritten Post-it on the dashboard. Type it in the settings, or let a Flow write it.
* **Spacer:** an empty widget of the height you set, to line up columns.

![Charts|358x396](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/screenshots/charts.png) ![Notes|358x248](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/screenshots/textline.png)

**Name your tiles.** Turn on *Rename tiles*, type the names right on the tiles, and turn it off again. Works in every widget with device tiles, also for lights and curtains grouped by room.

![Rename tiles|358x292](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/clips/rename.webp)

**Also new**

* **Light Controls:** the room's Homey Moods as a palette, and tiles that show every colour their lights shine in.
* **Media:** a large layout with full-width album art.
* **Curtains:** blinds that are open at 50%, and tilt-only blinds such as SwitchBot Blind Tilt.
* **Variables:** lowest and highest numbers, and a read-only mode that needs no API key.
* **Cameras:** live view tries the camera's other streams when one won't play (such as 4K H.265).
* **15-minute electricity prices**, where Homey Energy has them.
* **Presence sensors** in Activity Dots and Sensor Alarms.
* **Clearer names:** Price Badge, Thermostat Shortcuts, Sensor Dots and Flow Variables are now Energy Price Strip, Thermostat Presets, Activity Dots and Variables. Widgets already on your dashboards keep working.

Full list: https://github.com/thomassidor/widgetkeeper/blob/main/CHANGELOG.md

**Especially useful to hear**

* **15-minute prices** (NL and other quarter-hour markets): I only get hourly prices here, so I haven't seen them for real.
* **Slatted and tilt-only blinds**, and **4K Reolink cameras**: do they behave now?
* **Rename tiles** on your phone: typing on the tiles in the Homey app.
