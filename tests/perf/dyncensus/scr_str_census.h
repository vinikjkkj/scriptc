/* scr_str_census.h — WHAT the live ScrStr population actually holds.
 *
 * WHY THIS EXISTS. Its sibling `scr_dyn_census.h` walks every live ScrDyn at
 * the population peak. Run against the messaging bench that lane comes back
 * with `snaps=0` and a live ScrDyn peak of ZERO on both SEND scenarios: that
 * workload allocates no ScrDyn at all, so the instrument that was built to
 * price a representation change cannot see the representation this workload
 * is actually made of. The bytes are `ScrMap` arrays and `ScrStr`, and the
 * ScrStr half had no instrument.
 *
 * This is that half, built to the SAME contract as its sibling — the same
 * linkage rules, the same arm, the same "refuse rather than summarise"
 * discipline, and the same reader (`dyncensus.mjs`, which renders a STRCEN
 * section when one is present). It answers:
 *
 *   - the length distribution of RETAINED strings, EXACTLY per byte of `cap`
 *     up to 255 and in log rows above, at the peak of live PHYSICAL bytes;
 *   - the physical cost of that population, priced in the allocator's real
 *     buckets rather than in `sizeof(ScrStr) + cap + 1`;
 *   - what the same population would cost with a DIFFERENT header width, so
 *     "narrowing the header saves N bytes" is arithmetic over a measured
 *     distribution and not a guess about one string;
 *   - cost per REFERENCE against cost per VALUE: the `rc` of every live
 *     string, summed and bucketed;
 *   - the duplication rate: how many of the live strings are byte-equal to
 *     another live string, i.e. what interning could ever recover.
 *
 * WHY `cap` AND NOT `len`. The allocation is sized from `cap`; `len` is what
 * the program can read. They differ on every concat result that took slack
 * (scr_string.c's SCR_STR_CHAIN_SLACK) and on every spare-block reuse. A
 * distribution over `len` would price a change against bytes nobody
 * allocated. Both are reported; `cap` is the one the arithmetic uses.
 *
 * THE PHYSICAL PRICE IS A MEASURED PARAMETER, NOT AN ASSUMPTION. A request
 * of n bytes costs `roundup(n + SCR_STRCEN_MALLOC_HDR, SCR_STRCEN_MALLOC_GRAIN)`
 * physical bytes. Those two numbers are stamped into the report so a reader
 * always knows which allocator the arithmetic assumed, and they are wrong
 * until somebody measures them on the target. On x86_64-windows-gnu with
 * zig 0.16.0's mingw CRT they are 8 and 16, established by allocating
 * 300,000 same-size blocks and taking the modal pointer stride together with
 * the working-set delta per block (`lab/bucket.c`); both agree to 0.8 B, and
 * the stride is 48/64/64/64/80/80/96/96/112/112/112/128/144 for requests of
 * 40/44/48/56/64/72/80/88/89/96/104/112/128. A 16-byte CRT header would put
 * 88 and 96 in the same bin. It does not, and that difference is worth
 * exactly one 16-byte bucket per string here.
 *
 * WHAT IT DOES NOT SEE. Immortal interned literals (`rc == SIZE_MAX`) are
 * emitted as static objects and never pass through scr_str_alloc, so they
 * are not in this population at all — which is correct for a heap census and
 * is why the reader prints the count as "heap strings", never "strings".
 *
 * LINKAGE is scr_dyn_census.h's, for its reason: on x86_64-windows-gnu a
 * `weak` definition in every TU is a duplicate-symbol error rather than one
 * merged instance. Data is `selectany` (COMDAT, merged, ONE counter),
 * functions are `static`.
 *
 * NO <windows.h>, for scr_cyc_census.h's reason (scr_fetch_dispatch.c's
 * `fd_set` collision).
 *
 * THIS HEADER CANNOT SEE ScrStr. It is `-include`d, so it is processed
 * before scr_runtime.h. It holds the STATE, the tables and the report; the
 * WALK that reads an ScrStr lives in scr_str_census_walk.h, which
 * scr_string.c includes from inside its own `#ifdef SCR_STRCEN_ON` block at
 * a point where the type is complete.
 *
 * HOW TO USE IT
 *   SCRIPTC_PROF_CFLAGS="-include <win>/tests/perf/dyncensus/scr_str_census.h
 *                        -I<win>/tests/perf/dyncensus -DSCR_STRCEN_ARM=64"
 *   SCR_STRCEN_OUT=<file>           where the report is written
 * <win> must be a WINDOWS path (cygpath -m): `zig cc` is a Windows binary
 * spawned by node and never sees an MSYS path.
 *
 * The hooks are five `#ifdef SCR_STRCEN_ON` lines in scr_string.c. With this
 * header absent the symbol is undefined and every one of them vanishes, so
 * an uninstrumented build is byte-identical — which is checked, not assumed.
 */
#ifndef SCR_STR_CENSUS_H
#define SCR_STR_CENSUS_H

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The switch scr_string.c's hook lines test. */
#define SCR_STRCEN_ON 1

#define SCR_STRCEN_SHARED __attribute__((selectany))
#define SCR_STRCEN_FN static __attribute__((unused)) __attribute__((no_instrument_function))

/* The allocator's real shape on this target. Overridable so the same
 * instrument can price a different CRT without editing the header; stamped
 * into the report either way, so no number is ever read without its
 * assumption beside it. */
#ifndef SCR_STRCEN_MALLOC_HDR
#define SCR_STRCEN_MALLOC_HDR 8
#endif
#ifndef SCR_STRCEN_MALLOC_GRAIN
#define SCR_STRCEN_MALLOC_GRAIN 16
#endif

/* Exact rows for cap 0..255, then one row per power of two to 2^31, then a
 * final overflow row. Exact rows are what make a bucket-boundary argument
 * checkable: an aggregate over "33-64" cannot tell 63 from 64, and those two
 * differ by a whole allocator bucket. */
#define SCR_STRCEN_EXACT 256
#define SCR_STRCEN_LOG 32
#define SCR_STRCEN_ROWS (SCR_STRCEN_EXACT + SCR_STRCEN_LOG)

SCR_STRCEN_FN int scr_strcen_row(long long cap) {
  if (cap < 0) return SCR_STRCEN_ROWS - 1;
  if (cap < SCR_STRCEN_EXACT) return (int)cap;
  {
    int b = 0;
    unsigned long long v = (unsigned long long)cap;
    while (v > 1 && b < SCR_STRCEN_LOG - 1) { v >>= 1; b++; }
    return SCR_STRCEN_EXACT + (b < SCR_STRCEN_LOG ? b : SCR_STRCEN_LOG - 1);
  }
}

/* A hard ceiling on SIMULTANEOUSLY LIVE heap strings. The messaging bench
 * holds ~1.6M at its peak; 2^22 slots x 8 B = 32 MB of BSS, zero pages until
 * touched, reported as tableBytes so nobody subtracts it from the
 * instrumented run's RSS and calls the remainder the program's. An overflow
 * bumps ptrLost, which the reader REFUSES on — it can never read as a zero. */
#ifndef SCR_STRCEN_PSLOTS
#define SCR_STRCEN_PSLOTS (1u << 22)
#endif

/* The content-hash table the duplication walk uses. Same size, same refusal. */
#ifndef SCR_STRCEN_HSLOTS
#define SCR_STRCEN_HSLOTS (1u << 23)
#endif

/* rc rows: 1, 2, 3, 4, 5-8, 9-16, 17+. */
#define SCR_STRCEN_RCROWS 7
SCR_STRCEN_FN int scr_strcen_rcrow(unsigned long long rc) {
  if (rc <= 4) return rc == 0 ? 0 : (int)rc - 1;
  if (rc <= 8) return 4;
  if (rc <= 16) return 5;
  return 6;
}

/* ── live state, maintained on the alloc/free path itself ─────────────── */

SCR_STRCEN_SHARED long long scr_strcen_hist[SCR_STRCEN_ROWS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_peak_hist[SCR_STRCEN_ROWS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_exit_hist[SCR_STRCEN_ROWS] = {0};

SCR_STRCEN_SHARED long long scr_strcen_live_n = 0;
SCR_STRCEN_SHARED long long scr_strcen_live_cap = 0;  /* sum of cap */
SCR_STRCEN_SHARED long long scr_strcen_live_phys = 0; /* allocator buckets */

/* THERE IS NO INCREMENTAL live_len, AND ITS ABSENCE IS A CORRECTION.
 * The first version of this header carried one, incremented at birth and
 * decremented at death with `s->len`, and it DRIFTED: scr_str_concat's
 * in-place arm mutates `a->len` on a string that is already live, so the
 * value handed to died() is not the value handed to born(). It read a mean
 * retained length of 21.1 bytes on a population whose true mean is 41 — a
 * plausible number, half the truth, with nothing in the report to mark it.
 * `cap` has no such problem: nothing mutates it except scr_str_regrow, which
 * is hooked on both sides, and `cap` is what the allocation was sized from
 * anyway. Length statistics therefore come from the WALK, which reads the
 * live strings themselves and cannot drift. */
SCR_STRCEN_SHARED long long scr_strcen_peak_phys = 0;
SCR_STRCEN_SHARED long long scr_strcen_peak_n = 0;
SCR_STRCEN_SHARED long long scr_strcen_peak_cap = 0;
SCR_STRCEN_SHARED long long scr_strcen_peak_ord = 0;
SCR_STRCEN_SHARED long long scr_strcen_alloc_total = 0;
SCR_STRCEN_SHARED long long scr_strcen_dead_total = 0;
SCR_STRCEN_SHARED long long scr_strcen_dead_unknown = 0; /* freed, never seen born */
SCR_STRCEN_SHARED long long scr_strcen_ptr_lost = 0;
SCR_STRCEN_SHARED long long scr_strcen_hash_lost = 0;
SCR_STRCEN_SHARED long long scr_strcen_cap_max = 0;
SCR_STRCEN_SHARED long long scr_strcen_len_max = 0;
SCR_STRCEN_SHARED int scr_strcen_reported = 0;
SCR_STRCEN_SHARED long long scr_strcen_arm_n = 0;
SCR_STRCEN_SHARED long long scr_strcen_arm_cap = 0;

/* Stamped by the walk header, which is the only place that can see the
 * type. The whole point is per-string overhead, so not one byte of it may
 * come from a constant in the reader. */
SCR_STRCEN_SHARED long long scr_strcen_sizeof_str = 0;
SCR_STRCEN_SHARED long long scr_strcen_off_data = 0;
SCR_STRCEN_SHARED long long scr_strcen_pool_grain = 0;
SCR_STRCEN_SHARED long long scr_strcen_chain_slack = -1;

/* The peak WALK's results: rc distribution and duplication. */
/* TWO SETS OF WALK RESULTS, AND THAT IS ALSO A CORRECTION. The first version
 * had one, and the walk that runs at exit OVERWROTE the walk that ran at the
 * peak: on a bench that frees everything before returning, the report came
 * back saying the peak population was 64 strings, 1 distinct, 100% ASCII —
 * the ARM, and nothing else. It was not obviously wrong, which is what made
 * it dangerous. Set 0 is the peak walk, set 1 the exit walk; the reader
 * prints both and refuses if set 0 never ran. */
#define SCR_STRCEN_WALKSETS 2
SCR_STRCEN_SHARED long long scr_strcen_walks = 0;
SCR_STRCEN_SHARED long long scr_strcen_walk_n[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_rc_sum[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_rc_max[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_rc[SCR_STRCEN_WALKSETS][SCR_STRCEN_RCROWS] = {{0}};
SCR_STRCEN_SHARED long long scr_strcen_walk_distinct[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_dup_bytes[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_ascii[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_phys[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_len_sum[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_len_max[SCR_STRCEN_WALKSETS] = {0};
SCR_STRCEN_SHARED long long scr_strcen_walk_at_n[SCR_STRCEN_WALKSETS] = {0};

SCR_STRCEN_SHARED const void *scr_strcen_ptbl[SCR_STRCEN_PSLOTS] = {0};

/* Physical bytes an allocation request of n costs. */
SCR_STRCEN_FN long long scr_strcen_phys_of_req(long long req) {
  long long g = SCR_STRCEN_MALLOC_GRAIN;
  long long v = req + SCR_STRCEN_MALLOC_HDR;
  return (v + g - 1) / g * g;
}

SCR_STRCEN_FN unsigned scr_strcen_phash(const void *p) {
  unsigned long long x = (unsigned long long)(size_t)p;
  x ^= x >> 33;
  x *= 0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  x *= 0xc4ceb9fe1a85ec53ULL;
  x ^= x >> 32;
  return (unsigned)(x & (SCR_STRCEN_PSLOTS - 1u));
}

/* Backward-shift deletion, not tombstones: a workload that frees most of
 * what it allocates turns every touched slot into a non-empty one, and a
 * linear probe that stops only at an EMPTY slot then walks without bound.
 * (scr_dyn_census.h's table, and its reason, verbatim.) */
SCR_STRCEN_FN void scr_strcen_ptbl_erase(unsigned hole) {
  unsigned mask = SCR_STRCEN_PSLOTS - 1u;
  scr_strcen_ptbl[hole] = NULL;
  for (unsigned k = (hole + 1u) & mask; scr_strcen_ptbl[k] != NULL; k = (k + 1u) & mask) {
    unsigned ideal = scr_strcen_phash(scr_strcen_ptbl[k]);
    int blocked = (hole <= k) ? (ideal > hole && ideal <= k) : (ideal > hole || ideal <= k);
    if (blocked) continue;
    scr_strcen_ptbl[hole] = scr_strcen_ptbl[k];
    scr_strcen_ptbl[k] = NULL;
    hole = k;
  }
}

SCR_STRCEN_FN void scr_strcen_ptbl_add(const void *p) {
  unsigned h = scr_strcen_phash(p);
  unsigned i;
  for (i = 0; i < SCR_STRCEN_PSLOTS; i++) {
    unsigned j = (h + i) & (SCR_STRCEN_PSLOTS - 1u);
    if (scr_strcen_ptbl[j] == NULL) { scr_strcen_ptbl[j] = p; return; }
    if (scr_strcen_ptbl[j] == p) return; /* already live: not an insert */
  }
  scr_strcen_ptr_lost++;
}

SCR_STRCEN_FN int scr_strcen_ptbl_del(const void *p) {
  unsigned h = scr_strcen_phash(p);
  for (unsigned i = 0; i < SCR_STRCEN_PSLOTS; i++) {
    unsigned j = (h + i) & (SCR_STRCEN_PSLOTS - 1u);
    if (scr_strcen_ptbl[j] == NULL) return 0;
    if (scr_strcen_ptbl[j] == p) { scr_strcen_ptbl_erase(j); return 1; }
  }
  return 0;
}

/* ── the two hooks scr_string.c calls ─────────────────────────────────── */

/* Installed by the walk header; NULL in a build that never saw ScrStr.
 * Declared here because born() below triggers it. */
SCR_STRCEN_SHARED void (*scr_strcen_walk_hook)(void) = 0;

/* The peak is the peak of live PHYSICAL bytes, not of live COUNT: a
 * population that trades 1,000 long strings for 1,100 short ones has more
 * strings and less memory, and it is memory the change is about.
 *
 * The histogram snapshot is banded (0.1% + 64 KiB) so a 1.6-million-string
 * growth curve does not memcpy 2.3 KiB on every allocation; the band is
 * printed, so the distribution is known to be within it of the true peak.
 * The WALK is banded far more coarsely (1.25x) because it is O(live) and
 * hashes every payload. */
SCR_STRCEN_SHARED long long scr_strcen_snap_at = 0;
SCR_STRCEN_SHARED long long scr_strcen_walk_at = 0;

SCR_STRCEN_SHARED int scr_strcen_walk_due = 0;

SCR_STRCEN_FN void scr_strcen_born(const void *p, long long len, long long cap) {
  /* The walk is DEFERRED by one allocation on purpose. It is triggered from
   * inside scr_str_alloc, whose caller has not yet written data[] — walking
   * from there would hash a block of undefined bytes and, worse, READ them.
   * Running it at the top of the NEXT birth means every string the walk sees
   * has been through its caller's fill. */
  if (scr_strcen_walk_due && scr_strcen_walk_hook) {
    scr_strcen_walk_due = 0;
    scr_strcen_walk_hook();
  }
  scr_strcen_alloc_total++;
  scr_strcen_live_n++;
  scr_strcen_live_cap += cap;
  scr_strcen_live_phys +=
      scr_strcen_phys_of_req(scr_strcen_sizeof_str + cap + 1);
  scr_strcen_hist[scr_strcen_row(cap)]++;
  if (cap > scr_strcen_cap_max) scr_strcen_cap_max = cap;
  if (len > scr_strcen_len_max) scr_strcen_len_max = len;
  scr_strcen_ptbl_add(p);
  if (scr_strcen_live_phys > scr_strcen_snap_at) {
    scr_strcen_snap_at = scr_strcen_live_phys + scr_strcen_live_phys / 1000 + 65536;
    scr_strcen_peak_phys = scr_strcen_live_phys;
    scr_strcen_peak_n = scr_strcen_live_n;
    scr_strcen_peak_cap = scr_strcen_live_cap;
    scr_strcen_peak_ord = scr_strcen_alloc_total;
    memcpy(scr_strcen_peak_hist, scr_strcen_hist, sizeof scr_strcen_peak_hist);
    if (scr_strcen_live_phys > scr_strcen_walk_at && scr_strcen_walk_hook) {
      scr_strcen_walk_at = scr_strcen_live_phys + scr_strcen_live_phys / 4 + (1 << 20);
      scr_strcen_walk_due = 1;
    }
  }
}

SCR_STRCEN_FN void scr_strcen_died(const void *p, long long len, long long cap) {
  (void)len; /* see the note on live_len above: it drifts, so it is not kept */
  scr_strcen_dead_total++;
  if (!scr_strcen_ptbl_del(p)) { scr_strcen_dead_unknown++; return; }
  scr_strcen_live_n--;
  scr_strcen_live_cap -= cap;
  scr_strcen_live_phys -=
      scr_strcen_phys_of_req(scr_strcen_sizeof_str + cap + 1);
  scr_strcen_hist[scr_strcen_row(cap)]--;
}

SCR_STRCEN_FN void scr_strcen_report(void) {
  if (scr_strcen_reported) return;
  scr_strcen_reported = 1;
  {
    const char *path = getenv("SCR_STRCEN_OUT");
    FILE *f = fopen(path && *path ? path : "scr-strcen.txt", "w");
    int i;
    if (!f) return;
    fprintf(f,
            "STRCEN-LAYOUT sizeofStr=%lld offData=%lld poolGrain=%lld "
            "chainSlack=%lld mallocHdr=%d mallocGrain=%d exactRows=%d\n",
            scr_strcen_sizeof_str, scr_strcen_off_data, scr_strcen_pool_grain,
            scr_strcen_chain_slack, (int)SCR_STRCEN_MALLOC_HDR,
            (int)SCR_STRCEN_MALLOC_GRAIN, (int)SCR_STRCEN_EXACT);
    for (i = 0; i < SCR_STRCEN_ROWS; i++)
      if (scr_strcen_peak_hist[i] || scr_strcen_exit_hist[i])
        fprintf(f, "STRCEN-ROW %d %lld %lld\n", i, scr_strcen_peak_hist[i],
                scr_strcen_exit_hist[i]);
    {
      int w;
      for (w = 0; w < SCR_STRCEN_WALKSETS; w++) {
        fprintf(f, "STRCEN-RC %d", w);
        for (i = 0; i < SCR_STRCEN_RCROWS; i++)
          fprintf(f, " %lld", scr_strcen_walk_rc[w][i]);
        fprintf(f, "\n");
        fprintf(f,
                "STRCEN-WALK %d walks=%lld n=%lld atLiveN=%lld rcSum=%lld "
                "rcMax=%lld distinct=%lld dupBytes=%lld ascii=%lld phys=%lld "
                "lenSum=%lld lenMax=%lld\n",
                w, scr_strcen_walks, scr_strcen_walk_n[w], scr_strcen_walk_at_n[w],
                scr_strcen_walk_rc_sum[w], scr_strcen_walk_rc_max[w],
                scr_strcen_walk_distinct[w], scr_strcen_walk_dup_bytes[w],
                scr_strcen_walk_ascii[w], scr_strcen_walk_phys[w],
                scr_strcen_walk_len_sum[w], scr_strcen_walk_len_max[w]);
      }
    }
    fprintf(f,
            "STRCEN-TOTAL allocs=%lld deaths=%lld liveN=%lld peakN=%lld "
            "peakPhys=%lld peakCap=%lld peakOrd=%lld exitPhys=%lld "
            "capMax=%lld lenMax=%lld ptrLost=%lld hashLost=%lld deadUnknown=%lld "
            "armN=%lld armCap=%lld pslots=%u tableBytes=%lld\n",
            scr_strcen_alloc_total, scr_strcen_dead_total, scr_strcen_live_n,
            scr_strcen_peak_n, scr_strcen_peak_phys, scr_strcen_peak_cap,
            scr_strcen_peak_ord, scr_strcen_live_phys,
            scr_strcen_cap_max, scr_strcen_len_max, scr_strcen_ptr_lost,
            scr_strcen_hash_lost, scr_strcen_dead_unknown, scr_strcen_arm_n,
            scr_strcen_arm_cap, (unsigned)SCR_STRCEN_PSLOTS,
            (long long)(sizeof scr_strcen_ptbl));
    fclose(f);
  }
}

/* atexit alone cannot report on this target: zapo's entry ends in
 * process.exit(0), which lowers to _Exit and skips every atexit handler.
 * The interposer below closes that, chaining onto the other census headers'
 * if any of them is also -include'd so that ALL reports survive. The final
 * walk runs from here, not from the walk header, because this is the one
 * place that knows the process is ending. */
SCR_STRCEN_SHARED void (*scr_strcen_walk_fn)(int final) = 0;
SCR_STRCEN_FN void scr_strcen_final(void) {
  if (scr_strcen_reported) return;
  if (scr_strcen_walk_fn) scr_strcen_walk_fn(1);
  memcpy(scr_strcen_exit_hist, scr_strcen_hist, sizeof scr_strcen_exit_hist);
  scr_strcen_report();
}

__attribute__((constructor)) SCR_STRCEN_FN void scr_strcen_install(void) {
  static int done = 0;
  if (done) return;
  done = 1;
  atexit(scr_strcen_final);
}

/* If another census header is also -include'd it has already defined _Exit,
 * and a macro's previous definition cannot be recovered — so this chains
 * onto them BY NAME, on their own include guards, and this header must come
 * AFTER them on the command line. */
#ifdef _Exit
#undef _Exit
#endif
#if defined(SCR_DYN_CENSUS_H) && defined(SCR_CYC_CENSUS_H) && defined(SCR_PROF_H)
#define _Exit(c) (scr_strcen_final(), scr_dyncen_final(), scr_cycen_report(), scr_prof_report(), _Exit(c))
#elif defined(SCR_DYN_CENSUS_H)
#define _Exit(c) (scr_strcen_final(), scr_dyncen_final(), _Exit(c))
#elif defined(SCR_CYC_CENSUS_H)
#define _Exit(c) (scr_strcen_final(), scr_cycen_report(), _Exit(c))
#elif defined(SCR_PROF_H)
#define _Exit(c) (scr_strcen_final(), scr_prof_report(), _Exit(c))
#else
#define _Exit(c) (scr_strcen_final(), _Exit(c))
#endif

#endif /* SCR_STR_CENSUS_H */
