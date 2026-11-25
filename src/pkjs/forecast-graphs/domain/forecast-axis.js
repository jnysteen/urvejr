// src/pkjs/forecast-graphs/domain/forecast-axis.js — ES5. The forecast graph's left axis options (
// Graphs > Forecast > a graph > Left axis): THE one reading of the two settings, for the wire
// (clay-payload.js graphOptionsWord), the bake (forecast-series.js: the numbers' values), the
// hours sent (forecast-span.js: 24 h on the whole screen), the render signature,
// the settings page's gate (when-resolvers.js tempAxisLineDrawn) and the forecast preview, so
// they can never disagree.
//
// THE SETTINGS (the owner's, 2026-10-09: where the hi/lo numbers go, and whether they name the
// feels-like and dew point lines too).
//   forecastAxisNumbers 'axis' | 'graph' | 'off'
//                       the hi/lo temperature numbers: On axis, in the label strip beside the
//                       axis line on the left (today); On graph, the hi one under the point
//                       it names and the lo one over its own, outlined in the background
//                       colour, with no axis; Off, none and no
//                       axis. On graph and Off draw no left axis at all: the graph starts at
//                       the screen's left edge (src/c/layers/forecast_layer.c).
//   forecastAxisScale   true | false       the numbers name the temperature SCALE's ends: the
//                       lowest and highest value of the temperature and of every drawn
//                       feels-like or dew point line (the lines that share its axis), not only
//                       the air temperature's.
// An absent key or junk reads the shipped default ('axis' / false), which is today's graph, so
// no migration is needed. The 2.2.0 betas stored the default place as 'beside': it reads as
// junk, so as 'axis', the same place under its new name. Their "Axis line" and "Number
// outline" rows are gone (the owner's call: both are implied by where the numbers go, the axis
// line On axis, the outline On graph): their stored forecastAxisLine / forecastAxisOutline
// keys are ignored.
//
// DORMANT VALUES. The scale only matters while numbers are drawn and a feels-like or dew
// point line is (tempAxisLineDrawn). A dormant value is kept, but read as its default here, so
// the wire bits stay canonical (all zero exactly when the graph is today's) and a dormant flip
// resends nothing.
//
// THE WATCH. The wire bits ride the CLAY_LARGE_GRAPH_FONT int (bit 0 Larger graph fonts, bits
// 2, 3 and 5 these; src/c/appendix/config.h GRAPH_OPT_*). Bits 1 and 4 (the betas' axis line
// off and outline off) are retired, reserved and never sent.
//
// Dual-context: a CommonJS module on the phone and in the tests, a plain concatenated
// <script> in the settings-page webview (scripts/build-config-page.js' APP_FILES, after
// line-style.js, which it reads at load, and ahead of preview-forecast.js and
// when-resolvers.js, which read window.ForecastAxis at theirs), which has no require().
(function () {
    var lineStyle = (typeof require !== 'undefined')
        ? require('./line-style.js') : window.LineStyle;

    // The settings keys (schema.js' Left axis card).
    var KEYS = {
        numbers: 'forecastAxisNumbers',
        scale: 'forecastAxisScale'
    };
    // The numbers' three places.
    var AXIS = 'axis';
    var GRAPH = 'graph';
    var OFF = 'off';
    var NUMBERS = [AXIS, GRAPH, OFF];
    // The CLAY_LARGE_GRAPH_FONT word's bits. Lockstep with src/c/appendix/config.h GRAPH_OPT_*
    // (test/forecast-graphs/domain/forecast-axis.test.js). LARGE_FONT is Larger graph fonts' (clay-payload.js); the
    // rest are this module's, AXIS_MASK. RETIRED: the betas' axis line off (0x02) and outline
    // off (0x10), reserved, never renumbered, never sent.
    var BIT = {
        LARGE_FONT: 0x01,
        NUMS_GRAPH: 0x04,
        NUMS_OFF: 0x08,
        SCALE: 0x20
    };
    var RETIRED_BITS = 0x12;
    var AXIS_MASK = 0xFE;

    /**
     * The numbers' setting: 'axis', 'graph' or 'off'; 'axis' for an absent or junk value (the
     * betas' 'beside' included): the graph as it was before the key existed. A new install
     * stores the shipped default, 'graph' since 2.6 (schema.js; seedDefaults writes it), and an
     * existing install that lacks the key is backfilled 'axis' (clay-settings.js upgradeBackfill).
     * @param {?Object} s Clay settings.
     * @returns {string}
     */
    function numbers(s) {
        var v = (s || {})[KEYS.numbers];
        return NUMBERS.indexOf(v) >= 0 ? v : AXIS;
    }

    /**
     * The scale setting: on only when stored exactly true.
     * @param {?Object} s Clay settings.
     * @returns {boolean}
     */
    function scale(s) {
        return (s || {})[KEYS.scale] === true;
    }

    /**
     * Whether a feels-like or dew point line is drawn: one of the forecast lines draws a
     * temperature-axis metric (line-style.js firstDrawnLine), so the settings gate, the wire
     * and the preview agree.
     * @param {?Object} s Clay settings.
     * @returns {boolean}
     */
    function tempAxisLineDrawn(s) {
        return lineStyle.firstDrawnLine(s, lineStyle.isTempAxisMetric) !== null;
    }

    /**
     * The options as drawn, dormant values read as their defaults (the wire's and the settings
     * preview's reading).
     * @param {?Object} s Clay settings.
     * @returns {{numbers: string, scale: boolean}}
     */
    function resolved(s) {
        var nums = numbers(s);
        return {
            numbers: nums,
            scale: nums !== OFF && scale(s) && tempAxisLineDrawn(s)
        };
    }

    /**
     * The options' bits of the CLAY_LARGE_GRAPH_FONT word (never bit 0 or a retired bit:
     * within 0x2C): 0 exactly when the graph is today's.
     * @param {?Object} s Clay settings.
     * @returns {number}
     */
    function wireBits(s) {
        var a = resolved(s);
        return (a.numbers === GRAPH ? BIT.NUMS_GRAPH : 0)
            | (a.numbers === OFF ? BIT.NUMS_OFF : 0)
            | (a.scale ? BIT.SCALE : 0);
    }

    /**
     * Whether the bake puts the temperature scale's ends in TEMP_MIN / TEMP_MAX: the scale
     * stored on. Deliberately blind to the numbers and the lines: with no line
     * drawn the scale's ends are the air's, and a numbers flip never re-bakes them.
     * @param {?Object} s Clay settings.
     * @returns {boolean}
     */
    function bakesScale(s) {
        return scale(s);
    }

    /**
     * The render signature's part (render-signature.js): 'scale' while the option changes
     * what TEMP_MIN / TEMP_MAX hold, else ''. Platform-free (every line counted), like the
     * stripe metrics: at most one redundant fetch on a watch that ignores it.
     * @param {?Object} s Clay settings.
     * @returns {string} '' or 'scale'.
     */
    function signature(s) {
        return (scale(s) && tempAxisLineDrawn(s)) ? 'scale' : '';
    }

    var api = {
        KEYS: KEYS,
        AXIS: AXIS,
        GRAPH: GRAPH,
        OFF: OFF,
        NUMBERS: NUMBERS,
        BIT: BIT,
        RETIRED_BITS: RETIRED_BITS,
        AXIS_MASK: AXIS_MASK,
        numbers: numbers,
        scale: scale,
        tempAxisLineDrawn: tempAxisLineDrawn,
        resolved: resolved,
        wireBits: wireBits,
        bakesScale: bakesScale,
        signature: signature
    };

    // Dual-context export — mirrors the tail of src/pkjs/forecast-graphs/domain/draw-from.js.
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
    if (typeof window !== 'undefined') {
        window.ForecastAxis = api;
    }
})();
