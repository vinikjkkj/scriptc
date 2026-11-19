/* The cycle collector's trial-deletion visitors, shared between scr_cycle.c (which runs the passes) and scr_json.c (which owns the dyn node's trace).
 *
 * WHY A HEADER. A pass visits every edge of the traced graph with a visitor called through a pointer: for the mark-gray and scan-black phases, which together
 * make up nearly all of a pass (on the redis bench 41.1M and 38.2M visits against 0.4M scan and collect-white visits), that is one indirect call per child, and 93%
 * of those children are live nodes the pass only touches and leaves. A dyn node's trace is a runtime-owned function, so scr_json.c instantiates it ONCE PER PHASE
 * with that phase's visit body inlined (scr_dyn_trace_mg / scr_dyn_trace_sb) and registers the two with scr_cycle.c (scr_cyc_dyn_mg / scr_cyc_dyn_sb); the
 * pass calls them for a dyn node and keeps the generic indirect form for every other kind. The bodies are the same text in both forms (the _one functions below),
 * so what a pass frees cannot differ. */
#ifndef SCR_CYC_PASS_H
#define SCR_CYC_PASS_H

#include "scr_runtime.h"
#include <stddef.h>

#define SCR_RC(obj) (*(size_t *)(obj))

/* Child filter shared by every phase: nothing to do for NULL (unassigned slots) or immortal (interned statics have no header at all). */
#define SCR_CYC_SKIP(child) ((child) == NULL || SCR_RC(child) == SIZE_MAX)

/* The worklist the four phases share. */
extern void **scr_wl;
extern size_t scr_wl_n, scr_wl_cap;
void scr_wl_grow(void);
static inline void scr_wl_push(void *obj) {
  if (__builtin_expect(scr_wl_n == scr_wl_cap, 0)) scr_wl_grow();
  scr_wl[scr_wl_n++] = obj;
}

/* CHILDLESS DYN NODES. The dyn trace (scr_dyn_trace) visits children for exactly five kinds; every other kind of dyn node (numbers, strings, booleans, null, undefined,
 * bytes, bigints, handles, promises, maps, ...) has none. A child of that sort needs its colour and count updated by each phase and nothing else, so it never goes on
 * the worklist: it would be pushed, popped, and handed to a trace function that visits nothing. kind_lo == SCR_CYC_KIND_DYN alone identifies a dyn node (see
 * scr_runtime.h); `known_dyn` is a compile-time 1 where the edge's target is a dyn node by construction (an element, a member value, a prototype or table link).
 * If scr_dyn_trace ever visits children of another kind, add it to the mask. */
#define SCR_DYN_TRACED_MASK ((1u << SCR_DYN_ARR) | (1u << SCR_DYN_OBJ) | (1u << SCR_DYN_FUNC) | (1u << SCR_DYN_PROXY) | (1u << SCR_DYN_OBJINST))
static inline __attribute__((always_inline)) int scr_cyc_childless(const ScrCycHdr *h, void *child, int known_dyn) {
  return (known_dyn || h->kind_lo == SCR_CYC_KIND_DYN) && ((1u << (unsigned)((const ScrDyn *)child)->kind) & SCR_DYN_TRACED_MASK) == 0;
}

/* markGray's visit of one child. */
static inline __attribute__((always_inline)) void scr_cyc_mg_one(void *child, int known_dyn) {
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) -= 1; /* trial-delete this internal edge */
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color == SCR_CYC_GRAY) return;
  h->color = SCR_CYC_GRAY;
  if (scr_cyc_childless(h, child, known_dyn)) return;
  scr_wl_push(child);
}

/* scanBlack's visit of one child. */
static inline __attribute__((always_inline)) void scr_cyc_sb_one(void *child, int known_dyn) {
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) += 1; /* restore the trial decrement */
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color == SCR_CYC_BLACK) return;
  h->color = SCR_CYC_BLACK;
  if (scr_cyc_childless(h, child, known_dyn)) return;
  scr_wl_push(child);
}

/* The same two bodies out of line, for an edge that is visited once per node. */
static __attribute__((noinline, unused)) void scr_cyc_mg_edge(void *child, int known_dyn) {
  if (known_dyn) scr_cyc_mg_one(child, 1);
  else scr_cyc_mg_one(child, 0);
}
static __attribute__((noinline, unused)) void scr_cyc_sb_edge(void *child, int known_dyn) {
  if (known_dyn) scr_cyc_sb_one(child, 1);
  else scr_cyc_sb_one(child, 0);
}

/* The generic visitors, as pointers for the traces that cannot inline (every kind but dyn; a dyn node's own rare arms). */
static inline void scr_cyc_mg_visit_fn(void *child, void *ctx) {
  (void)ctx;
  scr_cyc_mg_one(child, 0);
}
static inline void scr_cyc_sb_visit_fn(void *child, void *ctx) {
  (void)ctx;
  scr_cyc_sb_one(child, 0);
}

/* The dyn node's trace with markGray's / scanBlack's visit inlined. Registered by scr_json.c when the dyn kind is assigned; NULL until then, and a pass only
 * reaches them for a dyn node, which cannot exist before that. */
typedef void (*ScrCycDynPassFn)(void *obj);
extern ScrCycDynPassFn scr_cyc_dyn_mg, scr_cyc_dyn_sb;

#endif
