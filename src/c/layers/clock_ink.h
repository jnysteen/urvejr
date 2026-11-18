#pragma once

#include "c/appendix/config.h"    // TimeFont enum
#include "c/appendix/clock_seat.h"   // ClockInk / LayoutMetrics
#include "c/layers/layer_util.h"  // status_forecast_band_h / status_full_tier_font

// Where each time font's digits actually ink inside the clock band — the one quantity the
// layout solver cannot derive. The SDK has no ink-bbox call (text_layer_get_content_size
// reports the LINE BOX, and each face relates its ink to that box differently):
//
//   roboto                          leco                            bitham
//   glyphs: Roboto-Bold 62          FONT_KEY_LECO_60_NUMBERS_AM_PM  glyphs: Montserrat-Medium 62
//
// Two kinds of row, then. The SYSTEM font (LECO) carries a MEASURED pair (procedure below). The
// "glyphs" faces are the anti-aliased clock (clock_glyphs.h): their ink_h is GENERATED with the
// glyph images (clock_glyphs_ink.h), and their centre_off only places the band and its clip
// rect — time_layer.c draws the glyphs' first inked row at clock_ink_top_in_band() and the
// band solver seats with clock_seat_y(), which subtracts that same term, so centre_off cancels
// and the ink lands where the solver asked whatever its value.
//
// This header is included by main_window.c (which passes the pair to the layout solver) and by
// layers/time_layer.c (which seats the AM/PM label on the digits' ink row) — and by nothing
// else. It depends on config.h, which is exactly why windows/layout.c must not reach it: that
// module's purity is enforced by the host stub (test/c/stub/pebble.h), so the metric arrives
// there as a parameter, not a lookup. For the same reason nothing in this header can appear in
// a host test — it pulls layer_util.h, whose inline bodies call the text API.
//
// ── How the system-font pair was measured (2026-08-25), so a font change is a re-run and not
//    an eyeball. ──
// 1. Fixture fixtures/clock-cal-leco.json: the noCal preset, 24h, health and radar off. noCal is
//    the one preset where NOTHING else paints inside the clock band, so a plain row scan
//    isolates the digits with no colour tricks and no AM/PM child in the way.
// 2. PLATFORMS=emery scripts/capture-screenshots.sh cal-leco clock-cal-leco
// 3. scripts/ink-scan style row scan of the clock band for the first and last inked row.
//    The band is pinned by test/c/layout_test.c's `none.time` golden: (2,24,196,60), i.e. band
//    centre 54.
// 4. centre_off = (ink_top + ink_h/2) - band_centre, with C truncation — clock_seat_y() inverts
//    it with the same truncation, so the round trip is exact.
// 5. Add 2. The measurement was taken while time_layer.c still applied its MT_TIME_* nudge, a
//    uniform -2 for all three fonts. Removing it drops the ink 2 rows.
//
// Digits carry no descenders and every digit spans the full cap height, so the extents do not
// move with the displayed time. The resulting gaps reproduce the spec's measured table
// (noCal 14/14).
ClockInk clock_ink_for(int16_t time_font);

// Build the layout's font metrics for RIGHT NOW.
#define LAYOUT_METRICS_NOW()                                                  \
    ((LayoutMetrics){ (int16_t) status_forecast_band_h(status_full_tier_font()), \
                      clock_ink_for(config_get()->time_font) })
