#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef SCR_RC_AUDIT
static long scr_live_boxes = 0;
static long scr_live_closures = 0;
long scr_box_live_count(void) { return scr_live_boxes; }
long scr_closure_live_count(void) { return scr_live_closures; }
/* The per-creation-site live table below; both teardown paths sit above it. */
static void scr_clo_bump(const void *fn, long d);
#endif

/* ── boxes ──────────────────────────────────────────────────────────────
 * Every box carries a cycle header (a captured binding can hold anything,
 * including the closure that captures it — the canonical cycle). The box's
 * trace visits its payload when the payload type itself carries a header:
 * closures always do; SCR_BOX_OBJ payloads iff the compiler passed a trace
 * (obj_trace doubles as that flag); strings/scalars never. SCR_BOX_ARR
 * holds acyclic arrays only — a CYCLE-CAPABLE array (traced ref elements)
 * rides a SCR_BOX_OBJ box with the array's `_v` adapters + scr_arr_trace_v,
 * so its edge stays visible to the collector. */

static void *scr_box_ptr(const ScrBox *b) {
  void *p;
  memcpy(&p, &b->slot, sizeof p);
  return p;
}

static void scr_box_trace(void *o, ScrTraceVisit visit, void *ctx) {
  ScrBox *b = (ScrBox *)o;
  void *p = scr_box_ptr(b);
  if (!p) return; /* freshly-created boxes hold NULL until first write */
  switch (b->kind) {
  case SCR_BOX_FUNC:
    visit(p, ctx);
    break;
  case SCR_BOX_OBJ:
    if (b->obj_trace) visit(p, ctx);
    break;
  default:
    break;
  }
}

/* Teardown for the collector: release exactly the payloads the trace does
 * NOT visit (the complement — see the contract in scr_runtime.h). */
static void scr_box_gcfree(void *o) {
  ScrBox *b = (ScrBox *)o;
  void *p = scr_box_ptr(b);
  if (p) {
    switch (b->kind) {
    case SCR_BOX_STR:
      scr_str_release((ScrStr *)p);
      break;
    case SCR_BOX_ARR:
      scr_arr_release((ScrArr *)p);
      break;
    case SCR_BOX_OBJ:
      if (!b->obj_trace) b->obj_release(p);
      break;
    default: /* FUNC is traced; scalars own nothing */
      break;
    }
  }
#ifdef SCR_RC_AUDIT
  scr_live_boxes--;
#endif
  scr_cyc_free(b);
}

ScrBox *scr_box_new(ScrBoxKind kind) {
  ScrBox *b = scr_cyc_alloc(sizeof(ScrBox), &scr_box_trace, &scr_box_gcfree);
  b->rc = 1;
  b->kind = kind;
#ifdef SCR_RC_AUDIT
  scr_live_boxes++;
#endif
  return b;
}

ScrBox *scr_box_new_obj(void *(*retain)(void *), void (*release)(void *),
                         ScrTraceFn trace) {
  ScrBox *b = scr_box_new(SCR_BOX_OBJ);
  b->obj_retain = retain;
  b->obj_release = release;
  b->obj_trace = trace;
  return b;
}

/* Release one payload pointer by the box's kind. Factored so set_ref can
 * release the value it REPLACED after the slot is already overwritten
 * (mutators must unlink before releasing — see scr_cycle.c). */
static void scr_box_release_payload(ScrBox *b, void *p) {
  if (!p) return;
  switch (b->kind) {
  case SCR_BOX_STR:
    scr_str_release((ScrStr *)p);
    break;
  case SCR_BOX_ARR:
    scr_arr_release((ScrArr *)p);
    break;
  case SCR_BOX_FUNC:
    scr_closure_release((ScrClosure *)p);
    break;
  case SCR_BOX_OBJ:
    b->obj_release(p);
    break;
  case SCR_BOX_F64:
  case SCR_BOX_BOOL:
    break;
  }
}

void scr_box_release(ScrBox *b) {
  if (!b || b->rc == SIZE_MAX) return; /* NULL: a switch jumped past the decl */
  if (--b->rc == 0) {
    scr_cyc_on_dead(b);
    scr_box_release_payload(b, scr_box_ptr(b));
#ifdef SCR_RC_AUDIT
    scr_live_boxes--;
#endif
    scr_cyc_free(b);
  } else {
    scr_cyc_on_release(b); /* possible cycle root; may collect — b is done */
  }
}

double scr_box_get_f64(ScrBox *b) {
  double v;
  memcpy(&v, &b->slot, sizeof v);
  return v;
}

bool scr_box_get_bool(ScrBox *b) { return b->slot != 0; }

void *scr_box_get_ref(ScrBox *b) {
  void *p = scr_box_ptr(b);
  switch (b->kind) {
  case SCR_BOX_STR:
    return scr_str_retain((ScrStr *)p);
  case SCR_BOX_ARR:
    return scr_arr_retain((ScrArr *)p);
  case SCR_BOX_FUNC:
    return scr_closure_retain((ScrClosure *)p);
  case SCR_BOX_OBJ:
    return b->obj_retain(p);
  default:
    scr_trap("scriptc: internal error: box_get_ref on a scalar box\n");
  }
}

void scr_box_set_f64(ScrBox *b, double v) { memcpy(&b->slot, &v, sizeof v); }

/* The dyn-function adapter's call descriptor (scr_runtime.h): the LLVM
 * lane emits calls and cannot reach the inline forms. */
void scr_box_set_thunk_fn(ScrBox *b, ScrDynThunk f) { scr_box_set_thunk(b, f); }
ScrDynThunk scr_box_get_thunk_fn(const ScrBox *b) { return scr_box_get_thunk(b); }

void scr_box_set_bool(ScrBox *b, bool v) { b->slot = v ? 1 : 0; }

void scr_box_set_ref(ScrBox *b, void *v) {
  /* Unlink-then-release: the slot must already hold the new value when the
   * old one's release runs (it can trigger a collection, which must not
   * walk the b→old edge whose count was just given up). */
  void *old = scr_box_ptr(b);
  memcpy(&b->slot, &v, sizeof v);
  scr_box_release_payload(b, old);
}

/* ── closures ─────────────────────────────────────────────────────────── */

static void scr_closure_trace(void *o, ScrTraceVisit visit, void *ctx) {
  ScrClosure *c = (ScrClosure *)o;
  for (size_t i = 0; i < c->ncaps; i++) visit(c->caps[i], ctx);
  /* The OWN-PROPERTY table. It is a box like any capture, and it was the
   * last untraced strong edge out of a closure — which made the single
   * commonest ring in real JavaScript invisible:
   *
   *   function Foo() {}
   *   Foo.create = function () { return new Foo(); };   // captures Foo
   *
   * Foo -> props (box) -> the property dyn -> "create" (a FUNC dyn) -> that
   * closure -> its capture box -> Foo. protobufjs's generated code emits
   * exactly that for every message type, and zapo's spec has 2920 of them:
   * with this edge untraced, every one of those constructors was
   * permanently live, and with it every accessor pair hanging off its
   * prototype through implicit_proto -- measured as 8020 live closures and
   * 36990 live dyn values at exit, of which 5840 were one library's oneof
   * getter/setter pair.
   *
   * A probe pins it to this one edge and nothing else: 20 constructors with
   * two accessors each and a capturing static leak 80 closures; the same 20
   * with a NON-capturing static property are clean.
   *
   * implicit_proto is deliberately NOT traced. The constructor registry
   * (scr_json.c) keys on the prototype's ADDRESS and holds a borrowed
   * closure pointer, and its safety argument is precisely that the closure
   * owns the prototype so the key cannot be freed or recycled while the
   * entry lives. Tracing that edge would let the collector free the
   * prototype before the closure's teardown erases the entry. It is also
   * not needed: breaking the props ring frees the constructor, and the
   * constructor's teardown drops implicit_proto -- and with it the
   * accessor table -- by ordinary refcount. */
  visit(c->props, ctx);
}

/* NULL until the dyn unit mints its first implicit prototype object; see
 * scr_runtime.h. */
void (*scr_closure_ctor_unlink)(ScrClosure *c) = NULL;

/* The one teardown step both paths below share: drop the minted implicit
 * prototype (and its `constructor` registry entry) BEFORE `props` goes,
 * so the registry never holds a borrowed pointer to a closure that is
 * already being freed. */
static void scr_closure_drop_ctor(ScrClosure *c) {
  if (c->implicit_proto != NULL) scr_closure_ctor_unlink(c);
}

static void scr_closure_gcfree(void *o) {
  /* Caps and the own-property table are all boxes and all traced, so the
   * complement this teardown owes is just the minted prototype — dropped
   * through the ctor hook, which erases the registry entry first. */
  scr_closure_drop_ctor((ScrClosure *)o);
#ifdef SCR_RC_AUDIT
  scr_live_closures--;
  scr_clo_bump(((ScrClosure *)o)->fn, -1);
#endif
  scr_cyc_free(o);
}

#ifdef SCR_RC_AUDIT
/* live closures, keyed by their emitted body (scr_runtime.h) */

typedef struct { const void *fn; long live; } ScrCloBucket;
static ScrCloBucket *scr_clo_tab = NULL;
static size_t scr_clo_cap = 0; /* a power of two, or 0 */
static size_t scr_clo_used = 0;
static const ScrClosureSite *scr_clo_sites = NULL;
static size_t scr_clo_nsites = 0;

void scr_closure_sites_install(const ScrClosureSite *tbl, size_t n) {
  scr_clo_sites = tbl;
  scr_clo_nsites = n;
}

static size_t scr_clo_probe(ScrCloBucket *tab, size_t cap, const void *fn) {
  uintptr_t x = (uintptr_t)fn;
  x ^= x >> 33;
  x *= (uintptr_t)0xff51afd7ed558ccdULL;
  x ^= x >> 29;
  size_t mask = cap - 1, i = (size_t)x & mask;
  while (tab[i].fn != NULL && tab[i].fn != fn) i = (i + 1) & mask;
  return i;
}

static void scr_clo_grow(void) {
  size_t ncap = scr_clo_cap ? scr_clo_cap * 2 : 256;
  ScrCloBucket *ntab = calloc(ncap, sizeof *ntab);
  if (!ntab) scr_trap("scriptc: out of memory\n");
  for (size_t i = 0; i < scr_clo_cap; i++) {
    if (!scr_clo_tab[i].fn) continue;
    ntab[scr_clo_probe(ntab, ncap, scr_clo_tab[i].fn)] = scr_clo_tab[i];
  }
  free(scr_clo_tab);
  scr_clo_tab = ntab;
  scr_clo_cap = ncap;
}

static void scr_clo_bump(const void *fn, long d) {
  if (scr_clo_used * 10 >= scr_clo_cap * 7) scr_clo_grow();
  size_t i = scr_clo_probe(scr_clo_tab, scr_clo_cap, fn);
  if (!scr_clo_tab[i].fn) {
    scr_clo_tab[i].fn = fn;
    scr_clo_used++;
  }
  scr_clo_tab[i].live += d;
}

static const char *scr_clo_site_of(const void *fn) {
  for (size_t i = 0; i < scr_clo_nsites; i++) {
    if (scr_clo_sites[i].fn == fn) return scr_clo_sites[i].site;
  }
  return NULL;
}

/* Live dyn values by KIND -- the other half of the same problem: the
 * audit's single dyn total says nothing about what the leaked tree is
 * made of. Bumped by scr_json.c's alloc/release, printed here so both
 * tables come out of one entry point. */
long scr_dyn_live_by_kind[SCR_DYN_KIND_COUNT];
static const char *const scr_dyn_kind_names[SCR_DYN_KIND_COUNT] = {
    "null", "bool", "num", "str", "arr", "obj", "undef", "bytes", "func", "handle", "promise", "jsval", "objinst", "arrbuf", "bigint", "map",
};
/* A missing name would print as a NULL pointer for a kind that leaked,
 * which is the one moment this table is read. Sized from the enum so the
 * compiler catches a short initializer instead of the audit doing it. */
_Static_assert(sizeof scr_dyn_kind_names / sizeof scr_dyn_kind_names[0] == SCR_DYN_KIND_COUNT,
               "scr_dyn_kind_names must name every ScrDynKind");

void scr_rc_audit_sites_report(void) {
  fprintf(stderr, "scriptc RC AUDIT SITES: live closures by creation site\n");
  /* Selection sort over the occupied buckets: a few thousand at most,
   * once, on a run that is already failing. */
  long printed = 0, unnamed = 0, unnamed_rows = 0;
  for (;;) {
    size_t best = scr_clo_cap;
    for (size_t i = 0; i < scr_clo_cap; i++) {
      if (!scr_clo_tab[i].fn || scr_clo_tab[i].live <= 0) continue;
      if (best == scr_clo_cap || scr_clo_tab[i].live > scr_clo_tab[best].live) best = i;
    }
    if (best == scr_clo_cap) break;
    const char *site = scr_clo_site_of(scr_clo_tab[best].fn);
    if (site) {
      fprintf(stderr, "  %8ld  %s\n", scr_clo_tab[best].live, site);
    } else {
      fprintf(stderr, "  %8ld  <unnamed fn %p>\n", scr_clo_tab[best].live,
              scr_clo_tab[best].fn);
      unnamed += scr_clo_tab[best].live;
      unnamed_rows++;
    }
    printed += scr_clo_tab[best].live;
    scr_clo_tab[best].live = 0; /* consumed */
  }
  fprintf(stderr,
          "  -- %ld live closure(s) above; %ld of them in %ld unnamed row(s)%s\n",
          printed, unnamed, unnamed_rows,
          scr_clo_nsites == 0 ? " (no site table: build with SCRIPTC_RC_SITES=1)" : "");
  fprintf(stderr, "scriptc RC AUDIT SITES: live dyn values by kind\n");
  for (size_t k = 0; k < (size_t)SCR_DYN_KIND_COUNT; k++) {
    if (scr_dyn_live_by_kind[k] != 0) {
      fprintf(stderr, "  %8ld  %s\n", scr_dyn_live_by_kind[k],
              scr_dyn_kind_names[k]);
    }
  }
}
#endif /* SCR_RC_AUDIT */
ScrClosure *scr_closure_new(void *fn, size_t ncaps) {
  ScrClosure *c = scr_cyc_alloc(sizeof(ScrClosure) + ncaps * sizeof(ScrBox *),
                                 &scr_closure_trace, &scr_closure_gcfree);
  c->rc = 1;
  c->fn = fn;
  c->ncaps = ncaps;
  c->props = NULL; /* lazily allocated by Object.defineProperties */
  c->implicit_proto = NULL; /* lazily minted by scr_dyn_fn_prototype */
#ifdef SCR_RC_AUDIT
  scr_live_closures++;
  scr_clo_bump(fn, +1);
#endif
  return c;
}

void scr_closure_release(ScrClosure *c) {
  if (!c || c->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--c->rc == 0) {
    scr_cyc_on_dead(c);
    for (size_t i = 0; i < c->ncaps; i++) scr_box_release(c->caps[i]);
    scr_closure_drop_ctor(c);
    scr_box_release(c->props); /* NULL-tolerant */
#ifdef SCR_RC_AUDIT
    scr_live_closures--;
    scr_clo_bump(c->fn, -1);
#endif
    scr_cyc_free(c);
  } else {
    scr_cyc_on_release(c); /* possible cycle root; may collect — c is done */
  }
}

/* Teardown for an INTERNED function-value closure — the emitted static
 * literal whose `rc` is SIZE_MAX, so neither release path above can ever
 * run for it. Both of its lazily-created OWNED edges are dropped here:
 * the own-property table and the minted implicit prototype. Idempotent
 * (both are cleared), NULL-tolerant, and the single entry point the
 * emitters call so a future edge added to this struct does not need a
 * matching edit in three backends' exit code. */
void scr_closure_static_teardown(ScrClosure *c) {
  if (c == NULL) return;
  scr_closure_drop_ctor(c);
  scr_box_release(c->props);
  c->props = NULL;
}

void scr_closure_trace_v(void *c, ScrTraceVisit visit, void *ctx) {
  scr_closure_trace(c, visit, ctx);
}
