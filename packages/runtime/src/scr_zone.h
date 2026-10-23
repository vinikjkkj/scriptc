/* ICU 78.2 time zone rules and zone metadata (OlsonTimeZone, SimpleTimeZone, ZoneMeta) over zoneinfo64, metaZones and
 * timezoneTypes of the ICU data store. */
#ifndef SCR_ZONE_H
#define SCR_ZONE_H
#include "scr_ures.h"
#include <stddef.h>
#include <stdint.h>

typedef struct ZiZone ZiZone;

/* The zone for an id of the zoneinfo64 Names list (links followed); NULL when unknown. */
const ZiZone *zi_find(const char *id);
/* OlsonTimeZone::getOffset(date, local = false): UTC milliseconds in, raw and dst offsets (ms) out */
void zi_offset(const ZiZone *z, double utcMs, int32_t *rawMs, int32_t *dstMs);
void zi_offset_local(const ZiZone *z, double localMs, int32_t *rawMs, int32_t *dstMs); /* getOffset(date, local = true) */
/* BasicTimeZone::getPreviousTransition / getNextTransition: 1 and the transition time (ms) with the DST savings (ms)
 * of the rule before and after it, or 0 */
int zi_prev_transition(const ZiZone *z, double base, int inclusive, double *time, int32_t *fromDst, int32_t *toDst);
int zi_next_transition(const ZiZone *z, double base, int inclusive, double *time, int32_t *fromDst, int32_t *toDst);

/* ZoneMeta */
int zm_canonical_id(const char *tzid, char *out, size_t cap);              /* getCanonicalCLDRID; 0 when unknown */
int zm_region(const char *tzid, char *out, size_t cap);                    /* TimeZone::getRegion; "001" or a country; 0 when unknown */
int zm_canonical_country(const char *canonicalId, char *country, size_t cap, int *isPrimary); /* 0 when none */
int zm_metazone_id(const char *canonicalId, double date, char *out, size_t cap);  /* 0 when none */
int zm_zone_for_metazone(const char *mzid, const char *region, char *out, size_t cap); /* getZoneIdByMetazone */
int zm_short_id(const char *canonicalId, char *out, size_t cap);           /* getShortIDFromCanonical */
#endif
