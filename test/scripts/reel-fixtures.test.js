'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const reel = require('../../scripts/gen-reel-fixtures');

test('themesFor follows the sweep order', () => {
  assert.deepStrictEqual(reel.themesFor('emery'), ['dark', 'bw', 'light', 'bw-light']);
  assert.deepStrictEqual(reel.themesFor('unknown'), []);
});

function generateIntoTmp() {
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ww-reel-'));
  const written = reel.generateReelFixtures({ outDir });
  const byName = {};
  for (const p of written) { byName[path.basename(p, '.json')] = JSON.parse(fs.readFileSync(p, 'utf8')); }
  return byName;
}

test('every segment writes a base fixture with minute-0 now and merged clay', () => {
  const byName = generateIntoTmp();
  for (const seg of reel.SEGMENTS) {
    const f = byName['reel-' + seg.id];
    assert.ok(f, 'base fixture for ' + seg.id);
    assert.strictEqual(f.watch.now.minute, 0);
    for (const [k, v] of Object.entries(seg.clay)) {
      assert.deepStrictEqual(f.claySettings[k], v, seg.id + '.' + k);
    }
  }
});

test('light / bw-light theme segments force colorTime black', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-theme-light'].claySettings.colorTime, '#000000');
  assert.strictEqual(byName['reel-theme-bwlight'].claySettings.colorTime, '#000000');
});

test('theme-bwlight and status-3 bake pollen data; other segments leave it unset', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-theme-bwlight'].weather.pollen, '1-2');
  assert.strictEqual(byName['reel-status-3'].weather.pollen, '1-2');
  assert.strictEqual(byName['reel-theme-bwlight'].claySettings.radarProvider, 'dwd',
    'bw-light pollen slot needs the DWD provider, like status-3');
  assert.strictEqual(byName['reel-theme-dark'].weather.pollen, undefined,
    'a theme without a pollen slot should not carry baked pollen data');
});

test('status-4 bakes pollen data alongside its health row', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-status-4'].weather.pollen, '1-2');
  assert.strictEqual(byName['reel-status-4'].claySettings.radarProvider, 'dwd');
  assert.strictEqual(byName['reel-status-4'].claySettings.statusTopLeft, 'uv');
  assert.strictEqual(byName['reel-status-4'].claySettings.statusTopMid, 'pollen');
});

test('theme sweep order is dark -> light -> bw -> bw-light; dark/light are compact, bw/bw-light progress denser/full', () => {
  const themeIds = reel.SEGMENTS.filter((s) => s.group === 'theme').map((s) => s.id);
  assert.deepStrictEqual(themeIds, ['theme-dark', 'theme-light', 'theme-bw', 'theme-bwlight']);
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-theme-dark'].claySettings.layoutPreset, 'compactCal');
  assert.strictEqual(byName['reel-theme-light'].claySettings.layoutPreset, 'compactCal');
  assert.strictEqual(byName['reel-theme-bw'].claySettings.layoutPreset, 'compactDense');
  assert.strictEqual(byName['reel-theme-bwlight'].claySettings.layoutPreset, 'fullCal');
});

test('each chapter pins one timeFont for the whole chapter (intro previews all three)', () => {
  const byName = generateIntoTmp();
  for (const seg of reel.SEGMENTS.filter((s) => s.group === 'graph')) {
    assert.strictEqual(byName['reel-' + seg.id].claySettings.timeFont, 'leco', seg.id);
  }
  for (const seg of reel.SEGMENTS.filter((s) => s.group === 'theme')) {
    assert.strictEqual(byName['reel-' + seg.id].claySettings.timeFont, 'bitham', seg.id);
  }
  for (const seg of reel.SEGMENTS.filter((s) => s.group === 'status')) {
    assert.strictEqual(byName['reel-' + seg.id].claySettings.timeFont, 'roboto', seg.id);
  }
});

test('graph-1 shows gust as a third (dotted) line alongside its new forecast/top slots', () => {
  const byName = generateIntoTmp();
  const clay = byName['reel-graph-1'].claySettings;
  assert.strictEqual(clay.thirdLine, 'gust');
  assert.strictEqual(clay.statusForecastRight, 'uv');
  assert.strictEqual(clay.statusTopLeft, 'aqi');
  assert.strictEqual(clay.statusTopRight, 'battery');
});

test('graph-3: UV secondary line has no fill (overrides the base fixture default)', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-graph-3'].claySettings.secondaryLineFill, false);
});

test('any segment carrying a LIVE health slot value pins healthMode so the summary cache ticks', () => {
  // health_mode 'off' never refreshes health_summary (main_window.c minute_handler), so a
  // live health slot (steps/sleep/hr/distance) placed anywhere while off renders blank/zero.
  const byName = generateIntoTmp();
  for (const id of ['reel-graph-3', 'reel-status-2', 'reel-status-3', 'reel-status-5']) {
    assert.notStrictEqual(byName[id].claySettings.healthMode, 'off', id);
  }
});

test('graph-5: its top strip shows distance/date/hr', () => {
  const clay = generateIntoTmp()['reel-graph-5'].claySettings;
  assert.deepStrictEqual([clay.statusTopLeft, clay.statusTopMid, clay.statusTopRight], ['distance', 'date', 'hr']);
});

test('status-1/2/3 use solid rain bars; status-3 also enables the bluetooth icon', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-status-1'].claySettings.rainBarColor, 'solid');
  assert.strictEqual(byName['reel-status-2'].claySettings.rainBarColor, 'solid');
  assert.strictEqual(byName['reel-status-3'].claySettings.rainBarColor, 'solid');
  assert.strictEqual(byName['reel-status-3'].claySettings.btIcons, 'connected');
});

test('status-1 top-right slot is battery', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-status-1'].claySettings.statusTopRight, 'battery');
});

test('status-5 is compact mode with uv/date in its top strip, every value bold', () => {
  const clay = generateIntoTmp()['reel-status-5'].claySettings;
  assert.strictEqual(clay.layoutPreset, 'compactCal');
  assert.deepStrictEqual([clay.statusTopLeft, clay.statusTopMid], ['uv', 'date']);
  assert.strictEqual(clay.statusBoldAll, 'all', 'the Bold values master');
});

test('theme top strips: light and bw-light carry the date in the top-mid, bw carries gust', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-theme-light'].claySettings.statusTopMid, 'date');
  assert.strictEqual(byName['reel-theme-bwlight'].claySettings.statusTopMid, 'date');
  assert.strictEqual(byName['reel-theme-bw'].claySettings.statusTopMid, 'gust');
});

test('status-2/3/4/5 show the heart rate', () => {
  const byName = generateIntoTmp();
  assert.strictEqual(byName['reel-status-2'].claySettings.statusTopRight, 'hr');
  assert.strictEqual(byName['reel-status-3'].claySettings.statusTopRight, 'hr');
  assert.strictEqual(byName['reel-status-4'].claySettings.statusHealthRight, 'hr');
  assert.strictEqual(byName['reel-status-5'].claySettings.statusForecastRight, 'hr');
});

test('fixture slugs are valid FIXTURE slugs', () => {
  for (const seg of reel.SEGMENTS) {
    assert.match(reel.fixtureFor(seg, 'emery'), /^[a-z0-9][a-z0-9-]*$/, seg.id);
  }
});

test('emery manifest: intro + all three captioned chapters in order', () => {
  const m = reel.buildManifest('emery');
  const cards = m.filter((s) => s.kind === 'card').map((s) => s.frame);
  assert.deepStrictEqual(cards, ['card-themes.png', 'card-graph.png', 'card-status.png']);
  const intro = m.filter((s) => s.group === 'intro').map((s) => s.frame);
  assert.deepStrictEqual(intro, ['scene_1.png', 'scene_7.png', 'scene_8.png', 'scene_9.png',
    'scene_6.png'], 'the showcase scenes, in their order');
  const themeFrames = m.filter((s) => s.group === 'theme' && s.kind === 'scene').map((s) => s.frame);
  assert.strictEqual(themeFrames.length, 4, 'emery has 4 theme segments');
});

test('manifest holds/fades come from TIMING by kind/group', () => {
  const m = reel.buildManifest('emery');
  const intro = m.find((s) => s.group === 'intro');
  const card = m.find((s) => s.kind === 'card');
  const chapter = m.find((s) => s.group === 'graph' && s.kind === 'scene');
  assert.strictEqual(intro.hold, reel.TIMING.intro.hold);
  assert.strictEqual(card.hold, reel.TIMING.card.hold);
  assert.strictEqual(chapter.hold, reel.TIMING.chapter.hold);
});

test('every screenshot (intro scenes + chapter frames) holds for the same length', () => {
  assert.strictEqual(reel.TIMING.chapter.hold, reel.TIMING.intro.hold);
});

test('the reel intro derives from the showcase table: its order, minus reelIntro:false scenes', () => {
  const showcase = require('../../scripts/gen-showcase-fixtures');
  const expected = showcase.SCENES.filter((s) => s.reelIntro !== false && s.inShowcase !== false)
    .map((s) => s.id);
  assert.deepStrictEqual(reel.INTRO_SCENES, expected,
    'INTRO_SCENES follows the showcase scene order with no local copy');
  assert.ok(showcase.SCENES.some((s) => s.reelIntro === false),
    'the flick-gated health-graph scene stays flagged out of the intro');
});
