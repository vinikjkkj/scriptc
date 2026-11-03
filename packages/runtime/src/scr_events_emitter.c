/* The node:events EventEmitter — the runtime-provided BASE CLASS behind
 * `new EventEmitter()` and `class My extends EventEmitter` (the ScrError
 * precedent: ScrEmitter lays out exactly like a compiler-emitted hierarchy
 * class — rc, vt, then the prefix fields — so user subclasses embed it and
 * every vtable mechanism applies unchanged). This translation unit links
 * ONLY into binaries whose IR touches the emitter surface
 * (moduleUsesEmitter — the scr_events.c gating precedent); emitter-free
 * binaries keep their exact link line. Pure data structure: no event loop,
 * no poller — emits are synchronous calls on the caller's stack, exactly
 * Node's contract.
 *
 * Listener lists are name-keyed buckets in first-registration order
 * (eventNames order; a bucket emptied by removal DROPS, and a later add
 * re-appends — Node deletes the _events key the same way). Entries are
 * small shared heap nodes so an emit's SNAPSHOT and the live list agree on
 * the once-fired flag: Node emits over a copy (a listener removed
 * mid-emit still runs for that emit; one added waits), and a once wrapper
 * skips only when it already FIRED — mid-emit removal of a not-yet-run
 * once listener does not skip it, matching the wrapper's `fired` check.
 *
 * Dispatch is C-variadic: the emit call site passes the event tuple as
 * typed C values, and each listener invokes through a compiler-EMITTED
 * adapter `void inv(ScrClosure *cb, va_list ap)` that va_args exactly the
 * listener's own parameter prefix, retains the +1 the callee owns per the
 * universal convention, and calls cb->fn. The frontend's per-event tuple
 * unification is what makes every adapter's reads agree with every emit
 * site's writes. Internal (meta-event) emits reuse the same variadic
 * entry, passing the event NAME as the one argument — meta listeners are
 * fenced to arity <= 1, so no adapter ever reads the listener argument
 * Node would pass second.
 *
 * The special 'error' event routes through scr_emitter_emit_error: with no
 * 'error' listener the Error payload THROWS through the exception cell
 * (catchable; uncaught exits 1), Node's unhandled-'error' contract.
 *
 * The maxListeners leak warning prints Node's message shape on stderr,
 * once per (emitter, event name), plus the once-per-process
 * --trace-warnings hint line. Documented divergences: the pid in
 * "(node:pid)" is this process's (it can never equal the oracle's), and
 * the warning prints synchronously at the add (Node defers it a tick). */
#include "scr_runtime.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <process.h>
#define SCR_EE_PID() ((long)_getpid())
#else
#include <unistd.h>
#define SCR_EE_PID() ((long)getpid())
#endif

static void scr_ee_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* One registered listener. Shared between the live list and emit
 * snapshots via `refs` (never the closure's own rc: the node owns ONE cb
 * reference, released when the last holder lets go). */
typedef struct ScrEeEntry {
  ScrClosure *cb; /* owned by the node — what emit INVOKES */
  /* NULL for direct registrations. A dyn-adapted registration (the JS
   * lane's checked-dynamic listeners) invokes through a compiler-built
   * adapter closure (cb) but keeps the ORIGINAL function here (owned):
   * removeListener/off match it, listenerCount(name, fn) counts it, and
   * listeners()/rawListeners() answer it — Node's identity semantics. */
  ScrClosure *orig;
  /* A dyn-adapted registration keeps a COPY of its box's function payload
   * (the closure is already retained in `orig`; the call literals are static).
   * A meta event rebuilds a box from it for the listener's second argument,
   * so the entry never owns a dyn value of its own: a retained box here kept
   * the listener's closure alive past the program's last reference. */
  ScrDyn fnproto;
  bool has_fnproto;
  /* The ERASED TWIN (owned; NULL for most entries): the listener's second lowering with its
   * annotated parameter types erased to dyn, registered by a module whose emitters a dynamic
   * emit can reach. fnproto is the twin's box payload then, so emit.apply / emit(...spread) /
   * listeners() call it with the value exactly as Node passes it; the typed `cb` still
   * serves the static emits. Identity (off, listenerCount) matches either closure. */
  ScrClosure *twin;
  /* With a twin, the box payload USERS see: the ORIGINAL listener (the identity Node shows through
   * listeners()/rawListeners()/the removeListener meta argument) behind its typed checked thunk.
   * fnproto (the twin) is only the dispatch target of a dynamic emit. Closure unowned (the entry's
   * identity closure holds it); has_idproto false falls back to fnproto. */
  ScrDyn idproto;
  bool has_idproto;
  /* The identity Node's `_events` shows for a ONCE listener: its onceWrapper (a distinct function whose
   * `listener` is the original). Minted on the first `_events` read, owned (NULL otherwise). */
  ScrClosure *wrap;
  ScrBox *wfired; /* the wrapper's shared `fired` flag (Node's wrapper.fired); NULL until a wrapper exists */
  ScrEeInvoke inv;
  bool once;
  bool fired; /* a once entry that already ran (snapshot skip rule) */
  uint32_t refs;
} ScrEeEntry;

typedef struct ScrEeBucket {
  ScrStr *name; /* owned */
  ScrEeEntry **ls;
  size_t n, cap;
  bool warned; /* leak warning printed for this name already (Node: the listener ARRAY's `warned` property) */
  /* Node keeps ONE listener function per name until a second arrives, then an array whose enumerable
   * symbol events.emitting counts the in-flight emits that started on THAT array. Adding or removing while
   * one is in flight clones the array (the emit keeps iterating the old one). `epoch` names the current
   * array object (0: none yet), `emitting` is its counter, `view_epoch` the epoch the `_events` view's
   * array was built for. */
  uint32_t epoch, emitting, view_epoch;
  bool counted; /* contributes to _eventsCount */
  struct ScrEeBucket *next;
} ScrEeBucket;

struct ScrEeReg {
  ScrEeBucket *head; /* singly linked, first-registration order */
  double max;        /* -1 = unset (follows the default), 0 = unlimited */
  /* Node's kShapeMode: set when names were PRE-CREATED (the stream
   * constructors). In shape mode removeListener KEEPS an emptied name's
   * rank (Node writes events[type] = undefined instead of deleting) —
   * only removeAllListeners deletes: the named form drops the one key,
   * the no-argument wipe resets everything and leaves shape mode. */
  bool shape;
  /* The `_events` object a dyn read answers (cached null-prototype view): `ver` counts every change of the
   * listener table, `gen` every time Node REPLACES the object (the table emptying, removeAllListeners()).
   * The view is rebuilt in place while `gen` is unchanged, so `this._events === this._events` holds and a
   * held reference keeps seeing the live table, as Node's does. Owned; NULL until first read. */
  ScrDyn *view;
  uint32_t ver, gen, view_ver, view_gen, epoch_seq;
  /* Node's _eventsCount, maintained exactly as events.js does (+1 for a new name, -1 for a removed one, a
   * count reaching 0 replaces `_events`) so a program's own write to it behaves as in Node. */
  double ecount;
  bool max_set; /* _maxListeners holds a value (max); false is Node's undefined */
};

/* The vtable of BARE `new EventEmitter()` instances; the emitted main()
 * stamps pre/post from the program's preorder numbering (the
 * scr_error_vts precedent). release is the direct teardown below. */
static void scr_emitter_release_direct(void *obj);
/* Default interval {1, 0} is EMPTY: an unstamped emitter root (no emitter class in
 * the module graph) matches no object, so instanceof EventEmitter cannot read pre 0. */
ScrVt scr_emitter_vt = {1, 0, &scr_emitter_release_direct};

double scr_emitter_default_max = 10; /* EventEmitter.defaultMaxListeners */


/* Post-registration hook (scr_runtime.h): the stream unit's flow kick.
 * NULL in stream-free builds — behavior byte-identical. */
void (*scr_emitter_on_hook)(ScrEmitter *em, ScrStr *name) = NULL;

/* ── entries and buckets ──────────────────────────────────────────────── */

static void scr_ee_entry_unref(ScrEeEntry *e) {
  if (--e->refs > 0) return;
  scr_closure_release(e->cb);
  scr_closure_release(e->orig); /* NULL-tolerant */
  scr_closure_release(e->twin); /* NULL-tolerant */
  scr_closure_release(e->wrap); /* NULL-tolerant */
  if (e->wfired) scr_box_release(e->wfired);
  free(e);
}

/* The entry's IDENTITY closure — what Node would see as the listener. */
static ScrClosure *scr_ee_entry_fn(const ScrEeEntry *e) {
  return e->orig ? e->orig : e->cb;
}

/* Does the closure name this entry's listener: its identity, or (a dynamic value read back
 * through listeners()) its erased twin. */
static bool scr_ee_entry_is(const ScrEeEntry *e, const ScrClosure *c) {
  return scr_ee_entry_fn(e) == c || (e->twin != NULL && e->twin == c) || (e->wrap != NULL && e->wrap == c);
}

static ScrEeReg *scr_ee_reg_ensure(ScrEmitter *em) {
  if (!em->reg) {
    em->reg = calloc(1, sizeof *em->reg);
    if (!em->reg) scr_ee_oom();
    em->reg->max = -1;
    em->reg->max_set = false;
  }
  return em->reg;
}

static ScrEeBucket *scr_ee_bucket_find(ScrEeReg *reg, const char *name, size_t len) {
  if (!reg) return NULL;
  for (ScrEeBucket *b = reg->head; b; b = b->next) {
    if (b->name->len == len && memcmp(b->name->data, name, len) == 0) return b;
  }
  return NULL;
}

static ScrEeBucket *scr_ee_bucket_ensure(ScrEeReg *reg, ScrStr *name) {
  ScrEeBucket *b = scr_ee_bucket_find(reg, name->data, name->len);
  if (b) return b;
  b = calloc(1, sizeof *b);
  if (!b) scr_ee_oom();
  b->name = scr_str_retain(name);
  /* Append: bucket order IS eventNames() order. */
  ScrEeBucket **link = &reg->head;
  while (*link) link = &(*link)->next;
  *link = b;
  return b;
}

/* Reserve a name's first-registration RANK without any listener: Node's
 * stream classes pre-create their known _events keys (a V8 shape
 * optimization eventNames() order observes — 'error'/'data'/... list
 * before user events added earlier). An empty bucket is ABSENT for every
 * read (n == 0 everywhere); the first add fills it in place, and a bucket
 * emptied by removal still drops — Node deleting the key. */
void scr_emitter_reserve(ScrEmitter *em, const char *name) {
  ScrEeReg *reg = scr_ee_reg_ensure(em);
  reg->shape = true;
  if (scr_ee_bucket_find(reg, name, strlen(name))) return;
  ScrStr *n = scr_str_new(name, strlen(name));
  scr_ee_bucket_ensure(reg, n);
  scr_str_release(n);
}

/* Drops an emptied bucket from the list (Node deletes the _events key; a
 * later add re-appends at the end). */
static void scr_ee_bucket_drop(ScrEeReg *reg, ScrEeBucket *b) {
  ScrEeBucket **link = &reg->head;
  while (*link != b) link = &(*link)->next;
  *link = b->next;
  /* Node: a removed name decrements _eventsCount, and the count reaching 0 replaces `_events` with a fresh
   * object. */
  if (b->counted) {
    reg->ecount -= 1;
    if (reg->ecount == 0) reg->gen++;
  }
  scr_str_release(b->name);
  free(b->ls);
  free(b);
  reg->ver++;
}

static void scr_ee_mark_fired(ScrEeEntry *e);
static void scr_ee_emit_done(ScrEmitter *em, ScrStr *name, uint32_t epoch);

static bool scr_ee_has(ScrEeReg *reg, const char *name) {
  ScrEeBucket *b = scr_ee_bucket_find(reg, name, strlen(name));
  return b != NULL && b->n > 0;
}

/* ── the emitter object (hierarchy prefix helpers) ────────────────────── */

/* rc-0 teardown of the registry: releases EVERYTHING (closures included)
 * and frees the storage. The emitted subclass DIRECT releases call this
 * for their embedded prefix, exactly like a string field's release. */
void scr_emitter_reg_drop(ScrEeReg *reg) {
  if (!reg) return;
  ScrEeBucket *b = reg->head;
  while (b) {
    ScrEeBucket *next = b->next;
    for (size_t i = 0; i < b->n; i++) scr_ee_entry_unref(b->ls[i]);
    scr_str_release(b->name);
    free(b->ls);
    free(b);
    b = next;
  }
  if (reg->view != NULL) scr_dyn_release(reg->view);
  free(reg);
}

/* Collector trace: the listener closures are the registry's only
 * cycle-headered children (bucket names are strings — acyclic). */
void scr_emitter_reg_trace(ScrEeReg *reg, ScrTraceVisit visit, void *ctx) {
  if (!reg) return;
  if (reg->view != NULL) visit(reg->view, ctx); /* the `_events` view holds boxes of the listeners */
  for (ScrEeBucket *b = reg->head; b; b = b->next) {
    for (size_t i = 0; i < b->n; i++) {
      visit(b->ls[i]->cb, ctx);
      if (b->ls[i]->orig) visit(b->ls[i]->orig, ctx);
      if (b->ls[i]->twin) visit(b->ls[i]->twin, ctx);
      if (b->ls[i]->wrap) visit(b->ls[i]->wrap, ctx); /* the once wrapper's property table holds the original */
    }
  }
}

/* Collector teardown: the complement of the trace — releases the names,
 * frees vectors/entries/registry, but NOT the closures (traced edges were
 * already accounted by the collector). */
void scr_emitter_reg_gcfree(ScrEeReg *reg) {
  if (!reg) return;
  ScrEeBucket *b = reg->head;
  while (b) {
    ScrEeBucket *next = b->next;
    for (size_t i = 0; i < b->n; i++) {
      if (--b->ls[i]->refs == 0) {
        if (b->ls[i]->wfired) scr_box_release(b->ls[i]->wfired); /* a plain box: not a collector node */
        free(b->ls[i]);
      }
    }
    scr_str_release(b->name);
    free(b->ls);
    free(b);
    b = next;
  }
  free(reg);
}

void scr_emitter_trace(void *obj, ScrTraceVisit visit, void *ctx) {
  scr_emitter_reg_trace(((ScrEmitter *)obj)->reg, visit, ctx);
}

static void scr_emitter_gcfree(void *obj) {
  scr_emitter_reg_gcfree(((ScrEmitter *)obj)->reg);
  scr_obj_free_note();
  scr_cyc_free(obj);
}

static void scr_emitter_release_direct(void *obj) {
  ScrEmitter *em = obj;
  if (--em->rc == 0) {
    scr_cyc_on_dead(em);
    scr_emitter_reg_drop(em->reg);
    scr_obj_free_note();
    scr_cyc_free(em);
  } else {
    scr_cyc_on_release(em); /* possible cycle root; may collect */
  }
}

ScrEmitter *scr_emitter_new(void) {
  /* Always collector-headered: the registry holds closures, so the
   * emitter hierarchy is unconditionally cycle-capable (the canonical
   * capture cycle is `e.on('x', () => e.emit(...))`). */
  ScrEmitter *em = scr_cyc_alloc(sizeof *em, &scr_emitter_trace, &scr_emitter_gcfree);
  em->rc = 1;
  em->vt = &scr_emitter_vt;
  em->reg = NULL;
  em->cls = "EventEmitter";
  scr_obj_alloc_note();
  return em;
}

/* super() into the emitter prefix of an emitted subclass: the allocation
 * already zeroed reg and stamped the concrete class's display name, so
 * construction has nothing left to do — the call exists so the super()
 * statement lowers to a real site (and may grow options later). */
void scr_emitter_init(void *obj) { (void)obj; }

ScrEmitter *scr_emitter_retain(ScrEmitter *em) {
  if (em && em->rc != SIZE_MAX) {
    em->rc++;
    scr_cyc_mark_live(em);
  }
  return em;
}

void scr_emitter_release(ScrEmitter *em) {
  if (!em || em->rc == SIZE_MAX) return;
  em->vt->release(em); /* the DYNAMIC class's teardown */
}

void *scr_emitter_retain_v(void *em) { return scr_emitter_retain(em); }
void scr_emitter_release_v(void *em) { scr_emitter_release(em); }

/* ── the meta events ('newListener' / 'removeListener') ──────────────── */

static bool scr_ee_emit_va(ScrEmitter *em, ScrStr *name, ...);

/* Fires a meta event with the affected event's NAME as the argument
 * (listeners are fenced to arity <= 1, so the listener-function argument
 * Node passes second is never read). */
static void scr_ee_emit_meta(ScrEmitter *em, const char *meta, ScrStr *name, const ScrDyn *proto) {
  if (!scr_ee_has(em->reg, meta)) return;
  ScrStr *m = scr_str_new(meta, strlen(meta));
  /* Node's (eventName, listener): the listener FUNCTION rides as the second
   * tuple slot. Name-only meta listeners never read it; a checked-dynamic
   * one with more parameters (or one reading `arguments`) reads the box.
   * The box is built for this emit only and released after it. A
   * registration with no box (one the runtime itself made, or a typed
   * listener) hands the observer undefined. */
  if (proto == NULL) {
    scr_ee_emit_va(em, m, name, (void *)scr_dyn_undefined());
  } else {
    ScrDyn *box = scr_dyn_new_func_src(scr_closure_retain(proto->v.fn.clo), proto->v.fn.thunk,
                                       proto->v.fn.arity, scr_dyn_fn_sig(proto),
                                       scr_dyn_fn_name(proto), scr_dyn_fn_src(proto));
    scr_ee_emit_va(em, m, name, (void *)box);
    scr_dyn_release(box);
  }
  scr_str_release(m);
}

/* ── add / remove ─────────────────────────────────────────────────────── */

static void scr_ee_warn_maybe(ScrEmitter *em, ScrEeBucket *b) {
  ScrEeReg *reg = em->reg;
  double max = reg->max_set ? reg->max : scr_emitter_default_max;
  if (b->warned || max <= 0 || (double)b->n <= max) return;
  b->warned = true;
  /* Node's message byte for byte — except the pid, which is OURS (it can
   * never match another process's), and the synchronous timing (Node
   * defers the print by a tick). SEMANTICS.md documents both. */
  char msg[512];
  snprintf(msg, sizeof msg,
           "Possible EventEmitter memory leak detected. %zu %s listeners added to [%s]. "
           "MaxListeners is %g. Use emitter.setMaxListeners() to increase limit",
           b->n, b->name->data, em->cls, max);
  scr_warn_report("MaxListenersExceededWarning", NULL, msg, NULL);
}

/* Registers a listener. cb and orig MOVE in; name is borrowed. Returns em
 * +1 (the `return this` chaining value). 'newListener' fires BEFORE the
 * add, like Node. A listener throw inside the meta emit leaves the
 * exception pending; the add still happens (Node's addListener has no
 * try). */
static ScrEmitter *scr_ee_add3(ScrEmitter *em, ScrStr *name, ScrClosure *cb /*moves*/,
                               ScrClosure *orig /*moves; may be NULL*/,
                               const ScrDyn *box /*borrowed; NULL for direct*/,
                               const ScrDyn *proto /*borrowed; stored only; NULL for none*/,
                               ScrClosure *twin /*moves; may be NULL*/, const ScrDyn *ident /*borrowed; may be NULL*/,
                               ScrEeInvoke inv, bool once, bool prepend);
static ScrEmitter *scr_ee_add2(ScrEmitter *em, ScrStr *name, ScrClosure *cb /*moves*/,
                               ScrClosure *orig /*moves; may be NULL*/,
                               const ScrDyn *box /*borrowed; NULL for direct*/,
                               const ScrDyn *proto /*borrowed; stored only; NULL for none*/,
                               ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add3(em, name, cb, orig, box, proto, NULL, NULL, inv, once, prepend);
}
static ScrEmitter *scr_ee_add(ScrEmitter *em, ScrStr *name, ScrClosure *cb /*moves*/,
                              ScrClosure *orig /*moves; may be NULL*/,
                              const ScrDyn *box /*borrowed; NULL for direct*/,
                              ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add2(em, name, cb, orig, box, NULL, inv, once, prepend);
}
static ScrEmitter *scr_ee_add3(ScrEmitter *em, ScrStr *name, ScrClosure *cb /*moves*/,
                               ScrClosure *orig /*moves; may be NULL*/,
                               const ScrDyn *box /*borrowed; NULL for direct*/,
                               const ScrDyn *proto /*borrowed; stored only; NULL for none*/,
                               ScrClosure *twin /*moves; may be NULL*/, const ScrDyn *ident /*borrowed; may be NULL*/,
                               ScrEeInvoke inv, bool once, bool prepend) {
  scr_ee_reg_ensure(em);
  scr_ee_emit_meta(em, "newListener", name, box);
  ScrEeBucket *b = scr_ee_bucket_ensure(em->reg, name);
  ScrEeEntry *e = calloc(1, sizeof *e);
  if (!e) scr_ee_oom();
  e->cb = cb;
  e->orig = orig;
  e->twin = twin;
  if (ident != NULL) {
    e->idproto = *ident;
    e->has_idproto = true;
  }
  if (box != NULL) {
    e->fnproto = *box;
    e->has_fnproto = true;
  } else if (proto != NULL) {
    /* A TYPED listener whose function payload was boxed by the compiler (a module that
     * can reach this emitter through a dynamic value): kept so emit.apply / emit(...spread) /
     * listeners() can call and answer it, without the newListener observers seeing it
     * (they keep the registration's own view). */
    e->fnproto = *proto;
    e->has_fnproto = true;
  }
  e->inv = inv;
  e->once = once;
  e->refs = 1;
  if (b->n == b->cap) {
    b->cap = b->cap ? b->cap * 2 : 2;
    b->ls = realloc(b->ls, b->cap * sizeof *b->ls);
    if (!b->ls) scr_ee_oom();
  }
  if (b->n == 0) {
    b->counted = true;
    em->reg->ecount += 1;
  } else if (b->n == 1) {
    b->epoch = ++em->reg->epoch_seq; /* the second listener makes a NEW array */
    b->emitting = 0;
    b->warned = false;
  } else if (b->emitting > 0) {
    b->epoch = ++em->reg->epoch_seq; /* added during an emit: the array is cloned */
    b->emitting = 0;
  }
  if (prepend) {
    memmove(b->ls + 1, b->ls, b->n * sizeof *b->ls);
    b->ls[0] = e;
  } else {
    b->ls[b->n] = e;
  }
  b->n++;
  em->reg->ver++;
  scr_ee_warn_maybe(em, b);
  if (scr_emitter_on_hook != NULL) scr_emitter_on_hook(em, name);
  return scr_emitter_retain(em);
}

ScrEmitter *scr_emitter_on(ScrEmitter *em, ScrStr *name, ScrClosure *cb /*moves*/,
                            ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add(em, name, cb, NULL, NULL, inv, once, prepend);
}

/* scr_emitter_on for a module whose emitters can be reached through a dynamic value: `proto`
 * is the listener's compiler-built dyn function box (borrowed; its payload is copied, the
 * closure is cb itself), so a dynamic-list emit calls the typed listener through the box's
 * checked thunk. */
ScrEmitter *scr_emitter_on_boxed(ScrEmitter *em, ScrStr *name, ScrClosure *cb /*moves*/,
                                 const ScrDyn *proto, ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add2(em, name, cb, NULL, NULL, proto, inv, once, prepend);
}

/* scr_emitter_on_boxed with the listener's ERASED TWIN: `twin` MOVES in, `proto` is the box of
 * the TWIN (a function whose parameters are dyn), so a dynamic-list emit hands the listener the
 * values exactly as Node does. cb (typed) stays what a static emit invokes. */
ScrEmitter *scr_emitter_on_twin(ScrEmitter *em, ScrStr *name, ScrClosure *cb /*moves*/,
                                ScrClosure *twin /*moves*/, const ScrDyn *proto, const ScrDyn *ident,
                                ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add3(em, name, cb, NULL, NULL, proto, twin, ident, inv, once, prepend);
}

/* The dyn-adapted registration (JS-lane checked-dynamic listeners): the
 * ADAPTER closure (compiler-built — boxes the event tuple to dyn and
 * calls the original through the checked-dynamic machinery) is what emit
 * invokes; the ORIGINAL function (the dyn box's underlying closure) is
 * the entry's identity. cb must be a SCR_DYN_FUNC (the emitted
 * scr_emitter_check_listener ran first); adapter MOVES in, cb is
 * borrowed. */
ScrEmitter *scr_emitter_on_dyn(ScrEmitter *em, ScrStr *name, const ScrDyn *cb,
                                ScrClosure *adapter /*moves*/,
                                ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add(em, name, adapter, scr_closure_retain(cb->v.fn.clo), cb,
                    inv, once, prepend);
}

/* The adapter-mediated registration (the LLVM backend): adapter is what
 * emit invokes, orig is the entry's identity — the on_dyn split with a
 * plain-closure identity. Both move in. */
ScrEmitter *scr_emitter_on_via(ScrEmitter *em, ScrStr *name, ScrClosure *orig /*moves*/,
                                ScrClosure *adapter /*moves*/,
                                ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add(em, name, adapter, orig, NULL, inv, once, prepend);
}

/* scr_emitter_on_via with the listener's boxed function payload (see scr_emitter_on_boxed). */
ScrEmitter *scr_emitter_on_via_boxed(ScrEmitter *em, ScrStr *name, ScrClosure *orig /*moves*/,
                                     ScrClosure *adapter /*moves*/, const ScrDyn *proto,
                                     ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add2(em, name, adapter, orig, NULL, proto, inv, once, prepend);
}

/* scr_emitter_on_via with the erased twin (see scr_emitter_on_twin). */
ScrEmitter *scr_emitter_on_via_twin(ScrEmitter *em, ScrStr *name, ScrClosure *orig /*moves*/,
                                    ScrClosure *adapter /*moves*/, ScrClosure *twin /*moves*/,
                                    const ScrDyn *proto, const ScrDyn *ident, ScrEeInvoke inv, bool once, bool prepend) {
  return scr_ee_add3(em, name, adapter, orig, NULL, proto, twin, ident, inv, once, prepend);
}

/* ── fixed-arity invoke shims (scr_runtime.h's contract) ──────────────
 * Read k pointer-size slots and call the fixed-signature adapter behind
 * cb->fn. The LLVM lane's emit sites pass every tuple argument pointer-
 * classed (f64 as its i64 bit pattern, bool zero-extended) and the
 * runtime's own emits are pointer-only, so va_arg(ap, void *) reads every
 * tuple a fixed-registered listener can observe. */
void scr_ee_inv_fixed0(ScrClosure *cb, va_list ap) {
  (void)ap;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}
void scr_ee_inv_fixed1(ScrClosure *cb, va_list ap) {
  void *a0 = va_arg(ap, void *);
  ((void (*)(ScrClosure *, void *))cb->fn)(cb, a0);
}
void scr_ee_inv_fixed2(ScrClosure *cb, va_list ap) {
  void *a0 = va_arg(ap, void *);
  void *a1 = va_arg(ap, void *);
  ((void (*)(ScrClosure *, void *, void *))cb->fn)(cb, a0, a1);
}
void scr_ee_inv_fixed3(ScrClosure *cb, va_list ap) {
  void *a0 = va_arg(ap, void *);
  void *a1 = va_arg(ap, void *);
  void *a2 = va_arg(ap, void *);
  ((void (*)(ScrClosure *, void *, void *, void *))cb->fn)(cb, a0, a1, a2);
}
void scr_ee_inv_fixed4(ScrClosure *cb, va_list ap) {
  void *a0 = va_arg(ap, void *);
  void *a1 = va_arg(ap, void *);
  void *a2 = va_arg(ap, void *);
  void *a3 = va_arg(ap, void *);
  ((void (*)(ScrClosure *, void *, void *, void *, void *))cb->fn)(cb, a0, a1, a2, a3);
}

/* Removes one entry (by index) from a bucket's live list and fires the
 * 'removeListener' meta event AFTER the removal, Node's order. Drops the
 * bucket when emptied — except in shape mode, where the emptied name
 * keeps its rank (Node's events[type] = undefined). */
static void scr_ee_remove_at(ScrEmitter *em, ScrEeBucket *b, size_t i) {
  ScrEeEntry *e = b->ls[i];
  if (b->n >= 2 && b->emitting > 0) { /* removed during an emit: the array is cloned */
    b->epoch = ++em->reg->epoch_seq;
    b->emitting = 0;
  }
  memmove(b->ls + i, b->ls + i + 1, (b->n - i - 1) * sizeof *b->ls);
  b->n--;
  if (b->n == 1) b->epoch = ++em->reg->epoch_seq; /* the array collapses to its one function */
  em->reg->ver++;
  ScrStr *name = scr_str_retain(b->name);
  if (b->n == 0 && !em->reg->shape) scr_ee_bucket_drop(em->reg, b);
  /* The removed entry outlives its list slot until the meta event has
   * fired: 'removeListener' hands the listener box it still holds. */
  scr_ee_emit_meta(em, "removeListener", name, e->has_idproto ? &e->idproto : e->has_fnproto ? &e->fnproto : NULL);
  scr_ee_entry_unref(e);
  scr_str_release(name);
}

/* removeListener/off: the LAST matching occurrence leaves (Node searches
 * from the end). cb is borrowed. Returns em +1. */
ScrEmitter *scr_emitter_off(ScrEmitter *em, ScrStr *name, ScrClosure *cb) {
  ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, name->data, name->len) : NULL;
  if (b) {
    for (size_t i = b->n; i-- > 0;) {
      if (scr_ee_entry_is(b->ls[i], cb)) {
        scr_ee_remove_at(em, b, i);
        break;
      }
    }
  }
  return scr_emitter_retain(em);
}

/* off/removeListener with a checked-dynamic listener: the identity is the
 * dyn box's underlying closure (check_listener ran first — the kind IS
 * function). cb borrowed; returns em +1. */
ScrEmitter *scr_emitter_off_dyn(ScrEmitter *em, ScrStr *name, const ScrDyn *cb) {
  return scr_emitter_off(em, name, cb->v.fn.clo);
}

/* The listener-argument type check Node runs first in the whole
 * registration family (on, once, the prepend forms, removeListener): a
 * non-function throws the catchable ERR_INVALID_ARG_TYPE TypeError,
 * message shaped by errors.js's determineSpecificType (scalars render
 * inspected and truncate at 28 rendered chars to 25 + "..."; strings take
 * the simple '-quoted spelling — listener mistakes are words, not escape
 * zoos). */
void scr_emitter_check_listener(const ScrDyn *cb) {
  /* The shared gate lives in the always-linked dyn core (scr_json.c) so
   * the handle dispatchers' .on paths render the same shapes without
   * linking this unit. */
  scr_dyn_check_listener(cb, "listener");
}

/* removeAllListeners(name?) — all = no name argument. With NO
 * 'removeListener' listeners this is a plain wipe (no events, Node's fast
 * path). With them, listeners leave ONE AT A TIME in LIFO order, each
 * firing the meta event — and the whole-emitter form does every other
 * event first (bucket order), 'removeListener' itself LAST. Returns em +1. */
static void scr_ee_remove_all_named(ScrEmitter *em, ScrEeBucket *b, bool meta) {
  if (b->n == 0) {
    /* An empty rank-holding bucket reaches here only from the WIPE scan
     * (the named form skips undefined keys — Node no-ops and the rank
     * stays): drop it, the wipe resets _events wholesale. */
    scr_ee_bucket_drop(em->reg, b);
    return;
  }
  if (!meta) {
    for (size_t i = 0; i < b->n; i++) scr_ee_entry_unref(b->ls[i]);
    b->n = 0;
    scr_ee_bucket_drop(em->reg, b);
    return;
  }
  /* Node snapshots the list and removeListener()s each entry from the
   * END (LIFO): meta listeners run per removal, and anything they add
   * survives. The bucket can drop (and even be recreated) under the
   * pass, so every step re-finds it and matches entries by identity. */
  ScrStr *name = scr_str_retain(b->name);
  size_t n = b->n;
  ScrEeEntry **snap = malloc(n * sizeof *snap);
  if (!snap) scr_ee_oom();
  for (size_t i = 0; i < n; i++) {
    snap[i] = b->ls[i];
    snap[i]->refs++;
  }
  for (size_t i = n; i-- > 0;) {
    ScrEeEntry *e = snap[i];
    ScrEeBucket *live = scr_ee_bucket_find(em->reg, name->data, name->len);
    if (live) {
      for (size_t j = live->n; j-- > 0;) {
        if (live->ls[j] == e) {
          scr_ee_remove_at(em, live, j);
          break;
        }
      }
    }
    scr_ee_entry_unref(e);
  }
  free(snap);
  scr_str_release(name);
}

ScrEmitter *scr_emitter_remove_all(ScrEmitter *em, ScrStr *name, bool all) {
  ScrEeReg *reg = em->reg;
  if (!reg) return scr_emitter_retain(em);
  bool meta = scr_ee_has(reg, "removeListener");
  if (!all) {
    ScrEeBucket *b = scr_ee_bucket_find(reg, name->data, name->len);
    /* A rank-holding empty bucket is Node's `events[type] === undefined`:
     * the named form no-ops there (the rank survives). A POPULATED name
     * deletes its key even in shape mode — but through the meta path each
     * listener leaves via removeListener, whose shape rule KEEPS the
     * emptied rank (Node's exact split). */
    if (b && b->n > 0) {
      scr_ee_remove_all_named(em, b, meta);
      if (!meta) {
        /* Node's non-meta named branch: the count hitting zero replaces
         * _events wholesale — every rank (pre-created included) goes,
         * though kShapeMode itself stays set (Node's exact quirk). */
        bool any_live = false;
        for (ScrEeBucket *w = reg->head; w; w = w->next) {
          if (w->n > 0) { any_live = true; break; }
        }
        if (!any_live) {
          while (reg->head) scr_ee_bucket_drop(reg, reg->head);
        }
      }
    }
    return scr_emitter_retain(em);
  }
  /* Every event except 'removeListener' first, in bucket order; then
   * 'removeListener' itself. The bucket list mutates under us (drops,
   * meta listeners may add), so restart the scan after each bucket. */
  for (;;) {
    ScrEeBucket *pick = NULL;
    for (ScrEeBucket *b = reg->head; b; b = b->next) {
      if (b->name->len == 14 && memcmp(b->name->data, "removeListener", 14) == 0) continue;
      pick = b;
      break;
    }
    if (!pick) break;
    scr_ee_remove_all_named(em, pick, meta);
  }
  ScrEeBucket *rl = scr_ee_bucket_find(reg, "removeListener", 14);
  if (rl) scr_ee_remove_all_named(em, rl, meta);
  /* The wipe replaces _events wholesale in Node — pre-created ranks are
   * gone and the emitter leaves shape mode. */
  while (reg->head) scr_ee_bucket_drop(reg, reg->head);
  reg->shape = false;
  reg->ecount = 0;
  reg->gen++; /* removeAllListeners() always installs a fresh `_events` object, even over an empty one */
  reg->ver++;
  return scr_emitter_retain(em);
}

/* ── emit ─────────────────────────────────────────────────────────────── */

/* One dispatch pass over a SNAPSHOT of the bucket: entries invoke in list
 * order through their emitted adapters, each with a fresh va_start over
 * the emit site's typed tail. A once entry leaves the live list (firing
 * 'removeListener', Node's wrapper calls removeListener) BEFORE its
 * callback runs, and never runs twice even when a nested emit's snapshot
 * still holds it (the shared fired flag — Node's wrapper.fired). A
 * listener throw stops the pass (the exception stays pending for the
 * caller). Returns whether the bucket had listeners. */
static bool scr_ee_emit_core(ScrEmitter *em, ScrStr *name, va_list *ap_template) {
  ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, name->data, name->len) : NULL;
  if (!b || b->n == 0) return false;
  size_t n = b->n;
  ScrEeEntry **snap = malloc(n * sizeof *snap);
  if (!snap) scr_ee_oom();
  for (size_t i = 0; i < n; i++) {
    snap[i] = b->ls[i];
    snap[i]->refs++;
  }
  /* Node: an emit over a listener ARRAY counts itself in the array's events.emitting symbol. */
  const bool tracked = n >= 2;
  const uint32_t track_epoch = b->epoch;
  if (tracked) b->emitting++;
  for (size_t i = 0; i < n; i++) {
    ScrEeEntry *e = snap[i];
    if (scr_exc_pending()) {
      scr_ee_entry_unref(e);
      continue;
    }
    if (e->once) {
      if (e->fired) {
        scr_ee_entry_unref(e);
        continue;
      }
      scr_ee_mark_fired(e);
      /* Remove from the live list first (the wrapper's own removal). The
       * bucket may have been dropped/recreated by earlier listeners —
       * re-find it and match by entry identity. */
      ScrEeBucket *live = scr_ee_bucket_find(em->reg, name->data, name->len);
      if (live) {
        for (size_t j = 0; j < live->n; j++) {
          if (live->ls[j] == e) {
            scr_ee_remove_at(em, live, j);
            break;
          }
        }
      }
      if (scr_exc_pending()) { /* a removeListener meta listener threw */
        scr_ee_entry_unref(e);
        continue;
      }
    }
    va_list ap;
    va_copy(ap, *ap_template);
    e->inv(e->cb, ap);
    va_end(ap);
    scr_ee_entry_unref(e);
  }
  if (tracked) scr_ee_emit_done(em, name, track_epoch);
  free(snap);
  return true;
}

static bool scr_ee_emit_va(ScrEmitter *em, ScrStr *name, ...) {
  va_list ap;
  va_start(ap, name);
  bool had = scr_ee_emit_core(em, name, &ap);
  va_end(ap);
  return had;
}

/* emit(name, ...tuple) — the emitted call site passes the event's unified
 * tuple as typed C variadics (doubles, pointers, ints for bools); every
 * argument is BORROWED (adapters retain the +1 each callee owns). May
 * leave an exception pending (a listener threw). */
bool scr_emitter_emit(ScrEmitter *em, ScrStr *name, ...) {
  va_list ap;
  va_start(ap, name);
  bool had = scr_ee_emit_core(em, name, &ap);
  va_end(ap);
  return had;
}

/* emit.apply(this, arr) — the event name and the listener arguments come from
 * one runtime array (`target.emit.apply(target, args)`). Each listener's
 * original dyn function (its box) is called with the full argument list, so
 * the listener sees Node's exact arguments. The frontend compiles this only
 * when every listener of the event is checked-dynamic, so a listener without
 * a box cannot be reached (trapped, not thrown, if that guarantee breaks).
 * Unhandled 'error' throws the first argument, as emit('error') does. */
bool scr_emitter_emit_dyn_array(ScrEmitter *em, ScrDyn *arr) {
  size_t total = (size_t)scr_dyn_arr_len(arr);
  ScrDyn **items = total ? malloc(total * sizeof *items) : NULL;
  if (total && !items) scr_ee_oom();
  for (size_t i = 0; i < total; i++) items[i] = scr_dyn_arr_at(arr, (double)i);
  bool had = scr_emitter_emit_dyn_list(em, NULL, items, total);
  for (size_t i = 0; i < total; i++) scr_dyn_release(items[i]);
  free(items);
  return had;
}

/* emit(...items) over a borrowed dyn argument vector: items[0] is the event name (undefined
 * when absent), the rest the listener arguments. `self` (may be NULL) is the dyn box of the
 * emitter, bound as `this` for each listener call (Node calls a listener with the emitter as
 * its receiver). Every listener is reached through its function box: a dyn-registered entry
 * keeps its box, a typed entry the one the compiler built for it. An entry with neither
 * traps (the module could not box that listener's type; the frontend refuses the reachable
 * shapes at build time). 'error' with no listener throws Node's way: an Error payload as is,
 * anything else as ERR_UNHANDLED_ERROR. */
bool scr_emitter_emit_dyn_list(ScrEmitter *em, ScrDyn *self, ScrDyn *const *items, size_t total) {
  size_t argc = total > 0 ? total - 1 : 0;
  ScrDyn *key_d = total > 0 ? scr_dyn_retain(items[0]) : scr_dyn_retain(scr_dyn_undefined());
  ScrStr *name = scr_dyn_string_coerce_js(key_d);
  scr_dyn_release(key_d);
  if (name == NULL) return false; /* ToPropertyKey threw: the exception is pending */
  ScrDyn *const *argv = argc ? items + 1 : NULL;
  ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, name->data, name->len) : NULL;
  bool had = b != NULL && b->n > 0;
  if (!had && name->len == 5 && memcmp(name->data, "error", 5) == 0) {
    ScrDyn *payload = argc ? scr_dyn_retain(argv[0]) : scr_dyn_retain(scr_dyn_undefined());
    scr_str_release(name);
    if (!scr_dyn_instanceof_error(payload) && scr_nonerr_unhandled_fn != NULL) {
      ScrError *u = scr_nonerr_unhandled_fn(payload);
      scr_dyn_release(payload);
      if (u != NULL) {
        scr_throw_obj(scr_error_retain(u), &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
        scr_error_release(u);
        return false;
      }
      payload = scr_dyn_retain(scr_dyn_undefined());
    }
    scr_throw_dyn(payload);
    return false;
  }
  if (had) {
    size_t n = b->n;
    ScrEeEntry **snap = malloc(n * sizeof *snap);
    if (!snap) scr_ee_oom();
    for (size_t i = 0; i < n; i++) {
      snap[i] = b->ls[i];
      snap[i]->refs++;
    }
    const bool tracked = n >= 2;
    const uint32_t track_epoch = b->epoch;
    if (tracked) b->emitting++;
    for (size_t i = 0; i < n; i++) {
      ScrEeEntry *e = snap[i];
      if (scr_exc_pending()) {
        scr_ee_entry_unref(e);
        continue;
      }
      if (e->once) {
        if (e->fired) {
          scr_ee_entry_unref(e);
          continue;
        }
        scr_ee_mark_fired(e);
        ScrEeBucket *live = scr_ee_bucket_find(em->reg, name->data, name->len);
        if (live) {
          for (size_t j = 0; j < live->n; j++) {
            if (live->ls[j] == e) {
              scr_ee_remove_at(em, live, j);
              break;
            }
          }
        }
        if (scr_exc_pending()) {
          scr_ee_entry_unref(e);
          continue;
        }
      }
      if (!e->has_fnproto) scr_trap("scriptc: emit with a dynamic argument list reached a typed listener\n");
      if (self != NULL) scr_dyn_this_push_dyn(self);
      ScrDyn *r = scr_dyn_call(&e->fnproto, (ScrDyn **)argv, argc, "listener");
      if (self != NULL) scr_dyn_this_pop();
      scr_dyn_release(r);
      scr_ee_entry_unref(e);
    }
    if (tracked) scr_ee_emit_done(em, name, track_epoch);
    free(snap);
  }
  scr_str_release(name);
  return had;
}

/* emit('error', err) — Node's special event: with no 'error' listener the
 * payload THROWS (catchable; uncaught exits 1 with the error report).
 * err is borrowed; the throw takes its own +1. */

bool scr_emitter_emit_error(ScrEmitter *em, ScrStr *name, ScrError *err) {
  if (!scr_ee_has(em->reg, "error")) {
    if (scr_error_is_nonerr(err)) {
      /* Node: an unhandled 'error' whose value is not an Error throws
       * ERR_UNHANDLED_ERROR, "Unhandled error. (<inspect(value)>)". */
      /* The text is util.inspect(value) (depth 2), rendered by the inspect
       * unit, which installs this hook when it links (it is linked exactly
       * when a non-Error wrapper can exist: stream.destroyDyn). */
      ScrError *u = scr_nonerr_unhandled_fn != NULL
          ? scr_nonerr_unhandled_fn(scr_error_nonerr_payload(err))
          : NULL;
      if (u == NULL) {
        ScrStr *fm = scr_str_new("Unhandled error.", 16);
        u = scr_error_new(SCR_ERR_ERROR, fm);
        scr_str_release(fm);
        u->code = scr_str_new("ERR_UNHANDLED_ERROR", 19);
      }
      scr_throw_obj(scr_error_retain(u), &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
      scr_error_release(u);
      return false;
    }
    scr_throw_obj(scr_error_retain(err), &scr_error_retain_v, &scr_error_release_v,
                  scr_error_trace_arg());
    return false;
  }
  return scr_ee_emit_va(em, name, err);
}

/* ── introspection ────────────────────────────────────────────────────── */

/* The stream unit's registration probe (any unit's, really). */
bool scr_emitter_has(ScrEmitter *em, const char *name) {
  return scr_ee_has(em->reg, name);
}

double scr_emitter_listener_count(ScrEmitter *em, ScrStr *name) {
  ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, name->data, name->len) : NULL;
  return b ? (double)b->n : 0;
}

/* listenerCount(name, fn): entries matching fn by identity. */
double scr_emitter_listener_count_fn(ScrEmitter *em, ScrStr *name, ScrClosure *fn) {
  ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, name->data, name->len) : NULL;
  if (!b) return 0;
  size_t count = 0;
  for (size_t i = 0; i < b->n; i++) {
    if (scr_ee_entry_is(b->ls[i], fn)) count++;
  }
  return (double)count;
}

/* eventNames(): +1 string[] of the bucket names in first-registration
 * order (exactly Node's _events key order). Reserved-but-empty buckets
 * (the stream pre-created keys) are invisible until a listener lands. */
/* A canonical array index ("0", "7", "4294967294"): JavaScript lists these keys FIRST, ascending, ahead of the
 * insertion-ordered rest (Reflect.ownKeys over `_events`). */
static bool ee_name_index(const ScrStr *s, uint64_t *out) {
  if (s->len == 0 || s->len > 10) return false;
  if (s->len > 1 && s->data[0] == '0') return false;
  uint64_t v = 0;
  for (size_t i = 0; i < s->len; i++) {
    if (s->data[i] < '0' || s->data[i] > '9') return false;
    v = v * 10 + (uint64_t)(s->data[i] - '0');
  }
  if (v > 4294967294ULL) return false;
  *out = v;
  return true;
}

/* The live buckets' names in JavaScript key order, as a malloc'd array of borrowed bucket names (count in *n). */
static ScrStr **ee_names_ordered(ScrEeReg *reg, size_t *n) {
  size_t cnt = 0;
  for (ScrEeBucket *b = reg->head; b; b = b->next) cnt += b->n > 0 ? 1 : 0;
  ScrStr **out = malloc((cnt ? cnt : 1) * sizeof *out);
  if (!out) scr_ee_oom();
  size_t k = 0;
  for (ScrEeBucket *b = reg->head; b; b = b->next) {
    uint64_t v;
    if (b->n > 0 && ee_name_index(b->name, &v)) {
      size_t at = k;
      uint64_t w;
      while (at > 0 && ee_name_index(out[at - 1], &w) && w > v) {
        out[at] = out[at - 1];
        at--;
      }
      out[at] = b->name;
      k++;
    }
  }
  for (ScrEeBucket *b = reg->head; b; b = b->next) {
    uint64_t v;
    if (b->n > 0 && !ee_name_index(b->name, &v)) out[k++] = b->name;
  }
  *n = k;
  return out;
}

ScrArr *scr_emitter_event_names(ScrEmitter *em) {
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, 0);
  if (em->reg) {
    size_t n = 0;
    ScrStr **names = ee_names_ordered(em->reg, &n);
    for (size_t i = 0; i < n; i++) scr_arr_push_ref(out, scr_str_retain(names[i]));
    free(names);
  }
  return out;
}

/* listeners(name) / rawListeners(name): +1 closure array in list order.
 * The once wrapper is runtime-internal here, so BOTH forms answer the
 * original listeners (SEMANTICS.md documents the rawListeners
 * divergence). */
ScrArr *scr_emitter_listeners(ScrEmitter *em, ScrStr *name) {
  ScrArr *out = scr_arr_new_ref(&scr_closure_retain_v, &scr_closure_release_v,
                                 &scr_closure_trace_v, 0);
  ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, name->data, name->len) : NULL;
  if (b) {
    for (size_t i = 0; i < b->n; i++) {
      scr_arr_push_ref(out, scr_closure_retain(scr_ee_entry_fn(b->ls[i])));
    }
  }
  return out;
}

/* ── max listeners ────────────────────────────────────────────────────── */

/* The checked-dynamic setMaxListeners ladder: non-numbers throw Node's
 * ERR_INVALID_ARG_TYPE ("The \"setMaxListeners\" argument must be of
 * type number. Received ..."), numbers run the range gate below.
 * Borrowed dyn; +1 receiver either way (the pending check unwinds). */
ScrEmitter *scr_emitter_set_max_chk(ScrEmitter *em, const ScrDyn *n) {
  if (n->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail("setMaxListeners", "of type number", n);
    return scr_emitter_retain(em);
  }
  return scr_emitter_set_max(em, n->v.num);
}

ScrEmitter *scr_emitter_set_max(ScrEmitter *em, double n) {
  if (!(n >= 0)) { /* negatives and NaN — Node's validateNumber */
    char num[32];
    size_t nlen = scr_f64_to_str(n, num);
    char msg[128];
    int len = snprintf(msg, sizeof msg,
                       "The value of \"setMaxListeners\" is out of range. It must be >= 0. Received %.*s",
                       (int)nlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return scr_emitter_retain(em); /* the pending check unwinds */
  }
  scr_ee_reg_ensure(em)->max = n;
  em->reg->max_set = true;
  return scr_emitter_retain(em);
}

double scr_emitter_get_max(ScrEmitter *em) {
  if (em->reg && em->reg->max_set) return em->reg->max;
  return scr_emitter_default_max;
}

/* The checked-dynamic defaultMaxListeners ladder — `name` picks the
 * message's slot ("setMaxListeners" for the static call,
 * "defaultMaxListeners" for the module-property assignment, Node's own
 * split). Borrowed. */
void scr_emitter_set_default_max_chk(const ScrDyn *n, const ScrStr *name) {
  if (n->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail(name->data, "of type number", n);
    return;
  }
  if (!(n->v.num >= 0)) {
    char num[32];
    size_t nlen = scr_f64_to_str(n->v.num, num);
    char msg[128];
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be >= 0. Received %.*s",
                       name->data, (int)nlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return;
  }
  scr_emitter_set_default_max(n->v.num);
}

void scr_emitter_set_default_max(double n) {
  if (!(n >= 0)) { /* negatives and NaN — Node's validateNumber(n, "setMaxListeners", 0) */
    char num[32];
    size_t nlen = scr_f64_to_str(n, num);
    char msg[128];
    int len = snprintf(msg, sizeof msg,
                       "The value of \"setMaxListeners\" is out of range. It must be >= 0. Received %.*s",
                       (int)nlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return; /* the pending check unwinds */
  }
  scr_emitter_default_max = n;
}
double scr_emitter_get_default_max(void) { return scr_emitter_default_max; }

/* ── the dyn view of the EventEmitter API ─────────────────────────────────
 * A class instance that is an emitter (a subclass of the runtime EventEmitter, or a class
 * grafted by applyMixin(Y, EventEmitter)) reaches an untyped slot as an OBJINST box. Its
 * EventEmitter.prototype members are not rows of the class's member table, so the dyn core
 * asks THIS table (scr_dyn_ee_ops, installed from the emitted main): a READ of one answers
 * the interned function below (one immortal closure per member, so `a.emit === b.emit`
 * and `typeof a.emit` are Node's), a CALL runs it on the instance's emitter with the dyn
 * arguments. Reads and calls are one body: the read's function calls the same dispatch
 * with the ambient receiver (`fn.apply(target, args)`, `fn.call(target, ...)`).
 *
 * The registration family (on/once/prepend*) with a function argument is NOT answered here:
 * a listener's adapter (how a static `emit(name, tuple)` reaches it) is built by the
 * compiler from the event's tuple, so the family is lowered at the call site, where the
 * tuple is known. Reached through a value (`const f = x.on; f.call(x, ...)`) it throws a
 * named, catchable error rather than register a listener no static emit could call. */
enum { EEOP_ON, EEOP_ONCE, EEOP_OFF, EEOP_EMIT, EEOP_ADD, EEOP_REMOVE, EEOP_REMOVE_ALL, EEOP_PREPEND,
       EEOP_PREPEND_ONCE, EEOP_COUNT, EEOP_LISTENERS, EEOP_RAW, EEOP_NAMES, EEOP_SET_MAX, EEOP_GET_MAX, EEOP_N };
static const char *const EE_OP_NAMES[EEOP_N] = {
  "on", "once", "off", "emit", "addListener", "removeListener", "removeAllListeners", "prependListener",
  "prependOnceListener", "listenerCount", "listeners", "rawListeners", "eventNames", "setMaxListeners",
  "getMaxListeners",
};

static int ee_op_of(const char *name, size_t n) {
  for (int i = 0; i < EEOP_N; i++) {
    if (strlen(EE_OP_NAMES[i]) == n && memcmp(EE_OP_NAMES[i], name, n) == 0) return i;
  }
  return -1;
}

static bool ee_knows(const char *name, size_t n) { return ee_op_of(name, n) >= 0; }

static ScrDyn *ee_func_box(const ScrEeEntry *e) {
  const ScrDyn *p = e->has_idproto ? &e->idproto : &e->fnproto;
  ScrDyn *box = scr_dyn_new_func_src(scr_closure_retain(p->v.fn.clo), p->v.fn.thunk,
                                     p->v.fn.arity, scr_dyn_fn_sig(p),
                                     scr_dyn_fn_name(p), scr_dyn_fn_src(p));
  return box;
}

static ScrDyn *ee_entry_view_box(ScrEeEntry *e, ScrDyn *recv, ScrStr *name);

static ScrDyn *ee_call(ScrDyn *recv, ScrEmitter *em, const char *name, size_t n, ScrDyn *const *args, size_t argc,
                       const char *what) {
  int op = ee_op_of(name, n);
  const ScrDyn *u = scr_dyn_undefined();
  const ScrDyn *a0 = argc > 0 ? args[0] : u;
  const ScrDyn *a1 = argc > 1 ? args[1] : u;
  switch (op) {
    case EEOP_EMIT: {
      /* the listeners run with the emitter as `this` */
      ScrDyn *const empty[1] = {(ScrDyn *)u};
      bool had = scr_emitter_emit_dyn_list(em, recv, argc ? args : empty, argc ? argc : 1);
      if (scr_exc_pending()) return NULL;
      return scr_dyn_new_bool(had);
    }
    case EEOP_ON: case EEOP_ONCE: case EEOP_ADD: case EEOP_PREPEND: case EEOP_PREPEND_ONCE: {
      /* The registration reached without a call site (the member read as a value, `x.on.call(x, ...)`, a
       * bound `on`, `x[k](...)`): a listener's adapter is built from the event's tuple, which only the
       * compiler knows, so the instance's class table carries one `%eeReg(mode, name, fn)` row (the
       * program's by-name registration, see synthEeRegFns) and the registration runs through it. */
      scr_emitter_check_listener(a1);
      if (scr_exc_pending()) return NULL;
      const ScrDynClassMember *row = scr_dyn_objinst_member(recv, "%eeReg", 6);
      if (row == NULL || row->call == NULL) {
        ScrJsonBuf b;
        scr_jb_init(&b);
        scr_jb_puts(&b, "'EventEmitter.prototype.");
        scr_jb_puts(&b, EE_OP_NAMES[op]);
        scr_jb_puts(&b, "' on this emitter has no registration table");
        scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
        return NULL;
      }
      const char *mode = op == EEOP_ONCE ? "once" : op == EEOP_PREPEND ? "prependListener"
                         : op == EEOP_PREPEND_ONCE ? "prependOnceListener" : "on";
      ScrStr *ms = scr_str_new(mode, strlen(mode));
      ScrDyn *md = scr_dyn_new_str(ms); /* retains */
      scr_str_release(ms);
      ScrDyn *av[3] = {md, (ScrDyn *)a0, (ScrDyn *)a1};
      ScrDyn *r = row->call(recv->v.inst.o, av, 3, what);
      scr_dyn_release(md);
      if (r == NULL) return NULL;
      scr_dyn_release(r);
      return scr_dyn_retain(recv);
    }
    case EEOP_OFF: case EEOP_REMOVE: {
      scr_emitter_check_listener(a1);
      if (scr_exc_pending()) return NULL;
      ScrStr *nm = scr_dyn_string_coerce_js(a0);
      if (nm == NULL) return NULL;
      ScrEmitter *r = scr_emitter_off_dyn(em, nm, a1);
      scr_str_release(nm);
      scr_emitter_release(r);
      if (scr_exc_pending()) return NULL;
      return scr_dyn_retain(recv);
    }
    case EEOP_REMOVE_ALL: {
      ScrStr *nm = argc > 0 ? scr_dyn_string_coerce_js(a0) : scr_str_new("", 0);
      if (nm == NULL) return NULL;
      ScrEmitter *r = scr_emitter_remove_all(em, nm, argc == 0);
      scr_str_release(nm);
      scr_emitter_release(r);
      if (scr_exc_pending()) return NULL;
      return scr_dyn_retain(recv);
    }
    case EEOP_COUNT: {
      ScrStr *nm = scr_dyn_string_coerce_js(a0);
      if (nm == NULL) return NULL;
      double c;
      if (argc > 1 && a1->kind != SCR_DYN_UNDEF) {
        c = a1->kind == SCR_DYN_FUNC ? scr_emitter_listener_count_fn(em, nm, a1->v.fn.clo) : 0;
      } else {
        c = scr_emitter_listener_count(em, nm);
      }
      scr_str_release(nm);
      return scr_dyn_new_num(c);
    }
    case EEOP_LISTENERS: case EEOP_RAW: {
      ScrStr *nm = scr_dyn_string_coerce_js(a0);
      if (nm == NULL) return NULL;
      ScrDyn *out = scr_dyn_new_arr();
      ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, nm->data, nm->len) : NULL;
      if (b) {
        for (size_t i = 0; i < b->n; i++) {
          if (!b->ls[i]->has_fnproto) scr_trap("scriptc: listeners() reached a typed listener the module did not box\n");
          /* listeners() unwraps a once listener; rawListeners() answers its onceWrapper */
          scr_dyn_arr_push(out, op == EEOP_RAW ? ee_entry_view_box(b->ls[i], recv, b->name) : ee_func_box(b->ls[i]));
        }
      }
      scr_str_release(nm);
      return out;
    }
    case EEOP_NAMES: {
      ScrDyn *out = scr_dyn_new_arr();
      if (em->reg) {
        size_t nn = 0;
        ScrStr **names = ee_names_ordered(em->reg, &nn);
        for (size_t i = 0; i < nn; i++) scr_dyn_arr_push(out, scr_dyn_new_str(names[i]));
        free(names);
      }
      return out;
    }
    case EEOP_SET_MAX: {
      ScrEmitter *r = scr_emitter_set_max_chk(em, a0);
      scr_emitter_release(r);
      if (scr_exc_pending()) return NULL;
      return scr_dyn_retain(recv);
    }
    case EEOP_GET_MAX:
      return scr_dyn_new_num(scr_emitter_get_max(em));
    default:
      (void)what;
      return NULL;
  }
}

/* One immortal closure per member: the value a read answers. */
typedef struct ScrEeFn { ScrClosure clo; int op; } ScrEeFn;
static ScrEeFn scr_ee_fns[EEOP_N];
static bool scr_ee_fns_ready = false;

static ScrDyn *ee_method_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  const ScrEeFn *w = (const ScrEeFn *)clo;
  ScrDyn *recv = scr_dyn_this_get(); /* +1 */
  ScrEmitter *em = scr_dyn_objinst_emitter(recv);
  ScrDyn *r = NULL;
  if (em != NULL) {
    r = ee_call(recv, em, EE_OP_NAMES[w->op], strlen(EE_OP_NAMES[w->op]), args, argc, "method");
  } else {
    scr_throw_error_named(scr_str_new("TypeError", 9),
                          scr_str_new("Cannot read properties of undefined (reading '_events')", 56));
  }
  scr_dyn_release(recv);
  return r;
}

static ScrDyn *ee_value(const char *name, size_t n) {
  int op = ee_op_of(name, n);
  if (op < 0) return NULL;
  /* In Node EventEmitter.prototype.on IS addListener and off IS removeListener (one function each). */
  if (op == EEOP_ON) op = EEOP_ADD;
  if (op == EEOP_OFF) op = EEOP_REMOVE;
  if (!scr_ee_fns_ready) {
    for (int i = 0; i < EEOP_N; i++) {
      scr_ee_fns[i].clo.rc = SIZE_MAX; /* immortal, like an interned top-level function */
      scr_ee_fns[i].clo.fn = (void *)ee_method_thunk;
      scr_ee_fns[i].op = i;
    }
    scr_ee_fns_ready = true;
  }
  return scr_dyn_new_func(&scr_ee_fns[op].clo, ee_method_thunk, 0, "()", EE_OP_NAMES[op]);
}

static bool ee_is_state(const char *name, size_t n);
static ScrDyn *ee_state_read(ScrDyn *recv, ScrEmitter *em, const char *name, size_t n);
static bool ee_state_write(ScrEmitter *em, const char *name, size_t n, const ScrDyn *value);
static const ScrDynEeOps scr_ee_dyn_ops = {ee_knows, ee_value, ee_call, ee_is_state, ee_state_read, ee_state_write};

/* Installed by the emitted main of a program with both an emitter and a boxable class. */
void scr_dyn_ee_install(void) { scr_dyn_ee_ops = &scr_ee_dyn_ops; }

/* ── the emitter's own state cells through the dyn read ───────────────────
 * `_eventsCount`, `_maxListeners` and `_events` are own enumerable properties of every Node emitter (the
 * first three keys of its for-in). The registry is their ONE source of truth, so a dyn read answers from it
 * and nothing is stored twice: the count is the number of names with a listener, `_maxListeners` is
 * undefined until setMaxListeners ran, and `_events` is a null-prototype object over the live table.
 *
 * THE VIEW. One object per emitter, kept in the registry (reg->view): the table's names in registration
 * order, each answering its listener (one listener: the function itself, or for a ONCE listener Node's
 * onceWrapper, a distinct function whose `listener` is the original) or an array of them (two or more).
 * It is rebuilt IN PLACE when the table changed since the last read, and replaced by a fresh object exactly
 * when Node replaces `_events` (the table emptying; removeAllListeners()), so identity and liveness through a
 * held reference are Node's. The view and its arrays are marked as copies (static_copy): a write through
 * them would land on the copy, never on the table Node's write changes, so the mutators refuse loudly
 * instead of dropping it. */
static void scr_ee_mark_fired(ScrEeEntry *e) {
  e->fired = true;
  if (e->wfired) scr_box_set_bool(e->wfired, true);
}

static void scr_ee_emit_done(ScrEmitter *em, ScrStr *name, uint32_t epoch) {
  ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, name->data, name->len) : NULL;
  if (b != NULL && b->epoch == epoch && b->emitting > 0) b->emitting--;
}

/* Node's onceWrapper: `if (!this.fired) { target.removeListener(type, wrapFn); this.fired = true;
 * return listener.apply(target, args) }`. Captures: [0] the emitter's dyn box (the listener's `this`), [1] the
 * listener's function box, [2] the event name, [3] the shared fired flag. */
static ScrDyn *ee_once_wrap_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrBox *fb = (ScrBox *)clo->caps[3];
  if (scr_box_get_bool(fb)) return scr_dyn_retain(scr_dyn_undefined());
  ScrDyn *recv = (ScrDyn *)scr_box_get_ref((ScrBox *)clo->caps[0]);
  ScrDyn *fn = (ScrDyn *)scr_box_get_ref((ScrBox *)clo->caps[1]);
  ScrDyn *nm = (ScrDyn *)scr_box_get_ref((ScrBox *)clo->caps[2]);
  ScrEmitter *em = scr_dyn_objinst_emitter(recv);
  ScrDyn *r = NULL;
  if (em != NULL) {
    ScrEeBucket *b = em->reg ? scr_ee_bucket_find(em->reg, nm->v.str->data, nm->v.str->len) : NULL;
    if (b != NULL) {
      for (size_t i = 0; i < b->n; i++) {
        if (b->ls[i]->wrap == clo) scr_ee_mark_fired(b->ls[i]); /* an emit snapshot still holding it must not run it again */
      }
    }
    ScrEmitter *rm = scr_emitter_off(em, nm->v.str, clo);
    scr_emitter_release(rm);
    scr_box_set_bool(fb, true);
    if (!scr_exc_pending()) {
      scr_dyn_this_push_dyn(recv);
      r = scr_dyn_call(fn, (ScrDyn *const *)args, argc, "listener");
      scr_dyn_this_pop();
    }
  }
  scr_dyn_release(recv);
  scr_dyn_release(fn);
  scr_dyn_release(nm);
  return r;
}

static ScrBox *ee_dyn_cap(ScrDyn *d /*moves*/) {
  ScrBox *bx = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v);
  scr_box_set_ref(bx, d);
  return bx;
}

/* The function a `_events` read (or rawListeners) shows for one entry: the listener itself, or for a ONCE
 * listener its onceWrapper (created once per entry, so its identity is stable). `recv` is the emitter's dyn
 * box. */
static ScrDyn *ee_entry_view_box(ScrEeEntry *e, ScrDyn *recv, ScrStr *name) {
  if (!e->has_fnproto) scr_trap("scriptc: _events reached a typed listener the module did not box\n");
  if (!e->once) return ee_func_box(e);
  if (e->wrap == NULL) {
    e->wfired = scr_box_new(SCR_BOX_BOOL);
    scr_box_set_bool(e->wfired, false);
    e->wrap = scr_closure_new((void *)ee_once_wrap_thunk, 4);
    e->wrap->caps[0] = ee_dyn_cap(scr_dyn_retain(recv));
    e->wrap->caps[1] = ee_dyn_cap(ee_func_box(e));
    e->wrap->caps[2] = ee_dyn_cap(scr_dyn_new_str(name));
    e->wrap->caps[3] = scr_box_retain(e->wfired);
  }
  ScrDyn *f = scr_dyn_new_func(scr_closure_retain(e->wrap), ee_once_wrap_thunk, 0, "()", "bound onceWrapper");
  ScrDyn *orig = ee_func_box(e);
  ScrStr *k = scr_str_new("listener", 8);
  scr_dyn_key_set(f, k, orig); /* the property rides the closure, so every box of the wrapper shows it */
  scr_dyn_release(orig);       /* key_set borrows: the closure's property table holds its own reference */
  scr_str_release(k);
  return f;
}

/* The listener array of one bucket as the view shows it: the listeners, Node's `warned` property once the leak
 * warning fired for this array, and the enumerable events.emitting symbol (the live in-flight emit count).
 * `into` (nullable) is the previous array of the SAME epoch, refilled in place so a held reference stays the
 * live array; otherwise a fresh array. +1. */
static ScrDyn *ee_bucket_array(ScrEeBucket *b, ScrDyn *recv, ScrDyn *into) {
  ScrDyn *arr = into != NULL ? scr_dyn_retain(into) : scr_dyn_new_arr();
  if (into != NULL) {
    arr->static_copy = false;
    while (arr->v.arr.len > 0) {
      ScrDyn *last = arr->v.arr.items[arr->v.arr.len - 1];
      arr->v.arr.len--;
      scr_dyn_release(last);
    }
  }
  for (size_t i = 0; i < b->n; i++) scr_dyn_arr_push(arr, ee_entry_view_box(b->ls[i], recv, b->name));
  if (b->warned) {
    ScrStr *wk = scr_str_new("warned", 6);
    ScrDyn *t = scr_dyn_new_bool(true);
    scr_dyn_key_set(arr, wk, t);
    scr_dyn_release(t);
    scr_str_release(wk);
  }
  scr_dyn_obj_set_slot(arr, "%eeList", 7, scr_dyn_new_num((double)b->emitting)); /* Node's enumerable events.emitting symbol */
  arr->static_copy = true;
  return arr;
}

ScrDyn *scr_emitter_events_view(ScrDyn *recv, ScrEmitter *em) {
  ScrEeReg *reg = scr_ee_reg_ensure(em);
  if (reg->view != NULL && reg->view_gen != reg->gen) {
    scr_dyn_release(reg->view); /* Node replaced the object: a held reference keeps the old table */
    reg->view = NULL;
    for (ScrEeBucket *b = reg->head; b; b = b->next) b->view_epoch = 0;
  }
  /* The emit counter lives in the array itself, so a read while an emit is in flight must refresh it. */
  bool any_emitting = false;
  for (ScrEeBucket *b = reg->head; b && !any_emitting; b = b->next) any_emitting = b->n >= 2 && b->emitting > 0;
  if (reg->view != NULL && reg->view_ver == reg->ver && !any_emitting) {
    bool stale = false; /* an array that was emitting at the last build and no longer is */
    for (ScrEeBucket *b = reg->head; b && !stale; b = b->next) {
      if (b->n < 2) continue;
      const ScrDyn *a = scr_dyn_obj_get(reg->view, b->name->data, b->name->len);
      const ScrDyn *c = a != NULL && a->kind == SCR_DYN_ARR ? scr_dyn_obj_slot_get(a, "%eeList", 7) : NULL;
      stale = c == NULL || c->v.num != (double)b->emitting;
    }
    if (!stale) return scr_dyn_retain(reg->view);
  }
  ScrDyn *v = reg->view;
  ScrDyn *prev = NULL; /* the previous object's entries, so unchanged arrays keep their identity */
  if (v == NULL) {
    v = scr_dyn_new_obj_null_proto();
  } else {
    v->static_copy = false;
    prev = scr_dyn_new_obj_null_proto();
    for (size_t i = 0; i < v->v.obj.len; i++) {
      ScrDyn *val = v->v.obj.entries[i].value;
      if (val != NULL && val->kind == SCR_DYN_ARR) scr_dyn_obj_set(prev, v->v.obj.entries[i].key, v->v.obj.entries[i].key_len, scr_dyn_retain(val));
    }
    for (size_t i = v->v.obj.len; i-- > 0;) {
      ScrStr *k = scr_str_new(v->v.obj.entries[i].key, v->v.obj.entries[i].key_len);
      scr_dyn_key_delete(v, k);
      scr_str_release(k);
    }
  }
  for (ScrEeBucket *b = reg->head; b; b = b->next) {
    if (b->n == 0) continue;
    ScrDyn *val;
    if (b->n == 1) {
      val = ee_entry_view_box(b->ls[0], recv, b->name);
      b->view_epoch = 0;
    } else {
      ScrDyn *old = b->view_epoch == b->epoch && prev != NULL ? scr_dyn_obj_get(prev, b->name->data, b->name->len) : NULL;
      val = ee_bucket_array(b, recv, old);
      b->view_epoch = b->epoch;
    }
    scr_dyn_obj_set(v, b->name->data, b->name->len, val);
  }
  if (prev != NULL) scr_dyn_release(prev);
  v->static_copy = true;
  reg->view = v;
  reg->view_ver = reg->ver;
  reg->view_gen = reg->gen;
  return scr_dyn_retain(v);
}

static bool ee_is_state(const char *name, size_t n) {
  return (n == 7 && memcmp(name, "_events", 7) == 0) || (n == 12 && memcmp(name, "_eventsCount", 12) == 0) ||
         (n == 13 && memcmp(name, "_maxListeners", 13) == 0);
}

/* A stream's registry is in shape mode (pre-created keys holding undefined): its cells are not these. */
static bool ee_shape(ScrEmitter *em) { return em->reg != NULL && em->reg->shape; }

/* The read of one of the three cells (+1), or NULL when `name` is not one (or the emitter is a stream: the
 * caller keeps its fence). */
static ScrDyn *ee_state_read(ScrDyn *recv, ScrEmitter *em, const char *name, size_t n) {
  if (ee_shape(em)) return NULL;
  if (n == 7 && memcmp(name, "_events", 7) == 0) return scr_emitter_events_view(recv, em);
  if (n == 12 && memcmp(name, "_eventsCount", 12) == 0) return scr_dyn_new_num(em->reg != NULL ? em->reg->ecount : 0);
  if (n == 13 && memcmp(name, "_maxListeners", 13) == 0) {
    if (em->reg != NULL && em->reg->max_set) return scr_dyn_new_num(em->reg->max);
    return scr_dyn_retain(scr_dyn_undefined());
  }
  return NULL;
}

/* `x._eventsCount = n` / `x._maxListeners = n|undefined` with a number (or undefined for the latter):
 * the registry stores it as events.js's own field would. true = taken. Everything else is not representable
 * (the caller refuses by name). */
static bool ee_state_write(ScrEmitter *em, const char *name, size_t n, const ScrDyn *value) {
  if (ee_shape(em)) return false;
  if (n == 12 && memcmp(name, "_eventsCount", 12) == 0 && value->kind == SCR_DYN_NUM) {
    scr_ee_reg_ensure(em)->ecount = value->v.num;
    em->reg->ver++;
    return true;
  }
  /* `x._events = {}` / `Object.create(null)` (the emitter-inheritance idiom): Node's table is replaced by that
   * object, so the listeners leave silently (no removeListener events) and the program's object becomes the view
   * it reads, rebuilt in place from then on. A non-empty object holds listener functions the registry cannot
   * adopt, and is not stored. */
  if (n == 7 && memcmp(name, "_events", 7) == 0 && value->kind == SCR_DYN_OBJ) {
    ScrEeReg *reg = scr_ee_reg_ensure(em);
    if (value == reg->view) return true; /* `this._events = this._events` */
    if (value->v.obj.len != 0 || value->static_copy) return false;
    ScrDyn *obj = (ScrDyn *)value;
    while (reg->head) {
      ScrEeBucket *hb = reg->head;
      for (size_t i = 0; i < hb->n; i++) scr_ee_entry_unref(hb->ls[i]);
      hb->n = 0;
      hb->counted = false; /* Node does not touch _eventsCount here */
      scr_ee_bucket_drop(reg, hb);
    }
    if (reg->view != NULL) scr_dyn_release(reg->view);
    reg->view = scr_dyn_retain(obj);
    reg->gen++;
    reg->view_gen = reg->gen;
    reg->ver++;
    reg->view_ver = reg->ver;
    reg->shape = false;
    return true;
  }
  if (n == 13 && memcmp(name, "_maxListeners", 13) == 0) {
    if (value->kind == SCR_DYN_NUM) {
      scr_ee_reg_ensure(em)->max = value->v.num;
      em->reg->max_set = true;
      return true;
    }
    if (value->kind == SCR_DYN_UNDEF) {
      scr_ee_reg_ensure(em)->max_set = false;
      return true;
    }
  }
  return false;
}

/* The ScrEmitter (+1) of a dyn-boxed emitter instance, for the compiler's emitterApi arm. */
ScrEmitter *scr_dyn_emitter_of(const ScrDyn *d) {
  ScrEmitter *em = scr_dyn_objinst_emitter(d);
  return em != NULL ? scr_emitter_retain(em) : NULL;
}
