#pragma once

// Theme accessors — dark=0 (default) / light=1 / bw=2 / bw-light=3 (Config.theme;
// see docs/superpowers/specs/2026-07-07-theme-inversion-design.md). No heap: every
// accessor reads config_get()->theme directly, so it's safe to call anywhere after
// config_load() has run. Out of line in appendix/theme.c (below says why).
//
// Two independent axes used throughout the C render sweep:
//  - Polarity: dark/bw are white-on-black; light/bw-light are black-on-white.
//    theme_fg()/theme_bg() give the polarity's foreground/background.
//  - Effective color: the watch renders "as color" unless the theme is bw or bw-light.
//    theme_pick()/theme_is_bw() encode that split.
//
// bw-light is the light-polarity twin of bw: it takes the bw draw path (theme_is_bw()
// true) with light-polarity fg/bg (theme_is_light() true).

#include <pebble.h>
#include "config.h"

// Out of line (appendix/theme.c): as static inlines, -Os kept them as calls and emitted a
// private copy in every file that used one — about 30 copies, some 0.9 KB of image.

/** True in the light theme (black-on-white polarity): light or bw-light. */
bool theme_is_light(void);
/** dark/bw polarity: white. light polarity: black. Default foreground. */
GColor theme_fg(void);
/** dark/bw polarity: black. light polarity: white. Window/panel background. */
GColor theme_bg(void);
/**
 * Chart-furniture gray (axis/tick/grid-line constants): light theme flattens
 * them to black (a midtone gray reads too close to a white background);
 * dark/bw keep the given gray unchanged.
 */
GColor theme_furniture(GColor gray);

// Out of line (appendix/theme.c), as above.
/** True when this color build is rendering the Black & White theme (bw or bw-light). */
bool theme_is_bw(void);
/**
 * Effective-color pick: on a color build, a bw theme takes bw_arm (the exact
 * value a real B&W watch would use for this constant) at runtime; otherwise
 * color_arm renders. See theme_is_bw().
 */
GColor theme_pick(GColor color_arm, GColor bw_arm);
