/* Intl.DateTimeFormat / Date.prototype.toLocale*String: V8's JSDateTimeFormat over ICU's pattern generator and
 * SimpleDateFormat (scr_dtpg.c, scr_dtfmt.c). */
#ifndef SCR_DTF_H
#define SCR_DTF_H
#include <stddef.h>

typedef struct { const char *key; const char *val; } DtfKV; /* val: a tag ('s' string, 'n' number, 'b' boolean, 'z' null, 'u' undefined) then the text */

typedef struct {
  int errKind;      /* 0 ok, 1 RangeError, 2 TypeError */
  char errMsg[400];
} DtfErr;

/* kind: 4 toLocaleString (any/all), 5 toLocaleDateString (date/date), 6 toLocaleTimeString (time/time), 7 Intl.DateTimeFormat (any/date).
 * Returns the malloc'ed UTF-8 result, or NULL with *err set. The caller has already answered an invalid time value. */
char *scr_dtf_format(const char *locales, const DtfKV *kv, int nkv, int kind, double ms, DtfErr *err);
#endif
