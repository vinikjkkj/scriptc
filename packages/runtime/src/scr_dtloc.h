/* The ICU locale a DateTimeFormat works with (what V8's ResolveLocale hands to ICU): the available base name, the
 * three Unicode-extension keywords V8 keeps (calendar, numbering system, hour cycle) and the bundles. */
#ifndef SCR_DTLOC_H
#define SCR_DTLOC_H
#include "scr_ures.h"
#include <stddef.h>

typedef struct {
  char base[96];    /* ICU base name, "en_US", "zh_Hant_TW" */
  char lang[12];
  char script[8];
  char region[8];   /* the region subtag or "" */
  char calendar[40]; /* ICU (legacy) calendar keyword value ("gregorian", "islamic-civil") or "" */
  char numbering[16]; /* numbering system keyword, "" when absent */
  char hours[4];    /* "h11" "h12" "h23" "h24" or "" */
  ScrUloc uloc;     /* bundles of the base name */
} DtLoc;

/* Fills `l` from a BCP 47 base tag ("de-AT") and the extension values (BCP 47 spelling: ca "gregory", nu "latn", hc
 * "h23"); an empty string means absent. */
void scr_dtloc_init(DtLoc *l, const char *tag, const char *ca, const char *nu, const char *hc);

/* uloc_toLegacyType("calendar", v) for the calendars ICU knows (NULL for others); the BCP 47 spelling of a legacy name. */
const char *scr_dt_calendar_legacy(const char *bcp47);
const char *scr_dt_calendar_bcp47(const char *legacy);

/* ulocimp_getRegionForSupplementalData(locale, inferRegion): the region used for supplemental data lookups. */
void scr_dtloc_supplemental_region(const DtLoc *l, int inferRegion, char *out, size_t cap);
/* The locale's maximized language / region (addLikelySubtags): what is known after likely-subtag expansion. */
int scr_dt_add_likely(const char *lang, const char *script, const char *region, char *outLang, char *outScript, char *outRegion);

/* The calendar type ICU's Calendar::createInstance picks for the locale (getCalendarTypeForLocale). */
const char *scr_dtloc_calendar_type(const DtLoc *l, char *buf, size_t cap);
#endif
