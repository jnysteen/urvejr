// Host stand-in for appendix/theme.c (which reads config_get()): the dark theme, for the
// tests that link persist.c, whose colour getters default to theme_fg().
#include <pebble.h>
#include "c/appendix/theme.h"

GColor theme_fg(void) {
    return GColorWhite;
}
