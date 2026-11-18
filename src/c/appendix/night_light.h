// src/c/appendix/night_light.h
#pragma once

#include <stdint.h>
#include <stdbool.h>

// The "Dim backlight" tint: inside a user-chosen nightly window the backlight LED
// burns the user's colour instead of the system default, so a wrist-raise at 03:00
// does not blast white light. The settings live on flash in the NIGHT_LIGHT persist
// slot (persist.h), copied byte for byte off the phone's CLAY_NIGHT_LIGHT_UINT8
// tuple; this module is the only thing that reads them back and drives the LED.
//
// The two pure helpers below are the only decisions here that are not SDK calls, which
// lets scripts/test-c.sh execute them (night_light.c can't be host-compiled — it needs
// persist + applib). Deliberately no <pebble.h> here, for the same reason
// status_threshold.h omits it.

/**
 * Does `hour` fall inside the nightly window [start_hour, end_hour)?
 *
 * The window conventions are the phone's own, unchanged from battery-saver.js and
 * re-documented in persist.h — this is their one C implementation:
 *   - start_hour is INCLUSIVE, end_hour is EXCLUSIVE. 22..6 covers 22:00-05:59, and
 *     06:00 is already day.
 *   - The window WRAPS past midnight: end_hour < start_hour is normal, never an
 *     error, and callers must not assume start <= end.
 *   - start_hour == end_hour means NEVER, and that is also the feature's off switch
 *     on the wire: the phone zeroes all five bytes when the "Dim backlight" toggle
 *     is off, so there is no separate enabled flag to consult. A user who configures
 *     a zero-length window (5..5) lands on the same rule with their colour intact.
 *
 * No minute parameter, on purpose: both boundaries are whole hours, so the minute
 * can never change the answer, and taking one would imply otherwise.
 *
 * Pure integer arithmetic over plain ints: no SDK state, no division, nothing that
 * can trap on any input. All three arguments are 0..23 in practice — the wire
 * guarantees it for both bounds (night_light_wire_ok rejects anything else) and
 * tm_hour for `hour` — and only that range is specified; the host tests sweep it
 * exhaustively.
 *
 * @param hour       The hour to test, normally struct tm's tm_hour (0..23).
 * @param start_hour First hour inside the window (0..23), INCLUSIVE.
 * @param end_hour   First hour outside it again (0..23), EXCLUSIVE.
 * @returns True when the tint should be burning at `hour`.
 */
static inline bool night_light_hour_in_window(int hour, int start_hour, int end_hour) {
    if (start_hour == end_hour) { return false; }           // never
    if (start_hour < end_hour) {                            // same day: 1..5, 9..17
        return hour >= start_hour && hour < end_hour;
    }
    return hour >= start_hour || hour < end_hour;           // wraps midnight: 22..6
}

/**
 * Pack three raw LED channels into the 0x00RRGGBB word light_set_color_rgb888 takes.
 *
 * The persisted colour bytes are RAW 0..255 channels, NOT the GColor8 argb bytes the
 * palette and line-style blobs carry, so they must go out through the rgb888 variant:
 * light_set_color(GColor) keeps only 2 bits per channel (applib/app_light.h says so
 * outright), which would throw away the dim depth these three bytes exist to carry —
 * the driver scales each channel by the user's own brightness.
 *
 * @param r Red channel, 0..255.
 * @param g Green channel, 0..255.
 * @param b Blue channel, 0..255.
 * @returns The packed 0x00RRGGBB value; the high byte is always zero.
 */
static inline uint32_t night_light_rgb888(uint8_t r, uint8_t g, uint8_t b) {
    return ((uint32_t) r << 16) | ((uint32_t) g << 8) | (uint32_t) b;
}


// Start driving the backlight and apply the current state immediately. Subscribes to
// the app focus service, so call once from the window's _load; pairs with
// night_light_deinit() in _unload.
void night_light_init(void);

// Re-evaluate the window against the clock and the persisted settings, and move the
// LED only if the answer actually changed. Idempotent and cheap (one 5-byte persist
// READ plus integer compares) when nothing moved, so the minute tick and the
// settings/repaint checkpoint can both call it unconditionally.
void night_light_refresh(void);

// Stop driving the backlight: unsubscribe from focus and hand the LED back to the
// user's own colour if we had tinted it. Call from the window's _unload.
void night_light_deinit(void);

