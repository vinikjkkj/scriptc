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
} ScrLocRes;

/* 0 on success (out holds the canonical tag); -1 when `in` is not a structurally valid language tag. */
int scr_locale_canonicalize(const char *in, size_t n, char *out, size_t cap);
/* `locales` is "" (default locale) or one or more canonicalizable tags separated by ','. -1 for an invalid tag. */
int scr_locale_resolve(int service, const char *locales, ScrLocRes *r);
#endif
