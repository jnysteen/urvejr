const test = require('node:test');
const assert = require('node:assert/strict');

// The Status bars tab's pinned preview prints each slot's SAMPLE reading the way the
// watch prints a real one: through slot-text.js / status-pair.js (the bake's own
// formatters), date-format.js (the watch's date formats) and the slot's byte cap.
const preview = require('../../../src/pkjs/page/status-bars/preview-status-bars.js');
const dateFormat = require('../../../src/pkjs/calendar/domain/date-format.js');
const catalog = require('../../../src/pkjs/status-bars/domain/status-line-catalog.js');

const EDGE = catalog.CAPS.EDGE_TEXT_MAX;
const MID = catalog.CAPS.MID_TEXT_MAX;
const DEG = '°';
const SEP_7_2026 = new Date(2026, 8, 7, 15, 0);
const sample = (code, S, ctx) => preview.sample(code, S, Object.assign({ now: SEP_7_2026 }, ctx));

test('the date slot prints month + year beside a calendar, in its picker\'s format', () => {
  assert.equal(sample('date', {}, { fullDate: false }), 'Sep 2026');
  assert.equal(sample('date', { dateSlotMonthFormat: 'name' }, { fullDate: false }), 'September 2026');
  assert.equal(sample('date', { dateSlotMonthFormat: 'iso' }, { fullDate: false }), '2026-09');
  assert.equal(sample('date', { dateSlotMonthFormat: 'dotsyy' }, { fullDate: false }), '09.26');
  assert.equal(sample('date', { dateSlotMonthFormat: 'noyear' }, { fullDate: false }), 'Sep');
});

test('the date slot prints the full date without a calendar, in the region\'s order', () => {
  assert.equal(sample('date', { holidayCountry: 'DE' }, { fullDate: true }), '07.09.26');
  assert.equal(sample('date', { holidayCountry: 'US' }, { fullDate: true }), '09.07.26');
  assert.equal(sample('date', {}, { fullDate: true }), '09.07.26', 'an absent region reads as the US');
  assert.equal(sample('date', { holidayCountry: 'DE', dateSlotFullFormat: 'textyear' },
    { fullDate: true }), '7. Sep 2026');
  assert.equal(sample('date', { holidayCountry: 'US', dateSlotFullFormat: 'text' },
    { fullDate: true }), 'Sep 7');
  // Never a weekday: the old sample's 'Thu 2' was no format the watch has.
  assert.doesNotMatch(sample('date', { holidayCountry: 'DE' }, { fullDate: true }), /[A-Z][a-z]{2} \d$/);
});

test('the date and week follow today, not a fixed sample', () => {
  const now = new Date();
  assert.equal(preview.sample('date', { dateSlotMonthFormat: 'dots' }, { fullDate: false }),
    dateFormat.formatMonthYear(now, 'dots'));
  assert.equal(sample('week', {}), 'W37', '7 Sep 2026 is in ISO week 37');
});

test('temperature: Show unit answers in every Value selection, a pair\'s on both readings', () => {
  assert.equal(sample('temp', {}), '18');
  assert.equal(sample('temp', { tempSlotUnit: true }), '18' + DEG);
  assert.equal(sample('temp', { tempSlotDisplay: 'feels', tempSlotUnit: true }), '16' + DEG);
  assert.equal(sample('temp', { tempSlotDisplay: 'both' }, { cap: MID }), '18|16');
  assert.equal(sample('temp', { tempSlotDisplay: 'both', tempSlotUnit: true }, { cap: MID }),
    '18' + DEG + '|16' + DEG);
  // '18°|16°' is 9 bytes: a left or right slot prints the pair bare, as the watch does.
  assert.equal(sample('temp', { tempSlotDisplay: 'both', tempSlotUnit: true }, { cap: EDGE }), '18|16');
  assert.equal(sample('temp', { temperatureUnits: 'f' }), '64');
});

test('temperature pairs take the slot\'s order, separator and spacing', () => {
  const S = { tempSlotDisplay: 'both', tempSlotUnit: true, tempSlotOrder: 'feels',
    tempSlotSeparator: 'brackets', tempSlotSeparatorSpaced: true };
  assert.equal(sample('temp', S, { cap: MID }), '16' + DEG + ' (18' + DEG + ')');
  assert.equal(sample('temp', Object.assign({}, S, { tempSlotUnit: false }), { cap: EDGE }), '16 (18)');
  assert.equal(sample('temp', { tempSlotDisplay: 'both', tempSlotSeparator: 'custom',
    tempSlotSeparatorCustom: '~' }, { cap: MID }), '18~16');
});

test('the day-max kinds print Now, Day max and Both as the watch does', () => {
  assert.equal(sample('uv', {}), '3');
  assert.equal(sample('uv', { uvSlotDisplay: 'max' }), '7');
  assert.equal(sample('uv', { uvSlotDisplay: 'both' }), '3/7');
  assert.equal(sample('uv', { uvSlotDisplay: 'both', uvSlotOrder: 'max' }), '7/3');
  assert.equal(sample('aqi', { aqiSlotDisplay: 'both', aqiSlotSeparator: 'dot',
    aqiSlotSeparatorSpaced: true }, { cap: MID }), '42 · 58');
  // A spaced pair keeps its spaces where they fit an edge slot.
  assert.equal(sample('gust', { gustSlotDisplay: 'both', gustSlotSeparatorSpaced: true,
    gustSlotUnit: false }, { cap: EDGE }), '20 / 45');
});

test('wind units sit tight, drop when they do not fit, and give way to the arrow', () => {
  const both = { windSlotDisplay: 'both', windSlotUnit: true };
  assert.equal(sample('wind', both, { cap: MID }), '12/30kph');
  assert.equal(sample('wind', Object.assign({ windSlotDirection: false }, both), { cap: EDGE }),
    '12/30kph', '8 bytes fit an edge slot without the arrow');
  assert.equal(sample('wind', Object.assign({ windSlotDirection: true }, both), { cap: EDGE }),
    '12/30', 'the arrow takes the unit\'s last byte');
  assert.equal(sample('wind', Object.assign({ windSlotDirection: true }, both), { cap: MID }),
    '12/30kph');
  assert.equal(sample('wind', { windSlotUnit: false }), '12');
  assert.equal(sample('wind', { windUnits: 'mph' }), '7mph');
  assert.equal(sample('gust', { windUnits: 'knots', gustSlotDisplay: 'max' }), '24kn');
});

test('the arrow follows the watch: on, the current reading shown', () => {
  assert.equal(preview.arrowDue('wind', { windSlotDirection: true }, {}), true);
  assert.equal(preview.arrowDue('wind', { windSlotDirection: false }, {}), false);
  assert.equal(preview.arrowDue('wind', { windSlotDirection: true, windSlotDisplay: 'max' }, {}), false,
    'Day max alone prints the peak, not the wind the arrow points');
  assert.equal(preview.arrowDue('wind', { windSlotDirection: true, windSlotDisplay: 'both' }, {}), true);
  assert.equal(preview.arrowDue('uv', { uvSlotDirection: true }, {}), false);
});

test('the arrow needs a free byte after the text, as packLine appends it', () => {
  // A spaced two-letter custom separator fills an edge slot: '12 ab 30' is 8 bytes.
  const S = { windSlotDirection: true, windSlotDisplay: 'both', windSlotSeparator: 'custom',
    windSlotSeparatorCustom: 'ab', windSlotSeparatorSpaced: true };
  const text = sample('wind', S, { cap: EDGE });
  assert.equal(text, '12 ab 30');
  assert.equal(preview.arrowShown('wind', text, S, {}, EDGE), false);
  assert.equal(preview.arrowShown('wind', '12/30', S, {}, EDGE), true);
});

test('the other phone-baked kinds print their units by their own toggles', () => {
  assert.equal(sample('pressure', {}), '1013hPa');
  assert.equal(sample('pressure', { pressureSlotUnit: false }), '1013');
  assert.equal(sample('dew', {}), '9');
  assert.equal(sample('dew', { dewSlotUnit: true }), '9' + DEG);
  assert.equal(sample('countdown', { statusTopLeftCountdown: '2026-09-12' }, { slotKey: 'statusTopLeft' }), '5d');
  assert.equal(sample('countdown', { statusTopLeftCountdown: '2026-09-12', countdownSlotUnit: false },
    { slotKey: 'statusTopLeft' }), '5');
  assert.equal(sample('countdown', {}, { slotKey: 'statusTopLeft' }), 'now', 'no date set: today');
  assert.equal(sample('sun', {}), '19:14');
  assert.equal(sample('sun', { axisTimeFormat: '12h', timeShowAmPm: true }), '7:14p');
});

test('the watch-rendered kinds print in the watch\'s own shapes', () => {
  assert.equal(sample('steps', {}), '6.2k');
  assert.equal(sample('sleep', {}), '7h12');
  assert.equal(sample('distance', {}), '4.2km');
  assert.equal(sample('distance', { distanceUnits: 'imperial' }), '2.6mi');
  assert.equal(sample('battery', {}), '', 'the watch battery is its glyph alone');
});

test('the block prints the date by whether the bar\'s view shows a calendar', () => {
  const now = new Date();
  const S = { statusTopLeft: 'date', holidayCountry: 'DE', dateSlotMonthFormat: 'iso',
    dateSlotFullFormat: 'long' };
  const withCal = preview.statusBarsPreview(Object.assign({ layoutPreset: 'compactCal' }, S), {});
  assert.ok(withCal.indexOf('>' + dateFormat.formatMonthYear(now, 'iso') + '<') !== -1, withCal);
  const noCal = preview.statusBarsPreview(Object.assign({ layoutPreset: 'noCal' }, S), {});
  assert.ok(noCal.indexOf('>' + dateFormat.formatFullDate(now, 'long', false) + '<') !== -1, noCal);
});

test('the block sizes each slot by its position: the middle slot has room for the degrees', () => {
  const S = { statusForecastLeft: 'temp', statusForecastMid: 'temp', statusForecastRight: 'empty',
    tempSlotDisplay: 'both', tempSlotUnit: true };
  const html = preview.statusBarsPreview(S, {});
  assert.ok(html.indexOf('<span class="sbp-v sbp-left">18|16</span>') !== -1, html);
  assert.ok(html.indexOf('<span class="sbp-v sbp-mid">18' + DEG + '|16' + DEG + '</span>') !== -1, html);
});

test('a calendar shows only for a calendar top with rows', () => {
  const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_FULL }), true);
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_COMPACT }), true);
  assert.equal(preview.calendarShown({ top: VC.TOP_CAL, tier: VC.TIER_NONE }), false);
  assert.equal(preview.calendarShown({ top: VC.TOP_GRAPH, tier: VC.TIER_NONE }), false);
  assert.equal(preview.calendarShown({ top: VC.TOP_RADAR, tier: VC.TIER_FULL }), false);
  assert.equal(preview.calendarShown(null), false);
});

test('a bar no view of the layout seats is left out', () => {
  // Weather only without health: no view shows the top strip, so no Watch bar.
  const S = { layoutPreset: 'weatherOnly', healthMode: 'off', radarMode: 'graph' };
  const html = preview.statusBarsPreview(S, {});
  assert.equal(html.indexOf('>Watch<'), -1, html);
  assert.ok(html.indexOf('>Forecast<') !== -1);
  assert.ok(preview.statusBarsPreview({ layoutPreset: 'compactCal' }, {}).indexOf('>Watch<') !== -1);
});

test('the Radar and Health bars show while a screen shows them', () => {
  const VC = require('../../../src/pkjs/layout/domain/view-cycle.js');
  const env = { platform: 'emery', health: true, radar: true };
  // A preset's screens follow its modes (view-cycle.js barsShown); the bars follow the screens.
  const presets = ['fullCal', 'compactCal', 'compactDense', 'noCal', 'weatherOnly'];
  presets.forEach((layoutPreset) => {
    ['off', 'slot', 'status', 'all'].forEach((healthMode) => {
      ['off', 'countdown', 'status', 'graph'].forEach((radarMode) => {
        const S = { layoutPreset, healthMode, radarMode };
        const html = preview.statusBarsPreview(S, env);
        const shown = VC.barsShown(S);
        const label = layoutPreset + '/' + healthMode + '/' + radarMode;
        assert.equal(html.indexOf('>Radar<') !== -1, shown.radar, label + ': ' + html);
        assert.equal(html.indexOf('>Health<') !== -1, shown.health, label + ': ' + html);
      });
    });
  });
  // Weather only with the radar graph draws the radar on top and no Radar bar.
  const wo = preview.statusBarsPreview({ layoutPreset: 'weatherOnly', healthMode: 'all', radarMode: 'graph' }, env);
  assert.equal(wo.indexOf('>Radar<'), -1, wo);
  assert.ok(wo.indexOf('>Health<') !== -1, wo);
  // A custom layout lists the bars its screens hold, whatever the stored modes say: the
  // Radar bar without radar data too.
  const custom = Object.assign({ layoutPreset: 'custom', healthMode: 'all', radarMode: 'graph' },
    VC.specToKeys(VC.buildViewCycle('weatherOnly', 'all', 'graph', false)));
  const none = preview.statusBarsPreview(custom, env);
  assert.equal(none.indexOf('>Radar<'), -1, 'no screen holds the Radar bar: ' + none);
  const seated = Object.assign({}, custom, { viewUpper0: 'radar', viewLower0: 'health', radarMode: 'off',
    healthMode: 'off' });
  const html = preview.statusBarsPreview(seated, env);
  assert.ok(html.indexOf('>Radar<') !== -1, html);
  assert.ok(html.indexOf('>Health<') !== -1, html);
});

test('the Radar and Health bars stay out while no screen shows them', () => {
  const env = { platform: 'emery', health: true, radar: true };
  const off = preview.statusBarsPreview({ layoutPreset: 'compactCal', healthMode: 'slot', radarMode: 'countdown' }, env);
  assert.equal(off.indexOf('>Radar<'), -1, off);
  assert.equal(off.indexOf('>Health<'), -1, off);
});

test('two-value temperature pairs keep the user\'s separator when the degree cannot fit', () => {
  const S = { tempSlotDisplay: 'both', tempSlotUnit: true, tempSlotSeparator: 'dot',
    tempSlotSeparatorSpaced: true };
  assert.equal(sample('temp', S, { cap: EDGE }), '18 · 16', 'bare, never a narrowed 18°·16°');
});

// The owner's, 2026-11-14: no slot takes a tap of its own (a tap on a slot hid that a bar has
// more settings); a tap on a bar's row opens its dialog (screens-page.js barsCard).
test('the bars are pictures alone, on the tab and above a slot\'s dialog: nothing to tap', () => {
  const S = { statusTopLeft: 'empty', statusTopMid: 'date', statusTopRight: 'battery',
    statusForecastLeft: 'temp', statusForecastMid: 'city', statusForecastRight: 'aqi',
    layoutPreset: 'compactCal', healthMode: 'off', radarMode: 'off' };
  [undefined, { dialog: true }].forEach((opts) => {
    const html = preview.statusBarsPreview(S, {}, {}, opts);
    const where = opts ? 'above a dialog' : 'on the tab';
    assert.match(html, /^<span class="sbp" role="img" aria-label="Status bars preview"/, where);
    assert.equal(html.indexOf('<button'), -1, where + ': no buttons');
    assert.equal(html.indexOf('data-select'), -1, where + ': no picker to open');
    assert.equal(html.indexOf('sbp-hole'), -1, where + ': an empty slot is blank, as on the watch');
    assert.equal(html.indexOf('sbp-tip'), -1, where + ': and no tip to tap');
    assert.equal(html.indexOf('<div'), -1, where + ': spans alone, so a picture fits inside a button');
    assert.ok(html.indexOf('<span class="sbp-v sbp-left"></span>') !== -1, where + ': the empty slot');
    assert.ok(html.indexOf('<span class="sbp-v sbp-mid">Berlin</span>') !== -1, html);
  });
  const one = preview.barPicture(S, {}, 'forecast', { dim: true });
  assert.match(one, /^<span class="sbp one dim" role="img" aria-label="Forecast bar"/, 'one bar, dimmed');
  assert.equal(one.indexOf('<button'), -1, 'one bar: no buttons');
  assert.equal(one.indexOf('<div'), -1, 'one bar: spans alone');
});

test('barCodes reads each bar\'s slots as barSlots does, without the sample text', () => {
  const emery = {};
  const S = { statusHealthLeft: 'empty', statusHealthRight: 'hr', statusForecastMid: 'city' };
  catalog.LINES.forEach((line) => {
    const codes = preview.barCodes(S, emery, line.id);
    assert.deepEqual(codes.map((c) => c.key), line.slots, line.id);
    assert.deepEqual(codes.map((c) => c.pos), catalog.SLOT_POSITIONS, line.id);
    assert.deepEqual(codes, preview.barSlots(S, emery, line.id).map((c) => ({ pos: c.pos, key: c.key, code: c.code })),
      line.id);
  });
  assert.equal(preview.barCodes(S, emery, 'health')[2].code, 'hr');
  assert.deepEqual(preview.barCodes(S, emery, 'unknown'), []);
});

// The weather condition slot's picture prints the sample partly cloudy afternoon as the bake
// does (slot-text.js conditionText): the name with its short form where the slot has the
// bytes, split into the text and the form the watch picture swaps in where the row would cut
// the name; the short form alone in an edge slot. The Look decides the glyph
// in one place, slotIcon.
test('the condition slot: the bake\'s forms, split, and one place for the glyph', () => {
  const emery = { platform: 'emery' };
  assert.equal(sample('condition', {}, { cap: MID, env: emery }), 'Partly cloudy' + catalog.ALT_SEP + 'PCLDY');
  assert.equal(sample('condition', {}, { cap: EDGE, env: emery }), 'PCLDY');
  assert.equal(sample('condition', { conditionSlotLook: 'icon' }, { cap: MID, env: emery }), '');
  const S = { statusForecastLeft: 'condition', statusForecastMid: 'condition', statusForecastRight: 'empty' };
  const [left, mid] = preview.barSlots(S, emery, 'forecast');
  assert.deepEqual([mid.text, mid.alt], ['Partly cloudy', 'PCLDY']);
  assert.deepEqual([left.text, left.alt], ['Partly cloudy', 'PCLDY'], 'the line has the room: as the bake gives it');
  // A full line leaves an edge one form, as the bake does (status-line-catalog.js widenEdges).
  const full = preview.barSlots(Object.assign({}, S, { statusForecastRight: 'condition' }), emery, 'forecast');
  assert.deepEqual([full[0].text, full[0].alt, full[2].text], ['PCLDY', '', 'PCLDY']);
  assert.equal(preview.slotIcon('condition', emery, { conditionSlotLook: 'text' }), null, 'the Text look: no glyph');
  // The city draws the current weather's icon before its name unless switched off.
  assert.equal(preview.slotIcon('city', emery, {}), preview.slotIcon('condition', emery, {}),
    'the city: the weather icon, on by default');
  assert.equal(preview.slotIcon('city', emery, { citySlotIcon: false }), null, 'switched off: none');
  assert.equal(preview.barSlots(Object.assign({ conditionSlotLook: 'text' }, S), emery, 'forecast')[1].icon, null);
});
