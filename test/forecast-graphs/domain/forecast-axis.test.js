// The forecast's left axis options (emery only): src/pkjs/forecast-graphs/domain/forecast-axis.js, the one
// reading of the two settings for the wire, the bake, the hours sent, the render signature,
// the settings gate and the preview; its wire bits held equal to
// src/c/appendix/config.h.
const test = require('node:test');
const assert = require('node:assert/strict');

const forecastAxis = require('../../../src/pkjs/forecast-graphs/domain/forecast-axis.js');
const { readC, cDefine } = require('../../helpers/c-source.js');

const LINE_KEYS = ['secondaryLine', 'thirdLine', 'fourthLine', 'fifthLine'];
const DEFAULTS = { numbers: 'axis', scale: false };

test('readers: absent or junk read the shipped defaults', () => {
  [undefined, null, {}].forEach((s) => {
    assert.equal(forecastAxis.numbers(s), 'axis');
    assert.equal(forecastAxis.scale(s), false);
  });
  const junk = { forecastAxisNumbers: 'left', forecastAxisScale: 'true' };
  assert.equal(forecastAxis.numbers(junk), 'axis');
  assert.equal(forecastAxis.scale(junk), false, 'only an exact true turns the scale on');
  // The 2.2.0 betas' default token: junk now, so On axis, the same place under its new name.
  assert.equal(forecastAxis.numbers({ forecastAxisNumbers: 'beside' }), 'axis');
  const set = { forecastAxisNumbers: 'graph', forecastAxisScale: true };
  assert.equal(forecastAxis.numbers(set), 'graph');
  assert.equal(forecastAxis.scale(set), true);
  assert.equal(forecastAxis.numbers({ forecastAxisNumbers: 'off' }), 'off');
  assert.equal(forecastAxis.numbers({ forecastAxisNumbers: 'axis' }), 'axis');
  assert.deepEqual(forecastAxis.NUMBERS, ['axis', 'graph', 'off']);
  assert.deepEqual(forecastAxis.KEYS, { numbers: 'forecastAxisNumbers', scale: 'forecastAxisScale' });
  // The betas' retired keys are read by nothing: they change no reading.
  const retired = { forecastAxisLine: false, forecastAxisOutline: false };
  assert.deepEqual(forecastAxis.resolved(retired), DEFAULTS);
  assert.equal(forecastAxis.wireBits(retired), 0);
});

test('tempAxisLineDrawn: a drawn feels-like or dew point line, on any line', () => {
  assert.equal(forecastAxis.tempAxisLineDrawn({}), false);
  assert.equal(forecastAxis.tempAxisLineDrawn({ secondaryLine: 'wind', thirdLine: 'uv' }), false);
  LINE_KEYS.forEach((key) => {
    ['feels', 'dew'].forEach((metric) => {
      const s = {};
      s[key] = metric;
      assert.equal(forecastAxis.tempAxisLineDrawn(s), true, key + ' ' + metric);
    });
  });
  // A repeated pick draws only its earliest copy, which still counts.
  assert.equal(forecastAxis.tempAxisLineDrawn({ secondaryLine: 'dew', thirdLine: 'dew' }), true);
  assert.equal(forecastAxis.tempAxisLineDrawn({ secondaryLine: 'off', fifthLine: 'feels' }), true);
});

test('resolved: the stored options, dormant ones read as their defaults', () => {
  const all = { forecastAxisNumbers: 'graph', forecastAxisScale: true, secondaryLine: 'dew' };
  assert.deepEqual(forecastAxis.resolved({}), DEFAULTS);
  assert.deepEqual(forecastAxis.resolved(all), { numbers: 'graph', scale: true });
  // The scale is dormant with the numbers off or no feels-like / dew point line.
  assert.equal(forecastAxis.resolved({ forecastAxisScale: true }).scale, false);
  assert.equal(forecastAxis.resolved({ forecastAxisScale: true, secondaryLine: 'dew',
    forecastAxisNumbers: 'off' }).scale, false);
  assert.equal(forecastAxis.resolved({ forecastAxisScale: true, secondaryLine: 'dew' }).scale,
    true, 'On axis names the scale too');
});

test('wireBits: the exhaustive table, canonical (a dormant value packs no bit)', () => {
  const B = forecastAxis.BIT;
  let rows = 0;
  // The betas' retired keys ride along in every row: they never pack a bit.
  [undefined, true, false].forEach((retired) => {
    forecastAxis.NUMBERS.concat(['beside']).forEach((nums) => {
      [true, false].forEach((scale) => {
        [null, 'dew', 'feels'].forEach((metric) => {
          const s = { forecastAxisNumbers: nums, forecastAxisScale: scale,
            forecastAxisLine: retired, forecastAxisOutline: retired };
          if (metric) { s.thirdLine = metric; }
          const want = (nums === 'graph' ? B.NUMS_GRAPH : 0)
            | (nums === 'off' ? B.NUMS_OFF : 0)
            | (scale && nums !== 'off' && metric ? B.SCALE : 0);
          const bits = forecastAxis.wireBits(s);
          assert.equal(bits, want, JSON.stringify(s));
          assert.equal(bits & 1, 0, 'never bit 0 (Larger graph fonts)');
          assert.equal(bits & forecastAxis.RETIRED_BITS, 0, 'never a retired bit');
          assert.ok(bits <= 0x2C, 'within 0x2C');
          assert.equal(bits & ~forecastAxis.AXIS_MASK, 0, 'inside AXIS_MASK');
          rows += 1;
        });
      });
    });
  });
  assert.equal(rows, 3 * 4 * 2 * 3);
  assert.equal(forecastAxis.wireBits({}), 0, 'all zero exactly at the defaults');
});

test('bakesScale: the option stored on, blind to numbers and lines', () => {
  assert.equal(forecastAxis.bakesScale({ forecastAxisScale: true }), true);
  assert.equal(forecastAxis.bakesScale({ forecastAxisScale: true, forecastAxisNumbers: 'off' }),
    true, 'a numbers flip never re-bakes the scale');
  assert.equal(forecastAxis.bakesScale({}), false);
});

test('signature: \'scale\' only while the option and a temperature-axis line are on', () => {
  assert.equal(forecastAxis.signature({}), '');
  assert.equal(forecastAxis.signature({ forecastAxisScale: false, secondaryLine: 'dew' }), '');
  assert.equal(forecastAxis.signature({ forecastAxisScale: true }), '');
  assert.equal(forecastAxis.signature({ forecastAxisScale: true, secondaryLine: 'wind' }), '');
  LINE_KEYS.forEach((key) => {
    const s = { forecastAxisScale: true };
    s[key] = 'feels';
    assert.equal(forecastAxis.signature(s), 'scale', key);
  });
  // The numbers never sign here (at 24 h forecast-span.js signs the hours they set).
  assert.equal(forecastAxis.signature({ forecastAxisNumbers: 'graph', secondaryLine: 'dew' }), '');
});

test('the wire bits are one set of numbers on both sides (config.h GRAPH_OPT_*)', () => {
  const h = readC('src/c/appendix/config.h');
  const def = (name) => cDefine(h, name);
  const B = forecastAxis.BIT;
  assert.equal(def('GRAPH_OPT_LARGE_FONT'), B.LARGE_FONT);
  assert.equal(def('GRAPH_OPT_NUMS_GRAPH'), B.NUMS_GRAPH);
  assert.equal(def('GRAPH_OPT_NUMS_OFF'), B.NUMS_OFF);
  assert.equal(def('GRAPH_OPT_NUMS_MASK'), B.NUMS_GRAPH | B.NUMS_OFF);
  assert.equal(def('GRAPH_OPT_SCALE_NUMS'), B.SCALE);
  // The betas' axis line off (bit 1) and outline off (bit 4): retired, reserved, unnamed on
  // both sides, and no live bit renumbered onto them.
  assert.doesNotMatch(h, /GRAPH_OPT_AXIS_LINE_OFF|GRAPH_OPT_OUTLINE_OFF/);
  assert.equal(forecastAxis.RETIRED_BITS, 0x02 | 0x10);
  Object.keys(B).forEach((k) => assert.equal(B[k] & forecastAxis.RETIRED_BITS, 0, k));
  assert.equal(forecastAxis.RETIRED_BITS & ~forecastAxis.AXIS_MASK, 0, 'kept inside the stored mask');
  assert.equal(def('GRAPH_OPT_AXIS_MASK'), forecastAxis.AXIS_MASK);
  assert.equal(forecastAxis.AXIS_MASK & B.LARGE_FONT, 0, 'the mask leaves bit 0 to Larger graph fonts');
  assert.ok(forecastAxis.AXIS_MASK < 0x8000, 'below the int16 read\'s sign bit');
  // The decode reads the word through the int16 low half, stored as sent.
  const emery = readC('src/c/appendix/config_wire.c');
  assert.match(emery, /\(uint16_t\)\s*clay_large_graph_font_tuple->value->int16/);
  assert.match(emery, /large_graph_font\s*=\s*\(\s*word\s*&\s*GRAPH_OPT_LARGE_FONT\s*\)\s*!=\s*0/);
  assert.match(emery, /out->forecast_axis\s*=\s*\(uint8_t\)\s*\(\s*word\s*&\s*GRAPH_OPT_AXIS_MASK\s*\)/);
});
