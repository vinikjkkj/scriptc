/* scr_date.c — the Date handle's ownership pair.
 *
 * A TYPE WITH VALUES as of the Date-value slice.  It was not always: this
 * file opened for most of its life with "A TYPE WITH NO VALUES, exactly
 * like ScrRequest in scr_fetch_static.c", and the paragraphs below it
 * still explain why the type was declared before anything could build one.
 * Nothing in this runtime allocates a ScrDate and nothing in the compiler
 * emits a construction: `new Date(...)` as a VALUE is a refusal
 * (lower-builtins.ts's Date slice lowers only `Date.now()`, `Date.UTC()`
 * and the COMPOSED `new Date(ms?).getTime()` / `.toISOString()`), and every
 * MEMBER refuses through surfaces.ts's stdlibMemberFence.
 *
 * WHY THE TYPE EXISTS ANYWAY. A record whose member is typed `Date` had no
 * representation at all, so the RECORD TYPE reported SC2009 — a type-level
 * stop that `--best-effort` cannot defer. zapo voip's
 * `call/call-state.ts:10` is the measured case:
 *
 *     export interface CallStateData {
 *         state: CallState
 *         connectedAt?: Date
 *         acceptedAt?: Date
 *         endedAt?: Date
 *         ...
 *     }
 *
 * and that one member was the single remaining error between voip's
 * package entry and a binary under `--provenance-sources --best-effort`.
 *
 * WHY A HANDLE AND NOT THE f64 EPOCH IT WOULD FIT IN. Two answers a scalar
 * would get silently wrong, both observable:
 *
 *   - `new Date(0)` is TRUTHY in JS. A scalar 0 is not. zapo writes
 *     `if (s.connectedAt)` and `connectedAt ? … : undefined`.
 *   - two distinct Dates with equal milliseconds are `!==`. Two equal f64s
 *     are `===`.
 *
 * A pointer answers both the way node does, and the always-truthy set in
 * ir/nodes.ts is what carries the first.
 *
 * These four functions keep the ownership machinery (record fields, union
 * arms, boxes, array elements) uniform for the kind. They are dead code in
 * every program that links this file: the pointer is always NULL, so every
 * one of them takes its NULL branch. Deliberately NOT a cycle-headered
 * allocation — there is nothing to allocate.
 *
 * The unit is behind a LINK GATE (moduleUsesDate on the IR), so a program
 * with no Date-typed value never compiles it — and it now carries one
 * FUNCTION as well as the ownership pair, for exactly that reason. See the
 * getHours section at the bottom. */

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

struct ScrDate {
  size_t rc;
  /* ECMA-262's [[DateValue]]: an INTEGRAL number of milliseconds since
   * the epoch, or NaN for an invalid Date.  TimeClip runs once, at
   * construction, so every member read below is pure. */
  double ms;
  /* The own data members a JavaScript expando wrote onto this Date (`d.usec = 7`):
   * a dyn object, created by the first write and NULL until then. The dyn handle
   * (scr_date_dyn.c) reads and writes it; the static Date never does. */
  ScrDyn *props;
};

/* -- THE VALUE, AND WHY IT IS STILL A HANDLE --------------------------
 *
 * This file's header used to say nothing allocates a ScrDate.  Something
 * does now, and the two objections that header raised against a bare f64
 * are MET rather than avoided -- by the pointer, not by the payload:
 *
 *   - `new Date(0)` is TRUTHY in JS.  A non-NULL pointer is truthy, and
 *     the `date` kind sits in the IR's always-truthy set.
 *   - two distinct Dates with equal milliseconds are `!==`.  Two
 *     allocations are two addresses.
 *
 * Deliberately still NOT cycle-headered.  A Date holds one double and no
 * outward edge, so it cannot be part of a cycle; ir/nodes.ts already
 * classifies the kind as pure balance for exactly that reason.  The
 * retain/release pair below is UNCHANGED: it was always correct code
 * that happened to be dead, and the only thing that changed is that rc
 * now starts at 1. */

/* TimeClip (ECMA-262 21.4.1.31): non-finite or |t| > 8.64e15 is NaN;
 * otherwise truncate toward zero, with -0 normalised to +0. */
static double scr_date_time_clip(double ms) {
  if (!(fabs(ms) <= 8640000000000000.0)) return NAN;
  double t = trunc(ms);
  return t == 0 ? 0 : t;
}

ScrDate *scr_date_new(double ms) {
  ScrDate *d = (ScrDate *)malloc(sizeof *d);
  if (d == NULL) scr_trap("scriptc: out of memory\n");
  d->rc = 1;
  d->ms = scr_date_time_clip(ms);
  d->props = NULL;
  return d;
}

/* new Date(dateString).  The grammar is NOT widened here: this is the
 * same bounded parse scr_date_parse_get_time already ships for the
 * composed form, so the value form and the composed form cannot drift
 * apart.  An unparseable string yields NaN -- an invalid Date, exactly
 * as in Node.  The string is BORROWED (the scr_url_new convention). */
ScrDate *scr_date_new_str(ScrStr *s) {
  return scr_date_new(scr_date_parse_get_time(s));
}

/* getTime() / valueOf(), and the milliseconds every UTC getter below
 * reads.  Borrowed receiver. */
double scr_date_value(ScrDate *d) { return d->ms; }

/* -- THE UTC FIELD READS ----------------------------------------------
 *
 * Each one is YearFromTime/MonthFromTime/HourFromTime/... of the time
 * value itself -- pure arithmetic over the double, with NO host state of
 * any kind.  That is the whole reason this family lowers and the LOCAL
 * family does not: these answers cannot depend on the machine that runs
 * the binary.
 *
 * The walk is scr_date_to_iso's, factored out so the ISO string and the
 * seven getters cannot disagree about a civil date.  An out-of-range or
 * NaN time value answers NaN from every getter, which is what Node
 * answers on an invalid Date. */
typedef struct {
  long long y;
  int mo; /* 0..11, as getUTCMonth answers */
  int d;  /* 1..31 */
  int h, mi, s, ms;
} ScrDateParts;

static int scr_date_parts(double ms, ScrDateParts *out) {
  /* NaN and out of range.  The bound is one day wider than Date's own:
   * LocalTime(t) = t + offset legitimately lands up to ~14 h past
   * +-8.64e15 for a clipped t near the edge, and V8 still answers its
   * local fields there.  A UTC read can never see such a value, because
   * TimeClip already ran at construction. */
  if (!(fabs(ms) <= 8640000000000000.0 + 86400000.0)) return 0;
  double t = trunc(ms);
  double dayd = floor(t / 86400000.0);
  long long msday = (long long)(t - dayd * 86400000.0);
  long long z = (long long)dayd + 719468;
  long long era = (z >= 0 ? z : z - 146096) / 146097;
  unsigned long long doe = (unsigned long long)(z - era * 146097);
  unsigned long long yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
  long long y = (long long)yoe + era * 400;
  unsigned long long doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
  unsigned long long mp = (5 * doy + 2) / 153;
  unsigned long long dd = doy - (153 * mp + 2) / 5 + 1;
  unsigned long long m = mp < 10 ? mp + 3 : mp - 9;
  if (m <= 2) y += 1;
  out->y = y;
  out->mo = (int)m - 1;
  out->d = (int)dd;
  out->h = (int)(msday / 3600000);
  out->mi = (int)(msday / 60000 % 60);
  out->s = (int)(msday / 1000 % 60);
  out->ms = (int)(msday % 1000);
  return 1;
}

double scr_date_utc_full_year(double ms) { ScrDateParts p; return scr_date_parts(ms, &p) ? (double)p.y : NAN; }
double scr_date_utc_month(double ms) { ScrDateParts p; return scr_date_parts(ms, &p) ? (double)p.mo : NAN; }
double scr_date_utc_date(double ms) { ScrDateParts p; return scr_date_parts(ms, &p) ? (double)p.d : NAN; }
double scr_date_utc_hours(double ms) { ScrDateParts p; return scr_date_parts(ms, &p) ? (double)p.h : NAN; }
double scr_date_utc_minutes(double ms) { ScrDateParts p; return scr_date_parts(ms, &p) ? (double)p.mi : NAN; }
double scr_date_utc_seconds(double ms) { ScrDateParts p; return scr_date_parts(ms, &p) ? (double)p.s : NAN; }
double scr_date_utc_ms(double ms) { ScrDateParts p; return scr_date_parts(ms, &p) ? (double)p.ms : NAN; }

ScrDate *scr_date_retain(ScrDate *d) {
  if (d != NULL && d->rc != SIZE_MAX) d->rc++;
  return d;
}

void scr_date_release(ScrDate *d) {
  if (d == NULL || d->rc == SIZE_MAX) return;
  if (--d->rc == 0) {
    if (d->props != NULL) scr_dyn_release(d->props);
    free(d);
  }
}

void *scr_date_retain_v(void *p) { return scr_date_retain((ScrDate *)p); }
void scr_date_release_v(void *p) { scr_date_release((ScrDate *)p); }

/* ── WHY THE LOCAL-TIME READS LIVE HERE AND NOT IN scr_lib.c ───────────
 *
 * Every other Date entry point (scr_date_now, scr_date_to_iso,
 * scr_date_utc, scr_date_parse_get_time) sits in scr_lib.c, which is
 * ALWAYS linked. The local reads do not: they need the zone database
 * (scr_date_tz.c) and must not make a program that never reads a local
 * hour pay for one (tests/harness/size-class.ts pins the hello-world
 * class). The gate is moduleUsesDate on the IR, which must see the CALL
 * and not only the type.
 *
 * The civil-days helper is duplicated from scr_lib.c's
 * scr_days_from_civil rather than shared, and that is deliberate: making
 * the original non-static changes codegen in the always-linked TU, which
 * is the one thing this move exists to avoid.
 */

/* Howard Hinnant's days_from_civil (see scr_lib.c's copy). */
static double scr_date_days_from_civil_local(long long y, int m, int d) {
  y -= m <= 2;
  long long era = (y >= 0 ? y : y - 399) / 400;
  unsigned long long yoe = (unsigned long long)(y - era * 400);
  unsigned long long doy = (unsigned long long)((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1);
  unsigned long long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (double)(era * 146097 + (long long)doe - 719468);
}

/* ── the LOCAL-time reads ───────────────────────────────────────────────
 *
 * Every other Date entry point above is UTC and therefore a pure function
 * of its milliseconds. Local time is not: HourFromTime(LocalTime(t)) needs
 * LocalTZA(t), the offset the zone had at THAT INSTANT, which moves with
 * DST and with historical zone changes, so it is a table lookup. */
/* LocalTZA for the instant `t` (an integral, in-range time value): the milliseconds
 * LocalTime(t) - t, from the bundled zone database (scr_date_tz.c), which replays Node's own
 * ICU offsets on every platform: no libc localtime, no Windows registry history, and no
 * dependence on the host's tzdata release. A program with no local-time use links
 * scr_date_tz_stub.c instead (the call cannot be reached). */
int scr_tz_host_tza(double t_ms, double *out_ms);
static int scr_date_tza(double t, double *out) { return scr_tz_host_tza(t, out); }

/* LocalTime(t) as a time value (t + LocalTZA), NaN when t is NaN/out of
 * range or the platform declines the instant.  The local field getters are
 * the UTC getters applied to this. */
double scr_date_local_time(double ms) {
  if (!(fabs(ms) <= 8640000000000000.0)) return NAN;
  double t = trunc(ms);
  double tza;
  if (!scr_date_tza(t, &tza)) return NAN;
  return t + tza;
}

/* getTimezoneOffset(): (t - LocalTime(t)) / 60000 truncated toward zero --
 * V8 answers whole minutes even for a sub-minute historical (LMT) offset
 * (Sao_Paulo before 1914: 186, not 186.4666...). */
double scr_date_tz_offset(double ms) {
  if (!(fabs(ms) <= 8640000000000000.0)) return NAN;
  double t = trunc(ms);
  double tza;
  if (!scr_date_tza(t, &tza)) return NAN;
  double r = trunc(-tza / 60000.0);
  return r == 0 ? 0 : r;
}

/* getUTCDay()/getDay() weekday of a time value, 0 = Sunday. */
double scr_date_utc_day(double ms) {
  if (!(fabs(ms) <= 8640000000000000.0 + 86400000.0)) return NAN;
  double days = floor(trunc(ms) / 86400000.0);
  double w = fmod(days + 4.0, 7.0);
  if (w < 0) w += 7.0;
  return w;
}

double scr_date_get_hours(double ms) {
  double l = scr_date_local_time(ms);
  return scr_date_utc_hours(l);
}

/* ── the Date component constructor and every setter ────────────────────
 * ECMA-262 21.4.1 MakeTime/MakeDay/MakeDate over already-number arguments
 * (tsc pins them), V8's bounds (|year| <= 1e6, |month| <= 1e7 before the
 * roll), and UTC(t): the INVERSE of LocalTime, which is where wall clocks
 * stop being a function.
 *
 * UTC(tl) asks for the instant whose local reading is tl.  Across a
 * spring-forward the reading does not exist (no instant answers) and across
 * a fall-back it exists twice.  The spec's rule for both is "use the offset
 * BEFORE the transition": a nonexistent reading is interpreted with the
 * earlier offset (so it lands after the gap), an ambiguous one resolves to
 * the earlier instant.  Offsets come from scr_date_tza one day either side
 * of tl, the candidates are validated by asking the zone about the
 * candidate itself, and the smallest valid candidate wins -- so the answer
 * rests on the same per-instant source as every getter, never on mktime. */
static double scr_date_make_time(double h, double mi, double s, double ms) {
  if (!isfinite(h) || !isfinite(mi) || !isfinite(s) || !isfinite(ms)) return NAN;
  return ((trunc(h) * 60.0 + trunc(mi)) * 60.0 + trunc(s)) * 1000.0 + trunc(ms);
}

static double scr_date_make_day(double y, double mo, double d) {
  if (!isfinite(y) || !isfinite(mo) || !isfinite(d)) return NAN;
  y = trunc(y);
  mo = trunc(mo);
  d = trunc(d);
  if (y < -1000000.0 || y > 1000000.0 || mo < -10000000.0 || mo > 10000000.0) return NAN;
  double ym = y + floor(mo / 12.0);
  int mn = (int)(mo - floor(mo / 12.0) * 12.0);
  if (fabs(ym) > 1000000.0) return NAN;
  return scr_date_days_from_civil_local((long long)ym, mn + 1, 1) + (d - 1.0);
}

static double scr_date_make_date(double day, double time) {
  if (!isfinite(day) || !isfinite(time)) return NAN;
  double tv = day * 86400000.0 + time;
  return isfinite(tv) ? tv : NAN;
}

static double scr_date_local_to_utc(double tl) {
  if (!isfinite(tl)) return NAN;
  double o1, o2;
  if (!scr_date_tza(tl - 86400000.0, &o1)) return NAN;
  if (!scr_date_tza(tl + 86400000.0, &o2)) return NAN;
  double u1 = tl - o1;
  if (o1 == o2) return u1;
  double u2 = tl - o2, chk;
  int v1 = scr_date_tza(u1, &chk) && chk == o1;
  int v2 = scr_date_tza(u2, &chk) && chk == o2;
  if (v1 && v2) return u1 < u2 ? u1 : u2;
  if (v1) return u1;
  if (v2) return u2;
  return u1;
}

/* new Date(y, mo, d, h, mi, s, ms): the 2-digit-year rule, then local time. */
ScrDate *scr_date_new_parts(double y, double mo, double d, double h, double mi, double s, double ms) {
  double yr = y;
  if (!isnan(y)) {
    double yi = trunc(y);
    if (yi >= 0 && yi <= 99) yr = 1900.0 + yi;
  }
  double fd = scr_date_make_date(scr_date_make_day(yr, mo, d), scr_date_make_time(h, mi, s, ms));
  return scr_date_new(scr_date_local_to_utc(fd));
}

/* Setter opcodes: the compiler's date.set literal and the dyn handle share
 * this table. */
enum {
  SCR_DSET_MS, SCR_DSET_SEC, SCR_DSET_MIN, SCR_DSET_HOURS, SCR_DSET_DATE, SCR_DSET_MONTH, SCR_DSET_YEAR,
  SCR_DSET_UTC_MS, SCR_DSET_UTC_SEC, SCR_DSET_UTC_MIN, SCR_DSET_UTC_HOURS, SCR_DSET_UTC_DATE,
  SCR_DSET_UTC_MONTH, SCR_DSET_UTC_YEAR, SCR_DSET_TIME, SCR_DSET_YEAR2
};

double scr_date_set(ScrDate *dt, double op_d, double argc_d, double a0, double a1, double a2, double a3) {
  int op = (int)op_d, argc = (int)argc_d;
  double a[4] = {a0, a1, a2, a3};
  double t = dt->ms;
  if (op == SCR_DSET_TIME) {
    dt->ms = scr_date_time_clip(a0);
    return dt->ms;
  }
  int utc = op >= SCR_DSET_UTC_MS && op <= SCR_DSET_UTC_YEAR;
  int kind = utc ? op - SCR_DSET_UTC_MS : op; /* 0..6 field family */
  if (op == SCR_DSET_YEAR2) kind = 6;
  if (isnan(t)) {
    if (kind != 6) return NAN; /* every setter but the year ones leaves NaN */
    t = 0;
  } else if (!utc) {
    t = scr_date_local_time(t);
    if (isnan(t)) return NAN;
  }
  ScrDateParts p;
  if (!scr_date_parts(t, &p)) return NAN;
  double day = floor(t / 86400000.0);
  double within = t - day * 86400000.0;
  double Y = (double)p.y, M = (double)p.mo, D = (double)p.d, H = (double)p.h, MI = (double)p.mi,
         S = (double)p.s, MS = (double)p.ms;
  double nd, nt;
  switch (kind) {
  case 0: /* ms */
    nd = day; nt = scr_date_make_time(H, MI, S, a[0]); break;
  case 1: /* sec [, ms] */
    nd = day; nt = scr_date_make_time(H, MI, a[0], argc > 1 ? a[1] : MS); break;
  case 2: /* min [, sec [, ms]] */
    nd = day; nt = scr_date_make_time(H, a[0], argc > 1 ? a[1] : S, argc > 2 ? a[2] : MS); break;
  case 3: /* hours [, min [, sec [, ms]]] */
    nd = day;
    nt = scr_date_make_time(a[0], argc > 1 ? a[1] : MI, argc > 2 ? a[2] : S, argc > 3 ? a[3] : MS);
    break;
  case 4: /* date */
    nd = scr_date_make_day(Y, M, a[0]); nt = within; break;
  case 5: /* month [, date] */
    nd = scr_date_make_day(Y, a[0], argc > 1 ? a[1] : D); nt = within; break;
  default: { /* year [, month [, date]]; setYear: the 2-digit rule */
    double y = a[0];
    if (op == SCR_DSET_YEAR2) {
      if (isnan(y)) { dt->ms = NAN; return NAN; }
      double yi = trunc(y);
      if (yi >= 0 && yi <= 99) y = 1900.0 + yi;
    }
    nd = scr_date_make_day(y, argc > 1 ? a[1] : M, argc > 2 ? a[2] : D); nt = within; break;
  }
  }
  double nv = scr_date_make_date(nd, nt);
  double u = utc ? nv : scr_date_local_to_utc(nv);
  dt->ms = scr_date_time_clip(u);
  return dt->ms;
}

/* Date.prototype.toString and the other formatters live in scr_date_fmt.c
 * (with the generated zone-name table), linked only by programs that use
 * them: see moduleUsesDateFmt. This file exports the arithmetic they read. */
int scr_date_civil(double local_ms, long long *y, int *mo, int *d, int *h, int *mi, int *sec, int *wd) {
  ScrDateParts p;
  if (!scr_date_parts(local_ms, &p)) return 0;
  *y = p.y; *mo = p.mo; *d = p.d; *h = p.h; *mi = p.mi; *sec = p.s;
  *wd = (int)scr_date_utc_day(local_ms);
  return 1;
}
int scr_date_tza_at(double t, double *out) { return scr_date_tza(t, out); }

/* util.inspect / console.log of a Date: the ISO form (toISOString), or
 * `Invalid Date` for NaN. Node colors it only on a TTY, like every other
 * leaf, and this runtime never colors (scr_inspect.c). */
ScrStr *scr_insp_date(ScrDate *d) {
  if (d->ms != d->ms) return scr_str_new("Invalid Date", 12);
  return scr_date_to_iso(d->ms);
}

/* JSON.stringify of a Date: Date.prototype.toJSON, the quoted ISO string,
 * or `null` for an invalid Date. An ISO string needs no escaping. */
void scr_jb_put_date(ScrJsonBuf *b, ScrDate *d) {
  if (d->ms != d->ms) {
    scr_jb_puts(b, "null");
    return;
  }
  ScrStr *s = scr_date_to_iso(d->ms);
  scr_jb_putc(b, '"');
  scr_jb_write(b, s->data, s->len);
  scr_jb_putc(b, '"');
  scr_str_release(s);
}

/* fs.Stats' Date members (which: 1 atime, 2 mtime, 3 ctime, 4 birthtime). Node's
 * getter caches the Date on the first read, so every later read — static or boxed
 * — answers the same object; the cache is the snapshot's (scr_lib.c). Built from the
 * rounded millisecond field (Node's dateFromMs). +1. */
ScrDate *scr_stats_date_of(ScrStats *s, double idx) {
  const int which = (int)idx; /* 1..4: atime, mtime, ctime, birthtime (the static index is a number) */
  ScrDate *d = (ScrDate *)scr_stats_cache_get(s, which);
  if (d == NULL) {
    /* atime..birthtime are the raw ms fields 10..13 (index 9 + which), rounded. */
    d = scr_date_new(floor(scr_stats_field(s, 9.0 + (double)which) + 0.5));
    scr_stats_cache_store(s, which, d, &scr_date_release_v);
  }
  return (ScrDate *)scr_date_retain_v(d);
}
