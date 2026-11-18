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

const buildProfile = process.env.WW_BUILD_PROFILE || 'dev';

// WAQI (aqicn.org) shared token baked into the bundle. WAQI is the DEFAULT AQI
// source, so an empty token would silently degrade every release user to
// Open-Meteo (air-quality.js falls back on an empty token). On a release build
// that is a silent feature downgrade, so hard-fail. Dev/fork builds may ship empty on purpose (they degrade to
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
