# Changelog

All notable changes to Widgetkeeper. The version numbers match the Homey app version.

## 0.9.0

### New: Smart Stack
- Widgetkeeper widgets from another dashboard, one at a time in the space of one, like a Smart Stack on a phone. Set up a dashboard with the widgets to rotate, then pick it in the stack.
- It turns to the next widget every 30 seconds (or 10 s to 5 min, or never). Swipe or tap the dots to move by hand; it then holds still for a minute.
- Smart rotate brings a widget forward while something happens on it: the speaker plays, a timer runs, a camera sees someone, a sensor alarm goes off, or a door is open or unlocked.
- New Flow cards: *Bring a widget forward on Smart Stacks for … minutes* and *Return Smart Stacks to rotation*.
- The dots can sit below or above the widget, small or large.
- Needs a Homey API key in the app settings that may read dashboards.

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
