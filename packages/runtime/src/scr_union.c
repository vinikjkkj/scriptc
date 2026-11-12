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

/* SHARED IMMORTAL SCALAR BOXES. A union box is immutable, so two boxes with the same tag and payload are interchangeable, and a program that
 * builds a few hundred thousand of them (a padded parameter list, a table of flags) pays 40 bytes each for a handful of distinct values. The
 * values that dominate are -1, 0, 1 and the two bools, so those get one static box per arm tag (tags 0..15; a larger tag allocates as before):
 * rc == SIZE_MAX, which every retain and release already skips, and no cycle header, like the emitted immortal unit arms (vt 0: nothing to
 * release, nothing to trace). Matching is on the exact bit pattern, so -0.0 and NaN allocate. Static, not heap: nothing to free, nothing for
 * the RC audit to count. */
#define SCR_UK_TAGS 16u
#define SCR_UK_F64(t) {SIZE_MAX, t, 0u, 0xBFF0000000000000ull}, {SIZE_MAX, t, 0u, 0ull}, {SIZE_MAX, t, 0u, 0x3FF0000000000000ull}
#define SCR_UK_BOOL(t) {SIZE_MAX, t, 0u, 0ull}, {SIZE_MAX, t, 0u, 1ull}
#define SCR_UK_ROW(M) M(0), M(1), M(2), M(3), M(4), M(5), M(6), M(7), M(8), M(9), M(10), M(11), M(12), M(13), M(14), M(15)
static ScrUnion scr_uk_f64[SCR_UK_TAGS * 3u] = {SCR_UK_ROW(SCR_UK_F64)};
static ScrUnion scr_uk_bool[SCR_UK_TAGS * 2u] = {SCR_UK_ROW(SCR_UK_BOOL)};
/* The empty string as a ref arm: one box per tag, built on first use (its payload is an address). */
static ScrUnion scr_uk_empty[SCR_UK_TAGS];
static const ScrArmVt scr_vt_str = {&scr_str_retain_v, &scr_str_release_v};

ScrUnion *scr_union_new_f64(uint32_t tag, double v) {
  if (tag < SCR_UK_TAGS) {
    uint64_t b;
    memcpy(&b, &v, sizeof b);
    if (b == 0ull) return &scr_uk_f64[tag * 3u + 1u];
    if (b == 0x3FF0000000000000ull) return &scr_uk_f64[tag * 3u + 2u];
    if (b == 0xBFF0000000000000ull) return &scr_uk_f64[tag * 3u];
  }
  ScrUnion *u = scr_union_alloc(tag);
  memcpy(&u->slot, &v, sizeof v);
  return u;
}

ScrUnion *scr_union_new_bool(uint32_t tag, bool v) {
  if (tag < SCR_UK_TAGS) return &scr_uk_bool[tag * 2u + (v ? 1u : 0u)];
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

/* A string arm: the empty string is one shared immortal box per tag. Compared by content, not address: the program's own "" literal is a
 * different object from the runtime's, and a heap-built empty string is a third. The absent marker is an empty string too but means undefined.
 * Reached only for string arms (the header macro routes a call whose release entry is scr_str_release_v here, folded at compile time in
 * emitted code; the LLVM lane rewrites the same call), so no other ref arm pays the length test. */
ScrUnion *scr_union_new_str(uint32_t tag, ScrStr *s) {
  if (s->len == 0 && tag < SCR_UK_TAGS && !scr_str_is_absent(s)) {
    ScrUnion *e = &scr_uk_empty[tag];
    if (e->rc != SIZE_MAX) { /* first use: the box holds the runtime's immortal empty string, never the caller's (it may be a counted heap string) */
      ScrStr *imm = scr_str_empty_obj();
      e->rc = SIZE_MAX;
      e->tag = tag;
      e->vt = scr_armvt_enc(&scr_vt_str, false);
      memcpy(&e->slot, &imm, sizeof imm);
    }
    scr_str_release(s); /* the +1 that arrived is not needed: the box holds its own, immortal, empty string */
    return e;
  }
  return scr_union_new_refd(tag, s, &scr_vt_str, false);
}

ScrUnion *scr_union_new_ref_rt(uint32_t tag, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  return scr_union_new_refd(tag, v, scr_armvt_rt_intern(retain, release), trace != NULL);
}

/* The function behind the header macro of the same name, for a caller that takes its address or links it by name (the LLVM declare table
 * still lists it, and llvm-runtime-abi.test.ts holds every declare to a prototype). The macro is what emitted C calls. */
#undef scr_union_new_ref
ScrUnion *scr_union_new_ref(uint32_t tag, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  return scr_union_new_ref_rt(tag, v, retain, release, trace);
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
