<!--
A reply in the Homey Community topic (homeyCommunityTopicId 160453) announcing 1.0.0 in the test version.
Paste everything below this comment into the forum editor.

- Images are on GitHub main: the poster docs/whats-new-1.0.0.png (`npm run whats-new`) and docs/forum/*.jpg
  (`npm run forum-images`); Discourse copies them on save. Push them before posting. No transparent PNGs here:
  Discourse turns a large one into a JPEG on white.
- When 1.0.0 goes live, say so in a short reply of its own and update the first post.
-->

## :test_tube: Widgetkeeper 1.0.0 is in testing

Thanks for all the requests after 0.9.0: most of 1.0.0 comes from them. Try it in the test version: https://homey.app/a/com.thomassidor.widgetkeeper/test/

![What's new in Widgetkeeper 1.0.0|690x1307](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/whats-new-1.0.0.png)

**Eight new widgets**

* **Charts:** any value Homey logs in Insights, as a line, an area or bars over 1 hour to 7 days. One chart, two stacked, or two values on one chart with a scale each.
* **Room Health:** the whole house's indoor climate on one card. Each room shows its worst value, yellow to red the further it's outside its range (with the WHO's guidelines as defaults).
* **Value Matrix:** any devices against any values in one table, each cell green, orange or red by the range you type.
* **Days Since:** counters for the chores you do every so often, amber and then red when they're due; tap one when it's done. Flow cards too.
* **Variable Presets:** two to four buttons that set one variable, such as a house mode, like Thermostat Presets.
* **Notes:** a short message on a tile, or a handwritten Post-it. Type it in the settings, or let a Flow write it.
* **Spacer:** an empty widget of the height you set, to line up columns.
* **Dashboard Shortcuts:** for web dashboards, your other dashboards as buttons, a menu on each one.

**Name your tiles.** Turn on *Rename tiles*, type the names right on the tiles, and turn it off again. Works in twelve widgets, also for lights and curtains grouped by room.

**Colour style.** Every widget with a coloured state has *Muted*, the calmer look, and *Vivid*, with solid tiles in Homey's darker shades. Several widgets that were always blue get a colour setting.

**Web dashboards**

* A widget's settings come in cards, with the right control for each one, instead of one long list.
* A background per dashboard, light or dark in one tap, and a full screen with just the dashboard.
* Your other apps' widgets can go on them too, sealed off from the page.
* The front page has an edit mode: drag the dashboards into order.

![A web dashboard with Dashboard Shortcuts|690x470](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/forum/web-dashboard.jpg)

**Also new**

* **Light Controls:** the room's Homey Moods as a palette, and tiles that show every colour their lights shine in.
* **Media:** a large layout with full-width album art, and buttons for the speaker app's own actions.
* **Curtains:** blinds that are open at 50%, tilt-only blinds such as SwitchBot Blind Tilt, and how close to the end counts as open or closed.
* **Locks and Doors:** an Open button for locks that can pull the latch (tap it twice).
* **Flow Buttons:** a Flow card that colours a button, such as green while the e-bike charges.
* **Device Values:** a second value on a tile, and pill tiles. **Variables:** lowest and highest numbers, and a read-only mode that needs no API key.
* **Cameras:** live view tries the camera's other streams when one won't play (such as 4K H.265), can stay on until tapped, and a layout setting.
* **15-minute electricity prices**, where Homey Energy has them, and **presence and vibration sensors** in Activity Dots.
* **Clearer names:** Price Badge, Thermostat Shortcuts, Sensor Dots and Flow Variables are now Energy Price Strip, Thermostat Presets, Activity Dots and Variables. Widgets already on your dashboards keep working.

Full list: https://github.com/thomassidor/widgetkeeper/blob/main/CHANGELOG.md

**Especially useful to hear**

* **15-minute prices** (NL and other quarter-hour markets): I only get hourly prices here, so I haven't seen them for real.
* **Rename tiles** on your phone: typing on the tiles in the Homey app.
* **Room Health and Value Matrix** with your sensors: do the ranges make sense?
* **Other apps' widgets** on web dashboards: which ones don't work there?
* **Slatted and tilt-only blinds**, **4K Reolink cameras** and **locks with an Open button**: do they behave?

I'll keep 1.0.0 in testing for a while before it goes to the App Store, so now is a good time for feedback :slight_smile:
