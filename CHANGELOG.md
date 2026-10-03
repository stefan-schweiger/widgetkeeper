# Changelog

All notable changes to Widgetkeeper. The version numbers match the Homey app version.

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
