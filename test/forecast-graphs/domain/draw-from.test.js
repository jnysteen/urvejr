// test/forecast-graphs/domain/draw-from.test.js — Draw from / Bars from [Bottom | Top] (src/pkjs/forecast-graphs/domain/draw-from.js):
// the one reading of the six settings and its gates (no line styles, a stripe, a line that is not
// drawn, a metric without the setting). The wire bytes and their bits are pinned in
// graph-wire.test.js, the settings page in config-draw-from.test.js.
const test = require('node:test');
const assert = require('node:assert/strict');

const drawFrom = require('../../../src/pkjs/forecast-graphs/domain/draw-from.js');
const lineStyle = require('../../../src/pkjs/forecast-graphs/domain/line-style.js');
const platform = require('../../../src/pkjs/config-ui/lib/platform.js');

const EMERY = platform.computeEnv();
// An env whose watch draws no line styles (lineStyles false): Draw from never applies.
const NO_STYLES = Object.assign(platform.computeEnv(), { lineStyles: false });
const ALL_TOP = { precipLineFrom: 'top', cloudLineFrom: 'top', windLineFrom: 'top', uvLineFrom: 'top',
  rainBarFrom: 'top', radarBarFrom: 'top' };
// Each forecast line's lineEdge, in line order.
const edges = (S, env) => lineStyle.FORECAST_LINES.map((l) => drawFrom.lineEdge(S, l.key, env));

test('only the exact string \'top\' reads Top; absent, true, \'TOP\' and junk read Bottom', () => {
  assert.equal(drawFrom.value('top'), 'top');
  [undefined, null, '', 'bottom', true, false, 1, 'TOP', 'Top', ' top', 'constructor', {}].forEach((v) =>
    assert.equal(drawFrom.value(v), 'bottom', JSON.stringify(v)));
});

test('the five amount metrics have a key, wind and gusts one shared key; no other metric has one', () => {
  assert.equal(drawFrom.settingKey('precip_prob'), 'precipLineFrom');
  assert.equal(drawFrom.settingKey('cloud'), 'cloudLineFrom');
  assert.equal(drawFrom.settingKey('wind'), 'windLineFrom');
  assert.equal(drawFrom.settingKey('gust'), 'windLineFrom');
  assert.equal(drawFrom.settingKey('uv'), 'uvLineFrom');
  ['feels', 'dew', 'pressure', 'temp', 'off', undefined, null, 'constructor', 'toString'].forEach((m) =>
    assert.equal(drawFrom.settingKey(m), null, String(m)));
});

test('the rows cover exactly the stripe metrics, each once, in their order', () => {
  const covered = [];
  drawFrom.ROWS.forEach((row) => {
    row.metrics.forEach((m) => { assert.equal(drawFrom.settingKey(m), row.key); covered.push(m); });
  });
  assert.deepEqual(covered, lineStyle.STRIPE_METRIC_IDS);
  assert.deepEqual(drawFrom.ROWS.map((r) => r.key), ['precipLineFrom', 'cloudLineFrom', 'windLineFrom', 'uvLineFrom']);
  assert.deepEqual(drawFrom.BAR_KEYS, { rain: 'rainBarFrom', radar: 'radarBarFrom' });
});

test('a watch with line styles is capable; lineStyles false is not', () => {
  assert.equal(drawFrom.capable(platform.computeEnv()), true);
  assert.equal(drawFrom.capable(NO_STYLES), false);
  assert.equal(drawFrom.capable(undefined), true);
  assert.equal(drawFrom.capable({}), true, 'an env without the fact');
});

test('a drawn line hangs only when its metric\'s key reads Top', () => {
  const S = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'gust',
    secondaryLineStyle: 'line', thirdLineStyle: 'dots', fourthLineStyle: 'x', fifthLineStyle: 'bold' };
  assert.deepEqual(edges(S, EMERY), ['bottom', 'bottom', 'bottom', 'bottom']);
  const top = Object.assign({ precipLineFrom: 'top', windLineFrom: 'top' }, S);
  assert.deepEqual(edges(top, EMERY), ['top', 'bottom', 'top', 'top'],
    'rain chance, UV keeps Bottom, wind, gusts share the wind key');
  // Every style that is a line or marks hangs.
  ['line', 'bold', 'dots', 'x'].forEach((style) => assert.equal(
    drawFrom.lineEdge({ secondaryLine: 'cloud', secondaryLineStyle: style, cloudLineFrom: 'top' },
      'secondaryLine', EMERY), 'top', style));
});

test('the gates: aplite, a stripe, a line off, a repeat, a metric without the setting', () => {
  // aplite: never, whatever is stored.
  assert.deepEqual(edges(Object.assign(
    { secondaryLine: 'precip_prob', thirdLine: 'cloud', fourthLine: 'wind', fifthLine: 'feels' }, ALL_TOP), NO_STYLES),
  [null, null, null, null], 'aplite');
  // A stripe keeps its own Top/Bottom: a stored Top lies dormant.
  ['stripeTop', 'stripeBottom'].forEach((style) => assert.equal(drawFrom.lineEdge(
    { secondaryLine: 'uv', secondaryLineStyle: style, uvLineFrom: 'top' }, 'secondaryLine', EMERY), null, style));
  // Line off.
  assert.equal(drawFrom.lineEdge({ secondaryLine: 'uv', thirdLine: 'off', cloudLineFrom: 'top' },
    'thirdLine', EMERY), null);
  // A repeat of an earlier picker's metric is not drawn (effectiveLineMetric null).
  const repeat = { secondaryLine: 'cloud', thirdLine: 'cloud', cloudLineFrom: 'top' };
  assert.equal(drawFrom.lineEdge(repeat, 'secondaryLine', EMERY), 'top');
  assert.equal(drawFrom.lineEdge(repeat, 'thirdLine', EMERY), null);
  // A stale UV Top while no line draws UV flips nothing.
  const stale = { secondaryLine: 'precip_prob', thirdLine: 'wind', fourthLine: 'off', fifthLine: 'off',
    uvLineFrom: 'top' };
  assert.deepEqual(edges(stale, EMERY), ['bottom', 'bottom', null, null]);
  // Temperature-axis and pressure lines never hang, whatever is stored: they float.
  ['feels', 'dew', 'pressure'].forEach((m) => assert.equal(drawFrom.lineEdge(Object.assign(
    { secondaryLine: m }, ALL_TOP), 'secondaryLine', EMERY), 'float', m));
  // An env without the fact reads capable, as computeEnv(null) does; no settings draw nothing.
  assert.deepEqual(edges(Object.assign({ secondaryLine: 'cloud' }, ALL_TOP), {}), ['top', null, null, null]);
  assert.deepEqual(edges(undefined, EMERY), [null, null, null, null]);
});

test('the choice follows its metric from picker to picker', () => {
  const S = { cloudLineFrom: 'top' };
  lineStyle.FORECAST_LINES.forEach((l, i) => {
    const s = Object.assign({ secondaryLine: 'precip_prob', thirdLine: 'off', fourthLine: 'off', fifthLine: 'off' }, S);
    if (i > 0) { s[l.key] = 'cloud'; } else { s.secondaryLine = 'cloud'; }
    assert.equal(drawFrom.lineEdge(s, l.key, EMERY), 'top', l.key);
    assert.equal(drawFrom.metricFromTop(s, 'cloud', EMERY), true);
  });
});

test('linesSharing counts the drawn lines, not stripes, a key moves', () => {
  const S = { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'uv', fifthLine: 'off' };
  assert.equal(drawFrom.linesSharing(S, 'windLineFrom', EMERY), 2);
  assert.equal(drawFrom.linesSharing(S, 'uvLineFrom', EMERY), 1);
  assert.equal(drawFrom.linesSharing(S, 'cloudLineFrom', EMERY), 0);
  assert.equal(drawFrom.linesSharing(Object.assign({}, S, { thirdLineStyle: 'stripeBottom' }), 'windLineFrom', EMERY), 1,
    'a gust stripe does not hang');
  assert.equal(drawFrom.linesSharing(S, 'windLineFrom', NO_STYLES), 0, 'aplite hangs nothing');
});

test('rowLine: the first line that hangs from a key, where the settings page puts its row', () => {
  const S = { secondaryLine: 'wind', thirdLine: 'gust', fourthLine: 'uv', fifthLine: 'cloud' };
  assert.equal(drawFrom.rowLine(S, 'windLineFrom', EMERY), 'secondaryLine', 'wind and gusts: the first of the two');
  assert.equal(drawFrom.rowLine(S, 'uvLineFrom', EMERY), 'fourthLine');
  assert.equal(drawFrom.rowLine(S, 'cloudLineFrom', EMERY), 'fifthLine');
  assert.equal(drawFrom.rowLine(S, 'precipLineFrom', EMERY), null, 'no line reads it');
  assert.equal(drawFrom.rowLine(S, 'rainBarFrom', EMERY), null, 'a bar key has no line');
  // A stripe keeps its own Top/Bottom: the row moves on to the next line that hangs.
  assert.equal(drawFrom.rowLine(Object.assign({}, S, { secondaryLineStyle: 'stripeTop' }), 'windLineFrom', EMERY),
    'thirdLine');
  // A stored repeat is not drawn, so it never hosts the row, even after an earlier stripe.
  const repeat = { secondaryLine: 'cloud', secondaryLineStyle: 'stripeBottom', thirdLine: 'cloud', fourthLine: 'off' };
  assert.equal(drawFrom.rowLine(repeat, 'cloudLineFrom', EMERY), null);
  // Metrics without a key never host one; aplite hangs nothing.
  assert.equal(drawFrom.rowLine({ secondaryLine: 'pressure', thirdLine: 'feels' }, 'precipLineFrom', EMERY), null);
  assert.equal(drawFrom.rowLine(S, 'windLineFrom', NO_STYLES), null);
  // Where the row is, the wire hangs that line once the key reads Top, and no earlier one.
  const top = Object.assign({ fifthLineStyle: 'dots', cloudLineFrom: 'top' }, S);
  assert.deepEqual(edges(top, EMERY), ['bottom', 'bottom', 'bottom', 'top']);
});

test('the bars hang per chart, whatever barSource and radarMode say', () => {
  assert.equal(drawFrom.barsFromTop({}, 'rain', EMERY), false);
  assert.equal(drawFrom.barsFromTop({ rainBarFrom: 'top' }, 'rain', EMERY), true);
  assert.equal(drawFrom.barsFromTop({ rainBarFrom: 'top' }, 'radar', EMERY), false, 'each chart its own key');
  assert.equal(drawFrom.barsFromTop({ radarBarFrom: 'top' }, 'radar', EMERY), true);
  assert.equal(drawFrom.barsFromTop({ rainBarFrom: 'top', barSource: 'off' }, 'rain', EMERY), true, 'inert, not cleared');
  assert.equal(drawFrom.barsFromTop({ radarBarFrom: 'top', radarMode: 'status' }, 'radar', EMERY), true);
  assert.equal(drawFrom.barsFromTop(ALL_TOP, 'rain', NO_STYLES), false, 'never on aplite');
  assert.equal(drawFrom.barsFromTop(ALL_TOP, 'radar', NO_STYLES), false);
  assert.equal(drawFrom.barsFromTop(ALL_TOP, 'constructor', EMERY), false);
});

test('the anchored edges: a drawn amount line anchors the edge it is drawn from', () => {
  const S = { secondaryLine: 'precip_prob', thirdLine: 'uv', fourthLine: 'wind', fifthLine: 'pressure',
    secondaryLineStyle: 'line', thirdLineStyle: 'dots', fourthLineStyle: 'x', fifthLineStyle: 'bold' };
  assert.deepEqual(edges(S, EMERY), ['bottom', 'bottom', 'bottom', 'float'], 'standing; pressure anchors nothing');
  const top = Object.assign({ precipLineFrom: 'top', windLineFrom: 'top' }, S);
  assert.deepEqual(edges(top, EMERY), ['top', 'bottom', 'top', 'float']);
  // No edge: a stripe, a line off or repeated, aplite.
  assert.equal(drawFrom.lineEdge({ secondaryLine: 'uv', secondaryLineStyle: 'stripeTop' }, 'secondaryLine', EMERY), null);
  assert.equal(drawFrom.lineEdge({ secondaryLine: 'uv', thirdLine: 'off' }, 'thirdLine', EMERY), null);
  assert.equal(drawFrom.lineEdge({ secondaryLine: 'uv', thirdLine: 'uv' }, 'thirdLine', EMERY), null);
  assert.deepEqual(edges(S, NO_STYLES), [null, null, null, null], 'aplite');
});

test('a drawn line floats exactly when its metric has no Draw from key', () => {
  ['feels', 'dew', 'pressure'].forEach((m) => {
    assert.equal(drawFrom.lineEdge({ secondaryLine: m }, 'secondaryLine', EMERY), 'float', m);
    ['dots', 'x', 'bold'].forEach((st) => assert.equal(drawFrom.lineEdge(
      { secondaryLine: 'uv', thirdLine: m, thirdLineStyle: st }, 'thirdLine', EMERY), 'float', m + ' ' + st));
    assert.equal(drawFrom.lineEdge({ secondaryLine: m }, 'secondaryLine', NO_STYLES), null, 'aplite ' + m);
    assert.equal(drawFrom.lineEdge({ secondaryLine: m, thirdLine: m }, 'thirdLine', EMERY), null, 'repeat ' + m);
  });
  lineStyle.STRIPE_METRIC_IDS.forEach((m) =>
    assert.equal(drawFrom.lineEdge({ secondaryLine: m }, 'secondaryLine', EMERY), 'bottom', m));
  assert.equal(drawFrom.lineEdge({ secondaryLine: 'off' }, 'secondaryLine', EMERY), null);
  assert.equal(drawFrom.lineEdge({ secondaryLine: 'uv', secondaryLineStyle: 'stripeBottom' }, 'secondaryLine', EMERY),
    null, 'a stripe');
});

test('forecastAnchors: the rain bars while they draw, and the drawn amount lines', () => {
  const none = { secondaryLine: 'pressure', thirdLine: 'feels', fourthLine: 'off', fifthLine: 'off', barSource: 'off' };
  assert.deepEqual(drawFrom.forecastAnchors(none, EMERY), { top: false, bottom: false });
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { barSource: 'rain' }), EMERY),
    { top: false, bottom: true }, 'standing bars');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { barSource: 'rain', rainBarFrom: 'top' }), EMERY),
    { top: true, bottom: false }, 'hanging bars');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { rainBarFrom: 'top' }), EMERY),
    { top: false, bottom: false }, 'a Bars from: Top with the bars off anchors nothing');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { thirdLine: 'cloud', cloudLineFrom: 'top' }), EMERY),
    { top: true, bottom: false }, 'a hanging cloud line');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none,
    { barSource: 'rain', thirdLine: 'cloud', cloudLineFrom: 'top' }), EMERY), { top: true, bottom: true });
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none,
    { thirdLine: 'cloud', thirdLineStyle: 'stripeTop' }), EMERY), { top: false, bottom: false }, 'a stripe');
  assert.deepEqual(drawFrom.forecastAnchors(Object.assign({}, none, { barSource: 'rain', thirdLine: 'cloud' }), NO_STYLES),
    { top: false, bottom: false }, 'aplite keeps its frozen margins');
  assert.deepEqual(drawFrom.forecastAnchors(undefined, EMERY), { top: false, bottom: false });
});

test('forecastAnchors: an element with nothing above 0 anchors nothing (hasValue)', () => {
  const S = { secondaryLine: 'precip_prob', precipLineFrom: 'top', thirdLine: 'uv', fourthLine: 'off', fifthLine: 'off',
    barSource: 'rain' };
  const asked = [];
  const only = (keys) => (key) => { asked.push(key); return keys.indexOf(key) !== -1; };
  assert.deepEqual(drawFrom.forecastAnchors(S, EMERY), { top: true, bottom: true }, 'absent: every element has one');
  assert.deepEqual(drawFrom.forecastAnchors(S, EMERY, only(['bars', 'secondaryLine', 'thirdLine'])),
    { top: true, bottom: true });
  assert.deepEqual(drawFrom.forecastAnchors(S, EMERY, only([])), { top: false, bottom: false }, 'all zero: nothing');
  // No rain forecast, the bars hanging: the top is anchored only by the hanging rain-chance line.
  const hang = Object.assign({}, S, { rainBarFrom: 'top', thirdLine: 'off' });
  assert.deepEqual(drawFrom.forecastAnchors(hang, EMERY, only(['secondaryLine'])), { top: true, bottom: false });
  assert.deepEqual(drawFrom.forecastAnchors(hang, EMERY, only([])), { top: false, bottom: false });
  assert.deepEqual(drawFrom.forecastAnchors(hang, EMERY, only(['bars'])), { top: true, bottom: false });
  // The standing UV line alone.
  assert.deepEqual(drawFrom.forecastAnchors(S, EMERY, only(['thirdLine'])), { top: false, bottom: true });
  // Asked only of the elements that would anchor: the bars and drawn amount lines.
  asked.length = 0;
  drawFrom.forecastAnchors({ secondaryLine: 'pressure', thirdLine: 'uv', thirdLineStyle: 'stripeTop', barSource: 'off' },
    EMERY, only([]));
  assert.deepEqual(asked, []);
  assert.deepEqual(drawFrom.forecastAnchors(S, NO_STYLES, only(['bars'])), { top: false, bottom: false }, 'aplite');
});
