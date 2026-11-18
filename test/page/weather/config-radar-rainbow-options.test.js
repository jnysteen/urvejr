// test/page/weather/config-radar-rainbow-options.test.js — the Rain radar picker (Setup › Data sources)
// offers Rainbow once, on the user's own key ('rainbowkey'). The blob stores the pick as
// radarProvider. Pinned here against the REAL generated page for a fresh install, an install
// on Rainbow, a 1.23.2 install booted through the migrations, and for the setup wizard's
// country pick, which turns the radar off where no keyless source covers the country.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('../../../src/pkjs/config-ui/lib/schema-walk.js');
require('../../../src/pkjs/lib/color.js');
require('../../../src/pkjs/config-ui/lib/show-when.js');
const E = require('../../../src/pkjs/config-ui/lib/engine.js');
require('../../../src/pkjs/page/settings/blocks.js');
// The provider's pollen cleanup, which the wizard's country derivation runs (applyDerived).
require('../../../src/pkjs/page/status-bars/reset-status-defaults.js');
const schema = require('../../../src/pkjs/page/settings/schema.js');
const OB = require('../../../src/pkjs/page/settings/onbuild.js');
const W = require('../../../src/pkjs/page/settings/wizard/wizard.js');
const { bootGeneratedPage } = require('../../helpers/page-harness');
const { loadLedger, COLORS } = require('../../helpers/clay-harness.js');
const REGISTRY = require('../../../src/pkjs/settings/domain/migrations/registry.js');
const KEYS = require('../../../src/pkjs/settings/domain/storage-keys');

const OWN = 'Rainbow';

/**
 * The open radar picker's option rows, keyed by value.
 * @param {Object} S Settings state (the page's, picker value folded).
 * @returns {Object} value -> the option button's inner HTML.
 */
function openPickerRows(S) {
  const env = { color: true, radar: true, platform: 'basalt' };
  const state = Object.assign({ radarMode: 'graph', radarProvider: 'dwd' }, S);
  const html = E.renderSelectModal(schema, {
    S: Object.assign({ radarSource: state.radarProvider }, state), ENV: env, openSelect: 'radarSource', selectQuery: '',
    evalCtx: Object.assign({}, state, { env })
  });
  const rows = {};
  const re = /<button[^>]*data-select-pick="([^"]+)"[^>]*>([\s\S]*?)<\/button>/g;
  let m;
  while ((m = re.exec(html))) { rows[m[1]] = m[2]; }
  return rows;
}

/**
 * The radar picker trigger's shown label and aria-label in the page markup.
 * @param {string} html #scroll markup.
 * @returns {{label: string, aria: string}} What the collapsed trigger says.
 */
function trigger(html) {
  const m = /data-select="radarSource" aria-label="([^"]*)"[^>]*><span>([^<]*)<\/span>/.exec(html);
  assert.ok(m, 'the radar picker trigger is rendered');
  return { aria: m[1], label: m[2] };
}

/**
 * Open the Setup tab (its Data sources card: the Rain radar picker and its key row).
 * @param {Object} page The page (page-harness).
 * @returns {void}
 */
function openRadarPane(page) {
  page.clickTab('setup');
}

/**
 * A stored blob booted on the Setup tab.
 * @param {Object} stored The stored settings.
 * @param {string} [platform] The watch.
 * @returns {Object} The page (page-harness).
 */
function radarPage(stored, platform) {
  const page = bootGeneratedPage(Object.assign({ provider: 'openmeteo', radarMode: 'graph' }, stored), platform);
  openRadarPane(page);
  return page;
}

// --- the option list -----------------------------------------------------------------------

test('the sheet lists Rainbow once, on the user\'s key', () => {
  const rows = openPickerRows({ holidayCountry: 'DE' });
  assert.deepEqual(Object.keys(rows), ['off', 'dwd', 'metno', 'rainbowkey', 'tomorrowio'],
    'Off first, then the sources');
  assert.match(rows.rainbowkey, /ssel-opt-name">Rainbow<\/span><span class="ssel-opt-desc">Worldwide satellite \+ radar nowcast · needs a free key</);
});

test('recommended marker: Off where no keyless radar covers the country, DWD in Germany', () => {
  const us = openPickerRows({ holidayCountry: 'US' });
  assert.match(us.off, /ssel-rec/, 'Off is recommended outside Germany and the Nordics');
  Object.keys(us).filter((v) => v !== 'off').forEach((v) => {
    assert.doesNotMatch(us[v], /ssel-rec/, v + ' carries no marker');
  });
  const de = openPickerRows({ holidayCountry: 'DE' });
  assert.match(de.dwd, /<span class="ssel-opt-name">DWD <b class="ssel-rec">\(Recommended\)<\/b><\/span>/);
  assert.doesNotMatch(de.rainbowkey, /ssel-rec/);
});

// --- the page: what it opens on ------------------------------------------------------------

test('a fresh install opens on DWD: no key row, no key fields', () => {
  const page = bootGeneratedPage({ provider: 'openmeteo' });
  openRadarPane(page);
  const tab = page.scroll.innerHTML;
  assert.deepEqual(trigger(tab), { label: 'DWD', aria: 'Rain radar: DWD' });
  assert.equal(page.S.radarProvider, 'dwd');
  assert.doesNotMatch(tab, /data-edit-sheet="radarKeyRainbow"/);
  assert.doesNotMatch(tab, /data-k="rainbowApiKey"|calls\/month/);
});

test('an install on Rainbow opens on it, with its key row', () => {
  const page = radarPage({ radarProvider: 'rainbowkey', rainbowApiKey: 'saved-key-wxyz' });
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);
  assert.equal(page.S.radarProvider, 'rainbowkey', 'the page holds the source');
  assert.match(page.scroll.innerHTML,
    /<div class="row nav indent" data-edit-sheet="radarKeyRainbow"[^>]*><div class="lft"><div class="lbl">Rainbow API key<\/div><div class="hint">Key ••••wxyz/,
    'the key row, naming the saved key');
});

// --- Save stores the pick -----------------------------------------------------------------

test('Save: every pick stores itself as radarProvider', async () => {
  const cases = [
    // [stored, pick (or null), expected radarProvider, label]
    [{}, null, 'dwd', 'fresh install, untouched'],
    [{ radarProvider: 'rainbowkey', rainbowApiKey: 'k' }, null, 'rainbowkey', 'Rainbow, untouched'],
    [{ radarProvider: 'rainbowkey', rainbowApiKey: 'k' }, 'dwd', 'dwd', 'Rainbow -> DWD'],
    [{ radarProvider: 'dwd' }, 'rainbowkey', 'rainbowkey', 'DWD -> Rainbow'],
    [{ radarProvider: 'tomorrowio', tomorrowioApiKey: 't' }, 'rainbowkey', 'rainbowkey', 'Tomorrow.io -> Rainbow']
  ];
  for (const [stored, pick, provider, label] of cases) {
    const page = radarPage(stored);
    if (pick) {
      page.openSelect('radarSource');
      page.pickOption('radarSource', pick);
      assert.equal(page.S.radarProvider, pick, label + ': the pick');
    }
    const saved = await page.save();
    assert.equal(saved.radarProvider, provider, label + ': radarProvider');
  }
});

test('Save keeps the Rainbow key after a switch to another source', async () => {
  const page = radarPage({ radarProvider: 'rainbowkey', rainbowApiKey: 'keep-me' });
  page.openSelect('radarSource');
  page.pickOption('radarSource', 'dwd');
  const saved = await page.save();
  assert.equal(saved.rainbowApiKey, 'keep-me', 'kept for a later switch back');
});

test('aplite (no Rain radar pane, radar forced off) keeps a stored Rainbow key through a Save', async () => {
  const page = bootGeneratedPage({ provider: 'openmeteo', radarProvider: 'rainbowkey',
    rainbowApiKey: 'k' }, 'aplite');
  const saved = await page.save();
  assert.equal(saved.radarProvider, 'rainbowkey');
});

// --- the hooks hold no radar dialect -----------------------------------------------------------

/**
 * An onLoad/onSubmit context over a plain store.
 * @param {Object} store The settings.
 * @returns {{ctx: Object, store: Object}} The context and its store.
 */
function hookCtx(store) {
  return {
    store,
    ctx: { env: { platform: 'basalt' }, get: (k) => store[k], set: (k, v) => { store[k] = v; }, getInitial: (k) => store[k] }
  };
}

test('onLoad and onSubmit pass radarProvider through as stored and write no rainbowOwnKey', () => {
  ['rainbowkey', 'dwd', 'tomorrowio'].forEach((radarProvider) => {
    const h = hookCtx({ radarProvider: radarProvider, radarMode: 'graph', fetchIntervalMin: '15' });
    OB.onLoad(h.ctx);
    assert.equal(h.store.radarProvider, radarProvider, radarProvider + ': open');
    OB.onSubmit(h.ctx);
    assert.equal(h.store.radarProvider, radarProvider, radarProvider + ': Save');
    assert.ok(!('rainbowOwnKey' in h.store), radarProvider + ': no switch written');
  });
});

// --- the upgrade, end to end ---------------------------------------------------------------

/**
 * A stored blob booted through the whole migration ledger with `marked` set, then the
 * page opened on the result, on the Graphs tab's Rain radar pane.
 * @param {Object} stored The blob the install holds.
 * @param {string[]} marked Markers the install holds.
 * @returns {Object} The page (page-harness).
 */
function upgradedRadarPage(stored, marked) {
  const L = loadLedger(stored);
  marked.forEach((k) => { L.store[k] = '1'; });
  L.claySettings.seedDefaults(COLORS);
  L.run(null, { hadExistingInstall: true });
  const page = bootGeneratedPage(L.read());
  openRadarPane(page);
  return page;
}

test('upgrade: a 1.23.2 install on its own key opens on Rainbow and saves it as itself', async () => {
  const at = REGISTRY.findIndex((e) => e.key === KEYS.ALERT_LEVELS_MIGRATION_KEY);
  const through123 = REGISTRY.slice(0, at).map((e) => e.key);
  const page = upgradedRadarPage({ provider: 'openmeteo', radarMode: 'graph', radarProvider: 'rainbow',
    rainbowOwnKey: true, rainbowApiKey: 'saved-key-wxyz', onboardingDone: true }, through123);
  assert.equal(trigger(page.scroll.innerHTML).label, OWN);
  const saved = await page.save();
  assert.equal(saved.radarProvider, 'rainbowkey');
  assert.ok(!('rainbowOwnKey' in saved));
});

// --- the setup wizard -------------------------------------------------------------------------

const ENV = { color: true, radar: true, platform: 'basalt' };

test('the wizard\'s country pick: DWD/Met.no where they cover, else the radar off unless a keyed source is picked', () => {
  const de = { holidayCountry: 'DE', radarProvider: 'rainbowkey', provider: 'openmeteo', radarEnabled: false };
  W.applyDerived(de, ENV);
  assert.equal(de.radarProvider, 'dwd', 'Germany\'s pick is DWD');
  assert.equal(de.radarEnabled, true, 'and the radar is on');
  const us = { holidayCountry: 'US', radarProvider: 'dwd', provider: 'dwd' };
  W.applyDerived(us, ENV);
  assert.equal(us.radarEnabled, false, 'no keyless radar covers the US: off');
  assert.equal(us.radarSource, 'off');
  const own = { holidayCountry: 'US', radarProvider: 'rainbowkey', provider: 'openmeteo' };
  W.applyDerived(own, ENV);
  assert.equal(own.radarProvider, 'rainbowkey', 'a keyed source stays');
  assert.notEqual(own.radarEnabled, false, 'and stays on');
});
