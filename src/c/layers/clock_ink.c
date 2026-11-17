#include "clock_ink.h"


#include "clock_glyphs_ink.h"   // GENERATED: the anti-aliased glyphs' ink heights

// Out of line on purpose: main_window.c asks for this at two points (window_load and every
// render), and as a header inline the table was emitted at both. Not linked on aplite at all
// (WW_CLOCK_INK, see wscript). time_font is always in range (config.c normalises it at load).
//
// Two kinds of row, see clock_ink.h: MEASURED pairs for the 1-bit system fonts (LECO
// everywhere, and all three faces on the B/W 144px watches), and GENERATED ink heights for the
// anti-aliased glyphs (Roboto and Bitham on the colour screens), whose centre_off only places
// the band.
ClockInk clock_ink_for(int16_t time_font) {
    static const ClockInk k[] = {
        // emery: Roboto and Bitham are anti-aliased glyphs.
        [TIME_FONT_ROBOTO] = {  2, CLOCK_GLYPHS_ROBOTO_INK_H },
        [TIME_FONT_LECO]   = {  2, 42 },
        [TIME_FONT_BITHAM] = {  2, CLOCK_GLYPHS_BITHAM_INK_H },
    };
    return k[time_font];
}
