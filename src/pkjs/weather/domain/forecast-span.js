// src/pkjs/weather/domain/forecast-span.js — ES5. The forecast graph's time span (Graphs > Forecast > a
// graph > Other > Forecast length): how many hours the phone fetches, bakes and sends (14 / 24 / 68 for the 12 h,
// 24 h and long options, and 26 for 24 h when the graph has no left axis); the watch fits its
// grid to them (src/c/appendix/forecast_span.h) and shows as many as its plot's width holds.
//
// THE SPAN IS THE DATA. The span rides the fetch options (fetch-options.js forecastHours),
// the adapters map hourly-window.js windowHours() buckets, and getPayload sends
// WeatherProvider#payloadEntries() of them; the watch reads its grid off the NUM_ENTRIES
// it receives. Nothing here rides the Clay message. Requires hourly-window.js (a leaf),
// forecast-axis.js (line-style.js and its colour leaves) and forecast-span-hours.js (that and
// view-cycle.js, a leaf): none touches Pebble at load or requires a weather module, so
// fetch-options.js' load-time invariant holds.
var hourlyWindow = require('./hourly-window.js');
var forecastAxis = require('../../forecast-graphs/domain/forecast-axis.js');
// The stored option (CHOICES, storedHours, option) lives in the dual-context
// forecast-span-hours.js, which the settings page loads too; re-exported below.
var spanHours = require('./forecast-span-hours.js');
var CHOICES = spanHours.CHOICES;
var storedHours = spanHours.storedHours;

// The 24 h span: what an absent or unknown stored value reads as.
var DAY_HOURS = hourlyWindow.FORECAST_HOURS;
// The 12 h span sends 14: the 13th column (partly on screen at most widths) and the vertex
// past it carry data (forecast_span.h FORECAST_SPAN_HALF_SENT, lockstep).
var HALF_SENT_HOURS = 14;
// The 24 h span on a graph with no left axis (signature()'s '26': the hi/lo numbers On graph
// or Off) sends 26: its plot then spans the whole 200 px screen, and the 24 h grid's fixed
// 8 px pitch needs ceil(200 / 8) + 1 hours to reach the right edge (forecast_span.h
// FORECAST_SPAN_DAY_SENT, lockstep). With the numbers On axis it sends 24, so that payload and
// that screen stay today's (the temperature bytes are normalised over the hours sent).
var DAY_WIDE_HOURS = 26;
// The hours each signature() token fetches and sends: '' 24 h, '12', '26' (24 h with no left
// axis) and '48' (the long span). The watch fits its grid to them.
var SENT_HOURS = {
    '': DAY_HOURS,
    '12': HALF_SENT_HOURS,
    '26': DAY_WIDE_HOURS,
    '48': hourlyWindow.MAX_FORECAST_HOURS
};

/**
 * The hours the phone fetches and sends to this watch: the hours of its signature() token
 * (14 / 24 / 68; 26 for 24 h with no left axis). So the hours sent and the render
 * signature cannot disagree.
 * @param {?Object} settings Clay settings.
 * @returns {number} 14, 24, 26 or 68.
 */
function hours(settings) {
    return SENT_HOURS[signature(settings)];
}

/**
 * The most hours this watch is ever sent (the inbox budget's span).
 * @returns {number} 68.
 */
function maxHours() {
    return hourlyWindow.MAX_FORECAST_HOURS;
}

/**
 * The render signature's part (render-signature.js): '' for 24 h (absent and '24' alike: an
 * absent key reads as the span from before it existed), else the stored option;
 * '26' for 24 h with the hi/lo numbers On graph or Off, the one place a numbers flip changes
 * the hours sent (hours()). Platform-free, like the stripe metrics: a stored 12 or 48 on a
 * 24 h watch, or a numbers flip on one, costs at most one redundant fetch when it changes.
 * Layout toggles never re-sign otherwise (the numbers at 12 h and the long span, Larger graph
 * fonts): the watch fits the hours it holds to its own width.
 * @param {?Object} settings Clay settings.
 * @returns {string} '', '12', '26' or '48'.
 */
function signature(settings) {
    var h = storedHours(settings);
    if (h !== DAY_HOURS) { return String(h); }
    return forecastAxis.numbers(settings) !== forecastAxis.AXIS ? String(DAY_WIDE_HOURS) : '';
}

module.exports = {
    DAY_HOURS: DAY_HOURS,
    CHOICES: CHOICES,
    HALF_SENT_HOURS: HALF_SENT_HOURS,
    DAY_WIDE_HOURS: DAY_WIDE_HOURS,
    storedHours: storedHours,
    hours: hours,
    maxHours: maxHours,
    signature: signature
};
