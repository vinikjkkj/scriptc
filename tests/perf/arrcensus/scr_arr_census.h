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
#include <string.h>

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
/* THE TYPED-ARRAY ELEMENT PATH. scr_bytes_get and scr_bytes_set are
 * 13.8-16.8% and 4.0-9.5% of the messaging bench's SEND group phase by
 * suspend-and-sample, and `trunc` appears at 5.4-6.1% as its OWN symbol
 * because scr_bytes_check_index makes it a real libm call. A share is not
 * a count, and a per-call fix has to be priced by the CALL COUNT times the
 * per-call instruction delta -- which is the only currency that survives a
 * busy host, where the same binary's cycles for this phase moved 52% in one
 * session. The length recorded is the BUFFER's, so a million reads of a
 * 32-byte key is distinguishable from a thousand walks of a megabyte. */
#define SCR_ARRCEN_BYTESGET 7   /* scr_bytes_get, buffer length              */
#define SCR_ARRCEN_BYTESSET 8   /* scr_bytes_set, buffer length              */
#define SCR_ARRCEN_SLOTS 9

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
/* THE ELEMENT KIND OF EVERY TYPED-ARRAY ACCESS. The length histogram above
 * says a 16-element buffer carries 93.8% of the reads; it does NOT say what
 * KIND of buffer, and the two accessors' fast arm serves `SCR_BYTES_U8` and
 * nothing else. An access on any other kind fails that arm's FIRST branch
 * and tail-calls the full function, so an instruction saving priced as
 * `accesses x per-access delta` is a saving on the accesses that ENTER the
 * arm -- which the length row cannot tell apart from the ones that do not.
 * Indexed by ScrBytesElem in scr_runtime.h's own order. */
#define SCR_ARRCEN_ELEMS 9
SCR_ARRCEN_SHARED long long scr_arrcen_bget_elem[SCR_ARRCEN_ELEMS];
SCR_ARRCEN_SHARED long long scr_arrcen_bset_elem[SCR_ARRCEN_ELEMS];
/* a slice whose copied length EQUALS the source length is a whole-array copy
 * wearing a slice's name, and it is the shape a reference would replace. */
SCR_ARRCEN_SHARED long long scr_arrcen_slice_whole = 0;
SCR_ARRCEN_SHARED long long scr_arrcen_slice_empty = 0;
/* THE CHILD-SUPERVISION PUMP. scr_win_run_sync is reported at 66.9% of the
 * RECV group phase by the suspend-and-sample profiler, and an earlier 93.81%
 * reading of the SAME function was refuted as a thread-selection artifact.
 * The 66.9% survived cycle-weighting but has never been confirmed by an
 * instrument that does not share the sampler's thread-selection assumption.
 * This is that instrument, and it shares nothing with it: an exact iteration
 * count and the pump thread's OWN QueryThreadCycleTime delta across the whole
 * blocking call. If the claim is real those cycles are most of the run. */
SCR_ARRCEN_SHARED long long scr_arrcen_pump_calls = 0;
SCR_ARRCEN_SHARED long long scr_arrcen_pump_iters = 0;
SCR_ARRCEN_SHARED unsigned long long scr_arrcen_pump_cycles = 0;
SCR_ARRCEN_SHARED long long scr_arrcen_pump_ms = 0;
SCR_ARRCEN_SHARED long long scr_arrcen_planted = 0;
SCR_ARRCEN_SHARED int scr_arrcen_reported = 0;

SCR_ARRCEN_FN void scr_arrcen_note(int slot, long long n) {
  if (slot < 0 || slot >= SCR_ARRCEN_SLOTS) return;
  scr_arrcen_rows[slot][scr_arrcen_row(n)]++;
  scr_arrcen_calls[slot]++;
  scr_arrcen_total[slot] += n;
  if (n > scr_arrcen_max[slot]) scr_arrcen_max[slot] = n;
}

/* The typed-array hooks' entry: the buffer length as before, plus the
 * element kind the length row cannot carry. An out-of-range kind lands in
 * the last slot rather than being dropped, so a new ScrBytesElem appears as
 * a nonzero row instead of as silence. */
SCR_ARRCEN_FN void scr_arrcen_note_bytes(int slot, long long len, int elem) {
  scr_arrcen_note(slot, len);
  if (elem < 0 || elem >= SCR_ARRCEN_ELEMS) elem = SCR_ARRCEN_ELEMS - 1;
  if (slot == SCR_ARRCEN_BYTESGET) scr_arrcen_bget_elem[elem]++;
  else if (slot == SCR_ARRCEN_BYTESSET) scr_arrcen_bset_elem[elem]++;
}

SCR_ARRCEN_FN const char *scr_arrcen_elem_name(int e) {
  switch (e) {
    case 0: return "u8";
    case 1: return "u32";
    case 2: return "f32";
    case 3: return "i32";
    case 4: return "f64";
    case 5: return "i8";
    case 6: return "buf";
    case 7: return "i16";
    default: return "u16-or-other";
  }
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

SCR_ARRCEN_FN void scr_arrcen_note_pump(long long iters, unsigned long long cycles,
                                       long long ms) {
  scr_arrcen_pump_calls++;
  scr_arrcen_pump_iters += iters;
  scr_arrcen_pump_cycles += cycles;
  scr_arrcen_pump_ms += ms;
}

SCR_ARRCEN_FN const char *scr_arrcen_name(int s) {
  switch (s) {
    case SCR_ARRCEN_SLICE_SRC: return "slice-src";
    case SCR_ARRCEN_SLICE_N: return "slice-n";
    case SCR_ARRCEN_JOIN_SRC: return "join-src";
    case SCR_ARRCEN_JOIN_OUT: return "join-outbytes";
    case SCR_ARRCEN_STR2NUM: return "str2num-bytes";
    case SCR_ARRCEN_JSONSTR: return "jsonstr-bytes";
    case SCR_ARRCEN_MAPKEYS: return "mapkeys-entries";
    case SCR_ARRCEN_BYTESGET: return "bytesget-len";
    default: return "bytesset-len";
  }
}

/* ── PHASE SCOPING ────────────────────────────────────────────────────────
 * The counters above are PROCESS-WIDE, and this bench's run is dominated by
 * one phase out of six. A process-wide count cannot say whether a million
 * slices happened in `send_group` or in the setup that precedes it, and the
 * question being asked is specifically about `send_group`.
 *
 * The bench already prints `[phase-begin] <label>` / `[phase-end] <label>`
 * on stdout, and cpuphase.exe and tests/perf/sampler both bracket the phase
 * on exactly those two lines. This reads the SAME markers from inside the
 * process, through the one choke point every console.log passes
 * (scr_console_log -> scr_arrcen_phase_line), so the census, the cycle
 * counter and the sampler are all scoped to the same interval by
 * construction rather than by agreement.
 *
 * Cost on the counting path is ZERO: nothing in scr_arrcen_note changes.
 * A phase boundary memcpys the whole counter block once, and the per-phase
 * figure is the difference. Six phases, twice per run.
 *
 * A phase whose name never appears is reported as absent rather than as
 * zero -- SCR_ARRCEN_ARM plants into the process-wide totals, and if the
 * marker hook never compiled in, `phases=0` says so instead of every
 * per-phase row silently reading zero.
 */
#define SCR_ARRCEN_MAXPH 16
#define SCR_ARRCEN_NAMELEN 56

typedef struct {
  long long rows[SCR_ARRCEN_SLOTS][SCR_ARRCEN_ROWS];
  long long calls[SCR_ARRCEN_SLOTS];
  long long total[SCR_ARRCEN_SLOTS];
  long long kind_calls[SCR_ARRCEN_KINDS];
  long long kind_elems[SCR_ARRCEN_KINDS];
  long long bget_elem[SCR_ARRCEN_ELEMS];
  long long bset_elem[SCR_ARRCEN_ELEMS];
  long long whole;
  long long empty;
  long long pump_calls;
  long long pump_iters;
  unsigned long long pump_cycles;
} ScrArrcenSnap;

SCR_ARRCEN_SHARED ScrArrcenSnap scr_arrcen_at_begin;
SCR_ARRCEN_SHARED ScrArrcenSnap scr_arrcen_ph[SCR_ARRCEN_MAXPH];
SCR_ARRCEN_SHARED char scr_arrcen_phname[SCR_ARRCEN_MAXPH][SCR_ARRCEN_NAMELEN];
SCR_ARRCEN_SHARED int scr_arrcen_nph = 0;
SCR_ARRCEN_SHARED int scr_arrcen_curph = -1;
SCR_ARRCEN_SHARED long long scr_arrcen_marks = 0;

SCR_ARRCEN_FN void scr_arrcen_capture(ScrArrcenSnap *d) {
  int s, i;
  for (s = 0; s < SCR_ARRCEN_SLOTS; s++) {
    d->calls[s] = scr_arrcen_calls[s];
    d->total[s] = scr_arrcen_total[s];
    for (i = 0; i < SCR_ARRCEN_ROWS; i++) d->rows[s][i] = scr_arrcen_rows[s][i];
  }
  for (i = 0; i < SCR_ARRCEN_KINDS; i++) {
    d->kind_calls[i] = scr_arrcen_kind_calls[i];
    d->kind_elems[i] = scr_arrcen_kind_elems[i];
  }
  for (i = 0; i < SCR_ARRCEN_ELEMS; i++) {
    d->bget_elem[i] = scr_arrcen_bget_elem[i];
    d->bset_elem[i] = scr_arrcen_bset_elem[i];
  }
  d->whole = scr_arrcen_slice_whole;
  d->empty = scr_arrcen_slice_empty;
  d->pump_calls = scr_arrcen_pump_calls;
  d->pump_iters = scr_arrcen_pump_iters;
  d->pump_cycles = scr_arrcen_pump_cycles;
}

/* dst += (now - at_begin), field by field. */
SCR_ARRCEN_FN void scr_arrcen_accum(ScrArrcenSnap *dst) {
  ScrArrcenSnap now;
  int s, i;
  scr_arrcen_capture(&now);
  for (s = 0; s < SCR_ARRCEN_SLOTS; s++) {
    dst->calls[s] += now.calls[s] - scr_arrcen_at_begin.calls[s];
    dst->total[s] += now.total[s] - scr_arrcen_at_begin.total[s];
    for (i = 0; i < SCR_ARRCEN_ROWS; i++)
      dst->rows[s][i] += now.rows[s][i] - scr_arrcen_at_begin.rows[s][i];
  }
  for (i = 0; i < SCR_ARRCEN_KINDS; i++) {
    dst->kind_calls[i] += now.kind_calls[i] - scr_arrcen_at_begin.kind_calls[i];
    dst->kind_elems[i] += now.kind_elems[i] - scr_arrcen_at_begin.kind_elems[i];
  }
  for (i = 0; i < SCR_ARRCEN_ELEMS; i++) {
    dst->bget_elem[i] += now.bget_elem[i] - scr_arrcen_at_begin.bget_elem[i];
    dst->bset_elem[i] += now.bset_elem[i] - scr_arrcen_at_begin.bset_elem[i];
  }
  dst->whole += now.whole - scr_arrcen_at_begin.whole;
  dst->empty += now.empty - scr_arrcen_at_begin.empty;
  dst->pump_calls += now.pump_calls - scr_arrcen_at_begin.pump_calls;
  dst->pump_iters += now.pump_iters - scr_arrcen_at_begin.pump_iters;
  dst->pump_cycles += now.pump_cycles - scr_arrcen_at_begin.pump_cycles;
}

SCR_ARRCEN_FN int scr_arrcen_phslot(const char *name) {
  int i, k;
  for (i = 0; i < scr_arrcen_nph; i++)
    if (strcmp(scr_arrcen_phname[i], name) == 0) return i;
  if (scr_arrcen_nph >= SCR_ARRCEN_MAXPH) return -1;
  i = scr_arrcen_nph++;
  for (k = 0; k + 1 < SCR_ARRCEN_NAMELEN && name[k] != 0; k++)
    scr_arrcen_phname[i][k] = name[k];
  scr_arrcen_phname[i][k] = 0;
  return i;
}

/* Called from scr_console.c for EVERY console.log line. The two markers are
 * six lines in a run of tens of thousands, so the strncmp is the whole cost.
 * `line` is not NUL-terminated by the caller -- length is explicit. */
SCR_ARRCEN_FN void scr_arrcen_phase_line(const char *line, unsigned long long len) {
  char name[SCR_ARRCEN_NAMELEN];
  unsigned long long i, o;
  int begin;
  if (len < 14) return;
  if (line[0] != '[') return;
  if (strncmp(line, "[phase-begin] ", 14) == 0) begin = 1;
  else if (len >= 12 && strncmp(line, "[phase-end] ", 12) == 0) begin = 0;
  else return;
  i = begin ? 14 : 12;
  for (o = 0; i < len && o + 1 < SCR_ARRCEN_NAMELEN; i++) {
    if (line[i] == '\n' || line[i] == '\r') break;
    name[o++] = line[i];
  }
  name[o] = 0;
  scr_arrcen_marks++;
  if (begin) {
    scr_arrcen_curph = scr_arrcen_phslot(name);
    scr_arrcen_capture(&scr_arrcen_at_begin);
  } else if (scr_arrcen_curph >= 0) {
    scr_arrcen_accum(&scr_arrcen_ph[scr_arrcen_curph]);
    scr_arrcen_curph = -1;
  }
}

SCR_ARRCEN_FN void scr_arrcen_report_phases(FILE *f) {
  int p, s, i;
  fprintf(f, "ARRCEN-PHASES n=%d marks=%lld\n", scr_arrcen_nph, scr_arrcen_marks);
  for (p = 0; p < scr_arrcen_nph; p++) {
    const ScrArrcenSnap *d = &scr_arrcen_ph[p];
    fprintf(f, "ARRCEN-PH %s slice.whole=%lld slice.empty=%lld pump.calls=%lld pump.iters=%lld pump.cycles=%llu\n",
            scr_arrcen_phname[p], d->whole, d->empty, d->pump_calls, d->pump_iters,
            d->pump_cycles);
    for (s = 0; s < SCR_ARRCEN_SLOTS; s++)
      fprintf(f, "ARRCEN-PHSLOT %s %s calls=%lld total=%lld\n", scr_arrcen_phname[p],
              scr_arrcen_name(s), d->calls[s], d->total[s]);
    for (i = 0; i < SCR_ARRCEN_KINDS; i++) {
      if (d->kind_calls[i] == 0) continue;
      fprintf(f, "ARRCEN-PHKIND %s %d calls=%lld elems=%lld\n", scr_arrcen_phname[p], i,
              d->kind_calls[i], d->kind_elems[i]);
    }
    for (i = 0; i < SCR_ARRCEN_ELEMS; i++) {
      if (d->bget_elem[i] == 0 && d->bset_elem[i] == 0) continue;
      fprintf(f, "ARRCEN-PHELEM %s %s get=%lld set=%lld\n", scr_arrcen_phname[p],
              scr_arrcen_elem_name(i), d->bget_elem[i], d->bset_elem[i]);
    }
    for (s = 0; s < SCR_ARRCEN_SLOTS; s++)
      for (i = 0; i < SCR_ARRCEN_ROWS; i++) {
        if (d->rows[s][i] == 0) continue;
        fprintf(f, "ARRCEN-PHROW %s %s %d %lld\n", scr_arrcen_phname[p],
                scr_arrcen_name(s), i, d->rows[s][i]);
      }
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
  fprintf(f, "ARRCEN-PUMP calls=%lld iters=%lld cycles=%llu wallms=%lld\n",
          scr_arrcen_pump_calls, scr_arrcen_pump_iters, scr_arrcen_pump_cycles,
          scr_arrcen_pump_ms);
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
  for (i = 0; i < SCR_ARRCEN_ELEMS; i++) {
    if (scr_arrcen_bget_elem[i] == 0 && scr_arrcen_bset_elem[i] == 0) continue;
    fprintf(f, "ARRCEN-ELEM %s get=%lld set=%lld\n", scr_arrcen_elem_name(i),
            scr_arrcen_bget_elem[i], scr_arrcen_bset_elem[i]);
  }
  for (s = 0; s < SCR_ARRCEN_SLOTS; s++) {
    for (i = 0; i < SCR_ARRCEN_ROWS; i++) {
      if (scr_arrcen_rows[s][i] == 0) continue;
      fprintf(f, "ARRCEN-ROW %s %d %lld\n", scr_arrcen_name(s), i,
              scr_arrcen_rows[s][i]);
    }
  }
  scr_arrcen_report_phases(f);
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
    /* The element split gets its OWN plant, in a kind this workload cannot
     * produce (SCR_BYTES_BUF has no index signature), so "the split never
     * compiled in" and "this program reads no f64" stay distinguishable. */
    for (i = 0; i < n; i++) scr_arrcen_note_bytes(SCR_ARRCEN_BYTESGET, 41, 6);
    scr_arrcen_planted = n;
  }
  atexit(scr_arrcen_report);
}

#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) (scr_arrcen_report(), _Exit(c))

#endif /* SCR_ARR_CENSUS_H */
