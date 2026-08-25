/* scr_u16_census.h — HOW OFTEN, and on WHAT, does a program ask a string
 * for its length?
 *
 * WHY THIS EXISTS. `scr_str_utf16_len` is 18.86% of runtime.bench.ts's
 * string-build scenario at 133.3 instructions per call. That is a number
 * about a BENCH. The standing rule on this project is that what does not
 * affect zapo does not need touching, and the two instruments that could
 * have answered "does it reach zapo" both refuse on this program:
 *
 *   - ab-callgrind.mjs can only run the fake-server messaging bench, where
 *     the answer is 24 calls in a whole scenario -- 0.0024% of instructions;
 *   - tests/perf/prof/scr_prof.h's -finstrument-functions lane cannot LINK
 *     zapo. Its own header says why: __cyg_profile_func_enter and _exit must
 *     carry an external name, so they stay `weak`, and on x86_64-windows-gnu
 *     a weak definition in every translation unit is
 *     `lld-link: error: duplicate symbol` rather than one merged instance.
 *     Measured here, 2026-08-25, on zapo's 125 MB TU, twice.
 *
 * So this counts one function, in the one place that can see every call,
 * and it links: the STATE is `selectany` (COMDAT, merged, one instance) and
 * every function is `static`, which is scr_str_census.h's linkage and is
 * chosen for exactly the reason above.
 *
 * WHAT IT ANSWERS, per byte length of the string asked:
 *   - how many calls;
 *   - how many of those strings were pure ASCII, i.e. how often the
 *     byte-length answer is the right one;
 *   - how many found their UTF-16 length already in the four-entry index
 *     cache, which is the difference between a probe that pays for itself
 *     and one that costs 20 instructions to learn nothing.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <win>/tests/perf/u16census/scr_u16_census.h
 *                        -I<win>/tests/perf/u16census"
 *   SCRIPTC_NO_CACHE=1              (the header is outside packages/runtime/src
 *                                    and so is not in the build-cache key)
 *   SCR_U16CEN_OUT=<file>           where the report is written
 * <win> must be a WINDOWS path: `zig cc` is a native binary spawned by node
 * and never sees an MSYS mount point.
 *
 * The hook is ONE `#ifdef SCR_U16CEN_ON` block in scr_string.c. With this
 * header absent the symbol is undefined and the block vanishes, so an
 * uninstrumented build is byte-identical -- which is checked, not assumed.
 *
 * NO <windows.h>, for scr_cyc_census.h's reason (scr_fetch_dispatch.c's
 * `fd_set` collision).
 */
#ifndef SCR_U16_CENSUS_H
#define SCR_U16_CENSUS_H

#include <stdio.h>
#include <stdlib.h>

/* The switch scr_string.c's hook line tests. */
#define SCR_U16CEN_ON 1

#define SCR_U16CEN_SHARED __attribute__((selectany))
#define SCR_U16CEN_FN static __attribute__((unused)) __attribute__((no_instrument_function))

/* Exact rows for 0..255 bytes, then one row per power of two, then one
 * overflow row. Exact rows below 256 are what make a threshold argument
 * checkable: the fast path this census exists to price is bounded at 16
 * bytes, and an aggregate over "9-16" cannot tell 16 from 17. */
#define SCR_U16CEN_EXACT 256
#define SCR_U16CEN_LOG 32
#define SCR_U16CEN_ROWS (SCR_U16CEN_EXACT + SCR_U16CEN_LOG)

SCR_U16CEN_FN int scr_u16cen_row(long long n) {
  if (n < 0) return SCR_U16CEN_ROWS - 1;
  if (n < SCR_U16CEN_EXACT) return (int)n;
  {
    int b = 0;
    unsigned long long v = (unsigned long long)n;
    while (v > 1 && b < SCR_U16CEN_LOG - 1) { v >>= 1; b++; }
    return SCR_U16CEN_EXACT + b;
  }
}

SCR_U16CEN_SHARED long long scr_u16cen_calls[SCR_U16CEN_ROWS] = {0};
SCR_U16CEN_SHARED long long scr_u16cen_ascii[SCR_U16CEN_ROWS] = {0};
SCR_U16CEN_SHARED long long scr_u16cen_hit[SCR_U16CEN_ROWS] = {0};
SCR_U16CEN_SHARED long long scr_u16cen_total = 0;
SCR_U16CEN_SHARED long long scr_u16cen_bytes = 0;
SCR_U16CEN_SHARED long long scr_u16cen_maxlen = 0;
SCR_U16CEN_SHARED int scr_u16cen_reported = 0;

/* n = the string's BYTE length, ascii = every byte below 0x80, hit = the
 * index cache already held this string's UTF-16 length when the call
 * arrived. All three are facts the caller establishes; this side only
 * tallies, so the instrument cannot disagree with the code it measures. */
SCR_U16CEN_FN void scr_u16cen_call(long long n, int ascii, int hit) {
  int r = scr_u16cen_row(n);
  scr_u16cen_calls[r]++;
  if (ascii) scr_u16cen_ascii[r]++;
  if (hit) scr_u16cen_hit[r]++;
  scr_u16cen_total++;
  scr_u16cen_bytes += n;
  if (n > scr_u16cen_maxlen) scr_u16cen_maxlen = n;
}

SCR_U16CEN_FN void scr_u16cen_report(void) {
  const char *path;
  FILE *f;
  int i;
  if (scr_u16cen_reported) return;
  scr_u16cen_reported = 1;
  path = getenv("SCR_U16CEN_OUT");
  f = fopen(path && *path ? path : "scr-u16cen.txt", "w");
  if (!f) return;
  fprintf(f, "U16CEN-TOTAL calls=%lld bytes=%lld maxlen=%lld exactRows=%d\n",
          scr_u16cen_total, scr_u16cen_bytes, scr_u16cen_maxlen,
          (int)SCR_U16CEN_EXACT);
  for (i = 0; i < SCR_U16CEN_ROWS; i++) {
    if (scr_u16cen_calls[i] == 0) continue;
    fprintf(f, "U16CEN-ROW %d %lld %lld %lld\n", i, scr_u16cen_calls[i],
            scr_u16cen_ascii[i], scr_u16cen_hit[i]);
  }
  fclose(f);
}

/* atexit alone cannot report on this target: zapo's entry ends in
 * process.exit(0), which lowers to _Exit and skips every atexit handler.
 * Same interposition scr_str_census.h uses, chained onto the other census
 * headers BY NAME on their own include guards so that none of them is lost
 * when two are -include'd together. This header must come after them on the
 * command line. */
__attribute__((constructor)) SCR_U16CEN_FN void scr_u16cen_install(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  atexit(scr_u16cen_report);
}

#ifdef _Exit
#undef _Exit
#endif
#if defined(SCR_STR_CENSUS_H) && defined(SCR_DYN_CENSUS_H)
#define _Exit(c) (scr_u16cen_report(), scr_strcen_final(), scr_dyncen_final(), _Exit(c))
#elif defined(SCR_STR_CENSUS_H)
#define _Exit(c) (scr_u16cen_report(), scr_strcen_final(), _Exit(c))
#elif defined(SCR_DYN_CENSUS_H)
#define _Exit(c) (scr_u16cen_report(), scr_dyncen_final(), _Exit(c))
#else
#define _Exit(c) (scr_u16cen_report(), _Exit(c))
#endif

#endif /* SCR_U16_CENSUS_H */
