var wireUnits = require('../../../wire/domain/wire-units.js');
var clampByte = wireUnits.clampByte;
var zeroFilledArray = wireUnits.zeroFilledArray;

var radarWire = require('../../domain/radar/radar-wire.js');
var radarFetch = require('./radar-fetch.js');
var coords = require('../../domain/coords.js');
var NUM_BARS = radarWire.NUM_BARS;         // shared wire invariant (24 frames)
var SLOT_SECONDS = radarWire.SLOT_SECONDS; // shared wire invariant (300 s/slot)

// Rainbow called directly on the user's own key ('rainbowkey', fetchRadarTuplesWithKey).
// The position goes rounded to 3 decimals (~110 m; coords.js), so Rainbow gets no more
// of it than the radar needs.
var DIRECT_BASE = 'https://api.rainbow.ai/nowcast/v1/precip-global';
// The radar source id of Rainbow on the user's own key: the radarProvider value of
// "Rainbow", the radar-factory.js entry that runs fetchRadarTuplesWithKey (it
// re-exports this as OWN_KEY_RADAR_ID; it lives here because radar-factory.js requires
// this module), and the id each answer to the key is recorded under (key-result.js).
var OWN_KEY_RADAR_ID = 'rainbowkey';
// Catches a lon/lat transposition, tolerates Rainbow's grid snapping of the echoed point.
var ECHO_TOLERANCE_DEG = 0.5;
// How long the keyed path may keep answering null (transient) before it clears the watch
// radar instead. null lets the watch roll its last window forward unverified; a failure
// that never heals (Origin-adding runtime, failed preflight, clock skew) would roll it into
// a made-up "No rain ahead". (A 429 is not one of these nulls: it answers the limit
// notice.) 30 min of an unverified tail is accepted. Measured
// in slot-0 time, not attempts: the failure backoff retries after 1, 2 and 4 min, so an
// attempt count would clear the radar inside a tunnel.
var KEYED_FAILURE_CLEAR_AFTER_SEC = 30 * 60;

// Slot-0 epoch of the first null of the keyed path's current run of nulls; null = no run.
// In memory only, never persisted: a PKJS relaunch restarts the streak, which only
// delays a clear. A run is the keyed path's own consecutive answers: any non-null answer,
// the missing-key clear, or a radar step on another source (radar-factory.js) ends it.
var keyedNullSince = null;

/**
 * End the keyed path's run of nulls, so its next null starts a fresh 30 minutes. Called
 * when the keyed path stops being the radar in use (radar-factory.js createRadarSource for
 * any other source, radar off included) and on the missing-key clear. Without it, coming
 * back to the own key after hours on another source would measure the first transient
 * failure against a null from before the switch and clear the fresh window that source
 * left on the watch.
 * @returns {void}
 */
function resetKeyedStreak() {
    keyedNullSince = null;
}

/**
 * Rainbow's direct precip-global URL. Path order is /{lon}/{lat};
 * the key never goes in the URL — it rides the Ocp-Apim-Subscription-Key header.
 * @param {number} lat Latitude, already rounded to 3 decimals.
 * @param {number} lon Longitude, already rounded to 3 decimals.
 * @param {number} [slotZeroEpoch] Slot-0 epoch seconds (5-min aligned, so within Rainbow's
 *   "1-minute aligned, past 30 minutes" start_timestamp rule on a correct phone clock);
 *   omitted → no start_timestamp (the one retry after a 400/422).
 * @returns {string} Request URL.
 */
function buildDirectUrl(lat, lon, slotZeroEpoch) {
    var url = DIRECT_BASE + '/' + lon + '/' + lat;
    return typeof slotZeroEpoch === 'number' ? url + '?start_timestamp=' + slotZeroEpoch : url;
}

/**
 * Whether Rainbow's echoed point is within ECHO_TOLERANCE_DEG of the request: a
 * transposition guard.
 * @param {Object} body Parsed response.
 * @param {number} lat Requested (rounded) latitude.
 * @param {number} lon Requested (rounded) longitude.
 * @returns {boolean} True when the echo is present and near.
 */
function isEchoNear(body, lat, lon) {
    return Boolean(body) && typeof body.latitude === 'number' && typeof body.longitude === 'number'
        && Math.abs(body.latitude - lat) <= ECHO_TOLERANCE_DEG
        && Math.abs(body.longitude - lon) <= ECHO_TOLERANCE_DEG;
}

/**
 * Resample Rainbow's forecast intervals into the 24 five-minute wire bytes
 * (uint8, mm/h * 10 — the same convention radar.js#scaleToWireUnits produces).
 * For each slot i, slotTime = slotZeroEpoch + i*300; the covering interval is
 * the one with timestampBegin <= slotTime < timestampEnd.
 *
 * - Slots before forecast[0].timestampBegin inherit forecast[0].precipRate:
 *   start_timestamp alignment should already close the <=5-min gap, but a
 *   residual gap must not read as a spurious dry "now".
 * - Slots with no covering interval (gaps, beyond the horizon) are 0.
 * - An empty/missing forecast yields 24 zeros (out-of-coverage clear).
 *
 * @param {Array} forecast Rainbow forecast intervals
 *   ({precipRate (mm/h), timestampBegin, timestampEnd} each), possibly empty.
 * @param {number} slotZeroEpoch Slot-0 wall-clock epoch seconds.
 * @returns {number[]} 24-entry uint8 array (mm/h * 10, saturating at 255).
 */
function resampleForecast(forecast, slotZeroEpoch) {
    var out = zeroFilledArray(NUM_BARS);
    if (!forecast || forecast.length === 0) {
        return out;
    }
    var first = forecast[0];
    var i;
    var j;
    var slotTime;
    var rate;
    var interval;
    for (i = 0; i < NUM_BARS; i += 1) {
        slotTime = slotZeroEpoch + i * SLOT_SECONDS;
        rate = 0;
        if (typeof first.timestampBegin === 'number' && slotTime < first.timestampBegin) {
            rate = first.precipRate || 0;
        }
        else {
            for (j = 0; j < forecast.length; j += 1) {
                interval = forecast[j];
                if (interval.timestampBegin <= slotTime && slotTime < interval.timestampEnd) {
                    rate = interval.precipRate || 0;
                    break;
                }
            }
        }
        out[i] = clampByte(rate * 10);
    }
    return out;
}

/**
 * Hand the keyed path's outcome to the caller, turning a long run of transient nulls into
 * the clear (KEYED_FAILURE_CLEAR_AFTER_SEC). Any non-null answer (a window, flat zeros,
 * a clear, the limit notice) ends the run: a 429 is an honest, known state, so it never
 * ripens into a clear. Slot-0 time is the clock, so the adapter stays clock-free.
 * @param {?Object} tuples The attempt's answer (null = transient failure).
 * @param {number} slotZeroEpoch This cycle's slot-0 epoch seconds.
 * @param {Function} callback The adapter's callback.
 * @returns {void}
 */
function settleKeyed(tuples, slotZeroEpoch, callback) {
    if (tuples !== null) { keyedNullSince = null; callback(tuples); return; }
    if (keyedNullSince === null || slotZeroEpoch < keyedNullSince) { keyedNullSince = slotZeroEpoch; }
    if (slotZeroEpoch - keyedNullSince >= KEYED_FAILURE_CLEAR_AFTER_SEC) {
        // The run continues past the clear: later nulls keep answering it (the
        // outbox dedupe sends it once), and the first real window always goes
        // out (radar-dedupe.js sends a real window after a clear).
        console.log('[!] Rainbow radar: no usable answer for 30 min — clearing the watch radar');
        callback(radarWire.clearRadarTuples());
        return;
    }
    callback(null);
}

/**
 * Fetch 2-hour Rainbow.ai rain-radar tuples straight from Rainbow's API on the
 * user's own key ('rainbowkey'). Rainbow is a single-point nowcast, so the area
 * array is always 24 zeros (the watch renderer skips zero-area runs). Failures split by whether they can heal on their own:
 * - PERMANENT (no key set, a position that is no coordinate pair, or a
 *   401/403 key rejection): clearRadarTuples(),
 *   which takes the radar off the watch (tomorrowio-radar.js does the same). A
 *   null would leave the watch rolling its last window forward into a
 *   confident "No rain ahead" nothing ever reported. The outbox dedupe sends
 *   the clear once; the first 200 after it sends a fresh window.
 * - OUT OF COVERAGE (404): flat zeros anchored at slot 0, not a clear, as
 *   Met.no's 422.
 * - LIMITED (429, Rainbow refusing the key over a request limit):
 *   radarWire.limitedRadarTuples(). The watch keeps its window and, where it
 *   shows no rain, says "Radar limit reached". It ends a run of nulls.
 * - START REFUSED (400/422, e.g. a skewed phone clock): one retry without
 *   start_timestamp; the retry's outcome is the cycle's outcome.
 * - TRANSIENT (5xx, network, timeout, empty or unparseable 200, echoed
 *   point missing or far off): null — the radar keys stay out of this send
 *   and the watch keeps (and self-advances) its last window. Until the run of
 *   nulls spans KEYED_FAILURE_CLEAR_AFTER_SEC of slot-0 time: then it answers
 *   the clear instead, until the first non-null answer (settleKeyed).
 *
 * The position goes into Rainbow's URL path rounded to 3 decimals (coords.js),
 * and the echo check compares against that rounded point.
 *
 * @param {string} apiKey The user's Rainbow API key ('' or blank clears the
 *   watch's radar without a request). Paste whitespace is trimmed.
 * @param {number|string} lat Latitude in decimal degrees (a manual location's
 *   is a string).
 * @param {number|string} lon Longitude in decimal degrees (likewise).
 * @param {number} slotZeroEpoch The 5-min pinned slot-0 epoch.
 * @param {Function} callback Receives the radar tuples object, or null.
 * @returns {void}
 */
function fetchRadarTuplesWithKey(apiKey, lat, lon, slotZeroEpoch, callback) {
    // Paste whitespace trimmed, as the Test button does.
    apiKey = typeof apiKey === 'string' ? apiKey.trim() : '';
    if (!apiKey) {
        // Never heals without a settings change (which forces a fetch), so it
        // clears straight away rather than through the streak latch, and ends
        // any run: the key that comes back starts a fresh one.
        console.log('[!] Rainbow radar selected but no API key is set — clearing the watch radar');
        resetKeyedStreak();
        callback(radarWire.clearRadarTuples());
        return;
    }
    var point = coords.roundLatLon(lat, lon);
    if (!point) {
        // Like the missing key: it never heals without a settings change.
        console.log('[!] Rainbow radar: the location is not a usable coordinate pair — clearing the watch radar');
        resetKeyedStreak();
        callback(radarWire.clearRadarTuples());
        return;
    }
    var done = function (tuples) { settleKeyed(tuples, slotZeroEpoch, callback); };

    /**
     * An echo-checked 200 → the resampled window. An empty or non-JSON 200
     * (an Origin-neutered runtime) never gets here: radar-fetch.js's guarded
     * JSON.parse already answers it with null.
     * @param {Object} body Parsed response.
     * @returns {?Object} Radar tuples, or null when the echo is missing or far.
     */
    function interpret(body) {
        if (!isEchoNear(body, point.lat, point.lon)) {
            console.log('[!] Rainbow radar: echoed location missing or far from the request');
            return null;
        }
        // An echo with no forecast is Rainbow seeing no rain data here: 24 zeros.
        var forecast = Array.isArray(body.forecast) ? body.forecast : [];
        return radarWire.pointRadarTuples(resampleForecast(forecast, slotZeroEpoch), slotZeroEpoch);
    }

    /**
     * One request to Rainbow, with or without the start_timestamp.
     * @param {boolean} withStart Whether to send slot 0 as start_timestamp.
     * @returns {void}
     */
    function ask(withStart) {
        radarFetch.fetchRadarJson({
            url: withStart ? buildDirectUrl(point.lat, point.lon, slotZeroEpoch) : buildDirectUrl(point.lat, point.lon),
            label: 'Rainbow',
            headers: { 'Ocp-Apim-Subscription-Key': apiKey },
            // Each answer is the key's verdict for the settings page (key-result.js).
            keyResult: { id: OWN_KEY_RADAR_ID, apiKey: apiKey },
            onTransportError: function (error, cb) {
                if (error && error.code === 'status_404') {
                    // Out of coverage: flat zeros, NOT a clear (radar-wire.js).
                    cb(radarWire.flatRadarTuples(slotZeroEpoch));
                    return true;
                }
                if (radarFetch.isRateLimited(error)) {
                    console.log('[!] Rainbow radar: request limit reached (' + error.code + ')');
                    cb(radarWire.limitedRadarTuples());
                    return true;
                }
                if (radarFetch.isKeyRejection(error)) {
                    console.log('[!] Rainbow radar: key rejected (' + error.code + ') — clearing the watch radar');
                    cb(radarWire.clearRadarTuples());
                    return true;
                }
                if (withStart && error && (error.code === 'status_400' || error.code === 'status_422')) {
                    // Rainbow takes a start_timestamp only within the past 30 min; this
                    // sends the phone's raw slot 0, so a skewed phone clock is refused.
                    // Without it Rainbow starts at "now", and resampleForecast gives the
                    // slots before forecast[0] that interval's rate, so the window is
                    // still anchored at slot 0. One retry only: ask(false) never retries.
                    console.log('[!] Rainbow radar: start time refused (' + error.code + ') — retrying without it');
                    ask(false);
                    return true;
                }
                return false;
            }
        }, interpret, done);
    }

    ask(true);
}

module.exports = {
    OWN_KEY_RADAR_ID: OWN_KEY_RADAR_ID,
    fetchRadarTuplesWithKey: fetchRadarTuplesWithKey,
    resetKeyedStreak: resetKeyedStreak
};
