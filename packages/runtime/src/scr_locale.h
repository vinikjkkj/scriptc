/* BCP 47 locale handling for Intl services: syntax check, canonical form, and resolution against the locales the
 * ICU data (scr_ures.h) ships formatter data for. Resolution follows ECMA-402 "lookup" (what V8's best fit answers for
 * every tag it accepts). */
#ifndef SCR_LOCALE_H
#define SCR_LOCALE_H
#include <stddef.h>
#include "scr_ures.h"

enum { SCR_LOC_NF = 0, SCR_LOC_DTF = 1 };

typedef struct {
  char tag[96];  /* resolved available tag without extensions, e.g. "de-AT" */
  ScrUloc uloc;  /* the ICU bundles (per package) whose data and parent chains apply */
  char nu[24];   /* -u-nu- value or "" */
  char ca[24];   /* -u-ca- value or "" */
  char hc[8];    /* -u-hc- value or "" */
  char bad[200]; /* when resolution fails with -2: the lowercased tag ICU rejected */
} ScrLocRes;

/* 0 on success (out holds the canonical tag); -1 when `in` is not a structurally valid language tag. */
int scr_locale_canonicalize(const char *in, size_t n, char *out, size_t cap);
/* `locales` is "" (default locale) or one or more canonicalizable tags separated by ','. -1 for a tag that is not
 * structurally valid (V8: "Incorrect locale information provided"), -2 for a structurally valid tag ICU rejects
 * (V8: "Invalid language tag: <tag>", r->bad holds the tag). */
int scr_locale_resolve(int service, const char *locales, ScrLocRes *r);
/* V8 keeps ONE default formatter per kind (Number, Date, Date-only, Time-only), keyed by the locales string, for
 * toLocale*String(locales, undefined) with a string or undefined locales; undefined and "" share the key "". The only
 * observable effect is that toLocale*String("") answers (instead of throwing) while the entry for the key "" is held.
 * The lowering marks such calls with the option bag entry SCR_ICU_CACHE_KEY. */
#define SCR_ICU_CACHE_KEY "\x01k"
enum { SCR_ICUC_NUMBER = 0, SCR_ICUC_DATE_ALL = 1, SCR_ICUC_DATE_TIME = 2, SCR_ICUC_DATE_DATE = 3 };
/* The locales text to resolve for a cacheable call: "-" (an empty string) becomes the default locale on a hit. */
const char *scr_icu_cache_lookup(int type, const char *locales);
/* A cacheable call that built its formatter (a miss) records the key. */
void scr_icu_cache_store(int type, const char *locales);
/* The RangeError message of a failed resolution. */
void scr_locale_error_message(int rc, const ScrLocRes *r, char *buf, size_t cap);
#endif
