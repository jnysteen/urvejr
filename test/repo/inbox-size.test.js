const test = require('node:test');
const { bakeEnv } = require('../../src/pkjs/status-bars/domain/status-lines.js');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
// The time every bake in this file runs at, where the test does not care which it is.
const NOW = new Date(2026, 5, 15, 12, 0, 0);

// holiday-mask → nager-source touches localStorage; install the mock before
// any watch module loads (see change-detector.test.js for the pattern).
global.localStorage = {
  getItem: function(k) { return null; },
  setItem: function(k, v) {},
  removeItem: function(k) {}
};

const { toRenderPayload } = require('../../src/pkjs/weather/application/render-payload');
const { buildClayPayload } = require('../../src/pkjs/settings/domain/clay-payload');
const { WEATHER_CATEGORIES } = require('../../src/pkjs/wire/adapter/outbox');
const forecastSpan = require('../../src/pkjs/weather/domain/forecast-span');
const platformLib = require('../../src/pkjs/config-ui/lib/platform');
const radarWire = require('../../src/pkjs/weather/domain/radar/radar-wire');

// Regression guard for the AppMessage inbox size.
//
// All changed payload categories ride in ONE sendAppMessage (the channel is
// half-duplex — see outbox.js), so the watch's inbox must hold the heaviest
// bundle the phone can emit in a single fetch. The worst realistic case is the
// DWD provider with all four metric lines active: four forecast-hour trends + rain
// bars + radar — so forecast + status + sun + radar all bundle together. (The
// lines' colours and styles are settings-derived and ride the Clay message.)
// Every forecast trend carries the most hours the watch is ever sent
// (forecast-span.js maxHours: 68, for the long span).
//
// This guard caught the gust-third-line overflow: the inbox was sized for
// bundled forecast+radar before the 24-byte gust series existed, so DWD+wind
// silently overflowed (APP_MSG_BUFFER_OVERFLOW → "Message dropped!").

/**
 * The forecast hours the heaviest bundle carries (NUM_ENTRIES).
 * @returns {number} 68, the long span's.
 */
function forecastEntries() {
  return forecastSpan.maxHours(platformLib.computeEnv({ platform: 'emery' }));
}
// The radar's slots: 24 five-minute frames, whatever the forecast span.
const RADAR_SLOTS = radarWire.NUM_BARS;

/**
 * The inbox size the watch opens, read from the C source.
 * @returns {number} inbox_size in bytes.
 */
function readInboxSize() {
  const src = fs.readFileSync(
    path.join(__dirname, '..', '../src/c/appendix/app_message.c'), 'utf8');
  const m = src.match(/const\s+int\s+inbox_size\s*=\s*(\d+)\s*;/);
  assert.ok(m, 'could not find inbox_size in app_message.c');
  return parseInt(m[1], 10);
}

/**
 * Wire size of a single tuple's value, mirroring how PebbleKit JS packs it.
 * Conservative on purpose (an inbox guard should over- not under-estimate).
 * @param {*} v Tuple value.
 * @returns {number} Byte length of the packed value.
 */
function valueBytes(v) {
  if (Array.isArray(v)) { return v.length; }          // byte arrays: 1 byte/elem
  if (typeof v === 'string') { return Buffer.byteLength(v) + 1; } // + NUL
  if (typeof v === 'boolean') { return 4; }           // packed as int
  if (typeof v === 'number') { return 4; }            // int32
  throw new Error('unexpected tuple value type: ' + typeof v);
}

/**
 * Pebble dictionary wire size: 1 count byte + per tuple a 7-byte header
 * (4-byte key + 1-byte type + 2-byte length) plus the value bytes.
 * @param {Object} payload AppMessage key→value map.
 * @returns {number} Total dictionary byte size.
 */
function dictSize(payload) {
  return Object.keys(payload).reduce(function(sum, key) {
    return sum + 7 + valueBytes(payload[key]);
  }, 1);
}

/**
 * Project a full transformed payload through the weather outbox categories.
 * This mirrors the first send, where every present category has changed.
 * @param {Object} payload Full transformed weather payload.
 * @returns {Object} AppMessage payload after outbox category filtering.
 */
function buildWeatherOutboxPayload(payload) {
  const outgoing = {};
  WEATHER_CATEGORIES.forEach(function(category) {
    category.keys.forEach(function(key) {
      if (Object.prototype.hasOwnProperty.call(payload, key)) {
        outgoing[key] = payload[key];
      }
    });
  });
  return outgoing;
}

// The weather alerts' entry tuple cap (status-wire.js and alert_set.h
// ALERT_ENTRIES_MAX_BYTES): the bundle budgets the tuple at it.
const ALERT_ENTRIES_CAP = require('../../src/pkjs/alerts/domain/status-wire').ALERT_ENTRIES_MAX_BYTES;

// Emery's graph styles at their heaviest on the weather message: three screens, each on a style
// of its own, drawing six series between them. The first style's four lines take their rows,
// style 2 adds the rain chance as a stripe (a fifth series: the spare row,
// SPARE_LINE_TREND_UINT8) and style 3 cloud cover (a sixth, which no row is left for: dropped,
// never sent). graph-styles.js assign.
const HEAVIEST_GRAPHS = {
  layoutPreset: 'custom', radarMode: 'graph', viewCount: '3',
  viewTop0: 'cal', viewBody0: 'forecast', viewStyle0: '1',
  viewTop1: 'none', viewBody1: 'forecast', viewStyle1: '2',
  viewTop2: 'none', viewBody2: 'forecast', viewStyle2: '3',
  forecastHours: '48',
  graphStyles: JSON.stringify({ names: ['', '', ''], styles: [null,
    { secondaryLine: 'gust', thirdLine: 'wind', fourthLine: 'precip_prob', fourthLineStyle: 'stripeTop',
      fifthLine: 'uv', barSource: 'off', forecastHours: '24' },
    { secondaryLine: 'uv', thirdLine: 'cloud', fourthLine: 'off', fifthLine: 'off', barSource: 'rain',
      forecastHours: '12' }] }),
};

// Emery's bars 4 to 6 at their heaviest: all three made (the New status bar button), every slot a
// full city like the other bars' below, and HEAVIEST_GRAPHS' three screens showing all six
// bars between them: the bake sends only the lines of bars a screen shows
// (status-line-catalog.js bakedLines). On another watch the rows mean nothing (no custom
// layout there) and bars 4 to 6 do not exist.
const HEAVIEST_EXTRA_BARS = {
  viewUpper0: 'weather', viewLower0: 'radar', viewUpper1: 'health', viewLower1: 'bar4',
  viewUpper2: 'bar5', viewLower2: 'bar6'
};
['statusBar4', 'statusBar5', 'statusBar6'].forEach(function(prefix) {
  HEAVIEST_EXTRA_BARS[prefix + 'Made'] = true;
  ['Left', 'Mid', 'Right'].forEach(function(slot) { HEAVIEST_EXTRA_BARS[prefix + slot] = 'city'; });
});

/**
 * Build the heaviest single AppMessage the phone can emit (DWD + wind).
 * It carries 68 forecast hours, the graph styles' spare row (HEAVIEST_GRAPHS) and bars 4 to
 * 6's lines (HEAVIEST_EXTRA_BARS).
 * @param {Object} [over] Settings laid over the heaviest ones.
 * @returns {Object} The outgoing AppMessage payload.
 */
function buildHeaviestBundle(over) {
  const N = forecastEntries();
  const range = Array.from({ length: N }, function(_, i) { return i; });
  const radarRange = Array.from({ length: RADAR_SLOTS }, function(_, i) { return i; });

  // Base forecast payload as provider.getPayload emits it (pre-series): raw
  // whole-degree temps; toRenderPayload (applyForecastSeries) encodes them to the N wire bytes.
  const payload = {
    TEMP_RAW_TREND: range.map(function() { return 25; }), // -> N TEMP_TREND_UINT8 bytes
    TEMP_MIN: -10,
    TEMP_MAX: 35,
    PRECIP_TREND_UINT8: range.map(function() { return 100; }),
    RAIN_TREND_UINT8: range.map(function() { return 50; }),
    WIND_TREND_UINT8: range.map(function() { return 60; }),
    GUST_TREND_UINT8: range.map(function() { return 90; }), // non-zero → gust line ON
    UV_TREND_UINT8: range.map(function() { return 80; }),   // non-zero → uv fourth line ON
    FORECAST_START: 1700000000,
    NUM_ENTRIES: N,
    CURRENT_TEMP: 20,
    // A long real-world city name (UTF-8), so the guard keeps headroom for them.
    CITY: 'Mönchengladbach-Ost',
    // start-type byte + two int32 epoch timestamps (handle_sun_events reads two).
    SUN_EVENTS: [0].concat(
      Array.prototype.slice.call(new Uint8Array(new Int32Array([1700000000, 1700040000]).buffer))),
  };

  // PKJS resolves the render-ready series; worst case = secondary line + a
  // distinct third, fourth and fifth line (four N-byte trends) + rain bars.
  // The weather alerts' entries at their heaviest: every metric alert placed on a bar,
  // every one printing its value, and every one alerting (UV 8, wind 60, gusts 90,
  // AQI 152, pollen 2-3 — at or past each seed pair). The AQI and pollen readings are
  // transient bake inputs.
  const alertSettings = require('../helpers/on-demand.js').placedOnly(['gust', 'uv', 'aqi', 'pollen', 'wind'], {
    provider: 'dwd',
    alertUvDisplay: 'value', alertWindDisplay: 'value', alertGustDisplay: 'value',
    alertAqiDisplay: 'value', alertPollenDisplay: 'value'
  });
  payload.AQI_TREND = range.map(function() { return 152; });
  payload.POLLEN_TODAY = '2-3';
  toRenderPayload(payload, Object.assign({
    secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'uv', fifthLine: 'precip_prob',
    secondaryLineFill: false, barSource: 'rain', windScale: 'high',
    temperatureUnits: 'c', axisTimeFormat: '12h', timeShowAmPm: true,
    healthMode: 'all', radarProvider: 'rainbow',
    // Heaviest realistic selections: 'city' truncates payload.CITY to each
    // slot's text cap, so every edge slot packs its full 8-byte EDGE_TEXT_MAX
    // (wind/gust top out around 7 bytes -- "255km/h" -- and would under-model
    // the true worst case) and every mid slot packs its full 19-byte
    // MID_TEXT_MAX off the long real-world city name above. statusTopMid
    // became selectable in the top-strip polish, so the top line's mid also
    // models a full 19-byte city.
    statusForecastLeft: 'city', statusForecastRight: 'city',
    statusRadarLeft: 'city', statusRadarMid: 'city', statusRadarRight: 'city',
    statusTopLeft: 'city', statusTopMid: 'city', statusTopRight: 'city',
    statusHealthLeft: 'city', statusHealthMid: 'city', statusHealthRight: 'city'
  }, alertSettings, HEAVIEST_GRAPHS, HEAVIEST_EXTRA_BARS, over || {}),
  { platform: 'emery' }, NOW);

  // The entry tuple. The
  // realistic heaviest bake — all five with values — stays under the cap; the
  // bundle budgets the tuple AT the cap, the most the watch accepts, so a wider
  // value (a 3-digit wind in mph, a 2-digit UV) can never tip the inbox.
  if (Object.prototype.hasOwnProperty.call(payload, 'ALERT_ENTRIES_UINT8')) {
    assert.ok(payload.ALERT_ENTRIES_UINT8.length > 0 &&
      payload.ALERT_ENTRIES_UINT8.length <= ALERT_ENTRIES_CAP, 'the real bake stays under the cap');
    payload.ALERT_ENTRIES_UINT8 = new Array(ALERT_ENTRIES_CAP).fill(0);
  }

  // Radar (DWD supplies it) — two 24-slot trends + a start epoch. The radar keeps its
  // 24 frames on every forecast span.
  payload.RAIN_RADAR_TREND_UINT8 = radarRange.map(function() { return 7; });
  payload.RAIN_RADAR_TREND_AREA_UINT8 = radarRange.map(function() { return 7; });
  payload.RAIN_RADAR_START = 1700000000;
  // The radar's sky rows (radar-sky.js packSky: 5 B header + 10 cloud + 10 sun +
  // 2 B lightning mask: the window's nine quarter hours and the one that carries the
  // sky to the next half-hour request).
  const radarSky = require('../../src/pkjs/weather/domain/radar/radar-sky.js');
  payload.RADAR_SKY_UINT8 = radarSky.packSky({
    start: 1700000000, clouds: Array(radarSky.NUM_SLOTS).fill(250), suns: Array(radarSky.NUM_SLOTS).fill(250),
    bolts: Array(radarSky.NUM_SLOTS).fill(true)
  });

  // Sleep state rides in the same bundle.
  payload.IS_SLEEPING = false;

  // The transformed payload has baked all four packed lines and removed the
  // legacy temp/city transients before the outbox projects transmitted keys.
  return buildWeatherOutboxPayload(payload);
}

// A cleared notice can ride the weather message as an empty string; a real
// notice never coexists with a full bundle (it's a failure-time signal), but
// model the conservative "full bundle + cleared notice" combination against the
// hard inbox ceiling so the NOTICE_TEXT key is proven to still fit.
function buildHeaviestBundleWithNotice() {
  const bundle = buildHeaviestBundle();
  bundle.NOTICE_TEXT = '';
  return bundle;
}

// The heaviest bundle, recorded exactly (bytes), against the inbox: the one place the size is
// asserted. Update the figure here when its wire contract changes (the git log of this file
// holds how it grew). It carries the long span's 68 hours, the graph styles' spare row and bars
// 4 to 6's lines (below).
const WEATHER_BUNDLE = 1097;
const INBOX = 1280;
// One of bars 4 to 6's lines with a full city in every slot, as the other bars' lines carry
// it: a 7 B tuple header and three slots' packed bytes (status-lines.js).
const EXTRA_LINE_BYTES = 51;

test('heaviest bundled payload (DWD + wind) fits the watch inbox', function() {
  const inbox = readInboxSize();
  const size = dictSize(buildHeaviestBundleWithNotice());
  assert.ok(
    size <= inbox,
    'bundled DWD+wind payload is ' + size + ' B but inbox_size is only ' + inbox +
    ' B — the message would be dropped (APP_MSG_BUFFER_OVERFLOW). Bump inbox_size.');
});

// Graph styles (emery, 3.0.0): the shown styles' series share the weather message's five metric
// rows (graph-styles.js assign). A fifth series rides the spare row's trend, one more 68-hour
// tuple (75 B); a sixth is dropped, never sent. One graph, or a union of four, sends no spare.
test('graph styles: a fifth series rides the spare row, a sixth is never sent', () => {
  const styled = buildHeaviestBundle();
  assert.equal(dictSize(styled), WEATHER_BUNDLE);
  ['SECONDARY_LINE_TREND_UINT8', 'THIRD_LINE_TREND_UINT8', 'FOURTH_LINE_TREND_UINT8',
    'FIFTH_LINE_TREND_UINT8', 'SPARE_LINE_TREND_UINT8', 'BAR_TREND_UINT8'].forEach((key) =>
    assert.equal(styled[key].length, forecastEntries(), key));
  const plain = buildHeaviestBundle({ viewStyle1: '1', viewStyle2: '1' });
  assert.equal(Object.prototype.hasOwnProperty.call(plain, 'SPARE_LINE_TREND_UINT8'), false,
    'every screen on the first graph: no spare');
  assert.equal(dictSize(plain), WEATHER_BUNDLE - (7 + forecastEntries()), 'the spare\'s 75 B');
});

// Bars 4 to 6 (emery, 3.0.0): the line of each one a screen shows rides the status category
// like the other four, a whole line apiece at its heaviest; a bar that is not made, or on no
// screen, sends none. The inbox grew 1024 -> 1280 B for them.
test('bars 4 to 6: a shown bar\'s line rides the status category, one on no screen sends none', () => {
  const EXTRA = ['STATUS_LINE_5_UINT8', 'STATUS_LINE_6_UINT8', 'STATUS_LINE_7_UINT8'];
  const made = buildHeaviestBundle();
  EXTRA.forEach((key) => assert.equal(dictSize({ [key]: made[key] }) - 1, EXTRA_LINE_BYTES, key));
  const one = buildHeaviestBundle({ statusBar5Made: false, statusBar6Made: false });
  assert.deepEqual(EXTRA.filter((key) => key in one), ['STATUS_LINE_5_UINT8'], 'bar 4 alone is made');
  assert.equal(dictSize(one), WEATHER_BUNDLE - 2 * EXTRA_LINE_BYTES);
  const offScreen = buildHeaviestBundle({ viewUpper2: 'off', viewLower2: 'off' });
  assert.deepEqual(EXTRA.filter((key) => key in offScreen), ['STATUS_LINE_5_UINT8'],
    'bars 5 and 6 are made but on no screen');
  assert.equal(dictSize(offScreen), WEATHER_BUNDLE - 2 * EXTRA_LINE_BYTES);
});

// A side slot's weather condition takes the middle's room while its line still fits the line's
// 48 bytes (status-line-catalog.js widenEdges; the owner's, 2026-11-14), so a line can grow
// past the heaviest bundle's (City in every slot: 44 B) up to that cap. Every line at the cap
// still fits the inbox with the 10 B headroom floor.
test('every status line at its 48-byte cap still fits the inbox, with the headroom floor', () => {
  const LINE_MAX = require('../../src/pkjs/status-bars/domain/status-line-catalog.js').CAPS.LINE_MAX;
  const bundle = buildHeaviestBundleWithNotice();
  const keys = Object.keys(bundle).filter((k) => /^STATUS_LINE_\d_UINT8$/.test(k));
  assert.ok(keys.length > 0, 'premise, the bundle carries status lines');
  keys.forEach((k) => assert.ok(bundle[k].length <= LINE_MAX, k + ' within the cap'));
  const grown = dictSize(bundle) + keys.reduce((sum, k) => sum + LINE_MAX - bundle[k].length, 0);
  const headroom = readInboxSize() - grown;
  assert.ok(headroom >= 10, grown + ' B with every line at the cap, headroom '
    + headroom + ' B is below the 10 B floor');
  // The heaviest bake of a widened line: both side slots' names beside an empty middle (47 B).
  const lines = require('../../src/pkjs/status-bars/domain/status-lines.js');
  const catalog = require('../../src/pkjs/status-bars/domain/status-line-catalog.js');
  const wide = lines.packLine(catalog.lineById('forecast'), { CURRENT_CONDITION: 'partly' },
    { statusForecastLeft: 'condition', statusForecastMid: 'empty', statusForecastRight: 'condition' },
    { platform: 'emery', color: true }, null, bakeEnv(NOW));
  assert.equal(wide.length, 47);
});

test('the heaviest weather bundle and inbox, recorded', () => {
  const bundle = buildHeaviestBundle();
  const size = dictSize(bundle);
  const inbox = readInboxSize();
  console.log(`heaviest weather bundle: ${size} B of ${inbox} B (headroom ${inbox - size})`);
  assert.equal(inbox, INBOX, 'inbox_size');
  assert.equal(size, WEATHER_BUNDLE, 'update the recorded bundle size');
  assert.ok(inbox - size >= 10, `headroom ${inbox - size} B is below the 10 B floor`);
  const hours = forecastEntries();
  assert.equal(bundle.NUM_ENTRIES, hours, 'NUM_ENTRIES');
  assert.equal(bundle.TEMP_TREND_UINT8.length, hours, 'forecast hours');
  assert.equal(bundle.RAIN_RADAR_TREND_UINT8.length, RADAR_SLOTS, 'the radar keeps 24 slots');
  // With a cleared notice riding along (the inbox ceiling test above): +8 B.
  assert.equal(dictSize(buildHeaviestBundleWithNotice()), 1105);
  assert.ok(INBOX - 1105 >= 10, 'the cleared-notice bundle keeps the 10 B floor');
});

// The entries ride the status category, so the heaviest bundle carries them
// whenever the status lines change — and they are the tuple the inbox grew for.
test('the heaviest bundle carries the weather alerts\' entries at their cap', () => {
  const bundle = buildHeaviestBundle();
  assert.equal(bundle.ALERT_ENTRIES_UINT8.length, 20);
  const status = WEATHER_CATEGORIES.filter(function(c) { return c.name === 'status'; })[0];
  assert.ok(status.keys.indexOf('ALERT_ENTRIES_UINT8') !== -1, 'in the status category');
});

// The radar limit notice (RAIN_RADAR_LIMITED, radar-wire.js limitedRadarTuples) is
// sent INSTEAD of the three radar tuples, never beside them: a 7 B header + its line
// ("Radar limit reached" + NUL, 20 B) replaces 7 + 24 + 7 + 24 + 7 + 4 = 73 B. So the
// recorded heaviest bundles above stay the worst case; this pins both halves.
test('the radar limit notice rides alone, so a limited bundle is lighter than the heaviest', () => {
  const radarWire = require('../../src/pkjs/weather/domain/radar/radar-wire.js');
  const limited = radarWire.limitedRadarTuples();
  const RADAR_KEYS = ['RAIN_RADAR_TREND_UINT8', 'RAIN_RADAR_TREND_AREA_UINT8', 'RAIN_RADAR_START'];
  RADAR_KEYS.forEach(function(k) {
    assert.equal(Object.prototype.hasOwnProperty.call(limited, k), false, k + ' never rides with the notice');
  });
  const radarCategory = WEATHER_CATEGORIES.filter(function(c) { return c.name === 'radar'; })[0];
  assert.ok(radarCategory.keys.indexOf('RAIN_RADAR_LIMITED') !== -1, 'the notice is in the radar category');
  const heaviest = buildHeaviestBundle();
  const withNotice = Object.assign({}, heaviest);
  RADAR_KEYS.forEach(function(k) { delete withNotice[k]; });
  Object.assign(withNotice, limited);
  const size = dictSize(buildWeatherOutboxPayload(withNotice));
  assert.equal(size, dictSize(heaviest) - 73 + 27, 'the notice costs 27 B in place of 73 B');
  assert.ok(size <= dictSize(heaviest), 'a limited bundle is at most the heaviest');
});

// The out-of-coverage answer (radar-wire.js outOfCoverageRadarTuples) is the clear plus
// the source's line: 7 + 0 + 7 + 0 + 7 + 4 = 25 B of empty arrays and a zero start, and
// a 7 B header + at most 31 B of line + NUL, so at most 64 B in place of the window's
// 73 B: an out-of-coverage bundle is never heavier than the heaviest. The same shape
// carries DWD's no-data line (its second 404 in a row from inside its area).
test('the out-of-coverage and no-data answers are lighter than the radar window they replace', () => {
  const radarWire = require('../../src/pkjs/weather/domain/radar/radar-wire.js');
  const radarCoverage = require('../../src/pkjs/weather/domain/radar/radar-coverage.js');
  const lines = [];
  Object.keys(radarCoverage.COVERAGE).forEach(function(id) {
    lines.push([id, radarCoverage.watchText(id)]);
    if (radarCoverage.noDataText(id)) { lines.push([id + ' no data', radarCoverage.noDataText(id)]); }
  });
  assert.deepEqual(lines.map(function(l) { return l[1]; }),
    ['DWD radar: Germany only', 'DWD: no radar data', 'Met.no radar: Nordics only']);
  lines.forEach(function(entry) {
    const label = entry[0];
    const line = entry[1];
    assert.ok(Buffer.byteLength(line) <= 31, label + ': within the watch\'s 32 B notice buffer');
    const heaviest = buildHeaviestBundle();
    const outside = Object.assign({}, heaviest, radarWire.outOfCoverageRadarTuples(line));
    const size = dictSize(buildWeatherOutboxPayload(outside));
    assert.equal(size, dictSize(heaviest) - 73 + 25 + 7 + Buffer.byteLength(line) + 1, label);
    assert.ok(size < dictSize(heaviest), label + ': lighter than the heaviest');
  });
});

// The graph styles at their heaviest (emery only): three screens, each on a style of its own,
// every style with rain bars in multicolor (a 5-stop palette), so all three records ride at
// their 41 B (src/c/appendix/graph_style.h GRAPH_STYLE_MAX_BYTES).
const HEAVIEST_STYLES = {
  layoutPreset: 'custom', radarMode: 'graph', viewCount: '3',
  viewTop0: 'cal', viewBody0: 'forecast', viewStyle0: '1',
  viewTop1: 'none', viewBody1: 'forecast', viewStyle1: '2',
  viewTop2: 'none', viewBody2: 'forecast', viewStyle2: '3',
  barSource: 'rain',
  graphStyles: JSON.stringify({ names: ['', 'Long', 'Short'], styles: [null,
    { barSource: 'rain', rainBarColor: 'multicolor', forecastHours: '48' },
    { barSource: 'rain', rainBarColor: 'multicolor', forecastHours: '12' }] }),
};

/**
 * The heaviest Clay settings message (the palette tuples included).
 * @param {?Object} [watchInfo] The watch it is packed for; emery by default.
 * @param {Object} [over] Settings laid over the heaviest ones (HEAVIEST_STYLES for emery's).
 * @returns {Object} The payload.
 */
function buildHeaviestClayMessage(watchInfo, over) {
  const payload = buildClayPayload(Object.assign({
    temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '12h',
    weekStartDay: 'mon', firstWeek: 'prev', timeFont: 'bitham', showQt: true,
    btIcons: 'both', vibe: true, timeShowAmPm: true, dayNightShading: true,
    fetchIntervalMin: '30', holidayCountry: 'US', holidaysEnabled: true,
    rainBarColor: 'multicolor', radarColor: 'multicolor', rainCountdownHorizon: '120',
    // The theme must stay COLOUR-capable: a bw theme collapses the bar and radar
    // palettes to a single stop and understates the worst case.
    healthMode: 'all', theme: 'dark', largeGraphFont: true,
    // Worst-case custom no-rain text: the full 24-byte UTF-8 cap (CLAY_NORAIN_TEXT
    // packs it + NUL; clay-payload truncates anything longer at pack time).
    radarNoRainText: 'Kein Regen in Sichtweite',
    // The low-battery takeover switched on: no watch is sent its tuple any more.
    batteryLowOnly: true,
    // Draw from / Bars from on Top: their flags are bits of the line-style bytes and the
    // two palettes (draw-from.js), no byte of their own, so the recorded sizes hold
    // whatever they say.
    precipLineFrom: 'top', cloudLineFrom: 'top', windLineFrom: 'top', uvLineFrom: 'top',
    rainBarFrom: 'top', radarBarFrom: 'top',
    // Double flick on: bit 8 of CLAY_VIEW_RESET_MIN's int (clay-payload.js
    // packViewReset), no byte of its own, so the recorded sizes hold.
    viewResetMin: '10', doubleFlick: true,
    // The forecast's left axis options (emery) at their busiest: bits 2 and 5 of the
    // CLAY_LARGE_GRAPH_FONT int (forecast-axis.js), no byte of their own, so the recorded
    // sizes hold.
    forecastAxisNumbers: 'graph', forecastAxisScale: true, secondaryLine: 'dew',
  }, over || {}), watchInfo === undefined ? { platform: 'emery' } : watchInfo, new Date('2026-06-26T00:00:00Z'));

  // The Dim backlight tuple (CLAY_NIGHT_LIGHT_UINT8 = [r, g, b, startHour, endHour])
  // is REAL now: buildClayPayload packs it for every platform (night-light.js), so it
  // is already in the payload above rather than reserved by hand here. The budget it
  // was reserved with is unchanged, because the byte count never depended on the
  // values:
  //
  //   tuple  = 7 B header (4 B key + 1 B type + 2 B length) + 5 B data = 12 B
  //   message 499 B -> 511 B of the 536 B inbox, headroom 37 -> 25 B
  //   spendable above the 10 B floor: 27 B before, 15 B after
  //
  // A 5-byte array, not five scalars: an array tuple costs 7 + N while each scalar
  // costs 7 + 4, so the five would be 55 B instead of 12 B.
  assert.equal(payload.CLAY_NIGHT_LIGHT_UINT8.length, 5,
    'the Dim backlight tuple must stay 5 bytes — the budget below is recorded with it');
  return payload;
}

test('Clay settings message (with palette) fits the watch inbox', function() {
  const inbox = readInboxSize();
  [null, HEAVIEST_STYLES].forEach((over) => {
    const size = dictSize(buildHeaviestClayMessage({ platform: 'emery' }, over));
    assert.ok(size <= inbox, 'the Clay message is ' + size
      + ' B but inbox_size is only ' + inbox + ' B — bump inbox_size.');
  });
});

// The graph styles' records (CLAY_GRAPH_STYLE_1..3_UINT8, 3.0.0) ride the Clay bundle: three
// empty tuples (3 x 7 B) while the first style alone is shown, which clear the watch's records,
// and at their heaviest three records of 7 B header + 41 B (HEAVIEST_STYLES). Beside them bars 4
// to 6's On demand cells (CLAY_OD_EXTRA_UINT8: 7 B header + 10 B, one per item). Recorded
// exactly, so the next task that adds a key sees the running total move.
test('the Clay message keeps its recorded sizes, at most 670 B of its 1280 B', () => {
  const inbox = readInboxSize();
  const plain = buildHeaviestClayMessage({ platform: 'emery' });
  assert.deepEqual([plain.CLAY_GRAPH_STYLE_1_UINT8, plain.CLAY_GRAPH_STYLE_2_UINT8,
    plain.CLAY_GRAPH_STYLE_3_UINT8], [[], [], []], 'the first style alone: three empty tuples');
  assert.equal(plain.CLAY_OD_EXTRA_UINT8.length, 10, 'bars 4 to 6\'s cells, one byte per item');
  assert.equal(dictSize(plain), 547, 'update the recorded Clay message size when its wire contract changes');
  assert.equal(Object.prototype.hasOwnProperty.call(plain, 'CLAY_BATTERY_LOW_ONLY'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(plain, 'CLAY_SHOW_QT'), false, 'nothing reads it since aplite went');
  const styled = buildHeaviestClayMessage({ platform: 'emery' }, HEAVIEST_STYLES);
  ['CLAY_GRAPH_STYLE_1_UINT8', 'CLAY_GRAPH_STYLE_2_UINT8', 'CLAY_GRAPH_STYLE_3_UINT8'].forEach((k) =>
    assert.equal(styled[k].length, 41, k + ': a whole record with a 5-stop palette'));
  const size = dictSize(styled);
  console.log(`heaviest Clay message: ${size} B of ${inbox} B (headroom ${inbox - size})`);
  assert.equal(size, 670, 'update the recorded size when the records change');
  assert.ok(inbox - size >= 10, 'the 10 B floor');
});

// The custom-layout ext word rides the HIGH half of the CLAY_VIEW_0-2 int32 tuples, so
// a custom layout using every v2 field costs exactly what a preset does: 0 B. And every
// view word must stay a non-negative int32 (bit 31 clear) — pypkjs throws on larger
// values and libpebble3 retypes them to UInt.
test('a custom layout with a non-zero ext word costs no Clay bytes and keeps bit 31 clear', () => {
  const presetSize = dictSize(buildHeaviestClayMessage());
  const payload = buildClayPayload({
    temperatureUnits: 'c', timeLeadingZero: true, axisTimeFormat: '12h',
    weekStartDay: 'mon', firstWeek: 'prev', timeFont: 'bitham', showQt: true,
    btIcons: 'both', vibe: true, timeShowAmPm: true, dayNightShading: true,
    fetchIntervalMin: '30', holidayCountry: 'US', holidaysEnabled: true,
    rainBarColor: 'multicolor', radarColor: 'multicolor', rainCountdownHorizon: '120',
    healthMode: 'all', theme: 'dark', largeGraphFont: true,
    radarNoRainText: 'Kein Regen in Sichtweite',
    layoutPreset: 'custom', radarMode: 'graph', viewCount: '3',
    viewTop0: 'cal2', viewBody0: 'none', viewUpper0: 'weather', viewLower0: 'off',
    viewOrder0: 'ABCT', viewAlign0: 'bottom',
    viewTop1: 'none', viewBody1: 'none', viewUpper1: 'weather', viewLower1: 'radar',
    viewOrder1: 'TACB', viewClockOff1: false, viewStripOff1: true, viewAlign1: 'center',
    viewTop2: 'radar', viewBody2: 'none', viewUpper2: 'off', viewLower2: 'off',
    viewOrder2: 'CTAB', viewClockOff2: true, viewStripOff2: true, viewAlign2: 'top',
  }, { platform: 'emery' }, new Date('2026-06-26T00:00:00Z'));
  assert.equal(dictSize(payload), presetSize, 'the ext word is free');
  ['CLAY_VIEW_0', 'CLAY_VIEW_1', 'CLAY_VIEW_2'].forEach((k) => {
    const v = payload[k];
    assert.ok(Number.isInteger(v) && v >= 0, k + ' is a non-negative integer');
    assert.equal(v >>> 31, 0, k + ' keeps bit 31 clear');
    assert.notEqual(v >>> 16, 0, k + ' carries a non-zero ext word here');
  });
});
