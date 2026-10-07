# Changelog

All notable changes to Widgetkeeper. The version numbers match the Homey app version.

## 0.8.0

### New: Flow Variables
- Set Homey's flow variables from the dashboard: compact rows that show the full name, instead of big tiles that cut it off.
- A yes/no variable gets a switch; tap anywhere on its row to flip it.
- A number gets − and + buttons (the step is a setting, 1 by default); tap the number to type an exact value. A text variable shows its text; tap it to type a new one.
- Pick up to ten variables, in the order you like, and show them **1** (the default) or **2** per line.
- Changes made by flows show up the moment they happen.

### Electricity Overview
- Supports a fixed electricity price set in Homey Energy: the price shows in the header, and usage gets its own chart instead of the price chart.
- Solar export: power below zero is drawn below the zero line in yellow, and the header says *Exporting now*.

### Light Controls
- New setting, *Brightness bar at the far left*: stop the bar at 1 % so the light stays on, instead of turning it off.

## 0.7.1

### Thermostat Shortcuts
- A preset now always sets its temperature, also on aircons that keep a temperature per mode (switching mode used to bring back the mode's own temperature).
- A renamed or deleted thermostat now shows without reopening the dashboard.
- A brief connection problem no longer hides the buttons; the error shows for a moment instead.

### Electricity Overview
- A brief connection problem no longer hides the charts.
- The usage history comes back by itself when Homey's Insights were briefly unavailable as the widget opened.

### Light Controls
- Plugs and wall switches set up as lights can now be picked too. They only turn on and off, so their tiles have no brightness bar.

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
