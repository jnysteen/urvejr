// src/pkjs/weather/adapter/radar-factory.js
//
// Data-driven radar-source construction, mirroring provider-factory.js. The
// RADAR_FACTORIES table maps a radar source id to a builder that returns an
// adapter exposing the single radar seam:
//
//   fetchRadarTuplesAt(lat, lon, slotZeroEpoch, cb)
//
// where cb receives radar tuples, or null for a TRANSIENT source failure (the
// radar keys stay out of the send; the watch keeps its last window and
// self-advances it as for a dedupe skip). A failure that cannot heal on its
// own (a missing or rejected key) answers clearRadarTuples() instead, so the
// watch drops the radar rather than rolling it into a made-up "No rain ahead",
// and a request limit (HTTP 429) on the sources that have one answers
// limitedRadarTuples(), so the watch says "Radar limit reached" — see
// radar-fetch.js. Per-source config (a user's API key) is bound at construction
// via cfg. 'disabled' is a real registered adapter that clears the watch's radar
// -- no special case -- and any unknown/unset id falls back to it. Adding a radar
// source is a new table entry; the fetch cycle (fetch-cycle.js) never learns
// source names.
//
// Source ids are the Clay radarProvider values ('rainbowkey', OWN_KEY_RADAR_ID, is
// "Rainbow" on the user's own key), plus one internal id that is never stored:
// 'disabled' (radar off, and the fallback).

var radar = require('./radar/dwd-radar.js');
var metnoRadar = require('./radar/metno-radar.js');
var rainbowRadar = require('./radar/rainbow-radar.js');
var tomorrowioRadar = require('./radar/tomorrowio-radar.js');
var radarWire = require('../domain/radar/radar-wire.js');

var DEFAULT_RADAR_ID = 'disabled';
// "Rainbow" (rainbow-radar.js, which owns the id: it records the key's answers
// under it, and this module requires that one).
var OWN_KEY_RADAR_ID = rainbowRadar.OWN_KEY_RADAR_ID;

var RADAR_FACTORIES = {
    dwd: function(cfg) {
        return { fetchRadarTuplesAt: radar.fetchRadarTuplesAt };
    },
    metno: function(cfg) {
        return { fetchRadarTuplesAt: metnoRadar.fetchRadarTuplesAt };
    },
    rainbowkey: function(cfg) {
        return {
            fetchRadarTuplesAt: function(lat, lon, slotZeroEpoch, cb) {
                rainbowRadar.fetchRadarTuplesWithKey(cfg.rainbowApiKey, lat, lon, slotZeroEpoch, cb);
            }
        };
    },
    tomorrowio: function(cfg) {
        return {
            fetchRadarTuplesAt: function(lat, lon, slotZeroEpoch, cb) {
                tomorrowioRadar.fetchRadarTuplesAt(cfg.tomorrowioApiKey, lat, lon, slotZeroEpoch, cb);
            }
        };
    },
    disabled: function(cfg) {
        return {
            fetchRadarTuplesAt: function(lat, lon, slotZeroEpoch, cb) {
                cb(radarWire.clearRadarTuples());
            }
        };
    }
};

/**
 * Whether a Clay radarProvider id has a registered factory.
 *
 * @param {string} radarId Clay radarProvider id.
 * @returns {boolean} True when the id maps to a known radar source.
 */
function isKnownRadarSource(radarId) {
    return Object.prototype.hasOwnProperty.call(RADAR_FACTORIES, radarId);
}

/**
 * Whether a setting holds a usable string: non-blank once paste whitespace is
 * trimmed (the keyed adapters trim before deciding a key is missing).
 * @param {*} value Setting value.
 * @returns {boolean} True for a string with a non-whitespace character.
 */
function isNonBlank(value) {
    return typeof value === 'string' && value.trim() !== '';
}

/**
 * Can this radar source ever answer with this config? False for the sources that
 * clear the watch's radar on every fetch: the 'disabled' clear (and any unknown id),
 * tomorrow.io or Rainbow without a key — the same checks the adapters make
 * (rainbow-radar.js, tomorrowio-radar.js). A rejected key is found out per fetch and
 * is not covered here.
 * @param {string} radarId Clay radarProvider id.
 * @param {Object} cfg Per-source config, as for createRadarSource.
 * @returns {boolean} True when a fetch can bring radar frames.
 */
function canAnswer(radarId, cfg) {
    if (!isKnownRadarSource(radarId) || radarId === DEFAULT_RADAR_ID) { return false; }
    if (radarId === 'tomorrowio') { return isNonBlank(cfg && cfg.tomorrowioApiKey); }
    if (radarId === OWN_KEY_RADAR_ID) { return isNonBlank(cfg && cfg.rainbowApiKey); }
    return true;
}

/**
 * Construct the radar source for a Clay radarProvider id. Unknown or unset ids
 * fall back to the 'disabled' source (clears the watch's radar), matching the
 * legacy default-off behavior.
 *
 * @param {string} radarId Radar source id ('dwd', 'metno', 'rainbowkey', 'tomorrowio': the
 *   settings' radarProvider; 'disabled' while radar is off).
 * @param {Object} cfg Per-source config.
 * @param {string} cfg.rainbowApiKey The user's own Rainbow API key for 'rainbowkey' ('' when unset; the adapter clears the watch's radar).
 * @param {string} cfg.tomorrowioApiKey tomorrow.io API key ('' when unset; the adapter clears the watch's radar).
 * @returns {{fetchRadarTuplesAt: Function}} Radar-source adapter satisfying the seam.
 */
function createRadarSource(radarId, cfg) {
    // Every radar step builds its source here, so this is where the keyed Rainbow path
    // learns it stopped being the radar in use: another source (or radar off) ends its
    // run of nulls (rainbow-radar.js resetKeyedStreak), and coming back starts afresh.
    if (radarId !== OWN_KEY_RADAR_ID) { rainbowRadar.resetKeyedStreak(); }
    var factory = isKnownRadarSource(radarId) ? RADAR_FACTORIES[radarId] : RADAR_FACTORIES[DEFAULT_RADAR_ID];
    return factory(cfg);
}

module.exports = {
    DEFAULT_RADAR_ID: DEFAULT_RADAR_ID,
    OWN_KEY_RADAR_ID: OWN_KEY_RADAR_ID,
    RADAR_FACTORIES: RADAR_FACTORIES,
    isKnownRadarSource: isKnownRadarSource,
    canAnswer: canAnswer,
    createRadarSource: createRadarSource
};
