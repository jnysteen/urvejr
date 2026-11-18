# Releasing

RELEASE.md is the release checklist for urvejr that covers how a release is cut, what each release needs besides the code, and how to refresh the store assets.

## Automatic GitHub releases (Release Please)

`.github/workflows/release-please.yml` manages releases:

1. Merge conventional commits into `main`.
2. Release Please opens or updates a release PR that bumps the version in
   `package.template.json` (`$.version`).
3. Merge the release PR. That tags the release.
4. The workflow creates a GitHub release and uploads `build/urvejr.pbw`.

The commit prefixes decide the version bump, so they matter. The weather plugins are
versioned on their own: release-please skips commits that touch only `plugins/` (see
`plugins/README.md`).

If the `.pbw` build fails after the tag is cut, the release is published without its `.pbw`,
and running the failed job again builds nothing, because release-please has already tagged it. Merge the
fix to `main`, then run *Release Please* by hand on `main` (Actions → Release Please → Run
workflow) with the release's tag, e.g. `v2.6.0`. That run builds `main`, uploads its `.pbw` to
that release, and stops if `main` is at another version.

## Release notes

A `Release-As: x.y.z` trailer pins the next version. Its commit has to change a file outside
`plugins/`: release-please skipped an empty one (`git commit --allow-empty`, 3.2.4's first
try) and kept proposing the feature bump.

### Changelog style

The appstore changelog follows Keep a Changelog 1.1.0
(https://keepachangelog.com/en/1.1.0/, summarized here so every session works from it).

- Its principles: a changelog is for humans, not machines; every version gets an entry;
  changes of the same type are grouped; the latest version comes first; it lists the
  noteworthy differences for the user, not the commit log.
- Its types, in this order and only those that apply: `Added` for new features, `Changed` for
  changes in existing functionality, `Deprecated` for soon-to-be removed features, `Removed`
  for now removed features, `Fixed` for bug fixes and `Security` for vulnerabilities.
- Changes count against the previous release users had: `Changed`, `Removed` and `Fixed` name
  only what that release already had. A feature new in this release goes under `Added` once,
  with everything about it (its icons turning to the moon at sunset are part of the new slot,
  not a `Changed` item), and a bug in something that never shipped is no `Fixed` item. When a
  release replaces one that users barely had (3.2.1 for 3.2.0), its notes cover everything
  since the release before and leave the skipped one out.
- Each item is one line without a full stop, naming the feature the way the user sees it;
  `Fixed` items say what was wrong or what works again. No marketing words, exclamation marks,
  settings path, how-to or second sentence. Small fixes and settings-screen polish are one
  last `Minor fixes` line in `Fixed`.

The appstore changelog has the terse form Keep a Changelog's own examples use: plain-line
headings, items of two to eight words, no platform notes and no explanation. The shape to
match:

```
Added
- Weather condition status slot
- Weather icon option for the City slot
- Date formats 09.26 and Sep

Changed
- New rain alert icons
- Tap a status bar to edit it

Removed
- Anonymous telemetry

Fixed
- Minor fixes
```

Write the changelog for users, not from the diff. List
individually only what a user can act on: a feature they can use, or a bug that affected the
watchface itself. Group everything else (settings-screen polish, internal refactors, small
fixes) into one `Minor fixes` line, or leave it out. A polish-only patch gets that one line,
not an itemized list of cosmetic tweaks. Keep the tone factual and short: no filler
reassurances ("nothing you need to change on your end") and no generic sign-offs ("more on
the way", "message me anytime").

## Developer portals

- [Rebble Developer Portal](https://dev-portal.rebble.io/
)
- [Pebble Developer Dashboard (RePebble)](https://developer.repebble.com/dashboard)

## Screenshots and store assets

The store listing copy is in [STORE_LISTING.md](STORE_LISTING.md). The commands, their
arguments and the scene set are in [DEV.md](DEV.md#store-screenshots).

1. Capture the five chosen store configs with
   `scripts/capture-store-shots.sh <version>` ([DEV.md](DEV.md#store-screenshots)).
2. Upload the five raw PNGs from `screenshot/<version>/store/emery/` to the appstore.
3. Composite the README hero shots from the store captures with `mise composite <version>`
   ([DEV.md](DEV.md#readme-hero-shots), which also says where the device frames come from).
4. When the UI or the scene set changed, refresh the README showcase GIF: run
   `scripts/capture-showcase.sh <version>`, then `scripts/assemble-showcase-gif.sh <version> emery`
   ([DEV.md](DEV.md#showcase-gif-readme-hero)). Point the README's
   `screenshot/<version>/showcase/emery-showcase.gif` link at the new version and commit the GIFs.
