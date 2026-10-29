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

#include <limits.h>
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
 * same parser scr_date_parse_get_time is for the composed form, so the
 * value form and the composed form cannot drift apart.  An unparseable
 * string yields NaN -- an invalid Date, exactly as in Node.  The string
 * is BORROWED (the scr_url_new convention). */
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

/* ── the date-string parser (new Date(string), Date.parse, composed getTime) ─────────
 * It lives HERE, in the Date unit, not in scr_lib.c: its local-time arm needs the zone table, which
 * only the Date unit links (scr_date_tz.c or the stub). The date.parseGetTime libCall sets the Date
 * gate, so every program that can reach the parser links this unit. */
/* Howard Hinnant's days_from_civil (scr_lib.c keeps its own copy for scr_date_utc).
 * A static copy here: the parser must not reach into the always-linked TU. */
static double sp_days_from_civil(long long y, int m, int d) {
  y -= m <= 2;
  long long era = (y >= 0 ? y : y - 399) / 400;
  unsigned long long yoe = (unsigned long long)(y - era * 400);
  unsigned long long doy = (unsigned long long)((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5 + d - 1);
  unsigned long long doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
  return (double)(era * 146097 + (long long)doe - 719468);
}

/* LocalTZA of the instant t: the zone table (scr_date_tz.c), or the stub when the program
 * has no local-time date op (moduleUsesDateTz gates it; a date.parseGetTime call sets it). */
int scr_tz_host_tza(double t_ms, double *out_ms);

/* UTC(tl) for a local time value tl: the spec's disambiguation (an ambiguous
 * local time takes the earlier instant, a skipped one the offset before the
 * transition). NaN when the zone cannot answer. The one copy: new Date(y, m,
 * d, ...) and the local date-time strings below both call it. */
double scr_date_local_to_utc(double tl) {
  double o1, o2, u1, u2, chk;
  int v1, v2;
  if (!isfinite(tl)) return NAN;
  if (!scr_tz_host_tza(tl - 86400000.0, &o1)) return NAN;
  if (!scr_tz_host_tza(tl + 86400000.0, &o2)) return NAN;
  u1 = tl - o1;
  if (o1 == o2) return u1;
  u2 = tl - o2;
  v1 = scr_tz_host_tza(u1, &chk) && chk == o1;
  v2 = scr_tz_host_tza(u2, &chk) && chk == o2;
  if (v1 && v2) return u1 < u2 ? u1 : u2;
  if (v1) return u1;
  if (v2) return u2;
  return u1;
}

/* ── new Date(string), Date.parse(string) and new Date(string).getTime() ──
 *
 * ONE parser for all three, and it is V8's: the port of src/date/dateparser.{h,cc}
 * (the ES5 ISO date-time grammar first, then the legacy grammar V8 accepts for
 * everything else: RFC 2822 day names, "2019/01/02", "Jan 2 2019",
 * "Jul  1 00:00:00 2026 GMT", ...) with ParseDateTimeString from
 * builtins-date.cc. A string gets the time value V8 gives it, or NaN exactly
 * where V8 answers NaN. A date-time with no offset (ES5) or a legacy string
 * with no zone is LOCAL time: it goes through scr_date_local_to_utc, the same
 * conversion new Date(y, m, d, ...) uses. The string is BORROWED.
 *
 * The scanner works on UTF-16 code units, like V8's. A NUL unit ends the
 * input (V8's InputReader::IsEnd). */

enum { SPT_INVALID, SPT_UNKNOWN, SPT_NUMBER, SPT_SYMBOL, SPT_WHITESPACE, SPT_KEYWORD, SPT_END };
enum { SPK_NONE, SPK_MONTH, SPK_AMPM, SPK_TZ, SPK_TSEP };
#define SP_NONE INT_MAX

typedef struct {
  int tag;
  int value;  /* number, symbol character, or keyword value */
  int length; /* code units */
  int kw;     /* keyword type */
} SpTok;

typedef struct {
  const uint16_t *u;
  size_t n;
  size_t pos;
} SpIn;

typedef struct {
  SpIn in;
  SpTok next;
} SpScan;

typedef struct {
  int comp[3];
  int index;
  int named;
  int iso;
} SpDay;

typedef struct {
  int comp[4];
  int index;
  int hour_offset;
} SpTime;

typedef struct {
  int sign;
  int hour;
  int minute;
} SpTz;

static uint16_t sp_cur(const SpIn *in) { return in->pos < in->n ? in->u[in->pos] : 0; }
static int sp_digit(uint16_t c) { return c >= '0' && c <= '9'; }

/* V8's IsWhiteSpaceOrLineTerminator. */
static int sp_ws(uint16_t c) {
  switch (c) {
  case 0x09: case 0x0A: case 0x0B: case 0x0C: case 0x0D: case 0x20: case 0xA0:
  case 0x1680: case 0x2028: case 0x2029: case 0x202F: case 0x205F: case 0x3000: case 0xFEFF:
    return 1;
  default:
    return c >= 0x2000 && c <= 0x200A;
  }
}

/* V8's DateParser::DateStringTokenizer::ReadUnsignedNumeral: leading zeros are
 * consumed but counted in the token length; only the first 9 significant digits
 * contribute to the value. */
static int sp_numeral(SpIn *in) {
  int n = 0, i = 0;
  while (sp_cur(in) == '0') in->pos++;
  while (sp_digit(sp_cur(in))) {
    if (i < 9) n = n * 10 + (sp_cur(in) - '0');
    i++;
    in->pos++;
  }
  return n;
}

/* V8's KeywordTable: a 3-character prefix (NUL-padded), a type, a value. */
typedef struct {
  char p[3];
  int kw;
  int val;
} SpKw;

static const SpKw sp_kws[] = {
  {{'j', 'a', 'n'}, SPK_MONTH, 1}, {{'f', 'e', 'b'}, SPK_MONTH, 2},
  {{'m', 'a', 'r'}, SPK_MONTH, 3}, {{'a', 'p', 'r'}, SPK_MONTH, 4},
  {{'m', 'a', 'y'}, SPK_MONTH, 5}, {{'j', 'u', 'n'}, SPK_MONTH, 6},
  {{'j', 'u', 'l'}, SPK_MONTH, 7}, {{'a', 'u', 'g'}, SPK_MONTH, 8},
  {{'s', 'e', 'p'}, SPK_MONTH, 9}, {{'o', 'c', 't'}, SPK_MONTH, 10},
  {{'n', 'o', 'v'}, SPK_MONTH, 11}, {{'d', 'e', 'c'}, SPK_MONTH, 12},
  {{'a', 'm', 0}, SPK_AMPM, 0}, {{'p', 'm', 0}, SPK_AMPM, 12},
  {{'u', 't', 0}, SPK_TZ, 0}, {{'u', 't', 'c'}, SPK_TZ, 0},
  {{'z', 0, 0}, SPK_TZ, 0}, {{'g', 'm', 't'}, SPK_TZ, 0},
  {{'c', 'd', 't'}, SPK_TZ, -5}, {{'c', 's', 't'}, SPK_TZ, -6},
  {{'e', 'd', 't'}, SPK_TZ, -4}, {{'e', 's', 't'}, SPK_TZ, -5},
  {{'m', 'd', 't'}, SPK_TZ, -6}, {{'m', 's', 't'}, SPK_TZ, -7},
  {{'p', 'd', 't'}, SPK_TZ, -7}, {{'p', 's', 't'}, SPK_TZ, -8},
  {{'t', 0, 0}, SPK_TSEP, 0},
};

static void sp_lookup(const int pre[3], int len, int *kw, int *val) {
  for (size_t i = 0; i < sizeof sp_kws / sizeof sp_kws[0]; i++) {
    int j = 0;
    while (j < 3 && pre[j] == (unsigned char)sp_kws[i].p[j]) j++;
    /* A longer word matches only a month name (V8: "janx" is January). */
    if (j == 3 && (len <= 3 || sp_kws[i].kw == SPK_MONTH)) {
      *kw = sp_kws[i].kw;
      *val = sp_kws[i].val;
      return;
    }
  }
  *kw = SPK_NONE;
  *val = 0;
}

/* V8's DateStringTokenizer::Scan. */
static SpTok sp_scan(SpIn *in) {
  SpTok t;
  size_t pre = in->pos;
  uint16_t c = sp_cur(in);
  t.tag = SPT_UNKNOWN;
  t.value = 0;
  t.length = 0;
  t.kw = SPK_NONE;
  if (c == 0) {
    t.tag = SPT_END;
    return t;
  }
  if (sp_digit(c)) {
    t.tag = SPT_NUMBER;
    t.value = sp_numeral(in);
    t.length = (int)(in->pos - pre);
    return t;
  }
  if (c == ':' || c == '-' || c == '+' || c == '.' || c == ')') {
    in->pos++;
    t.tag = SPT_SYMBOL;
    t.value = c;
    return t;
  }
  if (c >= 'A' && !sp_ws(c)) {
    int prefix[3] = {0, 0, 0};
    int len = 0;
    while (in->pos < in->n && (c = sp_cur(in)) >= 'A' && !sp_ws(c)) {
      if (len < 3) prefix[len] = c | 0x20;
      len++;
      in->pos++;
    }
    t.tag = SPT_KEYWORD;
    t.length = len;
    sp_lookup(prefix, len, &t.kw, &t.value);
    return t;
  }
  if (sp_ws(c)) {
    in->pos++;
    t.tag = SPT_WHITESPACE;
    t.length = (int)(in->pos - pre);
    return t;
  }
  if (c == '(') {
    /* V8's SkipParentheses: a balanced run is one unknown token. */
    int balance = 0;
    do {
      c = sp_cur(in);
      if (c == ')') --balance;
      else if (c == '(') ++balance;
      in->pos++;
    } while (balance > 0 && sp_cur(in) != 0);
    return t;
  }
  in->pos++;
  return t;
}

static SpTok sc_next(SpScan *s) {
  SpTok r = s->next;
  s->next = sp_scan(&s->in);
  return r;
}

static int sc_skip(SpScan *s, int c) {
  if (s->next.tag == SPT_SYMBOL && s->next.value == c) {
    s->next = sp_scan(&s->in);
    return 1;
  }
  return 0;
}

static int tk_fixed(SpTok t, int n) { return t.tag == SPT_NUMBER && t.length == n; }
static int tk_sym(SpTok t, int c) { return t.tag == SPT_SYMBOL && t.value == c; }
static int tk_sign(SpTok t) { return t.tag == SPT_SYMBOL && (t.value == '+' || t.value == '-'); }
static int tk_kw(SpTok t, int kw) { return t.tag == SPT_KEYWORD && t.kw == kw; }
/* V8's IsKeywordZ: the one-letter 'z' zone designator. */
static int tk_z(SpTok t) { return t.tag == SPT_KEYWORD && t.length == 1 && t.value == 0 && t.kw == SPK_TZ; }

static int sp_day_ok(int x) { return x >= 1 && x <= 31; }
static int sp_mon_ok(int x) { return x >= 1 && x <= 12; }
static int sp_min_ok(int x) { return x >= 0 && x <= 59; }
static int sp_hour_ok(int x) { return x >= 0 && x <= 23; }
static int sp_ms_ok(int x) { return x >= 0 && x <= 999; }

/* V8's ReadMilliseconds: the first three significant digits of the numeral,
 * from its value and its length (leading zeros count). */
static int sp_readms(SpTok t) {
  int number = t.value, length = t.length;
  if (length < 3) {
    if (length == 1) number *= 100;
    else if (length == 2) number *= 10;
  } else if (length > 3) {
    int factor = 1;
    if (length > 9) length = 9;
    do {
      factor *= 10;
      length--;
    } while (length > 3);
    number /= factor;
  }
  return number;
}

static int spd_add(SpDay *d, int n) {
  if (d->index < 3) {
    d->comp[d->index++] = n;
    return 1;
  }
  return 0;
}

/* V8's DayComposer::Write: the components become (year, month-1, day). */
static int spd_write(SpDay *d, double *out) {
  int year = 0, month = SP_NONE, day = SP_NONE;
  int *c = d->comp;
  if (d->index < 1) return 0;
  while (d->index < 3) c[d->index++] = 1;
  if (d->named == SP_NONE) {
    if (d->iso || (d->index == 3 && !sp_day_ok(c[0]))) {
      year = c[0];
      month = c[1];
      day = c[2];
    } else {
      month = c[0];
      day = c[1];
      if (d->index == 3) year = c[2];
    }
  } else {
    month = d->named;
    if (d->index == 1) {
      day = c[0];
    } else if (!sp_day_ok(c[0])) {
      year = c[0];
      day = c[1];
    } else {
      day = c[0];
      year = c[1];
    }
  }
  if (!d->iso) {
    if (year >= 0 && year <= 49) year += 2000;
    else if (year >= 50 && year <= 99) year += 1900;
  }
  if (!sp_mon_ok(month) || !sp_day_ok(day)) return 0;
  out[0] = year;
  out[1] = month - 1;
  out[2] = day;
  return 1;
}

static int spt_add(SpTime *t, int n) {
  if (t->index < 4) {
    t->comp[t->index++] = n;
    return 1;
  }
  return 0;
}

static int spt_addfinal(SpTime *t, int n) {
  if (!spt_add(t, n)) return 0;
  while (t->index < 4) t->comp[t->index++] = 0;
  return 1;
}

static int spt_empty(const SpTime *t) { return t->index == 0; }

/* V8's TimeComposer::IsExpecting: the slot a bare number would fill next. */
static int spt_expecting(const SpTime *t, int n) {
  return (t->index == 1 && sp_min_ok(n)) || (t->index == 2 && sp_min_ok(n)) || (t->index == 3 && sp_ms_ok(n));
}

/* V8's TimeComposer::Write: hours 0..23, or 24 with nothing after it. */
static int spt_write(SpTime *t, double *out) {
  int *c = t->comp;
  while (t->index < 4) c[t->index++] = 0;
  if (t->hour_offset != SP_NONE) {
    if (!(c[0] >= 0 && c[0] <= 12)) return 0;
    c[0] %= 12;
    c[0] += t->hour_offset;
  }
  if (!sp_hour_ok(c[0]) || !sp_min_ok(c[1]) || !sp_min_ok(c[2]) || !sp_ms_ok(c[3])) {
    if (c[0] != 24 || c[1] != 0 || c[2] != 0 || c[3] != 0) return 0;
  }
  out[3] = c[0];
  out[4] = c[1];
  out[5] = c[2];
  out[6] = c[3];
  return 1;
}

static void spz_set(SpTz *z, int offset_hours) {
  z->sign = offset_hours < 0 ? -1 : 1;
  z->hour = offset_hours * z->sign;
  z->minute = 0;
}

static int spz_expecting(const SpTz *z, int n) {
  return z->hour != SP_NONE && z->minute == SP_NONE && sp_min_ok(n);
}

static int spz_empty(const SpTz *z) { return z->sign == SP_NONE; }

static int spz_isutc(const SpTz *z) { return z->hour == 0 && z->minute == 0; }

/* V8's TimeZoneComposer::Write: the UTC offset in seconds, or NaN when no zone
 * was given (local time). */
static int spz_write(SpTz *z, double *out) {
  if (z->sign != SP_NONE) {
    int total;
    if (z->hour == SP_NONE) z->hour = 0;
    if (z->minute == SP_NONE) z->minute = 0;
    total = z->hour * 3600 + z->minute * 60;
    if (z->sign < 0) total = -total;
    out[7] = total;
  } else {
    out[7] = NAN;
  }
  return 1;
}

/* V8's DateParser::ParseES5DateTime. Returns the first token the ISO grammar
 * does not consume (the legacy parser continues from it), END when the whole
 * input is ISO, or INVALID when the string is ISO-shaped but wrong. */
static SpTok sp_es5(SpScan *s, SpDay *day, SpTime *tmc, SpTz *tz) {
  SpTok bad;
  bad.tag = SPT_INVALID;
  bad.value = 0;
  bad.length = 0;
  bad.kw = SPK_NONE;
  if (tk_sign(s->next)) {
    SpTok sign_tok = sc_next(s);
    int sign, year;
    if (!tk_fixed(s->next, 6)) return sign_tok;
    sign = sign_tok.value == '+' ? 1 : -1;
    year = sc_next(s).value;
    if (sign < 0 && year == 0) return sign_tok;
    spd_add(day, sign * year);
  } else if (tk_fixed(s->next, 4)) {
    spd_add(day, sc_next(s).value);
  } else {
    return sc_next(s);
  }
  if (sc_skip(s, '-')) {
    if (!tk_fixed(s->next, 2) || !sp_mon_ok(s->next.value)) return sc_next(s);
    spd_add(day, sc_next(s).value);
    if (sc_skip(s, '-')) {
      if (!tk_fixed(s->next, 2) || !sp_day_ok(s->next.value)) return sc_next(s);
      spd_add(day, sc_next(s).value);
    }
  }
  if (!tk_kw(s->next, SPK_TSEP)) {
    if (s->next.tag != SPT_END) return sc_next(s);
  } else {
    int hour_is_24;
    sc_next(s);
    if (!tk_fixed(s->next, 2) || !(s->next.value >= 0 && s->next.value <= 24)) return bad;
    hour_is_24 = s->next.value == 24;
    spt_add(tmc, sc_next(s).value);
    if (!sc_skip(s, ':')) return bad;
    if (!tk_fixed(s->next, 2) || !sp_min_ok(s->next.value) || (hour_is_24 && s->next.value > 0)) return bad;
    spt_add(tmc, sc_next(s).value);
    if (sc_skip(s, ':')) {
      if (!tk_fixed(s->next, 2) || !sp_min_ok(s->next.value) || (hour_is_24 && s->next.value > 0)) return bad;
      spt_add(tmc, sc_next(s).value);
      if (sc_skip(s, '.')) {
        if (s->next.tag != SPT_NUMBER || (hour_is_24 && s->next.value > 0)) return bad;
        spt_add(tmc, sp_readms(sc_next(s)));
      }
    }
    if (tk_z(s->next)) {
      sc_next(s);
      spz_set(tz, 0);
    } else if (tk_sym(s->next, '+') || tk_sym(s->next, '-')) {
      tz->sign = sc_next(s).value == '+' ? 1 : -1;
      if (tk_fixed(s->next, 4)) {
        int hourmin = sc_next(s).value;
        int hour = hourmin / 100, min = hourmin % 100;
        if (!sp_hour_ok(hour) || !sp_min_ok(min)) return bad;
        tz->hour = hour;
        tz->minute = min;
      } else {
        if (!tk_fixed(s->next, 2) || !sp_hour_ok(s->next.value)) return bad;
        tz->hour = sc_next(s).value;
        if (!sc_skip(s, ':')) return bad;
        if (!tk_fixed(s->next, 2) || !sp_min_ok(s->next.value)) return bad;
        tz->minute = sc_next(s).value;
      }
    }
    if (s->next.tag != SPT_END) return bad;
  }
  /* ES: a date-only form is UTC; a date-time with no offset is local. */
  if (spz_empty(tz) && spt_empty(tmc)) spz_set(tz, 0);
  day->iso = 1;
  {
    SpTok end;
    end.tag = SPT_END;
    end.value = 0;
    end.length = 0;
    end.kw = SPK_NONE;
    return end;
  }
}

/* V8's DateParser::Parse, legacy part: the loop over what the ISO grammar did
 * not consume. */
static int sp_fields(const uint16_t *u, size_t n, double out[8]) {
  SpScan s;
  SpDay day = {{0, 0, 0}, 0, SP_NONE, 0};
  SpTime tmc = {{0, 0, 0, 0}, 0, SP_NONE};
  SpTz tz = {SP_NONE, SP_NONE, SP_NONE};
  SpTok tok;
  int has_read_number;

  s.in.u = u;
  s.in.n = n;
  s.in.pos = 0;
  s.next = sp_scan(&s.in);
  tok = sp_es5(&s, &day, &tmc, &tz);
  if (tok.tag == SPT_INVALID) return 0;
  has_read_number = !(day.index == 0);

  for (; tok.tag != SPT_END; tok = sc_next(&s)) {
    if (tok.tag == SPT_NUMBER) {
      int num = tok.value;
      has_read_number = 1;
      if (sc_skip(&s, ':')) {
        if (sc_skip(&s, ':')) {
          /* n "::" */
          if (!spt_empty(&tmc)) return 0;
          spt_add(&tmc, num);
          spt_add(&tmc, 0);
        } else {
          /* n ":" */
          if (!spt_add(&tmc, num)) return 0;
          if (tk_sym(s.next, '.')) sc_next(&s);
        }
      } else if (sc_skip(&s, '.') && spt_expecting(&tmc, num)) {
        int ms;
        spt_add(&tmc, num);
        if (s.next.tag != SPT_NUMBER) return 0;
        ms = sp_readms(sc_next(&s));
        if (!spt_addfinal(&tmc, ms)) return 0;
      } else if (spz_expecting(&tz, num)) {
        tz.minute = num;
      } else if (spt_expecting(&tmc, num)) {
        SpTok peek;
        if (!spt_addfinal(&tmc, num)) return 0;
        /* The finalized time must end, or be followed by white space, 'z' or a sign. */
        peek = s.next;
        if (peek.tag != SPT_END && peek.tag != SPT_WHITESPACE && !tk_z(peek) && !tk_sign(peek)) return 0;
      } else {
        if (!spd_add(&day, num)) return 0;
        sc_skip(&s, '-');
      }
    } else if (tok.tag == SPT_KEYWORD) {
      if (tok.kw == SPK_AMPM && !spt_empty(&tmc)) {
        tmc.hour_offset = tok.value;
      } else if (tok.kw == SPK_MONTH) {
        day.named = tok.value;
        sc_skip(&s, '-');
      } else if (tok.kw == SPK_TZ && has_read_number) {
        spz_set(&tz, tok.value);
      } else {
        /* Garbage words are illegal once a number was read; the first number
         * must be separated from a word. */
        if (has_read_number) return 0;
        if (s.next.tag == SPT_NUMBER) return 0;
      }
    } else if (tk_sign(tok) && (spz_isutc(&tz) || !spt_empty(&tmc))) {
      /* A UTC offset, after UTC or after a tmc. */
      int num = 0, length = 0;
      tz.sign = tok.value == '+' ? 1 : -1;
      if (s.next.tag == SPT_NUMBER) {
        SpTok t = sc_next(&s);
        length = t.length;
        num = t.value;
      }
      has_read_number = 1;
      if (tk_sym(s.next, ':')) {
        tz.hour = num;
        tz.minute = SP_NONE;
      } else if (length == 2 || length == 1) {
        tz.hour = num;
        tz.minute = 0;
      } else if (length == 4 || length == 3) {
        tz.hour = num / 100;
        tz.minute = num % 100;
      } else {
        return 0;
      }
    } else if ((tk_sign(tok) || tk_sym(tok, ')')) && has_read_number) {
      return 0;
    }
    /* Anything else (white space, unknown characters) is ignored. */
  }
  return spd_write(&day, out) && spt_write(&tmc, out) && spz_write(&tz, out);
}

/* V8's MakeDay over the composed (year, month-1, day). */
static double sp_make_day(double y, double m, double d) {
  long long ym, mn;
  if (!(y >= -1000000.0 && y <= 1000000.0) || !(m >= -10000000.0 && m <= 10000000.0) || !isfinite(d)) return NAN;
  ym = (long long)y + (long long)floor(m / 12.0);
  mn = (long long)m - 12LL * (long long)floor(m / 12.0);
  return sp_days_from_civil(ym, (int)mn + 1, 1) + d - 1.0;
}

/* Decode the string's UTF-8 into UTF-16 code units (a malloc'd buffer; the
 * caller frees it). ScrStr is well-formed UTF-8. */
static uint16_t *sp_utf16(const ScrStr *s, size_t *out_n) {
  const unsigned char *p = (const unsigned char *)s->data;
  size_t len = s->len, i = 0, k = 0;
  uint16_t *u = (uint16_t *)malloc((len + 1) * sizeof *u);
  if (u == NULL) scr_trap("scriptc: out of memory\n");
  while (i < len) {
    unsigned c = p[i];
    uint32_t cp;
    int extra;
    if (c < 0x80) {
      cp = c;
      extra = 0;
    } else if (c < 0xE0) {
      cp = c & 0x1F;
      extra = 1;
    } else if (c < 0xF0) {
      cp = c & 0x0F;
      extra = 2;
    } else {
      cp = c & 0x07;
      extra = 3;
    }
    i++;
    for (int j = 0; j < extra && i < len; j++, i++) cp = (cp << 6) | (p[i] & 0x3F);
    if (cp >= 0x10000) {
      cp -= 0x10000;
      u[k++] = (uint16_t)(0xD800 + (cp >> 10));
      u[k++] = (uint16_t)(0xDC00 + (cp & 0x3FF));
    } else {
      u[k++] = (uint16_t)cp;
    }
  }
  *out_n = k;
  return u;
}

/* V8's ParseDateTimeString: the fields, then MakeDay/MakeTime/MakeDate, the
 * local-time conversion when no offset was given (only within V8's
 * kMaxTimeBeforeUTCInMs), the offset otherwise, and TimeClip. */
double scr_date_parse_get_time(ScrStr *s) {
  double out[8];
  size_t n = 0;
  uint16_t *u = sp_utf16(s, &n);
  int ok = sp_fields(u, n, out);
  double t, clip;
  free(u);
  if (!ok) return NAN;
  t = sp_make_day(out[0], out[1], out[2]) * 86400000.0 + out[3] * 3600000.0 + out[4] * 60000.0 +
      out[5] * 1000.0 + out[6];
  if (isnan(out[7])) {
    if (!(t >= -8.64e15 - 8.64e8 && t <= 8.64e15 + 8.64e8)) return NAN;
    t = scr_date_local_to_utc(t);
  } else {
    t -= out[7] * 1000.0;
  }
  if (!(fabs(t) <= 8.64e15)) return NAN;
  clip = trunc(t);
  return clip == 0 ? 0 : clip;
}
