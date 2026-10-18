# Changelog

All notable changes to Widgetkeeper. The version numbers match the Homey app version.

## 1.0.0

### New names
- Four widgets have clearer names: Price Badge is now **Energy Price Strip**, Thermostat Shortcuts is now **Thermostat Presets**, Sensor Dots is now **Activity Dots**, and Flow Variables is now **Variables**. Widgets already on a dashboard keep working and keep their settings.

### New: Variable Presets
- One Logic variable with two to four buttons, each setting it to a value you pick: *Home*, *Away* and *Night* for a house mode, two setpoints, or Yes and No. It looks like Thermostat Presets: the button whose value the variable has lights up, and when none does, the header says what it is now.
- Pick the variable first: each button's value then offers Yes and No, or takes the number or text you type. A label can replace the value on the button. The lit button takes the colour you pick (blue by default), and the header can have a title and an icon of its own.
- Changing the variable needs an API key with the Variables permission, as Variables does.

### New: Notes
- A short message on the dashboard: one line of text on a tile, or a Post-it note stuck on the dashboard, tilted with a folded corner, in handwriting (up to three lines). A user asked for a single text line for small messages.
- Type the message in the widget's settings, or let a Flow write it: *Write [text] on the note [name]* (also in a colour) and *Clear the note [name]*. Every Notes widget with that name shows it at once, on every screen. It can show a Logic text variable instead.
- Settings for the alignment, the text size, an icon and the colour; long text on the tile is cut off or scrolls.

### New: Spacer
- An empty widget of the height you set in pixels, to line up widgets across a dashboard's columns at the top or the bottom. It's transparent in light and dark mode, and can go on web dashboards too.

### New: Charts
- One chart, two stacked, or two values on one chart with a scale each, of any value that Homey logs in Insights, drawn like Electricity Overview's charts: a line with an area, a line, or bars, over 1 hour to 7 days, in the colour you pick.
- The value now sits at the top in the chart's colour (this can be turned off). Tap a chart to see the value at that moment.
- The scale fits the values (so a room's 19–23 °C doesn't look flat) or starts at zero. Below zero can be drawn in yellow, as Electricity Overview draws solar export.

### New: Days Since
- Counters for the things you do every so often: the plants watered *6 days* ago, the vacuum filter changed *3 months* ago, the sheets *2 weeks*. Up to eight per widget, each with a name and an icon.
- A list on one card: each counter's bar fills up towards the day it's due, with the days or weeks left under the time. It turns amber, then red, the number of days you set after it was last done, and then says how long it's overdue. Tap a row when it's done: it starts again from *Today*, with Undo for a few seconds.
- The counters are kept on Homey by name: every widget and screen with the same counter shows the same one.
- Flow cards: *Reset [counter]*, *Set [counter] to [days] days ago*, the trigger *[counter] became overdue* (even with no dashboard open) and the condition *[counter] is overdue*, both also for any counter.

### New: Room Health
- The indoor climate of the whole house on one card: pick your temperature, humidity, CO₂, radon, PM2.5, PM10 and VOC sensors, and each Homey room shows its worst value large, its name and an icon or a bar per value, lined up from room to room: grey (or green, if you like) while it's comfortable, yellow to red the further it's outside.
- Tap a room to step through its other readings.
- The comfortable ranges are settings, with defaults from the WHO's guidelines where there are any (18–24 °C, 30–60 % humidity, CO₂ up to 1000 ppm, radon up to 100 Bq/m³ …). A room with only some of the sensors uses what it has.

### New: Value Matrix
- Any devices against any values in one table: pick the devices and up to six values (temperature, humidity, CO₂, power, battery: any number), and each room (or each device) gets a row with a cell per value. A cell is green (OK) inside the value's range, orange (Warning) outside it and red (Alert) far outside, and striped where a room doesn't have that value. A legend explains the colours.
- Type each column's range as `18–24`, `<1000` or `>10`. Left empty, temperature, humidity, CO₂, radon, PM2.5, PM10 and VOC use Room Health's usual ranges.

### Name the tiles
- Every widget with device tiles has a new setting, *Rename tiles*: turn it on, and each tile shows a text field. Type the name you want, or leave it empty to keep the device's (or room's) own name, then turn the setting off again. Light Controls, Curtains, Device Quick Actions, Sensor Alarms, Room Health, Value Matrix, Device Values, Sparklines, Locks and Doors, Cameras and Variables have it.
- Light Controls and Curtains grouped by room get a name per room tile, so two widgets with a "Living room" group can be called "Sofa lights" and "Living room". Users with several groups in one room asked for it.
- The names belong to the widget: they stay with the right tiles when devices are renamed or reordered, and every screen showing the dashboard (and a Smart Stack page of it) gets them. Sensor Alarms' *Tile names* setting and Device Values' *Name* settings are gone: type those names on the tiles again.

### Colour style
- Every widget with a coloured state has a new setting, *Colour style*: *Muted* is the calmer look and *Vivid* the stronger one. Where a colour is mixed softly into a tile, such as a tile that's on, an alarm or a coloured note, Vivid fills it with Homey's darker shade of the colour, with white text. Lights take a darker shade of their own colour, the charts get a stronger area under their lines, and Weather Forecast has *Vivid* as a theme of its own *Colour style* setting (until now called *Colours*).
- In Device Values, Vivid fills percentage fills and the colours a Flow sets. A user found the default yellow looked like mustard and the orange looked brown.
- Thermostat Presets, Variable Presets, Insights Heatmap, Media and Activity Dots now use Homey's darker shade of their colour by default: the lit button, the heatmap's cells, the play button and the dots are calmer. *Vivid* shows them in the full, bright colour as before, and the heatmap's levels further apart.
- Days Since shows how close a counter is only on its bar by default, in a softer colour, and Room Health's icons and bars are softer too. Vivid shows both in full colour, and puts an overdue Days Since row on a solid block.
- Device Quick Actions, Variables, Curtains, Media and Timers have a new *Colour* setting for what was always blue: a tile that's on, a switch that's on, an open curtain, the play button and what's on, and a running timer.

### Curtains
- Blinds that are fully open at 50%, with 0% and 100% both closed: vertical slatted blinds, and blinds that only tilt, such as SwitchBot Blind Tilt (these can now be picked too). A tap opens them to 50% or closes them to the nearer end, and the slider sets how far they're open. The new setting *Blinds are fully open at* chooses: 100%, 50% only for blinds that only tilt (the default), or 50% for all.
- The tiles are as tall as Light Controls' again (they were 2 pixels taller), so the two line up side by side.

### Electricity Overview and Energy Price Strip
- 15-minute electricity prices, where Homey Energy has them: the price now is the current quarter's (it was the hour's average), the price chart steps every 15 minutes, and the lowest price is the cheapest quarter. The Energy Price Strip shows a bar per quarter. Markets with hourly prices look as before.
- Electricity Overview: a power meter that's deleted while the widget is open now shows as unavailable, instead of a line that stopped moving.

### Activity Dots and Sensor Alarms
- Presence sensors (such as the Aqara FP300) can be picked in Activity Dots: the dot lights up while someone is there, even sitting still, and the overlay says *Presence* or *No presence*. Sensor Alarms counts presence with motion and contact when *Count motion and contact as alarms* is on.
- Vibration sensors (such as the Aqara Vibration Sensor) can be picked in Activity Dots: the dot lights up while vibration is detected, and the overlay says *Vibration* or *No vibration*. A user asked for it, to see all the security sensors in one place. Sensor Alarms still counts vibration as an alarm.

### Sparklines and Device Values
- Every battery tile shows the same battery icon. Some devices brought their own, so tiles side by side looked different.
- Device Values has a new setting, *Tile style*. *Pill* tiles look like Sensor Alarms' tiles, the icon beside the device name with the value under it. *Compact* is the default and looks as before.
- Device Values: a tile can show a second value of the same device, such as a room's humidity next to its temperature. Pick it under each tile with the new *– Second value* setting: it's shown small at the end of the name's row (in pill tiles, after the value), and the tile's colour still follows the first value.

### Light Controls
- A new colour palette, *Room's Moods*: the colour button shows the Homey Moods of the light's room (or of the room's tile, grouped by room) in place of the colours and whites, and a tap starts one. A room without Moods keeps the colours. Starting a Mood needs an API key that may start Moods. A user asked for it.
- A tile whose lights shine in different colours shows them all: the tile, the brightness bar and the colour button blend up to four colours. This covers Homey's own light groups (which showed the last colour set on the group, not what their lights show, for example after a Mood) and lights grouped by room.

### Cameras
- Live view tries the camera's other streams when one won't play, such as a 4K H.265 stream, which Homey can't stream to a dashboard: a Reolink camera's sub stream then plays instead. A user's camera showed only *Live view failed*.
- When every stream of a camera is H.265, the tile says so, and suggests setting the camera to H.264. A Reolink camera on a Home Hub or an NVR has only one stream.
- Live view can stay on longer: the new setting *Live view stays on* picks 30 seconds, 1 minute, 5 minutes (as before) or *Until tapped*. Until tapped, live view also comes back when the screen wakes or the dashboard opens again. A user asked for it.
- A new *Layout* setting: with an odd number of cameras, the large one can go on top instead of at the bottom, or every camera can fill the width. A user asked for one large camera with two small ones under it.

### Media
- A large layout: the album art across the whole widget, with the track, the artist and the buttons below it in bigger text and sizes. A user asked for it to read the widget more easily. Pick it with the new *Layout* setting; the compact card stays the default.
- The buttons can also run the speaker app's own actions, such as Sonos (LocalAPI)'s *Scan the music library*, besides the speaker's actions and flows. A user asked for it. Only actions without settings of their own can be picked.

### Variables
- Set a lowest and highest number for the number variables: − and + stop there, and a typed number is kept within them. A user asked for 0 to 1 in steps of 0.05, for a percentage kept in a variable.
- Read only: the rows show each variable's name and value, with a dot and Yes/No instead of a switch, and nothing to tap. No API key is needed. A user wanted the rows for information only.
- Rows are named like every other widget's tiles, with *Rename tiles*, in place of a name setting per variable. Names given in those settings have to be typed on the rows again on Homey's dashboards, because the Homey app no longer hands them to the widget. Web dashboards keep them, and so does a Variables widget shown on a Smart Stack.

### Thermostat Presets
- In the settings, each button's mode, temperature and fan setting are indented under its power setting, so it's clear which button they belong to.

### Weather Forecast
- Fewer colour themes, each clearly different: *Weather background* is now called *Vivid*, and the theme that was called *Vivid* is now *Warm and cold*. *Tinted by temperature* and *Tinted by sky* are gone; a widget that used one now shows *Warm and cold* or *Vivid*.

### Locks and Doors
- An **Open** button for locks that can pull the latch: pick the capability that does it in the new setting *Open door button* (Homey has no standard one: Matter locks have *open_lock*, the Shelly Loqed app *open*). Each lock with it gets the button while *Allow unlocking and opening* is on. Tap it twice to open the door, so a stray tap can't. Users on the Homey Community asked for it.

### Web dashboards
- A widget's settings are easier to get an overview of. They were one long list of equal rows (Flow Buttons had 33). Now the dialog shows the widget's preview and what it does on top, then cards: the devices, the title with the general settings, and a card for each button, tile or column. A user found the old list impossible to get an overview of.
- Numbered groups such as Flow Buttons' eight buttons fold, and each one's header sums up what's set: the flow, the colour and the icon. Settings that only matter while a switch is on fade while it's off.
- Each setting has a control that fits it: a switch, colour swatches, segments for a short choice, a number with its unit, or a list.
- Widgets from your other apps can go on web dashboards too: *Add widget* lists them under **Other apps**, with their own settings. They need a browser key with the **Homey** permission. They run sealed off from the page, so they can't read the browser's key; *Trust this widget* runs one that doesn't work that way as it would on a Homey dashboard.

### Other fixes
- Variables, Variable Presets, Flow Buttons, Media's buttons, Moods and the Smart Stack no longer say the API key wasn't accepted when Homey was only busy, and a good key saved at such a moment is no longer refused.

## 0.9.0

### New: Clock
- The time and the date in one tile, with the weather now (MET's icon and the temperature) and today's high and low. The weather is the Weather Forecast's, from MET Norway; turn it off with *Show the weather*.
- The time follows the phone or tablet's own setting (24 or 12 hours), the date Homey's language.

### New: Web dashboards
- Widgetkeeper widgets in any browser on your home network (a wall tablet, a computer, a TV), with the same settings and live updates as on a Homey dashboard. The address is in the app settings.
- Build the dashboards on the page itself: columns of widgets, moved and set up in place, in light, dark or automatic. Drag a widget by its bar to move it. They're kept on your Homey.
- Off until you turn them on in the app settings.
- The front page shows your dashboards as cards with a miniature of their widgets, and a card that steps through every widget with a short description.
- Choosing devices: a large picker with the devices grouped by room, room filters, search and Select all per room; the chosen devices are listed in order and can be dragged into a new order.
- The page asks for a Homey API key, which stays in that browser.
- Optionally also a password, set in the app settings, which every browser must enter after its key.

### New: Smart Stack
- Widgetkeeper widgets from another dashboard, one at a time in the space of one, like a Smart Stack on a phone. Set up a dashboard with the widgets to rotate, then pick it in the stack.
- It turns to the next widget every 30 seconds (or 10 s to 5 min, or never). Swipe or tap the dots to move by hand; it then holds still for a minute.
- Smart rotate brings a widget forward while something happens on it: the speaker plays, a timer runs, a camera sees someone, a sensor alarm goes off, or a door is open or unlocked.
- New Flow cards: *Bring a widget forward on Smart Stacks for … minutes* and *Return Smart Stacks to rotation*.
- The dots can sit below or above the widget, small or large.
- Needs a Homey API key in the app settings that may read dashboards.

### Price Badge
- A new look: the price now with its level, and the coming hours as small bars in their colours, with a dot over the cheapest. New setting, *Hours ahead*: 12, 24 or 36. Hours without a price yet stay empty.
- The *Show the next hour* and *Lowest price* settings are gone: the bars show both.

### Electricity prices
- Electricity Overview and Price Badge: dynamic prices now include the tariffs and taxes set up in Homey Energy, so they match Homey's own Energy tab. New setting, *Include tariffs and taxes* (on by default); turn it off to see the spot price.

### New: Curtains
- Curtains and blinds as tiles, two per row. Tap a tile to open or close it, the way curtains used to work in Homey. A label in the corner always says which it will do (**Open** or **Close**), so a half-open curtain never leaves you guessing.
- Tap while it moves to send it back the other way. The slider sets any position in between.
- The tile shows *Open*, *Closed*, *42% open* or *Opening…*, and while it moves, a mark shows where it's heading. Its icon opens and closes with the curtain.
- A half-open curtain goes to the nearer end, or, with a setting, the opposite way of its last move, like a one-button remote.
- New setting, *Position 100% means closed*, for curtains that count the other way round from Homey's standard (such as some SwitchBot curtains).
- Optional grouping by room: one tile moves all of a room's curtains.
- The line under the name can be hidden for lower tiles.

### New: Media
- One speaker as a card: album art, the track and artist, a progress line, previous, play and next, and mute.
- The volume moves at once on every tap, and a maximum volume setting stops it going too loud.
- Choose the volume as a slider on its own line, or as − and + buttons next to play.
- When the speaker plays from the TV or line-in, the card says so instead of showing old album art.
- Up to four buttons for the speaker's own actions, such as *Set source to TV*, or any flow. They sit behind **⋯**. Running a speaker action needs a Homey API key with permission to manage flows.
- Tap the speaker's name to switch to another speaker. Each screen remembers its choice; the speaker in the settings stays the default.
- Shuffle and repeat, and the progress line, are settings.
- Each button can have an icon.

### Tile names
- Device Values, Flow Variables and Flow Buttons: give each tile, row or button its own name with the new *– Name* setting under it.
- Sensor Alarms: a *Tile names* setting, one per line. Write `Device name = Tile name`, or just a name for the device in that position.

### Electricity Overview
- New setting, *Layout*: *Compact* makes the card about a quarter lower.

### Thermostat Shortcuts
- New setting, *Layout*: *Compact* puts the name and the current state on one line and makes the buttons one line high.

### Sparklines
- New spans: 2, 3 and 5 days.
- Power sparklines now show their history straight away, instead of starting empty each time the dashboard opens.

### Locks and Doors
- A calmer list: each device's state is green when it's secure and red when it isn't, and every button is the same grey.
- **Lock all** sits in the top line while the list is open.
- A lock that hasn't reported yet is never shown as locked.

### Cameras
- Cameras without snapshots, only a video stream (such as Aqara cameras), now show a still taken from the video, refreshed every minute or so.

### Flow Buttons
- 44 icons, each shown with a picture in the settings.

### Price Badge
- Every price shows its unit, and a lightning bolt in the price level's colour.
- A failed price read now shows an error, instead of saying there are no prices.

### Other fixes
- Device Values: a percentage fill and a Flow colour now use the same tint.
- Light Controls: picking a colour for a light that's off turns it on in that colour (a Hue light used to come on in its old colour).
- Timers: a quick tap on a timer that is just starting is no longer lost, and a failed change puts the timer back as it was.
- Flow Variables: a value you just changed is no longer overwritten by an older one.
- Numbered settings (*Tile 4*, *Button 2*) show their number on iOS.
- A short swipe across a tile or button no longer counts as a tap.

## 0.8.0

### New: Price Badge
- The electricity price now, the next hour's (with an arrow up or down) and the cheapest hour ahead, in one compact tile.
- The tile is green, yellow or red by where the price now sits among today's prices; this can be turned off.
- Pick whether to show the next hour, and the cheapest hour in the next 12 or 24 hours (or neither).
- Uses the Electricity Overview's prices from Homey Energy, and needs no meter. With a fixed price it shows that price.

### New: Timers
- Up to four preset buttons, each with its minutes and an optional name, such as *Eggs · 7 min*. Tap one to start the timer.
- The running timer takes the buttons' place, so the widget always takes the same space. It shows its time left and when it ends, filling down as it runs. Tap it to pause or resume, **+1** adds a minute, **✕** cancels and brings the buttons back.
- When it runs out it turns red and the screen beeps for a minute (can be turned off); tap it to dismiss.
- The timer runs on your Homey: every screen showing the dashboard sees the same one, and it keeps going when the app restarts.
- New Flow card **A timer finished**, with the timer's name and minutes, so Homey can announce it or flash a light.

### New: Locks and Doors
- Locks, door and window contacts and garage doors in one line: *All locked and closed*, or what isn't, on a red tile.
- Tap it for every device and its state, with **Lock** or **Close** for one that isn't secure, and **Lock all** for several.
- Unlocking and opening from the dashboard is off unless you allow it in the settings.
- Can also show the list all the time.

### New: Flow Variables
- Set Homey's flow variables from the dashboard: compact rows that show the full name, instead of big tiles that cut it off.
- A yes/no variable gets a switch; tap anywhere on its row to flip it.
- A number gets − and + buttons (the step is a setting, 1 by default); tap the number to type an exact value. A text variable shows its text; tap it to type a new one.
- Pick up to ten variables, in the order you like, and show them **1** (the default) or **2** per line.
- Changes made by flows show up the moment they happen.
- Homey doesn't let apps change variables on their own, so changing them needs a Homey API key: create one under *Settings → API Keys* in the Homey web app with permission to change variables, and paste it in Widgetkeeper's app settings. Without a key the widget shows the variables, and a tap says how to add one.

### New: Sensor Dots
- Many motion and contact sensors at a glance: each one is a dot, grey while quiet and blue while active, as many per row as fit.
- Pick the colours for quiet and active: grey, blue, red, orange, yellow, green or purple.
- An optional title shows at the top of the tile.
- Camera detections (person, vehicle, pet) count too.
- Tap a dot to see its name, what's active and since when (*Garage · Open since 18:17*) on a line over its row; tap the line to close it.

### New: Flow Buttons
- Start flows and Advanced Flows from the dashboard: compact rows the size of Flow Variables', each a round button with the flow's name beside it.
- Pick up to eight flows, each with its own colour (blue, red, orange, yellow, green, purple or grey) and icon (21 to choose from), in **1** (the default) or **2** columns.
- Tap anywhere on a row: the button spins while the flow starts, then shows a check mark. A flow that's turned off is dimmed, and a tap says so.
- Like changing variables, starting flows needs a Homey API key with permission to start flows. The app settings now have one *API key* section for both widgets, and say what a saved key may do.

### Electricity Overview
- Supports a fixed electricity price set in Homey Energy: the price shows in the header, and usage gets its own chart instead of the price chart.
- Solar export: power below zero is drawn below the zero line in yellow, and the header says *Exporting now*.
- New setting, *Show electricity prices*: turn it off to leave out the price, the price chart and the lowest price, for a card with only power and usage.
- A brief connection problem no longer hides the charts.
- The usage history comes back by itself when Homey's Insights were briefly unavailable as the widget opened.

### Device Values
- A Flow can colour the tiles: the new action card *Set the tile colour of … to …* makes every tile showing that value red, orange, yellow, green, blue or purple, and *Default* resets it. For example, a fridge thermometer blue while it's cold and red when it's too warm.

### Insights Heatmap
- New setting, *Colour*: blue (the default), red, orange, yellow, green or purple.

### Light Controls
- New setting, *Brightness bar at the far left*: stop the bar at 1 % so the light stays on, instead of turning it off.
- Plugs and wall switches set up as lights can now be picked too. They only turn on and off, so their tiles have no brightness bar.

### Thermostat Shortcuts
- A preset now always sets its temperature, also on aircons that keep a temperature per mode (switching mode used to bring back the mode's own temperature).
- A renamed or deleted thermostat now shows without reopening the dashboard.
- A brief connection problem no longer hides the buttons; the error shows for a moment instead.

### All widgets
- Clearer setting names, in a more logical order, with help texts.

## 0.7.0

### New: Device Values
- Compact tiles in the style of Device Quick Actions, each showing one value of a device: its icon and the value on top, the device name below. Values update the moment they change.
- Pick up to six values, each from a list of every device's values (*Living room · Temperature*). The same device can fill several tiles.
- Show the tiles in **3** (the default) or **2** columns.
- New setting, *Fill percentages by level*: a percentage (battery, humidity, dim level …) fills its tile from the left, red below 10 %, yellow below 20 % and green otherwise. Both limits can be changed.
- An on/off value is highlighted in blue while it's on.

### New: Light Controls
- Compact light tiles, two per row, so six lights fit in the space of three of Homey's own light cards.
- Tap a tile to turn the light on or off. Drag the bar to set the brightness, or tap it where you want it; all the way to the left turns the light off.
- Lights with a colour temperature have a thermometer: tap it and the bar sets the colour temperature, from cool to warm.
- A lit tile takes on the light's colour.

### Sensor Alarms
- Tap a tile to see every alarm of the sensor, active or not. Tap it again to close the list.

### New: Sparklines
- Device Values' tiles with a small chart of each value's recent history, and its highest and lowest value at the chart's right edge.
- Pick a **Time span**: 1 hour, 6 hours, 24 hours (the default) or 7 days. The chart comes from Homey's Insights and keeps moving with the live value.
- Pick up to six values; every number Homey logs in Insights is listed. Show the tiles in **2** (the default) or **1** column.

### Device Values and Sparklines
- Each tile's list starts with **None**, to remove a tile again.

## 0.6.1

### Electricity Overview
- New setting: **Usage history colour**. Show the usage history in Homey's purple instead of the neutral colour.
- The separate usage chart's line is now as thick as the live power line, with a full-colour dot.

### Weather Forecast
- New setting: **Colours**. Besides the standard look: **Vivid**, **Tinted by temperature**, **Tinted by sky** and **Weather background**.

## 0.6.0

### New: Cameras
- Your cameras in one grid of snapshots, two per row, each with its name. With an odd number, the last one spans the full width.
- The snapshots refresh every 5, 10 (the default), 30 or 60 seconds while the dashboard is open. A snapshot that stops refreshing shows the time it was taken.
- Tap a camera to watch it live over the whole widget, through Homey's own live view. Tap again, or wait 5 minutes, to go back to the snapshot. Live view also ends when the camera stops sending video.

## 0.5.0

### New: Insights Heatmap
- A week of one value as a grid: a row per weekday, a column per 1, 2 or 3 hours, shaded from the lowest to the highest value shown, like Homey's own heatmaps. Hours with nothing reported are hatched.
- Works with any number Homey logs in Insights (light, temperature, power, CO₂ …) and with on/off values such as motion or a door contact, shown as the share of each hour they were on.
- Shows *this week* (Monday to Sunday) or the last 3, 7, 10 or 14 days, with a scale from the lowest to the highest value and a marker at the current one. The scale and the legend can each be switched off.
- On/off history fills in over the first days, as Homey's Insights keep only their last 50 changes.

## 0.4.1

### Electricity Overview
- New setting, *Smooth chart lines*: the live power and usage lines are drawn as smooth curves that show the trend rather than every flicker, and the price steps get rounded corners. Off by default.

## 0.4.0

### New: Sensor Alarms
- Tiles for as many sensors as you like, two per row, in the style of Homey's own temperature tiles: the device icon, its name and its alarm.
- Each tile shows the alarm that's on (such as *CO₂ Alarm* or *Smoke alarm*), the number of alarms when there are several, or *No alarm*. The tile turns red while an alarm is on.
- Every alarm a device has counts, including those added by apps, such as an air quality monitor's radon or VOC alarm. Motion, contact (an open door) and camera detections only count when you switch that on in the widget settings.
- The tiles update the moment an alarm goes on or off.

### Device Quick Actions
- A renamed device, a changed quick action or a deleted device now shows on the next refresh (every 5 minutes).
- When a refresh fails, the tiles stay and the error shows briefly underneath.

## 0.3.0

### New: Weather Forecast
- The next 36 hours for your Homey's location, from MET Norway (the forecast behind yr.no).
- Each hour shows the weather icon, temperature, precipitation and wind, with the wind's direction. Swipe sideways to see further ahead.
- Underneath: the highest and lowest temperature for the rest of today and for tomorrow.
- Show every hour, or every 2 or 3 hours with the hours averaged (precipitation is the total).
- Compact columns (the default) fit 9 hours across a phone, or 18 with two rows. Detailed columns are larger, with units on every value.
- Temperatures go from blue when it's cold, through plain text when it's mild, to red when it's hot.

## 0.2.0

### New: Device Quick Actions
- Half-height device tiles for as many devices as you like, three per row.
- Tap a tile to run the device's quick action, the same action as the round button on Homey's own device tile: on/off, lock/unlock, play/pause or a button press. It follows the quick action you picked in the device's settings.
- The whole tile shows the state. Pick the style in the widget settings: a blue tint (the default) or a lighter tile.
- The tiles use the same icons and text size as Homey's own device tiles, including icons you picked for a device.

### Thermostat Shortcuts
- The device icon is now the one Homey shows, including an icon you picked for the device.

### Diagnostics
- The device list on **Apps → Widgetkeeper → Configure** now includes every device, with its quick action.

## 0.1.1

### Both widgets
- Renamed to **Electricity Overview** and **Thermostat Shortcuts**.
- Available in 13 languages: English, Dutch, German, French, Italian, Swedish, Norwegian, Spanish, Danish, Russian, Polish, Korean and Arabic. The diagnostics page is translated too.
- Text sizes, weights, lines, corners and the font now follow Homey's widget styling.

### Thermostat Shortcuts
- More compact buttons, with smaller temperature, mode and fan text.
- In dark mode, the widget has the same frame as Homey's device tiles.

### Electricity Overview
- When the lowest price in the next 12 hours and in the next 24 hours is the same hour, it's shown only once.
- Smaller chart titles and footer text.
- The separate usage chart has a marker at the latest reading, like the live and price charts.
- Tap a chart to see its values; they stay for 3 seconds. Dragging on a chart no longer scrolls the dashboard (except on Android, where Homey's dashboard takes over drags).

## 0.1.0
- First release, with the Electricity and Thermostat shortcuts widgets.
