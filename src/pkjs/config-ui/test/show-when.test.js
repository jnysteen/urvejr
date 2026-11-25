// src/pkjs/config-ui/test/show-when.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/show-when.js');
const ctx = { secondaryLine: 'wind', provider: 'dwd', devStatsEnabled: true, env: { color: false, platform: 'flint' } };

test('leaf operators: eq/ne/in/nin/truthy + env', () => {
  assert.equal(W.evaluate({ key: 'secondaryLine', eq: 'wind' }, ctx), true);
  assert.equal(W.evaluate({ key: 'secondaryLine', eq: 'precip_prob' }, ctx), false);
  assert.equal(W.evaluate({ key: 'provider', ne: 'openweathermap' }, ctx), true);
  assert.equal(W.evaluate({ key: 'provider', in: ['dwd','wunderground'] }, ctx), true);
  assert.equal(W.evaluate({ key: 'provider', nin: ['dwd'] }, ctx), false);
  assert.equal(W.evaluate({ key: 'devStatsEnabled' }, ctx), true);   // bare = truthy
  assert.equal(W.evaluate({ env: 'color' }, ctx), false);            // flint = b&w
  assert.equal(W.evaluate({ env: 'color', eq: false }, ctx), true);
});

test('combinators: all/any/not/array-shorthand', () => {
  assert.equal(W.evaluate({ all: [{ key: 'provider', eq: 'dwd' }, { env: 'color' }] }, ctx), false);
  assert.equal(W.evaluate({ any: [{ key: 'provider', eq: 'dwd' }, { env: 'color' }] }, ctx), true);
  assert.equal(W.evaluate({ not: { env: 'color' } }, ctx), true);
  assert.equal(W.evaluate([{ key: 'provider', eq: 'dwd' }, { key: 'devStatsEnabled' }], ctx), true);
});

test('itemPredicate is the item\'s showWhen; an item without one is visible', () => {
  assert.deepEqual(W.itemPredicate({ showWhen: { key: 'barSource', eq: 'rain' } }), { key: 'barSource', eq: 'rain' });
  assert.equal(W.itemPredicate({ messageKey: 'x' }), null);
  assert.equal(W.isVisible({ messageKey: 'x' }, ctx), true);
});

test('{ env: <fact> } reads the env: a true fact shows an item, a missing one hides it', () => {
  const item = { messageKey: 'x', showWhen: { env: 'phoneBattery' } };
  assert.equal(W.isVisible(item, { env: { phoneBattery: true } }), true);
  assert.equal(W.isVisible(item, { env: { phoneBattery: false } }), false, 'off');
  assert.equal(W.isVisible(item, { env: {} }), false, 'missing');
  assert.equal(W.isVisible(item, {}), false, 'no env at all: fail closed');
});

test('when: a leaf asks the named resolver; an unregistered name reads false', () => {
  // A stand-in for engine.js's registry (PConf.whenResolvers), on the PConf this file shares.
  const fns = {};
  global.PConf.whenResolvers = { register(id, fn) { fns[id] = fn; }, get(id) { return fns[id]; } };
  const calls = [];
  global.PConf.whenResolvers.register('drawsUv', function (state, env, args) {
    calls.push([state, env, args]);
    return state[args.picker] === 'uv' ? 1 : 0;
  });
  const c = { thirdLine: 'uv', env: { lineStyles: true } };
  assert.equal(W.evaluate({ when: 'drawsUv', args: { picker: 'thirdLine' } }, c), true, 'a truthy answer holds');
  assert.deepEqual(calls[0], [c, c.env, { picker: 'thirdLine' }], 'the context, its env and the args');
  assert.equal(W.evaluate({ when: 'drawsUv', args: { picker: 'fourthLine' } }, c), false, 'a falsy answer does not');
  W.evaluate({ when: 'drawsUv' }, c);
  assert.deepEqual(calls[2][2], {}, 'a leaf without args passes {}');
  assert.equal(W.evaluate({ not: { when: 'drawsUv', args: { picker: 'thirdLine' } } }, c), false);
  assert.equal(W.evaluate({ when: 'nobodyRegisteredThis' }, c), false, 'unregistered: fail closed');
  assert.equal(W.evaluate({ not: { when: 'nobodyRegisteredThis' } }, c), true);
  delete global.PConf.whenResolvers;
  assert.equal(W.evaluate({ when: 'drawsUv', args: { picker: 'thirdLine' } }, c), false, 'no registry: fail closed');
});
