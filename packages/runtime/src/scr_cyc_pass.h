/* The cycle collector's mark-gray and scan-black visit bodies.
 *
 * A pass visits every edge of the traced graph through a pointer; mark-gray and scan-black make up nearly all of a pass (on the redis bench 41.1M and 38.2M visits
 * against 0.4M scan and collect-white visits), and 93% of those children are live nodes the pass only touches. A dyn child whose kind has no traced children (the
 * majority) is coloured and counted in the visit and never goes on the worklist: it would be pushed, popped, and handed to a trace function that visits nothing. */
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
 * scr_runtime.h). If scr_dyn_trace ever visits children of another kind, add it to the mask. */
#define SCR_DYN_TRACED_MASK ((1u << SCR_DYN_ARR) | (1u << SCR_DYN_OBJ) | (1u << SCR_DYN_FUNC) | (1u << SCR_DYN_PROXY) | (1u << SCR_DYN_OBJINST))
static inline __attribute__((always_inline)) int scr_cyc_childless(const ScrCycHdr *h, void *child) {
  return h->kind_lo == SCR_CYC_KIND_DYN && ((1u << (unsigned)((const ScrDyn *)child)->kind) & SCR_DYN_TRACED_MASK) == 0;
}

/* markGray's visit of one child. */
static inline __attribute__((always_inline)) void scr_cyc_mg_one(void *child) {
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) -= 1; /* trial-delete this internal edge */
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color == SCR_CYC_GRAY) return;
  h->color = SCR_CYC_GRAY;
  if (scr_cyc_childless(h, child)) return;
  scr_wl_push(child);
}

/* scanBlack's visit of one child. */
static inline __attribute__((always_inline)) void scr_cyc_sb_one(void *child) {
  if (SCR_CYC_SKIP(child)) return;
  SCR_RC(child) += 1; /* restore the trial decrement */
  ScrCycHdr *h = scr_cyc_hdr(child);
  if (h->color == SCR_CYC_BLACK) return;
  h->color = SCR_CYC_BLACK;
  if (scr_cyc_childless(h, child)) return;
  scr_wl_push(child);
}

/* The visitors as pointers, for the trace functions. */
static inline void scr_cyc_mg_visit_fn(void *child, void *ctx) {
  (void)ctx;
  scr_cyc_mg_one(child);
}
static inline void scr_cyc_sb_visit_fn(void *child, void *ctx) {
  (void)ctx;
  scr_cyc_sb_one(child);
}

#endif
