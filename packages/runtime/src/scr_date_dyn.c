/* scr_date_dyn.c -- the checked-dynamic Date handle (SCR_DYNH_DATE).
 *
 * Linked only when a Date and an `unknown` meet in one program
 * (moduleUsesDateDyn): it carries the formatters (scr_date_fmt.c and the
 * generated zone-name table) because a dynamic receiver can name any of them. */
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

struct ScrDate { size_t rc; double ms; ScrDyn *props; }; /* mirrors scr_date.c's layout */
enum {
  SCR_DSET_MS, SCR_DSET_SEC, SCR_DSET_MIN, SCR_DSET_HOURS, SCR_DSET_DATE, SCR_DSET_MONTH, SCR_DSET_YEAR,
  SCR_DSET_UTC_MS, SCR_DSET_UTC_SEC, SCR_DSET_UTC_MIN, SCR_DSET_UTC_HOURS, SCR_DSET_UTC_DATE,
  SCR_DSET_UTC_MONTH, SCR_DSET_UTC_YEAR, SCR_DSET_TIME, SCR_DSET_YEAR2
};

/* toLocale{,Date,Time}String(locales, options) on a dynamic receiver: the locales and options are read from the
 * dynamic values by scr_date_locales_text / scr_date_format_opts_dyn (scr_date_intl.c). */
static ScrDyn *scr_date_dynh_locale_format(double ms, int kind, ScrDyn *const *args, size_t argc) {
  ScrStr *locale = scr_date_locales_text(argc > 0 ? args[0] : NULL);
  if (locale == NULL) return NULL;
  ScrStr *r = scr_date_format_opts_dyn(ms, (double)kind, locale, argc > 1 ? args[1] : NULL);
  scr_str_release(locale);
  if (r == NULL) return NULL;
  ScrDyn *out = scr_dyn_new_str(r);
  scr_str_release(r);
  return out;
}

/* ── the checked-dynamic Date handle (SCR_DYNH_DATE) ────────────────────
 * A Date crosses into the checked-dynamic tree BY REFERENCE: the box
 * retains the ScrDate, identity is the handle, and the setters mutate it in place,
 * which is what an alias must observe in JS too. The modeled
 * surface is exactly the one the static lowering serves: getTime/valueOf,
 * toISOString, toJSON, toString, the UTC and local field getters,
 * getDay/getUTCDay and getTimezoneOffset. The setters are modeled too; the remaining
 * formatters throw the loud not-supported ladder. */
static ScrDyn *scr_date_dynh_num(double v) { return scr_dyn_new_num(v); }

static ScrDyn *scr_date_dynh_invoke(void *h, ScrDyn *self, const char *method, ScrDyn *const *args, size_t argc,
                                    const char *what) {
  ScrDate *d = (ScrDate *)h;
  /* An own function member (`d.getMicroSeconds = function () { return this.usec; }`) shadows the
   * Date method of the same name, as an own property does in JS, and is called with the Date as `this`. */
  if (d->props != NULL) {
    ScrDyn *fn = scr_dyn_obj_own_data(d->props, method, strlen(method));
    if (fn != NULL && fn->kind == SCR_DYN_FUNC) {
      scr_dyn_retain(fn);
      scr_dyn_this_push_dyn(self);
      ScrDyn *r = scr_dyn_call(fn, args, argc, what);
      scr_dyn_this_pop();
      scr_dyn_release(fn);
      return r;
    }
  }
  double ms = d->ms;
  {
    static const struct { const char *name; int op; size_t max; } setters[] = {
        {"setMilliseconds", SCR_DSET_MS, 1}, {"setSeconds", SCR_DSET_SEC, 2}, {"setMinutes", SCR_DSET_MIN, 3},
        {"setHours", SCR_DSET_HOURS, 4}, {"setDate", SCR_DSET_DATE, 1}, {"setMonth", SCR_DSET_MONTH, 2},
        {"setFullYear", SCR_DSET_YEAR, 3}, {"setUTCMilliseconds", SCR_DSET_UTC_MS, 1},
        {"setUTCSeconds", SCR_DSET_UTC_SEC, 2}, {"setUTCMinutes", SCR_DSET_UTC_MIN, 3},
        {"setUTCHours", SCR_DSET_UTC_HOURS, 4}, {"setUTCDate", SCR_DSET_UTC_DATE, 1},
        {"setUTCMonth", SCR_DSET_UTC_MONTH, 2}, {"setUTCFullYear", SCR_DSET_UTC_YEAR, 3},
        {"setTime", SCR_DSET_TIME, 1}, {"setYear", SCR_DSET_YEAR2, 1},
    };
    for (size_t i = 0; i < sizeof setters / sizeof setters[0]; i++) {
      if (strcmp(method, setters[i].name) != 0) continue;
      double v[4] = {NAN, NAN, NAN, NAN};
      size_t n = argc < setters[i].max ? argc : setters[i].max;
      for (size_t k = 0; k < argc; k++) {
        double x = scr_dyn_to_number(args[k]); /* every argument is coerced, in order */
        if (k < n) v[k] = x;
      }
      if (argc == 0) n = 0;
      return scr_date_dynh_num(scr_date_set(d, setters[i].op, (double)n, v[0], v[1], v[2], v[3]));
    }
  }
  if (strcmp(method, "getTime") == 0 || strcmp(method, "valueOf") == 0) return scr_date_dynh_num(ms);
  if (strcmp(method, "getUTCFullYear") == 0) return scr_date_dynh_num(scr_date_utc_full_year(ms));
  if (strcmp(method, "getUTCMonth") == 0) return scr_date_dynh_num(scr_date_utc_month(ms));
  if (strcmp(method, "getUTCDate") == 0) return scr_date_dynh_num(scr_date_utc_date(ms));
  if (strcmp(method, "getUTCHours") == 0) return scr_date_dynh_num(scr_date_utc_hours(ms));
  if (strcmp(method, "getUTCMinutes") == 0) return scr_date_dynh_num(scr_date_utc_minutes(ms));
  if (strcmp(method, "getUTCSeconds") == 0) return scr_date_dynh_num(scr_date_utc_seconds(ms));
  if (strcmp(method, "getUTCMilliseconds") == 0) return scr_date_dynh_num(scr_date_utc_ms(ms));
  if (strcmp(method, "getUTCDay") == 0) return scr_date_dynh_num(scr_date_utc_day(ms));
  if (strcmp(method, "getTimezoneOffset") == 0) return scr_date_dynh_num(scr_date_tz_offset(ms));
  {
    double l = scr_date_local_time(ms);
    if (strcmp(method, "getFullYear") == 0) return scr_date_dynh_num(scr_date_utc_full_year(l));
    if (strcmp(method, "getMonth") == 0) return scr_date_dynh_num(scr_date_utc_month(l));
    if (strcmp(method, "getDate") == 0) return scr_date_dynh_num(scr_date_utc_date(l));
    if (strcmp(method, "getHours") == 0) return scr_date_dynh_num(scr_date_utc_hours(l));
    if (strcmp(method, "getMinutes") == 0) return scr_date_dynh_num(scr_date_utc_minutes(l));
    if (strcmp(method, "getSeconds") == 0) return scr_date_dynh_num(scr_date_utc_seconds(l));
    if (strcmp(method, "getMilliseconds") == 0) return scr_date_dynh_num(scr_date_utc_ms(l));
    if (strcmp(method, "getDay") == 0) return scr_date_dynh_num(scr_date_utc_day(l));
  }
  if (strcmp(method, "toISOString") == 0 || strcmp(method, "toJSON") == 0) {
    if (strcmp(method, "toJSON") == 0 && !(fabs(ms) <= 8640000000000000.0)) return scr_dyn_new_null();
    ScrStr *s = scr_date_to_iso(ms); /* +1, or NULL with RangeError pending */
    if (s == NULL) return NULL;
    ScrDyn *r = scr_dyn_new_str(s);
    scr_str_release(s);
    return r;
  }
  if (strcmp(method, "getYear") == 0) return scr_date_dynh_num(scr_date_utc_full_year(scr_date_local_time(ms)) - 1900.0);
  {
    static const struct { const char *name; int kind; int locale; } fmts[] = {
        {"toString", 0, 0}, {"toDateString", 1, 0}, {"toTimeString", 2, 0}, {"toUTCString", 3, 0},
        {"toGMTString", 3, 0}, {"toLocaleString", 4, 1}, {"toLocaleDateString", 5, 1},
        {"toLocaleTimeString", 6, 1},
    };
    for (size_t i = 0; i < sizeof fmts / sizeof fmts[0]; i++) {
      if (strcmp(method, fmts[i].name) != 0) continue;
      if (fmts[i].locale && argc > 0) return scr_date_dynh_locale_format(ms, fmts[i].kind, args, argc);
      ScrStr *s = scr_date_format(ms, (double)fmts[i].kind);
      ScrDyn *r = scr_dyn_new_str(s);
      scr_str_release(s);
      return r;
    }
  }
  {
    char msg[160];
    int n = snprintf(msg, sizeof msg, "%s is not a function", what);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  }
  return NULL;
}

/* Own data members: the expandos a JavaScript write put on this Date. A Date with none answers
 * NULL, and the caller answers undefined. */
static ScrDyn *scr_date_dynh_get(void *h, const char *key, size_t key_len) {
  ScrDate *d = (ScrDate *)h;
  if (d->props == NULL) return NULL;
  ScrDyn *m = scr_dyn_obj_own_data(d->props, key, key_len); /* borrowed */
  return m == NULL ? NULL : scr_dyn_retain(m);
}

/* `d.k = v` stores an own data member on the Date (the value is borrowed here, so the store retains it). */
static bool scr_date_dynh_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  ScrDate *d = (ScrDate *)h;
  if (d->props == NULL) d->props = scr_dyn_new_obj();
  scr_dyn_obj_set(d->props, key, key_len, scr_dyn_retain((ScrDyn *)value));
  return true;
}

/* The expando object (borrowed) for util.inspect; NULL while the Date has none. */
static ScrDyn *scr_date_dynh_own_props(void *h) { return ((ScrDate *)h)->props; }

static const ScrDynHandleOps scr_date_dynh_ops = {
    "Date", &scr_date_retain_v, &scr_date_release_v, &scr_date_dynh_invoke, &scr_date_dynh_get,
    &scr_date_dynh_set, NULL, &scr_date_dynh_own_props,
};

/* A time value from the engine (scr_island.c) boxed as a Date handle. */
static ScrDyn *scr_date_dyn_box(double ms) {
  ScrDate *d = scr_date_new(ms);
  ScrDyn *b = scr_dyn_new_handle(d, SCR_DYNH_DATE);
  scr_date_release(d);
  return b;
}

void scr_date_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_DATE, &scr_date_dynh_ops);
  scr_dyn_date_box_hook = scr_date_dyn_box;
}
