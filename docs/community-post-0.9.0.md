<!--
A reply in the Homey Community topic (homeyCommunityTopicId 160453) announcing 0.9.0 in the test version.
Paste everything below this comment into the forum editor.

- Images are the README's on GitHub main (docs/clips/*.webp are animated, docs/screenshots/clock.png,
  docs/web/*.png);
  Discourse copies them on save. Push them before posting.
- When 0.9.0 goes live, say so in a short reply of its own and update the first post.
-->

## :test_tube: Widgetkeeper 0.9.0 is in testing

Four new widgets and web dashboards. Try them in the test version: https://homey.app/a/com.thomassidor.widgetkeeper/test/

### :framed_picture: Smart Stack

Several widgets in the space of one, like a Smart Stack on a phone. Set up a dashboard with the widgets to rotate, then pick it in the stack. It turns every 30 seconds, and brings a widget forward while something happens on it: music plays, a timer runs, a camera sees someone, a door is open. A Flow card can bring one forward too.

![Smart Stack|382x323](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/clips/stack.webp)

### :window: Curtains

Tap a tile to open or close a curtain or blind, the way it used to work in Homey. The label in the corner always says which it will do, and the slider sets anything in between.

![Curtains|358x276](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/clips/curtains.webp)

### :speaker: Media

One speaker as a card, with mute, a volume that never overshoots or passes your maximum, and *TV* instead of old album art. Tap the name to switch speaker. Up to four buttons run the speaker's own actions (such as *Set source to TV*) or flows.

![Media|358x268](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/clips/media.webp)

### :clock3: Clock

The time and the date, with the weather now and today's high and low.

![Clock|358x76](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/screenshots/clock.png)

### :desktop_computer: Web dashboards

Your Widgetkeeper widgets in any browser on your home network: a wall tablet, an old iPad, a computer or a TV. Build the dashboards on the page itself, with the same settings and live updates as on Homey. Turn them on under **Apps → Widgetkeeper → Configure**; the page asks for a Homey API key, and optionally a password.

[grid mode=carousel]

![A web dashboard in a browser|690x470](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/web/dashboard.png)

![The web dashboards front page|690x470](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/web/front.png)

![Editing a web dashboard|690x470](https://raw.githubusercontent.com/thomassidor/widgetkeeper/main/docs/web/editor.png)

[/grid]

### Also new

* Electricity prices include the tariffs and taxes from Homey Energy, so they match Homey's Energy tab.
* Price Badge: a new look, with the coming hours as bars.
* Your own names for tiles, rows and buttons.
* A compact layout for Electricity Overview and Thermostat Shortcuts.
* Sparklines: 2, 3 and 5 day spans. Cameras with only a video stream (such as Aqara) show a still from it.

Full list: https://github.com/thomassidor/widgetkeeper/blob/main/CHANGELOG.md

### :speech_balloon: Especially useful to hear

* **Smart Stack on Android:** does swiping work, or only the dots?
* **Media:** the source buttons and album art with your speakers.
* **Web dashboards** on a tablet, an iPad or a TV browser.
* **Aqara and other cameras** without snapshots.

Thanks for all the feedback so far :slight_smile:
