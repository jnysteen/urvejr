#pragma once
#include <pebble.h>
#include "../appendix/status_threshold.h"

// How a highlighted cell is painted, shared by the two paths that draw one: a status
// slot (status_row.c) and a weather alert item (status_on_demand.c). WHAT a cell
// draws is status_threshold_look()'s call; this is HOW, so a slot and the alert icon
// of its kind cannot look different at the same level. The frames stay the callers':
// a slot's box hugs its measured icon + text, an item's box is its whole footprint.

// Paint `look`'s box over `frame`: a rounded-rect outline in the look's accent, filled
// first for THRESH_BOX_FILL; nothing for THRESH_BOX_NONE. Returns the ink the cell's
// glyph and text draw in: legible over a fill, the theme foreground otherwise.
GColor status_highlight_paint(GContext *ctx, GRect frame, ThreshLook look);

// Draw a cached status glyph in `ink`, its left edge at `x`, its box centred on the digits'
// cap centre `cap_cy`: the drawing carries its seat (status_icon_size.h). The glyph caches hold every
// glyph stroked in the theme foreground, so any other ink is restroked for the draw
// and restored after; a foreground ink draws the glyph as cached, which is also what
// keeps the rain drops' tinted fills intact (they are never boxed).
void status_highlight_draw_glyph(GContext *ctx, GDrawCommandImage *image, int16_t x,
                                 int16_t cap_cy, GColor ink);
