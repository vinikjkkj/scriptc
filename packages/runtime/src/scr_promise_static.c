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
  ScrPromise *out;   /* the result promise; retained */
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
  scr_promise_release(c->out);
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

static void scr_ps_reject_aggregate(ScrComb *c) {
  static const char msg[] = "All promises were rejected";
  ScrStr *m = scr_str_new(msg, sizeof msg - 1);
  ScrError *e = scr_error_new(SCR_ERR_AGGREGATE, m);
  scr_str_release(m);
  scr_error_set_errors(e, scr_dyn_retain(c->vals));
  scr_throw_dyn(scr_dyn_from_error(e));
  scr_error_release(e);
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
        scr_ps_reject_with(c->out, x);
        return;
      }
      scr_ps_store(c, el->idx, scr_dyn_retain((ScrDyn *)x));
      break;
    case SCR_PS_SETTLED:
      scr_ps_record(c, el->idx, rejected, x);
      break;
    case SCR_PS_RACE:
      if (rejected) scr_ps_reject_with(c->out, x);
      else scr_dyn_resolve_into_pub(c->out, scr_dyn_retain((ScrDyn *)x));
      return;
    default: /* SCR_PS_ANY */
      if (!rejected) {
        scr_dyn_resolve_into_pub(c->out, scr_dyn_retain((ScrDyn *)x));
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
  scr_dyn_resolve_into_pub(c->out, scr_dyn_retain(c->vals));
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

/* The receiver check every static makes (ES: the constructor `this`). Only the native Promise constructor is a receiver this
 * runtime can build promises through; a primitive or nullish `this` throws Node's TypeError, and any other object receiver (a
 * subclass or a user constructor, NewPromiseCapability(C)) is named as unsupported instead of answering with the wrong class. */
static bool scr_ps_this_ok(const char *msg) {
  ScrDyn *t = scr_dyn_this_get();
  bool ok = t == scr_promise_ctor_box;
  bool prim = t->kind == SCR_DYN_UNDEF || t->kind == SCR_DYN_NULL || t->kind == SCR_DYN_NUM || t->kind == SCR_DYN_STR ||
              t->kind == SCR_DYN_BOOL || t->kind == SCR_DYN_BIG;
  scr_dyn_release(t);
  if (ok) return true;
  if (prim) {
    scr_throw_error_msg(SCR_ERR_TYPE, msg, strlen(msg));
  } else {
    static const char un[] = "a Promise static called with a receiver other than the Promise constructor (a subclass or custom constructor) is not supported yet";
    scr_throw_error_msg(SCR_ERR_ERROR, un, sizeof un - 1);
  }
  return false;
}

/* Promise.all / allSettled / race / any over the iterable args[0]. */
static ScrDyn *scr_ps_combinator(int kind, ScrDyn *const *args, size_t argc) {
  ScrPromise *out = scr_promise_new();
  /* GetIterator over the argument: the destructuring pack's wording is V8's ("number 5 is not iterable (cannot read property
   * Symbol(Symbol.iterator))"), and a failure REJECTS the result promise instead of throwing. */
  ScrDyn *items = scr_dyn_iter_pack(argc ? args[0] : scr_dyn_undefined(), NULL);
  if (items == NULL) {
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
  c->out = scr_promise_retain(out);
  c->vals = scr_dyn_new_arr();
  c->remaining = n;
  for (size_t i = 0; i < n; i++) scr_dyn_arr_push(c->vals, scr_dyn_retain(scr_dyn_undefined()));
  if (n == 0) {
    if (kind == SCR_PS_ANY) scr_ps_reject_aggregate(c);
    else if (kind != SCR_PS_RACE) scr_dyn_resolve_into_pub(c->out, scr_dyn_retain(c->vals));
  }
  for (size_t i = 0; i < n; i++) {
    ScrCombEl *el = calloc(1, sizeof *el);
    if (!el) abort();
    el->rc = 1;
    c->rc++;
    el->c = c;
    el->idx = i;
    ScrPromise *ep = scr_dyn_adopt_promise(items->v.arr.items[i]);
    ScrDyn *onf = scr_comb_make_fn(el, scr_comb_on_fulfilled, "");
    ScrDyn *onr = scr_comb_make_fn(el, scr_comb_on_rejected, "");
    ScrDyn *d = scr_dyn_promise_then(ep, onf, onr, NULL);
    scr_dyn_release(d);
    scr_dyn_release(onf);
    scr_dyn_release(onr);
    scr_promise_release(ep);
    scr_comb_el_release_v(el);
  }
  scr_comb_release(c);
  scr_dyn_release(items);
  ScrDyn *r = scr_dyn_new_promise(out);
  scr_promise_release(out);
  return r;
}

static ScrDyn *scr_ps_all(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("Promise.all called on non-object")) return NULL;
  return scr_ps_combinator(SCR_PS_ALL, args, argc);
}
static ScrDyn *scr_ps_all_settled(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("Promise.allSettled called on non-object")) return NULL;
  return scr_ps_combinator(SCR_PS_SETTLED, args, argc);
}
static ScrDyn *scr_ps_race(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("Promise.race called on non-object")) return NULL;
  return scr_ps_combinator(SCR_PS_RACE, args, argc);
}
static ScrDyn *scr_ps_any(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("Promise.any called on non-object")) return NULL;
  return scr_ps_combinator(SCR_PS_ANY, args, argc);
}

static ScrDyn *scr_ps_resolve(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("PromiseResolve called on non-object")) return NULL;
  ScrDyn *v = argc ? args[0] : scr_dyn_undefined();
  if (v->kind == SCR_DYN_PROMISE) return scr_dyn_retain(v); /* PromiseResolve returns a promise of the same constructor as is */
  ScrPromise *p = scr_dyn_adopt_promise(v);
  ScrDyn *r = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return r;
}

static ScrDyn *scr_ps_reject(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("PromiseReject called on non-object")) return NULL;
  ScrPromise *p = scr_promise_new();
  scr_throw_dyn(scr_dyn_retain(argc ? args[0] : scr_dyn_undefined()));
  scr_promise_reject_pending(p);
  ScrDyn *r = scr_dyn_new_promise(p);
  scr_promise_release(p);
  return r;
}

static ScrDyn *scr_ps_with_resolvers(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("Promise.withResolvers called on non-object")) return NULL;
  (void)args;
  (void)argc;
  ScrPromise *p = scr_promise_new();
  ScrDyn *res, *rej;
  scr_promise_make_resolvers(p, &res, &rej);
  ScrDyn *o = scr_dyn_new_obj();
  scr_dyn_obj_set(o, "promise", 7, scr_dyn_new_promise(p));
  scr_dyn_obj_set(o, "resolve", 7, res);
  scr_dyn_obj_set(o, "reject", 6, rej);
  scr_promise_release(p);
  return o;
}

/* Promise.try(fn, ...args): fn runs synchronously; its return resolves the promise, a throw rejects it. */
static ScrDyn *scr_ps_try(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (!scr_ps_this_ok("Promise.try called on non-object")) return NULL;
  ScrPromise *p = scr_promise_new();
  ScrDyn *r = NULL;
  if (argc == 0 || args[0]->kind != SCR_DYN_FUNC) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "undefined is not a function");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  } else {
    r = scr_dyn_call(args[0], argc > 1 ? args + 1 : NULL, argc > 1 ? argc - 1 : 0, "Promise.try");
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

__attribute__((constructor)) static void scr_promise_static_install(void) { scr_promise_static_hook = scr_promise_static_member; }

