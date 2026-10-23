/* Time zones for DateTimeFormat: the zone a formatter works in and ICU's TimeZoneFormat / TimeZoneNames /
 * TimeZoneGenericNames over it (scr_zone.c holds the rules and metadata). */
#ifndef SCR_DTZ_H
#define SCR_DTZ_H
#include "scr_cal.h"
#include "scr_zone.h"
#include <stdint.h>

struct scr_tz;
typedef struct {
  const struct scr_tz *tz; /* the mined zone (total offsets), NULL for an offset zone */
  const ZiZone *zi;        /* ICU's rules for the zone, NULL when unknown or an offset zone */
  int offsetSec;           /* offset zones ("+05:30") */
  int isOffset;
  char id[80];             /* the ICU id the zone was created with ("GMT+05:30" for an offset zone) */
  const void *loc;         /* the DtLoc the names are read for (set by the formatter before formatting) */
} DtfZone;

int dtz_create(DtfZone *z, const char *tzOption); /* tzOption NULL: the host zone; 0 on success */
void dtz_free(DtfZone *z);
void dtz_offsets(const DtfZone *z, double utcMs, int32_t *rawMs, int32_t *dstMs);
char *dtz_format_cb(void *ctx, int style, double utcMs, const ScrCal *cal);
#endif
