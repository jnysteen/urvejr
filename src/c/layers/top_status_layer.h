#pragma once

#include <pebble.h>

void top_status_layer_create(Layer* parent_layer, GRect frame);

// No calendar is on screen (layout_full_date in appendix/view_spec.h: a none-tier view,
// a radar or graph top, or a quick-view peek) -> the strip's date slot renders the
// full date. Pushed by the window (tier push). Pre-create
// calls store it for the first paint; changes forward into the row and refresh.
void top_status_layer_set_full_date(bool full_date);

// The strip's root layer, for per-view hiding (custom stripless views).
Layer *top_status_layer_get_root(void);

void top_status_layer_tick();

void top_status_layer_refresh();

void top_status_layer_destroy();

// The health readings the strip's active packed line shows (services/health_summary.h
// HEALTH_SUMMARY_*), 0 for none.
uint8_t top_status_layer_live_health(void);
