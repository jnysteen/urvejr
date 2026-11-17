#!/usr/bin/env bash

set -euo pipefail

profile="${1:-dev}"

if [[ "$profile" != "release" && "$profile" != "dev" ]]; then
  printf 'usage: %s [release|dev]\n' "$0" >&2
  exit 1
fi

template_file="package.template.json"
profile_file="profiles/package.${profile}.json"
output_file="package.json"

if [[ ! -f "$template_file" ]]; then
  printf 'missing template: %s\n' "$template_file" >&2
  exit 1
fi

if [[ ! -f "$profile_file" ]]; then
  printf 'missing profile: %s\n' "$profile_file" >&2
  exit 1
fi

npx --yes mustache "$profile_file" "$template_file" > "$output_file"
WW_BUILD_PROFILE="$profile" node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));

// Rainbow nowcast proxy URL baked into the bundle. The config UI always offers
// Rainbow radar (and defaults to it), and PKJS gates purely on endpoint !== ''
// — an empty endpoint does NOT hide the option; it makes every 'rainbow'
// selection fail soft (fetchRadarTuplesAt returns null → no radar reaches the
// watch). On a release build that would silently break radar for every user, so
// the guard below hard-fails instead. Dev/fork builds may ship empty on purpose.
const rainbowEndpoint = typeof process.env.RAINBOW_PROXY_ENDPOINT === 'string' ? process.env.RAINBOW_PROXY_ENDPOINT.trim() : '';

const buildProfile = process.env.WW_BUILD_PROFILE || 'dev';
if (buildProfile === 'release' && rainbowEndpoint.length === 0) {
  throw new Error(
    'RAINBOW_PROXY_ENDPOINT is empty for a release build. Rainbow radar is the ' +
    'default provider, so every release device would silently receive no radar ' +
    '(fetchRadarTuplesAt fails soft on an empty endpoint). Set the ' +
    'RAINBOW_PROXY_ENDPOINT_RELEASE GitHub Actions secret (or export ' +
    'RAINBOW_PROXY_ENDPOINT locally) before building the release profile.'
  );
}

pkg.rainbow = {
  endpoint: rainbowEndpoint,
};

// WAQI (aqicn.org) shared token baked into the bundle. WAQI is the DEFAULT AQI
// source, so an empty token would silently degrade every release user to
// Open-Meteo (air-quality.js falls back on an empty token). On a release build
// that is a silent feature downgrade, so hard-fail — mirroring the rainbow
// guard above. Dev/fork builds may ship empty on purpose (they degrade to
// Open-Meteo).
const aqicnToken = typeof process.env.AQICN_TOKEN === 'string' ? process.env.AQICN_TOKEN.trim() : '';

if (buildProfile === 'release' && aqicnToken.length === 0) {
  throw new Error(
    'AQICN_TOKEN is empty for a release build. WAQI is the default AQI source, ' +
    'so every release device would silently fall back to Open-Meteo. Set the ' +
    'AQICN_TOKEN_RELEASE GitHub Actions secret (or export AQICN_TOKEN locally) ' +
    'before building the release profile.'
  );
}

pkg.waqi = {
  token: aqicnToken,
};

// The phone app lets the app's PebbleKit JS reach only the domains usesPermissions lists
// (manifest version 2). The template lists the API hosts; the Rainbow endpoint above is
// known only now (scripts/lib/uses-permissions.js).
require('./scripts/lib/uses-permissions.js').addEndpointHosts(pkg.pebble,
  [rainbowEndpoint]);

// WW_BUILD_PLATFORMS (space/comma-separated) narrows the build to a subset of the
// template's targetPlatforms — screenshot captures that shoot a single platform set it
// so \`pebble build\` compiles just that one instead of all five. Unset → build every
// platform (unchanged default). Unknown names hard-fail rather than silently build nothing.
const wantPlatforms = String(process.env.WW_BUILD_PLATFORMS || '').split(/[\s,]+/).filter(Boolean);
if (wantPlatforms.length && pkg.pebble && Array.isArray(pkg.pebble.targetPlatforms)) {
  const all = pkg.pebble.targetPlatforms;
  const unknown = wantPlatforms.filter((p) => all.indexOf(p) === -1);
  if (unknown.length) {
    throw new Error('WW_BUILD_PLATFORMS has unknown platform(s): ' + unknown.join(', ') + ' (valid: ' + all.join(', ') + ')');
  }
  pkg.pebble.targetPlatforms = all.filter((p) => wantPlatforms.indexOf(p) !== -1);
  console.error('prepare-package: building only ' + pkg.pebble.targetPlatforms.join(', ') + ' (WW_BUILD_PLATFORMS)');
}

fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

printf 'prepared %s using %s\n' "$output_file" "$profile_file"
