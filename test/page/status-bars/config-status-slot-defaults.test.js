'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
// Populate global.PConf registries (engine) then register the statusSlotDefault resolver (blocks).
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
const E = require('../../../src/pkjs/config-ui/lib/engine.js');
const { deriveDefaults } = require('../../../src/pkjs/config-ui/lib/defaults.js');
require('../../../src/pkjs/page/settings/blocks.js');                 // registers statusSlotDefault
const SCHEMA = require('../../../src/pkjs/page/settings/schema.js');

const ENV_EMERY = { color: true, platform: 'emery', health: true, radar: true, themePolarity: true, hr: true };

test('real schema hydrates the status-slot default set', () => {
  const emery = E.hydrate(SCHEMA, {}, ENV_EMERY);
  assert.equal(emery.statusForecastLeft, 'temp');
  assert.equal(emery.statusForecastMid, 'city');
  assert.equal(emery.statusForecastRight, 'sun');
  assert.equal(emery.statusRadarLeft, 'uv');
  assert.equal(emery.statusRadarMid, 'wind');
  assert.equal(emery.statusRadarRight, 'gust');
  assert.equal(emery.statusTopLeft, 'week');
  assert.equal(emery.statusTopMid, 'date');
  assert.equal(emery.statusTopRight, 'aqi');
  assert.equal(emery.statusHealthLeft, 'steps');
  assert.equal(emery.statusHealthMid, 'sleep');
  assert.equal(emery.statusHealthRight, 'hr', 'emery is HR-capable');
});

// The On demand keys are seeded from the schema (seedDefaults, via deriveDefaults), so
// the schema's defaults ARE what every install, upgraded ones included, starts with —
// and they must be on-demand.js's DEFAULTS, the reading the phone packs from.
test('the schema seeds every On demand key with the contract\'s default', () => {
  const OD = require('../../../src/pkjs/status-bars/domain/on-demand.js');
  const seeded = deriveDefaults(SCHEMA);
  Object.keys(OD.DEFAULTS).forEach((key) => {
    assert.equal(seeded[key], OD.DEFAULTS[key], key);
  });
  assert.equal(seeded.statusTopOnDemandLeftItems, 'bt,qt,snooze,rain',
    'the Watch Status Bar\'s left side: Bluetooth, quiet time, sleep and the rain alert');
  assert.equal(seeded.statusTopOnDemandRightItems, 'battery,gust,uv,aqi,wind',
    'the Watch Status Bar\'s right side: the battery and the four metric alerts, Pollen off');
  ['alertRain', 'alertUv', 'statusTopAlerts'].forEach((k) =>
    assert.equal(seeded[k], undefined, k + ' is retired'));
});

test('deriveDefaults omits the 12 defaultFrom status-slot keys from the seed', () => {
  const seeded = deriveDefaults(SCHEMA);
  const slotKeys = [
    'statusForecastLeft', 'statusForecastMid', 'statusForecastRight',
    'statusRadarLeft', 'statusRadarMid', 'statusRadarRight',
    'statusTopLeft', 'statusTopMid', 'statusTopRight',
    'statusHealthLeft', 'statusHealthMid', 'statusHealthRight'
  ];
  slotKeys.forEach(function (key) {
    assert.equal(seeded[key], undefined, key + ' must not be seeded (defaultFrom is resolved at hydrate time)');
  });
  // A known static-default key IS present, proving the omission above is specific
  // to defaultFrom items rather than a broken/empty schema.
  assert.equal(seeded.weekStartDay, 'mon');
  assert.equal(seeded.batteryLowOnly, true);
});

test('all countdown dates hydrate to today and saved values win', () => {
  const today = E.formatDateValue(new Date());
  const hydrated = E.hydrate(SCHEMA, {}, ENV_EMERY);
  const keys = [
    'statusForecastLeftCountdown', 'statusForecastMidCountdown',
    'statusForecastRightCountdown', 'statusRadarLeftCountdown',
    'statusRadarMidCountdown', 'statusRadarRightCountdown',
    'statusHealthLeftCountdown', 'statusHealthMidCountdown',
    'statusHealthRightCountdown', 'statusTopLeftCountdown',
    'statusTopMidCountdown', 'statusTopRightCountdown'
  ];
  keys.forEach((key) => assert.equal(hydrated[key], today, key));
  const seeded = deriveDefaults(SCHEMA);
  keys.forEach((key) => assert.equal(seeded[key], undefined,
    key + ' is resolved at hydration, not baked into the static seed'));
  assert.equal(E.hydrate(SCHEMA,
    { statusForecastLeftCountdown: '2030-04-05' },
    ENV_EMERY).statusForecastLeftCountdown, '2030-04-05');
});
