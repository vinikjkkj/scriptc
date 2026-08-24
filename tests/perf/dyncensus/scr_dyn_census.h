/* scr_dyn_census.h — WHAT is inside the 46,719 live ScrDyn values.
 *
 * WHY THIS EXISTS. tests/perf/cycensus keys every cycle allocation on the
 * ScrCycFreeFn it is handed, which names the object KIND exactly and found
 * that one kind — `scr_dyn_gcfree`, i.e. ScrDyn — is 67.78% of zapo's cycle
 * heap: 4,858,776 B in 46,719 objects. It cannot say anything about what any
 * of those objects HOLD, because every ScrDyn arrives through the same
 * free_fn no matter which of its fourteen kinds it is and which of its
 * eleven union arms is live.
 *
 * This lane keys on `ScrDyn.kind` and, at the live-population peak, WALKS
 * every live ScrDyn and reads it. That is the only way to answer the
 * questions a representation change needs answered:
 *
 *   - how many of the live values are which kind (the union arm that is
 *     actually live, per object);
 *   - how much of each object is PADDING and how much is a dead union arm;
 *   - for SCR_DYN_OBJ, how many members it really has, how big its `entries`
 *     buffer is, how long its keys are, and how often `proto` / `cname` /
 *     `hidden` / `slots` are non-NULL at all;
 *   - for SCR_DYN_STR, the string length distribution (does an inline small
 *     string pay?);
 *   - the observed maxima of every field a narrowing would touch — `rc`,
 *     `obj.len`, `obj.cap`, `arr.len`, `arr.cap`, `key_len`, `fn.arity` —
 *     so "size_t is wider than this program ever needs" is a measurement
 *     and not a preference.
 *
 * WHAT IT DOES NOT DO. It does not hook malloc, it does not walk frames and
 * it does not need `-fno-omit-frame-pointer`. It sees the population the
 * PROGRAM holds: a node parked on scr_json.c's per-kind dyn freelist has
 * already been handed to the dead hook, so it is not counted as live. That
 * is deliberate and it is the difference between this and any lane below
 * scr_json.c, to which a parked node is indistinguishable from a held one.
 *
 * LINKAGE is scr_prof.h's and scr_cyc_census.h's, for their reason: on
 * x86_64-windows-gnu a `weak` definition in every TU is 38 duplicate-symbol
 * errors rather than one merged instance. Data is `selectany` (COMDAT,
 * merged, ONE counter), functions are `static`.
 *
 * NO <windows.h>, for scr_cyc_census.h's reason (scr_fetch_dispatch.c's
 * `fd_set` collision).
 *
 * THIS HEADER CANNOT SEE ScrDyn. It is `-include`d, so it is processed
 * before scr_runtime.h and `struct ScrDyn` is not yet declared when it is
 * read. It therefore holds the STATE, the pointer table and the report, and
 * the WALK that reads an ScrDyn lives in scr_dyn_census_walk.h, which
 * scr_json.c includes from inside its own `#ifdef SCR_DYNCEN_ON` block at a
 * point where the type is complete.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <win>/tests/perf/dyncensus/scr_dyn_census.h
 *                        -I<win>/tests/perf/dyncensus"
 *   SCR_DYNCEN_OUT=<file>           where the report is written
 *   -DSCR_DYNCEN_ARM=64             plant a known population; the reader
 *                                   refuses every number without it
 * <win> must be a WINDOWS path (cygpath -m): `zig cc` is a Windows binary
 * spawned by node and never sees an MSYS path.
 *
 * The hooks are five `#ifdef SCR_DYNCEN_ON` lines in scr_json.c. With this
 * header absent the symbol is undefined and every one of them vanishes, so
 * an uninstrumented build is byte-identical — which is checked, not assumed.
 */
#ifndef SCR_DYN_CENSUS_H
#define SCR_DYN_CENSUS_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

/* The switch scr_json.c's hook lines test. */
#define SCR_DYNCEN_ON 1

#define SCR_DYNCEN_SHARED __attribute__((selectany))
#define SCR_DYNCEN_FN static __attribute__((unused)) __attribute__((no_instrument_function))

/* ScrDynKind has 14 members today (NULL..MAP) and the enum grows by
 * APPENDING — the LLVM backend hardcodes the numbers. 32 rows is room for
 * eighteen more; a kind at or above the bound bumps scr_dyncen_lost, which
 * the reader refuses on, so it can never read as a zero. (scr_json.c's own
 * `scr_dyn_live_by_kind` was once spelled `[SCR_DYN_BIG + 1]` and a new
 * kind wrote one past the end of it; the bound here is deliberately
 * generous and deliberately checked.) */
#define SCR_DYNCEN_KINDS 32u

/* A hard ceiling on SIMULTANEOUSLY LIVE ScrDyn values. zapo holds ~47,000;
 * 2^18 slots x 8 B = 2 MB of BSS, which is zero pages until touched and is
 * reported as tableBytes so nobody subtracts it from the instrumented run's
 * RSS and calls the remainder the program's. */
#ifndef SCR_DYNCEN_PSLOTS
#define SCR_DYNCEN_PSLOTS (1u << 18)
#endif

/* The growth curve: one sample every N allocations. */
#ifndef SCR_DYNCEN_CURVE_EVERY
#define SCR_DYNCEN_CURVE_EVERY 500u
#endif
#ifndef SCR_DYNCEN_CURVE_MAX
#define SCR_DYNCEN_CURVE_MAX 4096u
#endif

/* The per-kind snapshot band. A snapshot WALKS every live object, so it is
 * O(live) and cannot run on all 47,000 growth steps (that is 1.1 billion
 * reads). It is taken when the live count has grown past the last snapshot
 * by more than this or a 512th, whichever is larger, so the breakdown is
 * within that band of the true peak — and the band is printed. */
#ifndef SCR_DYNCEN_SNAP_MIN
#define SCR_DYNCEN_SNAP_MIN 256
#endif

/* Length buckets, shared by obj.len, arr.len and str.len so one reader
 * renders all three: 0, 1, 2, 3, 4, 5-8, 9-16, 17-32, 33-64, 65+. */
#define SCR_DYNCEN_BUCKETS 10
SCR_DYNCEN_FN int scr_dyncen_bucket(long long n) {
  if (n < 5) return (int)n;
  if (n <= 8) return 5;
  if (n <= 16) return 6;
  if (n <= 32) return 7;
  if (n <= 64) return 8;
  return 9;
}

typedef struct {
  long long n;            /* live objects of this kind */
  long long rc_sum, rc_max;
  long long f_buffer, f_nullproto, f_staticcopy;
  /* OBJ and ARR: the member/element count and the buffer behind it. */
  long long len_sum, cap_sum, len_max, cap_max;
  long long len_hist[SCR_DYNCEN_BUCKETS];
  long long side_bytes;   /* cap * sizeof(entry|item) — the malloc'd buffer */
  long long n_empty_buf;  /* live objects whose buffer pointer is NULL */
  /* OBJ only. */
  long long has_proto, has_cname, has_hidden, has_slots, has_any_extra;
  long long key_n, key_bytes, key_max;
  long long key_le7, key_le15, key_le23, key_le31;
  /* STR only: the ScrStr behind the pointer. */
  long long str_len_sum, str_len_max, str_phys;
  long long str_hist[SCR_DYNCEN_BUCKETS];
  long long str_le7, str_le15, str_le23, str_le31;
  /* FUNC only. */
  long long fn_sig, fn_name, fn_src, fn_arity_max;
  /* HANDLE / OBJINST / MAP: how many carry a non-NULL side pointer. */
  long long aux_nonnull;
} ScrDynCenKind;

SCR_DYNCEN_SHARED ScrDynCenKind scr_dyncen_snap[SCR_DYNCEN_KINDS] = {{0}};
/* The same rows filled by the LAST walk, so the reader can compare the
 * at-exit population against the at-peak one without a second run. */
SCR_DYNCEN_SHARED ScrDynCenKind scr_dyncen_exit[SCR_DYNCEN_KINDS] = {{0}};
/* Cheap per-kind counters maintained on the alloc/dead path itself (no
 * walk): allocations ever, deaths ever, live now. These are the control on
 * the walk — the walk's own per-kind `n` must equal live_now, and the
 * reader refuses if it does not. */
SCR_DYNCEN_SHARED long long scr_dyncen_alloc_by_kind[SCR_DYNCEN_KINDS] = {0};
SCR_DYNCEN_SHARED long long scr_dyncen_dead_by_kind[SCR_DYNCEN_KINDS] = {0};
SCR_DYNCEN_SHARED long long scr_dyncen_live_by_kind[SCR_DYNCEN_KINDS] = {0};

SCR_DYNCEN_SHARED const void *scr_dyncen_ptbl[SCR_DYNCEN_PSLOTS] = {0};

SCR_DYNCEN_SHARED long long scr_dyncen_alloc_total = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_dead_total = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_live_n = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_live_peak = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_lost = 0;        /* kind >= KINDS */
SCR_DYNCEN_SHARED long long scr_dyncen_ptr_lost = 0;    /* table full */
SCR_DYNCEN_SHARED long long scr_dyncen_dead_unknown = 0;/* dead, never seen alive */
SCR_DYNCEN_SHARED long long scr_dyncen_snaps = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_snap_n = 0;      /* live_n at the snapshot */
SCR_DYNCEN_SHARED long long scr_dyncen_snap_ord = 0;    /* allocation ordinal */
SCR_DYNCEN_SHARED long long scr_dyncen_snap_t = 0;      /* seconds since first alloc */
SCR_DYNCEN_SHARED long long scr_dyncen_walks = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_walk_reads = 0;
SCR_DYNCEN_SHARED int scr_dyncen_reported = 0;
SCR_DYNCEN_SHARED int scr_dyncen_armed = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_arm_n = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_t0 = 0;

/* Sizes and offsets as THIS BUILD actually has them, stamped by the walk
 * header (which is the only place that can see the type). The whole point
 * of the census is per-object overhead, so not one byte of it may come
 * from a constant in the reader. */
SCR_DYNCEN_SHARED long long scr_dyncen_sizeof_dyn = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_sizeof_hdr = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_sizeof_entry = 0;
/* 0 on a build whose OBJ arm still carries its four rare members inline;
 * sizeof(ScrDynObjExt) once they moved behind one pointer. Printed beside
 * the arm widths so two revisions' maps can be read against each other
 * without either assuming the other's layout. */
SCR_DYNCEN_SHARED long long scr_dyncen_sizeof_ext = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_sizeof_str = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_off_union = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_sizeof_union = 0;
SCR_DYNCEN_SHARED long long scr_dyncen_kind_count = 0;
/* The physical width of each union ARM, so "how much of the union is dead
 * for this kind" is arithmetic rather than a guess. Indexed by kind. */
SCR_DYNCEN_SHARED long long scr_dyncen_arm_bytes[SCR_DYNCEN_KINDS] = {0};

/* [ord, liveN, secondsSinceFirstAlloc]. The clock is only in the CURVE
 * samples, never on the allocation path itself. */
SCR_DYNCEN_SHARED long long scr_dyncen_curve[SCR_DYNCEN_CURVE_MAX][3] = {{0}};
SCR_DYNCEN_SHARED long long scr_dyncen_ncurve = 0;

SCR_DYNCEN_FN unsigned scr_dyncen_phash(const void *p) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  return (unsigned)(x & (SCR_DYNCEN_PSLOTS - 1u));
}

/* Backward-shift deletion, not tombstones: a workload that frees most of
 * what it allocates turns every touched slot into a non-empty one, and a
 * linear probe that stops only at an EMPTY slot then walks without bound.
 * (scr_cyc_census.h's table, and its reason, verbatim.) */
SCR_DYNCEN_FN void scr_dyncen_ptbl_erase(unsigned hole) {
  unsigned mask = SCR_DYNCEN_PSLOTS - 1u;
  scr_dyncen_ptbl[hole] = NULL;
  for (unsigned k = (hole + 1u) & mask; scr_dyncen_ptbl[k] != NULL; k = (k + 1u) & mask) {
    unsigned ideal = scr_dyncen_phash(scr_dyncen_ptbl[k]);
    int blocked = (hole <= k) ? (ideal > hole && ideal <= k) : (ideal > hole || ideal <= k);
    if (blocked) continue;
    scr_dyncen_ptbl[hole] = scr_dyncen_ptbl[k];
    scr_dyncen_ptbl[k] = NULL;
    hole = k;
  }
}

SCR_DYNCEN_FN void scr_dyncen_ptbl_add(const void *p) {
  unsigned h = scr_dyncen_phash(p);
  unsigned i;
  for (i = 0; i < SCR_DYNCEN_PSLOTS; i++) {
    unsigned j = (h + i) & (SCR_DYNCEN_PSLOTS - 1u);
    if (scr_dyncen_ptbl[j] == NULL) { scr_dyncen_ptbl[j] = p; return; }
    if (scr_dyncen_ptbl[j] == p) return; /* already live: not an insert */
  }
  scr_dyncen_ptr_lost++;
}

/* 1 when the pointer was live and has been removed. */
SCR_DYNCEN_FN int scr_dyncen_ptbl_del(const void *p) {
  unsigned h = scr_dyncen_phash(p);
  for (unsigned i = 0; i < SCR_DYNCEN_PSLOTS; i++) {
    unsigned j = (h + i) & (SCR_DYNCEN_PSLOTS - 1u);
    if (scr_dyncen_ptbl[j] == NULL) return 0;
    if (scr_dyncen_ptbl[j] == p) { scr_dyncen_ptbl_erase(j); return 1; }
  }
  return 0;
}

SCR_DYNCEN_FN void scr_dyncen_report(void) {
  if (scr_dyncen_reported) return;
  scr_dyncen_reported = 1;
  {
    const char *path = getenv("SCR_DYNCEN_OUT");
    FILE *f = fopen(path && *path ? path : "scr-dyncen.txt", "w");
    if (!f) return;
    fprintf(f,
            "DYNCEN-LAYOUT sizeofDyn=%lld sizeofHdr=%lld sizeofEntry=%lld "
            "sizeofStr=%lld offUnion=%lld sizeofUnion=%lld kindCount=%lld sizeofExt=%lld\n",
            scr_dyncen_sizeof_dyn, scr_dyncen_sizeof_hdr, scr_dyncen_sizeof_entry,
            scr_dyncen_sizeof_str, scr_dyncen_off_union, scr_dyncen_sizeof_union,
            scr_dyncen_kind_count, scr_dyncen_sizeof_ext);
    for (unsigned k = 0; k < SCR_DYNCEN_KINDS; k++)
      fprintf(f, "DYNCEN-ARM %u %lld\n", k, scr_dyncen_arm_bytes[k]);
    for (unsigned k = 0; k < SCR_DYNCEN_KINDS; k++)
      fprintf(f, "DYNCEN-COUNT %u %lld %lld %lld\n", k, scr_dyncen_alloc_by_kind[k],
              scr_dyncen_dead_by_kind[k], scr_dyncen_live_by_kind[k]);
    {
      int pass;
      for (pass = 0; pass < 2; pass++) {
        const ScrDynCenKind *rows = pass == 0 ? scr_dyncen_snap : scr_dyncen_exit;
        const char *tag = pass == 0 ? "PEAK" : "EXIT";
        unsigned k;
        for (k = 0; k < SCR_DYNCEN_KINDS; k++) {
          const ScrDynCenKind *r = &rows[k];
          int b;
          if (r->n == 0) continue;
          fprintf(f,
                  "DYNCEN-%s %u n=%lld rcSum=%lld rcMax=%lld fBuf=%lld fNullProto=%lld "
                  "fStaticCopy=%lld lenSum=%lld capSum=%lld lenMax=%lld capMax=%lld "
                  "side=%lld emptyBuf=%lld proto=%lld cname=%lld hidden=%lld slots=%lld "
                  "anyExtra=%lld keyN=%lld keyBytes=%lld keyMax=%lld keyLe7=%lld "
                  "keyLe15=%lld keyLe23=%lld keyLe31=%lld strLenSum=%lld strLenMax=%lld "
                  "strPhys=%lld strLe7=%lld strLe15=%lld strLe23=%lld strLe31=%lld "
                  "fnSig=%lld fnName=%lld fnSrc=%lld fnArityMax=%lld aux=%lld\n",
                  tag, k, r->n, r->rc_sum, r->rc_max, r->f_buffer, r->f_nullproto,
                  r->f_staticcopy, r->len_sum, r->cap_sum, r->len_max, r->cap_max,
                  r->side_bytes, r->n_empty_buf, r->has_proto, r->has_cname, r->has_hidden,
                  r->has_slots, r->has_any_extra, r->key_n, r->key_bytes, r->key_max,
                  r->key_le7, r->key_le15, r->key_le23, r->key_le31, r->str_len_sum,
                  r->str_len_max, r->str_phys, r->str_le7, r->str_le15, r->str_le23,
                  r->str_le31, r->fn_sig, r->fn_name, r->fn_src, r->fn_arity_max,
                  r->aux_nonnull);
          fprintf(f, "DYNCEN-%s-LEN %u", tag, k);
          for (b = 0; b < SCR_DYNCEN_BUCKETS; b++) fprintf(f, " %lld", r->len_hist[b]);
          fprintf(f, "\n");
          fprintf(f, "DYNCEN-%s-STRLEN %u", tag, k);
          for (b = 0; b < SCR_DYNCEN_BUCKETS; b++) fprintf(f, " %lld", r->str_hist[b]);
          fprintf(f, "\n");
        }
      }
    }
    for (long long i = 0; i < scr_dyncen_ncurve; i++)
      fprintf(f, "DYNCEN-CURVE %lld %lld %lld %lld\n", i, scr_dyncen_curve[i][0],
              scr_dyncen_curve[i][1], scr_dyncen_curve[i][2]);
    fprintf(f,
            "DYNCEN-TOTAL allocs=%lld deaths=%lld liveN=%lld livePeak=%lld snapN=%lld "
            "snapOrd=%lld snapT=%lld snaps=%lld snapBand=%lld walks=%lld walkReads=%lld "
            "lost=%lld ptrLost=%lld deadUnknown=%lld armN=%lld pslots=%u "
            "tableBytes=%lld\n",
            scr_dyncen_alloc_total, scr_dyncen_dead_total, scr_dyncen_live_n,
            scr_dyncen_live_peak, scr_dyncen_snap_n, scr_dyncen_snap_ord,
            scr_dyncen_snap_t, scr_dyncen_snaps, (long long)SCR_DYNCEN_SNAP_MIN,
            scr_dyncen_walks, scr_dyncen_walk_reads, scr_dyncen_lost,
            scr_dyncen_ptr_lost, scr_dyncen_dead_unknown, scr_dyncen_arm_n,
            (unsigned)SCR_DYNCEN_PSLOTS,
            (long long)(sizeof scr_dyncen_ptbl + sizeof scr_dyncen_curve +
                        sizeof scr_dyncen_snap + sizeof scr_dyncen_exit));
    fclose(f);
  }
}

/* atexit alone cannot report on this target: zapo's entry ends in
 * process.exit(0), which lowers to _Exit and skips every atexit handler.
 * The interposer below closes that, chaining onto scr_prof.h's and
 * scr_cyc_census.h's if either is also -include'd so that ALL reports
 * survive — which is what makes a cross-check between the lanes possible.
 *
 * The final walk runs from here, not from the walk header, because this is
 * the one place that knows the process is ending. scr_dyncen_walk_fn is
 * installed by the walk header's constructor; it is NULL in a TU that never
 * saw ScrDyn, and there is exactly one such installer in the program. */
SCR_DYNCEN_SHARED void (*scr_dyncen_walk_fn)(ScrDynCenKind *) = 0;
SCR_DYNCEN_FN void scr_dyncen_final(void) {
  if (scr_dyncen_reported) return;
  if (scr_dyncen_walk_fn) scr_dyncen_walk_fn(scr_dyncen_exit);
  scr_dyncen_report();
}

__attribute__((constructor)) SCR_DYNCEN_FN void scr_dyncen_install(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  atexit(scr_dyncen_final);
}

/* If scr_prof.h or scr_cyc_census.h is also -include'd it has already
 * defined _Exit, and a macro's previous definition cannot be recovered —
 * so this chains onto them BY NAME, on their own include guards, and this
 * header must be the LAST of the three on the command line. */
#ifdef _Exit
#undef _Exit
#endif
#if defined(SCR_CYC_CENSUS_H) && defined(SCR_PROF_H)
#define _Exit(c) (scr_dyncen_final(), scr_cycen_report(), scr_prof_report(), _Exit(c))
#elif defined(SCR_CYC_CENSUS_H)
#define _Exit(c) (scr_dyncen_final(), scr_cycen_report(), _Exit(c))
#elif defined(SCR_PROF_H)
#define _Exit(c) (scr_dyncen_final(), scr_prof_report(), _Exit(c))
#else
#define _Exit(c) (scr_dyncen_final(), _Exit(c))
#endif

#endif /* SCR_DYN_CENSUS_H */
