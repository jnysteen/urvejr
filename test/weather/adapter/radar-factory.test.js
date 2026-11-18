const test = require('node:test');
const assert = require('node:assert/strict');
const radar = require('../../../src/pkjs/weather/adapter/radar/dwd-radar.js');
const metnoRadar = require('../../../src/pkjs/weather/adapter/radar/metno-radar.js');
const rainbowRadar = require('../../../src/pkjs/weather/adapter/radar/rainbow-radar.js');
const tomorrowioRadar = require('../../../src/pkjs/weather/adapter/radar/tomorrowio-radar.js');
const radarFactory = require('../../../src/pkjs/weather/adapter/radar-factory.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');

const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };

// The Rain radar picker's sources: its static options after Off (RADAR_PROVIDER_OPTIONS), one
// option per radar source (the two Rainbow sources included).
function radarPickerOptions(radarItem) {
  return radarItem.options.filter(function(o) { return o[1] !== 'off'; });
}

test("createRadarSource('dwd') routes to radar.fetchRadarTuplesAt with lat/lon/slot", () => {
  let seen = null;
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [2], RAIN_RADAR_START: 100 };
  const orig = radar.fetchRadarTuplesAt;
  radar.fetchRadarTuplesAt = function(lat, lon, slot, cb) { seen = { lat, lon, slot }; cb(fetched); };
  try {
    const source = radarFactory.createRadarSource('dwd', {});
    let result;
    source.fetchRadarTuplesAt(52.5, 13.4, 100, function(t) { result = t; });
    assert.deepEqual(seen, { lat: 52.5, lon: 13.4, slot: 100 });
    assert.equal(result, fetched);
  } finally {
    radar.fetchRadarTuplesAt = orig;
  }
});

test("createRadarSource('metno') routes to metnoRadar.fetchRadarTuplesAt with lat/lon/slot", () => {
  let seen = null;
  const fetched = { RAIN_RADAR_TREND_UINT8: [3], RAIN_RADAR_TREND_AREA_UINT8: [0], RAIN_RADAR_START: 100 };
  const orig = metnoRadar.fetchRadarTuplesAt;
  metnoRadar.fetchRadarTuplesAt = function(lat, lon, slot, cb) { seen = { lat, lon, slot }; cb(fetched); };
  try {
    const source = radarFactory.createRadarSource('metno', {});
    let result;
    source.fetchRadarTuplesAt(52.5, 13.4, 100, function(t) { result = t; });
    assert.deepEqual(seen, { lat: 52.5, lon: 13.4, slot: 100 });
    assert.equal(result, fetched);
  } finally {
    metnoRadar.fetchRadarTuplesAt = orig;
  }
});

test("createRadarSource('disabled') yields clearing tuples without fetching", () => {
  const origDwd = radar.fetchRadarTuplesAt;
  const origRainbow = rainbowRadar.fetchRadarTuplesWithKey;
  radar.fetchRadarTuplesAt = function() { throw new Error('dwd must not be called'); };
  rainbowRadar.fetchRadarTuplesWithKey = function() { throw new Error('rainbow must not be called'); };
  try {
    const source = radarFactory.createRadarSource('disabled', {});
    let result;
    source.fetchRadarTuplesAt(0, 0, 0, function(t) { result = t; });
    assert.deepEqual(result, CLEAR);
  } finally {
    radar.fetchRadarTuplesAt = origDwd;
    rainbowRadar.fetchRadarTuplesWithKey = origRainbow;
  }
});

test('unknown and unset ids fall back to disabled (clearing tuples)', () => {
  [undefined, 'bogus'].forEach(function(id) {
    const source = radarFactory.createRadarSource(id, {});
    let result;
    source.fetchRadarTuplesAt(0, 0, 0, function(t) { result = t; });
    assert.deepEqual(result, CLEAR, 'id ' + String(id) + ' clears radar');
  });
});

test('isKnownRadarSource recognizes registered ids only', () => {
  assert.equal(radarFactory.isKnownRadarSource('dwd'), true);
  assert.equal(radarFactory.isKnownRadarSource('metno'), true);
  assert.equal(radarFactory.isKnownRadarSource('rainbowkey'), true);
  assert.equal(radarFactory.isKnownRadarSource('rainbow'), false, 'the shared proxy source is gone');
  assert.equal(radarFactory.isKnownRadarSource('disabled'), true);
  assert.equal(radarFactory.isKnownRadarSource('bogus'), false);
  assert.equal(radarFactory.DEFAULT_RADAR_ID, 'disabled');
});

test('the Rain radar picker\'s sources are all registered factory ids; the registry also keeps the internal-only "disabled" id', () => {
  // "disabled" is no user-selectable source: the picker's Off (Setup › Data sources) turns the
  // radar off and keeps the source (radarEnabled), but the factory registry keeps the id as
  // the fallback for unknown/unset ids (see radar-factory.js DEFAULT_RADAR_ID) and as the id
  // radar-fetch gating still routes to when radarMode is 'off'. "rainbowkey" is the picker
  // option and stored value of "Rainbow" (OWN_KEY_RADAR_ID).
  const items = [];
  schema.tabs.forEach(function(t) {
    t.sections.forEach(function(sec) {
      sec.items.forEach(function(it) { items.push(it); });
    });
  });
  const radarItem = items.filter(function(i) { return i.messageKey === 'radarSource'; })[0];
  assert.ok(radarItem, 'the Rain radar picker exists in the schema');
  assert.equal(radarItem.options[0][1], 'off', 'Off first, a page-only pick over radarEnabled');
  const schemaIds = radarPickerOptions(radarItem).map(function(o) { return o[1]; }).sort();
  const registryIds = Object.keys(radarFactory.RADAR_FACTORIES).sort();
  assert.deepEqual(schemaIds, ['dwd', 'metno', 'rainbowkey', 'tomorrowio'],
    'the picker offers every source but "disabled" (its Off keeps the source)');
  schemaIds.forEach(function(id) {
    assert.ok(registryIds.indexOf(id) >= 0, id + ' schema option must be a registered radar factory id');
  });
  assert.ok(registryIds.indexOf('disabled') >= 0,
    '"disabled" stays registered as the internal fallback factory');
  // Every registered source is reachable from the settings: a picker option or the
  // radar-off clear.
  const reachable = schemaIds.concat(['disabled']).sort();
  assert.deepEqual(registryIds, reachable, 'no registered source is out of the settings\' reach');
  assert.equal(radarFactory.OWN_KEY_RADAR_ID, 'rainbowkey', 'Rainbow');
  assert.equal(radarFactory.OWN_KEY_RADAR_ID, rainbowRadar.OWN_KEY_RADAR_ID,
    'the id the keyed path records its answers under');
});

test("createRadarSource('tomorrowio') binds cfg.tomorrowioApiKey and routes to tomorrowioRadar", () => {
  let seen = null;
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [0], RAIN_RADAR_START: 100 };
  const orig = tomorrowioRadar.fetchRadarTuplesAt;
  tomorrowioRadar.fetchRadarTuplesAt = function(apiKey, lat, lon, slot, cb) {
    seen = { apiKey, lat, lon, slot }; cb(fetched);
  };
  try {
    const source = radarFactory.createRadarSource('tomorrowio', { tomorrowioApiKey: 'tk-777' });
    let result;
    source.fetchRadarTuplesAt(52.5, 13.4, 100, function(t) { result = t; });
    assert.deepEqual(seen, { apiKey: 'tk-777', lat: 52.5, lon: 13.4, slot: 100 });
    assert.equal(result, fetched);
  } finally {
    tomorrowioRadar.fetchRadarTuplesAt = orig;
  }
});

test('radar picker offers tomorrowio', () => {
  const items = [];
  schema.tabs.forEach((t) => t.sections.forEach((s) => s.items.forEach((i) => items.push(i))));
  const radarItem = items.filter((i) => i.messageKey === 'radarSource')[0];
  assert.ok(radarPickerOptions(radarItem).map((o) => o[1]).includes('tomorrowio'));
  const tio = radarPickerOptions(radarItem).find((o) => o[1] === 'tomorrowio');
  assert.ok(tio[2] && tio[2].desc, 'has a dropdown description');
});

test('canAnswer: sources whose missing config clears the radar on every fetch can never answer', () => {
  const factory = require('../../../src/pkjs/weather/adapter/radar-factory.js');
  const cfg = { tomorrowioApiKey: 'KEY' };
  assert.equal(factory.canAnswer('dwd', cfg), true);
  assert.equal(factory.canAnswer('metno', cfg), true);
  assert.equal(factory.canAnswer('rainbow', cfg), false, 'the removed shared source is unknown');
  assert.equal(factory.canAnswer('tomorrowio', cfg), true);
  assert.equal(factory.canAnswer('tomorrowio', { tomorrowioApiKey: '  ' }), false, 'a blank key');
  assert.equal(factory.canAnswer('disabled', cfg), false);
  assert.equal(factory.canAnswer('bogus', cfg), false, 'unknown ids fall back to the clear');
});

test("createRadarSource('rainbowkey') binds cfg.rainbowApiKey and routes to rainbowRadar.fetchRadarTuplesWithKey", () => {
  let seen = null;
  const fetched = { RAIN_RADAR_TREND_UINT8: [1], RAIN_RADAR_TREND_AREA_UINT8: [0], RAIN_RADAR_START: 100 };
  const orig = rainbowRadar.fetchRadarTuplesWithKey;
  rainbowRadar.fetchRadarTuplesWithKey = function(apiKey, lat, lon, slot, cb) {
    seen = { apiKey, lat, lon, slot }; cb(fetched);
  };
  try {
    const source = radarFactory.createRadarSource('rainbowkey', { rainbowApiKey: 'K' });
    let result;
    source.fetchRadarTuplesAt(52.5, 13.4, 100, function(t) { result = t; });
    assert.deepEqual(seen, { apiKey: 'K', lat: 52.5, lon: 13.4, slot: 100 });
    assert.equal(result, fetched);
  } finally {
    rainbowRadar.fetchRadarTuplesWithKey = orig;
  }
});

test('canAnswer: Rainbow needs a non-blank key', () => {
  assert.equal(radarFactory.isKnownRadarSource('rainbowkey'), true);
  assert.equal(radarFactory.canAnswer('rainbowkey', { rainbowApiKey: 'K' }), true);
  assert.equal(radarFactory.canAnswer('rainbowkey', { rainbowApiKey: '  ' }), false, 'a blank key');
  assert.equal(radarFactory.canAnswer('rainbowkey', {}), false, 'no key');
  assert.equal(radarFactory.canAnswer('rainbowkey', undefined), false, 'no cfg');
  // tomorrow.io is unchanged by the shared blank check.
  assert.equal(radarFactory.canAnswer('tomorrowio', { tomorrowioApiKey: 'KEY' }), true);
  assert.equal(radarFactory.canAnswer('tomorrowio', { tomorrowioApiKey: '' }), false);
  assert.equal(radarFactory.canAnswer('tomorrowio', { rainbowApiKey: 'K' }), false, 'the other source\'s key does not count');
  assert.equal(radarFactory.canAnswer('tomorrowio', undefined), false);
});
