# urvejr

[![GitHub release (latest by date)](https://img.shields.io/github/v/release/jnysteen/urvejr?label=latest&color=85C1E9&logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAQAAABKfvVzAAAAAmJLR0QA/4ePzL8AAAC0SURBVDjLldLLCcJAFEbhP4oIE1xYhw1pA4JWYRGCVbhxoTshWIUNaAnBgB4XBiTJ3HncbALznXAZIpnDmHnnmSqAS470p2Fn8wrfNEzS+INX++ZS+J6CRZu4lGWWEgVPT2DsfmfFwbMSjiuxcXn8H5gX6Q+S+ZtRDofT7/uXRF5RSmJEncEliS2fDC5JrCPJjVn/lwglQx5M/NxMbO5NwnyQxHknSeOSxIaac+feo0lhn30BIXaN/u4MXmAAAAAASUVORK5CYII=)](https://github.com/jnysteen/urvejr/releases/latest)
[![GitHub All Releases](https://img.shields.io/github/downloads/jnysteen/urvejr/total?label=downloads&logo=github)](https://github.com/jnysteen/urvejr/releases/latest/download/urvejr.pbw)
[![Platform](https://img.shields.io/badge/platform-aplite%20%7C%20basalt%20%7C%20diorite%20%7C%20emery%20%7C%20flint-red?logo=data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAQAAABKfvVzAAAAAmJLR0QA/4ePzL8AAAC1SURBVDjL1ZSxDoIwFEWbMOLE6qgYdlb5FUkMFEOMox8pJsJg/A4HmGqOkwZtoTRx8b7t5p6h6X1PCIMIiIgIxBQxo+GlGt8OHOhrb4t73D6AK944sONbxVg8p9OAjmwovuLBiRLZm5IKxdIMpMBacxNgYwYkEGtuDNyZuwEG3waEbsDR9Q3yb4AUSFw+LkRRadU4o1gMtSmj1crXsh3ra6EB+W8XyHlFhcCnfscvE46A7cw8Ab9fQsIsgqKzAAAAAElFTkSuQmCC)](https://developer.rebble.io/developer.pebble.com/guides/tools-and-resources/hardware-information/index.html)
[![GitHub](https://img.shields.io/github/license/jnysteen/urvejr?color=blue&logo=data%3Aimage%2Fpng%3Bbase64%2CiVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAAACXBIWXMAAAsTAAALEwEAmpwYAAAB7ElEQVRIie2TPWsUURSGnxsWjLosIgTJLpL8AbWwUKwjgpg%2FYEAQxCiCSLKgsAppBG38AFNolU72P4hlrLZQEwsVxSD4AWmyKFmLPBY5wWGys9ktBAtfGJh73o9z7p078K9ATeqkOqWmv9Fg0j84269vaIAelcx7u19TaSeBOgocBYaBlxE%2Bop4BWimlL32PqJ5Sj6hVdVZtqRsWYyM0dbUW3tNF4eM9gt6py5n1ctSKMF7U5IL6NkRN9ZxaC24uEzAXtVponkb9vTrd64h2qSshvpzjtjXIcBej%2FlkdznL5WzQNjALPgUZeXDQUcCs8B4BLRcI96lf1cXyPjjqz0w7Ua6EdU59Ext5uDa6rP9VqrB%2Bq39VyUQO1rH5TH8S6Ghk38uEVdVW9k6mNqG210aNBQ11TRzK%2Bu5FVASjFywKwH9id%2B4AfgLr6usuOJ4E68BG4om5Rw5G1oJ4vAevAsSCvbju7TYwV1PbFc7gLfxxYH0op%2FQJOAktdRB3gNvCoCzcfXKcLtwRMpJQ6JYCU0hvgkHoipqkAn4BnKaVVgMwREB6Bm%2Bp9YCJ2tAa8SiktbulKOdMisMgAiAGag3i2QZ2JG7WFdvYf6TlAj9CDwBSbt2IWKOckbeAe8ANoppRWBp26Zf94MVD4f2TxGzyXVgXKldOBAAAAAElFTkSuQmCC)](https://www.gnu.org/licenses/gpl-3.0)


urvejr is a weather watchface for Pebble. It is a fork of [WarnWeather](https://github.com/Toasbi/WarnWeather) by Toasbi, which was inspired by ForecasWatch2. It shows the time, an hourly forecast graph, a calendar and status bars, and on watches that have them a rain radar and health data. Alerts stay hidden until a value reaches the level you set.

## Screenshots

| Pebble Time                                                                                       | Pebble 2 Duo                                                                                       | Pebble Time 2                                                                                      |
|---------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|----------------------------------------------------------------------------------------------------|
| <img src="screenshot/v1.23.0/showcase/basalt-showcase.gif" alt="Pebble Time showcase"> | <img src="screenshot/v1.23.0/showcase/flint-showcase.gif" alt="Pebble 2 Duo showcase"> | <img src="screenshot/v1.23.0/showcase/emery-showcase.gif" alt="Pebble Time 2 showcase"> |

## Features

Features marked * depend on your watch model.

### Forecast

- Hourly forecast graph: temperature plus up to four lines*
- Rain chance and amount, cloud cover, UV index, wind, gusts, air pressure, feels-like temperature and dew point
- Lines, stripes, dots or bars, with your own colors*
- 12 to 66 hours ahead* and up to six graphs, one per screen*
- Day/night shading
- Weather from Open-Meteo, Met.no, Bright Sky (DWD), OpenWeatherMap, Tomorrow.io, Weather Underground or Yandex Weather

### Alerts*

Icons at the edge of a status bar that appear only when something needs your attention:

- Rain on its way, with a countdown
- Wind, gusts, UV index, air quality and pollen above your warn level, today or tomorrow
- Low battery, Bluetooth lost, quiet time and battery saver hours
- Your own warn and danger levels and colors for each alert

### Rain radar*

- Rain for the next 2 hours in 5-minute steps, from DWD (Germany), Met.no (Nordic countries), Rainbow.ai or Tomorrow.io (worldwide)
- Clouds, sun and lightning for the next 2 hours

### Status bars

- Weather condition with a sun or moon icon, temperature, air quality, wind, gusts, UV index, pollen, dew point, air pressure, sunrise and sunset
- Date, calendar week, city, countdown to a date
- Steps, sleep, distance, heart rate*
- Watch and phone battery
- Short forms when a bar runs out of room (Partly cloudy becomes PCLDY)
- Name your own bars and place them on any screen*

### Health*

- Steps, sleep, distance and heart rate
- 24-hour chart with steps per hour, heart rate and sleep

### Calendar

- Two or three weeks with today highlighted
- Weekend and public holiday colors for 150+ countries

### Watch

- Up to three screens, switched with a wrist flick*
- Dark, light and black & white themes, with a night theme at sunset or set hours
- 12h/24h, clock color, smooth digits*
- Battery saver hours, night backlight*

### Settings

- Live preview of every screen
- Weather tab with a 5-day forecast for your location and up to three saved places
- First-run setup with defaults for your country and watch

## Platforms

Pebble Classic, Pebble Steel, Pebble Time, Pebble Time Steel, Pebble 2, Pebble 2 Duo and Pebble Time 2.

## Installation

### Pebble appstore

urvejr is not on the Pebble appstore yet.

### Manual install

Download [`urvejr.pbw`](https://github.com/jnysteen/urvejr/releases/latest/download/urvejr.pbw) from the latest release and open it with the Pebble app for [iOS](https://repebble.com/app) or [Android](https://repebble.com/app).

## Privacy and data sources

urvejr sends anonymous usage data: whether weather updates work, the weather provider, a rough country, app and watch versions and which settings are used. It never sends your location, the places you type, your API keys or health data. You can turn it off in Setup › Privacy & data sources › Share anonymous telemetry.

Setup › Privacy & data sources in the settings lists every data source and its license. Data from [Open-Meteo.com](https://open-meteo.com/), [MET Norway](https://www.met.no/) and the Copernicus Atmosphere Monitoring Service is used under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Credits and license

urvejr is a modified version of [WarnWeather](https://github.com/Toasbi/WarnWeather) by Toasbi, forked in November 2026 and renamed to urvejr. WarnWeather was itself inspired by ForecasWatch2. The changes since the fork are in this repository's git history. If you enjoy urvejr, please support the original authors, for example with a coffee for Toasbi at [buymeacoffee.com/toaster2](https://buymeacoffee.com/toaster2).

urvejr is free software under the [GNU General Public License v3.0](LICENSE), the same license as WarnWeather.

## Developers

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and workflow.
