# The Pebble Time 2 is the only target

The watchface builds for emery (Pebble Time 2) alone. aplite, basalt, diorite and flint are no
longer supported: keeping them meant a lean aplite fork (ADR 0001), 64 KB image ceilings, 536 B
and 640 B inboxes, black-and-white drawings and a settings page that drew two screen sizes, all
for watches the owner no longer wants to spend time on. This supersedes ADR 0001.

## Consequences

- `package.template.json` targets emery only; the `*_aplite.c` twins, the B&W icon drawings, the
  aplite and 64 KB size checks and the twin CI check are gone.
- The C code has no `PBL_PLATFORM_*`, `PBL_COLOR`/`PBL_BW` or `PBL_ROUND` branches left; the
  former feature macros (`WW_RAIN_RADAR`, `WW_ON_DEMAND`, …) are always on and were folded in.
- The phone treats every watch as emery: `computeEnv()` reports every capability, and the
  payloads no longer gate on a known platform. The settings page's env-flag gates remain but
  are always open.
- The persisted `Config` struct keeps its emery layout, and persist keys stay append-only, so an
  emery install upgrades in place.
- The PKJS code stays ES5. aplite's pre-ES6 runtime was the reason; relaxing it is a separate
  decision.
- Releases up to 3.x remain the last for the other watches.
