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

/* Every heap object's first member is `size_t rc`. */
#define SCR_RC(obj) (*(size_t *)(obj))

static void scr_cyc_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* Cycle-headered objects currently allocated — the pacing denominator, see
 * the "pacing" note under the candidate-root buffer. Declared here because
 * the two functions that move it are the allocator and the free below. */
static size_t scr_cyc_live = 0;

void *scr_cyc_alloc(size_t size, ScrTraceFn trace, ScrCycFreeFn free_fn) {
  ScrCycHdr *h = calloc(1, sizeof(ScrCycHdr) + size);
  if (!h) scr_cyc_oom();
  h->trace = trace;
  h->free_fn = free_fn;
  h->color = SCR_CYC_BLACK;
  scr_cyc_live++; /* the pacing denominator; see below */
  return h + 1;
}

void scr_cyc_free(void *obj) {
  scr_cyc_live--;
  free(scr_cyc_hdr(obj));
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
  size_t i = h->buf_index;
  void *last = scr_roots[--scr_nroots];
  scr_roots[i] = last;
  if (last != obj) scr_cyc_hdr(last)->buf_index = i;
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
    h->buf_index = scr_nroots;
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
  h->trace(obj, scr_mg_visit, NULL);
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
  scr_cyc_hdr(obj)->trace(obj, scr_sb_visit, NULL);
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
  h->trace(obj, scr_scan_visit, NULL);
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
  h->trace(obj, scr_cw_visit, NULL);
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
      h->buf_index = out;
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
    scr_cyc_hdr(obj)->free_fn(obj);
  }
  scr_nwhite = 0;

  scr_collecting = false;
}
