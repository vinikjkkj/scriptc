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
#define SCR_CS_BUMP(which) ((void)0)
#define SCR_CS_MAX(which, n) ((void)0)
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
 * profiled on the real messaging bench, scr_cyc_alloc_miss's calloc was the
 * #2 live-heap site — 25.25 MiB, 31.31% of the live heap at its
 * high-water — and ScrCycHdr is already hand-minimized to exactly 16
 * bytes, so the header is not what is left. THE COUNT OF CRT BLOCKS IS.
 * Every calloc'd block carries the allocator's own per-block overhead
 * (~24 B measured across the process: ~26.6 MiB over ~1.16M live blocks),
 * and that term is not in any header this file controls.
 *
 * So the miss carves out of 64 KiB chunks instead — and, since this
 * revision, GIVES THE CHUNKS BACK. The shape is mimalloc's page (see
 * "Mimalloc: Free List Sharding in Action", Leijen/Zorn/de Moura, MSR-TR-
 * 2019-18) reduced to what one size-class family needs: a chunk is a page,
 * it serves ONE size class, it owns its own free list, it counts the blocks
 * it has handed out, and it is returned to the allocator the moment that
 * count reaches zero. jemalloc's runs and tcmalloc's spans are the same
 * idea with different names.
 *
 * WHY IT COULD NOT DO THAT BEFORE, and what changed. The previous form had
 * NO CHUNK HEADER on purpose, and the note here said so: given a block
 * pointer the arena could not name the chunk it came from, so it could
 * never learn that a chunk had emptied. Measured on tests/perf/zapo-rest
 * driven through a full WhatsApp history sync, that cost 1,053 chunks
 * allocated and zero freed — 65.81 MiB of a 96.40 MiB settled heap, 72% of
 * it, at 4% occupancy, against a genuine working set of ~11 MiB.
 *
 * WHAT IT IS WORTH, on that same rig and the same workload (8 chunks x 400
 * conversations x 6 messages x 300 B, settled = 45 s after the last chunk
 * decoded, then 60 s idle, read through the /shutdown route). The peak is
 * BIMODAL on this workload and knob-independent, so these are the HIGH-peak
 * arms only — 4 base, 3 reclaiming, interleaved, one host:
 *
 *   settled working set     163.39 -> 104.50 MiB   -58.89  (-36.0%)
 *   peak working set        248.34 -> 247.69       -0.65   (-0.3%)
 *   CRT-heap BUSY at settled 96.42 ->  40.66 MiB   -55.76  (-57.8%)
 *   heap uncommitted          8.55 ->  60.43 MiB   +51.88  (returned)
 *   65,536-byte busy blocks   1,110 ->    218
 *   arena chunks held at exit 1,053 ->    160      (peak 1,073, freed 1,236)
 *
 * THE PEAK DOES NOT MOVE and that is the honest half: the arena still takes
 * 1,073 chunks at the high-water, because that is what the sync genuinely
 * needs at once. What changes is that it gives 1,236 of the 1,397 it ever
 * took back.
 *
 * THE ~160 LEFT ARE NOT ALL CACHE, and the arithmetic says so: at most 33 of
 * them can be, one per size class, because that is the whole of what the
 * current-chunk rule below retains. The other ~128 are chunks that still
 * hold at least one LIVE block, which is the residual fragmentation any
 * per-page reclaimer has — a chunk cannot come back while one survivor
 * points into it. 10.0 MiB of chunk against a ~11 MiB working set is close
 * enough to that working set that there is little left in this term to win;
 * the next byte is somewhere else.
 *
 * THE NUMBER THAT EXPLAINS ALL OF IT is cycstat's `listhit`: 0 before and
 * 65,097,056 after. Routing carved blocks away from the size-class pool is
 * what turned the arena's free lists from a write-only sink into the
 * recycler, and a recycled block is a chunk that never had to be carved.
 *
 * THE MAP IS ScrCycHdr::pad, WITH NO EXTRA BYTE AND NO LOOKUP. The two
 * candidates were a per-block back-pointer (8 bytes on a 16-byte header
 * that has no room, so 16 after alignment — 20% on the 80-byte class that
 * dominates this heap) and a side registry keyed on the block address (a
 * hash probe on the free path, which is as hot as the allocate path). This
 * is neither. `pad` is ONE byte and it holds the block's offset from its
 * chunk in 256-byte granules; the chunk's own base is 256-ALIGNED, so
 *
 *     chunk = (block & ~255) - (pad << 8)
 *
 * is exact and is two instructions. Three things make it work and each is
 * load-bearing:
 *
 *   THE CHUNK IS 256-ALIGNED. malloc gives 16, so the chunk carves its
 *   base out of a 64 KiB malloc by rounding UP to 256 — at most 240 bytes
 *   lost, and the CRT block stays exactly 65,536 bytes, which is what
 *   tests/perf/heapcensus's histogram identifies an arena chunk by.
 *
 *   THE FIRST 256 BYTES ARE THE CHUNK HEADER. ScrCycChunk is 56 bytes; the
 *   zone is 256 so that NO BLOCK EVER SITS AT AN OFFSET BELOW 256, which
 *   is what keeps `pad != 0` the provenance test it already was. A calloc'd
 *   block is stamped 0 and must never reach the arena; a carved block is
 *   stamped 1..255 and must never reach free(). Both still read as one
 *   test of one byte.
 *
 *   THE CHUNK IS AT MOST 64 KiB. 255 granules of 256 is 65,280, and the
 *   last block of a 65,536-byte chunk starts below 65,536, so the offset
 *   always fits. The _Static_assert below is the guard, because a -D that
 *   raised the chunk size would otherwise alias two chunks silently.
 *
 * PROVENANCE IS STILL A HEADER FIELD, not a range check, and for the
 * original reason: a range check would need one contiguous reservation,
 * that means VirtualAlloc, and this runtime cross-compiles to ELF targets
 * that have no such call (cc-driver's five ELF cells are what rules it
 * out). A field in a header we own needs no platform symbol and is exact.
 *
 * BLOCKS ARE 16-BYTE ALIGNED: the chunk base is 256-aligned and the carve
 * stride is `phys` rounded up to 16, so the OBJECT pointer keeps the
 * alignment the 16-byte header was shaped to give it.
 *
 * THE SIZE-CLASS POOL IS EXCLUDED FROM CARVED BLOCKS, and that is the
 * deliberate half of this design. A pooled block keeps its chunk pinned:
 * scr_pool_give would park it for reuse, the chunk's count could not go to
 * zero, and 16 MiB of pool spread thin over a thousand chunks would pin all
 * of them — the exact failure this change exists to remove. Carrying chunk
 * identity THROUGH the pool is possible and is not enough: `pad` already
 * survives a pool round-trip (the pool writes only the block's first 8
 * bytes, and `pad` is byte 10), so the identity was never the problem; the
 * PINNING is. So scr_cyc_free routes on `pad` FIRST and a carved block goes
 * to its own chunk's list, never to the pool. The pool is not redundant
 * after that — it still recycles every block the arena does not own (the
 * >SCR_POOL_MAX sizes, the calloc fallback, and the whole of SCR_RC_AUDIT
 * and SCR_CYCLE_ARENA=0) — it simply no longer competes for the blocks the
 * arena has to be able to account for.
 *
 * That competition was also the retention bug. On the measured sync
 * cycstat reported listhit=0: not one of the ~45 MiB parked on the arena's
 * old global free lists was ever handed back out, because scr_pool_take
 * answered every reuse before a miss could reach the arena, and the pool's
 * byte budget rejected the gives that would have refilled the classes the
 * pool had starved. Blocks went one way. Routing on provenance closes that
 * by construction.
 *
 * SCR_CYCLE_ARENA=0 restores the calloc-and-pool arm. It is an env knob,
 * not a build flag, so both arms are the same binary. Off under
 * SCR_RC_AUDIT for exactly the reason the pool is: that lane exists to
 * prove every logical free is a real free. */
#ifndef SCR_CYC_ARENA
#define SCR_CYC_ARENA 1
#endif
#ifndef SCR_CYC_ARENA_CHUNK
#define SCR_CYC_ARENA_CHUNK ((size_t)64 << 10)
#endif

/* The granule the block->chunk map is expressed in, and the size of the
 * chunk's own header zone. Both are 256 for one reason: ScrCycHdr::pad is
 * ONE BYTE, and the map has to fit in it with a value of 0 left over to
 * mean "not from a chunk at all". */
#define SCR_CYC_ARENA_GRAN ((size_t)256)

_Static_assert(SCR_CYC_ARENA_CHUNK <= (SCR_CYC_ARENA_GRAN * 256),
               "SCR_CYC_ARENA_CHUNK over 64 KiB: a block's offset no longer "
               "fits in ScrCycHdr::pad and two chunks would alias");
_Static_assert(SCR_CYC_ARENA_CHUNK >= SCR_CYC_ARENA_GRAN * 4,
               "SCR_CYC_ARENA_CHUNK too small to hold a header zone and carve");

/* THE ARENA'S CEILING, WHICH THE RECLAMATION ABOVE HAS MADE HARMFUL, and
 * the measurement that says so. It predates this revision: past the budget
 * a miss falls back to calloc, and a calloc'd block is stamped pad=0 so it
 * reaches free() and the NT heap can decommit it. That was the only way an
 * unreclaimable arena could give anything back.
 *
 * On the same rig and workload as the block above, medians of matched
 * peak-mode arms, settled working set:
 *
 *                        no budget    SCR_CYCLE_ARENA_BUDGET=16 MiB
 *   the old arena         163.39 MiB          143.02 MiB
 *   this arena            104.50              133.93
 *
 * The ceiling was worth -20 MiB when a chunk could never come back. It now
 * COSTS +29 MiB, because everything past it is a calloc'd block carrying
 * the allocator's own ~24 B of per-block overhead and fragmenting the heap
 * the arena exists to keep dense — cycstat counts 616,314 such fallbacks on
 * the budgeted arm against 41,628 on the unbudgeted one, and those 41,628
 * are the >SCR_POOL_MAX sizes the arena never served anyway.
 *
 * So the knob stays at 0, unbounded, which is what it already shipped as;
 * it is kept only as the diagnostic arm the table above is read from. The
 * check is one comparison on the CHUNK path, which runs once per 64 KiB;
 * the hot path is untouched. Env knob, not a build flag, so both arms are
 * the same binary. */
#ifndef SCR_CYC_ARENA_BUDGET
#define SCR_CYC_ARENA_BUDGET 0
#endif

/* One chunk serves one size class. `used` is the whole of the reclamation
 * contract: it counts blocks HANDED TO THE PROGRAM and not yet returned,
 * so it is incremented at the two places a block leaves this chunk (the
 * free-list pop and the bump carve) and decremented at the one place a
 * block comes back (scr_cyc_ar_give). used == 0 therefore means no block of
 * this chunk is in anyone's hands: every carved block is on `freelist`,
 * which is chunk-local, and nothing outside points into the chunk. That is
 * what makes free() on it sound. */
typedef struct ScrCycChunk ScrCycChunk;
struct ScrCycChunk {
  ScrCycChunk *next;   /* next chunk of this class with capacity */
  ScrCycChunk **prevp; /* the pointer that points HERE, for O(1) unlink */
  void *raw;           /* what malloc returned; what free() must be given */
  void *freelist;      /* this chunk's own free blocks, LIFO */
  unsigned char *bump; /* first byte never yet carved */
  unsigned char *lim;  /* one past the last usable byte */
  uint32_t used;       /* blocks out; see above */
  uint32_t stride;     /* this class's carve stride, bytes */
  uint8_t blk;         /* the class, ScrCycHdr::blk */
  /* 1 = scr_cyc_ar_refill can reach this chunk without searching, i.e. it
   * is its class's current chunk OR it is on scr_cyc_ar_part[blk]. The two
   * cases are conflated ON PURPOSE and it is worth four instructions per
   * free: the return path has to ask "does this chunk need putting back
   * where allocation will find it", and with a flag that meant only
   * "listed" the answer for the CURRENT chunk — which is where most frees
   * land — was no, but only after a second load of the class table to
   * prove it. One byte answers it. */
  uint8_t avail;
#ifdef SCR_PAGECEN_ON
  /* tests/perf/pagecensus's list of EVERY live chunk, and it exists because
   * the two lists above cannot answer the census's question. A chunk that is
   * neither current nor on its class's partial list is FULL — reachable from
   * nothing — and the census has to be able to SHOW that a full chunk
   * contributes no free page rather than infer it from an invariant. These
   * two fields are compiled in only when the census is armed, so the
   * shipping struct is byte-identical to its parent's. */
  ScrCycChunk *all_next;
  ScrCycChunk **all_prevp;
#endif
};

/* THE EMPTY CHUNK, and it is not a placeholder. Every class starts pointing
 * at this one shared object whose free list is permanently NULL, so the hot
 * path needs no "is there a chunk yet" test at all: the pop it already does
 * fails on the free list and falls to the cold path, which is where a first
 * chunk was going to come from anyway. mimalloc spends the same trick on
 * the same problem (`_mi_page_empty`), for the same two instructions.
 *
 * `used` is 1 so that nothing can ever mistake it for a chunk that has
 * emptied; nothing decrements it, because a block's chunk is computed from
 * the block and no block lives here. */
static ScrCycChunk scr_cyc_ar_empty = {NULL, NULL, NULL, NULL,
                                       NULL, NULL, 1u,   0u,
                                       0u,   0u
#ifdef SCR_PAGECEN_ON
                                       /* never on the census's all-chunk
                                        * list: it is not a chunk. */
                                       ,
                                       NULL, NULL
#endif
};

/* The class's CURRENT chunk — the one and only one the hot path looks at,
 * the same shape as mimalloc's `pages_free_direct` slot. It is deliberately
 * NEVER released while it is current: a class that empties completely keeps
 * exactly one 64 KiB chunk as its cache, which is what stops an alternating
 * one-block-live workload from malloc/free'ing a chunk per turn (mimalloc
 * spends a retire counter on the same problem). The ceiling that buys is 32
 * classes x 64 KiB = 2 MiB, and a real program has a handful of live
 * classes, not 32. */
#define SCR_CYC_AR_E4                                                     \
  &scr_cyc_ar_empty, &scr_cyc_ar_empty, &scr_cyc_ar_empty, &scr_cyc_ar_empty
static ScrCycChunk *scr_cyc_ar_cur[SCR_POOL_MAX / SCR_POOL_GRAIN + 1u] = {
    SCR_CYC_AR_E4, SCR_CYC_AR_E4, SCR_CYC_AR_E4, SCR_CYC_AR_E4,
    SCR_CYC_AR_E4, SCR_CYC_AR_E4, SCR_CYC_AR_E4, SCR_CYC_AR_E4,
    &scr_cyc_ar_empty};
_Static_assert(SCR_POOL_MAX / SCR_POOL_GRAIN + 1u == 33u,
               "the empty-chunk initialiser above spells 33 slots by hand");
/* The class's other chunks that still have capacity. A chunk that is
 * neither current nor listed is FULL; the first free into it relinks it. */
static ScrCycChunk *scr_cyc_ar_part[SCR_POOL_MAX / SCR_POOL_GRAIN + 1u];
/* Chunk bytes this arena holds RIGHT NOW — the release path decrements it,
 * so the budget below is a ceiling on residency and not on lifetime
 * allocation. Only the budget reads it. */
static size_t scr_cyc_ar_held = 0;

/* ── the page census hook ─────────────────────────────────────────────────
 * The arena frees a chunk only when it is COMPLETELY empty, so one survivor
 * keeps 64 KiB. tests/perf/pagecensus asks how much of what is still held is
 * whole free pages — the ceiling on any per-page reclaimer. Everything below
 * is nothing at all unless that header was force-included with
 * -DSCR_PAGECEN_ON; see its comment for the controls. */
#ifdef SCR_PAGECEN_ON
_Static_assert(SCR_PC_CHUNK == SCR_CYC_ARENA_CHUNK,
               "the page census was compiled for a different chunk size");
static ScrCycChunk *scr_cyc_ar_all = NULL;

static void scr_cyc_ar_pagecensus(const char *when) {
  ScrCycChunk *c;
  scr_pc_reset();
  for (c = scr_cyc_ar_all; c != NULL; c = c->all_next) {
    int role = scr_cyc_ar_cur[c->blk] == c
                   ? SCR_PC_CUR
                   : (c->avail ? SCR_PC_PART : SCR_PC_FULL);
    scr_pc_note_chunk(c, c->raw, c->lim, SCR_CYC_ARENA_GRAN, c->stride, c->bump,
                      c->used, c->freelist, role);
  }
  scr_pc_report(when);
}

static void scr_cyc_ar_pagecensus_exit(void) { scr_cyc_ar_pagecensus("exit"); }

/* Armed from the allocation miss and from the collector pass rather than
 * from a constructor: this target's PE images run no .CRT teardown and the
 * census must be registered by whichever hook the program actually reaches,
 * including a program whose arena is switched off — that arm has to be able
 * to print NO CHUNKS. */
static void scr_pc_arm(void) {
  if (!scr_pc_registered) {
    scr_pc_registered = 1;
    /* The synthetic arm first, and BEFORE any chunk exists: it resets the
     * accumulators, so running it later would erase a real reading. */
    scr_pc_synth();
    atexit(scr_cyc_ar_pagecensus_exit);
  }
}
#define SCR_PC_ARM() scr_pc_arm()
#define SCR_PC_PASS()                                     \
  do {                                                    \
    if (scr_pc_every_on()) scr_cyc_ar_pagecensus("pass"); \
  } while (0)
#define SCR_PC_LINK(c)                                          \
  do {                                                          \
    (c)->all_next = scr_cyc_ar_all;                             \
    (c)->all_prevp = &scr_cyc_ar_all;                           \
    if ((c)->all_next != NULL)                                  \
      (c)->all_next->all_prevp = &(c)->all_next;                \
    scr_cyc_ar_all = (c);                                       \
  } while (0)
#define SCR_PC_UNLINK(c)                                        \
  do {                                                          \
    *(c)->all_prevp = (c)->all_next;                            \
    if ((c)->all_next != NULL)                                  \
      (c)->all_next->all_prevp = (c)->all_prevp;                \
  } while (0)
#else
#define SCR_PC_ARM() ((void)0)
#define SCR_PC_PASS() ((void)0)
#define SCR_PC_LINK(c) ((void)0)
#define SCR_PC_UNLINK(c) ((void)0)
#endif

static size_t scr_cyc_ar_budget(void) {
#ifdef SCR_RC_AUDIT
  return 0;
#else
  static long long cached = -1;
  if (cached < 0) {
    const char *env = getenv("SCR_CYCLE_ARENA_BUDGET");
    cached = env != NULL ? strtoll(env, NULL, 10)
                         : (long long)SCR_CYC_ARENA_BUDGET;
    if (cached < 0) cached = 0;
  }
  return (size_t)cached;
#endif
}

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

/* The map, and the only place it is spelled. Two instructions: mask the
 * block down to its granule, subtract the granule count the header carries.
 * Sound because the chunk base is 256-aligned, so the block's low 8 address
 * bits ARE the low 8 bits of its offset from that base. */
static inline ScrCycChunk *scr_cyc_ar_chunk(const ScrCycHdr *h) {
  uintptr_t a = (uintptr_t)(const void *)h;
  return (ScrCycChunk *)(void *)((a & ~(uintptr_t)(SCR_CYC_ARENA_GRAN - 1u)) -
                                 (uintptr_t)h->pad * SCR_CYC_ARENA_GRAN);
}

/* THE MAP'S OWN TEST, and it is off in every shipping build. A chunk freed
 * while a live block still points into it is a use-after-free that looks
 * like random corruption a long way from here, so the one thing that must
 * not be taken on trust is that `chunk = (block & ~255) - (pad << 8)` names
 * the chunk the block was actually carved from. -DSCR_CYC_ARENA_VERIFY=1
 * checks four things on EVERY free of a carved block:
 *   the block lies inside the chunk's carve region;
 *   it sits on the chunk's stride grid;
 *   the chunk's class agrees with the block's own ScrCycHdr::blk;
 *   the chunk still has a block out to account for (used != 0).
 * Any of them failing is a trap with a name, not a corrupted heap two
 * seconds later. Run the differential corpus with it on: it is the only
 * lane that exercises the map over every allocation shape the compiler
 * emits. */
#ifndef SCR_CYC_ARENA_VERIFY
#define SCR_CYC_ARENA_VERIFY 0
#endif

#if SCR_CYC_ARENA_VERIFY
static void scr_cyc_ar_verify(const ScrCycChunk *c, const ScrCycHdr *h) {
  const unsigned char *b = (const unsigned char *)(const void *)h;
  const unsigned char *base = (const unsigned char *)(const void *)c;
  size_t off;
  if (b < base + SCR_CYC_ARENA_GRAN || b >= c->lim) {
    scr_trap("scriptc: cycle arena verify: block outside its chunk\n");
  }
  off = (size_t)(b - (base + SCR_CYC_ARENA_GRAN));
  if (c->stride == 0 || off % c->stride != 0) {
    scr_trap("scriptc: cycle arena verify: block off the stride grid\n");
  }
  /* Masked: blk's top bit is the weak-key stamp, not part of the class. */
  if (c->blk != (h->blk & SCR_CYC_BLK_MASK)) {
    scr_trap("scriptc: cycle arena verify: chunk class does not match block\n");
  }
  if (c->used == 0) {
    scr_trap("scriptc: cycle arena verify: free into a chunk with none out\n");
  }
}
#else
#define scr_cyc_ar_verify(c, h) ((void)0)
#endif

static void scr_cyc_ar_link(ScrCycChunk *c) {
  ScrCycChunk **head = &scr_cyc_ar_part[c->blk];
  c->next = *head;
  c->prevp = head;
  if (c->next != NULL) c->next->prevp = &c->next;
  *head = c;
  c->avail = 1;
}

/* Removes the chunk from its class's partial list. It does NOT touch
 * `avail`, because the two callers mean opposite things by it: the refill
 * unlinks a chunk in order to make it CURRENT, which is still available. */
static void scr_cyc_ar_unlink(ScrCycChunk *c) {
  *c->prevp = c->next;
  if (c->next != NULL) c->next->prevp = c->prevp;
  c->next = NULL;
  c->prevp = NULL;
}

/* NULL when the chunk could not be had — a budget refusal or a real OOM.
 * Every caller falls back to calloc, so a failure here is a slower program
 * and not a broken one. */
static ScrCycChunk *scr_cyc_ar_new(uint8_t blk, size_t stride) {
  unsigned char *raw, *base;
  ScrCycChunk *c;
  size_t bud = scr_cyc_ar_budget();
  if (bud != 0 && scr_cyc_ar_held + SCR_CYC_ARENA_CHUNK > bud) return NULL;
  raw = (unsigned char *)malloc(SCR_CYC_ARENA_CHUNK);
  if (raw == NULL) return NULL;
  base = (unsigned char *)(void *)(((uintptr_t)(void *)raw +
                                    (SCR_CYC_ARENA_GRAN - 1u)) &
                                   ~(uintptr_t)(SCR_CYC_ARENA_GRAN - 1u));
  c = (ScrCycChunk *)(void *)base;
  c->next = NULL;
  c->prevp = NULL;
  c->raw = raw;
  c->freelist = NULL;
  c->bump = base + SCR_CYC_ARENA_GRAN;
  c->lim = raw + SCR_CYC_ARENA_CHUNK;
  c->used = 0;
  c->stride = (uint32_t)stride;
  c->blk = blk;
  c->avail = 1; /* the caller makes it current the moment it returns */
  scr_cyc_ar_held += SCR_CYC_ARENA_CHUNK;
  SCR_PC_LINK(c);
  SCR_CS_BUMP(archunk);
  SCR_CS_MAX(arpeak, scr_cyc_ar_held / SCR_CYC_ARENA_CHUNK);
  return c;
}

/* Only ever reached for a chunk that is NOT its class's current one, so
 * `avail` here can only mean "on the partial list". */
static void scr_cyc_ar_release(ScrCycChunk *c) {
  if (c->avail) scr_cyc_ar_unlink(c);
  SCR_PC_UNLINK(c);
  scr_cyc_ar_held -= SCR_CYC_ARENA_CHUNK;
  SCR_CS_BUMP(arfree);
  free(c->raw);
}

/* THE HOT ARM, and the whole of it: the class's current chunk, one pop off
 * its free list, one increment. Two dependent loads where the size-class
 * pool had one (the chunk, then its list head) — mimalloc's fast path pays
 * the same two for the same reason, and the cost is measured in the block
 * above scr_cyc_alloc rather than asserted here. NULL means "the cold path
 * has to do something", which is every case: no chunk, an empty list, or a
 * size the arena does not serve. */
static inline ScrCycHdr *scr_cyc_ar_pop(size_t phys) {
  ScrCycChunk *c;
  void *b;
  if (phys > SCR_POOL_MAX) return NULL;
  c = scr_cyc_ar_cur[phys / SCR_POOL_GRAIN]; /* never NULL; see the sentinel */
  b = c->freelist;
  if (b == NULL) return NULL;
  __builtin_memcpy(&c->freelist, b, sizeof(void *));
  c->used++;
  SCR_CS_BUMP(arhit);
  return (ScrCycHdr *)b;
}

/* The cold arm: the current chunk had nothing on its list, so carve, or
 * promote a partial chunk, or take a new one. Returns a block whose `pad`
 * is already correct — the carve stamps it, and a block off a free list
 * never lost it. */
static ScrCycHdr *scr_cyc_ar_refill(size_t phys, uint8_t blk) {
  size_t stride = (phys + 15u) & ~(size_t)15u;
  for (;;) {
    ScrCycChunk *c = scr_cyc_ar_cur[blk];
    void *b;
    if (c == &scr_cyc_ar_empty) {
      c = scr_cyc_ar_part[blk];
      if (c != NULL) {
        scr_cyc_ar_unlink(c); /* still available: it is about to be current */
      } else {
        c = scr_cyc_ar_new(blk, stride);
        if (c == NULL) return NULL;
      }
      scr_cyc_ar_cur[blk] = c;
    }
    b = c->freelist;
    if (b != NULL) {
      __builtin_memcpy(&c->freelist, b, sizeof(void *));
      c->used++;
      SCR_CS_BUMP(arhit);
      return (ScrCycHdr *)b;
    }
    if ((size_t)(c->lim - c->bump) >= (size_t)c->stride) {
      ScrCycHdr *h = (ScrCycHdr *)(void *)c->bump;
      c->bump += c->stride;
      c->used++;
      SCR_CS_BUMP(arcarve);
      /* The map, stamped once per block for the life of the block: the
       * offset from the chunk base in 256-byte granules, 1..255. */
      h->pad = (uint8_t)(((uintptr_t)(void *)h - (uintptr_t)(void *)c) /
                         SCR_CYC_ARENA_GRAN);
      return h;
    }
    /* Exhausted: no free block and no room to carve another. It stops being
     * the current chunk and goes on NO list — it is full, so there is
     * nothing to allocate from it. The first free INTO it relinks it. */
    c->avail = 0;
    scr_cyc_ar_cur[blk] = &scr_cyc_ar_empty;
  }
}

/* The return path. Push onto the chunk's own list, drop the count, and — if
 * that emptied a chunk that is not its class's cache — hand the 64 KiB back
 * to the allocator. */
static void scr_cyc_ar_give(ScrCycHdr *h) {
  ScrCycChunk *c = scr_cyc_ar_chunk(h);
  SCR_CS_BUMP(argive);
  scr_cyc_ar_verify(c, h);
  __builtin_memcpy(h, &c->freelist, sizeof(void *));
  c->freelist = h;
  if (--c->used == 0) {
    if (scr_cyc_ar_cur[c->blk] != c) scr_cyc_ar_release(c);
    return;
  }
  /* It was full — neither current nor listed — and now it has capacity
   * again, so put it where scr_cyc_ar_refill will find it. `avail` is what
   * makes this ONE byte-test on the path every free takes; see its
   * declaration. */
  if (!c->avail) scr_cyc_ar_link(c);
}

/* The miss, and DELIBERATELY the whole of it: the refill, the pool, the
 * calloc, the stamp, the counter and the return. On closure-churn the
 * fast arm above answers 800,026 of 800,031 calls.
 *
 * Both halves of that are load-bearing and both were measured. `noinline`
 * alone is not enough - with only the calloc out of line, clang still
 * kept `trace`, `free_fn` and `phys` in callee-saved registers across the
 * cold call, and the hot path paid 5 pushes and 5 pops for a path it
 * essentially never takes: 43 instructions per call rather than 33.
 * Taking the SAME three arguments this function does makes the miss a
 * TAIL call, so the hot path holds nothing across anything and needs no
 * frame at all. `phys` is recomputed here rather than passed for the same
 * reason - a fourth argument would be a register shuffle in the caller.
 *
 * THE THREE SOURCES ARE TRIED IN THE ORDER THAT OWNS THE BLOCK. The arena
 * first, because a carved block is the only kind whose chunk can be given
 * back. The size-class pool second: it is unreachable for a carved size
 * while the arena is on (scr_cyc_free routes those away from it before it
 * can ever be offered one), so on the shipping arm this is the recycler
 * for the >SCR_POOL_MAX sizes only — but it is the WHOLE recycler under
 * SCR_CYCLE_ARENA=0 and under SCR_RC_AUDIT, which is why it stays. calloc
 * last.
 *
 * `pad` IS NOT WRITTEN HERE and that is the invariant, not an omission.
 * A carved block already carries its chunk offset (scr_cyc_ar_refill
 * stamped it, and neither the pool nor the arena's free list touches byte
 * 10 of a block), a calloc'd block was zeroed by calloc, and a pooled
 * block was calloc'd once and has been 0 ever since. Zeroing the payload
 * rather than the whole block is what keeps that true — a memset over the
 * header would send a carved block to free(). */
static __attribute__((noinline)) void *scr_cyc_alloc_miss(size_t size,
                                                          ScrTraceFn trace,
                                                          ScrCycFreeFn free_fn) {
  size_t phys = scr_pool_bytes(sizeof(ScrCycHdr) + size);
  uint8_t blk = phys <= SCR_POOL_MAX ? (uint8_t)(phys / SCR_POOL_GRAIN) : 0u;
  ScrCycHdr *h = NULL;
  /* Nothing at all in an unarmed build. Here rather than in the hot path
   * because a program that never misses never has a chunk to census, and
   * here rather than in scr_cyc_ar_new so the SCR_CYCLE_ARENA=0 arm still
   * arms and can print its NO CHUNKS refusal. */
  SCR_PC_ARM();
  if (blk != 0 && scr_cyc_arena_on()) h = scr_cyc_ar_refill(phys, blk);
  if (h == NULL) h = (ScrCycHdr *)scr_pool_take(&scr_cyc_blocks, phys);
  if (h == NULL) {
    SCR_CS_BUMP(arcalloc);
    h = calloc(1, phys);
    if (h == NULL) scr_cyc_oom();
    /* calloc zeroed the whole block, `pad` included: provenance 0, which
     * is what sends it to free() rather than to a chunk. */
  }
  scr_cyc_stamp(h, trace, free_fn, blk);
  h->buffered = 0;
  h->buf_index = 0;
  scr_cyc_live++; /* the pacing denominator; see below */
  SCR_CYCEN_NOTE_ALLOC(h, phys, size, free_fn, 0);
  /* calloc's contract, kept, and only over the payload; see the note in
   * scr_cyc_alloc for why the header is stamped rather than zeroed. */
  return memset((unsigned char *)h + sizeof(ScrCycHdr), 0,
                phys - sizeof(ScrCycHdr));
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
 * WHAT THE RECLAIMING ARENA COSTS THIS FUNCTION, counted the same way -
 * `zig cc -target x86_64-linux-gnu -O2 -S`, the TAKEN path from the entry
 * to the `jmp memset`, both trees compiled in the same session with the
 * same toolchain:
 *
 *                                   pool arm  chunk arm
 *   the range check                     3         2
 *   the class lookup and the pop        7        10
 *   everything else                    22        22
 *   SELF, taken path                   32        34  <- before the sentinel
 *                                      32        32  <- shipped
 *
 * TWO OF THE THREE EXTRA INSTRUCTIONS WERE THE "IS THERE A CHUNK YET"
 * TEST, and the empty-chunk sentinel deletes both, which is exactly why
 * mimalloc has one. The third is paid back by the range check: the pool
 * needed `phys != 0 && phys <= MAX` (3), the chunk table needs only
 * `phys <= MAX` (2), because sizeof(ScrCycHdr) already makes phys
 * non-zero. So the SHIPPED count is 32 against 32 - identical.
 *
 * The instruction count is not the whole cost and this note will not
 * pretend it is. THE REAL DIFFERENCE IS ONE MORE DEPENDENT LOAD: the pool
 * chased `head[c]` then the block, the arena chases `cur[c]`, then the
 * chunk's free-list head, then the block. The chunk header is one cache
 * line per LIVE size class and a program has a handful of those, so it
 * stays resident; mimalloc's fast path is this same three-load chain.
 *
 * scr_cyc_free is the other half and it came out AHEAD: 21 instructions
 * on the taken path against the pool's 22, because the block->chunk map
 * (mask, shift, subtract) plus `used--` is cheaper than the pool's range
 * check plus its byte-budget comparison and store.
 *
 * WALL CLOCK, because instruction counts are not time. An allocation-heavy
 * cycle-churn program (a 60k-node spike four times over, then 600k rounds
 * of small-graph churn, ~8.5M cycle frees) built from both trees, 12
 * interleaved reps, first 3 discarded, medians: +1.86%, against an A/A
 * floor measured the same way on the same host of +2.61%. Inside the
 * floor. This is a Windows host and the binaries differ in layout, which
 * is the confound an A/A floor exists to bound - it does not license
 * reading +1.86% as a real number, only as "not distinguishable here".
 *
 * Zeroed allocation with a cycle header in front; returns the OBJECT
 * pointer (header at scr_cyc_hdr). Aborts on OOM. */
void *scr_cyc_alloc(size_t size, ScrTraceFn trace, ScrCycFreeFn free_fn) {
  size_t phys = scr_pool_bytes(sizeof(ScrCycHdr) + size);
  ScrCycHdr *h = scr_cyc_ar_pop(phys);
  if (h == NULL) return scr_cyc_alloc_miss(size, trace, free_fn);
  /* The carved arm. scr_cyc_ar_pop only returns a block whose physical size
   * is in range, so `blk` needs no test, and `phys / SCR_POOL_GRAIN` is the
   * class index it just computed. The block's `pad` — its offset from the
   * chunk that owns it — was stamped at the carve and is NOT rewritten
   * here: a block never migrates between chunks or classes, which is the
   * same invariant the size-class pool relies on, for the same reason. */
#if SCR_CYC_ZERO_WHOLE
  {
    /* `pad` is the block's PROVENANCE and outlives one use of the block:
     * wiping it would send a carved block to free() and lose the chunk it
     * has to be counted against. The default arm never touches it, so it
     * only has to be saved here. */
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

/* The cycle-headered kinds' weak-key stamp, installed as a ScrWeakMap's
 * key_mark. Only ever reached for a key the compiler proved carries a
 * header (see the declaration in scr_runtime.h for why that proof is the
 * caller's job and not this function's). One OR into a byte the free path
 * already loads.
 *
 * The stamp is not cleared when the last map holding the key drops the
 * entry — clearing would need a per-key count of how many maps hold it,
 * and a stale mark costs one wasted registry walk in that key's own free,
 * never a wrong answer. It IS cleared when the block is recycled, because
 * scr_cyc_stamp rewrites blk wholesale at every allocation; that half is
 * mandatory rather than a trade. */
void scr_cyc_weak_mark(void *key) {
  if (key != NULL) scr_cyc_hdr(key)->blk |= SCR_CYC_WEAKKEY;
}

/* THE ROUTE IS DECIDED BY PROVENANCE, AND THAT ORDER IS THE DESIGN. A
 * carved block goes to the chunk that owns it and nowhere else: not to
 * free(), which would corrupt the chunk, and not to the size-class pool,
 * which would park it where the chunk's live count could never fall to
 * zero. Everything else — the >SCR_POOL_MAX sizes, the calloc fallback,
 * and every block in an SCR_CYCLE_ARENA=0 or SCR_RC_AUDIT process — is
 * offered to the pool and then to free(), exactly as before. */
void scr_cyc_free(void *obj) {
  scr_cyc_live--;
  ScrCycHdr *h = scr_cyc_hdr(obj);
  /* THE WEAKMAP DEATH HOOK, AND IT IS FIRST ON PURPOSE — before the arena
   * give-back, before the pool give-back, before free(). All three hand
   * this address to the next allocation, and a WeakMap entry that outlived
   * its key by even one allocation is not a leak but a WRONG ANSWER: the
   * table is keyed by address and the object that lands here next would
   * read the dead key's value. See scr_weak.c's header.
   *
   * THIS IS THE CONVERGENCE POINT, and that is what makes one line enough.
   * A cycle-headered object dies two ways and only two: ordinary release
   * to zero, which runs the type's own teardown and ends in scr_cyc_free
   * (scr_arr_gc_free, the emitted shape gcFrees, ~16 others); and the
   * collector, whose collectWhite loop calls scr_cyc_free_of(hdr)(obj) —
   * the same per-type teardown, reached without any release running. Both
   * arrive here. The release-side hooks in scr_bytes.c and scr_array.c
   * cover the kinds that never get a header at all.
   *
   * WHY THE EVICTION IS SAFE INSIDE THE COLLECTOR'S FREE LOOP, where the
   * loop's own comment says teardowns must not touch traced (white,
   * already-accounted) edges. Dropping the entry releases the VALUE, and a
   * weakmap value can never be white: the weakmap v-adapters register NO
   * trace (emit-types.ts, deliberately — see the ephemeron note in
   * scr_weak.c), so markGray never decrements the value's refcount for the
   * table's reference, so scan sees rc > 0 and blackens it. The one
   * property that would break this is adding a trace over the values,
   * which is also the wrong half of ephemeron support on its own. */
  if ((h->blk & SCR_CYC_WEAKKEY) != 0 && scr_weak_died_hook != NULL) {
    scr_weak_died_hook(obj);
  }
  if (h->pad != 0) {
#ifdef SCR_CYCEN_ON
    scr_cycen_note_free(h, 1, scr_cyc_live);
#endif
    scr_cyc_ar_give(h);
    return;
  }
  /* Masked: the top bit is the stamp above, not part of the size class. */
  const uint8_t cls = h->blk & SCR_CYC_BLK_MASK;
  if (cls != 0 &&
      scr_pool_give(&scr_cyc_blocks, h, (size_t)cls * SCR_POOL_GRAIN)) {
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
  /* The end of a sweep is the one point in the process where the arena's
   * free lists are as long as they are going to get, which is why it is
   * both where the census reads and where a per-page reclaimer would run.
   * Nothing at all unless SCR_PAGECEN_EVERY says otherwise. */
  SCR_PC_PASS();
  scr_collecting = false;
}
