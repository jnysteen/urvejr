'use strict';
// test/status-bars/domain/fetch-gates-alerts.test.js — the metric fetch gates (forecast-series.js
// needsUv / needsAqi / needsPollen / dayPeakCodes) add what the weather alerts ask for
// to what the lines and slots show: an alert placed on an On demand side of a
// bar that exists (on-demand.js placedAnywhere, read through status-thresholds'
// alertOn) fetches its metric, and a day-max kind's alert keeps its day peaks. Read for
// THIS watch. Over a truth table of placements, provider, line,
// slot, day-max-mode settings and watches, every gate answers the reference below.
const test = require('node:test');
const assert = require('node:assert/strict');

// forecast-series pulls in the status bake, which reaches localStorage: install the
// mock before the watch modules load (AGENTS.md).
const store = {};
global.localStorage = {
  getItem(k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
  setItem(k, v) { store[k] = String(v); },
  removeItem(k) { delete store[k]; }
};

const forecastSeries = require('../../../src/pkjs/weather/domain/forecast-series.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');
const OD = require('../../../src/pkjs/status-bars/domain/on-demand.js');
const { NOTHING_PLACED, placeOn } = require('../../helpers/on-demand.js');

// The four gates as the On demand settings define them, the reference.
const expected = (() => {
  const placed = (s, code) => OD.placedAnywhere(s, code);
  // A made bar 4 to 6's slots count where a screen shows the bar.
  const shown = (s, code) => catalog.selectedCodes(s).indexOf(code) !== -1;
  const dayMaxInUse = (s, kind) => {
    const mode = s[kind + 'SlotDisplay'];
    return (mode === 'max' || mode === 'both') && shown(s, kind);
  };
  return {
    needsUv(s) {
      if (!s) { return false; }
      if (s.secondaryLine === 'uv' || s.thirdLine === 'uv'
        || s.fourthLine === 'uv' || s.fifthLine === 'uv') { return true; }
      return placed(s, 'uv') || shown(s, 'uv');
    },
    needsAqi(s) {
      if (!s) { return false; }
      return placed(s, 'aqi') || shown(s, 'aqi');
    },
    needsPollen(s) {
      if (!s || s.provider !== 'dwd') { return false; }
      return placed(s, 'pollen') || shown(s, 'pollen');
    },
    dayPeakCodes(s) {
      if (!s) { return []; }
      return catalog.DAY_MAX_KINDS.filter(kind => placed(s, kind) || dayMaxInUse(s, kind));
    }
  };
})();

// Placements: the defaults (a partial blob reads them), nothing, one side each, a
// bar the mode removes, and a health bar that exists.
const PLACEMENTS = [
  {},
  Object.assign({}, NOTHING_PLACED),
  placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'right', 'uv,pollen'),
  placeOn(Object.assign({}, NOTHING_PLACED), 'forecast', 'left', 'aqi,wind'),
  placeOn(Object.assign({}, NOTHING_PLACED), 'top', 'left', 'gust,uv'),
  Object.assign(placeOn(Object.assign({}, NOTHING_PLACED), 'radar', 'right', 'uv,aqi,pollen,gust'), { radarMode: 'off' }),
  Object.assign(placeOn(Object.assign({}, NOTHING_PLACED), 'health', 'left', 'wind,aqi'), { healthMode: 'status' })
];
const PROVIDERS = [undefined, 'dwd', 'openmeteo'];
const LINES = [
  {},                                                   // the line defaults
  { secondaryLine: 'wind', thirdLine: 'off' },          // no uv line
  { secondaryLine: 'wind', thirdLine: 'off', fifthLine: 'uv' }
];
/**
 * Every slot empty except the given ones.
 * @param {Object} picks slot key -> code
 * @returns {Object} the twelve slot settings
 */
function slots(picks) {
  const out = {};
  catalog.allSlotKeys().forEach((k) => { out[k] = 'empty'; });
  return Object.assign(out, picks);
}
const SLOTS = [
  {},                                                   // the slot defaults
  slots({}),                                            // nothing on any bar
  slots({ statusTopMid: 'uv' }),
  slots({ statusForecastLeft: 'aqi', statusRadarMid: 'pollen' }),
  slots({ statusForecastRight: 'wind', statusHealthLeft: 'gust', statusRadarLeft: 'uv' })
];
const MODES = [
  {},
  { uvSlotDisplay: 'max', windSlotDisplay: 'both', gustSlotDisplay: 'current', aqiSlotDisplay: 'max' }
];

test('the fetch gates add the placed alerts, on every combination', () => {
  let n = 0;
  PLACEMENTS.forEach(placement => PROVIDERS.forEach(provider => LINES.forEach(lines =>
    SLOTS.forEach(slotPicks => MODES.forEach(modes => {
      n++;
      const s = Object.assign({}, lines, slotPicks, modes, placement);
      if (provider !== undefined) { s.provider = provider; }
      const at = () => JSON.stringify(s);
      assert.equal(forecastSeries.needsUv(s), expected.needsUv(s), 'needsUv ' + at());
      assert.equal(forecastSeries.needsAqi(s), expected.needsAqi(s), 'needsAqi ' + at());
      assert.equal(forecastSeries.needsPollen(s), expected.needsPollen(s), 'needsPollen ' + at());
      assert.deepEqual(forecastSeries.dayPeakCodes(s), expected.dayPeakCodes(s), 'dayPeakCodes ' + at());
    })))));
  assert.equal(n, PLACEMENTS.length * PROVIDERS.length * LINES.length * SLOTS.length * MODES.length,
    'the whole table ran');
});

test('no stored settings fetch nothing and keep no day record', () => {
  [null, undefined].forEach((s) => {
    assert.equal(forecastSeries.needsUv(s), false);
    assert.equal(forecastSeries.needsAqi(s), false);
    assert.equal(forecastSeries.needsPollen(s), false);
    assert.deepEqual(forecastSeries.dayPeakCodes(s), []);
  });
});

// The table is only a proof if the placements actually flip gates in it: each alert
// must be the deciding input somewhere, and the watch too.
test('the table exercises every alert as a deciding input', () => {
  const base = Object.assign(slots({}), { secondaryLine: 'wind', thirdLine: 'off', provider: 'dwd' },
    NOTHING_PLACED);
  const with_ = (codes) => placeOn(Object.assign({}, base), 'top', 'right', codes);
  assert.equal(forecastSeries.needsUv(base), false);
  assert.equal(forecastSeries.needsUv(with_('uv')), true);
  assert.equal(forecastSeries.needsAqi(with_('aqi')), true);
  assert.equal(forecastSeries.needsPollen(with_('pollen')), true);
  assert.deepEqual(forecastSeries.dayPeakCodes(with_('wind,gust')), ['wind', 'gust']);
  // A slot-less partial blob reads the default ticks (Wind gusts, UV index, Air quality
  // and Wind speed on the Watch Status Bar), so it fetches UV and AQI and keeps the four
  // day records — on purpose: the owner switched those alerts on for every install.
  const partial = Object.assign(slots({}), { secondaryLine: 'wind', thirdLine: 'off' });
  assert.equal(forecastSeries.needsUv(partial), true);
  assert.equal(forecastSeries.needsAqi(partial), true);
  assert.deepEqual(forecastSeries.dayPeakCodes(partial), ['uv', 'wind', 'gust', 'aqi']);
});
