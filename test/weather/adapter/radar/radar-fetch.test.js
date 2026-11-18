// test/weather/adapter/radar/radar-fetch.test.js — the shared radar transport's two verdicts: the key
// rejection, used by every keyed radar source (tomorrow.io, Rainbow with the
// user's key), and the request limit, used by every source that has one (those
// two).
const test = require('node:test');
const assert = require('node:assert/strict');
const radarFetch = require('../../../../src/pkjs/weather/adapter/radar/radar-fetch.js');

test('isKeyRejection is true for a 401 key rejection', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'status_401' }), true);
});

test('isKeyRejection is true for a 403 key rejection', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'status_403' }), true);
});

test('isKeyRejection is false for transient and non-key HTTP statuses', () => {
  ['status_404', 'status_429', 'status_500'].forEach((code) => {
    assert.equal(radarFetch.isKeyRejection({ code }), false, code);
  });
});

test('isKeyRejection is false for network errors and timeouts', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'network_error' }), false);
  assert.equal(radarFetch.isKeyRejection({ code: 'timeout' }), false);
});

test('isKeyRejection is false for a missing error', () => {
  assert.equal(radarFetch.isKeyRejection(null), false);
  assert.equal(radarFetch.isKeyRejection(undefined), false);
});

test('isRateLimited is true for a 429 only', () => {
  assert.equal(radarFetch.isRateLimited({ code: 'status_429' }), true);
  ['status_401', 'status_403', 'status_404', 'status_500', 'status_503', 'network_error', 'timeout']
    .forEach((code) => {
      assert.equal(radarFetch.isRateLimited({ code }), false, code);
    });
});

test('isRateLimited is false for a missing error', () => {
  assert.equal(radarFetch.isRateLimited(null), false);
  assert.equal(radarFetch.isRateLimited(undefined), false);
});

test('a 429 is never a key rejection: the two verdicts do not overlap', () => {
  assert.equal(radarFetch.isKeyRejection({ code: 'status_429' }), false);
  ['status_401', 'status_403'].forEach((code) => {
    assert.equal(radarFetch.isRateLimited({ code }), false, code);
  });
});

// fetchRadarJson's request: a GET with the source's headers and no body.
test('fetchRadarJson sends a bodyless GET with the source\'s headers', () => {
  const WeatherProvider = require('../../../../src/pkjs/weather/adapter/provider.js');
  const saved = WeatherProvider.request;
  const seen = [];
  WeatherProvider.request = function (url, type, onSuccess, onError, headers, body) {
    seen.push({ url, type, headers, body });
    onSuccess('{}');
  };
  try {
    radarFetch.fetchRadarJson({ url: 'https://a.example/r', label: 'A', headers: { 'X-Key': 'k' } }, () => null, () => {});
  } finally {
    WeatherProvider.request = saved;
  }
  assert.deepEqual(seen, [{ url: 'https://a.example/r', type: 'GET', headers: { 'X-Key': 'k' }, body: undefined }]);
});
