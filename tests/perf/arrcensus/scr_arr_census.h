/* scr_arr_census.h — WHAT does the real program slice, join, parse and
 * serialise, how often, and how big?
 *
 * WHY THIS EXISTS. The phase-scoped sampler puts `scr_arr_slice` at 21.0% of
 * the messaging bench's SEND group phase and `scr_arr_join` at 7.3%, and
 * `scr_jb_put_json_str` 8.9% / `scr_string_to_number` 6.9% /
 * `scr_map_keys_js_order` 3.7% of RECV group. Those are shares of a PROFILE.
 * A share does not say whether the cost is one enormous call or a million
 * tiny ones, and the two have opposite fixes: a quadratic wants an
 * algorithm, a million tiny calls want the per-call plumbing. Five
 * per-function wins in this fleet last month were all plumbing rather than
 * algorithms — including one where the arithmetic ran six times in 400,014
 * calls and the real cost was a reverse copy. So: count first.
 *
 * WHAT IT ANSWERS, per primitive
 *   - call count, total elements or bytes moved, longest single call, and a
 *     per-length histogram with EXACT rows for 0..255 and one row per power
 *     of two above that. The exact rows matter: `slice` of 3 elements and
 *     `slice` of 200 are the same aggregate row and completely different
 *     problems.
 *   - for `scr_arr_slice`, both the SOURCE length and the COPIED length, so
 *     "slicing 2 elements off a 500-element array" is distinguishable from
 *     "copying all 500", and a per-element-kind split, because the ref arm
 *     pays a retain per element through a function pointer and the scalar
 *     arm could be one memcpy.
 *   - for `scr_arr_join`, the source length and the OUTPUT bytes, which is
 *     what the realloc-doubling buffer actually costs.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <win>/tests/perf/arrcensus/scr_arr_census.h
 *                        -I<win>/tests/perf/arrcensus"
 *   SCRIPTC_NO_CACHE=1              (the header is outside packages/runtime/src
 *                                    and so is not in the build-cache key)
 *   SCR_ARRCEN_OUT=<file>           where the report is written
 *   SCR_ARRCEN_ARM=<n>              THE POSITIVE CONTROL: n synthetic slices
 *                                   of a known length are recorded before
 *                                   main runs, so a report of zero and a
 *                                   census that never compiled in are
 *                                   distinguishable. That distinction is the
 *                                   failure this fleet keeps finding.
 * <win> must be a WINDOWS path: `zig cc` is a native binary spawned by node
 * and never sees an MSYS mount point.
 *
 * The hooks are `#ifdef SCR_ARRCEN_ON` blocks in scr_array.c, scr_string.c,
 * scr_json.c and scr_map.c. With this header absent the switch is undefined
 * and every block vanishes.
 *
 * Linkage follows scr_sha_census.h exactly: state is `selectany` (COMDAT,
 * one merged instance) and every function is `static`, because on
 * x86_64-windows-gnu a weak definition in each of zapo's translation units
 * is `lld-link: error: duplicate symbol` rather than one instance.
 *
 * NO <windows.h>: scr_fetch_dispatch.c's `fd_set` collides with it.
 */
#ifndef SCR_ARR_CENSUS_H
#define SCR_ARR_CENSUS_H

#include <stdio.h>
#include <stdlib.h>

/* The switch the hook lines test. */
#define SCR_ARRCEN_ON 1

#define SCR_ARRCEN_SHARED __attribute__((selectany))
#define SCR_ARRCEN_FN static __attribute__((unused)) __attribute__((no_instrument_function))

#define SCR_ARRCEN_EXACT 256
#define SCR_ARRCEN_LOG 40
#define SCR_ARRCEN_ROWS (SCR_ARRCEN_EXACT + SCR_ARRCEN_LOG)

/* measurement slots */
#define SCR_ARRCEN_SLICE_SRC 0  /* scr_arr_slice, length of the source array */
#define SCR_ARRCEN_SLICE_N 1    /* scr_arr_slice, elements actually copied   */
#define SCR_ARRCEN_JOIN_SRC 2   /* scr_arr_join, elements                    */
#define SCR_ARRCEN_JOIN_OUT 3   /* scr_arr_join, output bytes                */
#define SCR_ARRCEN_STR2NUM 4    /* scr_string_to_number, input bytes         */
#define SCR_ARRCEN_JSONSTR 5    /* scr_jb_put_json_str, input bytes          */
#define SCR_ARRCEN_MAPKEYS 6    /* scr_map_keys_js_order, entries            */
#define SCR_ARRCEN_SLOTS 7

/* scr_arr_slice by element kind — the ref arm retains per element through a
 * function pointer, the scalar arms could be one memcpy, and which of the two
 * the workload takes decides what a fix is even allowed to be. */
#define SCR_ARRCEN_KINDS 8

SCR_ARRCEN_FN int scr_arrcen_row(long long n) {
  if (n < 0) return SCR_ARRCEN_ROWS - 1;
  if (n < SCR_ARRCEN_EXACT) return (int)n;
  {
    int b = 0;
    unsigned long long v = (unsigned long long)n;
    while (v > 1 && b < SCR_ARRCEN_LOG - 1) { v >>= 1; b++; }
    return SCR_ARRCEN_EXACT + b;
  }
}

SCR_ARRCEN_SHARED long long scr_arrcen_rows[SCR_ARRCEN_SLOTS][SCR_ARRCEN_ROWS];
SCR_ARRCEN_SHARED long long scr_arrcen_calls[SCR_ARRCEN_SLOTS];
SCR_ARRCEN_SHARED long long scr_arrcen_total[SCR_ARRCEN_SLOTS];
SCR_ARRCEN_SHARED long long scr_arrcen_max[SCR_ARRCEN_SLOTS];
SCR_ARRCEN_SHARED long long scr_arrcen_kind_calls[SCR_ARRCEN_KINDS];
SCR_ARRCEN_SHARED long long scr_arrcen_kind_elems[SCR_ARRCEN_KINDS];
/* a slice whose copied length EQUALS the source length is a whole-array copy
 * wearing a slice's name, and it is the shape a reference would replace. */
SCR_ARRCEN_SHARED long long scr_arrcen_slice_whole = 0;
SCR_ARRCEN_SHARED long long scr_arrcen_slice_empty = 0;
SCR_ARRCEN_SHARED long long scr_arrcen_planted = 0;
SCR_ARRCEN_SHARED int scr_arrcen_reported = 0;

SCR_ARRCEN_FN void scr_arrcen_note(int slot, long long n) {
  if (slot < 0 || slot >= SCR_ARRCEN_SLOTS) return;
  scr_arrcen_rows[slot][scr_arrcen_row(n)]++;
  scr_arrcen_calls[slot]++;
  scr_arrcen_total[slot] += n;
  if (n > scr_arrcen_max[slot]) scr_arrcen_max[slot] = n;
}

SCR_ARRCEN_FN void scr_arrcen_note_slice(long long srclen, long long n, int kind) {
  scr_arrcen_note(SCR_ARRCEN_SLICE_SRC, srclen);
  scr_arrcen_note(SCR_ARRCEN_SLICE_N, n);
  if (kind >= 0 && kind < SCR_ARRCEN_KINDS) {
    scr_arrcen_kind_calls[kind]++;
    scr_arrcen_kind_elems[kind] += n;
  }
  if (n == 0) scr_arrcen_slice_empty++;
  else if (n == srclen) scr_arrcen_slice_whole++;
}

SCR_ARRCEN_FN const char *scr_arrcen_name(int s) {
  switch (s) {
    case SCR_ARRCEN_SLICE_SRC: return "slice-src";
    case SCR_ARRCEN_SLICE_N: return "slice-n";
    case SCR_ARRCEN_JOIN_SRC: return "join-src";
    case SCR_ARRCEN_JOIN_OUT: return "join-outbytes";
    case SCR_ARRCEN_STR2NUM: return "str2num-bytes";
    case SCR_ARRCEN_JSONSTR: return "jsonstr-bytes";
    default: return "mapkeys-entries";
  }
}

SCR_ARRCEN_FN void scr_arrcen_report(void) {
  const char *path;
  FILE *f;
  int s, i;
  if (scr_arrcen_reported) return;
  scr_arrcen_reported = 1;
  path = getenv("SCR_ARRCEN_OUT");
  f = fopen(path && *path ? path : "scr-arrcen.txt", "w");
  if (!f) return;
  fprintf(f, "ARRCEN-ARM planted=%lld exactRows=%d\n", scr_arrcen_planted,
          (int)SCR_ARRCEN_EXACT);
  fprintf(f, "ARRCEN-SLICE whole=%lld empty=%lld\n", scr_arrcen_slice_whole,
          scr_arrcen_slice_empty);
  for (s = 0; s < SCR_ARRCEN_SLOTS; s++) {
    fprintf(f, "ARRCEN-SLOT %s calls=%lld total=%lld max=%lld\n",
            scr_arrcen_name(s), scr_arrcen_calls[s], scr_arrcen_total[s],
            scr_arrcen_max[s]);
  }
  for (i = 0; i < SCR_ARRCEN_KINDS; i++) {
    if (scr_arrcen_kind_calls[i] == 0) continue;
    fprintf(f, "ARRCEN-KIND %d calls=%lld elems=%lld\n", i,
            scr_arrcen_kind_calls[i], scr_arrcen_kind_elems[i]);
  }
  for (s = 0; s < SCR_ARRCEN_SLOTS; s++) {
    for (i = 0; i < SCR_ARRCEN_ROWS; i++) {
      if (scr_arrcen_rows[s][i] == 0) continue;
      fprintf(f, "ARRCEN-ROW %s %d %lld\n", scr_arrcen_name(s), i,
              scr_arrcen_rows[s][i]);
    }
  }
  fclose(f);
}

/* THE POSITIVE CONTROL. SCR_ARRCEN_ARM=<n> records n slices of a known
 * source length 41 copying 7 elements before main runs; the report's
 * slice-src row 41 and slice-n row 7 must then read at least n, and
 * planted must equal n. A report that is missing, or whose planted rows are
 * short, is DID-NOT-RUN and must not be read as "the program does not
 * slice". Unlike the SHA census this control needs nothing static to a
 * runtime TU, so it lives here rather than in scr_array.c.
 *
 * `__attribute__((destructor))` is NOT used and must not be: these PE
 * binaries have no `.CRT` termination section, so a destructor never runs
 * while its strings stay in the image and a byte scan calls it present.
 * atexit() runs; for the exit path that skips even atexit, see the _Exit
 * interposition below. */
__attribute__((constructor)) SCR_ARRCEN_FN void scr_arrcen_install(void) {
  static int done = 0;
  const char *arm;
  if (done) return;
  done = 1;
  arm = getenv("SCR_ARRCEN_ARM");
  if (arm && *arm) {
    long long n = atoll(arm), i;
    for (i = 0; i < n; i++) scr_arrcen_note_slice(41, 7, 0);
    scr_arrcen_planted = n;
  }
  atexit(scr_arrcen_report);
}

#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) (scr_arrcen_report(), _Exit(c))

#endif /* SCR_ARR_CENSUS_H */
