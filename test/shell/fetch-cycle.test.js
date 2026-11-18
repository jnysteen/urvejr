// test/shell/fetch-cycle.test.js
//
// The weather fetch cycle through its interface only: createFetchCycle(deps)
// → { shouldFetchNow(), start(force) }. Everything the cycle touches is a fake
// the test drives by hand — the clock (deps.now), the timer queue
// (deps.setTimeout), the provider (its coordinate and forecast callbacks), the
// and the outbox — except auth-backoff.js and notices.js, which
// are the real modules over the storage mock. Assertions stay on outcomes: the
// return values, the four storage records (weather_fetch_attempt,
// lastFetchSuccess, lastFetchAttempt, lastIsSleeping), the key's answers
// (keyResults) and the key status the settings page reads from them, the calls
// the fakes saw. Never on log text, never on module
// internals.
//
// Radar observation seam: with radarProvider 'tomorrowio' and a key, the radar
// leg asks WeatherProvider.request (looked up at call time) for a URL carrying
// `location=lat,lon`; the stub below records those coordinates and holds the
// callbacks. Cases that do not care about radar run on an aplite watch, whose
// build has no radar — then no radar request is made and no radar keys ride
// along.
//
// isPastRefreshSlot / failureBackoffMs are covered in place (battery saver and
// fetch-backoff tests) and are not re-tested here.
const test = require('node:test');
const assert = require('node:assert/strict');

// House pattern: install the localStorage mock BEFORE requiring the modules.
// setItem can be made to throw for one key (a full store, as seen for real).
var store = {};
var throwOnSetItem = null;
global.localStorage = {
    getItem: function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; },
    setItem: function (k, v) {
        if (k === throwOnSetItem) { throw new Error('QuotaExceededError'); }
        store[k] = String(v);
    },
    removeItem: function (k) { delete store[k]; }
};

const WeatherProvider = require('../../src/pkjs/weather/adapter/provider.js');
const createFetchCycle = require('../../src/pkjs/shell/fetch-cycle.js');
const fetchOptions = require('../../src/pkjs/weather/domain/fetch-options.js');
const radarFactory = require('../../src/pkjs/weather/adapter/radar-factory.js');
const radarSky = require('../../src/pkjs/weather/domain/radar/radar-sky.js');
const radarWire = require('../../src/pkjs/weather/domain/radar/radar-wire.js');
const authBackoff = require('../../src/pkjs/weather/adapter/auth-backoff.js');
const notices = require('../../src/pkjs/notices/adapter/notices.js');
const gpsFailure = require('../../src/pkjs/weather/adapter/location.js').gpsFailure;
const KEYS = require('../../src/pkjs/settings/domain/storage-keys.js');

// The radar seam: every radar HTTP request the cycle makes, with the
// coordinates parsed out of its URL, its method and body, and the callbacks to
// answer it with.
var radarRequests = [];
WeatherProvider.request = function (url, type, onSuccess, onError, headers, body) {
    var m = /[?&]location=([-\d.]+),([-\d.]+)/.exec(url);
    radarRequests.push({
        url: url,
        type: type,
        body: body,
        coords: m ? { lat: Number(m[1]), lon: Number(m[2]) } : null,
        onSuccess: onSuccess,
        onError: onError,
        headers: headers
    });
};

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
// A UTC hour boundary, so the 60-min refresh slots line up with T0 whatever
// the test machine's time zone (slots are UTC-aligned epoch chunks).
const T0 = Date.UTC(2026, 6, 7, 10, 0, 0);
const WATCHDOG_MS = createFetchCycle.FETCH_WATCHDOG_MS;
const APLITE = { platform: 'aplite' };   // radar compiled out
const BASALT = { platform: 'basalt' };   // radar-capable
const CLEAR = { RAIN_RADAR_TREND_UINT8: [], RAIN_RADAR_TREND_AREA_UINT8: [], RAIN_RADAR_START: 0 };
// The radar's sky rows (radar-sky.js) ride the same merged answer. None of these settings
// turn the sky on, so the 'disabled' sky source answers its CLEAR synchronously and it
// rides beside whatever the radar answered — including a transient radar miss.
const SKY_CLEAR = radarSky.clearSkyTuple();
const ENV = { waqiToken: 'WAQI-TOKEN' };

/** Empty the storage mock, the setItem fault and the radar request log. */
function resetStore() {
    for (var k in store) { delete store[k]; }
    throwOnSetItem = null;
    radarRequests = [];
}

/** The parsed JSON record under `key`, or null when absent. */
function readJson(key) {
    var raw = store[key];
    return raw === undefined ? null : JSON.parse(raw);
}

/**
 * Sleep settings whose window starts at the local hour `date` falls in (the
 * window reads local hours) and lasts `hours` hours (default 1), so a time
 * that many hours or more later is outside it.
 */
function sleepWindowCovering(date, hours) {
    var h = date.getHours();
    return {
        sleepNightEnabled: true,
        sleepStartHour: String(h),
        sleepEndHour: String((h + (hours || 1)) % 24)
    };
}

/** A tomorrow.io Timelines body: 24 five-minute frames of `rate` mm/h from `startEpoch`. */
function timelinesBody(startEpoch, rate) {
    var intervals = [];
    for (var i = 0; i < 24; i += 1) {
        intervals.push({
            startTime: new Date((startEpoch + i * 300) * 1000).toISOString(),
            values: { precipitationIntensity: rate }
        });
    }
    return JSON.stringify({ data: { timelines: [{ intervals: intervals }] } });
}

/**
 * A hand-driven provider: it records every call and never answers on its own.
 * fix()/noFix() answer the latest coordinate request; succeed()/fail() the
 * latest forecast request.
 */
function makeProvider(id) {
    var p = {
        id: id || 'fake',
        name: (id || 'fake') + ' weather',
        options: null,
        geocodeBackoff: false,
        throwOnCoordinates: false,
        calls: { withCoordinates: [], fetchWithCoordinates: [], clearGeocodeBackoff: 0 },
        withCoordinates: function (ok, fail) {
            p.calls.withCoordinates.push({ ok: ok, fail: fail, options: p.options });
            if (p.throwOnCoordinates) { throw new Error('geolocation exploded'); }
        },
        fetchWithCoordinates: function (lat, lon, onSuccess, onFailure, force, extras, payloadTransform, isCurrent) {
            p.calls.fetchWithCoordinates.push({
                lat: lat, lon: lon, onSuccess: onSuccess, onFailure: onFailure, force: force,
                extras: extras, payloadTransform: payloadTransform, isCurrent: isCurrent
            });
        },
        clearGeocodeBackoff: function () {
            p.calls.clearGeocodeBackoff += 1;
            p.geocodeBackoff = false;
        },
        isGeocodeBackoffActive: function () { return p.geocodeBackoff; }
    };
    p.lastCoordinates = function () { return p.calls.withCoordinates[p.calls.withCoordinates.length - 1]; };
    p.lastForecast = function () { return p.calls.fetchWithCoordinates[p.calls.fetchWithCoordinates.length - 1]; };
    p.fix = function (lat, lon) { p.lastCoordinates().ok(lat, lon); };
    p.noFix = function (failure) { p.lastCoordinates().fail(failure); };
    p.succeed = function () { p.lastForecast().onSuccess(); };
    p.fail = function (failure) { p.lastForecast().onFailure(failure); };
    return p;
}

/**
 * The cycle over recording fakes, a settable clock (advance REPLACES the Date
 * object: the cycle keeps its start Date and stringifies it again later) and a
 * manual timer queue. Seed storage BEFORE calling this — lastIsSleeping is read
 * at construction.
 */
function makeHarness(opts) {
    opts = opts || {};
    var clock = { value: new Date(opts.now === undefined ? T0 : opts.now) };
    var timers = [];
    var live = {
        settings: opts.settings || { fetchIntervalMin: '60' },
        watchInfo: Object.prototype.hasOwnProperty.call(opts, 'watchInfo') ? opts.watchInfo : APLITE,
        provider: opts.provider || makeProvider(),
        connected: true
    };
    var calls = { sendWeather: [], clearWeatherCaches: 0, clearNoticeCache: 0 };
    /** Run (and dequeue) the timers matching `pred` at call time. */
    function runMatching(pred) {
        var due = timers.filter(pred);
        for (var i = timers.length - 1; i >= 0; i -= 1) {
            if (pred(timers[i])) { timers.splice(i, 1); }
        }
        due.forEach(function (t) { t.fn(); });
    }
    /** A watchdog is the timer armed with FETCH_WATCHDOG_MS. */
    function isWatchdog(t) { return t.ms === WATCHDOG_MS; }
    /** Every other deps.setTimeout timer is a queued-force drain, whatever its delay. */
    function isDrain(t) { return !isWatchdog(t); }
    var cycle = createFetchCycle({
        getSettings: function () { return live.settings; },
        getWatchInfo: function () { return live.watchInfo; },
        getProvider: function () { return live.provider; },
        isWatchConnected: function () { return live.connected; },
        outbox: {
            sendWeather: function (payload) { calls.sendWeather.push(payload); },
            clearWeatherCaches: function () { calls.clearWeatherCaches += 1; },
            clearNoticeCache: function () { calls.clearNoticeCache += 1; }
        },
        authBackoff: authBackoff,
        notices: notices,
        env: opts.env || ENV,
        now: function () { return clock.value; },
        setTimeout: function (fn, ms) { timers.push({ fn: fn, ms: ms }); return timers.length; }
    });
    return {
        cycle: cycle,
        calls: calls,
        get provider() { return live.provider; },
        setProvider: function (p) { live.provider = p; },
        setSettings: function (s) { live.settings = s; },
        setConnected: function (v) { live.connected = v; },
        advance: function (ms) { clock.value = new Date(+clock.value + ms); },
        setNow: function (ms) { clock.value = new Date(ms); },
        /** The queued watchdog timers. */
        pendingWatchdogs: function () { return timers.filter(isWatchdog); },
        /** Run (and dequeue) the watchdogs queued at call time. */
        runWatchdogs: function () { runMatching(isWatchdog); },
        /**
         * The queued-force drains: the interface promises only that a drain goes
         * through deps.setTimeout, off the settling stack — not its delay.
         */
        pendingDrains: function () { return timers.filter(isDrain); },
        /** Run (and dequeue) the drains queued at call time. */
        runDrains: function () { runMatching(isDrain); },
        timerCount: function () { return timers.length; }
    };
}

/** The lastFetchAttempt/lastFetchSuccess record a fetch started at `ms` by `provider` writes. */
function recordFor(provider, ms, error) {
    var rec = { time: new Date(ms).toISOString(), id: provider.id, name: provider.name };
    if (error) { rec.error = error; }
    return rec;
}

// --- shouldFetchNow: the scheduled tick's gate --------------------------------

test('shouldFetchNow: no last-success marker, or an unreadable one, means a refresh is due', () => {
    resetStore();
    const h = makeHarness();
    assert.equal(h.cycle.shouldFetchNow(), true, 'no marker');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = '{not json';
    assert.equal(h.cycle.shouldFetchNow(), true, 'corrupt JSON');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ id: 'fake' });
    assert.equal(h.cycle.shouldFetchNow(), true, 'no .time');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: 'not a date' });
    assert.equal(h.cycle.shouldFetchNow(), true, 'NaN .time');
});

test('shouldFetchNow: due only once the clock crosses into a later refresh slot', () => {
    resetStore();
    const h = makeHarness({ now: T0 + 30 * MIN });
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(T0 + 5 * MIN).toISOString() });
    assert.equal(h.cycle.shouldFetchNow(), false, 'same 60-min slot');
    h.setNow(T0 + HOUR - 1);
    assert.equal(h.cycle.shouldFetchNow(), false, 'last millisecond of the slot');
    h.setNow(T0 + HOUR);
    assert.equal(h.cycle.shouldFetchNow(), true, 'the next slot has begun');
});

test('shouldFetchNow: reads the live settings and the marker on every call', () => {
    resetStore();
    const h = makeHarness({ now: T0 + 31 * MIN });
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(T0 + 5 * MIN).toISOString() });
    assert.equal(h.cycle.shouldFetchNow(), false, '60-min interval: same slot');
    h.setSettings({ fetchIntervalMin: '30' });
    assert.equal(h.cycle.shouldFetchNow(), true, 'a replaced settings object with a 30-min interval is seen');
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = JSON.stringify({ time: new Date(T0 + 30 * MIN).toISOString() });
    assert.equal(h.cycle.shouldFetchNow(), false, 'a newer marker is seen');
});

test('shouldFetchNow: paused while asleep only when the watch is known asleep (lastIsSleeping)', () => {
    const now = new Date(T0 + 5 * MIN);
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(now));
    const marker = JSON.stringify({ time: new Date(T0 - 30 * MIN).toISOString() });   // previous slot

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = marker;
    store[KEYS.LAST_IS_SLEEPING_KEY] = 'true';
    const asleep = makeHarness({ now: +now, settings: settings });
    assert.equal(asleep.cycle.shouldFetchNow(), false, 'asleep and the watch holds the sleep state');
    asleep.setNow(T0 + 2 * HOUR + 5 * MIN);
    assert.equal(asleep.cycle.shouldFetchNow(), true, 'the window has ended');

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = marker;
    store[KEYS.LAST_IS_SLEEPING_KEY] = 'false';
    const notYet = makeHarness({ now: +now, settings: settings });
    assert.equal(notYet.cycle.shouldFetchNow(), true, 'asleep, but the onset has not reached the watch');

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = marker;
    const unknown = makeHarness({ now: +now, settings: settings });
    assert.equal(unknown.cycle.shouldFetchNow(), true, 'no lastIsSleeping record reads as awake');
});

/** A completed failure's attempt record at `ms`, with `failures` consecutive failures counted. */
function seedFailure(ms, code, failures) {
    store[KEYS.LAST_FETCH_ATTEMPT_KEY] = JSON.stringify({
        time: new Date(ms).toISOString(), id: 'fake', name: 'fake weather',
        error: { stage: 'provider_data', code: code }
    });
    store[KEYS.FETCH_ATTEMPT_KEY] = String(failures);
}

test('shouldFetchNow: after one failure the 30 s slack shortens the 60 s backoff to the next tick', () => {
    resetStore();
    seedFailure(T0, 'fake_status_500', 1);
    const h = makeHarness({ now: T0 });
    assert.equal(h.cycle.shouldFetchNow(), false, 'right after the failure');
    h.setNow(T0 + 30 * SEC - 1);
    assert.equal(h.cycle.shouldFetchNow(), false, 'still inside the backoff');
    h.setNow(T0 + 30 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true, 'from 30 s on, elapsed + slack reaches the 60 s wait');
    h.setNow(T0 + 60 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true, 'the next 60 s tick retries');
});

test('shouldFetchNow: the backoff grows with the persisted failure count', () => {
    resetStore();
    seedFailure(T0, 'fake_status_500', 3);   // 4 min
    const h = makeHarness({ now: T0 + 4 * MIN - 30 * SEC - 1 });
    assert.equal(h.cycle.shouldFetchNow(), false);
    h.setNow(T0 + 4 * MIN - 30 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true);
});

test('shouldFetchNow: a 429 waits out the whole 60-min interval (less the slack)', () => {
    resetStore();
    seedFailure(T0, 'openmeteo_status_429', 1);
    const h = makeHarness({ now: T0 + 59 * MIN + 30 * SEC - 1 });
    assert.equal(h.cycle.shouldFetchNow(), false, 'before 59 min 30 s');
    h.setNow(T0 + 59 * MIN + 30 * SEC);
    assert.equal(h.cycle.shouldFetchNow(), true, 'from 59 min 30 s on');
});

test('shouldFetchNow: a start record without an error arms no backoff', () => {
    resetStore();
    store[KEYS.LAST_FETCH_ATTEMPT_KEY] = JSON.stringify({ time: new Date(T0).toISOString(), id: 'fake', name: 'fake weather' });
    store[KEYS.FETCH_ATTEMPT_KEY] = '5';
    const h = makeHarness({ now: T0 + SEC });
    assert.equal(h.cycle.shouldFetchNow(), true);
});

// --- start(): the refusals ------------------------------------------------------

test('start: with no watch connected it refuses, forced or not, and touches nothing', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_401' });
    const before = JSON.stringify(store);
    const h = makeHarness();
    h.setConnected(false);
    assert.equal(h.cycle.start(false), false);
    assert.equal(h.cycle.start(true), false);
    assert.equal(JSON.stringify(store), before, 'no storage write (the auth backoff survives a refused force)');
    assert.equal(h.provider.calls.withCoordinates.length, 0);
    assert.equal(h.provider.calls.clearGeocodeBackoff, 0);
    assert.equal(h.calls.clearWeatherCaches, 0);
    assert.equal(h.timerCount(), 0, 'no watchdog armed');

    // A refused forced call is not queued either: it is simply dropped.
    h.setConnected(true);
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();
    assert.equal(h.pendingDrains().length, 0, 'nothing queued behind the fetch that did run');
});

test('start: a scheduled start during a fetch is refused and not queued', () => {
    resetStore();
    const h = makeHarness();
    assert.equal(h.cycle.start(false), true);
    const running = h.provider.options;
    h.setSettings({ fetchIntervalMin: '60', windUnits: 'mph', tempSlotDisplay: 'both' });
    assert.equal(h.cycle.start(false), false, 'in flight');
    assert.equal(h.provider.options, running, 'the running fetch keeps the options it started with');
    assert.equal(h.provider.calls.withCoordinates.length, 1, 'the refused call asked for nothing');
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1', 'the refused call counted no attempt');
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();
    assert.equal(h.pendingDrains().length, 0, 'no drain for a scheduled call');
    assert.equal(h.cycle.start(false), true, 'accepted again once the fetch settled');
});

test('start: forced calls during a fetch are refused, queued ONCE, and drained on settle against the provider current then', () => {
    resetStore();
    const h = makeHarness();
    const first = h.provider;
    assert.equal(h.cycle.start(false), true);
    const running = first.options;
    // A config close replaces the settings, then forces a fetch into the running one.
    h.setSettings({ fetchIntervalMin: '60', windUnits: 'mph', tempSlotDisplay: 'both' });
    assert.equal(h.cycle.start(true), false, 'a forced call is refused while a fetch is in flight');
    assert.equal(h.cycle.start(true), false, 'a second one too');
    assert.equal(first.options, running, 'a refused forced call leaves the running fetch\'s options alone');
    assert.equal(h.calls.clearWeatherCaches, 0, 'a refused forced call pre-clears nothing');
    assert.equal(first.calls.clearGeocodeBackoff, 0);
    assert.equal(h.pendingDrains().length, 0, 'nothing drains while the fetch is in flight');

    // A settings change replaces the provider while the first fetch runs.
    const second = makeProvider('second');
    h.setProvider(second);
    first.fix(52.5, 13.4);
    first.succeed();
    assert.equal(second.calls.withCoordinates.length, 0, 'the drain runs off the settling callback\'s stack');
    assert.equal(h.pendingDrains().length, 1, 'two forced calls, one drain');

    h.runDrains();
    assert.equal(first.calls.withCoordinates.length, 1, 'the old provider is not asked again');
    assert.equal(second.calls.withCoordinates.length, 1, 'the drain re-reads getProvider()');
    assert.equal(second.options.windUnits, 'mph', 'and builds its options from the settings current then');
    assert.equal(h.calls.clearWeatherCaches, 1, 'the drained start is a forced one');
    assert.equal(second.calls.clearGeocodeBackoff, 1);
    second.fix(52.5, 13.4);
    assert.equal(second.lastForecast().force, true);
    second.succeed();
    assert.equal(h.pendingDrains().length, 0, 'queued once: the drained fetch queues nothing more');
});

test('start: a forced start clears the auth backoff, the geocode backoff and the weather caches before its checks', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_401' });
    const h = makeHarness();
    h.provider.geocodeBackoff = true;
    assert.equal(h.cycle.start(false), false, 'scheduled: refused by the auth backoff');
    assert.equal(authBackoff.isActive(), true, 'a scheduled refusal clears nothing');
    assert.equal(h.provider.calls.clearGeocodeBackoff, 0);
    assert.equal(h.calls.clearWeatherCaches, 0);

    assert.equal(h.cycle.start(true), true, 'forced: the geocode cooldown was cleared before it was checked');
    assert.equal(authBackoff.isActive(), false);
    assert.equal(h.provider.calls.clearGeocodeBackoff, 1);
    assert.equal(h.calls.clearWeatherCaches, 1);
    assert.equal(h.calls.clearNoticeCache, 0, 'the notice cache is not a weather cache');
    h.provider.fix(52.5, 13.4);
    assert.equal(h.provider.lastForecast().force, true, 'force reaches fetchWithCoordinates');
});

test('start: a scheduled start refuses while the auth backoff is armed, writing nothing', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_403' });
    const before = JSON.stringify(store);
    const h = makeHarness();
    assert.equal(h.cycle.start(false), false);
    assert.equal(JSON.stringify(store), before);
    assert.equal(h.provider.calls.withCoordinates.length, 0);
    assert.equal(h.timerCount(), 0);
});

test('start: a geocode cooldown refuses the start, writing nothing', () => {
    resetStore();
    const h = makeHarness();
    h.provider.geocodeBackoff = true;
    assert.equal(h.cycle.start(false), false);
    assert.deepEqual(store, {});
    assert.equal(h.provider.calls.withCoordinates.length, 0);
    assert.equal(h.timerCount(), 0);
    assert.equal(h.provider.options, null, 'no options built for a refused start');
});

test('start: a provider without the geocode hooks starts, forced or not', () => {
    resetStore();
    const bare = makeProvider('bare');
    delete bare.clearGeocodeBackoff;
    delete bare.isGeocodeBackoffActive;
    const h = makeHarness({ provider: bare });
    assert.equal(h.cycle.start(true), true);
    bare.fix(52.5, 13.4);
    bare.succeed();
    assert.equal(h.cycle.start(false), true);
});

// --- start(): the happy path ----------------------------------------------------

test('start: a clean start counts the attempt, records it, builds the options, and hands one fix to the forecast', () => {
    resetStore();
    const settings = {
        fetchIntervalMin: '60', tempSlotDisplay: 'both', windUnits: 'mph',
        feelsFormula: 'steadman', aqiSource: 'openmeteo'
    };
    const h = makeHarness({ settings: settings });
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0), 'the start record carries no error');
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null);
    assert.equal(h.pendingWatchdogs().length, 1, 'a watchdog is armed');

    // This fetch's knobs, derived from the live settings + watch + the WAQI token.
    assert.deepEqual(p.options, fetchOptions.build(settings, APLITE, { waqiToken: ENV.waqiToken }));
    assert.equal(p.options.fetchFeels, true, 'tempSlotDisplay both needs feels');
    assert.equal(p.options.windUnits, 'mph');
    assert.equal(p.options.feelsFormula, 'steadman');
    assert.equal(p.options.aqiSource, 'openmeteo');
    assert.equal(p.options.aqicnToken, 'WAQI-TOKEN');
    assert.equal(p.calls.withCoordinates.length, 1, 'coordinates asked for once');
    assert.equal(p.calls.withCoordinates[0].options, p.options, 'the options were in place before any request');

    p.fix(52.5, 13.4);
    assert.equal(p.calls.fetchWithCoordinates.length, 1);
    const call = p.lastForecast();
    assert.equal(call.lat, 52.5);
    assert.equal(call.lon, 13.4);
    assert.equal(call.force, false);
    assert.deepEqual(call.extras, { IS_SLEEPING: false }, 'aplite: no radar keys, just the sleep flag');
    // The render transform is the cycle's own closure (the real bake): only its
    // presence is checkable without running the bake.
    assert.equal(typeof call.payloadTransform, 'function');
    assert.equal(typeof call.isCurrent, 'function');
    assert.equal(call.isCurrent(), true, 'the fetch is live until it settles');
    assert.equal(radarRequests.length, 0, 'aplite asks no radar');
    assert.equal(h.calls.sendWeather.length, 0);
});

test('start: IS_SLEEPING reflects the sleep window when the extras are built', () => {
    resetStore();
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(new Date(T0 + 2 * HOUR)));
    const h = makeHarness({ settings: settings });
    assert.equal(h.cycle.start(false), true, 'started awake');
    h.advance(2 * HOUR);
    h.provider.fix(52.5, 13.4);
    assert.deepEqual(h.provider.lastForecast().extras, { IS_SLEEPING: true }, 'the fix landed inside the window');
});

test('success: records the START time, resets the counter, commits the carried sleep state, clears errors', () => {
    resetStore();
    notices.add({ key: 'auth', type: 'error', watch: 'API key error', html: 'rejected', since: 1 });
    notices.add({ key: 'ratelimit', type: 'info', html: 'slow down', since: 1 });
    store[KEYS.FETCH_ATTEMPT_KEY] = '2';   // two failures before this one
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(new Date(T0)));
    const h = makeHarness({ settings: settings });
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '3');
    p.fix(52.5, 13.4);
    assert.equal(p.lastForecast().extras.IS_SLEEPING, true, 'the payload carries the sleep onset');

    // The ACK lands after the window ended: the commit is what the payload
    // CARRIED, not a fresh reading. An auth backoff armed meanwhile is lifted.
    h.advance(2 * HOUR + 4 * SEC);
    authBackoff.set({ stage: 'provider_data', code: 'fake_status_401' });
    p.succeed();

    assert.deepEqual(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), recordFor(p, T0), 'the START time, not the ACK time');
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '0');
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], 'true');
    assert.equal(authBackoff.isActive(), false);
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['ratelimit'], 'error notices dropped, infos kept');
    assert.equal(h.calls.clearNoticeCache, 1);
    assert.equal(h.calls.sendWeather.length, 0, 'the success send is the provider\'s, not the cycle\'s');
    assert.equal(p.lastForecast().isCurrent(), false, 'a settled fetch is no longer current');
    assert.equal(h.cycle.start(false), true, 'the next start is accepted');
});

test('success: a delivered sleep onset pauses the gate; a failed one does not', () => {
    const settings = Object.assign({ fetchIntervalMin: '60' }, sleepWindowCovering(new Date(T0), 3));
    const earlier = JSON.stringify({ time: new Date(T0 - 30 * MIN).toISOString() });

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = earlier;
    const ok = makeHarness({ settings: settings });
    ok.cycle.start(false);
    ok.provider.fix(52.5, 13.4);
    ok.provider.succeed();
    ok.setNow(T0 + HOUR + MIN);   // next slot, still inside the window
    assert.equal(ok.cycle.shouldFetchNow(), false, 'asleep and the onset reached the watch');

    resetStore();
    store[KEYS.LAST_FETCH_SUCCESS_KEY] = earlier;
    const failed = makeHarness({ settings: settings });
    failed.cycle.start(false);
    failed.provider.fix(52.5, 13.4);
    failed.provider.fail({ stage: 'app_message', code: 'nack' });
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined, 'a failed onset commits nothing');
    failed.setNow(T0 + HOUR + MIN);
    assert.equal(failed.cycle.shouldFetchNow(), true, 'the onset never arrived, so the retry is not paused');
});

test('radar: one fix feeds both legs — the radar request and the forecast get the same coordinates', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const p = h.provider;
    assert.equal(h.cycle.start(true), true);
    assert.equal(p.calls.withCoordinates.length, 1);
    p.fix(48.1, 11.6);
    assert.equal(radarRequests.length, 1, 'one radar request');
    assert.deepEqual(radarRequests[0].coords, { lat: 48.1, lon: 11.6 });
    assert.equal(p.calls.fetchWithCoordinates.length, 0, 'the forecast waits for the radar answer');

    // The reference: what the configured source itself asks and answers for this
    // fix at the injected clock's slot 0. Comparing against it keeps the
    // adapter's query format and intensity scaling out of this test.
    const slotZero = T0 / 1000;   // T0 is 5-min aligned
    const body = timelinesBody(slotZero, 2);
    let expected = null;
    radarFactory.createRadarSource('tomorrowio', { tomorrowioApiKey: 'TIO-KEY' })
        .fetchRadarTuplesAt(48.1, 11.6, slotZero, function (tuples) { expected = tuples; });
    const reference = radarRequests.pop();
    assert.equal(radarRequests[0].url, reference.url, 'the radar is pinned to the injected clock\'s slot 0');
    reference.onSuccess(body);
    assert.ok(expected, 'the reference source answered with tuples');

    radarRequests[0].onSuccess(body);
    assert.equal(p.calls.withCoordinates.length, 1, 'coordinates were resolved exactly once');
    assert.equal(p.calls.fetchWithCoordinates.length, 1);
    const call = p.lastForecast();
    assert.equal(call.lat, 48.1);
    assert.equal(call.lon, 11.6);
    assert.equal(call.force, true);
    assert.deepEqual(call.extras, Object.assign({}, expected, SKY_CLEAR, { IS_SLEEPING: false }),
        'the extras are this cycle\'s radar tuples, the sky CLEAR (rows off) and the sleep flag');
    assert.equal(call.extras.RAIN_RADAR_START, slotZero);
    assert.equal(typeof call.payloadTransform, 'function');
});

test('radar: Rainbow sends the user\'s key in the request header', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'rainbowkey',
        rainbowApiKey: 'K' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(true);
    h.provider.fix(52.5, 13.4);
    assert.equal(radarRequests.length, 1, 'one radar request, in an endpoint-less build');
    assert.deepEqual(radarRequests[0].headers, { 'Ocp-Apim-Subscription-Key': 'K' });
    assert.equal(radarRequests[0].url.indexOf('api.rainbow.ai/'), 8, 'straight to Rainbow');
    assert.equal(radarRequests[0].url.indexOf('K'), -1, 'the key is not in the URL');
});

test('radar: Rainbow on your own key with no key clears, and no sky request goes out for it', () => {
    resetStore();
    // The sky rows are on (radarSky unset), but a radar that can never answer draws no graph.
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarProvider: 'rainbowkey',
        rainbowApiKey: '' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(true);
    h.provider.fix(52.5, 13.4);
    assert.deepEqual(radarRequests.map(function (r) { return r.url; }).filter(function (u) { return u.indexOf('minutely_15') !== -1; }), [],
        'no Open-Meteo sky request');
    assert.equal(radarRequests.length, 0, 'no request at all');
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, CLEAR, SKY_CLEAR),
        'the radar CLEAR and the sky CLEAR');
});

// --- failure paths --------------------------------------------------------------

const AUTH_401 = { stage: 'provider_data', code: 'fake_status_401' };

test('failure: a provider 401 arms the auth backoff, raises the notice, sends its text alone, records and tracks it', () => {
    resetStore();
    const h = makeHarness();   // aplite: no radar CLEAR to ride along
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    p.fix(52.5, 13.4);
    h.advance(3 * SEC);
    p.fail(AUTH_401);

    assert.equal(authBackoff.isActive(), true);
    const list = notices.list();
    assert.equal(list.length, 1);
    assert.equal(list[0].key, 'auth');
    assert.equal(list[0].type, 'error');
    assert.equal(list[0].since, T0 + 3 * SEC, 'stamped with the injected clock');
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: notices.watchText() }], 'ONE send carrying just the overlay text');
    assert.equal(h.calls.sendWeather[0].NOTICE_TEXT, 'API key error');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, AUTH_401), 'the start time, with the error');
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null);
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1', 'a failure keeps the count');
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined, 'a failure commits no sleep state');
    assert.equal(h.calls.clearNoticeCache, 0);

    // What the armed backoff means for the next starts.
    assert.equal(h.cycle.start(false), false, 'scheduled starts stop');
    assert.equal(h.cycle.start(true), true, 'a forced one retries');
});

// --- the key's answers (key-result.js), for the settings page's key status ------------------

const { fingerprint } = require('../../src/pkjs/weather/domain/keys/key-fingerprint.js');
const keyStatus = require('../../src/pkjs/page/weather/keys/key-status.js');
const KEY_SOURCES = require('../../src/pkjs/page/weather/keys/key-sources.js');

/**
 * The key status the settings page would show for a keyed source, from what the phone
 * stored: index.js hands the page localStorage's KEY_RESULTS_KEY as userData.keyResults.
 * @param {string} picker 'provider' or 'radarProvider'.
 * @param {string} id The picker's value.
 * @param {Object} S The settings (the key field).
 * @returns {Object} key-status.js statusOf's answer.
 */
function pageStatus(picker, id, S) {
    global.INJECTED_USERDATA = { keyResults: localStorage.getItem(KEYS.KEY_RESULTS_KEY) };
    try { return keyStatus.statusOf(KEY_SOURCES[picker].sources[id], id, S); }
    finally { delete global.INJECTED_USERDATA; }
}

test('a keyed provider\'s answers are kept by key fingerprint under its id; the update records name no key', () => {
    resetStore();
    const keyed = makeProvider('openweathermap');
    keyed.apiKey = 'OWMSECRET_abcdef';
    const h = makeHarness({ provider: keyed });
    assert.equal(h.cycle.start(false), true);
    keyed.fix(52.5, 13.4);
    keyed.fail(AUTH_401);
    assert.deepEqual(readJson(KEYS.KEY_RESULTS_KEY), { openweathermap: { keyHash: fingerprint('OWMSECRET_abcdef'), status: 401 } },
        'the refusal, with the status the failure code carries');
    assert.deepEqual(Object.keys(readJson(KEYS.AUTH_BACKOFF_KEY)).sort(), ['code', 'since'], 'the gate names no key');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(keyed, T0, AUTH_401), 'nor does the attempt');

    assert.equal(h.cycle.start(true), true);
    keyed.fix(52.5, 13.4);
    keyed.succeed();
    assert.deepEqual(readJson(KEYS.KEY_RESULTS_KEY), { openweathermap: { keyHash: fingerprint('OWMSECRET_abcdef'), status: 200 } });
    assert.deepEqual(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), recordFor(keyed, T0), 'the success names no key');
    Object.keys(store).forEach((k) => assert.equal(store[k].indexOf('OWMSECRET'), -1, k + ' never holds the key'));
    assert.equal(authBackoff.isActive(), false);

    // A non-auth failure (a 429) says nothing about the key here; a keyless provider records nothing.
    assert.equal(h.cycle.start(false), true);
    keyed.fix(52.5, 13.4);
    keyed.fail({ stage: 'provider_data', code: 'owm_status_429' });
    assert.equal(readJson(KEYS.KEY_RESULTS_KEY).openweathermap.status, 200);

    // A 403 is kept as a 403: the status is read out of the refusal's own code, and the page
    // gives the reason that status names.
    assert.equal(h.cycle.start(true), true);
    keyed.fix(52.5, 13.4);
    keyed.fail({ stage: 'provider_data', code: 'owm_status_403' });
    assert.deepEqual(readJson(KEYS.KEY_RESULTS_KEY), { openweathermap: { keyHash: fingerprint('OWMSECRET_abcdef'), status: 403 } },
        'the refusal, with its 403');
    assert.deepEqual(pageStatus('provider', 'openweathermap', { owmApiKey: 'OWMSECRET_abcdef' }),
        { state: 'rejected', tail: 'cdef', status: 403 }, 'the page shows the 403');
    resetStore();
    const plain = makeHarness();
    assert.equal(plain.cycle.start(false), true);
    plain.provider.fix(52.5, 13.4);
    plain.provider.succeed();
    assert.deepEqual(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), recordFor(plain.provider, T0));
    assert.equal(store[KEYS.KEY_RESULTS_KEY], undefined);
});

// The owner-approved fix (thermo-js-2 PHONE-3): the auth backoff is the "stop fetching" gate, and a
// forced fetch (the Force toggle, a location or key change) clears it. It used to be the key's
// verdict too, so a forced fetch that then failed for another reason (offline, a timeout, no
// position fix) erased the refusal, and the page fell back to an older success with the same key:
// "✓ works" for a key whose last answer was a 401.
test('a forced fetch that fails for another reason keeps a refused key refused on the settings page', () => {
    resetStore();
    const keyed = makeProvider('openweathermap');
    keyed.apiKey = 'OWM-revoked-1234';
    const S = { owmApiKey: 'OWM-revoked-1234' };
    const h = makeHarness({ provider: keyed });
    h.cycle.start(false);
    keyed.fix(52.5, 13.4);
    keyed.succeed();
    assert.equal(pageStatus('provider', 'openweathermap', S).state, 'ok', 'the key worked');
    h.cycle.start(false);
    keyed.fix(52.5, 13.4);
    keyed.fail(AUTH_401);
    assert.deepEqual(pageStatus('provider', 'openweathermap', S), { state: 'rejected', tail: '1234', status: 401 },
        'then it was revoked');

    // Force fetch: the gate opens, and the fetch dies before the provider answers.
    assert.equal(h.cycle.start(true), true);
    assert.equal(authBackoff.isActive(), false, 'the forced fetch cleared the gate');
    keyed.fix(52.5, 13.4);
    keyed.fail({ stage: 'provider_data', code: 'timeout' });
    assert.deepEqual(pageStatus('provider', 'openweathermap', S), { state: 'rejected', tail: '1234', status: 401 },
        'still refused after a timeout');
    h.cycle.start(true);
    keyed.noFix({ stage: 'location', code: 'gps_3' });
    assert.deepEqual(pageStatus('provider', 'openweathermap', S), { state: 'rejected', tail: '1234', status: 401 },
        'still refused after a forced fetch with no position fix');
});

// Tomorrow.io's key serves the forecast and the radar: one id, one entry, so the newest answer
// either of them got is the key's verdict on both rows (the owner's call, thermo-js-2 PHONE-3).
test('Tomorrow.io as forecast and radar: the newest answer the key got, weather or radar, is its verdict', () => {
    const KEY = 'TIO-shared-9876';
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio',
        tomorrowioApiKey: KEY, provider: 'tomorrowio' };
    const run = (radarAnswer, weather) => {
        resetStore();
        const p = makeProvider('tomorrowio');
        p.apiKey = KEY;
        const h = makeHarness({ settings: settings, watchInfo: BASALT, provider: p });
        h.cycle.start(false);
        p.fix(52.5, 13.4);
        assert.equal(radarRequests.length, 1, 'the radar asks with the same key');
        radarAnswer(radarRequests[0]);
        weather(p);
        return ['provider', 'radarProvider'].map((picker) => pageStatus(picker, 'tomorrowio', settings));
    };
    // The radar is asked first; a forecast that answers after it has the last word.
    assert.deepEqual(run((r) => r.onError({ code: 'status_403', detail: 'http_status' }), (p) => p.succeed()),
        [{ state: 'ok', tail: '9876' }, { state: 'ok', tail: '9876' }], 'radar refused, then the forecast went through');
    assert.deepEqual(run((r) => r.onSuccess(timelinesBody(radarWire.slotZeroEpochFor(T0), 0)),
        (p) => p.fail({ stage: 'provider_data', code: 'tomorrowio_status_401' })),
        [{ state: 'rejected', tail: '9876', status: 401 }, { state: 'rejected', tail: '9876', status: 401 }],
        'radar served, then the forecast was refused');
    // A forecast that says nothing about the key leaves the radar's answer standing, on both rows.
    assert.deepEqual(run((r) => r.onError({ code: 'status_403', detail: 'http_status' }),
        (p) => p.fail({ stage: 'provider_data', code: 'timeout' })),
        [{ state: 'rejected', tail: '9876', status: 403 }, { state: 'rejected', tail: '9876', status: 403 }],
        'radar refused, the forecast timed out');
});

test('failure: on a radar-capable watch the 401 notice and this cycle\'s radar CLEAR share one send', () => {
    resetStore();
    const h = makeHarness({ settings: { fetchIntervalMin: '60', radarMode: 'off' }, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, CLEAR, SKY_CLEAR),
        'radar off answers the CLEAR, and the sky rows (not drawn without the graph) their own');
    h.provider.fail(AUTH_401);
    assert.deepEqual(h.calls.sendWeather, [Object.assign({ NOTICE_TEXT: 'API key error' }, CLEAR, SKY_CLEAR)],
        'one send: the overlay text, the radar CLEAR and the sky CLEAR');
});

test('failure: a forecast failure hands this cycle\'s radar CLEAR to the failure send', () => {
    resetStore();
    // tomorrow.io radar with no key can never answer: it clears, without a request.
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: '' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    assert.equal(radarRequests.length, 0);
    const failure = { stage: 'provider_data', code: 'tomorrowio_missing_api_key' };
    h.provider.fail(failure);
    assert.deepEqual(h.calls.sendWeather, [Object.assign({}, CLEAR, SKY_CLEAR)],
        'the radar CLEAR (and the sky CLEAR) ride alone (no notice for this failure)');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, failure);
});

test('failure: an AppMessage NACK does not pass the radar CLEAR through again', () => {
    resetStore();
    const h = makeHarness({ settings: { fetchIntervalMin: '60', radarMode: 'off' }, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    const nack = { stage: 'app_message', code: 'nack' };
    h.provider.fail(nack);
    assert.equal(h.calls.sendWeather.length, 0, 'the NACKed send already carried it');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, nack);
});

test('failure: a transient radar miss (null) adds no radar keys to the failure send (the sky CLEAR still rides)', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    radarRequests[0].onError({ code: 'status_503', detail: 'http_status' });
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, SKY_CLEAR),
        'no radar keys for a transient miss; the sky answer rides alone');
    h.provider.fail(AUTH_401);
    assert.deepEqual(h.calls.sendWeather, [Object.assign({ NOTICE_TEXT: 'API key error' }, SKY_CLEAR)],
        'the notice rides without radar keys; the sky CLEAR is forwarded like the radar one would be');
    assert.deepEqual(Object.keys(h.calls.sendWeather[0]).filter(function (k) { return k.indexOf('RAIN_RADAR') === 0; }), [],
        'no RAIN_RADAR_* key on a transient miss');
});

test('failure: a 429 raises a settings-panel notice but sends nothing to the watch', () => {
    resetStore();
    const h = makeHarness();
    h.cycle.start(false);
    h.provider.fix(52.5, 13.4);
    h.provider.fail({ stage: 'provider_data', code: 'fake_status_429' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['ratelimit']);
    assert.equal(h.calls.sendWeather.length, 0);
    assert.equal(authBackoff.isActive(), false, 'a rate limit is not an auth failure');
});

/** Run one forced start that gets a fix and then fails with `failure`. */
function failOnce(h, failure) {
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.fail(failure);
}

test('failure: a server failure stays quiet on the first update and shows from the second; a success ends the run', () => {
    resetStore();
    const h = makeHarness();   // aplite: no radar keys ride along
    const f503 = { stage: 'provider_data', code: 'fake_status_503' };
    failOnce(h, f503);
    assert.deepEqual(notices.list(), [], 'the first failed update raises nothing');
    assert.deepEqual(h.calls.sendWeather, [], 'and sends nothing: the watch keeps its last forecast');
    assert.equal(authBackoff.isActive(), false);

    h.advance(MIN);
    failOnce(h, { stage: 'provider_data', code: 'fake_timeout' });
    const list = notices.list();
    assert.deepEqual(list.map(function (n) { return n.key; }), ['server'], 'the second one in a row shows');
    assert.equal(list[0].type, 'error');
    assert.match(list[0].html, /<b>fake weather<\/b> is not answering: the last 2 updates failed \(no answer in time\)/);
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'fake weather not answering' }], 'the overlay text alone');

    h.advance(MIN);
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();
    assert.deepEqual(notices.list(), [], 'a success clears the notice');
    assert.equal(store[KEYS.SERVER_FAILURE_STREAK_KEY], undefined, 'and the run');
    h.calls.sendWeather.length = 0;
    failOnce(h, f503);
    assert.deepEqual(notices.list(), [], 'after a success the count starts again');
    assert.deepEqual(h.calls.sendWeather, []);
});

test('failure: the run counts one provider\'s server failures in a row — another provider or failure kind starts over', () => {
    resetStore();
    const h = makeHarness();
    const f502 = { stage: 'provider_data', code: 'fake_status_502' };
    failOnce(h, f502);
    failOnce(h, { stage: 'provider_data', code: 'fake_missing_fields' });
    failOnce(h, f502);
    assert.deepEqual(notices.list(), [], 'a missing field in between ends the run');

    h.setProvider(makeProvider('other'));
    failOnce(h, { stage: 'provider_data', code: 'other_status_500' });
    assert.deepEqual(notices.list(), [], 'another provider starts its own run');

    assert.equal(h.cycle.start(true), true);
    h.provider.noFix({ stage: 'coordinates', code: 'timeout' });
    assert.deepEqual(notices.list(), [], 'no fix: not the provider failing, and no notice');
    failOnce(h, { stage: 'provider_data', code: 'other_network_error' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['server'],
        'a missing fix neither counts nor ends the run');
    assert.match(notices.list()[0].html, /<b>other weather<\/b> is not answering: the last 2 updates failed \(no connection\)/);
});

test('failure: an unreadable answer counts as the provider not answering, so an outage mixing it with 5xx shows', () => {
    resetStore();
    const h = makeHarness();
    // As in met.no's November 2026 outage: 5xx between 200s whose bodies were no JSON.
    failOnce(h, { stage: 'provider_data', code: 'fake_status_503' });
    failOnce(h, { stage: 'provider_data', code: 'fake_parse_error' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['server'], 'the second one in a row shows');
    assert.match(notices.list()[0].html, /the last 2 updates failed \(an unreadable answer\)/);
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'fake weather not answering' }]);

    // Our own reading of an answer is not the provider failing: it ends the run.
    ['fake_missing_fields', 'fake_map_error'].forEach(function (code) {
        resetStore();
        failOnce(h, { stage: 'provider_data', code: 'fake_status_503' });
        failOnce(h, { stage: 'provider_data', code: code });
        failOnce(h, { stage: 'provider_data', code: 'fake_parse_error' });
        assert.deepEqual(notices.list(), [], code + ' in between ends the run');
    });
});

test('failure: a provider with no data for the place raises the coverage notice from the second update in a row, over a fresh forecast; a success clears it', () => {
    resetStore();
    const dwd = makeProvider('dwd');
    dwd.name = 'Brightsky (Deutscher Wetterdienst)';
    dwd.shortName = 'DWD';
    const h = makeHarness({ provider: dwd });
    assert.equal(h.cycle.start(true), true);
    dwd.fix(52.5, 13.4);
    dwd.succeed();   // T0: the watch shows this forecast for 12 h
    h.calls.sendWeather.length = 0;

    h.advance(HOUR);
    const noData = { stage: 'provider_data', code: 'dwd_forecast_status_404', noCoverage: true };
    failOnce(h, noData);
    assert.deepEqual(notices.list(), [], 'one 404 can be a hiccup: nothing yet');
    assert.deepEqual(h.calls.sendWeather, [], 'and the watch keeps its forecast');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, noData);

    h.advance(MIN);
    failOnce(h, noData);
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['coverage'], 'the second one in a row shows');
    assert.match(notices.list()[0].html, /^<b>Brightsky \(Deutscher Wetterdienst\)<\/b> has no weather data for this place\./);
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'DWD has no data here' }],
        'over the fresh forecast: waiting does not bring DWD data to this place');
    assert.equal(authBackoff.isActive(), false);

    h.advance(HOUR);
    assert.equal(h.cycle.start(true), true);
    dwd.fix(52.5, 13.4);
    dwd.succeed();
    assert.deepEqual(notices.list(), [], 'an error notice: the success clears it');
    assert.equal(store[KEYS.SERVER_FAILURE_STREAK_KEY], undefined, 'and the run');
    assert.equal(h.calls.clearNoticeCache, 2, 'and resets the notice send-cache, so a later one goes out again');
});

test('failure: a run counts one kind — a 5xx and a 404 for the place in a row raise neither notice', () => {
    resetStore();
    const h = makeHarness();
    const noData = { stage: 'provider_data', code: 'fake_status_404', noCoverage: true };
    const f503 = { stage: 'provider_data', code: 'fake_status_503' };
    failOnce(h, f503);
    failOnce(h, noData);
    assert.deepEqual(notices.list(), [], 'a 404 after a 5xx starts its own run');
    failOnce(h, f503);
    assert.deepEqual(notices.list(), [], 'and a 5xx after a 404 starts over too');
    failOnce(h, f503);
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['server'], 'two 5xx in a row show');
    failOnce(h, noData);
    failOnce(h, noData);
    assert.deepEqual(notices.list().map(function (n) { return n.key; }).sort(), ['coverage', 'server'],
        'two 404s in a row show the coverage notice');
});

test('failure: a provider\'s own retry delay raises the neutral notice at once and holds scheduled fetches that long', () => {
    resetStore();
    const wu = makeProvider('wunderground');
    wu.name = 'Weather Underground';
    wu.shortName = 'Wunderground';
    wu.scrapesKey = true;
    const h = makeHarness({ provider: wu, settings: { fetchIntervalMin: '15' } });
    const refused = { stage: 'provider_data', code: 'wu_current_status_401', retryAfterMs: HOUR };
    assert.equal(h.cycle.start(false), true);
    wu.fix(52.5, 13.4);
    wu.fail(refused);
    assert.equal(authBackoff.isActive(), false, 'no indefinite auth backoff');
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['unavailable'], 'shown at once');
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'Wunderground not answering' }],
        'no forecast on the watch to keep: its short name, on the watch at once');
    h.setNow(T0 + 30 * MIN);
    assert.equal(h.cycle.shouldFetchNow(), false, 'past two 15-min slots, still resting');
    h.setNow(T0 + HOUR);
    assert.equal(h.cycle.shouldFetchNow(), true, 'the next update after the hour tries again');
});

test('failure: a provider not answering leaves a good forecast on the watch — its line goes out once that forecast is too old', () => {
    resetStore();
    const h = makeHarness();
    assert.equal(h.cycle.start(true), true);
    h.provider.fix(52.5, 13.4);
    h.provider.succeed();   // T0: the watch shows this forecast for 12 h
    h.calls.sendWeather.length = 0;
    const f503 = { stage: 'provider_data', code: 'fake_status_503' };
    h.advance(MIN);
    failOnce(h, f503);
    h.advance(MIN);
    failOnce(h, { stage: 'provider_data', code: 'fake_network_error' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['server'], 'the panel shows it at once');
    assert.deepEqual(h.calls.sendWeather, [], 'but no overlay hides the forecast on the watch');

    h.setNow(T0 + 12 * HOUR);
    failOnce(h, f503);
    assert.deepEqual(h.calls.sendWeather, [], 'not up to the watch\'s own 12 h');
    h.setNow(T0 + 12 * HOUR + MIN);
    failOnce(h, f503);
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'fake weather not answering' }],
        'then the line takes the place of the bare "No data :("');

    resetStore();
    const wu = makeProvider('wunderground');
    wu.shortName = 'Wunderground';
    const w = makeHarness({ provider: wu });
    assert.equal(w.cycle.start(true), true);
    wu.fix(52.5, 13.4);
    wu.succeed();
    w.calls.sendWeather.length = 0;
    w.advance(MIN);
    failOnce(w, { stage: 'provider_data', code: 'wu_current_status_401', retryAfterMs: HOUR });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['unavailable']);
    assert.deepEqual(w.calls.sendWeather, [], 'Weather Underground\'s hour of rest keeps the forecast too');
});

test('start: an auth backoff an older build left for a provider whose key is scraped is dropped, not obeyed', () => {
    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'wu_current_status_401' }, { provider: 'wunderground' });
    const wu = makeProvider('wunderground');
    wu.scrapesKey = true;
    const h = makeHarness({ provider: wu });
    assert.equal(h.cycle.start(false), true, 'a scheduled start goes ahead');
    assert.equal(authBackoff.isActive(), false, 'and the stale record is gone');

    resetStore();
    authBackoff.set({ stage: 'provider_data', code: 'owm_status_401' }, { provider: 'openweathermap' });
    const keyed = makeHarness({ provider: makeProvider('openweathermap') });
    assert.equal(keyed.cycle.start(false), false, 'a keyed provider still waits for the user');
});

test('radar: a place outside DWD\'s composite asks nothing, sends the clear with DWD\'s line, and keeps the verdict', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'dwd' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const OUTSIDE = Object.assign({ RAIN_RADAR_LIMITED: 'DWD radar: Germany only' }, CLEAR);
    h.cycle.start(false);
    h.provider.fix(25.76, -80.19);   // Miami
    assert.equal(radarRequests.length, 0, 'no radar request');
    assert.deepEqual(h.provider.lastForecast().extras, Object.assign({ IS_SLEEPING: false }, OUTSIDE, SKY_CLEAR));
    assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: true, metno: true }),
        'the settings page\'s record: verdicts, no position');
    // A failed forecast still forwards it, line and all.
    h.provider.fail({ stage: 'provider_data', code: 'fake_parse_error' });
    assert.deepEqual(h.calls.sendWeather, [Object.assign({}, OUTSIDE, SKY_CLEAR)]);

    h.advance(HOUR);
    h.cycle.start(false);
    h.provider.fix(52.52, 13.4);   // Berlin: in the box, so DWD is asked
    assert.equal(radarRequests.length, 1, 'inside the box the request goes out');
    assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: true, metno: true }), 'the record waits for the answer');
    radarRequests[0].onError({ code: 'status_503', detail: 'http_status' });
    assert.equal(store[KEYS.RADAR_COVERAGE_KEY], JSON.stringify({ dwd: false, metno: true }));
});

test('radar: inside DWD\'s box the second 404 in a row says "DWD: no radar data"; leaving and entering the box start afresh', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'dwd' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const NO_DATA = Object.assign({ RAIN_RADAR_LIMITED: 'DWD: no radar data' }, CLEAR);
    const OUTSIDE = Object.assign({ RAIN_RADAR_LIMITED: 'DWD radar: Germany only' }, CLEAR);
    const PARIS = [48.85, 2.35];
    const MIAMI = [25.76, -80.19];
    /**
     * One update at `place`: DWD answers `radar` (an HTTP status to fail with, or a body)
     * when asked, then the forecast succeeds.
     * @returns {Object} The radar keys the forecast extras carried.
     */
    function update(place, radar) {
        const asked = radarRequests.length;
        h.advance(HOUR);
        assert.equal(h.cycle.start(false), true);
        h.provider.fix(place[0], place[1]);
        if (radar !== undefined) {
            const req = radarRequests[asked];
            if (typeof radar === 'number') { req.onError({ code: 'status_' + radar, detail: 'http_status' }); }
            else { req.onSuccess(JSON.stringify(radar)); }
        }
        assert.equal(radarRequests.length, asked + (radar === undefined ? 0 : 1), 'a request inside the box only');
        const extras = h.provider.lastForecast().extras;
        h.provider.succeed();
        const out = {};
        Object.keys(extras).filter((k) => k.indexOf('RAIN_RADAR_') === 0).forEach((k) => { out[k] = extras[k]; });
        return out;
    }
    const record = () => JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]);

    assert.deepEqual(update(PARIS, 404), {}, 'one 404 alone changes nothing: no radar keys');
    assert.deepEqual(record(), { dwd: false, metno: true, misses: { dwd: 1 } }, 'no position, and no note yet');
    assert.deepEqual(update(PARIS, 404), NO_DATA, 'the second in a row: the clear with the general line');
    assert.deepEqual(record(), { dwd: false, metno: true, misses: { dwd: 2 } }, 'inside the box, no data: the note\'s record');
    assert.deepEqual(update(PARIS, 503), {}, 'a 5xx between keeps what the watch shows');
    assert.deepEqual(update(PARIS, 404), NO_DATA, 'and the run');

    assert.deepEqual(update(MIAMI), OUTSIDE, 'leaving the box: no request, the coverage line');
    assert.deepEqual(record(), { dwd: true, metno: true }, 'and the run is over');
    assert.deepEqual(update(PARIS, 404), {}, 'entering it again: a first 404 once more');
    assert.deepEqual(update(PARIS, 404), NO_DATA);

    const back = update(PARIS, { latlon_position: { x: 0, y: 0 }, radar: [] });
    assert.deepEqual(back.RAIN_RADAR_TREND_UINT8, new Array(24).fill(0), 'radar data: a window again, no line');
    assert.equal('RAIN_RADAR_LIMITED' in back, false);
    assert.deepEqual(record(), { dwd: false, metno: true }, 'the count and the note are gone');
    assert.deepEqual(update(PARIS, 404), {}, 'a later 404 is a first one');

    // The second 404 with a failed forecast: the line still reaches the watch.
    h.advance(HOUR);
    h.cycle.start(false);
    h.provider.fix(PARIS[0], PARIS[1]);
    radarRequests[radarRequests.length - 1].onError({ code: 'status_404', detail: 'http_status' });
    h.calls.sendWeather.length = 0;
    h.provider.fail({ stage: 'provider_data', code: 'fake_parse_error' });
    assert.deepEqual(h.calls.sendWeather, [Object.assign({}, NO_DATA, SKY_CLEAR)]);
});

test('radar: switching from DWD to another radar source ends DWD\'s run of 404s', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'dwd' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    [0, 1].forEach(function (i) {
        h.advance(HOUR);
        h.cycle.start(false);
        h.provider.fix(48.85, 2.35);
        radarRequests[i].onError({ code: 'status_404', detail: 'http_status' });
        h.provider.succeed();
    });
    assert.deepEqual(JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]).misses, { dwd: 2 });
    h.setSettings(Object.assign({}, settings, { radarMode: 'off' }));
    h.advance(HOUR);
    h.cycle.start(false);
    h.provider.fix(48.85, 2.35);
    h.provider.succeed();
    assert.deepEqual(JSON.parse(store[KEYS.RADAR_COVERAGE_KEY]), { dwd: false, metno: true },
        'radar off asked DWD nothing: picking DWD again shows no stale note');
});

test('coordinates: a failed fix is recorded, and starts no radar, forecast or sleep commit', () => {
    resetStore();
    const settings = Object.assign(
        { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' },
        sleepWindowCovering(new Date(T0)));
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    const gps = gpsFailure({ code: 1, message: '' });
    p.noFix(gps);
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, gps), 'the failure exactly as reported');
    assert.equal(radarRequests.length, 0, 'no radar request');
    assert.equal(p.calls.fetchWithCoordinates.length, 0, 'no forecast request');
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'No location access' }],
        'no radar answer to pass on; the no-location line alone, as the watch has no forecast to keep');
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined, 'no sleep commit');
    assert.equal(h.cycle.start(false), true, 'settled: the next start is accepted');
});

test('coordinates: the no-location notice keeps its watch line back while the forecast is fresh', () => {
    resetStore();
    const h = makeHarness();
    h.cycle.start(false);
    h.provider.fix(52.52, 13.4);
    h.provider.succeed();
    h.calls.sendWeather.length = 0;
    h.advance(HOUR);
    h.cycle.start(true);
    h.provider.noFix(gpsFailure({ code: 1, message: 'Location permission not granted' }));
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['location'], 'the settings panel shows it');
    assert.equal(h.calls.sendWeather.length, 0, 'the watch keeps its hour-old forecast, no overlay over it');
    h.cycle.start(true);
    h.provider.fix(52.52, 13.4);
    h.provider.succeed();
    assert.deepEqual(notices.list(), [], 'a success clears it');
});

test('coordinates: a failure past the GPS step drops the no-location notice and takes its line off the watch', () => {
    resetStore();
    const h = makeHarness();
    h.cycle.start(false);
    h.provider.noFix(gpsFailure({ code: 1, message: 'Location permission not granted' }));
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'No location access' }], 'no forecast to keep: the line is up');
    h.calls.sendWeather.length = 0;

    // The user switched to a manual location and its geocode failed (no notice of its own).
    h.cycle.start(true);
    h.provider.noFix({ stage: 'forward_geocode', code: 'status_500' });
    assert.deepEqual(notices.list(), [], 'the no-location notice no longer hides the real failure');
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: '' }], 'the watch line comes down');
    h.calls.sendWeather.length = 0;

    // The watchdog may be the GPS hanging: it leaves the notice up.
    h.cycle.start(true);
    h.provider.noFix(gpsFailure({ code: 3, message: '' }));
    h.calls.sendWeather.length = 0;
    h.cycle.start(true);
    h.provider.noFix({ stage: 'fetch', code: 'watchdog_timeout' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['location']);
    assert.equal(h.calls.sendWeather.length, 0);

    // A provider failure with its own notice: that notice's line replaces the location line.
    failOnce(h, { stage: 'provider_data', code: 'owm_status_401' });
    assert.deepEqual(notices.list().map(function (n) { return n.key; }), ['auth']);
    assert.deepEqual(h.calls.sendWeather, [{ NOTICE_TEXT: 'API key error' }]);
});

test('coordinates: a failure callback without a failure object records coordinates/unknown_error', () => {
    resetStore();
    const h = makeHarness();
    h.cycle.start(false);
    h.provider.noFix(undefined);
    const unknown = { stage: 'coordinates', code: 'unknown_error' };
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, unknown);
    assert.equal(h.provider.calls.fetchWithCoordinates.length, 0);
});

// --- the watchdog and late completions --------------------------------------------

const WATCHDOG = { stage: 'fetch', code: 'watchdog_timeout' };

test('watchdog: a fetch still unsettled after FETCH_WATCHDOG_MS is recorded as a failure and frees the cycle', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    assert.equal(h.cycle.start(false), true);
    assert.equal(h.cycle.start(false), false, 'hung: still in flight');
    assert.equal(h.pendingWatchdogs().length, 1);
    h.advance(WATCHDOG_MS);
    h.runWatchdogs();

    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, WATCHDOG));
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null);
    assert.equal(h.calls.sendWeather.length, 0, 'aplite, no notice: nothing to send');
    assert.equal(h.cycle.start(false), true, 'the in-flight flag is cleared: a new start is accepted');
});

test('watchdog: a forced start queued behind a hung fetch runs once the watchdog gives up', () => {
    resetStore();
    const h = makeHarness();
    const first = h.provider;
    h.cycle.start(false);
    assert.equal(h.cycle.start(true), false);
    const second = makeProvider('second');
    h.setProvider(second);
    h.runWatchdogs();
    assert.equal(h.pendingDrains().length, 1);
    h.runDrains();
    assert.equal(second.calls.withCoordinates.length, 1);
    assert.equal(first.calls.withCoordinates.length, 1);
    assert.equal(h.calls.clearWeatherCaches, 1);
});

test('watchdog: a completion from the abandoned chain is ignored — no success record, counter untouched', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    h.cycle.start(false);
    p.fix(52.5, 13.4);
    const abandoned = p.lastForecast();
    h.runWatchdogs();
    assert.equal(abandoned.isCurrent(), false, 'the provider is told the fetch is no longer current');

    abandoned.onSuccess();
    assert.equal(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), null, 'no success record');
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1', 'the counter is not reset');
    assert.equal(h.calls.clearNoticeCache, 0);
    assert.equal(store[KEYS.LAST_IS_SLEEPING_KEY], undefined);

    abandoned.onFailure(AUTH_401);
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY).error, WATCHDOG, 'the watchdog record stands');
    assert.equal(authBackoff.isActive(), false, 'a late 401 arms nothing');
    assert.deepEqual(notices.list(), []);
    assert.equal(h.calls.sendWeather.length, 0);
});

test('watchdog: a fetch completes exactly once — a late failure or watchdog after success is ignored', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    h.cycle.start(false);
    p.fix(52.5, 13.4);
    p.succeed();
    p.succeed();
    p.fail(AUTH_401);
    h.runWatchdogs();
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0), 'the start record, never an error');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_SUCCESS_KEY), recordFor(p, T0));
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '0');
    assert.equal(authBackoff.isActive(), false);
    assert.equal(h.calls.clearNoticeCache, 1);
});

// Ported from fetch-watchdog.test.js ("runFetchCycle starts nothing for
// coordinates that arrive after the caller gave up").
test('watchdog: a fix arriving after the fetch was abandoned starts no radar, geocode or provider request', () => {
    resetStore();
    const settings = { fetchIntervalMin: '60', radarMode: 'graph', radarSky: false, radarProvider: 'tomorrowio', tomorrowioApiKey: 'TIO-KEY' };
    const h = makeHarness({ settings: settings, watchInfo: BASALT });
    const p = h.provider;
    h.cycle.start(false);
    h.runWatchdogs();
    p.fix(52.5, 13.4);
    assert.equal(radarRequests.length, 0, 'no radar request');
    assert.equal(p.calls.fetchWithCoordinates.length, 0, 'no forecast request');
});

// --- throws ------------------------------------------------------------------------

test('throw: a synchronous throw inside the chain is recorded as fetch/exception and frees the cycle', () => {
    resetStore();
    const h = makeHarness();
    const p = h.provider;
    p.throwOnCoordinates = true;
    assert.equal(h.cycle.start(false), true, 'it got past every refusal before it threw');
    const exception = { stage: 'fetch', code: 'exception' };
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, exception));
    assert.equal(store[KEYS.FETCH_ATTEMPT_KEY], '1');
    p.throwOnCoordinates = false;
    assert.equal(h.cycle.start(false), true, 'the in-flight flag is cleared');
    assert.equal(p.calls.withCoordinates.length, 2);
});

test('throw: a counter write that throws is caught and recorded, and later ticks still start', () => {
    resetStore();
    throwOnSetItem = KEYS.FETCH_ATTEMPT_KEY;
    const h = makeHarness();
    const p = h.provider;
    assert.equal(h.cycle.start(false), true, 'started: the throw came after every refusal');
    assert.equal(p.calls.withCoordinates.length, 0, 'the chain never ran');
    assert.deepEqual(readJson(KEYS.LAST_FETCH_ATTEMPT_KEY), recordFor(p, T0, { stage: 'fetch', code: 'exception' }));

    h.advance(MIN);
    assert.equal(h.cycle.start(false), true, 'the next tick is accepted, not stuck "in progress"');
});
