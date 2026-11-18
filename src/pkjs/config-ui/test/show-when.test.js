// src/pkjs/config-ui/test/show-when.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/show-when.js');
const platform = require('../../config-ui/lib/platform.js');
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

test('itemPredicate AND-merges COLOR capability; isVisible hides COLOR on b&w', () => {
  assert.deepEqual(W.itemPredicate({ capabilities: ['COLOR'] }), { env: 'color' });
  assert.deepEqual(W.itemPredicate({ showWhen: { key: 'barSource', eq: 'rain' }, capabilities: ['COLOR'] }),
    { all: [{ key: 'barSource', eq: 'rain' }, { env: 'color' }] });
  assert.equal(W.itemPredicate({ messageKey: 'x' }), null);
  assert.equal(W.isVisible({ capabilities: ['COLOR'] }, ctx), false);
  assert.equal(W.isVisible({ messageKey: 'x' }, ctx), true);
});

test('{ env: <fact> } reads the env: the watch\'s facts show an item, no env hides it', () => {
  ['colorBacklight', 'onDemand'].forEach((fact) => {
    const item = { messageKey: 'x', showWhen: { env: fact } };
    assert.equal(W.isVisible(item, { env: platform.computeEnv() }), true, fact);
    assert.equal(W.isVisible(item, { env: { [fact]: false } }), false, fact + ' off');
  });
  assert.equal(W.isVisible({ messageKey: 'x', showWhen: { env: 'colorBacklight' } }, {}), false,
    'no env at all: fail closed');
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
