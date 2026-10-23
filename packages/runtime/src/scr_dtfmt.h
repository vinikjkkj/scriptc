/* ICU 78.2's SimpleDateFormat (formatting) with DateFormatSymbols loaded from the ICU data store. */
#ifndef SCR_DTFMT_H
#define SCR_DTFMT_H
#include "scr_cal.h"
#include "scr_dtloc.h"
#include <stddef.h>

typedef struct ScrDtFmt ScrDtFmt;

/* UTimeZoneFormatStyle */
enum {
  TZFMT_GENERIC_LOCATION = 0, TZFMT_GENERIC_LONG, TZFMT_GENERIC_SHORT, TZFMT_SPECIFIC_LONG, TZFMT_SPECIFIC_SHORT,
  TZFMT_LOCALIZED_GMT, TZFMT_LOCALIZED_GMT_SHORT, TZFMT_ISO_BASIC_SHORT, TZFMT_ISO_BASIC_LOCAL_SHORT,
  TZFMT_ISO_BASIC_FIXED, TZFMT_ISO_BASIC_LOCAL_FIXED, TZFMT_ISO_BASIC_FULL, TZFMT_ISO_BASIC_LOCAL_FULL,
  TZFMT_ISO_EXTENDED_FIXED, TZFMT_ISO_EXTENDED_LOCAL_FIXED, TZFMT_ISO_EXTENDED_FULL, TZFMT_ISO_EXTENDED_LOCAL_FULL,
  TZFMT_ZONE_ID, TZFMT_ZONE_ID_SHORT, TZFMT_EXEMPLAR_LOCATION
};

/* Zone callbacks for the 'z' 'Z' 'v' 'V' 'O' 'X' 'x' fields: formatted into out (malloc'ed, caller frees) */
typedef struct {
  void *ctx;
  /* style: UTZFMT_STYLE_* index (see scr_dtfmt.c); returns a malloc'ed UTF-8 string */
  char *(*format)(void *ctx, int style, double utcMs, const ScrCal *cal);
} ScrDtZone;

/* A formatter for `pattern` in `loc` using calendar `calType` (CT_*). NULL when the data is unusable. */
ScrDtFmt *scr_dtfmt_new(const DtLoc *loc, const char *pattern, int calType, const char *dateOverride, const char *timeOverride);
void scr_dtfmt_free(ScrDtFmt *f);
/* format(date): malloc'ed UTF-8. rawOffsetMs/dstOffsetMs are the zone's offsets at the instant. */
char *scr_dtfmt_format(ScrDtFmt *f, double utcMs, int32_t rawOffsetMs, int32_t dstOffsetMs, const ScrDtZone *zone);
const char *scr_dtfmt_pattern(const ScrDtFmt *f);

/* DateFormatSymbols::getPatternCharIndex based checks */
int scr_dt_is_syntax_char(char c);
#endif
