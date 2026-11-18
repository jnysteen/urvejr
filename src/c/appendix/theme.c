// The theme accessors, out of line (theme.h says why).
#include <pebble.h>
#include "theme.h"

bool theme_is_light(void) {
    return config_get()->theme == 1 || config_get()->theme == 3;
}

GColor theme_fg(void) {
    return theme_is_light() ? GColorBlack : GColorWhite;
}

GColor theme_bg(void) {
    return theme_is_light() ? GColorWhite : GColorBlack;
}

GColor theme_furniture(GColor gray) {
    return theme_is_light() ? GColorBlack : gray;
}

bool theme_is_bw(void) {
    return config_get()->theme == 2 || config_get()->theme == 3;
}

GColor theme_pick(GColor color_arm, GColor bw_arm) {
    return theme_is_bw() ? bw_arm : color_arm;
}

