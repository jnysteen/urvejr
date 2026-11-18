// Maps Clay settings to the watch AppMessage (CLAY_* keys + packed holiday
// window). Extracted from index.js so the mapping is unit-testable (index.js
// wires Pebble events and can't be required under node:test). ES5-only (PKJS).

var utf8 = require('../../lib/utf8.js');
var pebbleColors = require('../../theme/domain/pebble-colors.js');
var holidayMask = require('../../calendar/domain/holiday-mask.js');
var graphWire = require('../../forecast-graphs/domain/graph-wire.js');
var viewCycle = require('../../layout/domain/view-cycle.js');
var resolveInk = require('../../theme/domain/resolve-ink.js').resolveInk;
var statusThresholds = require('../../alerts/domain/status-thresholds.js');
// buildSettingsBlob, the CLAY_THRESHOLDS_UINT8 packer.
var statusWire = require('../../alerts/domain/status-wire.js');
var platformLib = require('../../config-ui/lib/platform.js');
var dateFormat = require('../../calendar/domain/date-format.js');
var nightLight = require('../../theme/domain/night-light.js');
// The forecast's left axis options: bits of the CLAY_LARGE_GRAPH_FONT word.
var forecastAxis = require('../../forecast-graphs/domain/forecast-axis.js');
// Graph styles: each view's style as the watch draws it, and the styles' records.
var graphStyles = require('../../forecast-graphs/domain/graph-styles.js');
var graphStyleWire = require('../../forecast-graphs/domain/graph-style-wire.js');

// The radar's built-in no-rain text — the schema's radarNoRainText default and the
// watch's fallback string (rain_radar_layer.c). test/settings/domain/clay-payload.test.js pins all three.
var DEFAULT_NORAIN_TEXT = "You're good :)";

var DEFAULT_COLOR_WHITE = pebbleColors.GColorWhite;
var DEFAULT_COLOR_FOLLY = pebbleColors.GColorFolly;
// Holiday highlight defaults to Blue Moon (weekends stay Folly/red).
var DEFAULT_COLOR_BLUE_MOON = pebbleColors.GColorBlueMoon;

/**
 * Longest prefix of `str` that encodes to at most `maxBytes` UTF-8 bytes —
 * utf8.js owns the walker (status-lines' wire byte arrays share it); this
 * wrapper keeps the string-in/string-out shape and the original characters
 * (a lone surrogate is charged 3 bytes and kept, exactly as before).
 * @param {string} str Input string.
 * @param {number} maxBytes Maximum UTF-8 byte budget.
 * @returns {string} The longest prefix of str that encodes to <= maxBytes bytes.
 */
function truncateUtf8Bytes(str, maxBytes) {
    return utf8.truncateToByteCap(str, maxBytes).str;
}

// The country the holiday features and the date order act for (date-format.js holds
// it, so the settings page's status bars preview reads the same rule).
var effectiveHolidayCountry = dateFormat.effectiveHolidayCountry;

/**
 * The holiday window's calendar layout for an already-resolved cycle. The watch
 * picks the calendar rows per ACTIVE view and puts the previous week on top of
 * every 3-row one (config_n_today), while the one HOLIDAYS window serves them
 * all and cannot reach before its anchor. So the window anchors on the previous
 * week when ANY slot is FULL-tier, not only the default: a custom layout may put
 * the 3-row calendar on a flick view, and a radar-top slot (also FULL) is drawn
 * as the 3-row calendar while radar has no data (view_spec_resolve). The 2-row
 * views then read bits 7-20, keeping the one week of rollover headroom the
 * fullCal preset (full default, compact flicks) already ships with.
 *
 * @param {Object} settings Clay settings.
 * @param {Array<Object>} cycle view-cycle.js resolveViewCycle() result.
 * @returns {{startMon: boolean, prevWeek: boolean}} holidayMask window options.
 */
function holidayWindowOptsForCycle(settings, cycle) {
    var anyFull = false;
    for (var i = 0; i < cycle.length; i++) {
        if (cycle[i] && cycle[i].tier === viewCycle.TIER_FULL) { anyFull = true; }
    }
    return {
        startMon: settings.weekStartDay === 'mon',
        prevWeek: anyFull && settings.firstWeek === 'prev'
    };
}

/**
 * The holiday window's calendar layout — THE one derivation, shared by the
 * HOLIDAYS tuple below and index.js's holiday prefetch (refreshHolidays →
 * holidayMask.windowYears). holiday-mask.js keeps build() and windowYears() on
 * one anchor only when both are handed the same options; the prefetch once
 * re-derived them from the retired topViewMode key, so on the 3-row calendar it
 * fetched the wrong years in early January and its cache prune deleted the
 * previous year the top row still showed.
 *
 * @param {Object} settings Clay settings (the layout keys; the theme is irrelevant).
 * @param {Object|null} watchInfo Active watch info; unused.
 * @returns {{startMon: boolean, prevWeek: boolean}} holidayMask window options.
 */
function holidayWindowOpts(settings, watchInfo) {
    return holidayWindowOptsForCycle(settings,
        viewCycle.resolveViewCycle(settings, platformLib.computeEnv(watchInfo)));
}

// CLAY_VIEW_RESET_MIN's wire layout: config_wire.h VIEW_RESET_DOUBLE_FLICK (pinned equal by
// test/settings/domain/flick-presets.test.js). A bit, not a tuple: 11 B would break the Clay message's 10 B
// headroom floor (test/repo/inbox-size.test.js).
var VIEW_RESET_MINUTES_MASK = 0xFF;
var VIEW_RESET_DOUBLE_FLICK = 0x100;

/**
 * The CLAY_VIEW_RESET_MIN word: the auto-return minutes plus the Double flick bit. The
 * minutes mask stops any input (e.g. '-1') from spilling into the flag bit.
 * @param {Object} settings Clay settings.
 * @returns {number} Non-negative int, at most 0x1FF.
 */
function packViewReset(settings) {
    var word = (parseInt(settings.viewResetMin, 10) || 0) & VIEW_RESET_MINUTES_MASK;
    // Absent reads as off, which is the toggle's default.
    if (settings.doubleFlick) {
        word = word | VIEW_RESET_DOUBLE_FLICK;
    }
    return word;
}

/**
 * The CLAY_LARGE_GRAPH_FONT tuple, the graph-options word (src/c/appendix/config.h
 * GRAPH_OPT_*): bit 0 Larger graph fonts, bits 2, 3 and 5 the forecast's left axis options
 * (forecast-axis.js wireBits; bits 1 and 4 are retired). While every axis option draws
 * today's graph (those bits all 0) it is today's bare boolean, so a payload with the defaults
 * is exactly what it always was and an upgrade resends nothing; otherwise the number. Either
 * way one int tuple: the boolean travels as a 4-byte int too, and the C reads its low half
 * (config_wire.c), so `true` is bit 0 alone.
 * @param {Object} settings Clay settings.
 * @param {Object} env platformLib.computeEnv() result.
 * @returns {(boolean|number)} The boolean while the axis bits are 0, else a word 0x04..0x2D.
 */
function graphOptionsWord(settings, env) {
    var large = Boolean(settings.largeGraphFont);
    var bits = forecastAxis.wireBits(settings, env);
    return bits ? ((large ? forecastAxis.BIT.LARGE_FONT : 0) | bits) : large;
}

/**
 * The holiday check of a phone without holiday data.
 * @returns {boolean} false
 */
function noHoliday() {
    return false;
}

/**
 * Build the Clay settings AppMessage payload.
 * @param {Object} settings Clay settings (claySettings.read() shape).
 * @param {Object|null} watchInfo Active watch info.
 * @param {Date} now Reference time for the holiday window (the caller's clock).
 * @param {function(string, string, Date): boolean} [isHoliday] Whether a day is a public holiday
 *   (calendar/adapter/nager-source.js isHoliday); absent, no day is marked, as for a phone
 *   that has fetched no holiday data yet.
 * @returns {Object} AppMessage key→value payload.
 */
function buildClayPayload(settings, watchInfo, now, isHoliday) {
    var theme = settings.theme || 'dark';

    // The watch's facts (config-ui/lib/platform.js), read by the tuples below.
    var env = platformLib.computeEnv(watchInfo);

    // Resolve the packed view cycle up front (view-cycle.js, the reading the Layout
    // preview shows) — the holiday mask below anchors on it (holidayWindowOptsForCycle,
    // the same rule index.js's prefetch uses).
    // Each view's graph style survives only where the style exists (graph-styles.js
    // wireCycle).
    var cycle = graphStyles.wireCycle(settings, env, viewCycle.resolveViewCycle(settings, env));
    var defaultIsFull = cycle[0].tier === viewCycle.TIER_FULL;   // slot 0 is the 3-row calendar
    // CLAY_TOP_VIEW_MODE (TopViewMode enum: 0=full,1=compact,2=none) is a boot-time hint the
    // watch overwrites per active view; derive it from the default slot's tier for correctness.
    var topViewIdx = defaultIsFull ? 0 : (cycle[0].tier === viewCycle.TIER_NONE ? 2 : 1);
    var payload = {
        "CLAY_CELSIUS": settings.temperatureUnits === 'c',
        "CLAY_TIME_LEAD_ZERO": settings.timeLeadingZero,
        "CLAY_AXIS_12H": settings.axisTimeFormat === '12h',
        "CLAY_COLOR_TODAY": settings.hasOwnProperty('colorToday') ? settings.colorToday : DEFAULT_COLOR_WHITE,
        "CLAY_START_MON": settings.weekStartDay === 'mon',
        // No-cal date slot order: US writes the month first (mm.dd.yy); everyone
        // else is day-first (dd.mm.yy). Derived from the configured holiday
        // country (defaults to US, matching the holiday-mask default below).
        "CLAY_DATE_MONTH_FIRST": dateFormat.dateMonthFirst(settings),
        "CLAY_PREV_WEEK": settings.firstWeek === 'prev',
        "CLAY_TOP_VIEW_MODE": topViewIdx,
        "CLAY_THEME": ['dark', 'light', 'bw', 'bw-light'].indexOf(theme),
        "CLAY_TIME_FONT": ['roboto', 'leco', 'bitham'].indexOf(settings.timeFont),
        "CLAY_SHOW_BT": settings.btIcons === "connected" || settings.btIcons === "both",
        "CLAY_SHOW_BT_DISCONNECT": settings.btIcons === "disconnected" || settings.btIcons === "both",
        "CLAY_VIBE": settings.vibe,
        "CLAY_SHOW_AM_PM": settings.timeShowAmPm,
        "CLAY_COLOR_SUNDAY": settings.hasOwnProperty('colorSunday') ? settings.colorSunday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_SATURDAY": settings.hasOwnProperty('colorSaturday') ? settings.colorSaturday : DEFAULT_COLOR_FOLLY,
        "CLAY_COLOR_US_FEDERAL": settings.hasOwnProperty('colorUSFederal') ? settings.colorUSFederal : DEFAULT_COLOR_BLUE_MOON,
        "HOLIDAYS": (function() {
            var windowOpts = holidayWindowOptsForCycle(settings, cycle);
            var built = holidayMask.build({
                startMon: windowOpts.startMon,
                prevWeek: windowOpts.prevWeek,
                country: effectiveHolidayCountry(settings),
                region: settings.holidayRegion || 'all',
                enabled: settings.holidaysEnabled !== false
            }, now, isHoliday || noHoliday);
            return holidayMask.pack(built.anchor, built.mask);
        })(),
        "CLAY_COLOR_TIME": settings.hasOwnProperty('colorTime') ? settings.colorTime : resolveInk(DEFAULT_COLOR_WHITE, theme),
        "CLAY_DAY_NIGHT_SHADING": settings.hasOwnProperty('dayNightShading') ? settings.dayNightShading : true,
        // Order IS the wire value; 'slot' appended as 3 (never reorder — persisted on the watch).
        "CLAY_HEALTH_MODE": ['off', 'status', 'all', 'slot'].indexOf(settings.healthMode || 'off'),
        "CLAY_FETCH_INTERVAL_MIN": parseInt(settings.fetchIntervalMin, 10) || 30,
        "CLAY_RAIN_COUNTDOWN_HORIZON": (function() {
            // The rain alert's window, resolved by the contract that owns its default.
            // A radar that fetches nothing (radar mode 'off') sends horizon 0, the
            // watch's "no countdown". Whether Rain draws at all is its On demand cell
            // (CLAY_THRESHOLDS_UINT8), not this value.
            if ((settings.radarMode || 'graph') === 'off') { return 0; }
            return statusThresholds.rainAlert(settings).horizonMin;
        })(),
        // Health-graph HR line scale, packed lo | (hi << 8) — both ends are <= 220,
        // so each fits a byte and the pair rides one key instead of two. The watch
        // reads it as int32 and falls back to its own HEALTH_HR_LO/HI when it is 0
        // (an older phone build that never sends the key).
        "CLAY_HR_SCALE": (function() {
            var lo = 40, hi = 150;            // == HEALTH_HR_LO / HEALTH_HR_HI
            var m = /^(\d+)-(\d+)$/.exec(String(settings.hrScale || ''));
            if (m) {
                var plo = parseInt(m[1], 10), phi = parseInt(m[2], 10);
                if (plo >= 1 && phi > plo && phi <= 255) { lo = plo; hi = phi; }
            }
            return lo | (hi << 8);
        })()
    };
    // The graph's three tuples: the forecast's and the radar's bar palettes (each with
    // its Bars from flag) and the line styling (colours, fill and night flags, the style
    // bytes with their Draw from bits). The layout and why none of it is platform-gated
    // live on forecast-graphs/domain/graph-wire.js, the one packer the fixture send shares.
    Object.assign(payload, graphWire.buildGraphTuples(settings, watchInfo));

    // Dim backlight, five bytes: [0..2] the LED's r/g/b channels, [3] the window's
    // start hour (inclusive), [4] its end hour (exclusive, wrapping past midnight).
    // start === end is the app's "never" window, and the switch being OFF sends
    // [0,0,0,0,0] — so the watch reads the feature's state out of the window itself
    // and needs no enabled flag. Settings-derived (the Nighttime card's toggle, mode,
    // hours and colour), so it rides the Clay message; the full layout and the
    // resolution rules live on buildNightLightBytes (night-light.js).
    payload.CLAY_NIGHT_LIGHT_UINT8 = nightLight.buildNightLightBytes(settings);

    // Threshold-highlight settings (enabled bits + colors + health-kind
    // thresholds + warn looks, whose default follows env.color) — settings-derived,
    // so they ride the Clay message.
    payload.CLAY_THRESHOLDS_UINT8 = statusWire.buildSettingsBlob(settings, env);
    // Bars 4 to 6's On demand cells (status-wire.js buildExtraCells): the blob's cell bytes
    // have no room for them. Zeros while no made bar shows.
    payload.CLAY_OD_EXTRA_UINT8 = statusWire.buildExtraCells(settings, env);
    // Date-slot formats [monthYear, fullDate] — settings-derived, so they ride the Clay
    // message.
    payload.CLAY_DATE_FORMAT_UINT8 = dateFormat.buildDateFormatBytes(settings);

    // Custom radar empty-state text — settings-derived, so it rides the Clay
    // message. Trimmed, then truncated to 24 UTF-8 BYTES (the watch persists it
    // in a 25 B buffer incl. NUL). An empty text rides the wire as such: the user
    // cleared the message and the watch draws no line. A blob without the key
    // (never seeded) sends the built-in text, as the page shows it.
    var noRainText = settings.radarNoRainText;
    if (noRainText === undefined || noRainText === null) { noRainText = DEFAULT_NORAIN_TEXT; }
    payload.CLAY_NORAIN_TEXT = truncateUtf8Bytes(String(noRainText).trim(), 24);

    // Per-series vertical insets for the forecast graph's value-mapped lines,
    // render-ready in px (graph-wire.js buildCurveInsetBytes: feels-like and dew
    // point share the temp curve's offset). Settings-derived, so it rides the Clay message.
    payload.CLAY_CURVE_INSET_UINT8 = graphWire.buildCurveInsetBytes(settings);

    // Pack the cycle into the three view words (unused slots → 0 = disabled). Each is
    // a 32-bit int: packSpec in the low half, the custom ext word (sizes, top-graph
    // kind, Position) in the high half — PKJS sends every number as 4 bytes anyway, so
    // the ext costs no Clay bytes. It is 0 for every preset.
    payload.CLAY_VIEW_0 = viewCycle.packWire(cycle[0] || null);
    payload.CLAY_VIEW_1 = viewCycle.packWire(cycle[1] || null);
    payload.CLAY_VIEW_2 = viewCycle.packWire(cycle[2] || null);
    payload.CLAY_VIEW_RESET_MIN = packViewReset(settings);

    // The graph-options word (graphOptionsWord): the axis-font step-up (Layout tab) in
    // bit 0, the forecast's left axis options above it. The simple Boolean() on
    // largeGraphFont is provably safe: engine.js seeds toggles from defaultValue and flips
    // them with !S[key], so a stored value is a strict boolean or absent -- and absent
    // collapsing to false IS the default. A default-TRUE toggle would need the
    // hasOwnProperty ternary dayNightShading uses above. With every axis option at its
    // default it is the bare boolean it always was.
    payload.CLAY_LARGE_GRAPH_FONT = graphOptionsWord(settings, env);

    // The graph styles' records: while a screen shows a style other than the first, each
    // shown style's look, hours and line-to-row map; empty tuples otherwise, which clear the
    // watch's (graph-style-wire.js buildStyleTuples): up to 3 x 48 B.
    Object.assign(payload, graphStyleWire.buildStyleTuples(settings, watchInfo));

    return payload;
}

module.exports = {
    effectiveHolidayCountry: effectiveHolidayCountry,
    holidayWindowOpts: holidayWindowOpts,
    buildClayPayload: buildClayPayload,
    // Exported for tests (multi-byte boundary cases); production callers go
    // through buildClayPayload.
    truncateUtf8Bytes: truncateUtf8Bytes,
    // The CLAY_VIEW_RESET_MIN flag bit, pinned against config_wire.h by the tests.
    VIEW_RESET_DOUBLE_FLICK: VIEW_RESET_DOUBLE_FLICK,
    // The CLAY_LARGE_GRAPH_FONT word, exported for the tests.
    graphOptionsWord: graphOptionsWord,
    DEFAULT_NORAIN_TEXT: DEFAULT_NORAIN_TEXT
};
