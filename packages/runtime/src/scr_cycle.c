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
 * Recursion depth equals the traced structure's depth — same property as
 * the existing recursive releases (deep lists recurse deeply; acceptable
 * for now, revisit with an explicit stack if it ever traps).
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

#ifndef SCR_CYC_ZERO_WHOLE
#define SCR_CYC_ZERO_WHOLE 0
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
  ScrCycHdr *h = calloc(1, phys);
  if (h == NULL) scr_cyc_oom();
  /* calloc zeroed the whole block, `buffered` and `buf_index` included. */
  scr_cyc_stamp(h, trace, free_fn,
                phys <= SCR_POOL_MAX ? (uint8_t)(phys / SCR_POOL_GRAIN) : 0u);
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
  memset(h, 0, phys);
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
 * What this deliberately does NOT touch: the other collection points.
 * Exit, event-loop quiescence and an explicit scr_collect_cycles() all run
 * a full pass regardless of the budget, so WHAT a program has freed by the
 * time it exits is unchanged — only how often it pays for a pass mid-run.
 */
#define SCR_CYC_PACE 8

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

static void scr_mark_gray(void *obj);
static void scr_mg_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) -= 1; /* trial-delete this internal edge */
  scr_mark_gray(child);
}
static void scr_mark_gray(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  if (h->color == SCR_CYC_GRAY) return;
  h->color = SCR_CYC_GRAY;
  scr_cyc_trace_of(h)(obj, scr_mg_visit, NULL);
}

static void scr_scan_black(void *obj);
static void scr_sb_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) += 1; /* restore the trial decrement */
  if (scr_cyc_hdr(child)->color != SCR_CYC_BLACK) scr_scan_black(child);
}
static void scr_scan_black(void *obj) {
  scr_cyc_hdr(obj)->color = SCR_CYC_BLACK;
  scr_cyc_trace_of(scr_cyc_hdr(obj))(obj, scr_sb_visit, NULL);
}

static void scr_scan(void *obj);
static void scr_scan_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  scr_scan(child);
}
static void scr_scan(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  if (h->color != SCR_CYC_GRAY) return;
  if (SCR_RC(obj) > 0) {
    /* Externally referenced: this whole subgraph stays. */
    scr_scan_black(obj);
    return;
  }
  h->color = SCR_CYC_WHITE;
  scr_cyc_trace_of(h)(obj, scr_scan_visit, NULL);
}

/* The gathered white set (freed after the walk completes). */
static void **scr_white = NULL;
static size_t scr_nwhite = 0, scr_white_cap = 0;

static void scr_collect_white(void *obj);
static void scr_cw_visit(void *child, void *ctx) {
  (void)ctx;
  if (SCR_CYC_SKIP(child)) return;
  scr_collect_white(child);
}
static void scr_collect_white(void *obj) {
  ScrCycHdr *h = scr_cyc_hdr(obj);
  if (h->color != SCR_CYC_WHITE || h->buffered) return;
  h->color = SCR_CYC_BLACK; /* visited marker — prevents re-gathering */
  scr_cyc_trace_of(h)(obj, scr_cw_visit, NULL);
  if (scr_nwhite == scr_white_cap) {
    scr_white_cap = scr_white_cap ? scr_white_cap * 2 : 64;
    scr_white = realloc(scr_white, scr_white_cap * sizeof *scr_white);
    if (!scr_white) scr_cyc_oom();
  }
  scr_white[scr_nwhite++] = obj;
}

void scr_collect_cycles(void) {
  if (scr_collecting || scr_nroots == 0) return;
  scr_collecting = true;

  /* markRoots: keep live candidates (still purple), drop the rest — an
   * object re-retained since buffering is black; one grayed by an earlier
   * candidate's walk is already covered by that candidate's subgraph. */
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

  for (size_t i = 0; i < scr_nroots; i++) scr_scan(scr_roots[i]);

  /* collectWhite over a drained buffer: clear every buffered flag first so
   * the recursion can gather buffered members of an earlier root's cycle. */
  size_t n = scr_nroots;
  scr_nroots = 0;
  for (size_t i = 0; i < n; i++) scr_cyc_hdr(scr_roots[i])->buffered = 0;
  scr_nwhite = 0;
  for (size_t i = 0; i < n; i++) scr_collect_white(scr_roots[i]);
  /* Teardowns run after the full walk. They may release untraced children
   * (plain RC) — which can re-buffer survivors for the NEXT pass — but
   * never touch traced (white, already-accounted) edges. */
  for (size_t i = 0; i < scr_nwhite; i++) {
    void *obj = scr_white[i];
    scr_cyc_free_of(scr_cyc_hdr(obj))(obj);
  }
  scr_nwhite = 0;

  scr_collecting = false;
}
