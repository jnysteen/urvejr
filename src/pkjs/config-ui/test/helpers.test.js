const test = require('node:test');
const assert = require('node:assert/strict');
const color = require('../../lib/color.js');
const platform = require('../../config-ui/lib/platform.js');
const defaults = require('../lib/defaults.js');

const FIXTURE = { tabs: [ { id: 't', label: 'T', sections: [ { title: 'S', items: [
  { type: 'select', messageKey: 'mode', defaultValue: 'a', options: [['A','a'],['B','b']] },
  { type: 'toggle', messageKey: 'flag', defaultValue: false },
  { type: 'color',  messageKey: 'tint', defaultValue: 0xFF0055 },
  { type: 'staticText' }
] } ] } ] };

test('color int<->hex round-trips; no padStart trap at 0', () => {
  [0, 0xFFFFFF, 0x0055AA, 0xFF0055].forEach((n) =>
    assert.equal(color.hexToInt(color.intToHex(n)), n, 'round-trip ' + n));
  assert.equal(color.intToHex(0), '#000000');
  assert.equal(color.intToHex(0x0055AA), '#0055AA');
});

test('computeEnv: every env is the Pebble Time 2\'s, whatever watchInfo says', () => {
  const emery = { color: true, platform: 'emery', health: true, radar: true, themePolarity: true, hr: true,
    thresholds: true, colorBacklight: true, lineStyles: true, onDemand: true, fineBattery: true,
    forecastSpan: true, graphStyles: true, extraBars: true };
  [undefined, null, {}, { platform: 'emery' }, { platform: 'basalt' }].forEach((wi) =>
    assert.deepEqual(platform.computeEnv(wi), emery, JSON.stringify(wi)));
});

test('deriveDefaults/deriveColorKeys are schema-driven (colors as ints)', () => {
  assert.deepEqual(defaults.deriveDefaults(FIXTURE), { mode: 'a', flag: false, tint: 0xFF0055 });
  assert.deepEqual(defaults.deriveColorKeys(FIXTURE), ['tint']);
});

test('deriveDefaults never seeds a defaultFrom item, even one that also has a defaultValue', () => {
  // The seed backfill would otherwise pin a key the page leaves absent on purpose
  // (defaultFrom.sticky: false), freezing one watch's default for every watch.
  const SCH = { tabs: [{ sections: [{ items: [
    { type: 'select', messageKey: 'plain', defaultValue: 'a' },
    { type: 'select', messageKey: 'slot', defaultFrom: { resolver: 'x' } },
    { type: 'segmented', messageKey: 'look', defaultValue: 'fill', defaultFrom: { resolver: 'x', sticky: false } }
  ] }] }] };
  assert.deepEqual(defaults.deriveDefaults(SCH), { plain: 'a' });
});
