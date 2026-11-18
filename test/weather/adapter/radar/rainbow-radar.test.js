const test = require('node:test');
const assert = require('node:assert/strict');

// Mock the shared XHR BEFORE requiring the module under test: rainbow-radar.js
// captures WeatherProvider.request at load time (same pattern as dwd.test.js).
const WeatherProvider = require('../../../../src/pkjs/weather/adapter/provider.js');
var responder;
WeatherProvider.request = function(url, type, onSuccess, onError, headers, body) {
  responder(url, type, onSuccess, onError, headers, body);
};
const rainbowRadar = require('../../../../src/pkjs/weather/adapter/radar/rainbow-radar.js');
const radarWire = require('../../../../src/pkjs/weather/domain/radar/radar-wire.js');

const SLOT0 = 1700000100;   // 5-min aligned (1700000100 % 300 === 0)
const SLOT = 300;
const N = 24;

function zeros() { return new Array(N).fill(0); }

// A 200 for the keyed request, with the echo Rainbow sends unless the body has one.
function respondWith(body) {
  const withEcho = Object.assign({ latitude: 52.5, longitude: 13.4 }, body);
  responder = function(url, type, onSuccess) { onSuccess(JSON.stringify(withEcho)); };
}

function fetchTuples(cb) {
  rainbowRadar.resetKeyedStreak();
  rainbowRadar.fetchRadarTuplesWithKey('KEY', 52.5, 13.4, SLOT0, cb);
}

test('maps forecast intervals onto 5-min slots (mm/h ×10)', () => {
  // Interval covering slots 0-1 at 1.2 mm/h, an explicit dry interval for
  // slots 2-3, then 0.5 mm/h through the rest of the 2 h window.
  respondWith({ longitude: 13.4, latitude: 52.5, forecast: [
    { precipRate: 1.2, precipType: 'rain', timestampBegin: SLOT0,            timestampEnd: SLOT0 + 2 * SLOT },
    { precipRate: 0,   precipType: 'rain', timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 4 * SLOT },
    { precipRate: 0.5, precipType: 'rain', timestampBegin: SLOT0 + 4 * SLOT, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  const expected = zeros();
  expected[0] = 12; expected[1] = 12;
  for (let i = 4; i < N; i += 1) { expected[i] = 5; }
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, expected);
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('saturates at 255 (25.5 mm/h) and rounds the ×10 scaling', () => {
  respondWith({ forecast: [
    { precipRate: 30,   timestampBegin: SLOT0,        timestampEnd: SLOT0 + SLOT },
    { precipRate: 0.16, timestampBegin: SLOT0 + SLOT, timestampEnd: SLOT0 + 2 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 255, '30 mm/h saturates the wire byte');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 2, '0.16 mm/h → round(1.6) = 2');
});

test('slot 0 before forecast[0] inherits forecast[0].precipRate (gap guard)', () => {
  // forecast starts 2 min after slot 0: slot 0 must NOT read as a spurious dry "now".
  respondWith({ forecast: [
    { precipRate: 2, timestampBegin: SLOT0 + 120, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 20, 'slot 0 inherits the first interval');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 20, 'slot 1 covered normally');
});

test('slots with no covering interval are 0 (gaps and beyond the horizon)', () => {
  respondWith({ forecast: [
    { precipRate: 1, timestampBegin: SLOT0,            timestampEnd: SLOT0 + SLOT },
    { precipRate: 1, timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 3 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.equal(out.RAIN_RADAR_TREND_UINT8[1], 0, 'uncovered gap slot is dry');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[3], 0, 'slot beyond the last interval is dry');
  assert.equal(out.RAIN_RADAR_TREND_UINT8[23], 0, 'horizon end is dry');
});

test('empty forecast → 24 zeros (out-of-coverage clear, not a failure)', () => {
  respondWith({ forecast: [] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
});

test('missing forecast field → 24 zeros', () => {
  respondWith({ longitude: 13.4, latitude: 52.5 });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
});

test('area array is always 24 zeros (a point provider has no nearby signal)', () => {
  respondWith({ forecast: [
    { precipRate: 5, timestampBegin: SLOT0, timestampEnd: SLOT0 + 24 * SLOT }
  ] });
  let out;
  fetchTuples(function(t) { out = t; });
  assert.deepEqual(out.RAIN_RADAR_TREND_AREA_UINT8, zeros());
});

const DIRECT = 'https://api.rainbow.ai/nowcast/v1/precip-global/13.4/52.5';
const CLEAR = radarWire.clearRadarTuples();
// The three-interval forecast of the mapping test above.
const THREE_INTERVALS = [
  { precipRate: 1.2, precipType: 'rain', timestampBegin: SLOT0,            timestampEnd: SLOT0 + 2 * SLOT },
  { precipRate: 0,   precipType: 'rain', timestampBegin: SLOT0 + 2 * SLOT, timestampEnd: SLOT0 + 4 * SLOT },
  { precipRate: 0.5, precipType: 'rain', timestampBegin: SLOT0 + 4 * SLOT, timestampEnd: SLOT0 + 24 * SLOT }
];

/**
 * One keyed fetch at the test point (52.5, 13.4).
 * @param {*} key The stored key.
 * @param {Function} cb Receives the tuples or null.
 * @param {number} [slotZero] Slot-0 epoch (default SLOT0).
 * @returns {void}
 */
function fetchWithKey(key, cb, slotZero) {
  rainbowRadar.fetchRadarTuplesWithKey(key, 52.5, 13.4, slotZero || SLOT0, cb);
}

/**
 * Answer the keyed requests in order: a string is a 200 body, {code} a transport
 * error; past the list's end the last entry repeats.
 * @param {Array<string|{code: string}>} answers Per-request answers.
 * @returns {Array<{url: string, type: string, headers: Object}>} The request log.
 */
function answerKeyed(answers) {
  const seen = [];
  responder = function(url, type, onSuccess, onError, headers) {
    const a = answers[Math.min(seen.length, answers.length - 1)];
    seen.push({ url: url, type: type, headers: headers });
    if (typeof a === 'string') { onSuccess(a); } else { onError({ code: a.code, detail: 'http_status' }); }
  };
  return seen;
}

/**
 * Run fn with console.log captured.
 * @param {Function} fn Code under test.
 * @returns {string[]} The lines logged.
 */
function captureLogs(fn) {
  const logs = [];
  const orig = console.log;
  console.log = function(m) { logs.push(String(m)); };
  try { fn(); } finally { console.log = orig; }
  return logs;
}

/**
 * One keyed fetch whose single request gets `answer`; returns the callback's value.
 * @param {string|{code: string}} answer The response.
 * @param {number} [slotZero] Slot-0 epoch.
 * @returns {?Object} Tuples or null.
 */
function keyedOutcome(answer, slotZero) {
  answerKeyed([answer]);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }, slotZero); });
  return out;
}

/**
 * A 200 body with a near echo and the given forecast (omitted → no forecast field).
 * @param {Array} [forecast] Forecast intervals.
 * @returns {string} JSON body.
 */
function echoBody(forecast) {
  const body = { latitude: 52.51, longitude: 13.41 };
  if (forecast) { body.forecast = forecast; }
  return JSON.stringify(body);
}

test('own key: GETs precip-global /lon/lat with start_timestamp, the trimmed key in the header only', () => {
  rainbowRadar.resetKeyedStreak();
  const seen = answerKeyed([echoBody([])]);
  fetchWithKey('  KEY \n', function() {});
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, DIRECT + '?start_timestamp=' + SLOT0);
  assert.equal(seen[0].type, 'GET');
  assert.deepEqual(seen[0].headers, { 'Ocp-Apim-Subscription-Key': 'KEY' });
  assert.equal(seen[0].url.indexOf('KEY'), -1, 'the key never rides the URL');
});

test('own key: Rainbow gets the position rounded to 3 decimals, and the echo check uses it', () => {
  rainbowRadar.resetKeyedStreak();
  // The echo is Rainbow's grid point near the rounded request.
  const seen = answerKeyed([JSON.stringify({ latitude: 52.52, longitude: 13.39, forecast: [] })]);
  let out = 'unset';
  captureLogs(function() {
    rainbowRadar.fetchRadarTuplesWithKey('KEY', '52.5170365', 13.3888599, SLOT0, function(t) { out = t; });
  });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, 'https://api.rainbow.ai/nowcast/v1/precip-global/13.389/52.517?start_timestamp=' + SLOT0);
  assert.ok(out && out.RAIN_RADAR_TREND_UINT8, 'a window, not a miss');
});

test('own key: a position that is no coordinate pair clears without a request and ends the run', () => {
  rainbowRadar.resetKeyedStreak();
  const DOWN = { code: 'status_503' };
  assert.equal(keyedOutcome(DOWN, SLOT0), null, 'a run starts');
  let requested = 0;
  responder = function() { requested += 1; };
  let out = 'unset';
  const logs = captureLogs(function() {
    rainbowRadar.fetchRadarTuplesWithKey('KEY', 'north', 13.4, SLOT0 + 3 * SLOT, function(t) { out = t; });
  });
  assert.deepEqual(out, CLEAR);
  assert.equal(requested, 0);
  assert.equal(logs.length, 1);
  assert.ok(logs[0].indexOf('not a usable coordinate pair') !== -1);
  assert.equal(keyedOutcome(DOWN, SLOT0 + 6 * SLOT), null, 'the run ended: a fresh one, not 30 min on');
});

test('own key: an echo-valid 200 gives the resampled window for that forecast', () => {
  rainbowRadar.resetKeyedStreak();
  const out = keyedOutcome(echoBody(THREE_INTERVALS));
  const expected = zeros();
  expected[0] = 12; expected[1] = 12;
  for (let i = 4; i < N; i += 1) { expected[i] = 5; }
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, expected);
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('own key: a swapped, missing or empty echo is a transient miss (null)', () => {
  [
    JSON.stringify({ latitude: 13.4, longitude: 52.5, forecast: THREE_INTERVALS }),
    JSON.stringify({ forecast: THREE_INTERVALS }),
    '{}',
    'null'
  ].forEach(function(body) {
    rainbowRadar.resetKeyedStreak();
    assert.equal(keyedOutcome(body), null, body.slice(0, 40));
  });
});

test('own key: an empty or non-JSON 200 (an Origin-neutered runtime) is null', () => {
  ['', '<html>'].forEach(function(body) {
    rainbowRadar.resetKeyedStreak();
    assert.equal(keyedOutcome(body), null, JSON.stringify(body));
  });
});

test('own key: an echo with no forecast is 24 zeros anchored at slot 0', () => {
  rainbowRadar.resetKeyedStreak();
  const out = keyedOutcome(echoBody());
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('own key: a 404 is out of coverage — flat zeros at slot 0, not the clear', () => {
  rainbowRadar.resetKeyedStreak();
  const out = keyedOutcome({ code: 'status_404' });
  assert.equal(out.RAIN_RADAR_TREND_UINT8.length, 24, 'not the clear');
  assert.deepEqual(out.RAIN_RADAR_TREND_UINT8, zeros());
  assert.equal(out.RAIN_RADAR_START, SLOT0);
});

test('own key: a 401/403 key rejection clears the watch radar', () => {
  ['status_401', 'status_403'].forEach(function(code) {
    rainbowRadar.resetKeyedStreak();
    assert.deepEqual(keyedOutcome({ code: code }), CLEAR, code);
  });
});

test('own key: 5xx, network errors and timeouts are transient (null)', () => {
  ['status_500', 'status_502', 'status_503', 'network_error', 'timeout'].forEach(function(code) {
    rainbowRadar.resetKeyedStreak();
    assert.equal(keyedOutcome({ code: code }), null, code);
  });
});

test('own key: a 429 is the limit notice, logged once and without the key', () => {
  rainbowRadar.resetKeyedStreak();
  const SECRET = 'RBWSECRET_0123456789abcdef';
  answerKeyed([{ code: 'status_429' }]);
  let out = 'unset';
  const logs = captureLogs(function() { fetchWithKey(SECRET, function(t) { out = t; }); });
  assert.deepEqual(out, radarWire.limitedRadarTuples());
  assert.equal(logs.filter(function(l) { return l.indexOf('Rainbow radar: request limit reached') !== -1; }).length, 1);
  assert.deepEqual(logs.filter(function(l) { return l.indexOf(SECRET) !== -1; }), []);
});

test('own key: a 429 on the retry without start_timestamp is the limit notice too', () => {
  rainbowRadar.resetKeyedStreak();
  const seen = answerKeyed([{ code: 'status_400' }, { code: 'status_429' }]);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }); });
  assert.equal(seen.length, 2);
  assert.deepEqual(out, radarWire.limitedRadarTuples());
});

test('own key: a refused start_timestamp (400/422) retries once without it, still anchored at slot 0', () => {
  ['status_400', 'status_422'].forEach(function(code) {
    rainbowRadar.resetKeyedStreak();
    // The retry's forecast starts 2 min after slot 0 (Rainbow's "now"): slot 0 still fills.
    const late = [{ precipRate: 2, timestampBegin: SLOT0 + 120, timestampEnd: SLOT0 + 24 * SLOT }];
    const seen = answerKeyed([{ code: code }, echoBody(late)]);
    let out;
    const logs = captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }); });
    assert.equal(seen.length, 2, code + ': exactly one retry');
    assert.equal(seen[1].url, DIRECT, code + ': the retry drops start_timestamp');
    assert.deepEqual(seen[1].headers, { 'Ocp-Apim-Subscription-Key': 'KEY' });
    assert.equal(out.RAIN_RADAR_START, SLOT0);
    assert.equal(out.RAIN_RADAR_TREND_UINT8[0], 20, code + ': slot 0 inherits the first interval');
    assert.equal(logs.filter(function(l) { return l.indexOf('start time refused (' + code + ')') !== -1; }).length, 1);
  });
});

test('own key: a 400 on the retry is null, and there is no third request', () => {
  rainbowRadar.resetKeyedStreak();
  const seen = answerKeyed([{ code: 'status_400' }, { code: 'status_400' }, echoBody([])]);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }); });
  assert.equal(seen.length, 2);
  assert.equal(out, null);
});

test('own key streak: nulls spanning 30 min of slot-0 time turn into the clear, and stay it', () => {
  rainbowRadar.resetKeyedStreak();
  const RATE = { code: 'status_503' };
  assert.equal(keyedOutcome(RATE, SLOT0), null);
  assert.equal(keyedOutcome(RATE, SLOT0 + 3 * SLOT), null);
  assert.equal(keyedOutcome(RATE, SLOT0 + 5 * SLOT), null);
  answerKeyed([RATE]);
  let out;
  const logs = captureLogs(function() { fetchWithKey('KEY', function(t) { out = t; }, SLOT0 + 6 * SLOT); });
  assert.deepEqual(out, CLEAR, '30 min after the first null');
  assert.equal(logs.filter(function(l) { return l.indexOf('no usable answer for 30 min') !== -1; }).length, 1);
  assert.deepEqual(keyedOutcome(RATE, SLOT0 + 7 * SLOT), CLEAR, 'the run continues past the clear');
});

test('own key streak: a window ends the run', () => {
  rainbowRadar.resetKeyedStreak();
  const RATE = { code: 'status_503' };
  assert.equal(keyedOutcome(RATE, SLOT0), null);
  assert.ok(keyedOutcome(echoBody([]), SLOT0 + 3 * SLOT), 'a real window');
  assert.equal(keyedOutcome(RATE, SLOT0 + 6 * SLOT), null, 'a new run starts here');
  assert.deepEqual(keyedOutcome(RATE, SLOT0 + 12 * SLOT), CLEAR, '30 min into the new run');
});

test('own key streak: a limit that lasts is never turned into the clear', () => {
  // The limit notice is an honest, known state: however long the 429s last, the
  // watch keeps saying "Radar limit reached" rather than losing its radar.
  rainbowRadar.resetKeyedStreak();
  const LIMIT = { code: 'status_429' };
  for (let i = 0; i <= 24; i += 3) {
    assert.deepEqual(keyedOutcome(LIMIT, SLOT0 + i * SLOT), radarWire.limitedRadarTuples(), 'slot ' + i);
  }
  // And the nulls after it start a fresh 30 minutes.
  const DOWN = { code: 'status_503' };
  assert.equal(keyedOutcome(DOWN, SLOT0 + 25 * SLOT), null);
  assert.equal(keyedOutcome(DOWN, SLOT0 + 30 * SLOT), null, '25 min into the run: not yet');
  assert.deepEqual(keyedOutcome(DOWN, SLOT0 + 31 * SLOT), CLEAR);
});

test('own key streak: empty 200s count like any other transient miss', () => {
  rainbowRadar.resetKeyedStreak();
  assert.equal(keyedOutcome('', SLOT0), null);
  assert.deepEqual(keyedOutcome('', SLOT0 + 6 * SLOT), CLEAR);
});

test('own key streak: a tunnel\'s many retries inside 30 min never clear', () => {
  rainbowRadar.resetKeyedStreak();
  const NET = { code: 'network_error' };
  for (let i = 0; i < 5; i += 1) {
    assert.equal(keyedOutcome(NET, SLOT0), null, 'backoff retry ' + i + ' of one slot');
  }
  assert.equal(keyedOutcome(NET, SLOT0 + 5 * SLOT), null, 'no clear before 30 min, however many attempts');
});

test('own key streak: a 404 (flat zeros), a 401 (clear) and a 429 (limit notice) each end a run', () => {
  [{ code: 'status_404' }, { code: 'status_401' }, { code: 'status_429' }].forEach(function(mid) {
    rainbowRadar.resetKeyedStreak();
    const RATE = { code: 'status_503' };
    assert.equal(keyedOutcome(RATE, SLOT0), null);
    assert.notEqual(keyedOutcome(mid, SLOT0 + 3 * SLOT), null, mid.code);
    assert.equal(keyedOutcome(RATE, SLOT0 + 6 * SLOT), null, mid.code + ' ended the run');
  });
});

test('own key: a missing or blank key clears without a request, logging once', () => {
  ['', '   ', undefined].forEach(function(key) {
    rainbowRadar.resetKeyedStreak();
    let requested = 0;
    responder = function() { requested += 1; };
    let out = 'unset';
    const logs = captureLogs(function() { fetchWithKey(key, function(t) { out = t; }); });
    assert.deepEqual(out, CLEAR, JSON.stringify(key));
    assert.equal(requested, 0);
    assert.equal(logs.length, 1);
    assert.ok(logs[0].indexOf('no API key is set') !== -1);
  });
});

test('own key: the 401, parse-error and echo-mismatch logs never carry the key (cheap pin)', () => {
  const SECRET = 'RBWSECRET_0123456789abcdef';
  const logs = [];
  [{ code: 'status_401' }, 'not json', JSON.stringify({ latitude: 0, longitude: 0 })].forEach(function(answer) {
    rainbowRadar.resetKeyedStreak();
    answerKeyed([answer]);
    Array.prototype.push.apply(logs, captureLogs(function() { fetchWithKey(SECRET, function() {}); }));
  });
  assert.equal(logs.length, 3, 'each path logged');
  assert.deepEqual(logs.filter(function(l) { return l.indexOf(SECRET) !== -1; }), []);
});

// The run measures the keyed path's OWN consecutive answers. Any other radar step (another
// source, radar off — each builds its source through radar-factory.js) or the missing-key
// clear ends it: coming back to the keyed path starts a fresh 30 minutes, measured from its
// first new null, not from a null hours old.
const radarFactory = require('../../../../src/pkjs/weather/adapter/radar-factory.js');

test('own key streak: a step on another radar source (or radar off) ends the run', () => {
  ['dwd', 'metno', 'rainbow', 'tomorrowio', 'disabled', 'bogus'].forEach(function(otherId) {
    rainbowRadar.resetKeyedStreak();
    const DOWN = { code: 'status_503' };
    assert.equal(keyedOutcome(DOWN, SLOT0), null, otherId + ': the first null');
    radarFactory.createRadarSource(otherId, { tomorrowioApiKey: '' });
    assert.equal(keyedOutcome(DOWN, SLOT0 + 72 * SLOT), null, otherId + ': 6 h later the run starts afresh');
    assert.deepEqual(keyedOutcome(DOWN, SLOT0 + 78 * SLOT), CLEAR, otherId + ': 30 min into the fresh run');
  });
});

test('own key streak: the keyed source\'s own steps keep the run going', () => {
  rainbowRadar.resetKeyedStreak();
  answerKeyed([{ code: 'status_503' }]);
  const outcomes = [];
  captureLogs(function() {
    [SLOT0, SLOT0 + 6 * SLOT].forEach(function(slotZero) {
      radarFactory.createRadarSource('rainbowkey', { rainbowApiKey: 'KEY' })
        .fetchRadarTuplesAt(52.5, 13.4, slotZero, function(t) { outcomes.push(t); });
    });
  });
  assert.equal(outcomes[0], null);
  assert.deepEqual(outcomes[1], CLEAR, 'building the keyed source each cycle does not restart its run');
});

test('own key streak: the missing-key clear ends the run', () => {
  rainbowRadar.resetKeyedStreak();
  const DOWN = { code: 'status_503' };
  assert.equal(keyedOutcome(DOWN, SLOT0), null);
  let out = 'unset';
  captureLogs(function() { fetchWithKey('', function(t) { out = t; }, SLOT0 + 3 * SLOT); });
  assert.deepEqual(out, CLEAR, 'no key: the clear');
  assert.equal(keyedOutcome(DOWN, SLOT0 + 6 * SLOT), null, 'the key is back: a fresh run, not 30 min on');
});
