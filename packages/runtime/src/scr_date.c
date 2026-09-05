/* scr_date.c — the Date handle's ownership pair.
 *
 * A TYPE WITH NO VALUES, exactly like ScrRequest in scr_fetch_static.c.
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
#include <stdlib.h>
#include <time.h>

#include "scr_runtime.h"

struct ScrDate {
  size_t rc;
};

ScrDate *scr_date_retain(ScrDate *d) {
  if (d != NULL && d->rc != SIZE_MAX) d->rc++;
  return d;
}

void scr_date_release(ScrDate *d) {
  if (d == NULL || d->rc == SIZE_MAX) return;
  if (--d->rc == 0) free(d);
}

void *scr_date_retain_v(void *p) { return scr_date_retain((ScrDate *)p); }
void scr_date_release_v(void *p) { scr_date_release((ScrDate *)p); }

/* ── WHY getHours LIVES HERE AND NOT IN scr_lib.c ───────────────────────
 *
 * Every other Date entry point (scr_date_now, scr_date_to_iso,
 * scr_date_utc, scr_date_parse_get_time) sits in scr_lib.c, which is
 * ALWAYS linked. This one does not, and the reason is a measurement: on
 * win32/mingw the `localtime` and `gmtime` calls below drag the CRT's
 * timezone machinery in with them, and adding them to the always-linked
 * TU grew a hello-world that never mentions Date by 1,536 bytes on BOTH
 * backends — enough, on top of the drift the size-class anchors already
 * carried, to trip `static hello-world stays in its size class` and its
 * regex twin. tests/harness/size-class.ts says that is not a number to
 * nudge, and it is right: the honest fix is that a program which never
 * reads a local hour should not pay for one.
 *
 * scr_date.c's own header already anticipated this: "nothing constructs a
 * Date, so there are no `date.*` libCalls to look for". Now there is one,
 * and moduleUsesDate looks for it — the gate fires on the HANDLE TYPE or
 * on a `date.getHours` libCall, and a wrong `false` is a loud
 * unresolved-symbol link error, never a wrong answer.
 *
 * The civil-days helper is duplicated from scr_lib.c's
 * scr_days_from_civil rather than shared, and that is deliberate: making
 * the original non-static changes codegen in the always-linked TU, which
 * is the one thing this move exists to avoid. Eight lines of Howard
 * Hinnant's days_from_civil is a cheaper price than moving a size anchor.
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

/* ── new Date(ms?).getHours(), the first LOCAL-time field read ──────────
 *
 * Every other Date entry point above is UTC and therefore a pure function
 * of its milliseconds. This one is not: HourFromTime(LocalTime(t)) needs
 * LocalTZA(t) — the offset the HOST's zone was at THAT INSTANT, which is
 * a table lookup, not arithmetic, because it moves with DST and with
 * historical zone changes.
 *
 * The offset is read the way that cannot disagree with the host: break
 * the SAME instant down twice, once local and once UTC, and subtract the
 * two civil times. mktime() is the usual spelling and it is the wrong one
 * — it re-derives an instant from wall-clock fields, and wall clocks are
 * AMBIGUOUS across a DST fall-back (one local hour names two instants)
 * and NONEXISTENT across a spring-forward. Subtracting two broken-down
 * views of one instant asks no ambiguous question.
 *
 * WHY ONLY THE LIVE CLOCK REACHES HERE. Node carries ICU's full zone
 * HISTORY; the platforms this links against do not agree that they
 * should. Windows' CRT applies the zone's CURRENT rule to every instant,
 * so a past DST period reads an hour off — measured, one instant every
 * ~9 days from 2000 to 2030 on a Windows host in America/Sao_Paulo, 260
 * of 1200 disagreed with Node. That is a divergence the COMPILER cannot
 * see, because the zone database belongs to the machine that runs the
 * binary. So the frontend composes only `new Date().getHours()`, whose
 * instant is the present — the one instant a zone database cannot be
 * wrong about — and fences every arbitrary-millisecond spelling.
 *
 * The guards below still answer NaN for anything outside Date's range or
 * outside the platform's `time_t` (Windows rejects negative values
 * outright). Nothing the frontend emits can reach them; they are here so
 * that a future caller cannot get a quietly wrong hour instead of a
 * loudly wrong one. */
static double scr_date_tm_civil_ms(const struct tm *x) {
  return scr_date_days_from_civil_local((long long)x->tm_year + 1900, x->tm_mon + 1, x->tm_mday) * 86400000.0 +
         (double)x->tm_hour * 3600000.0 + (double)x->tm_min * 60000.0 + (double)x->tm_sec * 1000.0;
}

double scr_date_get_hours(double ms) {
  if (!(fabs(ms) <= 8640000000000000.0)) return NAN; /* NaN and out of range */
  double t = trunc(ms);
  /* The second the instant falls in, floored — so a negative ms keeps a
   * non-negative sub-second remainder and the hour never rounds up. */
  double secsd = floor(t / 1000.0);
  if (secsd < -9.2e18 || secsd > 9.2e18) return NAN; /* outside any time_t */
  time_t secs = (time_t)secsd;
  if ((double)secs != secsd) return NAN; /* narrower time_t than the instant */
  struct tm local_tm, utc_tm;
  const struct tm *lp = localtime(&secs);
  if (lp == NULL) return NAN; /* the platform declines this instant */
  local_tm = *lp;
  const struct tm *gp = gmtime(&secs);
  if (gp == NULL) return NAN;
  utc_tm = *gp;
  double tza = scr_date_tm_civil_ms(&local_tm) - scr_date_tm_civil_ms(&utc_tm);
  double local = t + tza;
  double dayd = floor(local / 86400000.0);
  double msday = local - dayd * 86400000.0;
  return floor(msday / 3600000.0);
}

