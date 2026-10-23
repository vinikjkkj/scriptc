/* scr_date_intl.c -- Date.prototype.toLocaleString / toLocaleDateString / toLocaleTimeString with a locale and
 * options, and Intl.DateTimeFormat#format: V8's JSDateTimeFormat over the ICU 78.2 locale data (scr_dtf.c,
 * scr_dtpg.c, scr_dtfmt.c, scr_cal.c, scr_dtz.c).
 *
 * The compiler (or the checked-dynamic invoke) hands the locales as one string ("" = the environment's default
 * locale, tags joined by ",") and the options as a string[] of alternating option name and TAGGED value: 's' a string,
 * 'n' a number, 'b' a boolean ("true" / "false"), 'z' null, 'u' undefined, then the text. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_dtf.h"
#include "scr_locale.h"
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
  const char *loc = locale != NULL ? locale->data : "";
  int cacheable = 0, ctype = kind == 4 ? SCR_ICUC_DATE_ALL : kind == 5 ? SCR_ICUC_DATE_DATE : SCR_ICUC_DATE_TIME;
  for (int i = 0; i < n; i++) if (strcmp(bag[i].key, SCR_ICU_CACHE_KEY) == 0) cacheable = kind >= 4 && kind <= 6;
  const char *eff = cacheable ? scr_icu_cache_lookup(ctype, loc) : loc;
  int invalid = !(fabs(ms) <= 8640000000000000.0); /* only Intl.DateTimeFormat#format gets here with one */
  double t = invalid ? 0 : trunc(ms);
  char *r = scr_dtf_format(eff, bag, n, kind, t == 0 ? 0 : t, &err);
  if (r != NULL && cacheable) scr_icu_cache_store(ctype, loc);
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

/* ── the checked-dynamic spellings: locales and options read from unknown / any values ─────────────────────────── */
static void date_kv_push(ScrArr *kv, const char *key, char tag, const char *text, size_t n) {
  scr_arr_push_ref(kv, scr_str_new(key, strlen(key)));
  char *b = (char *)malloc(n + 2);
  b[0] = tag;
  memcpy(b + 1, text, n);
  scr_arr_push_ref(kv, scr_str_new(b, n + 1));
  free(b);
}

/* The locales argument as text: "" for undefined, an empty list or a primitive (ToObject gives it no elements), tags
 * joined with "," otherwise ("-", which is not a structurally valid tag, for an empty one: V8 rejects it, it is not
 * the default locale). CanonicalizeLocaleList's element rules: a string, or an object converted with ToString;
 * anything else is a TypeError. +1 or NULL with the exception pending. */
ScrStr *scr_date_locales_text(const ScrDyn *l) {
  if (l == NULL || l->kind == SCR_DYN_UNDEF) return scr_str_new("", 0);
  if (l->kind == SCR_DYN_NULL) { scr_throw_error_msg(SCR_ERR_TYPE, "Cannot convert undefined or null to object", 42); return NULL; }
  if (l->kind == SCR_DYN_STR) return l->v.str->len == 0 ? scr_str_new("-", 1) : scr_str_retain(l->v.str);
  size_t n = 0;
  const ScrDyn *const *items = NULL;
  ScrDyn **owned = NULL;
  if (l->kind == SCR_DYN_ARR) { n = l->v.arr.len; items = (const ScrDyn *const *)l->v.arr.items; }
  else if (l->kind == SCR_DYN_OBJ) { /* an array-like: its length and index properties */
    const ScrDyn *len = scr_dyn_obj_get(l, "length", 6);
    if (len != NULL && len->kind == SCR_DYN_NUM && len->v.num >= 1) {
      n = len->v.num > 1000000 ? 1000000 : (size_t)len->v.num;
      owned = (ScrDyn **)calloc(n, sizeof(ScrDyn *));
      for (size_t i = 0; i < n; i++) { char k[24]; int kl = snprintf(k, sizeof k, "%zu", i); owned[i] = (ScrDyn *)scr_dyn_obj_get(l, k, (size_t)kl); }
      items = (const ScrDyn *const *)owned;
    }
  }
  if (n == 0) { free(owned); return scr_str_new("", 0); }
  size_t cap = 64, len = 0;
  char *b = (char *)malloc(cap);
  for (size_t i = 0; i < n; i++) {
    const ScrDyn *e = items[i];
    ScrStr *t = NULL;
    if (e != NULL && e->kind == SCR_DYN_STR) t = scr_str_retain(e->v.str);
    else if (e == NULL || e->kind == SCR_DYN_UNDEF || e->kind == SCR_DYN_NULL || e->kind == SCR_DYN_NUM || e->kind == SCR_DYN_BOOL || e->kind == SCR_DYN_BIG) {
      free(b); free(owned);
      scr_throw_error_msg(SCR_ERR_TYPE, "Language ID should be string or object.", 38);
      return NULL;
    } else {
      t = scr_dyn_string_coerce_js(e);
      if (t == NULL) { free(b); free(owned); return NULL; }
    }
    while (len + t->len + 3 > cap) { cap *= 2; b = (char *)realloc(b, cap); }
    if (i) b[len++] = ',';
    if (t->len == 0) { b[len++] = '-'; b[len++] = '-'; } /* "--": not the cache key "-" of an empty string */
    memcpy(b + len, t->data, t->len);
    len += t->len;
    scr_str_release(t);
  }
  free(owned);
  ScrStr *r = scr_str_new(b, len);
  free(b);
  return r;
}

/* toLocale{,Date,Time}String / Intl.DateTimeFormat#format with the options as a dynamic value: an object's own
 * option properties become the tagged bag ('s' string, 'n' number, 'b' boolean, 'z' null; undefined is absent); a
 * number, string or boolean has none (ToObject); null throws. +1, or NULL with the exception pending. */
ScrStr *scr_date_format_opts_dyn(double ms, double kind_d, ScrStr *locale, const ScrDyn *opts) {
  static const char *const keys[] = {"localeMatcher", "calendar", "numberingSystem", "hour12", "hourCycle",
                                     "timeZone", "weekday", "era", "year", "month", "day", "dayPeriod", "hour",
                                     "minute", "second", "fractionalSecondDigits", "timeZoneName",
                                     "formatMatcher", "dateStyle", "timeStyle", NULL};
  int kind = (int)kind_d;
  if (opts != NULL && opts->kind == SCR_DYN_NULL) {
    /* the locales are canonicalized before the options are coerced to an object: a bad locale wins */
    ScrArr *none = scr_arr_new(SCR_ELEM_STR, 0);
    ScrStr *probe = scr_date_format_opts(ms, kind_d, locale, none);
    scr_arr_release(none);
    if (probe == NULL) return NULL;
    scr_str_release(probe);
    static const char *const names[] = {"Date.prototype.toLocaleString", "Date.prototype.toLocaleDateString", "Date.prototype.toLocaleTimeString", "Intl.DateTimeFormat"};
    char msg[160];
    int n = snprintf(msg, sizeof msg, "%s called on null or undefined", names[kind - 4]);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
    return NULL;
  }
  ScrArr *kv = scr_arr_new(SCR_ELEM_STR, 16);
  if (opts == NULL || opts->kind == SCR_DYN_UNDEF) date_kv_push(kv, SCR_ICU_CACHE_KEY, 'u', "", 0);
  if (opts != NULL && opts->kind == SCR_DYN_OBJ) {
    for (size_t i = 0; keys[i]; i++) {
      const ScrDyn *v = scr_dyn_obj_get(opts, keys[i], strlen(keys[i]));
      if (v == NULL || v->kind == SCR_DYN_UNDEF) continue;
      char num[40];
      switch (v->kind) {
        case SCR_DYN_STR: date_kv_push(kv, keys[i], 's', v->v.str->data, v->v.str->len); break;
        case SCR_DYN_NUM: { size_t n = scr_f64_to_str(v->v.num, num); date_kv_push(kv, keys[i], 'n', num, n); break; }
        case SCR_DYN_BOOL: date_kv_push(kv, keys[i], 'b', v->v.b ? "true" : "false", v->v.b ? 4 : 5); break;
        case SCR_DYN_NULL: date_kv_push(kv, keys[i], 'z', "", 0); break;
        default: {
          ScrStr *t = scr_dyn_string_coerce_js(v);
          if (t == NULL) { scr_arr_release(kv); return NULL; }
          date_kv_push(kv, keys[i], 's', t->data, t->len);
          scr_str_release(t);
        }
      }
    }
  }
  ScrStr *r = scr_date_format_opts(ms, kind_d, locale, kv);
  scr_arr_release(kv);
  return r;
}
