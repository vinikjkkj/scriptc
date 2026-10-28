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

/* ── fs.Stats as a checked-dynamic handle (SCR_DYNH_STATS) ────────────────
 * Node's Stats is an object whose fourteen fields are own enumerable data
 * properties (the expando object `props` holds them, in Node's order, then any
 * expando a program writes), whose four time members are accessors that cache
 * a Date on first read (scr_stats_date_of: the cache is shared with the static
 * reads, so identity holds across both), and whose is* predicates live on the
 * prototype. Object.keys, for-in, JSON and util.inspect walk the expando object,
 * so they see exactly Node's enumerable own keys: the cached Dates are not in it.
 * This unit links with the Date unit (dateDyn: a Stats program links both). */
static const char *const scr_stats_field_names[14] = {
    "dev", "mode", "nlink", "uid", "gid", "rdev", "blksize", "ino", "size", "blocks",
    "atimeMs", "mtimeMs", "ctimeMs", "birthtimeMs",
};
static const char *const scr_stats_date_names[5] = {NULL, "atime", "mtime", "ctime", "birthtime"};
enum { SCR_STATS_M_FILE, SCR_STATS_M_DIR, SCR_STATS_M_BLK, SCR_STATS_M_CHR, SCR_STATS_M_LNK,
       SCR_STATS_M_FIFO, SCR_STATS_M_SOCK, SCR_STATS_M_CHECK, SCR_STATS_M_COUNT };
static const char *const scr_stats_method_names[SCR_STATS_M_COUNT] = {
    "isFile", "isDirectory", "isBlockDevice", "isCharacterDevice", "isSymbolicLink", "isFIFO", "isSocket",
    "_checkModeProperty",
};
/* The type bits each predicate tests (S_IFMT's spelling), in SCR_STATS_M_ order. */
static const unsigned scr_stats_type_bits[SCR_STATS_M_CHECK] = {
    0100000, 040000, 060000, 020000, 0120000, 010000, 0140000,
};

static int scr_stats_field_index(const char *k, size_t n) {
  for (int i = 0; i < 14; i++) {
    if (strlen(scr_stats_field_names[i]) == n && memcmp(scr_stats_field_names[i], k, n) == 0) return i;
  }
  return -1;
}
static int scr_stats_date_index(const char *k, size_t n) {
  for (int i = 1; i <= 4; i++) {
    if (strlen(scr_stats_date_names[i]) == n && memcmp(scr_stats_date_names[i], k, n) == 0) return i;
  }
  return 0;
}
static int scr_stats_method_index(const char *k, size_t n) {
  for (int i = 0; i < SCR_STATS_M_COUNT; i++) {
    if (strlen(scr_stats_method_names[i]) == n && memcmp(scr_stats_method_names[i], k, n) == 0) return i;
  }
  return -1;
}

/* Node's own-property object, built on the first dynamic use from the current
 * fields (later static writes never happen: a Stats is read-only statically). */
static ScrDyn *scr_stats_members(ScrStats *s) {
  ScrDyn **pp = scr_stats_props_slot(s);
  if (*pp == NULL) {
    ScrDyn *o = scr_dyn_new_obj();
    for (int i = 0; i < 14; i++) {
      scr_dyn_obj_set(o, scr_stats_field_names[i], strlen(scr_stats_field_names[i]),
                      scr_dyn_new_num(*scr_stats_field_slot(s, i)));
    }
    *pp = o;
  }
  return *pp;
}

/* Node's Stats.prototype._checkModeProperty(property): the type bits against the
 * property, with the Windows exception for the three types it lacks. */
static bool scr_stats_check_mode(ScrStats *s, ScrDyn *const *args, size_t argc) {
  const ScrDyn *arg = argc > 0 ? args[0] : NULL;
  if (arg == NULL || arg->kind != SCR_DYN_NUM) return false;
#if defined(_WIN32)
  if (arg->v.num == 010000 || arg->v.num == 060000 || arg->v.num == 0140000) return false;
#endif
  return (double)((unsigned)scr_stats_field(s, 1) & 0170000) == arg->v.num;
}

static bool scr_stats_method_answer(ScrStats *s, int which, ScrDyn *const *args, size_t argc) {
  if (which == SCR_STATS_M_CHECK) return scr_stats_check_mode(s, args, argc);
  return (((unsigned)scr_stats_field(s, 1)) & 0170000) == scr_stats_type_bits[which];
}

static ScrDyn *scr_stats_dynh_invoke(void *h, ScrDyn *self, const char *method, ScrDyn *const *args, size_t argc,
                                     const char *what) {
  ScrStats *s = (ScrStats *)h;
  ScrDyn *own = scr_stats_members(s);
  ScrDyn *fn = scr_dyn_obj_own_data(own, method, strlen(method));
  if (fn != NULL && fn->kind == SCR_DYN_FUNC) {
    scr_dyn_retain(fn);
    scr_dyn_this_push_dyn(self);
    ScrDyn *r = scr_dyn_call(fn, args, argc, what);
    scr_dyn_this_pop();
    scr_dyn_release(fn);
    return r;
  }
  int which = scr_stats_method_index(method, strlen(method));
  if (which >= 0) return scr_dyn_new_bool(scr_stats_method_answer(s, which, args, argc));
  char msg[160];
  int n = snprintf(msg, sizeof msg, "%s is not a function", what);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  return NULL;
}

/* A method VALUE (`st.isFile`): one function object for every Stats, as Node's
 * prototype holds one. Its `this` is the box the call binds. */
static ScrDyn *scr_stats_this_answer(int which, ScrDyn *const *args, size_t argc) {
  ScrDyn *self = scr_dyn_this_get(); /* +1 */
  if (self == NULL || self->kind != SCR_DYN_HANDLE || self->v.handle.tag != SCR_DYNH_STATS) {
    if (self != NULL) scr_dyn_release(self);
    scr_throw_error_msg(SCR_ERR_TYPE, "Illegal invocation", 18);
    return NULL;
  }
  ScrDyn *r = scr_dyn_new_bool(scr_stats_method_answer((ScrStats *)self->v.handle.ptr, which, args, argc));
  scr_dyn_release(self);
  return r;
}

#define SCR_STATS_THUNK(idx)                                                                  \
  static ScrDyn *scr_stats_thunk_##idx(ScrClosure *clo, ScrDyn *const *args, size_t argc) { \
    (void)clo;                                                                             \
    return scr_stats_this_answer(idx, args, argc);                                         \
  }
SCR_STATS_THUNK(0)
SCR_STATS_THUNK(1)
SCR_STATS_THUNK(2)
SCR_STATS_THUNK(3)
SCR_STATS_THUNK(4)
SCR_STATS_THUNK(5)
SCR_STATS_THUNK(6)
SCR_STATS_THUNK(7)
static const ScrDynThunk scr_stats_thunks[SCR_STATS_M_COUNT] = {
    scr_stats_thunk_0, scr_stats_thunk_1, scr_stats_thunk_2, scr_stats_thunk_3,
    scr_stats_thunk_4, scr_stats_thunk_5, scr_stats_thunk_6, scr_stats_thunk_7,
};
/* The method values, minted once and kept (immortal), so `st.isFile === st.isFile`. */
static ScrDyn *scr_stats_method_fns[SCR_STATS_M_COUNT];
static ScrDyn *scr_stats_ctor_fn;
/* The singletons are the runtime's own roots: released at exit (before the RC
 * audit reads the heap), registered once on the first mint. */
static void scr_stats_fns_teardown(void) {
  for (int i = 0; i < SCR_STATS_M_COUNT; i++) {
    if (scr_stats_method_fns[i] != NULL) {
      scr_dyn_release(scr_stats_method_fns[i]);
      scr_stats_method_fns[i] = NULL;
    }
  }
  if (scr_stats_ctor_fn != NULL) {
    scr_dyn_release(scr_stats_ctor_fn);
    scr_stats_ctor_fn = NULL;
  }
}
static bool scr_stats_fns_registered;
static void scr_stats_fns_arm(void) {
  if (!scr_stats_fns_registered) {
    scr_stats_fns_registered = true;
    scr_atexit(scr_stats_fns_teardown);
  }
}
static ScrDyn *scr_stats_method_value(int which) {
  if (scr_stats_method_fns[which] == NULL) {
    scr_stats_fns_arm();
    ScrDynThunk thunk = scr_stats_thunks[which];
    scr_stats_method_fns[which] = scr_dyn_new_func(scr_closure_new((void *)thunk, 0), thunk,
                                                   which == SCR_STATS_M_CHECK ? 1 : 0, "()",
                                                   scr_stats_method_names[which]);
  }
  return scr_dyn_retain(scr_stats_method_fns[which]);
}

/* `new fs.Stats(...)`-shaped construction through the constructor value: the
 * fourteen fields by position, missing ones as 0. */
static ScrDyn *scr_stats_ctor_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  double f[14] = {0};
  for (size_t i = 0; i < argc && i < 14; i++) {
    f[i] = scr_dyn_to_number(args[i]);
  }
  ScrStats *s = scr_stats_from_fields(f);
  ScrDyn *b = scr_dyn_new_handle(s, SCR_DYNH_STATS);
  scr_stats_release(s);
  return b;
}
static ScrDyn *scr_stats_ctor_value(void) {
  if (scr_stats_ctor_fn == NULL) {
    scr_stats_fns_arm();
    scr_stats_ctor_fn = scr_dyn_new_func(scr_closure_new((void *)scr_stats_ctor_thunk, 0), scr_stats_ctor_thunk, 14,
                                         "()", "Stats");
  }
  return scr_dyn_retain(scr_stats_ctor_fn);
}

static ScrDyn *scr_stats_dynh_get(void *h, const char *key, size_t key_len) {
  ScrStats *s = (ScrStats *)h;
  ScrDyn *own = scr_stats_members(s);
  ScrDyn *m = scr_dyn_obj_own_data(own, key, key_len);
  if (m != NULL) return scr_dyn_retain(m);
  int dt = scr_stats_date_index(key, key_len);
  if (dt != 0 && *scr_stats_over_slot(s, dt) != NULL) return scr_dyn_retain(*scr_stats_over_slot(s, dt));
  if (dt != 0) {
    ScrDate *d = scr_stats_date_of(s, (double)dt); /* +1, the shared cache */
    ScrDyn *b = scr_dyn_new_handle(d, SCR_DYNH_DATE);
    scr_date_release_v(d);
    return b;
  }
  int which = scr_stats_method_index(key, key_len);
  if (which >= 0) return scr_stats_method_value(which);
  if (key_len == 11 && memcmp(key, "constructor", 11) == 0) return scr_stats_ctor_value();
  return NULL; /* not a Stats member: undefined, as Node answers */
}

/* `st.k = v`. A numeric field keeps its static slot and its own member in step; a
 * Date value to a time member replaces the cache (Node's setter defines the own
 * property with that value); anything else is an own expando. */
static bool scr_stats_dynh_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  ScrStats *s = (ScrStats *)h;
  ScrDyn *own = scr_stats_members(s);
  int fi = scr_stats_field_index(key, key_len);
  if (fi >= 0 && value->kind == SCR_DYN_NUM) *scr_stats_field_slot(s, fi) = value->v.num;
  int dt = scr_stats_date_index(key, key_len);
  if (dt != 0) {
    /* Node's setter: an own non-enumerable property holding the value. A Date value
     * also becomes the shared cache, so the static reads see it too. */
    ScrDyn **over = scr_stats_over_slot(s, dt);
    if (*over != NULL) scr_dyn_release(*over);
    *over = scr_dyn_retain((ScrDyn *)value);
    if (value->kind == SCR_DYN_HANDLE && value->v.handle.tag == SCR_DYNH_DATE) {
      scr_stats_cache_store(s, dt, scr_date_retain_v(value->v.handle.ptr), &scr_date_release_v);
    }
    return true;
  }
  scr_dyn_obj_set(own, key, key_len, scr_dyn_retain((ScrDyn *)value));
  return true;
}

static ScrDyn *scr_stats_dynh_own_props(void *h) { return scr_stats_members((ScrStats *)h); }

static const ScrDynHandleOps scr_stats_dynh_ops = {
    "Stats", &scr_stats_retain_v, &scr_stats_release_v, &scr_stats_dynh_invoke, &scr_stats_dynh_get,
    &scr_stats_dynh_set, NULL, &scr_stats_dynh_own_props,
};

/* for-in's inherited enumerable members of a Stats box, in Node's prototype
 * order: Stats.prototype (the time accessors, _checkModeProperty), then
 * StatsBase.prototype (the predicates). A time member its box has CACHED is an
 * own non-enumerable property there and shadows the inherited one, so it is not
 * visited. */
static const char *const scr_stats_inherited_enum[] = {
    "atime", "mtime", "ctime", "birthtime", "_checkModeProperty",
    "isDirectory", "isFile", "isBlockDevice", "isCharacterDevice", "isSymbolicLink", "isFIFO", "isSocket",
};
static void scr_stats_forin_extra(const ScrDyn *v, ScrDyn *out) {
  if (v->kind != SCR_DYN_HANDLE || v->v.handle.tag != SCR_DYNH_STATS) return;
  ScrStats *s = (ScrStats *)v->v.handle.ptr;
  for (size_t i = 0; i < sizeof scr_stats_inherited_enum / sizeof scr_stats_inherited_enum[0]; i++) {
    const char *name = scr_stats_inherited_enum[i];
    int dt = scr_stats_date_index(name, strlen(name));
    if (dt != 0 && (scr_stats_cache_get(s, dt) != NULL || *scr_stats_over_slot(s, dt) != NULL)) {
      continue; /* shadowed by the own (non-enumerable) cache or write */
    }
    scr_dyn_arr_push(out, scr_dyn_new_str(scr_str_new(name, strlen(name))));
  }
}

/* Object.hasOwn: a time member is an own property once cached or written. */
static bool scr_stats_own_extra(const ScrDyn *v, const char *key, size_t key_len) {
  if (v->v.handle.tag != SCR_DYNH_STATS) return false;
  int dt = scr_stats_date_index(key, key_len);
  if (dt == 0) return false;
  ScrStats *s = (ScrStats *)v->v.handle.ptr;
  return scr_stats_cache_get(s, dt) != NULL || *scr_stats_over_slot(s, dt) != NULL;
}

/* `k in st` / for-in's presence guard for the inherited members: a predicate or a
 * time accessor is present on every box (an own cache answers the same), and a
 * name Node's prototype does not have is not. */
static bool scr_stats_inherited_has(const ScrDyn *v, const char *key, size_t key_len) {
  if (v->v.handle.tag != SCR_DYNH_STATS) return false;
  for (size_t i = 0; i < sizeof scr_stats_inherited_enum / sizeof scr_stats_inherited_enum[0]; i++) {
    const char *name = scr_stats_inherited_enum[i];
    if (strlen(name) == key_len && memcmp(name, key, key_len) == 0) return true;
  }
  return false;
}

void scr_stats_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_STATS, &scr_stats_dynh_ops);
  scr_handle_forin_hook = scr_stats_forin_extra;
  scr_handle_inherited_has_hook = scr_stats_inherited_has;
  scr_handle_own_extra_hook = scr_stats_own_extra;
}

void scr_date_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_DATE, &scr_date_dynh_ops);
  scr_dyn_date_box_hook = scr_date_dyn_box;
  scr_stats_dyn_install();
}
