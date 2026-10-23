/* scr_date_intl.c -- Date.prototype.toLocaleString / toLocaleDateString / toLocaleTimeString with a locale and
 * options, and Intl.DateTimeFormat#format: V8's JSDateTimeFormat over the ICU 78.2 locale data (scr_dtf.c,
 * scr_dtpg.c, scr_dtfmt.c, scr_cal.c, scr_dtz.c).
 *
 * The compiler (or the checked-dynamic invoke) hands the locales as one string ("" = the environment's default
 * locale, tags joined by ",") and the options as a string[] of alternating option name and TAGGED value: 's' a string,
 * 'n' a number, 'b' a boolean ("true" / "false"), 'z' null, 'u' undefined, then the text. */
#include <math.h>
#include <stdlib.h>
#include <string.h>

#include "scr_dtf.h"
#include "scr_runtime.h"

#define MAXKV 64

/* kind 4 / 5 / 6: toLocale{,Date,Time}String; 7: Intl.DateTimeFormat#format. +1, or NULL with a pending exception. */
ScrStr *scr_date_format_opts(double ms, double kind_d, ScrStr *locale, ScrArr *kv) {
  int kind = (int)kind_d;
  /* Date.prototype.toLocaleString: an invalid Date answers "Invalid Date" BEFORE the options are read, so a bad
   * option on an invalid Date is not an error. (Intl.DateTimeFormat#format throws "Invalid time value" instead.) */
  if (!(fabs(ms) <= 8640000000000000.0) && kind != 7) return scr_str_new("Invalid Date", 12);
  DtfKV bag[MAXKV];
  int n = 0;
  if (kv != NULL) {
    ScrStr **d = (ScrStr **)kv->data;
    for (size_t i = 0; i + 1 < kv->len && n < MAXKV; i += 2) { bag[n].key = d[i]->data; bag[n].val = d[i + 1]->data; n++; }
  }
  DtfErr err;
  memset(&err, 0, sizeof err);
  int invalid = !(fabs(ms) <= 8640000000000000.0); /* only Intl.DateTimeFormat#format gets here with one */
  double t = invalid ? 0 : trunc(ms);
  char *r = scr_dtf_format(locale != NULL ? locale->data : "", bag, n, kind, t == 0 ? 0 : t, &err);
  if (r != NULL && invalid) { /* the formatter was built (its options are valid); formatting the time value throws */
    free(r);
    scr_throw_error_msg(SCR_ERR_RANGE, "Invalid time value", 18);
    return NULL;
  }
  if (r == NULL) {
    scr_throw_error_msg(err.errKind == 2 ? SCR_ERR_TYPE : SCR_ERR_RANGE, err.errMsg, strlen(err.errMsg));
    return NULL;
  }
  ScrStr *s = scr_str_new(r, strlen(r));
  free(r);
  return s;
}
