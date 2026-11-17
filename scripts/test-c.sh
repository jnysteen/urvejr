#!/usr/bin/env bash
# Host-compiled C tests (no Pebble SDK). The watchface targets the Pebble Time 2 (emery) only,
# so the sources carry no platform #ifdefs and each test is built once.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p build/host
CFLAGS="-std=c11 -Wall -Wextra -Werror -Itest/c/stub -Isrc"

# Geometry goldens for src/c/windows/layout.c.
cc $CFLAGS test/c/layout_test.c src/c/windows/layout.c -o build/host/layout_test
build/host/layout_test "${1:-}"
# The phone's fit check (view-cycle.js stackNeed) must measure every custom shape exactly as
# the watch's layout engine lays it out, and the settings page's pictures of the watch
# (view-cycle.js stackLayout) must put every band where the engine does: dump the engine's
# block heights and band placements per screen and compare them line by line
# (scripts/check-fit-lockstep.js).
cc $CFLAGS test/c/fit_lockstep_dump.c src/c/windows/layout.c -o build/host/fit_lockstep_dump
build/host/fit_lockstep_dump > build/host/fit_lockstep.txt
node scripts/check-fit-lockstep.js build/host/fit_lockstep.txt
# sizeof(Config) <= 64 (persist.c's change-compare buffer). A compile-time _Static_assert —
# the run just prints the size.
cc $CFLAGS test/c/config_size_test.c -o build/host/config_size_test
build/host/config_size_test
# The Bluetooth disconnect vibe (services/disconnect_vibe.h): a drop buzzes only while Quiet
# Time is off.
cc $CFLAGS test/c/disconnect_vibe_test.c -o build/host/disconnect_vibe_test
build/host/disconnect_vibe_test
# Timeline Quick View (services/quick_view.c): one re-render per show or hide, once it settles.
cc $CFLAGS test/c/quick_view_test.c src/c/services/quick_view.c -o build/host/quick_view_test
build/host/quick_view_test
cc $CFLAGS test/c/health_build_test.c src/c/services/health_build.c -o build/host/health_build_test
build/host/health_build_test
cc $CFLAGS test/c/health_test.c src/c/services/health.c -o build/host/health_test
build/host/health_test
cc $CFLAGS test/c/health_summary_test.c src/c/services/health_summary.c -o build/host/health_summary_test
build/host/health_summary_test
# WW_HOST_FAKE_TIME reroutes time(NULL) inside health_cache.c to the test's
# controllable clock (see test/c/stub/pebble.h).
cc $CFLAGS -DWW_HOST_FAKE_TIME test/c/health_cache_test.c src/c/services/health_cache.c src/c/services/health_build.c -o build/host/health_cache_test
build/host/health_cache_test
cc $CFLAGS test/c/radar_axis_test.c src/c/appendix/radar_axis.c -o build/host/radar_axis_test
build/host/radar_axis_test
cc $CFLAGS test/c/status_line_test.c src/c/appendix/status_line.c -o build/host/status_line_test
build/host/status_line_test
cc $CFLAGS test/c/status_threshold_test.c src/c/appendix/status_threshold.c -o build/host/status_threshold_test
build/host/status_threshold_test
# The thresholds blob's On demand bytes: the item cells, their compiled defaults, the
# Battery byte and bars 4 to 6's cells behind the blob (THRESH_SCRATCH_BYTES). Shares
# test/c/status_threshold_fixtures.h with the test above.
cc $CFLAGS test/c/status_threshold_on_demand_test.c src/c/appendix/status_threshold.c \
   -o build/host/status_threshold_on_demand_test
build/host/status_threshold_on_demand_test
# The weather alerts' pure half (the entries' parse, item map and text lanes, and the
# rain alert's text), linked with the thresholds blob reader the entry's box is judged
# through.
cc $CFLAGS test/c/alert_set_test.c src/c/appendix/alert_set.c \
   src/c/appendix/status_threshold.c -o build/host/alert_set_test
build/host/alert_set_test
# A tomorrow alert and a slot showing tomorrow's peak print the same mark: dump every
# metric text lane the watch builds (per day code, value and values flag) and check
# each against the phone's slot text (scripts/check-alert-lane-lockstep.js).
cc $CFLAGS test/c/alert_lane_dump.c src/c/appendix/alert_set.c \
   src/c/appendix/status_threshold.c -o build/host/alert_lane_dump
build/host/alert_lane_dump > build/host/alert_lane.txt
node scripts/check-alert-lane-lockstep.js build/host/alert_lane.txt
# The long time span's label names the whole hours the watch shows: dump the watch's count
# (forecast_span.h forecast_span_whole) for every long feed on every plot width and check
# each against the settings page's rule (scripts/check-forecast-span-lockstep.js).
cc $CFLAGS test/c/forecast_span_dump.c -o build/host/forecast_span_dump
build/host/forecast_span_dump > build/host/forecast_span.txt
node scripts/check-forecast-span-lockstep.js build/host/forecast_span.txt
# The On demand layout (appendix/on_demand.c), in tests sharing test/c/on_demand_fixtures.h:
# the make-room ladder (one side, looks before slots, the bleed, the drops, the invariants
# over random bars, down to "a quiet bar is the plain row layout, byte for byte"); two sides
# at once (the shared middle, the drop order, the far slot, the relax); the Battery stand-in;
# a weather alert merged into the slot on its side (out while that slot shows, standing in
# where it hides); and which short form a slot draws (the widest that fits with the gap to
# its neighbours, on either side, the elastic city's floor, the real date/week/sun families
# from status_short_text.h). It places its slots through the row layout it is linked with.
# on_demand_ladder_test.c includes the engine's source (its middle invariants measure
# layouts through the engine's own eval()), so the others link it. OD_TEST_PROBES adds the
# ladder row each side ends on (OdLayout.stage), which the tests read and the watch build
# leaves out.
# The suites' bars, sweeps and pinned cases are laid out for a 4 px gap between slots
# (status_row_layout.h STATUS_ROW_GROUP_GAP), the gap they were found at, and for a middle
# that keeps no more air than that (STATUS_ROW_MIDDLE_GAP at the same 4 px places it as
# before that gap came in); the engine reads both as parameters, so OD_FIXTURE_GAP builds
# them there, row layout and engine alike. The ladder suite's checks over random bars then
# run again at the watch's own gaps (OD_INVARIANTS_ONLY), with the items' tighter
# OD_ITEM_GAP as the watch has it.
OD_FIXTURE_GAP="-DSTATUS_ROW_GROUP_GAP=4 -DSTATUS_ROW_MIDDLE_GAP=4"
cc $CFLAGS $OD_FIXTURE_GAP -DOD_TEST_PROBES test/c/on_demand_ladder_test.c \
   src/c/appendix/status_row_layout.c -o build/host/on_demand_ladder_test
build/host/on_demand_ladder_test
cc $CFLAGS -DOD_TEST_PROBES -DOD_INVARIANTS_ONLY test/c/on_demand_ladder_test.c \
   src/c/appendix/status_row_layout.c -o build/host/on_demand_ladder_test_watch_gap
build/host/on_demand_ladder_test_watch_gap
for od in sides battery merge short replace; do
  cc $CFLAGS $OD_FIXTURE_GAP -DOD_TEST_PROBES test/c/on_demand_${od}_test.c src/c/appendix/on_demand.c \
     src/c/appendix/status_row_layout.c -o build/host/on_demand_${od}_test
  build/host/on_demand_${od}_test
done
# Every height a bar asks for has its pixel drawing (status_icon_size.h, the generated table).
cc $CFLAGS test/c/status_icon_drawings_test.c -o build/host/status_icon_drawings_test
build/host/status_icon_drawings_test
# The heights the watch asks for, held to the sizes the icon scripts make drawings at, both ways
# (scripts/check-icon-sizes.js): no height without its drawing, no drawing no height asks for.
build/host/status_icon_drawings_test --sizes > build/host/icon_sizes.txt
node scripts/check-icon-sizes.js build/host/icon_sizes.txt
cc $CFLAGS test/c/hr_scale_test.c src/c/appendix/hr_scale.c -o build/host/hr_scale_test
build/host/hr_scale_test
# The health graph's step scale (header-only, step_scale.h): every mark it picks draws,
# and a quiet window keeps the 0.1k scale.
cc $CFLAGS test/c/step_scale_test.c -o build/host/step_scale_test
build/host/step_scale_test
# The forecast plot's layout (only a series with a value above 0 takes a stripe band or
# anchors an edge), the temperature-axis margins on anchored edges, the hi/lo labels lined
# up with the curve and read back off the bytes on screen (header-only, temp_axis_pad.h).
cc $CFLAGS test/c/temp_axis_pad_test.c -o build/host/temp_axis_pad_test
build/host/temp_axis_pad_test
# The forecast's time span (forecast_span.h, header-only) and the hour axis's cadence
# (forecast_grid.c, #included): the 12 h / 24 h / long classes, the long span's edge (fill)
# rule and floors, and the edge labels.
cc $CFLAGS test/c/forecast_span_test.c -o build/host/forecast_span_test
build/host/forecast_span_test
cc $CFLAGS test/c/graph_style_test.c -o build/host/graph_style_test
build/host/graph_style_test
cc $CFLAGS test/c/status_row_layout_test.c src/c/appendix/status_row_layout.c -o build/host/status_row_layout_test
build/host/status_row_layout_test
# The row layout with the short forms swapped in, over a sweep of slots, checked against the
# settings page's copy (scripts/check-row-swap-lockstep.js).
cc $CFLAGS test/c/row_swap_dump.c src/c/appendix/status_row_layout.c -o build/host/row_swap_dump
build/host/row_swap_dump > build/host/row_swap.txt
node scripts/check-row-swap-lockstep.js build/host/row_swap.txt
cc $CFLAGS test/c/status_row_alloc_test.c src/c/appendix/status_row_alloc.c -o build/host/status_row_alloc_test
build/host/status_row_alloc_test
# Header-only pure date-slot formatters (static inline in date_format.h, no .c file —
# the status_icon_size.h pattern).
cc $CFLAGS test/c/date_format_test.c -o build/host/date_format_test
build/host/date_format_test
# The status slots' short forms (status_short_text.h, header-only like date_format.h):
# every kind's family, the date's year and day members over date_format.h's real
# outputs, the city's word ladder, whose vector table test/status-bars/domain/city-ladder.test.js also
# runs the phone's twin over, and that no family outgrows on_demand.h's OD_VARIANTS.
cc $CFLAGS test/c/status_short_text_test.c -o build/host/status_short_text_test
build/host/status_short_text_test
# Header-only pure curve (static inline in hatch.h, no .c file).
cc $CFLAGS test/c/hatch_stride_test.c -o build/host/hatch_stride_test
build/host/hatch_stride_test
# The hatch's absolute phase (hatch.h hatch_first_y): split at the top stripe band's
# edge, the night hatch draws exactly the dots of one unsplit pass (chart.c extend_top).
cc $CFLAGS test/c/hatch_seam_test.c -o build/host/hatch_seam_test
build/host/hatch_seam_test
# The band status rows (forecast / radar / health, and bars 4 to 6) share ONE owner, so one
# test covers them all.
cc $CFLAGS test/c/status_bar_test.c src/c/layers/status_bar.c -o build/host/status_bar_test
build/host/status_bar_test
# Header-only pure predicate (static inline in persist.h, no .c file — the
# date_format_test pattern): the acceptance rule for the inbound
# CLAY_NIGHT_LIGHT_UINT8 "Dim backlight" tuple, which is the one decision in
# app_message.c's unpack path that is not an SDK call (app_message.c itself needs
# the whole AppMessage + layer surface, so it cannot be host-compiled).
cc $CFLAGS test/c/night_light_wire_test.c -o build/host/night_light_wire_test
build/host/night_light_wire_test
# The other end of the same feature: the window predicate that decides, from the
# clock, whether the "Dim backlight" tint should be burning right now, plus its
# colour packer. Both are static inlines in appendix/night_light.h — the module's .c
# drives the LED through applib and reads flash through persist.h, so it cannot be
# host-compiled, and this is the only executable check the apply path gets.
cc $CFLAGS test/c/night_light_window_test.c -o build/host/night_light_window_test
build/host/night_light_window_test
# The third side of the same feature: the NIGHT_LIGHT persist accessors, run for
# real. appendix/persist.c (through persist_store.c) needs nothing from the SDK but the
# persistent-storage syscalls, so the test fakes those over a RAM map and EXECUTES
# persist_set/get_night_light — which is what pins the change gating (a re-save of
# identical bytes must not reach flash) and the getter's short-read guard, neither
# of which any header-only test can reach.
cc $CFLAGS test/c/night_light_persist_test.c src/c/appendix/persist.c \
   src/c/appendix/persist_store.c test/c/stub/theme_stub.c -o build/host/night_light_persist_test
build/host/night_light_persist_test
# The LINE_STYLES byte decode (per-line marker styles, wire bytes [9..11] of
# CLAY_LINE_STYLE_UINT8): header-only static inlines in persist.h, mirrored
# against the JS packer's pins in test/forecast-graphs/domain/line-style.test.js so the two wire ends
# cannot drift.
cc $CFLAGS test/c/line_style_decode_test.c \
   -o build/host/line_style_decode_test
build/host/line_style_decode_test
# The solid line's gap/run kernel (chart_runs.h, header-only): segmentation of
# a polyline across absent samples, incl. the metric lines' zero_absent
# "wire byte 0 draws nothing" reading and the zero a JOIN line still comes down
# to next to a reading. The preview's twin (lineRuns) runs the same
# LINE_RUN_VECTORS in test/page/settings/config-blocks.test.js.
cc $CFLAGS test/c/chart_absent_test.c -o build/host/chart_absent_test
build/host/chart_absent_test
# The stripe line style's arithmetic (chart_stripe.h, header-only): value ->
# level, the background->colour blend and the B&W dither. Mirrored against the
# preview's stripe pins in test/page/settings/config-blocks.test.js.
cc $CFLAGS test/c/chart_stripe_test.c -o build/host/chart_stripe_test
build/host/chart_stripe_test
# The chart's one vertical rule, "Draw from" / "Bars from" (chart_flip.h, header-only):
# the zero row + direction, the mirrored vertex and span mappings, the hanging vertex
# hold (a value under one pixel stays off the gap row under a top stripe band) and
# the palette's Top flag. Mirrored by the previews (test/page/forecast-graphs/config-draw-from.test.js).
cc $CFLAGS test/c/chart_flip_test.c -o build/host/chart_flip_test
build/host/chart_flip_test
# The radar sky blob decode + bolt glyph (radar_sky.h, header-only), mirrored
# against radar-sky.js's packSky pin in test/weather/domain/radar/radar-sky.test.js.
cc $CFLAGS test/c/radar_sky_test.c -o build/host/radar_sky_test
build/host/radar_sky_test
# The radar notice (RAIN_RADAR_LIMITED, the phone's line: a request limit or a place
# outside the source's coverage): its pure decisions, header-only static inlines in
# radar_limit.h (when the notice moves; whether the radar has a window or the notice
# to show; what the empty state says), and the RADAR_NOTICE persist accessors run for
# real over a faked flash (slot 58, change gating, absent = no notice, the UTF-8-safe
# bound). The accessors are unguarded, so the plain host build must define them.
cc $CFLAGS test/c/radar_limit_test.c -o build/host/radar_limit_test
build/host/radar_limit_test
cc $CFLAGS test/c/radar_notice_persist_test.c src/c/appendix/persist.c src/c/appendix/persist_store.c test/c/stub/theme_stub.c \
   -o build/host/radar_notice_persist_test
build/host/radar_notice_persist_test
# Where the status lines live in flash: the first four side by side, bars 4 to 6's lines and
# On demand cells in the slots appended for them.
cc $CFLAGS test/c/status_line_persist_test.c src/c/appendix/persist.c src/c/appendix/persist_store.c test/c/stub/theme_stub.c \
   -o build/host/status_line_persist_test
build/host/status_line_persist_test
# persist_store.c's RAM copy of the store: a key's second read costs no flash
# call, absent keys too, and every write keeps the copy exact. Built again with an arena the
# test fills, so the way back to the flash runs too.
cc $CFLAGS test/c/persist_store_test.c src/c/appendix/persist_store.c \
   -o build/host/persist_store_test
build/host/persist_store_test
cc $CFLAGS -DSTORE_CACHE_BYTES=384 test/c/persist_store_test.c \
   src/c/appendix/persist_store.c -o build/host/persist_store_test_small
build/host/persist_store_test_small
