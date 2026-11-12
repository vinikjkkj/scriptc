/* Tagged unions — immutable refcounted boxes: tag + one payload slot (see
 * scr_runtime.h). Ref arms own their payload and carry its RC entry points
 * as function pointers (mirroring ScrBox's SCR_BOX_OBJ mechanism), so this
 * file needs to know nothing about per-class/per-record struct layouts.
 *
 * Every union carries a cycle header: an arm can hold a class/record/
 * promise payload that points back (the compiler passes arm_trace for
 * exactly those arm types), and instances of one union type must be
 * uniform, scalar-armed values included. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>

/* Live union count for the RC audit lane (-DSCR_RC_AUDIT); same contract
 * as scr_str_live_count in scr_string.c. */
#ifdef SCR_RC_AUDIT
static long scr_live_unions = 0;
long scr_union_live_count(void) { return scr_live_unions; }
#endif

static void scr_union_trace(void *o, ScrTraceVisit visit, void *ctx) {
  ScrUnion *u = (ScrUnion *)o;
  if (u->vt & 1u) visit(scr_union_peek(u), ctx);
}

/* Teardown for the collector: release the payload only when the trace does
 * NOT visit it (the complement — see the contract in scr_runtime.h). */
static void scr_union_gcfree(void *o) {
  ScrUnion *u = (ScrUnion *)o;
  if (u->vt != 0 && !(u->vt & 1u)) scr_armvt_dec(u->vt)->release(scr_union_peek(u));
#ifdef SCR_RC_AUDIT
  scr_live_unions--;
#endif
  scr_cyc_free(u);
}

static ScrUnion *scr_union_alloc(uint32_t tag) {
  ScrUnion *u = scr_cyc_alloc(sizeof(ScrUnion), &scr_union_trace, &scr_union_gcfree);
  u->rc = 1;
  u->tag = tag;
#ifdef SCR_RC_AUDIT
  scr_live_unions++;
#endif
  return u;
}

ScrUnion *scr_union_new_f64(uint32_t tag, double v) {
  ScrUnion *u = scr_union_alloc(tag);
  memcpy(&u->slot, &v, sizeof v);
  return u;
}

ScrUnion *scr_union_new_bool(uint32_t tag, bool v) {
  ScrUnion *u = scr_union_alloc(tag);
  u->slot = v ? 1 : 0;
  return u;
}

ScrUnion *scr_union_new_refd(uint32_t tag, void *v, const ScrArmVt *vt, bool trace) {
  ScrUnion *u = scr_union_alloc(tag);
  memcpy(&u->slot, &v, sizeof v); /* ownership of v moves in (+1 arrived) */
  u->vt = scr_armvt_enc(vt, trace);
  return u;
}

/* Descriptors for callers whose entry points are not link-time constants. They must sit in the image (the descriptor reference is
 * a 32-bit offset from the cycle anchor, which a heap address would not fit), so they are interned in a fixed static table;
 * a runtime has a few dozen such pairs, and the table is a hard stop rather than a silent wrap. */
static ScrArmVt scr_armvt_rt[512];
static unsigned scr_armvt_rt_n = 0;
const ScrArmVt *scr_armvt_rt_intern(void *(*retain)(void *), void (*release)(void *)) {
  for (unsigned i = 0; i < scr_armvt_rt_n; i++) {
    if (scr_armvt_rt[i].retain == retain && scr_armvt_rt[i].release == release) return &scr_armvt_rt[i];
  }
  if (scr_armvt_rt_n == sizeof scr_armvt_rt / sizeof scr_armvt_rt[0]) scr_trap("scriptc: internal error: runtime arm descriptor table full\n");
  scr_armvt_rt[scr_armvt_rt_n].retain = retain;
  scr_armvt_rt[scr_armvt_rt_n].release = release;
  return &scr_armvt_rt[scr_armvt_rt_n++];
}

ScrUnion *scr_union_new_ref_rt(uint32_t tag, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  return scr_union_new_refd(tag, v, scr_armvt_rt_intern(retain, release), trace != NULL);
}

void scr_union_release(ScrUnion *u) {
  if (!u || u->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--u->rc == 0) {
    scr_cyc_on_dead(u);
    if (u->vt != 0) scr_armvt_dec(u->vt)->release(scr_union_peek(u));
#ifdef SCR_RC_AUDIT
    scr_live_unions--;
#endif
    scr_cyc_free(u);
  } else if (u->vt & 1u) {
    /* A possible cycle root only when its arm carries a cycle header: arm_trace is NULL for f64, bool, string and bytes arms (and
     * for every scalar union), so scr_union_trace visits nothing from such a box and it cannot be a member of a cycle. The field is
     * fixed when the box is built (a union never changes arm), so no store can invalidate this. MEASURED on the zapobench mysql arm:
     * 9.4 M of the 11.4 M union releases and 1.9 M of the 2.3 M new buffer entries were such boxes. */
    scr_cyc_on_release(u); /* may collect — u is done */
  }
}

double scr_union_get_f64(ScrUnion *u) {
  double v;
  memcpy(&v, &u->slot, sizeof v);
  return v;
}

bool scr_union_get_bool(ScrUnion *u) { return u->slot != 0; }

/* ── void*-signature RC adapters (stored in ScrUnion / ScrBox) ─────────── */

void *scr_str_retain_v(void *s) { return scr_str_retain((ScrStr *)s); }
void scr_str_release_v(void *s) { scr_str_release((ScrStr *)s); }
void *scr_arr_retain_v(void *a) { return scr_arr_retain((ScrArr *)a); }
void scr_arr_release_v(void *a) { scr_arr_release((ScrArr *)a); }
void *scr_closure_retain_v(void *c) { return scr_closure_retain((ScrClosure *)c); }
void scr_closure_release_v(void *c) { scr_closure_release((ScrClosure *)c); }
void *scr_union_retain_v(void *u) { return scr_union_retain((ScrUnion *)u); }
void scr_union_release_v(void *u) { scr_union_release((ScrUnion *)u); }

void scr_union_trace_v(void *u, ScrTraceVisit visit, void *ctx) {
  scr_union_trace(u, visit, ctx);
}
