# Widgetkeeper

Extra dashboard widgets for Homey Pro, made to sit naturally next to Homey's own with the same look and feel.

<img src="docs/showcase/home.png" alt="Widgetkeeper widgets on a Homey dashboard on a tablet" width="100%">

**Contents:** [Widgets](#widgets) · [Web dashboards](#web-dashboards) · [Dashboard examples](#dashboard-examples) · [Colour style](#colour-style) · [Tile names](#tile-names) · [API key](#api-key) · [Installation](#installation) · [Troubleshooting](#troubleshooting)

## Widgets
Every widget follows Homey's light and dark mode and is translated into all 13 of Homey's languages. Tap one for what it does and its settings.

<p><a href="#activity-dots"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/sensordots-dark.png"><img src="docs/previews/sensordots-light.png" alt="" width="120" align="left"></picture></a>
<a href="#activity-dots"><b>Activity Dots</b></a><br>
Many motion, contact and vibration sensors at a glance, as dots that change colour when active<br clear="left"></p>

<p><a href="#cameras"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/cameras-dark.png"><img src="docs/previews/cameras-light.png" alt="" width="120" align="left"></picture></a>
<a href="#cameras"><b>Cameras</b></a><br>
Two to six cameras in one grid of snapshots; tap one to watch it live<br clear="left"></p>

<p><a href="#charts"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/charts-dark.png"><img src="docs/previews/charts-light.png" alt="" width="120" align="left"></picture></a>
<a href="#charts"><b>Charts</b></a><br>
One or two charts of any value over the last hour, day or week, drawn like Electricity Overview's<br clear="left"></p>

<p><a href="#clock"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/clock-dark.png"><img src="docs/previews/clock-light.png" alt="" width="120" align="left"></picture></a>
<a href="#clock"><b>Clock</b></a><br>
The time and the date, with the weather now and today's high and low<br clear="left"></p>

<p><a href="#curtains"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/curtains-dark.png"><img src="docs/previews/curtains-light.png" alt="" width="120" align="left"></picture></a>
<a href="#curtains"><b>Curtains</b></a><br>
Curtains and blinds that open or close with one tap, with a slider for anything in between<br clear="left"></p>

<p><a href="#dashboard-shortcuts"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/shortcuts-dark.png"><img src="docs/previews/shortcuts-light.png" alt="" width="120" align="left"></picture></a>
<a href="#dashboard-shortcuts"><b>Dashboard Shortcuts</b></a> (web dashboards only)<br>
Your other web dashboards as buttons in your colours and icons, a menu for every dashboard<br clear="left"></p>

<p><a href="#days-since"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/dayssince-dark.png"><img src="docs/previews/dayssince-light.png" alt="" width="120" align="left"></picture></a>
<a href="#days-since"><b>Days Since</b></a><br>
How long since the plants were watered or the filter changed, amber and then red when it's due; tap to reset<br clear="left"></p>

<p><a href="#device-quick-actions"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/quickactions-dark.png"><img src="docs/previews/quickactions-light.png" alt="" width="120" align="left"></picture></a>
<a href="#device-quick-actions"><b>Device Quick Actions</b></a><br>
Compact tiles that run a device's quick action with one tap<br clear="left"></p>

<p><a href="#device-values"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/values-dark.png"><img src="docs/previews/values-light.png" alt="" width="120" align="left"></picture></a>
<a href="#device-values"><b>Device Values</b></a><br>
Compact tiles that each show one value, such as a temperature, power or on/off<br clear="left"></p>

<p><a href="#electricity-overview"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/electricity-dark.png"><img src="docs/previews/electricity-light.png" alt="" width="120" align="left"></picture></a>
<a href="#electricity-overview"><b>Electricity Overview</b></a><br>
Live power use, hourly electricity prices and usage history on one card<br clear="left"></p>

<p><a href="#energy-price-strip"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/price-dark.png"><img src="docs/previews/price-light.png" alt="" width="120" align="left"></picture></a>
<a href="#energy-price-strip"><b>Energy Price Strip</b></a><br>
The electricity price now and the coming hours as small bars, green, yellow or red<br clear="left"></p>

<p><a href="#flow-buttons"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/flows-dark.png"><img src="docs/previews/flows-light.png" alt="" width="120" align="left"></picture></a>
<a href="#flow-buttons"><b>Flow Buttons</b></a><br>
Start flows with one tap: a round button in the colour and icon you pick, with the flow's name<br clear="left"></p>

<p><a href="#insights-heatmap"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/heatmap-dark.png"><img src="docs/previews/heatmap-light.png" alt="" width="120" align="left"></picture></a>
<a href="#insights-heatmap"><b>Insights Heatmap</b></a><br>
A week of one value (light, temperature, motion …) as a grid of weekdays and hours<br clear="left"></p>

<p><a href="#light-controls"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/lights-dark.png"><img src="docs/previews/lights-light.png" alt="" width="120" align="left"></picture></a>
<a href="#light-controls"><b>Light Controls</b></a><br>
Compact light tiles with brightness, colour and colour temperature: six lights in the space of three<br clear="left"></p>

<p><a href="#lights-by-room"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/lightrooms-dark.png"><img src="docs/previews/lightrooms-light.png" alt="" width="120" align="left"></picture></a>
<a href="#lights-by-room"><b>Lights by Room</b></a><br>
Every room's lights on a card: switch and dim a room, or open it for each light and the room's Moods<br clear="left"></p>

<p><a href="#locks-and-doors"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/locks-dark.png"><img src="docs/previews/locks-light.png" alt="" width="120" align="left"></picture></a>
<a href="#locks-and-doors"><b>Locks and Doors</b></a><br>
One line that says whether every lock and door is locked and closed<br clear="left"></p>

<p><a href="#media"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/media-dark.png"><img src="docs/previews/media-light.png" alt="" width="120" align="left"></picture></a>
<a href="#media"><b>Media</b></a><br>
A speaker with its album art, mute, a volume that never overshoots and buttons for its sources<br clear="left"></p>

<p><a href="#notes"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/textline-dark.png"><img src="docs/previews/textline-light.png" alt="" width="120" align="left"></picture></a>
<a href="#notes"><b>Notes</b></a><br>
A note on a tile or a handwritten Post-it, typed in or written by your Flows<br clear="left"></p>

<p><a href="#pollen-and-uv"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/pollen-dark.png"><img src="docs/previews/pollen-light.png" alt="" width="120" align="left"></picture></a>
<a href="#pollen-and-uv"><b>Pollen and UV</b></a><br>
Today's pollen levels and the UV peak, in Europe<br clear="left"></p>

<p><a href="#popups"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/popups-dark.png"><img src="docs/previews/popups-light.png" alt="" width="120" align="left"></picture></a>
<a href="#popups"><b>Popups</b></a><br>
A Flow's message or Yes/No question, with a picture if you like, in front of everything on a phone, tablet or web dashboard<br clear="left"></p>

<p><a href="#room-health"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/roomhealth-dark.png"><img src="docs/previews/roomhealth-light.png" alt="" width="120" align="left"></picture></a>
<a href="#room-health"><b>Room Health</b></a><br>
Each room's temperature, humidity and air quality at a glance, turning yellow to red when something is off<br clear="left"></p>

<p><a href="#sensor-alarms"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/sensoralarms-dark.png"><img src="docs/previews/sensoralarms-light.png" alt="" width="120" align="left"></picture></a>
<a href="#sensor-alarms"><b>Sensor Alarms</b></a><br>
Tiles that show a sensor's alarm and turn red when one is on<br clear="left"></p>

<p><a href="#smart-stack"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/stack-dark.png"><img src="docs/previews/stack-light.png" alt="" width="120" align="left"></picture></a>
<a href="#smart-stack"><b>Smart Stack</b></a><br>
Several widgets in one spot, one at a time, with the one that matters brought forward<br clear="left"></p>

<p><a href="#spacer"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/spacer-dark.png"><img src="docs/previews/spacer-light.png" alt="" width="120" align="left"></picture></a>
<a href="#spacer"><b>Spacer</b></a><br>
Empty space of the height you set, to line up widgets across columns<br clear="left"></p>

<p><a href="#sparklines"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/sparklines-dark.png"><img src="docs/previews/sparklines-light.png" alt="" width="120" align="left"></picture></a>
<a href="#sparklines"><b>Sparklines</b></a><br>
Tiles with a small chart of a value over the last hour, day or week, with its lowest and highest<br clear="left"></p>

<p><a href="#thermostat-presets"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/thermostat-dark.png"><img src="docs/previews/thermostat-light.png" alt="" width="120" align="left"></picture></a>
<a href="#thermostat-presets"><b>Thermostat Presets</b></a><br>
Three one-tap presets for a thermostat, heat pump or air conditioner<br clear="left"></p>

<p><a href="#timers"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/timers-dark.png"><img src="docs/previews/timers-light.png" alt="" width="120" align="left"></picture></a>
<a href="#timers"><b>Timers</b></a><br>
Kitchen timers from one-tap presets, with a Flow card when one runs out<br clear="left"></p>

<p><a href="#value-matrix"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/valuematrix-dark.png"><img src="docs/previews/valuematrix-light.png" alt="" width="120" align="left"></picture></a>
<a href="#value-matrix"><b>Value Matrix</b></a><br>
Devices or rooms against the values you choose, in one table, each cell green, orange or red by its range<br clear="left"></p>

<p><a href="#variable-presets"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/varpresets-dark.png"><img src="docs/previews/varpresets-light.png" alt="" width="120" align="left"></picture></a>
<a href="#variable-presets"><b>Variable Presets</b></a><br>
Two to four one-tap buttons that set a variable to the values you pick, like Thermostat Presets<br clear="left"></p>

<p><a href="#variables"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/variables-dark.png"><img src="docs/previews/variables-light.png" alt="" width="120" align="left"></picture></a>
<a href="#variables"><b>Variables</b></a><br>
Compact rows to switch variables on and off or change a number or text, with the full name<br clear="left"></p>

<p><a href="#weather-forecast"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/weather-dark.png"><img src="docs/previews/weather-light.png" alt="" width="120" align="left"></picture></a>
<a href="#weather-forecast"><b>Weather Forecast</b></a><br>
The next 36 hours, hour by hour, from MET Norway (yr.no)<br clear="left"></p>

<p><a href="#web-page"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/previews/webpage-dark.png"><img src="docs/previews/webpage-light.png" alt="" width="120" align="left"></picture></a>
<a href="#web-page"><b>Web Page</b></a><br>
Any web page, scaled to fill the widget, with buttons to switch between addresses<br clear="left"></p>

<a name="sensor-dots"></a>

## Activity Dots
<img src="docs/clips/sensordots.webp" alt="Activity Dots on a Homey dashboard: dots lighting up as someone comes in through the front door, then tapped for the kitchen's motion and the open garage" width="358">

Motion, contact, vibration and camera sensors as a grid of dots that light up while active. Tap a dot for its name and since when, such as *Garage · Open since 18:17*.

**Settings:** sensors, title, idle and active colours, [colour style](#colour-style), time format.

## Cameras
<img src="docs/screenshots/cameras.png" alt="Cameras on a Homey dashboard" width="358">

Your cameras as a grid of snapshots that refresh every few seconds (cameras with only a video stream show a still from it). Tap one to watch it live.

**Settings:** cameras, layout (a large camera at the top or bottom, or one per row), refresh interval, how long live view stays on, time format, [rename tiles](#tile-names).

## Charts
<img src="docs/screenshots/charts.png" alt="Charts on a Homey dashboard: the outdoor temperature as a line, and the power use as bars" width="358">

One chart, two stacked, or two values on one chart (each with its own scale), of any value that Homey logs in Insights, drawn like Electricity Overview's charts. The value now sits at the top in the chart's colour. Tap a chart to see the value at that moment.

**Settings:** one chart, two stacked or two on one chart; per chart the value, time span (1 hour to 7 days, today or yesterday), style (line with area, line or bars), colour, scale (fitted or from zero), below zero in yellow, smooth line and title; the values at the top (yesterday shows its average there); [colour style](#colour-style).

## Clock
<img src="docs/screenshots/clock.png" alt="Clock on a Homey dashboard" width="358">

The time and the date in one tile, with the weather now and today's high and low from [MET Norway](https://www.met.no/en), the Weather Forecast's data. The time follows your phone, tablet or browser (24 or 12 hours) unless you pick one, the date Homey's language.

**Settings:** show the weather, time format (automatic, 24-hour or 12-hour).

## Curtains
<img src="docs/clips/curtains.webp" alt="Curtains on a Homey dashboard: an open curtain tapped closed, a closed one tapped open and sent back with a second tap, and a blind dragged most of the way up" width="358">

Curtains and blinds as tiles: tap to open or close (the corner label says which), or use the slider for anything between. A tap while it moves sends it back.

**Settings:** devices, what a tap does halfway, inverted position (leave it off when the device's own invert setting already flips it), how close to the end counts as open or closed, state line, group by room, colour, [colour style](#colour-style), [rename tiles](#tile-names).

## Dashboard Shortcuts
<img src="docs/screenshots/shortcuts.png" alt="Dashboard Shortcuts on a web dashboard: Home ringed, with Energy, Security, Climate, Evening and Kitchen" width="358">

For [web dashboards](#web-dashboards) only: your other web dashboards as buttons, each with a round icon in the colour and icon you pick; a tap opens that dashboard. The one you're on is ringed, so the same widget can go on every dashboard as a menu.

**Settings:** up to eight dashboards, each with a colour and an icon; 1 or 2 columns; [colour style](#colour-style); [rename tiles](#tile-names).

## Days Since
<img src="docs/screenshots/dayssince.png" alt="Days Since on a Homey dashboard: a list of chores with a bar each, plants watered 6 days ago in amber with 1 day left, the vacuum filter 3 months in red and 2 days overdue, and the fish just fed with Undo" width="358">

Counters for things you do every so often, such as watering the plants or changing the vacuum filter, in a list on one card. Each bar fills up towards the day the counter is due, with the time left under it; it turns amber, then red, after the days you set, and then shows how long it's overdue (*+2 d*). Tap a row when it's done to start again from *Today* (with **Undo** for a few seconds). Counters are kept on Homey by name, so every widget and screen with the same counter shows the same one.

Flow cards: *Reset [counter]*, *Set [counter] to [days] days ago*, the trigger *[counter] became overdue* (even with no dashboard open) and the condition *[counter] is overdue*; the last two also take *Any counter*.

**Settings:** days only or days, weeks and months; all counters, or only those that are amber and red (or only red), so the ones far from due don't take up room; [colour style](#colour-style); up to eight counters, each with a name, an icon and the days until amber and red.

## Device Quick Actions
<img src="docs/screenshots/quickactions.png" alt="Device Quick Actions on a Homey dashboard" width="358">

Half-height tiles that run a device's quick action with one tap (on/off, lock, play/pause, a button), highlighted while it's on.

**Settings:** devices, active style, colour, [colour style](#colour-style), [rename tiles](#tile-names).

## Device Values
<img src="docs/screenshots/values.png" alt="Device Values on a Homey dashboard" width="358">

Half-height tiles that each show one live device value, optionally with a second value of the same device beside the name, such as a room's humidity next to its temperature. Percentages can fill their tile by level, and the Flow card **Set the tile colour of … to …** colours a tile, such as a fridge going red when it's too warm.

**Settings:** up to six values, each with an optional second value; 3 or 2 per row; compact or pill tiles (like Sensor Alarms'); percentage fill and its limits; [colour style](#colour-style); [rename tiles](#tile-names).

## Electricity Overview
<img src="docs/screenshots/electricity.png" alt="Electricity Overview on a Homey dashboard" width="358">

Live power use, the hourly price from yesterday to 12 hours ahead (with your tariffs and taxes from Homey Energy), the last 24 hours of usage and the cheapest hour ahead. Tap a chart to see its values. Works with a fixed price too, and shows solar export below zero.

**Settings:** power meter, live time span, prices, tariffs and taxes, usage history, smooth lines, lowest price in 12 h / 24 h, compact layout, [colour style](#colour-style).

<a name="price-badge"></a>

## Energy Price Strip
<img src="docs/screenshots/price.png" alt="Energy Price Strip on a Homey dashboard" width="358">

The electricity price now, and the coming 12, 24 or 36 hours as small bars in one tile: green, yellow or red by each hour's level in its day, with a dot over the cheapest. Uses the Electricity Overview's prices and needs no meter.

**Settings:** hours ahead, colour by level, [colour style](#colour-style), tariffs and taxes.

## Flow Buttons
<img src="docs/screenshots/flows.png" alt="Flow Buttons on a Homey dashboard" width="358">

Flows and Advanced Flows as rows with a round button in your colour and icon. Tap a row to start the flow. Needs an [API key](#api-key) with **Start Flows**. The Flow card **Set the button colour of … to …** colours the buttons that start a flow, such as green while an e-bike charges; **Default** gives them their own colour again.

**Settings:** up to eight flows, each with a colour, an icon and an optional name; 1 or 2 columns; [colour style](#colour-style).

## Insights Heatmap
<img src="docs/screenshots/heatmap.png" alt="Insights Heatmap on a Homey dashboard" width="358">

A week of one Insights value as a grid of days and hours: numbers such as light or temperature, or how much of each hour a sensor was on.

**Settings:** device and value, a title in place of the device's name, this week or the last 3–14 days, hours per column, colour, [colour style](#colour-style), scale, legend.

## Light Controls
<img src="docs/clips/lights.webp" alt="Light Controls on a Homey dashboard: a light turned on, dimmed with the bar, and given a colour and a white" width="358">

Six lights in the space of three of Homey's light cards. Tap a tile to switch it, drag or tap the bar to dim, and tap the colour button for colours and whites. Lights in a room can share one tile. With the *Room's Moods* palette, the colour button starts the room's Homey Moods instead (needs an [API key](#api-key) with **Set Moods**).

**Settings:** lights, group by room, widen the last tile, what the bar's far left does, colour palette, [colour style](#colour-style), [rename tiles](#tile-names).

## Lights by Room
For many lights in many rooms. The lights you pick are grouped by their Homey room, a card each with the room's icon, how many lights are on and how bright, a switch for the whole room and a bar that dims all of it. Tap a room's name to open it: its Homey Moods as a row of buttons, then a row per light that works as in Light Controls (tap to switch, tap or drag the bar to dim, the colour button for colours and whites). Rooms start closed; open as many as you like. Starting a Mood needs an [API key](#api-key) with **Set Moods**.

**Settings:** lights, show the room's Moods, colour palette, what the bar's far left does, [colour style](#colour-style).

## Locks and Doors
<img src="docs/screenshots/locks.png" alt="Locks and Doors on a Homey dashboard" width="358">

Locks, doors, windows and garage doors in one line: *All locked and closed*, or what isn't, on a red tile. Tap it for the list, with **Lock** and **Close** buttons. A lock that can pull the latch can also get an **Open** button (pick its capability, such as *open_lock* or *open*); tap it twice to open the door.

**Settings:** devices, one line or the full list, allow unlocking, the open door button, [colour style](#colour-style), time format, [rename tiles](#tile-names).

## Media
<img src="docs/clips/media.webp" alt="Media on a Homey dashboard: the volume turned up, the next track, mute, the TV as the source from behind ⋯, and a switch to another speaker" width="358">

One speaker as a card: album art, the track, play controls, mute, and a volume that moves on every tap but never overshoots or passes your maximum. TV and line-in show as such, not as old album art. Tap the name to switch speaker. Up to eight buttons behind ⋯ run the speaker's own actions (such as *Set source to TV*), its app's, or flows; they need an [API key](#api-key) (**Flows** for actions, **Start Flows** for flows). The large layout puts the album art across the whole widget; tap the art to switch layout (each screen remembers its choice).

**Settings:** layout (compact or large), tap the album art to switch layout, colour, [colour style](#colour-style), speaker, speaker switching, volume as a bar or buttons, volume step and maximum, progress, shuffle and repeat, eight buttons with an icon and a name.

## Notes
<img src="docs/screenshots/textline.png" alt="Notes on a Homey dashboard: a blue tile and a yellow Post-it note" width="358">

A short message on the dashboard: a tile with a line of text or more, or a tilted, handwritten Post-it note. Type it in the settings, show a Logic text variable, or let a Flow write it with *Write [text] on the note [name]* (optionally in a colour, such as red for *Dryer done*) and *Clear the note [name]*; every Notes widget with that name shows it at once. On the tile, long text is cut off, scrolls, or shows on as many lines as it needs, with the line breaks you type (the tile grows with it); the Post-it wraps it to three lines.

**Settings:** style (tile or Post-it), text from (the message typed in the settings, a Flow card or a text variable), message, note name, variable, alignment, text size, long text, icon, colour, [colour style](#colour-style).

## Pollen and UV
Today's pollen at the Homey's location, a row per type with a bar from low to very high, under the day's UV peak and when it comes. Pollen forecasts cover Europe only; elsewhere the widget says so and shows the UV. Out of season it says there's no pollen in the air.

A level is the day's average in grains per m³, by Astma-Allergi Danmark's bands with a very high band on top. The UV levels are the WHO's.

| From (grains per m³) | Low | Moderate | High | Very high |
|---|---|---|---|---|
| Birch, alder, olive | 1 | 30 | 101 | 1,001 |
| Grass, mugwort, ragweed | 1 | 10 | 51 | 251 |

**Settings:** compact or detailed (with the grains per m³ and the next three days), the UV index, the pollen types (alder, birch, olive, grass, mugwort, ragweed; birch, grass and mugwort by default), [colour style](#colour-style), time format.

Pollen and UV data from [Open-Meteo](https://open-meteo.com), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), generated using Copernicus Atmosphere Monitoring Service information.

## Popups
A Flow shows a message, or asks a question with **Yes** and **No**, in front of everything on the screens you choose: a web dashboard, or the phones and tablets showing a Homey dashboard with a Popups widget.

- *Show [text] on [screen] for [duration], picture: [picture], sound: [sound]*: closes after the time, or with a tap on that screen.
- *Ask [question] on [screen], picture: [picture], wait up to [seconds] seconds, sound: [sound]*: the first answer from any screen closes it everywhere and goes back to the Flow as the tags **Answer** (yes or no) and **Answered** (no when nobody answered in time), which only reach the next cards in an **Advanced Flow**. It waits at most 85 seconds, as Homey stops a Flow card after 90.
- *Close the popups on [screen]* closes them early; an open question then ends unanswered.
- **Picture:** a camera (refreshed while the popup is open) or a picture address. The cards *with an image* take an image tag instead, such as a doorbell's snapshot from its own Flow, taken when the Flow runs, or a text tag holding a picture address.
- **Sound:** a chime, a doorbell or an alert. Browsers only play sound on a page that has been tapped, so a wall tablet plays it once someone has used the web dashboard; on phones it may stay silent.

The screen is **Everywhere** or a Popups widget's name. On a [web dashboard](#web-dashboards), the popup covers the page in every browser showing a dashboard with a Popups widget of that name (Everywhere: every web dashboard). Homey's own dashboards don't let a widget draw over them, so there the Popups widget, blank itself, opens the popup in the Homey app's built-in browser; close that window when you're done. Put one at the bottom of each dashboard that should get popups, so it doesn't push other widgets down, with the same name on every screen that should get the same ones: *Hallway* on the phones' dashboard and on the hallway tablet's web dashboard reaches both at once.

**Settings:** screen name, countdown (a bar under a message running down to its end; off by default, as the Homey app's browser window doesn't close by itself).

## Room Health
<img src="docs/screenshots/roomhealth.png" alt="Room Health on a Homey dashboard: six rooms with their icons, the kitchen humid, the bedroom stuffy and the office's radon far over" width="358">

The indoor climate of the whole house on one card. The sensors you pick are grouped by their Homey room: each room shows its worst value large (else the temperature), its name, and a mark per value (an icon, or a bar), lined up in the same order in every room. A comfortable value is grey, or green with *Green when fine*; outside its range it turns yellow, then red the further out it is. Tap a room to step through its readings.

| Value | Comfortable by default | Red at |
|---|---|---|
| Temperature | 18–24 °C (18 °C is WHO's minimum) | 3 °C outside |
| Humidity | 30–60 % | 10 points outside |
| CO₂ | up to 1000 ppm | 1.5 × the limit |
| Radon | up to 100 Bq/m³ (WHO's reference level) | 1.5 × |
| PM2.5 | up to 15 μg/m³ (WHO's 24-hour guideline) | 1.5 × |
| PM10 | up to 45 μg/m³ (WHO's 24-hour guideline) | 1.5 × |
| VOC | up to 1000 ppb | 1.5 × |

A heat pump's room temperature counts; outdoor and water temperatures don't. Left out on purpose: carbon monoxide (a safety alarm: use [Sensor Alarms](#sensor-alarms)), air quality indexes and VOC in μg/m³ or as an index (their scales differ between devices), and PM1 (no guideline).

**Settings:** sensors, [rename tiles](#tile-names), [colour style](#colour-style), icons or bars, green when fine, the comfortable range of each value (one range for every room).

## Sensor Alarms
<img src="docs/screenshots/sensoralarms.png" alt="Sensor Alarms on a Homey dashboard" width="358">

Tiles that show *No alarm*, the alarm that's on or how many, and turn red while one is. Every alarm counts, including apps' own such as radon. Tap a tile for all of its alarms.

**Settings:** sensors, count motion and contact, [colour style](#colour-style), [rename tiles](#tile-names).

## Smart Stack
<img src="docs/clips/stack.webp" width="382" alt="A Smart Stack on a Homey dashboard: it turns through four widgets, is swiped by hand, and brings the cameras forward when someone is at the door">

Widgetkeeper widgets from another dashboard, one at a time in the space of one. It turns every 30 seconds, and swipes or the dots move it by hand. Smart rotate brings a widget forward while something happens on it: music plays, a timer runs, a camera sees someone, a door is open. A Flow card can bring one forward too. Needs an [API key](#api-key) with the **Homey** permission to read the dashboard.

**Settings:** dashboard, interval, smart rotate, pause after a swipe, dots.

## Spacer
Transparent empty space of the height you set, in pixels (16 at least), to line up widgets across a dashboard's columns. Homey keeps its usual gap above and below it.

**Settings:** height.

## Sparklines
<img src="docs/screenshots/sparklines.png" alt="Sparklines on a Homey dashboard" width="358">

Device Values' tiles with a small live chart of each value and its highest and lowest.

**Settings:** up to six values, time span (1 hour to 7 days, today or yesterday), 2 or 1 per row, [colour style](#colour-style), [rename tiles](#tile-names).

<a name="thermostat-shortcuts"></a>

## Thermostat Presets
<img src="docs/screenshots/thermostat.png" alt="Thermostat Presets on a Homey dashboard" width="358">

Three one-tap presets for a thermostat, heat pump or air conditioner, such as *Off*, *Heat 21°* and *Heat 24° · Fan level 5*. The matching preset lights up; a preset without a temperature shows the setpoint under the name. Tap the name for the controls: power, the temperature and every mode, fan or swing setting of the device.

**Settings:** the device, a title in place of its name, a value to show beside it (any device value, such as the room temperature), compact layout, [colour style](#colour-style), and per button: power, mode, temperature and one extra option such as the fan speed.

## Timers
<img src="docs/clips/timers.webp" alt="Timers on a Homey dashboard: a pizza timer started from its preset, given a minute more, paused and resumed, then run out in red and dismissed" width="358">

Up to four preset buttons, such as *Eggs · 7 min*. A started timer takes their place: tap to pause, **+1** for a minute more, **✕** to cancel. It beeps and turns red when done. The timer runs on Homey, so every screen sees it and the Flow card **A timer on the Timers widget finished** fires with no dashboard open.

**Settings:** colour, [colour style](#colour-style), four presets with minutes and an optional name, sound.

## Value Matrix
<img src="docs/screenshots/valuematrix.png" alt="Value Matrix on a Homey dashboard: six rooms by temperature, humidity, CO₂ and radon, the kitchen humid and the office's radon far over" width="358">

Any devices against any values, in one table. Pick the devices, then up to six values for the columns (temperature, humidity, CO₂, power, battery: any number a device has). The rows are the devices' Homey rooms, each cell the average of the room's devices, or the devices themselves with *Rows: Devices*. A cell is green (OK) inside the column's range, orange (Warning) outside it, and red (Alert) once it's past by half the range; it's striped where a row has no such value.

Type a column's OK range in the value's unit, such as `18–24`, `<1000` or `>10`, or `–` for none. Left empty, the values Room Health knows (temperature in °C, humidity, CO₂, radon, PM2.5, PM10, VOC in ppb) get [its ranges](#room-health), and other values none. The header is the unit (°C, %) or a short name, unless you type your own.

**Settings:** devices, [rename tiles](#tile-names), [colour style](#colour-style), rooms or devices as rows, show legend, and per column the value, its OK range and its header.

## Variable Presets
<img src="docs/screenshots/varpresets.png" alt="Variable Presets on a Homey dashboard" width="358">

One Logic variable with two to four buttons, each setting it to a value you pick, such as *Home*, *Away* and *Night* for a house mode, or two setpoints. It looks like Thermostat Presets: the button matching the variable lights up in your colour, and when none does, the name shows its value. A yes/no variable without buttons set gets Yes and No. Needs an [API key](#api-key) with **Variables** to change the variable.

**Settings:** the variable, a title instead of its name, an icon, compact layout, the button colour, [colour style](#colour-style), and per button: the value (Yes or No, a number or a text, as the variable is; pick the variable first) and a label.

<a name="flow-variables"></a>

## Variables
<img src="docs/screenshots/variables.png" alt="Variables on a Homey dashboard" width="358">

Logic variables as compact rows with their full name: a switch for yes/no, − and + for a number, and the text for a string. Tap a number or text to type a value. Needs an [API key](#api-key) with **Variables** to change them. Read only shows the values without anything to tap (a dot and Yes/No for yes/no), and needs no key.

**Settings:** up to ten variables, 1 or 2 columns, colour, [colour style](#colour-style), read only, the − and + step, the lowest and highest number, [rename tiles](#tile-names).

## Weather Forecast
<img src="docs/screenshots/weather.png" alt="Weather Forecast on a Homey dashboard" width="358">

The next 36 hours from [MET Norway](https://www.met.no/en) ([yr.no](https://www.yr.no)), hour by hour, with today's and tomorrow's high and low. Swipe sideways to see further ahead.

**Settings:** compact or detailed, one or two rows, 1–3 hours per column, colour style: Standard, Warm and cold (coloured temperatures) or [Vivid](#colour-style) (the card on a gradient for the current weather).

Weather data from MET Norway, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Icons: [Yr's weather symbols](https://github.com/metno/weathericons) (MIT).

## Web Page
A web page you pick, drawn at the width and height you set and scaled to fill the widget without borders: set them to a fixed-size gadget's size, and it fills the widget on a phone and a tablet alike. Links on the page never open, and unless you let the page be tapped, taps are ignored and a swipe scrolls the dashboard. Two to four buttons in a row under the page switch between their addresses (for a map, the same address with another zoom on each); the widget always opens on the first. `{lat}` and `{lon}` in an address become the Homey's location. Sites that don't allow being shown inside another page stay empty. You're responsible for following the terms of the site you show.

**Settings:** address, page width and height, let the page be tapped, reload every (15 minutes keeps live data current on a screen that's always on), up to four buttons (a name and an address).

## Web dashboards
<img src="docs/web/dashboard.png" alt="A web dashboard with Widgetkeeper widgets in a browser window, with Dashboard Shortcuts at the top as a menu" width="100%">

Your Widgetkeeper widgets in any browser at home, or [away from home](#away-from-home): a wall tablet, an old iPad, a computer or a TV. They're the same widgets, with the same settings and live updates as on a Homey dashboard, on dashboards you build on the page itself. The dashboards are kept on your Homey, so every browser shows the same ones.

### Getting started
1. Open **Apps → Widgetkeeper → Configure** in the Homey app and turn on **Web dashboards**.
2. Open the address shown there in a browser on your home network: `http://<your Homey's address>/app/com.thomassidor.widgetkeeper/settings/dashboard.html`.
3. Paste a Homey API key ([which permissions](#web-dashboards-key)), and the web dashboards password if you set one.

### Your dashboards
<img src="docs/web/front.png" alt="The web dashboards front page in a browser window: seven dashboards as cards, and the widgets you can add" width="100%">

The front page shows every dashboard as a card with a miniature of its widgets, then the widgets you can add. The pen at the top puts it in edit mode: drag the dashboards into order, duplicate one (with its tile names), delete one with a second tap, or hide the widgets. Its **Settings** has the [backup](#backup) and, for this browser only:

- **Keep screen on** while the page is open, for a wall tablet. Browsers only allow this over HTTPS, as on the [away from home](#away-from-home) address; elsewhere the page plays a silent video instead, which works on iPads and iPhones but not in every browser. Where it doesn't, turn off sleep in the device's own settings.
- **Dim**: darkens the whole page, up to 80 %, for a wall tablet at night.
- **Forget the key**.

### Building a dashboard
<img src="docs/web/editor.png" alt="A web dashboard being edited in a browser window" width="100%">

- **Columns and widgets:** one to six columns. Add widgets per column, move them by dragging their bar or with the arrows, and remove them with a second tap.
- **Column width:** Normal, Narrow (a phone's width, as on a Homey dashboard), Wide, or Fit to window, where the columns share the window's width.
- **Wide widgets:** drag the handle on a widget's right edge (or set **Width** in its settings) to make it span two or more columns, such as a large camera or chart. The columns it covers keep their own widgets above and below it: drag one above or under it. On a phone, where there's one column, it's as wide as the rest.
- **Settings:** the same as on a Homey dashboard, in cards: the devices, the general settings, and a folding card per button, tile or column that sums up what's set. Devices are picked from a list grouped by room, with a search.
- **Look:** light, dark or automatic, and a background per dashboard (Default, Black or White, Slate, Ocean, Forest, Plum, Berry, Sand), each with a light and a dark shade. The sun button in the bar switches between light and dark in this browser only.
- **Full screen:** the corner button gives the whole screen to the dashboard.
- **A menu:** put [Dashboard Shortcuts](#dashboard-shortcuts) on every dashboard to jump between them.
- **Popups:** Flows can show a message or ask Yes or No over a dashboard, in every browser showing it, with a camera's picture if you like. See [Popups](#popups).

<img src="docs/web/light.png" alt="A light web dashboard, the Kitchen on the Sand background, in a browser window" width="100%">

<img src="docs/web/settings.png" alt="A widget's settings on a web dashboard: Flow Buttons' settings in cards, the first button open" width="100%">

### Widgets from other apps
*Add widget* also lists your other apps' widgets under **Other apps**, with their own settings. They need **Homey** in the browser's key, as Homey only lists them with that. They run sealed off, so their code can't read the page or the browser's key. A widget that doesn't work that way can be trusted in its settings (*Trust this widget*); it then runs as on a Homey dashboard and could read the key.

Some widgets are made for the width they have on a Homey dashboard, and come out taller or shorter in a wider column. *Size as on Homey* in their settings lays them out at a phone's width and scales them to fill the column, so they look as on Homey.

### Away from home
Turn on **Remote access** under **Apps → Widgetkeeper → Configure** for a second address, `https://<your Homey's id>.connect.athom.com/app/com.thomassidor.widgetkeeper/settings/dashboard.html`, through Homey's cloud like the Homey app. A browser asks for the API key again there, as each address is its own site. Anyone with the address still needs a key, but a [password](#password) is worth setting too. Unlike the home address, this one is encrypted (HTTPS), so it's also the one to use at home on a network you don't fully trust (see [the key](#web-dashboards-key)).

### Password
On top of the API key, you can set a password under **Apps → Widgetkeeper → Configure**; every browser then asks for it once. Setting, changing or removing it signs every browser out, and repeated wrong passwords lock the sign-in for a while. Changing or removing it asks for the current one; if you forget it, the Flow card **Remove the web dashboards password** removes it.

### Backup
In the front page's **Settings**, **Download backup** saves the dashboards you tick in one file: the layouts, the widgets, their settings and tile names. **Restore backup** lists a file's dashboards; after a second tap, the ones you tick replace those they were saved from (or come back, if deleted), and the others stay as they are. Notes' texts and Days Since's counters aren't included, as Homey's own dashboards share them.

### Web dashboards' key
Each browser connects with a key of its own, kept in that browser:

- A key with the **Homey** permission works. A narrower one hasn't been tried, as Homey doesn't document which permission an app's own API takes.
- A widget that changes something needs that permission in the browser's key too, as in the [API key](#api-key) table, even though the app's key makes the change.
- Likewise, switching a light, a lock, a curtain, a thermostat or a speaker needs permission to control devices in the browser's key (`homey.device.control`, under **Devices**), though Widgetkeeper makes the change. Reading doesn't: the widgets read devices, cameras, Insights and variables with Widgetkeeper's own permissions, so a browser that may open the page sees everything the widgets show, whatever its key.
- The Smart Stack and [other apps' widgets](#widgets-from-other-apps) need **Homey**.
- The home address is plain HTTP, as the Homey serves it: the key (and the password's sign-in) goes unencrypted over your home network with every request, so anything that can watch that network could read it. On a network you don't fully trust, such as one guests share, use the [away from home](#away-from-home) address, which is encrypted, at home too. Give each browser its own key, so you can revoke a lost tablet's under **Settings → API Keys** without touching the others.

Turning web dashboards off keeps them on your Homey for when you turn them on again.

## Dashboard examples
**Home**
<img src="docs/showcase/home.png" alt="A home dashboard with Widgetkeeper widgets on a tablet" width="100%">

**Energy**
<img src="docs/showcase/energy.png" alt="An energy dashboard with Widgetkeeper widgets on a tablet" width="100%">

**Security**
<img src="docs/showcase/security.png" alt="A security dashboard with Widgetkeeper widgets on a tablet" width="100%">

**Climate**
<img src="docs/showcase/climate.png" alt="A climate dashboard with Widgetkeeper widgets on a tablet" width="100%">

**Evening**
<img src="docs/showcase/evening.png" alt="An evening dashboard with Widgetkeeper widgets on a tablet" width="100%">

**Garden** (light mode)
<img src="docs/showcase/garden.png" alt="A garden dashboard with Widgetkeeper widgets on a tablet, in Homey's light mode" width="100%">

**Kitchen**
<img src="docs/showcase/kitchen.png" alt="A kitchen dashboard with Widgetkeeper widgets on a tablet" width="100%">

## Colour style
Every widget with a coloured state has a **Colour style** setting: *Muted* is the calmer look, *Vivid* the stronger one, and a colour you pick in the widget follows it.

- Where a colour tints a tile (a Quick Actions tile that's on, a Sensor Alarms alarm, a coloured note, Value Matrix's cells …), Vivid fills the tile with Homey's darker shade, with white text. The charts get a stronger area under their lines.
- Where the colour is already a small solid part (a lit preset button, Insights Heatmap's cells, Media's play button, Activity Dots' dots), Muted uses the darker shade and Vivid the bright colour.
- Days Since and Room Health are toned down in Muted and in full colour in Vivid. Weather Forecast's *Vivid* puts the card on a gradient for the current weather.

## Tile names
<img src="docs/clips/rename.webp" alt="Rename tiles: the setting turned on, names typed on two Light Controls tiles, and the setting turned off again with the names kept" width="358">

Give any tile a name of your own, such as *Sofa corner* for a room's lights, instead of the device's or room's name. Light Controls, Curtains, Device Quick Actions, Sensor Alarms, Room Health, Value Matrix, Device Values, Sparklines, Locks and Doors, Cameras, Variables and (on web dashboards) Dashboard Shortcuts have it.

1. Edit the dashboard, edit the widget, turn on **Rename tiles** (the first setting) and save the widget.
2. Leave the dashboard's edit mode. Each tile now shows a text field: type its name, or leave it empty for the device's (or room's) own.
3. Edit the widget again and turn **Rename tiles** off.

The names belong to that widget: they stay with the right tiles when you rename or reorder devices, and every screen and Smart Stack showing the widget gets them.

## API key
Homey doesn't let apps change variables, start flows, read dashboards or start Moods on their own. For those, create a key in the Homey web app under **Settings → API Keys**, tick the permissions below for the widgets you use, and paste it under **Apps → Widgetkeeper → Configure**. The key stays on your Homey, and that page says what it may do once it's saved.

| What | Permission to tick | Scope |
|---|---|---|
| Variables and Variable Presets: changing a value | **Variables** (View Variables isn't enough) | `homey.logic` |
| Flow Buttons | **Start Flows** | `homey.flow.start` |
| Media's buttons: a flow | **Start Flows** | `homey.flow.start` |
| Media's buttons: the speaker's own actions, such as *Set source to TV*, and its app's | **Flows** (Start Flows isn't enough) | `homey.flow` |
| Light Controls' Room's Moods: starting a Mood | **Set Moods** | `homey.mood.set` |
| Lights by Room: starting a Mood | **Set Moods** | `homey.mood.set` |
| Smart Stack: reading the dashboard | **Homey** (it allows everything, but there's no permission for dashboards alone) | `homey` |

Ticking a group's first box (**Flows**, **Moods**, **Homey**) includes the boxes under it. Everything else needs no key: the widgets read devices, Insights, variables, flows and Moods with Widgetkeeper's own permissions.

## Languages
English, Dutch, German, French, Italian, Swedish, Norwegian, Spanish, Danish, Russian, Polish, Korean and Arabic, following Homey's language.

## Installation
Install Widgetkeeper from the [Homey App Store](https://homey.app/a/com.thomassidor.widgetkeeper/). The [test version](https://homey.app/a/com.thomassidor.widgetkeeper/test/) has the next version's widgets before they go live. To install it from source with the Homey CLI, see [CONTRIBUTING.md](CONTRIBUTING.md).

## Troubleshooting
If a widget doesn't work as expected, open **Apps → Widgetkeeper → Configure** in the Homey app: its **Diagnostics** report has a device's full details once you pick it, and no passwords, API keys or camera addresses. Include it when you [open an issue](https://github.com/thomassidor/widgetkeeper/issues).

## Changelog
See [CHANGELOG.md](CHANGELOG.md).

## License
[MIT](LICENSE)
