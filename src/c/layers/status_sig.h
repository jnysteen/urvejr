#pragma once
#include <stddef.h>
#include <stdint.h>

// Fold `len` bytes into a status row's content signature (seeded 5381 by the
// refresh). Shared by status_row.c and status_on_demand.c, which fold into the same
// signature, so a change in either is a change of the row. One copy, in status_row.c:
// inlined, every call site carried the loop.
uint16_t sig_fold(uint16_t sig, const uint8_t *data, size_t len);
