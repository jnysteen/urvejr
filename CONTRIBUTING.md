# Contributing

CONTRIBUTING.md is the setup walkthrough for urvejr that takes you through building the watchface, installing builds, and the local dev config. The commands, config and their options are in [DEV.md](DEV.md).

## Building

Prerequisites: [Node.js](https://nodejs.org/en/) and [mise](https://mise.jdx.dev/)

```bash
# Install toolchain from mise.toml
mise install

# Install JS dependencies
npm install

# Build dev (default)
mise build

# Build release
mise build release
```

The build uses the Pebble SDK version pinned in `pebble-sdk-version`, which the repo scripts provision. The `.pbw` lands in `build/`.

`mise build release` needs `AQICN_TOKEN` in the environment; the release profile fails without it (see the env var table in [DEV.md](DEV.md#environment-variables-env)).

## Package profiles and installing builds

`mise build` and `mise build release` generate `package.json` from `package.template.json`
and a profile in `profiles/` before they build ([Package generation](DEV.md#package-generation)).

To install a build, set `IP=<PHONE_IP>` in `.env` and run `mise install-phone`, which builds
and installs the dev build. `mise install-cloud` installs through CloudPebble, and
`mise install-emulator` on the emulator (emery, the Pebble Time 2). You can also run Pebble CLI
commands directly. The options (platforms, release builds, `--logs`, screenshots) are in
[DEV.md](DEV.md#install-on-phone).

## Config

Local dev config has three layers:

- `.env` picks the local mode or scenario, such as `FIXTURE=berlin`, and build options such
  as `ENABLE_MEMORY_LOGGING=1` ([env var table](DEV.md#environment-variables-env)).
- `fixtures/*.json` hold committed, deterministic UI state that makes emulator screenshots
  reproducible: watch facts, Clay render settings, weather payloads and similar data.
  [DEV.md](DEV.md#fixtures) lists every supported field.
- `src/pkjs/dev-config.js` is for uncommitted behavior testing, including preloaded Clay
  settings when you exercise real app flows instead of a fixture's UI, and local-only switches
  such as a PKJS storage reset on boot
  ([debug flags](DEV.md#debug-flags-srcpkjsdev-configjs)).

While a fixture is active, put Clay values that change the rendering in the fixture's
`claySettings`. Use `dev-config.js` for local-only behavior switches and testing without a
fixture, e.g. `module.exports.owmApiKey = 'abc123';`.

To try a fixture, set `FIXTURE=berlin` in `.env` and run `mise install-emulator --logs`.

## Upgrading pebble-tool

`mise.toml` pins pebble-tool to an exact version. To bump it, run the two commands in
[Upgrading pebble-tool](DEV.md#upgrading-pebble-tool) in DEV.md.
