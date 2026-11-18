// src/pkjs/config-ui/lib/platform.js — ES5. The watch's facts: the face is built for the
// Pebble Time 2 (emery) alone (package.template.json targetPlatforms), so every env is its.
/**
 * The config-UI environment facts. The face runs on the Pebble Time 2 only, so they are the
 * same whatever watchInfo says.
 * @param {Object=} watchInfo Pebble watchInfo; unused.
 * @returns {{color: boolean, platform: string, health: boolean, radar: boolean, themePolarity: boolean, hr: boolean, thresholds: boolean, colorBacklight: boolean, lineStyles: boolean, onDemand: boolean, fineBattery: boolean, forecastSpan: boolean, graphStyles: boolean, extraBars: boolean}} Env: color display, platform name, health support, radar support, theme light-polarity support, heart-rate sensor support, threshold-highlight support, RGB-backlight-LED support, third-metric-line + per-line-style support, On demand support, 5 % battery-charge steps, the 12 h / 24 h / long forecast span, a graph style per screen, and bars 4 to 6.
 */
function computeEnv(watchInfo) {
  return { color: true, platform: 'emery', health: true, radar: true, themePolarity: true, hr: true, thresholds: true, colorBacklight: true, lineStyles: true, onDemand: true, fineBattery: true, forecastSpan: true, graphStyles: true, extraBars: true };
}
module.exports = { computeEnv: computeEnv };
