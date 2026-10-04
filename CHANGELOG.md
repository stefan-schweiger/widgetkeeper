# Changelog

All notable changes to Widgetkeeper. The version numbers match the Homey app version.

## 0.6.1

### Electricity Overview
- New setting: **Usage history colour**. Show the usage history in Homey's purple instead of the neutral colour.
- The separate usage chart's line is now as thick as the live power line, with a full-colour dot.

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
- Homey's Insights only keep the last 50 changes of an on/off value, so the app records those itself from when the widget is added; their history fills in over the first days.

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
- The forecast is fetched only while a widget is on screen, and no more often than MET Norway updates it. The weather icons arrive with the forecast, so they don't pop in afterwards.

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
- Text sizes, weights, lines and corners now follow Homey's widget styling, so the widgets sit more naturally next to Homey's own.
- Homey's own font is used inside the Homey app.

### Thermostat Shortcuts
- More compact buttons: the temperature is smaller but still bold, and the mode and fan text is smaller.
- The device name is aligned with Homey's native device tiles.
- In dark mode, the widget has the same darker frame with a subtle rim as Homey's device tiles.

### Electricity Overview
- When the lowest price in the next 12 hours and in the next 24 hours is the same hour, it's shown only once.
- Smaller chart titles and footer text.
- The separate usage chart has a marker at the latest reading, like the live and price charts.
- Tap a chart to see its values. A touch selection stays for 3 seconds. Dragging on a chart no longer scrolls the dashboard; on Android, Homey's dashboard still takes over drags, so tap there.

## 0.1.0
- First release, with the Electricity and Thermostat shortcuts widgets.
