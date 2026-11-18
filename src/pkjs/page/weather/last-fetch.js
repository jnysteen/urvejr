// src/pkjs/page/weather/last-fetch.js — ES5, WebView. The last-fetch summary under the
// Force weather fetch row: it reads the JSON strings the phone side stashed in `userData`
// and draws no SVG.
/* global PConf */
// The `.blocks` test is not redundant. lib/color.js and lib/schema-walk.js
// each do `global.PConf = global.PConf || {}` to attach their own shard, and
// line-style.js pulls both in — so under Node, from the second preview file onwards,
// global.PConf EXISTS while carrying no block registry unless engine.js was loaded
// first. The page and every test do load it first; without the test, a require of
// this file on its own would pick that shard up and throw on the register below.
var PConf = (typeof global !== 'undefined' && global.PConf && global.PConf.blocks)
    ? global.PConf
    : (typeof window !== 'undefined' && window.PConf) ? window.PConf
    : (typeof PConf !== 'undefined' && PConf) ? PConf
    : { blocks: { register: function () {}, get: function () {} } };
(function () {
    /**
     * Parse a JSON string handed over in userData, tolerating absent/corrupt values.
     * @param {?string} v The raw string, or null/undefined.
     * @returns {?Object} The parsed value, or null.
     */
    function parseStoredJson(v) {
        if (v === null || typeof v === 'undefined') { return null; }
        try { return JSON.parse(v); } catch (e) { return null; }
    }

    // The page's one escape helper (config-ui/lib/html.js, concatenated ahead of every app
    // file): the last-fetch line prints stored names and the phone's own error message.
    var esc = (typeof require !== 'undefined')
        ? require('../../config-ui/lib/html.js').esc : PConf.html.esc;

    /**
     * The last-fetch summary line, plus the last failed attempt when it is newer
     * than the last success. Ported from inject.js:309-334.
     * @param {Object} state Live settings (unused).
     * @param {Object} env Config-UI environment facts (unused).
     * @param {Object} [userData] Page userData; reads lastFetchSuccess/lastFetchAttempt.
     * @returns {string} HTML markup.
     */
    function lastFetch(state, env, userData) {
        var lastFetchSuccess = parseStoredJson(userData && userData.lastFetchSuccess);
        var lastFetchSuccessTime = null;
        var html = '';
        var date;
        var lastFetchAttempt;
        var attemptDate;
        var attemptTime;
        var shouldShowLastAttempt;
        var attemptText;

        html += '<b>Last fetch:</b> ';
        if (lastFetchSuccess !== null) {
            date = new Date(lastFetchSuccess.time);
            lastFetchSuccessTime = date.getTime();
            html += date.toLocaleDateString() + ' ' + date.toLocaleTimeString() + ' with ' + esc(lastFetchSuccess.name);
        } else {
            html += 'Never';
        }

        lastFetchAttempt = parseStoredJson(userData && userData.lastFetchAttempt);
        if (lastFetchAttempt !== null) {
            if (lastFetchAttempt.error) {
                attemptDate = new Date(lastFetchAttempt.time);
                attemptTime = attemptDate.getTime();
                shouldShowLastAttempt = !Boolean(lastFetchSuccessTime) || attemptTime > lastFetchSuccessTime;

                if (shouldShowLastAttempt) {
                    attemptText = '<br>Last failed attempt:<br>';
                    attemptText += attemptDate.toLocaleDateString() + ' ' + attemptDate.toLocaleTimeString() + ' with ' + esc(lastFetchAttempt.name);
                    attemptText += '<br>Error: ' + esc(lastFetchAttempt.error.stage) + ': ' + esc(lastFetchAttempt.error.code);
                    // The phone's own reason, when it gave one (a location error's message).
                    if (typeof lastFetchAttempt.error.detail === 'string' && lastFetchAttempt.error.detail !== '') {
                        attemptText += ' (' + esc(lastFetchAttempt.error.detail) + ')';
                    }
                    html += attemptText;
                }
            }
        }

        return html;
    }

    PConf.blocks.register('lastFetch', lastFetch);

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = { lastFetch: lastFetch };
    }
})();
