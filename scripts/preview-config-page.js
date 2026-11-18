// scripts/preview-config-page.js — repo-root wrapper: renders a browser-openable preview of
// urvejr's config page (real schema + blocks + onBuild hooks injected) so the settings UI
// can be eyeballed in a desktop browser without the emulator. The output IS the live page —
// tabs, toggles, selects, and the color picker all work. Reads shell.html + lib + app files fresh
// each run, so it always reflects the current source (no need to regenerate page.generated.js).
// Usage: node scripts/preview-config-page.js [out] [platform]
//   platform: any of package.template.json's targetPlatforms   (default emery, the only one)
'use strict';
var fs = require('fs');
var path = require('path');
var build = require('../src/pkjs/config-ui/scripts/build-page.js');

var ROOT = path.join(__dirname, '..');
var platformLib = require(path.join(ROOT, 'src/pkjs/config-ui/lib/platform.js'));
var schema = require(path.join(ROOT, 'src/pkjs/page/settings/schema.js'));
var previewPalette = require(path.join(ROOT, 'src/pkjs/theme/domain/preview-palette.js'));
var notices = require(path.join(ROOT, 'src/pkjs/notices/adapter/notices.js'));
var gpsFailure = require(path.join(ROOT, 'src/pkjs/weather/adapter/location.js')).gpsFailure;
// The bundle IS the build's bundle: same files, same order. It used to be a
// second copy of the list, which is exactly how the preview came to load the
// Weather tab's stylesheet before the module whose settle curve it bakes in.
var APP_FILES = require('./build-config-page.js').APP_FILES;
var DEFAULT_OUT = path.join(ROOT, 'build/config-ui-preview.html');
// The watches the app builds for: a bare name among them picks the platform.
var PLATFORMS = require(path.join(ROOT, 'package.template.json')).pebble.targetPlatforms;

// Parse CLI positionals into { out, platform } order-independently. A bare platform
// name (e.g. `mise preview-config emery`) selects the platform and keeps the default
// output path — otherwise the arg would be taken as a filename and written as a stray
// extensionless "emery" file.
function parseArgs(args) {
  args = args || [];
  var out = null;
  var platform = null;
  for (var i = 0; i < args.length; i++) {
    var a = args[i];
    if (platform === null && PLATFORMS.indexOf(a) !== -1) {
      platform = a;
    } else if (out === null) {
      out = a;
    }
  }
  return { out: out || DEFAULT_OUT, platform: platform || 'emery' };
}

// Delegate to the platform SoT (platform.js) so color/round/health env-gates
// render exactly as they would on-watch — no duplicated platform table here.
//
// computeEnv() answers only what the PLATFORM determines. Phone-runtime
// capabilities are overlaid by index.js at generateUrl() time (env:
// {phoneBattery: ...}), which this script bypasses — so without this overlay the
// preview silently omits every phone-gated item and cannot be used to review them.
// Default on, because the preview exists to eyeball items that exist; set
// PREVIEW_PHONE_BATTERY=0 to see what an iPhone user's slot dropdown looks like.
function envFor(platform) {
  var env = platformLib.computeEnv({ platform: platform });
  env.phoneBattery = process.env.PREVIEW_PHONE_BATTERY !== '0';
  return env;
}

// PREVIEW_NOTICES=1: the fetch-error notice card (Watchface tab) and the Advanced
// tab's last-attempt line as a failing install sees them. The notices come from
// notices.js's own noticeForFailure, so the copy is the phone's, not a mock-up. All
// three location readings show at once, which a phone never does (they share one key,
// so each replaces the last): the preview is for reviewing their copy side by side.
function previewFailureData() {
  if (process.env.PREVIEW_NOTICES !== '1') { return {}; }
  var now = Date.now();
  var gps = gpsFailure({ code: 1, message: 'Location permission not granted' });
  var list = [
    notices.noticeForFailure({ stage: 'provider_data', code: 'owm_status_401' }, 'OpenWeatherMap', now - 3 * 3600 * 1000),
    notices.noticeForFailure(gpsFailure({ code: 3, message: '' }), 'Met.no', now - 3 * 3600 * 1000),
    notices.noticeForFailure(gpsFailure({ code: 1, message: 'Location not available' }), 'Met.no', now - 2 * 3600 * 1000),
    notices.noticeForFailure(gps, 'Met.no', now - 20 * 60 * 1000)
  ];
  return {
    notices: JSON.stringify(list),
    lastFetchSuccess: JSON.stringify({ time: new Date(now - 26 * 3600 * 1000), id: 'metno', name: 'Met.no' }),
    lastFetchAttempt: JSON.stringify({ time: new Date(now - 20 * 60 * 1000), id: 'metno', name: 'Met.no', error: gps })
  };
}

function run(opts) {
  opts = opts || {};
  return build.previewPage({
    appFiles: APP_FILES,
    schema: schema,
    env: envFor(opts.platform || 'emery'),
    cfg: {},
    userData: Object.assign({
      palette: previewPalette.buildPreviewPalette(),
      // Weather-tab "Current" chip seed (Berlin). The graphs themselves fetch
      // live from the desktop browser — file:// pages get real CORS answers
      // from Open-Meteo/Brightsky, so the tab is fully reviewable here.
      graphsSeed: { lat: 52.52, lon: 13.405, name: 'Berlin', gps: true }
    }, previewFailureData()),
    returnTo: '#'
  });
}

if (require.main === module) {
  var parsed = parseArgs(process.argv.slice(2));
  fs.mkdirSync(path.dirname(parsed.out), { recursive: true });
  fs.writeFileSync(parsed.out, run({ platform: parsed.platform }));
  console.log('wrote ' + parsed.out + ' (' + parsed.platform + ')');
}

module.exports = { run: run, parseArgs: parseArgs, DEFAULT_OUT: DEFAULT_OUT, PLATFORMS: PLATFORMS, APP_FILES: APP_FILES };
