/* scr_promise_static.c -- the Promise constructor VALUE's statics: resolve, reject, all, allSettled, race, any, withResolvers and try.
 *
 * Read off the constructor value (scr_dyn_fn_get asks scr_promise_static_hook), so a program that holds `Promise` in a variable, a
 * record or a getter calls them the way Node does. A LINK GATE (moduleUsesPromiseStatics: the dyn.promiseCtor libCall, or a
 * getPrototypeOf that can hand the constructor back): the dyn promise unit does not carry this code. */

#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>

/* ── the Promise constructor's STATICS as native function values ──────────────
 * `Promise.resolve/reject/all/allSettled/race/any/withResolvers/try` read off the constructor VALUE (scr_dyn_fn_get asks the
 * hook below), so a program that holds `Promise` in a variable, a record or a getter calls them the way Node does. Each one
 * answers a promise built from the same machinery `new Promise` and `.then` run on: the element of a combinator is
 * PromiseResolve(x).then(onFulfilled, onRejected), settling the result from inside those reactions, so the tick order is the
 * spec's. `this` is not consulted (a subclass receiver is not modelled: the constructor value has no subclasses here). */
enum { SCR_PS_ALL, SCR_PS_SETTLED, SCR_PS_RACE, SCR_PS_ANY };

typedef struct ScrComb {
  size_t rc;
  int kind;
  ScrPromise *out;   /* the result promise; retained (native constructor) */
  ScrDyn *cap_promise, *cap_resolve, *cap_reject; /* the capability of a non-native receiver C (NewPromiseCapability); owned, else NULL */
  ScrDyn *vals;      /* values / settled records / errors, one slot per element */
  size_t remaining;  /* elements still to settle (all, allSettled, any) */
} ScrComb;

typedef struct ScrCombEl {
  size_t rc;
  ScrComb *c;        /* retained */
  size_t idx;
  bool called;       /* the element's alreadyCalled flag: its first reaction wins */
} ScrCombEl;

static void scr_comb_release(ScrComb *c) {
  if (--c->rc != 0) return;
  if (c->out != NULL) scr_promise_release(c->out);
  scr_dyn_release(c->cap_promise);
  scr_dyn_release(c->cap_resolve);
  scr_dyn_release(c->cap_reject);
  scr_dyn_release(c->vals);
  free(c);
}

static void *scr_comb_el_retain_v(void *e) {
  ((ScrCombEl *)e)->rc++;
  return e;
}

static void scr_comb_el_release_v(void *e) {
  ScrCombEl *el = (ScrCombEl *)e;
  if (--el->rc != 0) return;
  scr_comb_release(el->c);
  free(el);
}

/* ── NewPromiseCapability(C) for a receiver that is not the native constructor ───────────────────────────────────────────
 * `Promise.resolve.call(Fake, x)` and its siblings construct C through the dyn construct path with a capability executor, take the
 * resolve and reject functions C hands it and answer the constructed promise, exactly as the spec's statics do for a subclass. */
typedef struct ScrCapBox {
  size_t rc;
  ScrDyn *res, *rej; /* what the executor was given; owned */
} ScrCapBox;

static void *scr_capbox_retain_v(void *p) {
  ((ScrCapBox *)p)->rc++;
  return p;
}
static void scr_capbox_release_v(void *p) {
  ScrCapBox *b = (ScrCapBox *)p;
  if (--b->rc != 0) return;
  scr_dyn_release(b->res);
  scr_dyn_release(b->rej);
  free(b);
}

static ScrDyn *scr_cap_executor_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrCapBox *b = (ScrCapBox *)scr_box_get_ref(clo->caps[0]); /* +1 */
  if ((b->res != NULL && b->res->kind != SCR_DYN_UNDEF) || (b->rej != NULL && b->rej->kind != SCR_DYN_UNDEF)) {
    static const char m[] = "Promise executor has already been invoked with non-undefined arguments";
    scr_throw_error_msg(SCR_ERR_TYPE, m, sizeof m - 1);
    scr_capbox_release_v(b);
    return NULL;
  }
  scr_dyn_release(b->res);
  scr_dyn_release(b->rej);
  b->res = scr_dyn_retain(argc > 0 ? args[0] : scr_dyn_undefined());
  b->rej = scr_dyn_retain(argc > 1 ? args[1] : scr_dyn_undefined());
  scr_capbox_release_v(b);
  return scr_dyn_retain(scr_dyn_undefined());
}

typedef struct ScrCap {
  ScrDyn *promise, *resolve, *reject; /* owned */
} ScrCap;

static void scr_cap_release(ScrCap *cap) {
  scr_dyn_release(cap->promise);
  scr_dyn_release(cap->resolve);
  scr_dyn_release(cap->reject);
  cap->promise = cap->resolve = cap->reject = NULL;
}

/* V8's rendering of a non-constructor in "X is not a constructor". */
static ScrStr *scr_cap_render(const ScrDyn *c) {
  if (c->kind == SCR_DYN_FUNC) return scr_fn_to_string(c);
  if (c->kind == SCR_DYN_OBJ || c->kind == SCR_DYN_OBJINST) return scr_str_new("#<Object>", 9);
  if (c->kind == SCR_DYN_ARR) return scr_str_new("[object Array]", 14);
  return scr_dyn_string_coerce(c);
}

static void scr_ps_throw_type(const char *m) { scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m)); }

/* false with the exception pending when C is not a constructor, its construction throws, or it never hands the executor two
 * callable functions. */
static bool scr_cap_new(const ScrDyn *C, ScrCap *cap) {
  ScrCapBox *b = calloc(1, sizeof *b);
  if (!b) abort();
  b->rc = 1;
  b->res = scr_dyn_retain(scr_dyn_undefined());
  b->rej = scr_dyn_retain(scr_dyn_undefined());
  ScrClosure *clo = scr_closure_new((void *)scr_cap_executor_thunk, 1);
  ScrBox *bx = scr_box_new_obj(scr_capbox_retain_v, scr_capbox_release_v, NULL);
  scr_box_set_ref(bx, scr_capbox_retain_v(b));
  clo->caps[0] = bx;
  ScrDyn *exec = scr_dyn_new_func(clo, scr_cap_executor_thunk, 2, "(resolve, reject)", "");
  ScrDyn *pack = scr_dyn_new_arr();
  scr_dyn_arr_push(pack, exec);
  ScrStr *what = scr_cap_render(C);
  ScrDyn *made = scr_dyn_construct(C, pack, what);
  scr_str_release(what);
  scr_dyn_release(pack);
  bool ok = made != NULL;
  if (ok && !(b->res->kind == SCR_DYN_FUNC && b->rej->kind == SCR_DYN_FUNC)) {
    scr_ps_throw_type("Promise resolve or reject function is not callable");
    scr_dyn_release(made);
    ok = false;
  }
  if (ok) {
    cap->promise = made;
    cap->resolve = scr_dyn_retain(b->res);
    cap->reject = scr_dyn_retain(b->rej);
  }
  scr_capbox_release_v(b);
  return ok;
}

/* Call f(x); a throw is consumed and false answered, the exception value left in *exc (+1). */
static bool scr_cap_call1(ScrDyn *f, ScrDyn *x, ScrDyn **exc) {
  ScrDyn *a[1] = {x};
  ScrDyn *r = scr_dyn_call(f, a, 1, "Promise capability function");
  if (r != NULL) {
    scr_dyn_release(r);
    return true;
  }
  ScrCaught *c = scr_exc_take();
  *exc = scr_caught_to_dyn(c);
  scr_caught_release(c);
  return false;
}

/* IfAbruptRejectPromise: settle the capability with the pending exception, answering the capability's promise. */
static ScrDyn *scr_cap_reject_pending(ScrCap *cap) {
  ScrCaught *c = scr_exc_take();
  ScrDyn *e = scr_caught_to_dyn(c);
  scr_caught_release(c);
  ScrDyn *ign = NULL;
  scr_cap_call1(cap->reject, e, &ign);
  scr_dyn_release(e);
  scr_dyn_release(ign);
  ScrDyn *p = scr_dyn_retain(cap->promise);
  scr_cap_release(cap);
  return p;
}

/* Reject `p` with the dyn value x (borrowed) unless it already settled. */
static void scr_ps_reject_with(ScrPromise *p, const ScrDyn *x) {
  if (!scr_promise_is_pending(p)) return;
  scr_throw_dyn(scr_dyn_retain((ScrDyn *)x));
  scr_promise_reject_pending(p);
}

static void scr_ps_store(ScrComb *c, size_t idx, ScrDyn *v /* owned */) {
  ScrDyn **items = c->vals->v.arr.items;
  scr_dyn_release(items[idx]);
  items[idx] = v;
}

static void scr_ps_record(ScrComb *c, size_t idx, bool rejected, const ScrDyn *x) {
  ScrDyn *o = scr_dyn_new_obj();
  ScrStr *st = scr_str_new(rejected ? "rejected" : "fulfilled", rejected ? 8 : 9);
  scr_dyn_obj_set(o, "status", 6, scr_dyn_new_str(st));
  scr_str_release(st);
  scr_dyn_obj_set(o, rejected ? "reason" : "value", rejected ? 6 : 5, scr_dyn_retain((ScrDyn *)x));
  scr_ps_store(c, idx, o);
}

/* Settle the combinator's result: through the native promise, or through the capability a non-native receiver supplied. */
static void scr_comb_resolve(ScrComb *c, ScrDyn *v /* owned */) {
  if (c->cap_resolve == NULL) {
    scr_dyn_resolve_into_pub(c->out, v);
    return;
  }
  ScrDyn *exc = NULL;
  if (!scr_cap_call1(c->cap_resolve, v, &exc)) {
    ScrDyn *ign = NULL;
    scr_cap_call1(c->cap_reject, exc, &ign);
    scr_dyn_release(ign);
  }
  scr_dyn_release(exc);
  scr_dyn_release(v);
}

static void scr_comb_reject(ScrComb *c, const ScrDyn *x) {
  if (c->cap_reject == NULL) {
    scr_ps_reject_with(c->out, x);
    return;
  }
  ScrDyn *exc = NULL;
  scr_cap_call1(c->cap_reject, (ScrDyn *)x, &exc);
  scr_dyn_release(exc);
}

static void scr_ps_reject_aggregate(ScrComb *c) {
  static const char msg[] = "All promises were rejected";
  ScrStr *m = scr_str_new(msg, sizeof msg - 1);
  ScrError *e = scr_error_new(SCR_ERR_AGGREGATE, m);
  scr_str_release(m);
  scr_error_set_errors(e, scr_dyn_retain(c->vals));
  ScrDyn *ed = scr_dyn_from_error(e);
  scr_error_release(e);
  if (c->cap_reject != NULL) {
    scr_comb_reject(c, ed);
    scr_dyn_release(ed);
    return;
  }
  scr_throw_dyn(ed);
  if (scr_promise_is_pending(c->out)) scr_promise_reject_pending(c->out);
  else scr_exc_clear();
}

static void scr_comb_react(ScrCombEl *el, bool rejected, const ScrDyn *x) {
  if (el->called) return;
  el->called = true;
  ScrComb *c = el->c;
  switch (c->kind) {
    case SCR_PS_ALL:
      if (rejected) {
        scr_comb_reject(c, x);
        return;
      }
      scr_ps_store(c, el->idx, scr_dyn_retain((ScrDyn *)x));
      break;
    case SCR_PS_SETTLED:
      scr_ps_record(c, el->idx, rejected, x);
      break;
    case SCR_PS_RACE:
      if (rejected) scr_comb_reject(c, x);
      else scr_comb_resolve(c, scr_dyn_retain((ScrDyn *)x));
      return;
    default: /* SCR_PS_ANY */
      if (!rejected) {
        scr_comb_resolve(c, scr_dyn_retain((ScrDyn *)x));
        return;
      }
      scr_ps_store(c, el->idx, scr_dyn_retain((ScrDyn *)x));
      break;
  }
  if (--c->remaining != 0) return;
  if (c->kind == SCR_PS_ANY) {
    scr_ps_reject_aggregate(c);
    return;
  }
  scr_comb_resolve(c, scr_dyn_retain(c->vals));
}

static ScrDyn *scr_comb_on_fulfilled(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrCombEl *el = (ScrCombEl *)scr_box_get_ref(clo->caps[0]); /* +1 */
  scr_comb_react(el, false, argc ? args[0] : scr_dyn_undefined());
  scr_comb_el_release_v(el);
  return scr_dyn_retain(scr_dyn_undefined());
}

static ScrDyn *scr_comb_on_rejected(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrCombEl *el = (ScrCombEl *)scr_box_get_ref(clo->caps[0]); /* +1 */
  scr_comb_react(el, true, argc ? args[0] : scr_dyn_undefined());
  scr_comb_el_release_v(el);
  return scr_dyn_retain(scr_dyn_undefined());
}

static ScrDyn *scr_comb_make_fn(ScrCombEl *el, ScrDynThunk thunk, const char *name) {
  ScrClosure *c = scr_closure_new((void *)thunk, 1);
  ScrBox *b = scr_box_new_obj(scr_comb_el_retain_v, scr_comb_el_release_v, NULL);
  scr_box_set_ref(b, scr_comb_el_retain_v(el));
  c->caps[0] = b;
  return scr_dyn_new_func(c, thunk, 1, "(value)", name);
}

/* The receiver every static runs on (ES: the constructor `this`). 0: a primitive or nullish `this`, Node's TypeError thrown. 1: the native
 * Promise constructor value (the fast path, built on the runtime's own promises). 2: any other object, a subclass or a custom
 * constructor, which the statics drive through NewPromiseCapability; *C is that receiver, +1. */
static int scr_ps_receiver(const char *msg, ScrDyn **C) {
  ScrDyn *t = scr_dyn_this_get();
  if (t == scr_promise_ctor_box) {
    scr_dyn_release(t);
    return 1;
  }
  bool prim = t->kind == SCR_DYN_UNDEF || t->kind == SCR_DYN_NULL || t->kind == SCR_DYN_NUM || t->kind == SCR_DYN_STR ||
              t->kind == SCR_DYN_BOOL || t->kind == SCR_DYN_BIG;
  if (prim) {
    scr_dyn_release(t);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, strlen(msg));
    return 0;
  }
  *C = t;
  return 2;
}

/* [[Get]] of a named member off a function or object receiver: +1, or NULL when absent (a getter's throw leaves it pending). */
static ScrDyn *scr_ps_get(ScrDyn *recv, const char *key, size_t key_len) {
  if (recv->kind == SCR_DYN_OBJ) return scr_dyn_obj_key_get(recv, key, key_len);
  if (recv->kind == SCR_DYN_FUNC) return scr_dyn_fn_get(recv, key, key_len);
  return NULL;
}

static ScrDyn *scr_ps_call_this(ScrDyn *fn, ScrDyn *thisv, ScrDyn *const *args, size_t argc) {
  scr_dyn_this_push_dyn(thisv);
  ScrDyn *r = scr_dyn_call(fn, args, argc, "Promise static");
  scr_dyn_this_pop();
  return r;
}

/* Promise.all / allSettled / race / any over the iterable args[0], on the native constructor (C NULL) or on the receiver C. */
static ScrDyn *scr_ps_combinator(int kind, ScrDyn *const *args, size_t argc, ScrDyn *C) {
  ScrPromise *out = NULL;
  ScrCap cap = {0};
  if (C == NULL) {
    out = scr_promise_new();
  } else if (!scr_cap_new(C, &cap)) {
    return NULL;
  }
  /* Everything below is IfAbruptRejectPromise: a throw settles the result instead of escaping. */
  ScrDyn *presolve = NULL;
  if (C != NULL) {
    presolve = scr_ps_get(C, "resolve", 7);
    if (presolve == NULL || presolve->kind != SCR_DYN_FUNC) {
      if (!scr_exc_pending()) scr_ps_throw_type("Promise resolve or reject function is not callable");
      scr_dyn_release(presolve);
      return scr_cap_reject_pending(&cap);
    }
  }
  /* GetIterator over the argument: the destructuring pack's wording is V8's ("number 5 is not iterable (cannot read property
   * Symbol(Symbol.iterator))"), and a failure REJECTS the result promise instead of throwing. */
  ScrDyn *items = scr_dyn_iter_pack(argc ? args[0] : scr_dyn_undefined(), NULL);
  if (items == NULL) {
    scr_dyn_release(presolve);
    if (C != NULL) return scr_cap_reject_pending(&cap);
    scr_promise_reject_pending(out);
    ScrDyn *r = scr_dyn_new_promise(out);
    scr_promise_release(out);
    return r;
  }
  size_t n = items->v.arr.len;
  ScrComb *c = calloc(1, sizeof *c);
  if (!c) abort();
  c->rc = 1;
  c->kind = kind;
  if (C == NULL) {
    c->out = scr_promise_retain(out);
  } else {
    c->cap_promise = scr_dyn_retain(cap.promise);
    c->cap_resolve = scr_dyn_retain(cap.resolve);
    c->cap_reject = scr_dyn_retain(cap.reject);
  }
  c->vals = scr_dyn_new_arr();
  c->remaining = n;
  for (size_t i = 0; i < n; i++) scr_dyn_arr_push(c->vals, scr_dyn_retain(scr_dyn_undefined()));
  if (n == 0) {
    if (kind == SCR_PS_ANY) scr_ps_reject_aggregate(c);
    else if (kind != SCR_PS_RACE) scr_comb_resolve(c, scr_dyn_retain(c->vals));
  }
  bool abrupt = false;
  for (size_t i = 0; i < n && !abrupt; i++) {
    ScrCombEl *el = calloc(1, sizeof *el);
    if (!el) abort();
    el->rc = 1;
    c->rc++;
    el->c = c;
    el->idx = i;
    ScrDyn *onf = scr_comb_make_fn(el, scr_comb_on_fulfilled, "");
    ScrDyn *onr = scr_comb_make_fn(el, scr_comb_on_rejected, "");
    if (C == NULL) {
      ScrPromise *ep = scr_dyn_adopt_promise(items->v.arr.items[i]);
      ScrDyn *d = scr_dyn_promise_then(ep, onf, onr, NULL);
      scr_dyn_release(d);
      scr_promise_release(ep);
    } else {
      /* nextPromise = C.resolve(item); nextPromise.then(onFulfilled, onRejected) */
      ScrDyn *item[1] = {items->v.arr.items[i]};
      ScrDyn *next = scr_ps_call_this(presolve, C, item, 1);
      ScrDyn *d = NULL;
      if (next != NULL) {
        ScrDyn *cb[2] = {onf, onr};
        d = scr_dyn_invoke(next, "then", cb, 2, "then");
        scr_dyn_release(next);
      }
      if (d == NULL) abrupt = true;
      else scr_dyn_release(d);
    }
    scr_dyn_release(onf);
    scr_dyn_release(onr);
    scr_comb_el_release_v(el);
  }
  ScrDyn *result;
  if (abrupt) {
    result = scr_cap_reject_pending(&cap);
  } else if (C == NULL) {
    result = scr_dyn_new_promise(out);
  } else {
    result = scr_dyn_retain(cap.promise);
    scr_cap_release(&cap);
  }
  if (out != NULL) scr_promise_release(out);
  scr_comb_release(c);
  scr_dyn_release(items);
  scr_dyn_release(presolve);
  return result;
}

#define SCR_PS_COMBINATOR_THUNK(fname, kindv, msg)                                      \
  static ScrDyn *fname(ScrClosure *clo, ScrDyn *const *args, size_t argc) {              \
    (void)clo;                                                                           \
    ScrDyn *C = NULL;                                                                    \
    int mode = scr_ps_receiver(msg, &C);                                                 \
    if (mode == 0) return NULL;                                                          \
    ScrDyn *r = scr_ps_combinator(kindv, args, argc, mode == 2 ? C : NULL);              \
    scr_dyn_release(C);                                                                  \
    return r;                                                                            \
  }
SCR_PS_COMBINATOR_THUNK(scr_ps_all, SCR_PS_ALL, "Promise.all called on non-object")
SCR_PS_COMBINATOR_THUNK(scr_ps_all_settled, SCR_PS_SETTLED, "Promise.allSettled called on non-object")
SCR_PS_COMBINATOR_THUNK(scr_ps_race, SCR_PS_RACE, "Promise.race called on non-object")
SCR_PS_COMBINATOR_THUNK(scr_ps_any, SCR_PS_ANY, "Promise.any called on non-object")

/* PromiseResolve(C, x) over a receiver C that is not the native constructor: x itself when it already is a promise made by C. */
static ScrDyn *scr_ps_resolve_on(ScrDyn *C, ScrDyn *x) {
  if (x->kind == SCR_DYN_OBJ || x->kind == SCR_DYN_FUNC) {
    ScrDyn *xc = scr_ps_get(x, "constructor", 11);
    if (xc == NULL && scr_exc_pending()) return NULL;
    bool same = xc == C;
    scr_dyn_release(xc);
    if (same) return scr_dyn_retain(x);
  }
  ScrCap cap = {0};
  if (!scr_cap_new(C, &cap)) return NULL;
  ScrDyn *exc = NULL;
  if (!scr_cap_call1(cap.resolve, x, &exc)) {
    scr_throw_dyn(exc);
    scr_cap_release(&cap);
    return NULL;
  }
  ScrDyn *p = scr_dyn_retain(cap.promise);
  scr_cap_release(&cap);
  return p;
}

static ScrDyn *scr_ps_resolve(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *C = NULL;
  int mode = scr_ps_receiver("PromiseResolve called on non-object", &C);
  if (mode == 0) return NULL;
  ScrDyn *v = argc ? args[0] : scr_dyn_undefined();
  if (mode == 2) {
    ScrDyn *r = scr_ps_resolve_on(C, v);
    scr_dyn_release(C);
    return r;
  }
  if (v->kind == SCR_DYN_PROMISE) return scr_dyn_retain(v); /* PromiseResolve returns a promise of the same constructor as is */
  ScrPromise *p = scr_dyn_adopt_promise(v);
  ScrDyn *r = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return r;
}

static ScrDyn *scr_ps_reject(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *C = NULL;
  int mode = scr_ps_receiver("PromiseReject called on non-object", &C);
  if (mode == 0) return NULL;
  ScrDyn *reason = argc ? args[0] : scr_dyn_undefined();
  if (mode == 2) {
    ScrCap cap = {0};
    bool ok = scr_cap_new(C, &cap);
    scr_dyn_release(C);
    if (!ok) return NULL;
    ScrDyn *exc = NULL;
    if (!scr_cap_call1(cap.reject, reason, &exc)) {
      scr_throw_dyn(exc);
      scr_cap_release(&cap);
      return NULL;
    }
    ScrDyn *p = scr_dyn_retain(cap.promise);
    scr_cap_release(&cap);
    return p;
  }
  ScrPromise *p = scr_promise_new();
  scr_throw_dyn(scr_dyn_retain(reason));
  scr_promise_reject_pending(p);
  ScrDyn *r = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return r;
}

static ScrDyn *scr_ps_with_resolvers(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  ScrDyn *C = NULL;
  int mode = scr_ps_receiver("Promise.withResolvers called on non-object", &C);
  if (mode == 0) return NULL;
  ScrDyn *o = scr_dyn_new_obj();
  if (mode == 2) {
    ScrCap cap = {0};
    bool ok = scr_cap_new(C, &cap);
    scr_dyn_release(C);
    if (!ok) {
      scr_dyn_release(o);
      return NULL;
    }
    scr_dyn_obj_set(o, "promise", 7, cap.promise);
    scr_dyn_obj_set(o, "resolve", 7, cap.resolve);
    scr_dyn_obj_set(o, "reject", 6, cap.reject);
    return o;
  }
  ScrPromise *p = scr_promise_new();
  ScrDyn *res, *rej;
  scr_promise_make_resolvers(p, &res, &rej);
  scr_dyn_obj_set(o, "promise", 7, scr_dyn_new_promise(p));
  scr_dyn_obj_set(o, "resolve", 7, res);
  scr_dyn_obj_set(o, "reject", 6, rej);
  scr_promise_release(p);
  return o;
}

/* Promise.try(fn, ...args): fn runs synchronously; its return resolves the promise, a throw rejects it. */
static ScrDyn *scr_ps_try(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *C = NULL;
  int mode = scr_ps_receiver("Promise.try called on non-object", &C);
  if (mode == 0) return NULL;
  ScrCap cap = {0};
  ScrPromise *p = NULL;
  if (mode == 2) {
    bool ok = scr_cap_new(C, &cap);
    scr_dyn_release(C);
    if (!ok) return NULL;
  } else {
    p = scr_promise_new();
  }
  ScrDyn *r = NULL;
  if (argc == 0 || args[0]->kind != SCR_DYN_FUNC) {
    scr_ps_throw_type("undefined is not a function");
  } else {
    r = scr_dyn_call(args[0], argc > 1 ? args + 1 : NULL, argc > 1 ? argc - 1 : 0, "Promise.try");
  }
  if (mode == 2) {
    ScrDyn *out;
    if (r == NULL) {
      out = scr_cap_reject_pending(&cap);
    } else {
      ScrDyn *exc = NULL;
      if (!scr_cap_call1(cap.resolve, r, &exc)) {
        ScrDyn *ign = NULL;
        scr_cap_call1(cap.reject, exc, &ign);
        scr_dyn_release(ign);
      }
      scr_dyn_release(exc);
      scr_dyn_release(r);
      out = scr_dyn_retain(cap.promise);
      scr_cap_release(&cap);
    }
    return out;
  }
  if (r != NULL) scr_dyn_resolve_into_pub(p, r);
  else scr_promise_reject_pending(p);
  ScrDyn *out = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return out;
}

enum { SCR_PSF_RESOLVE, SCR_PSF_REJECT, SCR_PSF_ALL, SCR_PSF_SETTLED, SCR_PSF_RACE, SCR_PSF_ANY, SCR_PSF_WITHR, SCR_PSF_TRY, SCR_PSF_COUNT };
static ScrDyn *scr_ps_fns[SCR_PSF_COUNT];

static void scr_ps_teardown(void) {
  for (int i = 0; i < SCR_PSF_COUNT; i++) {
    scr_dyn_release(scr_ps_fns[i]);
    scr_ps_fns[i] = NULL;
  }
}

static ScrDyn *scr_promise_static_member(const char *key, size_t key_len) {
  static const struct { const char *name; ScrDynThunk thunk; uint32_t arity; } T[SCR_PSF_COUNT] = {
    { "resolve", scr_ps_resolve, 1 }, { "reject", scr_ps_reject, 1 }, { "all", scr_ps_all, 1 },
    { "allSettled", scr_ps_all_settled, 1 }, { "race", scr_ps_race, 1 }, { "any", scr_ps_any, 1 },
    { "withResolvers", scr_ps_with_resolvers, 0 }, { "try", scr_ps_try, 1 },
  };
  for (int i = 0; i < SCR_PSF_COUNT; i++) {
    if (strlen(T[i].name) != key_len || memcmp(T[i].name, key, key_len) != 0) continue;
    if (scr_ps_fns[i] == NULL) {
      static bool armed;
      if (!armed) {
        armed = true;
        scr_atexit(scr_ps_teardown);
      }
      scr_ps_fns[i] = scr_dyn_new_func(scr_closure_new((void *)T[i].thunk, 0), T[i].thunk, T[i].arity, "()", T[i].name);
    }
    return scr_dyn_retain(scr_ps_fns[i]);
  }
  return NULL;
}

__attribute__((constructor)) static void scr_promise_static_install(void) {
  scr_promise_static_hook = scr_promise_static_member;
  scr_promise_ctor_provider = scr_dyn_promise_ctor; /* a promise's prototype names the constructor value */
}

