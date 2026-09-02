/* Reference-cycle collector: synchronous Bacon–Rajan trial deletion (see
 * "Concurrent Cycle Collection in Reference Counted Systems", the
 * synchronous algorithm) over cycle-headered objects only — the object
 * model and the trace/teardown contract live in scr_runtime.h.
 *
 * Life of a candidate: a release that leaves rc > 0 buffers the object
 * (purple). Collection walks the buffer in three phases over the graph
 * reachable from it:
 *   markGray     trial-delete: decrement rc once per internal edge;
 *   scan         nodes still rc > 0 are externally referenced — re-blacken
 *                their subgraph and restore the trial decrements;
 *   collectWhite everything left white is a dead cycle: free it, releasing
 *                only edges that LEAVE the white set (each member's
 *                teardown releases its untraced children; traced edges were
 *                already accounted by markGray).
 * The white set is gathered first and freed after the walk — freeing
 * during the walk would leave dangling sibling edges for later visits.
 *
 * Correctness leans on two global invariants (docs/memory.md):
 * - every strong reference is counted: stacks, locals, and runtime-owned
 *   buffers (timer callbacks, unhandled-rejection tracking) all hold +1,
 *   so trial deletion can never free something a root still reaches;
 * - mutators unlink before they release: a heap object's stored pointer is
 *   overwritten BEFORE the old value's release runs, so a threshold
 *   collection triggered inside that release never sees an edge whose
 *   count was already given up (which would over-decrement and free live
 *   data).
 *
 * TRAVERSAL DEPTH. All four phases walk an EXPLICIT WORKLIST; the note
 * that used to sit here said the recursion depth equalled the traced
 * structure's depth and was "acceptable for now, revisit with an explicit
 * stack if it ever traps". This is that revisit. The depth is heap now,
 * which matters more here than the arithmetic suggests: a collection can
 * run on a FIBER stack, which is fixed-size and much smaller than the main
 * thread's.
 *
 * IT DID NOT BUY CPU, and the number is in the block above the phases.
 * Measured on the real zapo messaging bench with both forms in ONE binary
 * and an env knob choosing between them, every phase moved less than the
 * A/A floor. The depth is the reason it is here.
 */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Every heap object's first member is `size_t rc`. */
#define SCR_RC(obj) (*(size_t *)(obj))

static void scr_cyc_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* Cycle-headered objects currently allocated — the pacing denominator, see
 * the "pacing" note under the candidate-root buffer. Declared here because
 * the two functions that move it are the allocator and the free below. */
static size_t scr_cyc_live = 0;

/* Cycle-headered objects are the OTHER hot allocation site a compiled
 * program has (scr_string.c is the first): a per-function cycle profile
 * of the closure axis puts 5.2% of the run inside this calloc and 5.4%
 * inside the free below, on 80-byte blocks - a box and a one-capture
 * closure are the same size class. The pool contract is in scr_runtime.h;
 * the only extra work here is stamping the class into the header, since
 * scr_cyc_free is reached from ~16 different teardowns that do not know
 * their own size. */
static ScrPool scr_cyc_blocks;

#ifdef SCR_POOLSTAT_ON
/* tests/perf/poolstat/scr_pool_stat.h is -include'd BEFORE this file's own
 * headers, so it cannot see SCR_POOL_* or ScrPool. This TU can: it hands the
 * lane the build's pool configuration and names the pool it owns. Absent the
 * -include the symbol is undefined and this whole block is not compiled. */
__attribute__((constructor)) static void scr_poolstat_reg_cycle(void) {
  scr_poolstat_cfg(SCR_POOL_GRAIN, SCR_POOL_MAX, SCR_POOL_DEPTH, SCR_POOL_BUDGET);
  scr_poolstat_name(&scr_cyc_blocks, "cyc");
#ifdef SCR_POOLSTAT_ARM
  /* THE ARM. N real gives then N real takes of one known size through a real
   * pool, over the same scr_pool_give/scr_pool_take every other row is
   * counted by. Expected, and it is arithmetic rather than a hope:
   *   budget off, depth D:  gives=N accepts=D rejects=N-D hits=D
   *   budget B (>= N*sz):   gives=N accepts=N rejects=0   hits=N
   * An instrument that cannot tell those two apart cannot adjudicate the
   * question this lane exists for. */
  {
    static ScrPool scr_poolstat_armpool;
    const size_t sz = SCR_POOL_GRAIN * 2u;
    long i;
    scr_poolstat_name(&scr_poolstat_armpool, "ARM");
    for (i = 0; i < (long)(SCR_POOLSTAT_ARM); i++) {
      void *b = malloc(sz);
      if (!b) break;
      if (!scr_pool_give(&scr_poolstat_armpool, b, sz)) free(b);
    }
    for (i = 0; i < (long)(SCR_POOLSTAT_ARM); i++) {
      void *b = scr_pool_take(&scr_poolstat_armpool, sz);
      if (!b) break;
      free(b);
    }
    scr_poolstat_arm_ran = (unsigned long long)(SCR_POOLSTAT_ARM);
  }
#endif
}
#endif

#ifndef SCR_CYC_ZERO_WHOLE
#define SCR_CYC_ZERO_WHOLE 0
#endif

/* The collector's own cost, in cycles, when tests/perf/cycstat's header is
 * force-included with -DSCR_CYCSTAT_ON. Absent that, every hook below is
 * nothing at all and an ordinary build carries no trace of it -- the same
 * arrangement the census above uses, and for the same reason: the frequency
 * knobs answer "does this pay" differentially, and a differential inside the
 * A/A floor cannot tell a small cost from no cost. */
#ifndef SCR_CS_PASS_BEGIN
#define SCR_CS_PASS_BEGIN() ((void)0)
#define SCR_CS_PASS_END() ((void)0)
#define SCR_CS_PHASE_BEGIN() ((void)0)
#define SCR_CS_PHASE_END(which) ((void)0)
#define SCR_CS_ADD(which, n) ((void)0)
#endif

/* The census hook, as one macro rather than an #ifdef inside each arm of
 * the allocator below. With tests/perf/cycensus/scr_cyc_census.h absent
 * this expands to nothing, which is what makes an ordinary build carry no
 * trace of it -- the property that header's comment checks by diffing the
 * two objects. */
#ifdef SCR_CYCEN_ON
#define SCR_CYCEN_NOTE_ALLOC(h, phys, size, fn, pooled) \
  scr_cycen_alloc_note((h), (phys), (size), (const void *)(fn), (pooled))
static inline void scr_cycen_alloc_note(ScrCycHdr *h, size_t phys, size_t size,
                                        const void *fn, int pooled) {
  scr_cycen_hdr_bytes = (long long)sizeof(ScrCycHdr);
  scr_cycen_note_alloc(h, phys, size, fn, pooled, scr_cyc_live);
}
#else
#define SCR_CYCEN_NOTE_ALLOC(h, phys, size, fn, pooled) ((void)0)
#endif

/* The four header fields every arm writes. `blk` is an ARGUMENT and not
 * recomputed here, because the two arms know different things about it:
 * a block scr_pool_take returned is in range by construction, while a
 * calloc'd one may not be. Folding that into one conditional cost five
 * instructions (`shr / xor / cmp / cmovb / mov`) on the path that already
 * knows the answer. */
static inline void scr_cyc_stamp(ScrCycHdr *h, ScrTraceFn trace,
                                 ScrCycFreeFn free_fn, uint8_t blk) {
  h->trace_off = scr_cyc_off((const void *)trace);
  h->free_off = scr_cyc_off((const void *)free_fn);
  h->color = SCR_CYC_BLACK;
  h->blk = blk;
}

/* ── the block arena ──────────────────────────────────────────────────
 * The pool above recycles blocks; it does not change where a block COMES
 * FROM, and on this workload that is where the bytes are. Residency-
 * profiled on the real messaging bench, scr_cyc_alloc_miss's calloc is the
 * #2 live-heap site — 25.25 MiB, 31.31% of the live heap at its
 * high-water — and ScrCycHdr is already hand-minimized to exactly 16
 * bytes, so the header is not what is left. THE COUNT OF CRT BLOCKS IS.
 * Every calloc'd block carries the allocator's own per-block overhead
 * (~24 B measured across the process: ~26.6 MiB over ~1.16M live blocks),
 * and that term is not in any header this file controls.
 *
 * So the miss carves out of 64 KiB chunks instead. Three properties make
 * it cheap to state and safe to free:
 *
 *   NO ARENA HEADER, because ScrCycHdr::blk already carries the block's
 *   physical size class and scr_cyc_free already reads it. The free list
 *   is indexed by that same field, so a block NEVER MIGRATES between
 *   classes — the same invariant the pool relies on, for the same reason.
 *
 *   PROVENANCE IS A HEADER BIT, not a range check. ScrCycHdr::pad was a
 *   spare byte; it is 1 for a carved block. A range check would need one
 *   contiguous reservation, and that means VirtualAlloc, and this runtime
 *   cross-compiles to ELF targets that have no such call (cc-driver's five
 *   ELF cells are what rules it out). A bit in a header we own needs no
 *   platform symbol and is exact.
 *
 *   BLOCKS ARE 16-BYTE ALIGNED: the chunk comes from malloc (16-aligned on
 *   every target here) and the carve stride is `phys` rounded up to 16, so
 *   the OBJECT pointer keeps the alignment the 16-byte header was shaped
 *   to give it.
 *
 * A carved block must never reach free(), so scr_cyc_free has an overflow
 * list for the case where the pool's byte budget rejects the give. The
 * arena does not return chunks; the ~256 B tail of a chunk that cannot fit
 * the next stride is abandoned. Off under SCR_RC_AUDIT for exactly the
 * reason the pool is: that lane exists to prove every logical free is a
 * real free.
 *
 * SCR_CYCLE_ARENA=0 restores the calloc. It is an env knob, not a build
 * flag, so both arms are the same binary. */
#ifndef SCR_CYC_ARENA
#define SCR_CYC_ARENA 1
#endif
#ifndef SCR_CYC_ARENA_CHUNK
#define SCR_CYC_ARENA_CHUNK ((size_t)64 << 10)
#endif

/* One list per SCR_POOL_GRAIN class, indexed by ScrCycHdr::blk (1..32). */
static void *scr_cyc_ar_free[SCR_POOL_MAX / SCR_POOL_GRAIN + 1u];
static unsigned char *scr_cyc_ar_cur = NULL;
static unsigned char *scr_cyc_ar_lim = NULL;

static int scr_cyc_arena_on(void) {
#ifdef SCR_RC_AUDIT
  return 0;
#else
  static int cached = -1;
  if (cached < 0) {
    const char *env = getenv("SCR_CYCLE_ARENA");
    cached = env != NULL ? (strtol(env, NULL, 10) != 0) : (SCR_CYC_ARENA != 0);
  }
  return cached;
#endif
}

/* NULL when the chunk could not be had; every caller falls back to calloc,
 * so a failure here is a slower program and not a broken one. */
static void *scr_cyc_ar_take(size_t phys, uint8_t blk) {
  void *b = scr_cyc_ar_free[blk];
  size_t stride;
  if (b != NULL) {
    __builtin_memcpy(&scr_cyc_ar_free[blk], b, sizeof(void *));
    return b;
  }
  stride = (phys + 15u) & ~(size_t)15u;
  if ((size_t)(scr_cyc_ar_lim - scr_cyc_ar_cur) < stride) {
    unsigned char *c = (unsigned char *)malloc(SCR_CYC_ARENA_CHUNK);
    if (c == NULL) return NULL;
    scr_cyc_ar_cur = c;
    scr_cyc_ar_lim = c + SCR_CYC_ARENA_CHUNK;
  }
  b = scr_cyc_ar_cur;
  scr_cyc_ar_cur += stride;
  return b;
}

static void scr_cyc_ar_give(ScrCycHdr *h) {
  __builtin_memcpy(h, &scr_cyc_ar_free[h->blk], sizeof(void *));
  scr_cyc_ar_free[h->blk] = h;
}

/* The pool miss, and DELIBERATELY the whole of it: the calloc, the stamp,
 * the counter and the return. On closure-churn this runs 5 times in
 * 800,031.
 *
 * Both halves of that are load-bearing and both were measured. `noinline`
 * alone is not enough - with only the calloc out of line, clang still
 * kept `trace`, `free_fn` and `phys` in callee-saved registers across the
 * cold call, and the hot path paid 5 pushes and 5 pops for a path it
 * essentially never takes: 43 instructions per call rather than 33.
 * Taking the SAME three arguments this function does makes the miss a
 * TAIL call, so the hot path holds nothing across anything and needs no
 * frame at all. `phys` is recomputed here rather than passed for the same
 * reason - a fourth argument would be a register shuffle in the caller. */
static __attribute__((noinline)) void *scr_cyc_alloc_miss(size_t size,
                                                          ScrTraceFn trace,
                                                          ScrCycFreeFn free_fn) {
  size_t phys = scr_pool_bytes(sizeof(ScrCycHdr) + size);
  uint8_t blk = phys <= SCR_POOL_MAX ? (uint8_t)(phys / SCR_POOL_GRAIN) : 0u;
  ScrCycHdr *h = NULL;
  uint8_t arena = 0;
  if (blk != 0 && scr_cyc_arena_on()) {
    h = (ScrCycHdr *)scr_cyc_ar_take(phys, blk);
    if (h != NULL) {
      arena = 1;
      memset(h, 0, phys); /* the carve is not zeroed; calloc's contract, kept */
    }
  }
  if (h == NULL) {
    h = calloc(1, phys);
    if (h == NULL) scr_cyc_oom();
    /* calloc zeroed the whole block, `buffered` and `buf_index` included. */
  }
  scr_cyc_stamp(h, trace, free_fn, blk);
  h->pad = arena; /* provenance: 1 = carved, must never reach free() */
  scr_cyc_live++; /* the pacing denominator; see below */
  SCR_CYCEN_NOTE_ALLOC(h, phys, size, free_fn, 0);
  return h + 1;
}

/* WHERE THE 60 INSTRUCTIONS WENT, and where the 33 go now. Read off the
 * disassembly by tests/perf/cycalloc/isa.mjs: x86_64-linux-gnu -O2,
 * closure-churn under callgrind, 800,031 calls, every count exact and
 * reproduced to the instruction by an A/A pair.
 *
 *                                              before  after
 *   the stack frame                              16      3
 *   staging arguments into surviving registers    3      2
 *   scr_pool_bytes' round-up                      3      3
 *   the pool's range check                        3      3
 *   the size-class index                          5      1
 *   the pool pop (head, test, unlink, n--)        7      7
 *   the header stamp, five fields                 8      7
 *   the blk stamp                                 5      1
 *   scr_cyc_live++                                1      1
 *   the object pointer, h + 1                     1      1
 *   memset's arguments                            4      2
 *   the call to memset                            2      2   a tail jmp now
 *   restoring h across that call                  1      0
 *   the branch merge                              1      0
 *   SELF                                         60     33
 *   memset itself, inside libc, NOT self         12     12
 *
 * THE STACK FRAME WAS THE LARGEST SINGLE TERM, 16 of 60 -- seven pushes,
 * seven pops, an rsp alignment and the frame pointer. It is 3 now, and all
 * three are the frame pointer this toolchain does not omit. Two things
 * caused it and neither is the allocation:
 *
 *   the ORDER. The body zeroed the payload FIRST and stamped the header
 *   after, so `trace`, `free_fn` and `phys` all had to survive the memset
 *   and clang put them in callee-saved registers. Stamping first leaves
 *   nothing live across it, and `memset` RETURNS ITS DESTINATION, which is
 *   exactly this function's return value -- so the memset becomes a tail
 *   call and there is nothing to unwind.
 *
 *   the MISS. calloc on the cold path is a second call, so the same
 *   registers had to survive that too. Moving the whole miss out of line
 *   with the same three arguments makes it a tail call as well.
 *
 * The other two terms are one line each. The size-class index cost 5
 * because `int c` made `p->head[c]` a signed index (see scr_pool_take);
 * `blk` cost 5 because it recomputed `phys / GRAIN` and re-tested a range
 * the pooled arm had already proved. Both are 1 now.
 *
 * WHAT DID NOT MOVE, and the brief guessed some of these: the pool pop is
 * 7 and was 7, the round-up and range check are 6 and were 6, and the
 * memset is 12 instructions inside libc that no amount of inlining can
 * remove -- zeroing 64 bytes is real work. 33 of the remaining 33 are
 * arithmetic and stores on the object; there is no dispatch, no boxing and
 * no tagged round-trip in this function at all.
 *
 * Zeroed allocation with a cycle header in front; returns the OBJECT
 * pointer (header at scr_cyc_hdr). Aborts on OOM. */
void *scr_cyc_alloc(size_t size, ScrTraceFn trace, ScrCycFreeFn free_fn) {
  size_t phys = scr_pool_bytes(sizeof(ScrCycHdr) + size);
  ScrCycHdr *h = scr_pool_take(&scr_cyc_blocks, phys);
  if (h == NULL) return scr_cyc_alloc_miss(size, trace, free_fn);
  /* The pooled arm. scr_pool_take only returns a block whose physical size
   * is in range, so `blk` needs no test, and `phys / SCR_POOL_GRAIN` is the
   * class index it just computed. */
#if SCR_CYC_ZERO_WHOLE
  {
    /* `pad` is the block's PROVENANCE and outlives one use of the block:
     * wiping it would send a carved block to free(). The default arm never
     * touches it, so it only has to be saved here. */
    uint8_t prov = h->pad;
    memset(h, 0, phys);
    h->pad = prov;
  }
#endif
  scr_cyc_stamp(h, trace, free_fn, (uint8_t)(phys / SCR_POOL_GRAIN));
#if !SCR_CYC_ZERO_WHOLE
  /* calloc's contract, kept, but only where it is observable. Four of the
   * header's six fields are assigned by the stamp and the other two are
   * assigned here, so zeroing the header as well as the payload wrote 16 of
   * every 80 bytes twice. The OBJECT is what the callers read before
   * writing (scr_box_new leaves `slot` at zero and scr_box_trace's
   * "freshly-created boxes hold NULL" rule depends on it), so the payload
   * zeroing is NOT optional and is kept exactly. SCR_CYC_ZERO_WHOLE=1
   * restores the old single memset. */
  h->buffered = 0;
  h->buf_index = 0;
#endif
  scr_cyc_live++;
  SCR_CYCEN_NOTE_ALLOC(h, phys, size, free_fn, 1);
#if SCR_CYC_ZERO_WHOLE
  return h + 1;
#else
  /* The tail call. memset returns its destination, so this IS `return
   * h + 1` with the zeroing folded into it, and clang emits `jmp memset`.
   * Nothing above is live here, which is why there is no frame to unwind. */
  return memset(h + 1, 0, phys - sizeof(ScrCycHdr));
#endif
}

void scr_cyc_free(void *obj) {
  scr_cyc_live--;
  ScrCycHdr *h = scr_cyc_hdr(obj);
  if (h->blk != 0 &&
      scr_pool_give(&scr_cyc_blocks, h, (size_t)h->blk * SCR_POOL_GRAIN)) {
#ifdef SCR_CYCEN_ON
    scr_cycen_note_free(h, 1, scr_cyc_live);
#endif
    return;
  }
#ifdef SCR_CYCEN_ON
  scr_cycen_note_free(h, 0, scr_cyc_live);
#endif
  /* A carved block is not a CRT block. The pool's byte budget can reject a
   * give, so this is where the rejected ones go — never free(). */
  if (h->pad) {
    scr_cyc_ar_give(h);
    return;
  }
  free(h);
}

/* ── the candidate-root buffer ────────────────────────────────────────── */

static void **scr_roots = NULL;
static size_t scr_nroots = 0, scr_roots_cap = 0;
static bool scr_collecting = false;

static size_t scr_cyc_threshold(void) {
  static size_t cached = 0;
  if (cached == 0) {
    const char *env = getenv("SCR_CYCLE_THRESHOLD");
    long v = env ? strtol(env, NULL, 10) : 0;
    cached = v > 0 ? (size_t)v : 256;
  }
  return cached;
}

/* ── pacing ───────────────────────────────────────────────────────────
 * The threshold counts BUFFERED CANDIDATES, but a pass costs O(the graph
 * reachable from them), not O(the buffer): markGray visits every node
 * reachable from every candidate, and scan/scanBlack/collectWhite walk it
 * again. With a FIXED threshold the total cost of a run is
 * O(churn / threshold * live) — quadratic in the live set.
 *
 * That was survivable while the candidate population was boxes, closures,
 * shapes and containers. It stopped being survivable when dyn values
 * became cycle nodes, because the checked-dynamic tree is both the largest
 * live population in a compiled program and the most churned: a program
 * holding a 20 000-entry live dyn graph while churning rings went from
 * 294 ms to 17.8 s — 58x — with an identical trace and an identical
 * answer. Raising SCR_CYCLE_THRESHOLD by hand fixed it exactly
 * (256 -> 17.0 s, 4096 -> 1.35 s, 65536 -> 0.41 s), which is what
 * identifies the FREQUENCY rather than the walk as the cost.
 *
 * So the interval scales with the live node count instead of being fixed:
 * one pass per live/SCR_CYC_PACE nodes buffered, never below the base
 * threshold. Then a run's total collection work is
 * O(churn / (live/PACE) * live) = O(PACE * churn) — amortized LINEAR in
 * the churn, independent of how big the live graph is. It also bounds the
 * garbage held between passes by a fraction of the live set rather than by
 * an absolute constant, so it self-scales in both directions: a small
 * program keeps the historic 256 exactly.
 *
 * What this deliberately does NOT touch: exit and an explicit
 * scr_collect_cycles() run a full pass regardless of the budget, so WHAT a
 * program has freed by the time it exits is unchanged — only how often it
 * pays for a pass mid-run. Event-loop quiescence used to be on that list
 * too; scr_collect_cycles_idle below is why it no longer is.
 */
#define SCR_CYC_PACE 8

/* ── the event loop's between-turns pass ──────────────────────
 * The loop calls this every time the ready queue drains (scr_loop_run's
 * quiescence point), and it used to be an UNCONDITIONAL full pass. On an
 * RPC-shaped program that is the collector's whole bill: the loop goes
 * quiescent once per round trip, so a thousand awaits buy a thousand
 * O(live) passes to reclaim whatever handful of candidates each turn
 * happened to buffer. The pacing above never saw any of it, because this
 * site bypassed the threshold entirely.
 *
 * MEASURED, and this is why the fix is here and not in the threshold: on
 * the real zapo messaging bench (the preserved pre-regression binary, full
 * default workload) SCR_CYCLE_THRESHOLD 256 -> 4096 -> 65536 moves
 * recv_group's cycles by nothing at all — 33.0 / 31.7 / 33.5 Gcycles
 * against a measured 1.2% A/A floor on that phase. The threshold-triggered
 * passes were never the cost.
 *
 * So this point is paced too, with a quantum 8x SMALLER than the release
 * path's (a turn boundary is the cheapest moment to collect, so it stays
 * the eager one) and, crucially, a floor of ONE: while the live cycle-node
 * population is under SCR_CYC_IDLE_PACE this is exactly the unconditional
 * pass it always was — which is every program small enough for the pacing
 * question not to arise. Only a large live set, where a pass is expensive
 * and reclaiming three promises is not worth paying for it, starts skipping
 * turns; and the release path's own budget still bounds how long a
 * candidate can wait, so nothing is held indefinitely.
 *
 * SCR_CYCLE_IDLE_PACE=0 restores the unconditional pass. That is the A/B
 * control arm, and it is an env knob rather than a build flag on purpose:
 * both arms are then the SAME BINARY, so the measurement carries no code
 * layout confound. */
#ifndef SCR_CYC_IDLE_PACE
#define SCR_CYC_IDLE_PACE 64
#endif

static size_t scr_cyc_idle_pace(void) {
  static bool once = false;
  static size_t cached = SCR_CYC_IDLE_PACE;
  if (!once) {
    const char *env = getenv("SCR_CYCLE_IDLE_PACE");
    if (env != NULL) {
      long v = strtol(env, NULL, 10);
      if (v >= 0) cached = (size_t)v;
    }
    once = true;
  }
  return cached;
}

void scr_collect_cycles_idle(void) {
  size_t pace = scr_cyc_idle_pace();
  if (pace != 0) {
    size_t want = scr_cyc_live / pace;
    if (scr_nroots < (want > 1 ? want : 1)) return;
  }
  scr_collect_cycles();
}

void scr_cyc_on_dead(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  if (!h->buffered) return;
  /* O(1) removal: swap the last entry into the hole. */
  size_t i = (size_t)h->buf_index;
  void *last = scr_roots[--scr_nroots];
  scr_roots[i] = last;
  if (last != obj) scr_cyc_hdr(last)->buf_index = (uint32_t)i;
  h->buffered = 0;
}

void scr_cyc_on_release(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  h->color = SCR_CYC_PURPLE;
  if (!h->buffered) {
    if (scr_nroots == scr_roots_cap) {
      scr_roots_cap = scr_roots_cap ? scr_roots_cap * 2 : 64;
      scr_roots = realloc(scr_roots, scr_roots_cap * sizeof *scr_roots);
      if (!scr_roots) scr_cyc_oom();
    }
    h->buffered = 1;
    h->buf_index = (uint32_t)scr_nroots;
    scr_roots[scr_nroots++] = obj;
  }
  /* Threshold trigger. Never re-entered: a teardown's releases of untraced
   * children can buffer new candidates mid-collection, but they only wait
   * for the next pass. */
  size_t paced = scr_cyc_live / SCR_CYC_PACE;
  size_t base = scr_cyc_threshold();
  if (!scr_collecting && scr_nroots >= (paced > base ? paced : base)) {
    scr_collect_cycles();
  }
}

/* ── trial deletion ───────────────────────────────────────────────────── */

/* Child filter shared by every phase: nothing to do for NULL (unassigned
 * slots) or immortal (interned statics have no header at all). */
#define SCR_CYC_SKIP(child) ((child) == NULL || SCR_RC(child) == SIZE_MAX)

/* The gathered white set (freed after the walk completes). */
static void **scr_white = NULL;
static size_t scr_nwhite = 0, scr_white_cap = 0;

/* ── the four phases, over an explicit worklist ─────────────────────
 * Same algorithm, same visit-order guarantees, no C stack.
 *
 *   DEPTH — the reason this is here. The recursive form's depth was the
 *   traced structure's depth, so a long list or a deep promise chain was a
 *   deep C stack, and in this runtime the stack a collection runs on may be
 *   a FIBER stack: fixed-size and much smaller than the main thread's. The
 *   worklist's depth is heap.
 *
 *   THE ALREADY-VISITED EDGE was the reason it was expected to be FASTER,
 *   and it is not. On a dense live graph most edges point at a node the
 *   phase has already been to; recursively that costs a call, a header
 *   load, a compare and a return, and on the worklist the visitor does the
 *   compare itself and the call never happens. MEASURED ON THE REAL BENCH
 *   AND IT IS A NULL: the preserved messaging TU relinked against this
 *   runtime, full default workload, both forms in ONE binary with a
 *   temporary env knob as the arm (removed after the measurement: two
 *   traversals of one graph cost 1,024 bytes of always-linked runtime, and
 *   the static hello-world's size class has no room for a form that pays
 *   nothing), 2 interleaved reps — send_1to1 -0.77%,
 *   recv_1to1 -4.43%, send_group -0.28%, recv_group -1.01% against an A/A
 *   floor of +4.89% / -4.01% / +1.04% / -1.81% on the same four phases.
 *   Every one of them is inside the floor.
 *
 *   THE REASON IT IS A NULL is one measurement up: on this bench the
 *   collector is not on the critical path at all any more. With the pass
 *   frequency turned all the way down (SCR_CYCLE_IDLE_PACE=1 and
 *   SCR_CYCLE_THRESHOLD=1e9, so no pass runs during the measured phases at
 *   all) the four phases move by +3.3% / -2.6% / +0.1% / 0.0% — nothing,
 *   against arms that provably differ, because the same switch costs
 *   +9.3 MiB of peak RSS in retained garbage. There is no collector CPU
 *   left on this workload for a faster traversal to win.
 *
 * WHERE THIS DIFFERS FROM THE RECURSION IT REPLACED:
 *
 *   The node is COLOURED WHEN IT IS PUSHED, not when it is popped, in all
 *   four phases. That is what bounds the stack by the node count instead
 *   of the edge count — a node can be pushed at most once, because the
 *   colour that admits it is gone by the time a second parent looks. The
 *   recursion coloured at the same moment for the same reason (it coloured
 *   before it traced).
 *
 *   collectWhite's gather is PRE-order here and was post-order. The order
 *   of the white set does not reach the program: a member's teardown
 *   releases exactly the children its trace does NOT visit (the partition
 *   is the contract in scr_runtime.h and scr_box_gcfree is the worked
 *   example), so no white object's teardown can touch another white
 *   object. Both forms free the same set.
 *
 *   scanBlack nests INSIDE scan on the same stack, bounded by the mark it
 *   took on entry. It cannot escape below that mark, so the outer phase's
 *   pending nodes are untouched. */
static void **scr_wl = NULL;
static size_t scr_wl_n = 0, scr_wl_cap = 0;

static void scr_wl_push(void *obj) {
  if (scr_wl_n == scr_wl_cap) {
    scr_wl_cap = scr_wl_cap ? scr_wl_cap * 2 : 256;
    scr_wl = realloc(scr_wl, scr_wl_cap * sizeof *scr_wl);
    if (!scr_wl) scr_cyc_oom();
  }
  scr_wl[scr_wl_n++] = obj;
}

static void scr_mg_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) -= 1; /* trial-delete this internal edge */
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color == SCR_CYC_GRAY) return;
  h->color = SCR_CYC_GRAY;
  scr_wl_push(child);
}
static void scr_mark_gray(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  size_t floor = scr_wl_n;
  if (h->color == SCR_CYC_GRAY) return;
  h->color = SCR_CYC_GRAY;
  scr_wl_push(obj);
  while (scr_wl_n > floor) {
    void *o = scr_wl[--scr_wl_n];
    scr_cyc_trace_of(scr_cyc_hdr(o))(o, scr_mg_visit, NULL);
  }
}

static void scr_sb_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) += 1; /* restore the trial decrement */
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color == SCR_CYC_BLACK) return;
  h->color = SCR_CYC_BLACK;
  scr_wl_push(child);
}
static void scr_scan_black(void *obj) {
  size_t floor = scr_wl_n;
  scr_cyc_hdr(obj)->color = SCR_CYC_BLACK;
  scr_wl_push(obj);
  while (scr_wl_n > floor) {
    void *o = scr_wl[--scr_wl_n];
    scr_cyc_trace_of(scr_cyc_hdr(o))(o, scr_sb_visit, NULL);
  }
}

static void scr_scan_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color != SCR_CYC_GRAY) return;
  if (SCR_RC(child) > 0) {
    /* Externally referenced: this whole subgraph stays. Nested on the same
     * stack, bounded by the mark scr_scan_black takes on entry. */
    scr_scan_black(child);
    return;
  }
  h->color = SCR_CYC_WHITE;
  scr_wl_push(child);
}
static void scr_scan(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  size_t floor = scr_wl_n;
  if (h->color != SCR_CYC_GRAY) return;
  if (SCR_RC(obj) > 0) {
    scr_scan_black(obj);
    return;
  }
  h->color = SCR_CYC_WHITE;
  scr_wl_push(obj);
  while (scr_wl_n > floor) {
    void *o = scr_wl[--scr_wl_n];
    /* A node whitened before a later scanBlack reached it is black now,
     * and that scanBlack blackened all of its children, so there is
     * nothing here for this phase to do. */
    if (scr_cyc_hdr(o)->color != SCR_CYC_WHITE) continue;
    scr_cyc_trace_of(scr_cyc_hdr(o))(o, scr_scan_visit, NULL);
  }
}

static void scr_cw_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color != SCR_CYC_WHITE || h->buffered) return;
  h->color = SCR_CYC_BLACK; /* visited marker — prevents re-gathering */
  scr_wl_push(child);
}
static void scr_collect_white(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  size_t floor = scr_wl_n;
  if (h->color != SCR_CYC_WHITE || h->buffered) return;
  h->color = SCR_CYC_BLACK;
  scr_wl_push(obj);
  while (scr_wl_n > floor) {
    void *o = scr_wl[--scr_wl_n];
    scr_cyc_trace_of(scr_cyc_hdr(o))(o, scr_cw_visit, NULL);
    if (scr_nwhite == scr_white_cap) {
      scr_white_cap = scr_white_cap ? scr_white_cap * 2 : 64;
      scr_white = realloc(scr_white, scr_white_cap * sizeof *scr_white);
      if (!scr_white) scr_cyc_oom();
    }
    scr_white[scr_nwhite++] = o;
  }
}

void scr_collect_cycles(void) {
  if (scr_collecting || scr_nroots == 0) return;
  scr_collecting = true;
  SCR_CS_PASS_BEGIN();

  /* markRoots: keep live candidates (still purple), drop the rest — an
   * object re-retained since buffering is black; one grayed by an earlier
   * candidate's walk is already covered by that candidate's subgraph. */
  SCR_CS_PHASE_BEGIN();
  size_t out = 0;
  for (size_t i = 0; i < scr_nroots; i++) {
    void *obj = scr_roots[i];
    ScrCycHdr *h = scr_cyc_hdr(obj);
    if (h->color == SCR_CYC_PURPLE) {
      scr_mark_gray(obj);
      h->buf_index = (uint32_t)out;
      scr_roots[out++] = obj;
    } else {
      h->buffered = 0;
    }
  }
  scr_nroots = out;
  SCR_CS_PHASE_END(mark);
  SCR_CS_ADD(roots, scr_nroots);

  SCR_CS_PHASE_BEGIN();
  for (size_t i = 0; i < scr_nroots; i++) scr_scan(scr_roots[i]);
  SCR_CS_PHASE_END(scan);

  /* collectWhite over a drained buffer: clear every buffered flag first so
   * the recursion can gather buffered members of an earlier root's cycle. */
  size_t n = scr_nroots;
  scr_nroots = 0;
  for (size_t i = 0; i < n; i++) scr_cyc_hdr(scr_roots[i])->buffered = 0;
  scr_nwhite = 0;
  SCR_CS_PHASE_BEGIN();
  for (size_t i = 0; i < n; i++) scr_collect_white(scr_roots[i]);
  SCR_CS_PHASE_END(white);
  SCR_CS_ADD(freed, scr_nwhite);
  /* Teardowns run after the full walk. They may release untraced children
   * (plain RC) — which can re-buffer survivors for the NEXT pass — but
   * never touch traced (white, already-accounted) edges. */
  SCR_CS_PHASE_BEGIN();
  for (size_t i = 0; i < scr_nwhite; i++) {
    void *obj = scr_white[i];
    scr_cyc_free_of(scr_cyc_hdr(obj))(obj);
  }
  SCR_CS_PHASE_END(free);
  scr_nwhite = 0;

  SCR_CS_PASS_END();
  scr_collecting = false;
}
