/* Prototype-method dispatch on checked-dynamic receivers (scr_dyn_invoke)
 * and its companions: ToString over the checked-dynamic tree (dyn_str_buf
 * — join, the default sort comparator and the error texts each need it
 * standalone, the first two with the object protocol and the last
 * without) and the two property definers
 * over dyn values (scr_dyn_define_prop / scr_dyn_define_props, including
 * the ACCESSOR descriptor pbjs's oneof fields are spelled with). Linked
 * only when the IR carries dynInvoke nodes or either define call (cc.ts gates on
 * moduleUsesDynInvoke — the scr_assert.c precedent), so dispatch-free
 * binaries keep their exact size class. The checked-dynamic tree itself lives in
 * scr_json.c; this unit uses only its public surface plus ScrJsonBuf.
 */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h> /* malloc/free in the sort snapshot */
#include <string.h>

/* ── checked-dynamic METHOD DISPATCH (scr_dyn_invoke) ──────────────────
 *
 * `recv.m(args)` where recv is a dyn value and `m` is a name a
 * dyn-representable prototype declares (Array/String/Function shared
 * names — push, slice, forEach, apply, ...): a stored-member read would
 * silently mis-answer real methods, so the dispatch runs HERE, over the
 * receiver's runtime kind. test/common's mustCall internals are the
 * canonical caller (mustCallChecks.push/filter/forEach, fn.apply).
 *
 * Honesty ladder, per (kind, name):
 *   - implemented: JS-exact semantics below;
 *   - the name exists on that kind's JS prototype but has no
 *     implementation here: a LOUD "not supported yet" Error — never a
 *     silent wrong answer;
 *   - the name does not exist on that kind's prototype: Node's own
 *     TypeError ("<spelling> is not a function"), because that IS the
 *     JS answer;
 *   - OBJ receivers: the own member calls (own properties shadow the
 *     prototype in JS too), otherwise "<spelling> is not a function";
 *   - undefined/null receivers: Node's "Cannot read properties of ...".
 *
 * recv/args are BORROWED; the result is owned (+1). MAY THROW (returns
 * NULL with the exception pending). */

/* ── ToString over a dyn value, runtime-side: ONE table, TWO MODES ─────
 *
 * join and the default sort comparator need String() standalone (the
 * emitted sc_ds walker exists only in programs that spell
 * String(unknown) themselves), and so do five error-message builders in
 * this file. Those two needs are NOT the same conversion, and running
 * one where the other belongs is a bug in either direction:
 *
 *   DISPLAY (protocol = true) is JS ToString. An OBJ's own or inherited
 *   `toString` RUNS, a RegExp handle answers /source/flags, an island
 *   value crosses to the engine's ToString. That is user code: it can
 *   throw, and the throw is the program's — it stays pending and the
 *   caller unwinds. Node: `[{toString(){throw}}].join("")` throws the
 *   toString's error, and `[o,"b"].sort()` orders on o's toString.
 *
 *   DIAGNOSTIC (protocol = false) is V8's NoSideEffectsToString: the
 *   CONSTANTS only, never a user call. Every site below that builds an
 *   EXCEPTION MESSAGE uses this mode, because a `toString` that threw
 *   while an error message was being formatted would REPLACE the error
 *   the program actually hit with an unrelated one — and because Node
 *   does not run it either. Measured against Node v25.9.0:
 *     [1].forEach({toString(){throw}})   -> "object is not a function"
 *     [1,2].sort({toString(){return "N"}})
 *        -> "...must be either a function or undefined: [object Object]"
 *   Both messages ignore the user toString entirely; the second proves
 *   it is ignored rather than merely unreached, since a working
 *   toString still does not appear.
 *
 * The two share this one switch so the table cannot drift between them;
 * only the arms that would call user code branch on the mode. */
static void dyn_str_buf(ScrJsonBuf *b, const ScrDyn *d, bool protocol) {
  switch (d->kind) {
  case SCR_DYN_UNDEF: scr_jb_puts(b, "undefined"); return;
  case SCR_DYN_NULL: scr_jb_puts(b, "null"); return;
  case SCR_DYN_BOOL: scr_jb_puts(b, d->v.b ? "true" : "false"); return;
  case SCR_DYN_NUM: {
    ScrStr *s = scr_f64_to_scrstr(d->v.num);
    for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
    scr_str_release(s);
    return;
  }
  case SCR_DYN_STR:
    for (size_t i = 0; i < d->v.str->len; i++) scr_jb_putc(b, d->v.str->data[i]);
    return;
  case SCR_DYN_ARR:
    for (size_t i = 0; i < d->v.arr.len; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      const ScrDyn *e = d->v.arr.items[i];
      if (e->kind == SCR_DYN_UNDEF || e->kind == SCR_DYN_NULL) continue;
      dyn_str_buf(b, e, protocol);
      /* An element's own toString threw (or a nested JSVAL element's
       * bridged ToString did); JS's join stops at the first throw, so
       * the rest of the elements do not render — their toStrings are
       * user code with side effects Node never runs (scr_json.c's twin
       * carries the same bail). The DIAGNOSTIC mode calls nothing and so
       * can raise nothing; it must not read the flag either, or an
       * exception already in flight would silently truncate the message
       * being built to describe it. */
      if (protocol && scr_exc_pending()) return;
    }
    return;
  case SCR_DYN_OBJ: {
    if (protocol) {
      /* The whole ToString protocol, through the ONE runtime table:
       * an own or inherited callable `toString` first, the checked-
       * dynamic tree's error encoding (Error.prototype.toString,
       * reached through its [[Prototype]] link like JS reaches it)
       * second, "[object Object]" last. Delegating rather than
       * repeating is why this copy cannot drift from scr_dyn_to_string
       * — and the error case that used to sit here, AHEAD of the
       * protocol, was precisely such a drift. */
      ScrStr *s = scr_dyn_to_string(d, NULL);
      for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
      scr_str_release(s);
      return;
    }
    /* Diagnostic: the constants, in the order the protocol would have
     * reached them had it been allowed to run. */
    if (scr_dyn_is_error_encoding(d)) {
      const ScrDyn *en = scr_dyn_err_read(d, "name", 4);
      const ScrDyn *em = scr_dyn_err_read(d, "message", 7);
      const ScrStr *ens = (en && en->kind == SCR_DYN_STR) ? en->v.str : NULL;
      const ScrStr *ems = (em && em->kind == SCR_DYN_STR) ? em->v.str : NULL;
      if (ens) for (size_t i = 0; i < ens->len; i++) scr_jb_putc(b, ens->data[i]);
      if (ens && ens->len && ems && ems->len) scr_jb_puts(b, ": ");
      if (ems) for (size_t i = 0; i < ems->len; i++) scr_jb_putc(b, ems->data[i]);
      return;
    }
    scr_jb_puts(b, "[object Object]");
    return;
  }
  case SCR_DYN_BYTES:
    /* A DataView is Object.prototype.toString with the "DataView" tag (it
     * has no toString of its own, so String(dv) must not join its bytes
     * the way a Uint8Array does). Constant in both modes, like ARRBUF's. */
    if (d->v.bytes->flavor == SCR_BF_DATAVIEW) {
      scr_jb_puts(b, "[object DataView]");
      return;
    }
    if (d->buffer) {
      /* Buffer-flavored values (stream chunks) coerce utf8 (Node's
       * Buffer.toString); plain Uint8Array joins its elements. */
      ScrStr *enc = scr_str_new("utf8", 4);
      ScrStr *txt = scr_bytes_to_str(d->v.bytes, enc);
      scr_str_release(enc);
      for (size_t i = 0; i < txt->len; i++) scr_jb_putc(b, txt->data[i]);
      scr_str_release(txt);
      return;
    }
    for (size_t i = 0; i < d->v.bytes->len; i++) {
      if (i > 0) scr_jb_putc(b, ',');
      char n[16];
      snprintf(n, sizeof n, "%u", (unsigned)d->v.bytes->data[i]);
      scr_jb_puts(b, n);
    }
    return;
  case SCR_DYN_FUNC: {
    /* Function.prototype.toString — the source text, through the one
     * renderer (scr_fn_to_string; never NULL, it traps instead). */
    ScrStr *s = scr_fn_to_string(d);
    for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
    scr_str_release(s);
    return;
  }
  case SCR_DYN_HANDLE:
    /* The I/O classes inherit Object.prototype.toString, but RegExp owns
     * its own and answers /source/flags — ask the runtime rather than
     * repeating a constant that is wrong for one tag. The renderer is
     * native (no user code, cannot throw), so DISPLAY may use it; the
     * diagnostic mode keeps the constant only because changing an error
     * message's text is not this conversion's job. */
    if (protocol) {
      ScrStr *s = scr_dyn_to_string(d, NULL);
      for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
      scr_str_release(s);
      return;
    }
    scr_jb_puts(b, "[object Object]");
    return;
  case SCR_DYN_OBJINST:
    /* A class instance may OVERRIDE toString and the box carries no
     * member table to dispatch it through, so DISPLAY asks the runtime
     * (whose arm is the loud ladder — the honest answer, since
     * "[object Object]" would be wrong for exactly the classes that
     * define one). The diagnostic mode keeps the constant: naming a
     * value inside an error message must not raise a second exception
     * over the first, which is the HANDLE arm's rule above. */
    if (protocol) {
      ScrStr *is = scr_dyn_to_string(d, NULL);
      for (size_t i = 0; i < is->len; i++) scr_jb_putc(b, is->data[i]);
      scr_str_release(is);
      return;
    }
    scr_jb_puts(b, "[object Object]");
    return;
  case SCR_DYN_BIG: {
    /* The DIGITS, in BOTH modes. The protocol/diagnostic split exists
     * for kinds whose toString might be user code; BigInt.prototype
     * .toString is native and cannot throw, so the diagnostic mode's
     * no-user-code rule is satisfied by the value itself — the BYTES
     * and ARRBUF stance. */
    ScrStr *s = scr_dyn_big_ops()->to_str(d->v.big, 10);
    for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
    scr_str_release(s);
    return;
  }
  case SCR_DYN_MAP:
    /* Object.prototype.toString with the Map / Set tag — a constant in
     * both modes for the ARRBUF arm's reason: neither has an own
     * toString for a user to override. */
    scr_jb_puts(b, "[object ");
    scr_jb_puts(b, scr_dyn_map_cls(d));
    scr_jb_putc(b, ']');
    return;
  case SCR_DYN_ARRBUF:
    /* Object.prototype.toString with the ArrayBuffer tag — a constant in
     * both modes, because an ArrayBuffer has no own toString for a user
     * to override (the OBJINST arm's split exists only for classes that
     * might). */
    scr_jb_puts(b, "[object ArrayBuffer]");
    return;
  case SCR_DYN_PROMISE:
    /* Object.prototype.toString — promises carry no own toString, and
     * their @@toStringTag is not modeled here; Node's String() answer
     * for a bare promise is "[object Promise]". */
    scr_jb_puts(b, "[object Promise]");
    return;
  case SCR_DYN_JSVAL:
    /* The engine's own ToString runs the real prototype chain — user
     * code included — so a bridged failure leaves the exception pending
     * and appends nothing (the loud path). That makes it DISPLAY only:
     * an error message must not be able to raise a second exception
     * over the first, and Node does not run an argument's toString to
     * name it either. Reasoned, not measured: §6.5 of
     * estado-displaythrow.md records that no probe can get a throwing
     * engine object into `unknown` on this lane, so the constant here
     * REMOVES a hazard that was never reachable rather than fixing an
     * observed divergence. */
    if (protocol) {
      scr_dyn_isl_tostr_buf(b, d);
      return;
    }
    scr_jb_puts(b, "[object Object]");
    return;
  }
}

/* JS ToString — the value's own toString runs; MAY leave an exception
 * pending, which every caller below checks. */
static void scr_dyn_display_buf(ScrJsonBuf *b, const ScrDyn *d) { dyn_str_buf(b, d, true); }

/* V8's NoSideEffectsToString — for building EXCEPTION MESSAGES only.
 * Never calls user code, therefore never throws. */
static void scr_dyn_diag_buf(ScrJsonBuf *b, const ScrDyn *d) { dyn_str_buf(b, d, false); }

static void dyn_throw_not_fn(const char *what) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " is not a function");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
}

static void dyn_throw_unsupported(const char *proto, const char *method) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_putc(&b, '\'');
  scr_jb_puts(&b, proto);
  scr_jb_puts(&b, ".prototype.");
  scr_jb_puts(&b, method);
  scr_jb_puts(&b, "' on a dynamic value is not supported yet");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

/* ToIntegerOrInfinity over an OPTIONAL index argument: missing/undefined
 * answers dflt; a NUM truncates toward zero (NaN -> 0, like JS); any
 * other kind throws the loud fence (Node would ToNumber-coerce — a
 * documented gap, never a silent misread). */
static double dyn_index_arg(ScrDyn *const *args, size_t argc, size_t i, double dflt, const char *what) {
  /* The body moved to scr_json.c with the typed-array dispatch that
   * shares it — an always-linked unit cannot call into this optional
   * one, and two coercions would be two answers. */
  return scr_dyn_index_arg(args, argc, i, dflt, what);
}

/* JS relative-index normalization (slice's rule). */
static size_t dyn_rel_index(double rel, size_t len) {
  if (rel < 0) {
    double r = (double)len + rel;
    return r < 0 ? 0 : (size_t)r;
  }
  return rel > (double)len ? len : (size_t)rel;
}

/* FlattenIntoArray (ES 23.1.3.13.1) for a dyn array: elements that are
 * arrays flatten while depth > 0, everything else is pushed whole. A wrapped
 * engine array flattens through the routed keyed reads. Returns false with a
 * pending exception when a bridged read unwinds. */
static bool dyn_flatten_into(ScrDyn *out, ScrDyn *src, double depth) {
  size_t n = src->v.arr.len;
  for (size_t i = 0; i < n && i < src->v.arr.len; i++) {
    ScrDyn *item = scr_dyn_retain(src->v.arr.items[i]);
    if (depth > 0 && item->kind == SCR_DYN_ARR) {
      bool ok = dyn_flatten_into(out, item, depth - 1);
      scr_dyn_release(item);
      if (!ok) return false;
    } else if (depth > 0 && scr_dyn_isl_is_array(item)) {
      ScrStr *lk = scr_str_new("length", 6);
      ScrDyn *lenv = scr_dyn_isl_key_get(item, lk);
      scr_str_release(lk);
      if (!lenv) { scr_dyn_release(item); return false; }
      size_t rn = lenv->kind == SCR_DYN_NUM ? (size_t)lenv->v.num : 0;
      scr_dyn_release(lenv);
      ScrDyn *tmp = scr_dyn_new_arr();
      for (size_t j = 0; j < rn; j++) {
        char idx[24];
        int ilen = snprintf(idx, sizeof idx, "%zu", j);
        ScrStr *jk = scr_str_new(idx, (size_t)ilen);
        ScrDyn *el = scr_dyn_isl_key_get(item, jk);
        scr_str_release(jk);
        if (!el) { scr_dyn_release(tmp); scr_dyn_release(item); return false; }
        scr_dyn_arr_push(tmp, el);
      }
      bool ok = dyn_flatten_into(out, tmp, depth - 1);
      scr_dyn_release(tmp);
      scr_dyn_release(item);
      if (!ok) return false;
    } else {
      scr_dyn_arr_push(out, item); /* ownership moves in */
    }
  }
  return true;
}

/* The array callback runner (forEach/map/filter/some/every/find/
 * findIndex): calls cb(item, i, recv) per element through the boxed
 * thunk. Returns the owned result or NULL with the exception pending. */
static ScrDyn *dyn_call_cb(ScrDyn *cb, ScrDyn *item, size_t i, ScrDyn *recv) {
  ScrDyn *idx = scr_dyn_new_num((double)i);
  ScrDyn *cbargs[3] = { item, idx, recv };
  ScrDyn *r = scr_dyn_call(cb, cbargs, 3, "callback");
  scr_dyn_release(idx);
  return r;
}

/* The callable-callback gate: JS's "<type of cb> is not a function", with
 * V8's CalledNonCallable rendering. The body lives in scr_json.c
 * (scr_dyn_cb_check) beside the typed-array callbacks that share it, so a
 * callback refused by an array and one refused by a typed array say the
 * same thing. */
static bool dyn_cb_check(ScrDyn *const *args, size_t argc) {
  return scr_dyn_cb_check(argc > 0 ? args[0] : scr_dyn_undefined());
}

static bool dyn_name_is(const char *m, const char *n) { return strcmp(m, n) == 0; }

/* ── CreateListFromArrayLike (ECMA-262 7.3.18) ───────────────────
 *
 * `fn.apply(thisArg, pack)` takes any OBJECT as its pack, not just a real
 * array. Node runs `fn.apply(null, new Uint8Array([1,2]))` and
 * `fn.apply(null, {length:2, 0:100, 1:101})`; this runtime answered both
 * with "CreateListFromArrayLike called on non-object", which is the
 * message for a case that is NOT this one — the array-like packs ARE
 * objects. estado-apply.md 7.2 declared the divergence, priced the fix at
 * 50-70 lines of C and did not take it; this is that follow-up.
 *
 * The spec is three steps: reject a non-Object, ToLength(Get(o,
 * "length")), then Get(o, ToString(i)) for i in 0..len-1. A PRIMITIVE
 * pack keeps Node's own message (`fn.apply(null, "ab")` throws in Node
 * too, with this text). An object kind this runtime holds no keyed read
 * for keeps a LOUD fence naming what it could not do, rather than a
 * silently empty pack — the honesty ladder at the top of this file.
 *
 * Answers a malloc'd array of +1 dyn values with *out_len set, or NULL.
 * NULL means an EMPTY pack when no exception is pending and a throw when
 * one is; both are what the caller already does with a zero-length list.
 * `list` is borrowed. */
#define SCR_APPLY_PACK_MAX 65535u

static ScrDyn **dyn_list_from_array_like(ScrDyn *list, size_t *out_len) {
  *out_len = 0;
  /* JS's "is an Object": every reference kind, functions included (typeof
   * answers "function" for those, which is why they are named here). */
  if (!scr_dyn_typeof_is_object(list) && list->kind != SCR_DYN_FUNC) {
    scr_throw_error_msg(SCR_ERR_TYPE, "CreateListFromArrayLike called on non-object",
                        strlen("CreateListFromArrayLike called on non-object"));
    return NULL;
  }
  double raw;
  if (list->kind == SCR_DYN_BYTES) {
    /* A typed array's `length` is its ELEMENT count, and the element read
     * below goes through scr_bytes_get so every width answers its own
     * value (a Uint8Array is not the only pack shape that reaches here). */
    raw = scr_bytes_len(list->v.bytes);
  } else if (list->kind == SCR_DYN_OBJ) {
    ScrDyn *len = scr_dyn_obj_key_get(list, "length", 6);
    if (len == NULL) return NULL; /* an accessor threw */
    raw = scr_dyn_to_number(len);
    scr_dyn_release(len);
    if (scr_exc_pending()) return NULL;
  } else {
    /* ARR never reaches here (the caller's fast path owns it). Everything
     * left IS an object in JS — a class instance, an island handle, a
     * promise, an ArrayBuffer, a function — and reading `length` plus the
     * index keys off one of those needs a keyed read this unit does not
     * have. Loud, and it names the kind rather than claiming Node's
     * non-object message. */
    dyn_throw_unsupported("Function", "apply with an argument pack of this kind");
    return NULL;
  }
  /* ToLength (7.1.20): NaN and every negative answer 0; a fraction
   * truncates toward zero. */
  double len = (raw != raw) ? 0.0 : trunc(raw);
  if (len <= 0.0) return NULL; /* the empty pack; no exception pending */
  if (len > (double)SCR_APPLY_PACK_MAX) {
    /* V8 answers RangeError long before a length like this, and a pack
     * this runtime cannot build must be loud rather than truncated. */
    scr_throw_error_msg(SCR_ERR_RANGE, "Maximum call stack size exceeded",
                        strlen("Maximum call stack size exceeded"));
    return NULL;
  }
  size_t n = (size_t)len;
  ScrDyn **items = (ScrDyn **)malloc(n * sizeof(ScrDyn *));
  if (items == NULL) {
    scr_throw_error_msg(SCR_ERR_ERROR, "out of memory building an argument pack",
                        strlen("out of memory building an argument pack"));
    return NULL;
  }
  for (size_t i = 0; i < n; i++) {
    ScrDyn *v;
    if (list->kind == SCR_DYN_BYTES) {
      /* Past the end of a typed array every index reads undefined, which
       * is what a `length` bigger than the payload means in JS too. */
      v = i < list->v.bytes->len ? scr_dyn_new_num(scr_bytes_get(list->v.bytes, (double)i))
                                 : scr_dyn_retain(scr_dyn_undefined());
    } else {
      char key[24];
      int kl = snprintf(key, sizeof key, "%llu", (unsigned long long)i);
      v = kl > 0 ? scr_dyn_obj_key_get(list, key, (size_t)kl) : NULL;
    }
    if (v == NULL) { /* an accessor threw mid-pack */
      for (size_t j = 0; j < i; j++) scr_dyn_release(items[j]);
      free(items);
      return NULL;
    }
    items[i] = v;
  }
  *out_len = n;
  return items;
}


/* Handle receivers: hand the whole call to the tag's ops (installed by
 * the owning unit at main() — a missing install is an internal error the
 * accessor reports). */
static ScrDyn *scr_dynh_dispatch(ScrDyn *recv, const char *method, ScrDyn *const *args, size_t argc, const char *what) {
  const ScrDynHandleOps *ops = scr_dyn_handle_ops_of(recv);
  return ops->invoke(recv->v.handle.ptr, recv, method, args, argc, what);
}

/* JS Array.prototype.sort over a dyn array: the spec's snapshot-sort —
 * elements copy (retained) into a work list, a stable merge sort orders
 * it (undefined elements sink to the end before any comparator runs),
 * and the ordered list writes back index by index, so a comparator that
 * mutates the receiver mid-sort never dangles the items being ordered.
 * The default comparator compares ToString images (scr_dyn_display_buf —
 * join's conversion) bytewise: code-POINT order, where JS orders UTF-16
 * code units — identical through the BMP, divergent only across the
 * surrogate boundary (SEMANTICS.md). That ToString runs the ELEMENT'S
 * OWN toString, which is user code and can throw; JS abandons the sort
 * at the first throw and leaves the receiver in whatever order it had
 * reached, so a failing image sets the same `failed` flag a throwing
 * comparator does and the write-back is skipped. A comparator result
 * converts loosely to number; NaN and non-numeric answers count as 0
 * (ToNumber's common cases; exotic ToString-of-object coercions stay 0).
 *
 * Comparison COUNT is not JS-observable through the spec, and this merge
 * sort does not make the same calls V8's TimSort does: a program that
 * counts how many times an element's toString ran can see the
 * difference. Order is exact; the count is not, and is not promised. */
static ScrStr *dyn_sort_str(const ScrDyn *e) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_dyn_display_buf(&b, e);
  return scr_jb_finish(&b);
}
static int dyn_sort_compare(ScrDyn *x, ScrDyn *y, ScrDyn *cmp, bool *failed) {
  bool xu = x->kind == SCR_DYN_UNDEF, yu = y->kind == SCR_DYN_UNDEF;
  if (xu || yu) return (xu && yu) ? 0 : xu ? 1 : -1;
  if (cmp) {
    ScrDyn *argv[2] = { x, y };
    ScrDyn *r = scr_dyn_call(cmp, argv, 2, "comparefn");
    if (!r) { *failed = true; return 0; }
    double v = r->kind == SCR_DYN_NUM ? r->v.num : r->kind == SCR_DYN_BOOL ? (r->v.b ? 1 : 0) : 0;
    scr_dyn_release(r);
    return v < 0 ? -1 : v > 0 ? 1 : 0;
  }
  /* SortCompare's default: ToString(x) THEN ToString(y). x's throw means
   * y's toString never runs — it is user code Node does not execute. */
  ScrStr *xs = dyn_sort_str(x);
  if (scr_exc_pending()) { scr_str_release(xs); *failed = true; return 0; }
  ScrStr *ys = dyn_sort_str(y);
  if (scr_exc_pending()) { scr_str_release(xs); scr_str_release(ys); *failed = true; return 0; }
  int c = scr_str_cmp(xs, ys);
  scr_str_release(xs);
  scr_str_release(ys);
  return c < 0 ? -1 : c > 0 ? 1 : 0;
}
/* Merge sort work[lo, hi) stably (ties keep first-seen order — `<=`
 * takes the left run's element). False when a comparator threw. */
static bool dyn_arr_sort_range(ScrDyn **work, ScrDyn **tmp, size_t lo, size_t hi, ScrDyn *cmp) {
  if (hi - lo < 2) return true;
  size_t mid = lo + (hi - lo) / 2;
  if (!dyn_arr_sort_range(work, tmp, lo, mid, cmp)) return false;
  if (!dyn_arr_sort_range(work, tmp, mid, hi, cmp)) return false;
  size_t i = lo, j = mid, k = lo;
  bool failed = false;
  while (i < mid && j < hi) {
    int c = dyn_sort_compare(work[i], work[j], cmp, &failed);
    if (failed) return false;
    tmp[k++] = c <= 0 ? work[i++] : work[j++];
  }
  while (i < mid) tmp[k++] = work[i++];
  while (j < hi) tmp[k++] = work[j++];
  memcpy(work + lo, tmp + lo, (hi - lo) * sizeof(ScrDyn *));
  return true;
}
static bool dyn_arr_sort(ScrDyn *recv, ScrDyn *cmp) {
  size_t len = recv->v.arr.len;
  ScrDyn **buf = (ScrDyn **)malloc(2 * len * sizeof(ScrDyn *));
  if (!buf) return true; /* OOM: answer the array unsorted over crashing */
  ScrDyn **work = buf, **tmp = buf + len;
  for (size_t i = 0; i < len; i++) work[i] = scr_dyn_retain(recv->v.arr.items[i]);
  bool ok = dyn_arr_sort_range(work, tmp, 0, len, cmp);
  if (ok) {
    /* Write back into whatever the array holds NOW (a mutating comparator
     * may have replaced entries): the work list's +1 moves in, the
     * displaced entry releases. Elements beyond the current length (a
     * shrinking comparator) just release. */
    for (size_t i = 0; i < len; i++) {
      if (i < recv->v.arr.len) {
        ScrDyn *old = recv->v.arr.items[i];
        recv->v.arr.items[i] = work[i];
        scr_dyn_release(old);
      } else {
        scr_dyn_release(work[i]);
      }
    }
  } else {
    for (size_t i = 0; i < len; i++) scr_dyn_release(work[i]);
  }
  free(buf);
  return ok;
}

/* ── Annex B B.2.2: the String.prototype HTML wrappers ─────────────────
 *
 * Thirteen names (sub, sup, big, small, bold, link, ...) that are ONE
 * operation, CreateHTML(S, tag, attribute, value):
 *
 *   "<" tag [ " " attr "=\"" ToString(value), each '"' -> &quot; "\"" ]
 *   ">" S "</" tag ">"
 *
 * The `"` substitution is the ONLY escaping the spec performs — the
 * receiver and the tag go in verbatim, `<` and `&` included — and a
 * missing argument stringifies as "undefined" like any other ToString.
 *
 * They are here because their NAMES are ordinary. `sub` is
 * Long.prototype.sub in every 64-bit integer library; `link`, `big`,
 * `fixed` and `bold` collide just as easily. The dispatch has to answer
 * for a dyn STRING receiver before the compiler can let those names
 * through to the prototype-chain call every non-string receiver wants
 * (DYN_DISPATCH_METHODS, lower-calls.ts). */
typedef struct { const char *name, *tag, *attr; } ScrHtmlWrap;

static const ScrHtmlWrap SCR_STR_HTML[] = {
  { "anchor", "a", "name" },      { "big", "big", NULL },
  { "blink", "blink", NULL },     { "bold", "b", NULL },
  { "fixed", "tt", NULL },        { "fontcolor", "font", "color" },
  { "fontsize", "font", "size" }, { "italics", "i", NULL },
  { "link", "a", "href" },        { "small", "small", NULL },
  { "strike", "strike", NULL },   { "sub", "sub", NULL },
  { "sup", "sup", NULL },         { NULL, NULL, NULL },
};

static const ScrHtmlWrap *dyn_str_html_wrap(const char *m) {
  for (size_t i = 0; SCR_STR_HTML[i].name; i++) {
    if (strcmp(m, SCR_STR_HTML[i].name) == 0) return &SCR_STR_HTML[i];
  }
  return NULL;
}

static ScrDyn *dyn_str_create_html(const ScrStr *s, const ScrHtmlWrap *w,
                                   ScrDyn *const *args, size_t argc) {
  ScrStr *v = NULL;
  if (w->attr) {
    /* ToString(value) runs FIRST and can throw (a user toString on a dyn
     * object argument) — the spec's order, and the loud path here. A
     * MISSING argument is undefined, which stringifies to "undefined"
     * exactly as Node's `"x".fontcolor()` does. */
    v = scr_dyn_string_coerce_js(argc > 0 ? args[0] : scr_dyn_undefined());
    if (v == NULL) return NULL; /* a throwing toString stays pending */
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_putc(&b, '<');
  scr_jb_puts(&b, w->tag);
  if (w->attr) {
    scr_jb_putc(&b, ' ');
    scr_jb_puts(&b, w->attr);
    scr_jb_puts(&b, "=\"");
    for (size_t i = 0; i < v->len; i++) {
      if (v->data[i] == '"') scr_jb_puts(&b, "&quot;");
      else scr_jb_putc(&b, v->data[i]);
    }
    scr_jb_putc(&b, '"');
    scr_str_release(v);
  }
  scr_jb_putc(&b, '>');
  scr_jb_write(&b, s->data, s->len);
  scr_jb_puts(&b, "</");
  scr_jb_puts(&b, w->tag);
  scr_jb_putc(&b, '>');
  ScrStr *out = scr_jb_finish(&b);
  ScrDyn *r = scr_dyn_new_str(out); /* retains */
  scr_str_release(out);
  return r;
}

/* Object.prototype's METHODS — the ones every dyn kind inherits, reached
 * only after the receiver's own/prototype lookup has found nothing (JS
 * looks up the chain, so an OBJ that stores its own `hasOwnProperty`
 * shadows this and a null-prototype dictionary never reaches it at all).
 *
 * It replaces `dyn_throw_not_fn` at the END of every kind arm rather than
 * being tested at the top: that ordering IS the prototype chain this
 * runtime does not otherwise model, and putting it first would let
 * Object.prototype beat an own member, which is backwards.
 *
 * hasOwnProperty is scr_dyn_has_own — the SAME body Object.hasOwn(o, k)
 * takes. The two spellings are one question and answered from one place;
 * protobufjs writes both (`util.isset` uses the method form,
 * `Object.hasOwn` the static), and they must not disagree. */
/* toLocaleString(locales, options) on a checked-dynamic value (scr_nf.c is linked whenever dynamic dispatch can name
 * toLocaleString, and reaches here through scr_nf_hook_*): a number or bigint formats through Intl.NumberFormat, a
 * string or boolean is its own text, null and undefined are "" INSIDE an array, a Date answers its formatter, and an
 * array joins its elements' answers with ",". Everything else is ToString. NULL with the exception pending. */
static ScrStr *dyn_locale_str(const ScrDyn *v, int depth, const ScrDyn *locales, const ScrDyn *opts) {
  if (depth > 64) { scr_throw_error_msg(SCR_ERR_RANGE, "Maximum call stack size exceeded", 32); return NULL; }
  switch (v->kind) {
    case SCR_DYN_NULL:
    case SCR_DYN_UNDEF:
      return scr_str_new("", 0);
    case SCR_DYN_NUM:
    case SCR_DYN_BIG:
      if (scr_nf_hook_dyn == NULL) {
        if (v->kind == SCR_DYN_NUM) return scr_intl_num_format_en_us(v->v.num);
        return scr_dyn_string_coerce_js(v);
      }
      return scr_nf_hook_dyn(v, locales, opts);
    case SCR_DYN_ARR: {
      size_t cap = 64, len = 0;
      char *buf = (char *)malloc(cap);
      if (!buf) scr_trap("scriptc: out of memory\n");
      for (size_t i = 0; i < v->v.arr.len; i++) {
        ScrStr *e = dyn_locale_str(v->v.arr.items[i], depth + 1, locales, opts);
        if (e == NULL) { free(buf); return NULL; }
        while (len + e->len + 2 > cap) { cap *= 2; buf = (char *)realloc(buf, cap); if (!buf) scr_trap("scriptc: out of memory\n"); }
        if (i) buf[len++] = ',';
        memcpy(buf + len, e->data, e->len);
        len += e->len;
        scr_str_release(e);
      }
      ScrStr *r = scr_str_new(buf, len);
      free(buf);
      return r;
    }
    case SCR_DYN_BYTES: {
      /* %TypedArray%.prototype.toLocaleString: the elements' own answers
       * joined with ",", exactly the array's. A DataView has none of its
       * own (Object.prototype's runs toString). */
      if (v->v.bytes->flavor == SCR_BF_DATAVIEW) return scr_dyn_string_coerce_js(v);
      ScrJsonBuf jb;
      scr_jb_init(&jb);
      for (size_t i = 0; i < v->v.bytes->len; i++) {
        if (i) scr_jb_putc(&jb, ',');
        ScrDyn *n = scr_dyn_new_num((double)v->v.bytes->data[i]);
        ScrStr *e = dyn_locale_str(n, depth + 1, locales, opts);
        scr_dyn_release(n);
        if (e == NULL) {
          ScrStr *drop = scr_jb_finish(&jb);
          scr_str_release(drop);
          return NULL;
        }
        scr_jb_write(&jb, e->data, e->len);
        scr_str_release(e);
      }
      return scr_jb_finish(&jb);
    }
    case SCR_DYN_HANDLE:
      if (v->v.handle.tag == SCR_DYNH_DATE) {
        const ScrDynHandleOps *ops = scr_dyn_handle_ops_of(v);
        ScrDyn *r = ops->invoke(v->v.handle.ptr, (ScrDyn *)v, "toLocaleString", NULL, 0, "toLocaleString");
        if (r == NULL) return NULL;
        ScrStr *s = r->kind == SCR_DYN_STR ? scr_str_retain(r->v.str) : scr_str_new("", 0);
        scr_dyn_release(r);
        return s;
      }
      return scr_dyn_string_coerce_js(v);
    default:
      return scr_dyn_string_coerce_js(v);
  }
}

/* Are these toLocaleString arguments the default locale and no options? (all that is answerable without the
 * number formatter) */
static bool dyn_locale_args_default(ScrDyn *const *args, size_t argc) {
  if (argc >= 2 && args[1]->kind != SCR_DYN_UNDEF) return false;
  if (argc == 0 || args[0]->kind == SCR_DYN_UNDEF) return true;
  const ScrDyn *l = args[0];
  if (l->kind != SCR_DYN_STR) return false;
  return (l->v.str->len == 5 && memcmp(l->v.str->data, "en-US", 5) == 0) || (l->v.str->len == 2 && memcmp(l->v.str->data, "en", 2) == 0);
}
static bool dyn_locale_answerable(ScrDyn *const *args, size_t argc) {
  return scr_nf_hook_dyn != NULL || dyn_locale_args_default(args, argc);
}

static ScrDyn *dyn_object_proto_method(ScrDyn *recv, const char *method,
                                       ScrDyn *const *args, size_t argc, const char *what) {
  if (dyn_name_is(method, "hasOwnProperty")) {
    /* ToPropertyKey: a missing argument is the STRING "undefined", which
     * is a real key ({ undefined: 1 }.hasOwnProperty() is true in Node). */
    ScrStr *k = argc >= 1 ? scr_dyn_string_coerce(args[0]) : scr_str_new("undefined", 9);
    if (scr_exc_pending()) { scr_str_release(k); return NULL; }
    bool r = scr_dyn_has_own(recv, k);
    scr_str_release(k);
    if (scr_exc_pending()) return NULL;
    return scr_dyn_new_bool(r);
  }
  /* Object.prototype.valueOf: the receiver itself. No kind this runtime
   * models overrides it observably -- objects, arrays and functions
   * answer themselves, and a primitive string/number/boolean answers the
   * primitive, which is the same retained cell here. One body, reached
   * from every arm's fall-through, for the reason hasOwnProperty is one
   * body: two spellings of one question must not become two answers. */
  if (dyn_name_is(method, "valueOf")) {
    return scr_dyn_retain(recv);
  }
  /* Object.prototype.toLocaleString: Invoke(this, "toString"). The Number and Array arms fence their own
   * (locale formatting is not modeled there); a string, boolean or object answers here, and a Date handle
   * answers in its own ops (scr_date_dyn.c). */
  if (dyn_name_is(method, "toLocaleString")) {
    ScrStr *s = scr_dyn_string_coerce_js(recv);
    if (s == NULL) return NULL;
    ScrDyn *r = scr_dyn_new_str(s);
    scr_str_release(s);
    return r;
  }
  dyn_throw_not_fn(what);
  return NULL;
}

/* Names each prototype declares BEYOND what's implemented here — these
 * fence loudly instead of mis-answering "is not a function". */
static bool dyn_str_proto_unimpl(const char *m) {
  static const char *names[] = { "split", "replace", "replaceAll", "match",
    "matchAll", "search", "localeCompare", "normalize", "codePointAt",
    "toLocaleLowerCase", "toLocaleUpperCase", "isWellFormed", "toWellFormed",
    /* Behind libregexp -- see the note in the STR arm. */
    "toUpperCase", "toLowerCase", NULL };
  for (size_t i = 0; names[i]; i++) if (dyn_name_is(m, names[i])) return true;
  return false;
}

/* Number/Boolean.prototype names the DOT spelling also refuses on a dyn
 * receiver -- they sit in the frontend's DYN_PROTO_METHOD_NAMES and take
 * its by-name decline. Fencing them here keeps the two spellings saying
 * the same thing about the same name. */
static bool dyn_num_proto_unimpl(const char *m) {
  static const char *names[] = { "toFixed", "toExponential", "toPrecision", NULL };
  for (size_t i = 0; names[i]; i++) if (dyn_name_is(m, names[i])) return true;
  return false;
}

static bool dyn_arr_proto_unimpl(const char *m) {
  /* `fill` and `copyWithin` moved OUT of this list and into the ARR arm's
   * `impl` list when the ARR arm started answering them -- the same move
   * `toString` made, and for the same reason: a name that is IMPLEMENTED
   * must not sit in a list called *_unimpl. Keeping them here made two of
   * the static-copy guard's nine arms unreachable, because this predicate
   * throws "not supported" before that guard can fire. */
  static const char *names[] = {
    "keys", "values", "entries", NULL };
  for (size_t i = 0; names[i]; i++) if (dyn_name_is(m, names[i])) return true;
  return false;
}

/* `recv[k](...)`: the ELEMENT spelling of the dispatch below.
 *
 * JS's o[k](...) is Get(o, ToPropertyKey(k)) followed by Call with `o` as
 * the receiver -- the SAME two steps as o.m(...), differing only in where
 * the name comes from. The lowering used to answer the element spelling
 * with a keyed READ plus a plain scr_dyn_call, which drops the receiver:
 * the member then ran under whatever the ambient-receiver window happened
 * to hold, so a body that says `this.lo` read the CALLER's `this` and
 * answered undefined -- silently, with no diagnostic. protobufjs's
 * `p.call(this)[t](!0)` is that shape, which is why a compiled zapo
 * decoded every 64-bit field to 0 (toLong: `0|undefined`) or NaN
 * (toNumber: `undefined + 4294967296*undefined`).
 *
 * The key arrives already reduced to a string by the same rule the keyed
 * read uses, so the two spellings cannot disagree about which member they
 * name. Borrows all three, returns +1, may throw. */
ScrDyn *scr_dyn_invoke_key(ScrDyn *recv, const ScrStr *key, ScrDyn *const *args, size_t argc, const char *what) {
  /* `fs[0](x)` over an array: the key is an INDEX, which is not a named
   * member of the array (indices live in the item vector, never in the
   * name tables the name-keyed dispatch consults), so it was answered
   * "fs[0] is not a function" for an element that is one. The element is
   * read like the keyed read reads it and called with the array as `this`,
   * which is `o[k](...)` of the spec. */
  if (recv->kind == SCR_DYN_ARR && key->len > 0 && key->len <= 15) {
    size_t idx = 0;
    bool canon = key->data[0] != '0' || key->len == 1;
    for (size_t i = 0; canon && i < key->len; i++) {
      char ch = key->data[i];
      if (ch < '0' || ch > '9') canon = false;
      else idx = idx * 10 + (size_t)(ch - '0');
    }
    if (canon) {
      if (recv->static_copy) scr_dyn_view_sync_deep(recv);
      if (idx < recv->v.arr.len) {
        ScrDyn *fv = recv->v.arr.items[idx];
        if (fv != NULL && (fv->kind == SCR_DYN_FUNC ||
                           (fv->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(fv, "function")))) {
          scr_dyn_retain(fv);
          scr_dyn_this_push_dyn(recv);
          ScrDyn *r = scr_dyn_call(fv, args, argc, what);
          scr_dyn_this_pop();
          scr_dyn_release(fv);
          return r;
        }
      }
      dyn_throw_not_fn(what);
      return NULL;
    }
  }
  /* ScrStr is always NUL-terminated (scr_str_new), so ->data is a valid
   * C string for the name-keyed dispatch. */
  return scr_dyn_invoke(recv, key->data, args, argc, what);
}

/* ── the keyed/dot READ's half of the dispatch below ──────────────────
 *
 * `o.m()` and `o[k]()` reach the arms below and answer. `typeof o.m` and
 * `typeof o[k]` did NOT: the read walked own members and the STORED
 * prototype chain and then answered the undefined singleton, because
 * Object.prototype's and every primitive prototype's methods exist in
 * this runtime only as C branches inside this file — reachable from the
 * CALL and from nowhere else.
 *
 * So the same member on the same object was a function when called and
 * `undefined` when read. Node says `function` to both. Silent, no
 * diagnostic, invisible to the trap census, and the exact shape that
 * makes a program feature-detecting with `if (o[k])` or
 * `typeof o[k] === "function"` take the wrong branch: protobufjs writes
 * both spellings.
 *
 * dyn_kind_knows is the READ's view of the arms below, and the contract
 * between them is narrow and checkable: a name is listed here IF AND
 * ONLY IF the arm for that kind either implements it or fences it
 * LOUDLY by name. Names the arm would answer with Node's
 * is-not-a-function stay out, so the read keeps saying `undefined`
 * exactly where the call keeps saying "is not a function" — the two
 * spellings agree about every name either way, which is the whole point.
 * Corpus 4242 walks this list row by row and asserts that agreement, so
 * a name added to an arm without being added here (or the reverse) is a
 * red test rather than a new silent divergence. */
/* ── DataView on a dynamic receiver ────────────────────────────────────
 *
 * A DataView rides SCR_DYN_BYTES with its own flavor (SCR_BF_DATAVIEW),
 * and until this arm the BYTES dispatch below answered it with the
 * typed-array names only: `x.getUint8(0)` through an untyped parameter
 * was Node's "x.getUint8 is not a function" for a method the object
 * plainly has — a clean build, a runtime TypeError where Node answers, no
 * diagnostic. (The reverse leak was real too: a DataView answered
 * `at` / `slice` / `subarray`, which it does not have.)
 *
 * The twenty-six accessors are ONE table, and each runs the SAME runtime
 * entry points the static lowering reaches (scr_dataview_get / _set), so
 * a dynamic and a static spelling of one call cannot answer differently.
 * What differs is only the COERCION, which the static side did at compile
 * time and this side must do at run time, in the spec's order:
 *
 *   get<T>(byteOffset, littleEndian)
 *     ToIndex(byteOffset), ToBoolean(littleEndian), bounds -> RangeError
 *   set<T>(byteOffset, value, littleEndian)
 *     ToIndex(byteOffset), ToNumber (or ToBigInt) of value, ToBoolean,
 *     bounds -> RangeError
 *
 * ToIndex runs BEFORE the value's coercion, so an invalid offset is
 * reported even when the value would have thrown first. The bounds RangeError
 * (Node's one constant message) comes from the entry points themselves.
 *
 * The BigInt pair is the one place the always-linked core and this unit
 * cannot name the answer's constructor: a bigint box is made by the gated
 * unit (scr_bigint.c), reached through scr_dyn_big_from_bits_fn, which
 * the emitted main() installs exactly when that unit links. The compiler
 * links it for any program that can reach these two names
 * (moduleUsesBigInt: a dynInvoke of getBigInt64/getBigUint64, or a
 * COMPUTED method key, which could spell one). A value that is stored
 * rides scr_dyn_big_ops()->low_u64 instead, and needs no hook: a bigint
 * box can only exist once the unit is linked. */
typedef struct {
  const char *name;
  ScrDataViewGet kind;
  bool is_set;
} DynDvMethod;

static const DynDvMethod DYN_DV_METHODS[] = {
  { "getInt8", SCR_DV_I8, false },       { "setInt8", SCR_DV_I8, true },
  { "getUint8", SCR_DV_U8, false },      { "setUint8", SCR_DV_U8, true },
  { "getInt16", SCR_DV_I16, false },     { "setInt16", SCR_DV_I16, true },
  { "getUint16", SCR_DV_U16, false },    { "setUint16", SCR_DV_U16, true },
  { "getInt32", SCR_DV_I32, false },     { "setInt32", SCR_DV_I32, true },
  { "getUint32", SCR_DV_U32, false },    { "setUint32", SCR_DV_U32, true },
  { "getFloat16", SCR_DV_F16, false },   { "setFloat16", SCR_DV_F16, true },
  { "getFloat32", SCR_DV_F32, false },   { "setFloat32", SCR_DV_F32, true },
  { "getFloat64", SCR_DV_F64, false },   { "setFloat64", SCR_DV_F64, true },
  { "getBigInt64", SCR_DV_BIGI64, false }, { "setBigInt64", SCR_DV_BIGI64, true },
  { "getBigUint64", SCR_DV_BIGU64, false }, { "setBigUint64", SCR_DV_BIGU64, true },
  { NULL, SCR_DV_U8, false },
};

static const DynDvMethod *dyn_dv_lookup(const char *m) {
  for (size_t i = 0; DYN_DV_METHODS[i].name; i++) {
    if (dyn_name_is(m, DYN_DV_METHODS[i].name)) return &DYN_DV_METHODS[i];
  }
  return NULL;
}

/* ToIndex(ToNumber(arg)): the offset every accessor starts with. NaN is 0
 * (so `getUint8()` reads byte 0), the fraction truncates, and a negative or
 * past-2^53-1 value is the accessors' one RangeError. false with the
 * exception pending. */
static bool dyn_dv_to_index(const ScrDyn *a, double *out) {
  double n = scr_dyn_to_number(a);
  if (scr_exc_pending()) return false;
  n = (n != n) ? 0 : trunc(n);
  if (!(n >= 0) || n > 9007199254740991.0) {
    static const char msg[] = "Offset is outside the bounds of the DataView";
    scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
    return false;
  }
  *out = n;
  return true;
}

/* Is `c` (a whole UTF-8 sequence starting at p) a StrWhiteSpaceChar?
 * Returns its byte length, 0 when it is not whitespace. */
static size_t dyn_dv_ws_len(const unsigned char *p, size_t left) {
  if (left >= 1 && (p[0] == ' ' || (p[0] >= 9 && p[0] <= 13))) return 1;
  if (left >= 2 && p[0] == 0xC2 && p[1] == 0xA0) return 2;                       /* NBSP */
  if (left >= 3 && p[0] == 0xEF && p[1] == 0xBB && p[2] == 0xBF) return 3;       /* BOM */
  if (left >= 3 && p[0] == 0xE1 && p[1] == 0x9A && p[2] == 0x80) return 3;       /* U+1680 */
  if (left >= 3 && p[0] == 0xE2 && p[1] == 0x80 &&
      ((p[2] >= 0x80 && p[2] <= 0x8A) || p[2] == 0xA8 || p[2] == 0xA9 || p[2] == 0xAF)) return 3;
  if (left >= 3 && p[0] == 0xE2 && p[1] == 0x81 && p[2] == 0x9F) return 3;       /* U+205F */
  if (left >= 3 && p[0] == 0xE3 && p[1] == 0x80 && p[2] == 0x80) return 3;       /* U+3000 */
  return 0;
}

/* ToBigInt(v) reduced to the 64 bits setBigInt64/setBigUint64 store (the
 * value modulo 2^64 — the two differ only in how the bits read back). The
 * spec's ToBigInt is NOT BigInt(): a Number is a TypeError, and only a
 * bigint, a boolean and a string (StringToBigInt) convert. A string is
 * parsed here straight into the modulus, which needs no bigint arithmetic
 * at all. false with the exception pending. */
static bool dyn_dv_to_bigint_bits(const ScrDyn *v, uint64_t *bits, int depth) {
  switch (v->kind) {
  case SCR_DYN_BIG:
    *bits = scr_dyn_big_ops()->low_u64(v->v.big);
    return true;
  case SCR_DYN_BOOL:
    *bits = v->v.b ? 1u : 0u;
    return true;
  case SCR_DYN_STR: {
    const unsigned char *p = (const unsigned char *)v->v.str->data;
    size_t n = v->v.str->len;
    size_t w;
    while (n > 0 && (w = dyn_dv_ws_len(p, n)) != 0) { p += w; n -= w; }
    { /* trim the right edge: n becomes the end of the last non-white byte */
      size_t keep = 0, k = 0;
      while (k < n) {
        size_t cw = dyn_dv_ws_len(p + k, n - k);
        if (cw == 0) { k++; keep = k; } else { k += cw; }
      }
      n = keep;
    }
    uint64_t acc = 0;
    bool neg = false, ok = true;
    unsigned base = 10;
    size_t i = 0;
    if (n >= 2 && p[0] == '0' && (p[1] == 'x' || p[1] == 'X')) { base = 16; i = 2; }
    else if (n >= 2 && p[0] == '0' && (p[1] == 'o' || p[1] == 'O')) { base = 8; i = 2; }
    else if (n >= 2 && p[0] == '0' && (p[1] == 'b' || p[1] == 'B')) { base = 2; i = 2; }
    else if (n >= 1 && (p[0] == '+' || p[0] == '-')) { neg = p[0] == '-'; i = 1; }
    if (n == 0) { *bits = 0; return true; } /* the empty string is 0n */
    if (i >= n) ok = false;               /* a bare sign or prefix */
    for (; ok && i < n; i++) {
      unsigned dgt;
      if (p[i] >= '0' && p[i] <= '9') dgt = (unsigned)(p[i] - '0');
      else if (p[i] >= 'a' && p[i] <= 'f') dgt = (unsigned)(p[i] - 'a') + 10;
      else if (p[i] >= 'A' && p[i] <= 'F') dgt = (unsigned)(p[i] - 'A') + 10;
      else { ok = false; break; }
      if (dgt >= base) { ok = false; break; }
      acc = acc * base + dgt; /* wraps modulo 2^64 — the modulus */
    }
    if (!ok) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "Cannot convert ");
      scr_jb_write(&b, v->v.str->data, v->v.str->len);
      scr_jb_puts(&b, " to a BigInt");
      scr_throw_error(SCR_ERR_SYNTAX, scr_jb_finish(&b));
      return false;
    }
    *bits = neg ? (uint64_t)(~acc + 1u) : acc;
    return true;
  }
  case SCR_DYN_NUM:
  case SCR_DYN_UNDEF:
  case SCR_DYN_NULL: {
    ScrStr *s = scr_dyn_string_coerce(v);
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Cannot convert ");
    scr_jb_write(&b, s->data, s->len);
    scr_jb_puts(&b, " to a BigInt");
    scr_str_release(s);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return false;
  }
  default: {
    /* An object: ToPrimitive (number hint) first, then the primitive's own
     * conversion. One level only — ToPrimitive never answers an object. */
    if (depth > 0) break;
    ScrDyn *p = scr_dyn_to_primitive(v, SCR_TOPRIM_NUMBER);
    if (p == NULL) return false;
    const bool prim = p->kind == SCR_DYN_UNDEF || p->kind == SCR_DYN_NULL ||
                      p->kind == SCR_DYN_BOOL || p->kind == SCR_DYN_NUM ||
                      p->kind == SCR_DYN_STR || p->kind == SCR_DYN_BIG;
    bool r = prim ? dyn_dv_to_bigint_bits(p, bits, depth + 1) : false;
    if (!r && !scr_exc_pending()) {
      scr_dyn_check_fail(NULL, "a BigInt", p);
    }
    scr_dyn_release(p);
    return r;
  }
  }
  scr_dyn_check_fail(NULL, "a BigInt", v);
  return false;
}

static ScrDyn *dyn_dataview_invoke(ScrDyn *recv, const DynDvMethod *m, ScrDyn *const *args,
                                   size_t argc) {
  ScrBytes *b = recv->v.bytes;
  ScrDyn *undef = scr_dyn_undefined();
  double off;
  if (!dyn_dv_to_index(argc > 0 ? args[0] : undef, &off)) return NULL;
  const bool big = m->kind == SCR_DV_BIGI64 || m->kind == SCR_DV_BIGU64;
  if (!m->is_set) {
    const bool le = scr_dyn_truthy(argc > 1 ? args[1] : undef);
    if (big) {
      uint64_t bits;
      if (!scr_dataview_get_bits64(b, off, le, &bits)) return NULL;
      if (scr_dyn_big_from_bits_fn == NULL) {
        /* Unreachable when the compiler's link gate held: it links the
         * bigint unit (and the emitted main installs this) for every
         * program that can name these two methods. Kept as a real answer
         * rather than an assert so a gate that ever misses fails loudly
         * here instead of reading as a wrong number. */
        static const char msg[] =
            "internal error: DataView.getBigInt64/getBigUint64 on a dynamic receiver reached a binary "
            "without the bigint unit";
        scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
        return NULL;
      }
      return scr_dyn_big_from_bits_fn(bits, m->kind == SCR_DV_BIGI64);
    }
    double r = scr_dataview_get(b, off, m->kind, le);
    if (scr_exc_pending()) return NULL;
    return scr_dyn_new_num(r);
  }
  const ScrDyn *val = argc > 1 ? args[1] : undef;
  if (big) {
    uint64_t bits;
    if (!dyn_dv_to_bigint_bits(val, &bits, 0)) return NULL;
    const bool le = scr_dyn_truthy(argc > 2 ? args[2] : undef);
    if (!scr_dataview_set_bits64(b, off, bits, le)) return NULL;
    return scr_dyn_retain(undef);
  }
  double v = scr_dyn_to_number(val);
  if (scr_exc_pending()) return NULL;
  const bool le = scr_dyn_truthy(argc > 2 ? args[2] : undef);
  scr_dataview_set(b, off, v, m->kind, le);
  if (scr_exc_pending()) return NULL;
  return scr_dyn_retain(undef);
}

static bool dyn_name_in(const char *m, const char *const *names) {
  for (size_t i = 0; names[i]; i++) if (dyn_name_is(m, names[i])) return true;
  return false;
}

/* Object.prototype's methods this runtime ANSWERS (dyn_object_proto_method).
 * isPrototypeOf / propertyIsEnumerable / toLocaleString are Node's and are
 * NOT here: the call answers them with is-not-a-function, so a read that
 * claimed `function` would create a fresh disagreement in the other
 * direction. They are priced, not guessed at. */
static bool dyn_objproto_knows(const char *m) {
  static const char *const names[] = { "hasOwnProperty", "valueOf", "toLocaleString", NULL };
  return dyn_name_in(m, names);
}

static bool dyn_kind_knows(const ScrDyn *recv, const char *m) {
  switch (recv->kind) {
    case SCR_DYN_STR: {
      static const char *const impl[] = { "at", "charAt", "charCodeAt", "concat",
        "endsWith", "includes", "indexOf", "lastIndexOf", "padEnd", "padStart",
        "repeat", "slice", "startsWith", "substring", "substr", "toString", "trim",
        "trimEnd", "trimStart", NULL };
      return dyn_name_in(m, impl) || dyn_str_proto_unimpl(m) || dyn_objproto_knows(m);
    }
    case SCR_DYN_ARR: {
      /* `toString` moved OUT of dyn_arr_proto_unimpl and into this list
       * when the ARR arm started answering it: the two lists feed this
       * predicate with `||`, so dyn_kind_knows is unchanged either way and
       * the READ keeps saying `function` — but a name that is IMPLEMENTED
       * must not sit in a list called *_unimpl, and the estado-eight report
       * that discovered the arm had told the next block to delete it as
       * dead text. Deleting it while it was the only thing making
       * dyn_kind_knows true would have made `typeof a[k]` answer
       * `undefined` while `a[k]()` answered "1,2,3" -- the very split this
       * predicate exists to prevent, reintroduced by a tidy-up. */
      static const char *const impl[] = { "at", "concat", "copyWithin", "every",
        "fill", "filter",
        "find", "findIndex", "findLast", "findLastIndex", "flatMap", "forEach", "includes", "indexOf",
        "join", "lastIndexOf", "map", "pop", "push", "reduce", "reduceRight", "reverse", "shift",
        "slice", "some", "sort", "splice", "toReversed", "toSorted", "toSpliced", "toString", "unshift",
        "flat", "with", NULL };
      return dyn_name_in(m, impl) || dyn_arr_proto_unimpl(m) || dyn_objproto_knows(m);
    }
    case SCR_DYN_BYTES:
      /* A DataView's surface is its accessor table plus toString, and the
       * read must agree with the call arm above name for name. */
      if (recv->v.bytes->flavor == SCR_BF_DATAVIEW) {
        return dyn_dv_lookup(m) != NULL || dyn_name_is(m, "toString") || dyn_objproto_knows(m);
      }
      /* ONE name, and only because this branch flipped it. The BYTES call
       * arm (scr_dyn_bytes_method) answers `toString` now where it used to
       * fence loudly, so leaving BYTES in the default:false arm below would
       * make `typeof b[k]` answer `undefined` while `b[k]()` answered "hi"
       * -- measured, on a Buffer and on a plain Uint8Array, before this
       * line was written. The REST of the BYTES surface (at/slice/subarray/
       * set, and the loud fences in scr_dyn_bytes_proto_name, which is
       * static in another unit) stays unclaimed: widening the read to a
       * table nobody measured is how the read/call split happened in the
       * first place, and it is not this branch's name to claim. */
      {
        /* The typed-array surface, whole: every name scr_dyn_bytes_method
         * answers, plus the four it fences LOUDLY by name (the iterator
         * trio and toLocaleString) — the rule this list lives by. The read
         * and the call agree name for name, so `typeof u8.fill` is
         * "function" exactly where `u8.fill(0)` runs. */
        static const char *const impl[] = { "at", "copyWithin", "every", "fill", "filter",
          "find", "findIndex", "findLast", "findLastIndex", "forEach", "includes", "indexOf",
          "join", "lastIndexOf", "map", "reduce", "reduceRight", "reverse", "set", "slice",
          "some", "sort", "subarray", "toReversed", "toSorted", "toString", "with",
          "keys", "values", "entries", "toLocaleString", NULL };
        return dyn_name_in(m, impl) || dyn_objproto_knows(m);
      }
    case SCR_DYN_NUM:
      return dyn_name_is(m, "toString") || dyn_num_proto_unimpl(m) || dyn_objproto_knows(m);
    case SCR_DYN_BOOL:
      /* toFixed and its siblings are Number.prototype's: a boolean has none. */
      return dyn_name_is(m, "toString") || dyn_objproto_knows(m);
    case SCR_DYN_FUNC: {
      /* `bind` and `toString` fence loudly; apply/call run. A FUNC box's
       * OWN properties are answered by the read's own scr_dyn_fn_get arm
       * before this is consulted, so nothing here can shadow one. */
      static const char *const impl[] = { "apply", "bind", "call", "toString", NULL };
      return dyn_name_in(m, impl) || dyn_objproto_knows(m);
    }
    case SCR_DYN_OBJ:
      /* A null-prototype dictionary inherits NOTHING — Object.create(null)
       * .hasOwnProperty is `undefined` in Node, and the call arm already
       * refuses it for the same reason. The OWN/chain walk has already
       * missed by the time this is asked (the caller checks), so this is
       * only ever Object.prototype's set. */
      return !recv->null_proto && dyn_objproto_knows(m);
    case SCR_DYN_PROMISE:
      /* THE ARM 4242's comment said could not be exercised. It can now: a
       * DOT read of `then` off an `unknown` (`typeof (v as { then?:
       * unknown }).then === "function"` — the thenable feature-detect
       * every library writes, and the one `PromiseLike` exists for) does
       * reach this tail with a PROMISE receiver, and before this line it
       * answered `undefined` while the call arm below ran `then` and the
       * await machinery settled it. Measured, on this branch AND on
       * 3830a113 with the `value is Promise<T>` spelling that needs no
       * new type mapping at all: Node says `function`, the read said
       * `undefined`, exit 0, no diagnostic — the exact read/call split
       * the ARR and BYTES comments above exist to prevent, live.
       *
       * The names are the ones the call arm implements (scr_dyn_invoke's
       * PROMISE branch: then/catch/finally ride scr_dyn_promise_then),
       * plus Object.prototype's, which a promise inherits like any
       * object. Nothing else: every other Promise.prototype name is
       * `then`-adjacent sugar JS does not have either, so `undefined` IS
       * the JS answer for those. */
      {
        static const char *const impl[] = { "then", "catch", "finally", NULL };
        return dyn_name_in(m, impl) || dyn_objproto_knows(m);
      }
    case SCR_DYN_ARRBUF: {
      /* slice runs, resize throws Node's TypeError, transfer refuses by
       * name — every one answers `function` on the read. */
      static const char *const abm[] = { "slice", "resize", "transfer", "transferToFixedLength",
                                         "toString", NULL };
      return dyn_name_in(m, abm) || dyn_objproto_knows(m);
    }
    case SCR_DYN_HANDLE:
      if (recv->v.handle.tag == SCR_DYNH_REGEX) {
        /* RegExp.prototype: the three methods the ops answer (exec, test,
         * toString) and compile, which they fence loudly by name. */
        static const char *const rem[] = { "exec", "test", "toString", "compile", NULL };
        return dyn_name_in(m, rem) || dyn_objproto_knows(m);
      }
      if (recv->v.handle.tag == SCR_DYNH_TEXTCODEC) {
        /* TextEncoder: encode / encodeInto. TextDecoder: decode. Both
         * inherit Object.prototype's names; the read agrees with the ops
         * table's call arm (scr_json.c) name for name. */
        const bool enc = scr_textcodec_name(recv)[4] == 'E';
        static const char *const encm[] = { "encode", "encodeInto", "toString", "toLocaleString", NULL };
        static const char *const decm[] = { "decode", "toString", "toLocaleString", NULL };
        return dyn_name_in(m, enc ? encm : decm) || dyn_objproto_knows(m);
      }
      return false;
    default:
      /* BYTES, HANDLE, JSVAL, OBJINST, BIG and ARRBUF. Each has its own
       * arm in the emitted read (a modeled-property table, the engine, or
       * a loud fence) that answers before the tail this serves. Widening
       * the read to those kinds is a separate question with its own
       * evidence; answering it here from a table nobody measured is how
       * the read/call split happened in the first place. */
      return false;
  }
}

/* The bound intrinsic method a READ answers with. The captures are the
 * RECEIVER and the NAME, and the body is one call into the dispatch
 * below — so the value a read produces and the value a call produces are
 * computed by the same code, and cannot drift into two behaviours.
 *
 * A DIVERGENCE stated rather than hidden: Node's `o.hasOwnProperty` is
 * UNBOUND, so `const f = o.hasOwnProperty; f("a")` throws there and
 * answers here. This runtime binds, following scr_dyn_obj_member_get,
 * whose header records the same choice for the same reason: an unbound
 * native method extracted from a receiver has no `this` to run under,
 * and the shapes that extract-then-call are rarer than the shapes that
 * feature-detect. Pinned in 4242. */
static ScrDyn *dyn_bound_intrinsic_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrDyn *recv = (ScrDyn *)scr_box_get_ref(clo->caps[0]); /* +1 */
  ScrDyn *name = (ScrDyn *)scr_box_get_ref(clo->caps[1]); /* +1 */
  ScrDyn *r = scr_dyn_invoke(recv, name->v.str->data, args, argc, "a bound method");
  scr_dyn_release(recv);
  scr_dyn_release(name);
  return r;
}

/* `k in o`'s half of the same question. `in` walks the prototype chain,
 * so a name the READ now answers has to be a name `in` reports — Node
 * says true to both, and answering the read `function` while `in` still
 * said false would be a fresh disagreement in place of the one being
 * closed. One table, three callers (read, `in`, call), no drift. */
bool scr_dyn_has_intrinsic_method(const ScrDyn *recv, const char *key, size_t key_len) {
  if (recv->kind == SCR_DYN_OBJ && recv->null_proto) return false;
  if (recv->kind == SCR_DYN_PROXY) return false; /* `in` is the has trap's (or the target's) answer */
  /* A boxed class INSTANCE's members are the emitted table's, and the
   * stored walk cannot see them for exactly the reason a primitive's
   * prototype methods are invisible to it: they are not stored ON the
   * value. That is this function's whole contract -- the READ answers a
   * name, so `in` must report it -- so the table belongs here rather
   * than as a fourth arm in each emitter's ladder, where the two lanes
   * would have to spell it twice.
   *
   * BOTH kinds of row: `in` walks the prototype chain and counts
   * non-enumerable properties, so `'get' in new Box(7)` is true in Node
   * even though Object.keys reports only ['v']. Before this it answered
   * FALSE, at exit 0, with no diagnostic. */
  if (recv->kind == SCR_DYN_OBJINST) {
    if (scr_dyn_objinst_error_rooted(recv) && scr_dyn_error_member_has(recv, key, key_len)) return true;
    const ScrDynClassMember *hm = scr_dyn_objinst_member(recv, key, key_len);
    return hm != NULL && !(hm->enumerable == 4 && scr_dyn_member_hidden(hm, recv->v.inst.o));
  }
  (void)key_len; /* the remaining tests are on the NUL-terminated spelling */
  return dyn_kind_knows(recv, key);
}

/* `k in o` with a RUNTIME key (the dyn.hasKey libCall) — scr_dyn_has_key's
 * stored walk, plus the same unstored prototype methods. It lives HERE
 * rather than beside scr_dyn_has_key because scr_json.c is always linked
 * and this unit is gated: a call the other way would put the dispatch in
 * every binary that asks `k in o`. The emitters name this one, which is
 * what puts `dyn.hasKey` on the dynInvoke link switch. */
bool scr_dyn_has_key_full(const ScrDyn *v, const ScrStr *key) {
  if (scr_dyn_has_key(v, key)) return true;
  if (scr_exc_pending()) return false;
  return scr_dyn_has_intrinsic_method(v, key->data, key->len);
}

ScrDyn *scr_dyn_intrinsic_method_get(ScrDyn *recv, const ScrStr *key) {
  /* ScrStr is NUL-terminated (scr_str_new), so ->data is a C string for
   * the same name-keyed tests the dispatch makes. */
  if (!dyn_kind_knows(recv, key->data)) return NULL;
  /* An OWN or INHERITED member of the same name SHADOWS the prototype's,
   * and the caller has already read it — but `o.toString = undefined`
   * stores a member whose VALUE is undefined, which the caller cannot
   * tell from a miss. `in` can. */
  if (recv->kind == SCR_DYN_OBJ && scr_dyn_obj_key_present(recv, key->data, key->len)) return NULL;
  ScrClosure *clo = scr_closure_new((void *)dyn_bound_intrinsic_thunk, 2);
  clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[0], scr_dyn_retain(recv));
  clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  ScrDyn *nameBox = scr_dyn_new_str((ScrStr *)key); /* retains key */
  scr_box_set_ref(clo->caps[1], nameBox);           /* takes the +1 */
  return scr_dyn_new_func(clo, dyn_bound_intrinsic_thunk, 0, "()", "bound");
}

/* The keyed READ of a boxed class instance's member -- the emitted
 * sc_dyn_key_get's OBJINST arm, which before this answered the loud
 * property-read fence for a field the instance is holding.
 *
 * A DATA member reads its slot. A METHOD reads as a BOUND function box
 * minted over dyn_bound_intrinsic_thunk, i.e. over `scr_dyn_invoke`
 * itself -- so `typeof x.get`, `const m = x.get; m.call(x)` and
 * `x.get()` are ONE answer computed by ONE body and cannot drift into
 * two behaviours. That is the rule scr_dyn_intrinsic_method_get above
 * was written to keep, reused rather than restated.
 *
 * NULL with nothing pending = this class has no table, or the table has
 * no such name; the caller keeps whatever it did before. */
/* A class method read off an instance is NOT bound to it: JS hands out the
 * prototype's function, and the receiver is whatever the call supplies (`f.call(y)`,
 * `y.g = f; y.g()`), or nothing (a plain call: the TypeError a method body throws on
 * `this.x` of undefined). One immortal native function per (class table, method),
 * so `x.m === y.m` for two instances of one class. The call dispatches the ROW the
 * read found (the declaring method, never an override below it) on the receiver,
 * which must be an instance of the class the read went through or a subclass. */
typedef struct ScrObjinstMethodFn {
  ScrClosure clo; /* first: the closure the thunk is handed */
  const ScrDynClass *cls;
  const ScrDynClassMember *cm;
  struct ScrObjinstMethodFn *next;
} ScrObjinstMethodFn;

static ScrObjinstMethodFn *scr_objinst_fns = NULL;

static ScrDyn *objinst_method_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  const ScrObjinstMethodFn *w = (const ScrObjinstMethodFn *)clo;
  ScrDyn *recv = scr_dyn_this_get(); /* +1 */
  ScrDyn *r = NULL;
  if (recv->kind == SCR_DYN_OBJINST && scr_dyn_objinst_is(recv, w->cls->pre, w->cls->post)) {
    r = w->cm->call(recv->v.inst.o, args, argc, "method");
  } else {
    scr_throw_error_named(scr_str_new("TypeError", 9),
                          scr_str_new("Cannot read properties of undefined", 35));
  }
  scr_dyn_release(recv);
  return r;
}

ScrDyn *scr_dyn_objinst_member_get(ScrDyn *d, const ScrStr *key) {
  const ScrDynClassMember *cm = scr_dyn_objinst_member(d, key->data, key->len);
  if (cm == NULL) return NULL;
  if (cm->get != NULL) return cm->get(d->v.inst.o);
  const ScrDynClass *cls = scr_dyn_objinst_class_of(d);
  ScrObjinstMethodFn *w = scr_objinst_fns;
  while (w != NULL && !(w->cls == cls && w->cm == cm)) w = w->next;
  if (w == NULL) {
    w = (ScrObjinstMethodFn *)calloc(1, sizeof *w);
    if (w == NULL) {
      fputs("scriptc: out of memory\n", stderr);
      abort();
    }
    w->clo.rc = SIZE_MAX; /* immortal, like an interned top-level function */
    w->clo.fn = (void *)objinst_method_thunk;
    w->cls = cls;
    w->cm = cm;
    w->next = scr_objinst_fns;
    scr_objinst_fns = w;
  }
  /* The name is the method's own: cm->name is a static literal of the emitted
   * table, which the box never frees. */
  return scr_dyn_new_func(&w->clo, objinst_method_thunk, 0, "()", cm->name);
}

/* The tail of a boxed class instance's keyed READ, after %props and the
 * member table both missed. The instance has the members its class
 * declares and what Object.prototype gives every object; a name in neither
 * is a property Node reads as `undefined`, which is what this answers --
 * the loud ladder it replaces was a throw for a read no JavaScript program
 * considers an error (`if (x.cache)`, `x.stack || x.message`, a `missing`
 * probe through an untyped parameter).
 *
 * "In neither" is only knowable when the class's member set is KNOWN, and
 * the descriptor says when it is not: `opaque` marks a class whose table
 * skipped a member (no dyn form for its type) or that roots in a runtime
 * builtin whose members the table does not carry. For those the miss could
 * be a real member, so the old fence stays -- the one answer that is never
 * wrong. +1, or NULL with the exception pending. */
ScrDyn *scr_dyn_objinst_miss(ScrDyn *d, const ScrStr *key) {
  if (dyn_objproto_knows(key->data)) {
    /* Object.prototype's own methods read as functions, bound over the same
     * dispatch a call takes (the member-method rule above). */
    ScrClosure *clo = scr_closure_new((void *)dyn_bound_intrinsic_thunk, 2);
    clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
    scr_box_set_ref(clo->caps[0], scr_dyn_retain(d));
    clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
    ScrDyn *nameBox = scr_dyn_new_str((ScrStr *)key);
    scr_box_set_ref(clo->caps[1], nameBox);
    return scr_dyn_new_func(clo, dyn_bound_intrinsic_thunk, 0, "()", "bound");
  }
  /* `constructor` is a member EVERY instance has (its class value), which no
   * table lists, so a miss cannot be called absent: the class value has no
   * dyn representation yet, and answering undefined would be the silent
   * wrong answer. The loud ladder stays for exactly this name. */
  if (key->len == 11 && memcmp(key->data, "constructor", 11) == 0) {
    /* The instance's class value (scr_dyn_class_box): the descriptor of the
     * class the instance ACTUALLY is, so a derived instance answers its own
     * class and two instances of one class answer one box. */
    return scr_dyn_class_box(scr_dyn_objinst_class_of(d));
  }
  if (scr_dyn_objinst_error_rooted(d)) {
    if (key->len == 8 && memcmp(key->data, "toString", 8) == 0) {
      /* Error.prototype.toString, as a function bound over the call path. */
      ScrClosure *clo = scr_closure_new((void *)dyn_bound_intrinsic_thunk, 2);
      clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
      scr_box_set_ref(clo->caps[0], scr_dyn_retain(d));
      clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
      scr_box_set_ref(clo->caps[1], scr_dyn_new_str((ScrStr *)key));
      return scr_dyn_new_func(clo, dyn_bound_intrinsic_thunk, 0, "()", "bound");
    }
    return scr_dyn_error_member_get(d, key);
  }
  if (scr_dyn_objinst_class_of(d)->opaque) {
    scr_dyn_objinst_fence(d, "a property read");
    return NULL;
  }
  return scr_dyn_retain(scr_dyn_undefined());
}

/* Array.prototype.push/pop/shift/unshift run as the SPEC's generic algorithm
 * over the proxy (this = the proxy), so every [[Get]]/[[Set]]/[[Has]]/
 * [[Delete]] they make is observable through the traps, in the spec's order.
 * Set and Delete are the throwing forms (Set(O, P, V, true)), so the strict
 * flag is forced for their duration. Result +1, or NULL with the exception
 * pending. */
static double px_arr_len(ScrDyn *p) {
  ScrStr *k = scr_str_new("length", 6);
  ScrDyn *l = scr_dyn_proxy_get(p, k);
  scr_str_release(k);
  if (l == NULL) return -1;
  double n = scr_dyn_to_number(l);
  scr_dyn_release(l);
  if (scr_exc_pending()) return -1;
  if (!(n > 0)) return 0;
  if (n > 9007199254740991.0) n = 9007199254740991.0;
  return n == n ? (double)(long long)n : 0;
}

static bool px_arr_set(ScrDyn *p, double idx, ScrDyn *v, bool is_len) {
  ScrStr *k = is_len ? scr_str_new("length", 6) : scr_f64_to_scrstr(idx);
  bool saved = p->v.proxy.strict;
  p->v.proxy.strict = true;
  scr_dyn_proxy_set(p, k, v);
  p->v.proxy.strict = saved;
  scr_str_release(k);
  return !scr_exc_pending();
}

static bool px_arr_setnum(ScrDyn *p, double n) {
  ScrDyn *v = scr_dyn_new_num(n);
  bool ok = px_arr_set(p, 0, v, true);
  scr_dyn_release(v);
  return ok;
}

static bool px_arr_delete(ScrDyn *p, double idx) {
  ScrStr *k = scr_f64_to_scrstr(idx);
  bool saved = p->v.proxy.strict;
  p->v.proxy.strict = true;
  (void)scr_dyn_proxy_delete(p, k);
  p->v.proxy.strict = saved;
  scr_str_release(k);
  return !scr_exc_pending();
}

static ScrDyn *px_arr_get(ScrDyn *p, double idx) {
  ScrStr *k = scr_f64_to_scrstr(idx);
  ScrDyn *v = scr_dyn_proxy_get(p, k);
  scr_str_release(k);
  return v;
}

static bool px_arr_has(ScrDyn *p, double idx) {
  ScrStr *k = scr_f64_to_scrstr(idx);
  bool h = scr_dyn_proxy_has(p, k);
  scr_str_release(k);
  return h;
}

/* Answers true with *out set (+1 or NULL pending) when `name` is one of the
 * four mutators. */
static bool px_array_mutator(ScrDyn *p, const char *name, ScrDyn *const *args, size_t argc, ScrDyn **out) {
  bool is_push = strcmp(name, "push") == 0, is_pop = strcmp(name, "pop") == 0;
  bool is_shift = strcmp(name, "shift") == 0, is_unshift = strcmp(name, "unshift") == 0;
  if (!is_push && !is_pop && !is_shift && !is_unshift) return false;
  double len = px_arr_len(p);
  if (len < 0) { *out = NULL; return true; }
  if (is_push) {
    for (size_t i = 0; i < argc; i++)
      if (!px_arr_set(p, len + (double)i, args[i], false)) { *out = NULL; return true; }
    if (!px_arr_setnum(p, len + (double)argc)) { *out = NULL; return true; }
    *out = scr_dyn_new_num(len + (double)argc);
    return true;
  }
  if (is_pop) {
    if (len == 0) {
      if (!px_arr_setnum(p, 0)) { *out = NULL; return true; }
      *out = scr_dyn_undefined();
      return true;
    }
    ScrDyn *el = px_arr_get(p, len - 1);
    if (el == NULL) { *out = NULL; return true; }
    if (!px_arr_delete(p, len - 1) || !px_arr_setnum(p, len - 1)) {
      scr_dyn_release(el);
      *out = NULL;
      return true;
    }
    *out = el;
    return true;
  }
  if (is_shift) {
    if (len == 0) {
      if (!px_arr_setnum(p, 0)) { *out = NULL; return true; }
      *out = scr_dyn_undefined();
      return true;
    }
    ScrDyn *first = px_arr_get(p, 0);
    if (first == NULL) { *out = NULL; return true; }
    for (double k = 1; k < len; k++) {
      if (px_arr_has(p, k)) {
        ScrDyn *v = px_arr_get(p, k);
        if (v == NULL) { scr_dyn_release(first); *out = NULL; return true; }
        bool ok = px_arr_set(p, k - 1, v, false);
        scr_dyn_release(v);
        if (!ok) { scr_dyn_release(first); *out = NULL; return true; }
      } else if (!px_arr_delete(p, k - 1)) {
        scr_dyn_release(first);
        *out = NULL;
        return true;
      }
      if (scr_exc_pending()) { scr_dyn_release(first); *out = NULL; return true; }
    }
    if (!px_arr_delete(p, len - 1) || !px_arr_setnum(p, len - 1)) {
      scr_dyn_release(first);
      *out = NULL;
      return true;
    }
    *out = first;
    return true;
  }
  /* unshift */
  if (argc > 0) {
    for (double k = len; k > 0; k--) {
      double from = k - 1, to = k + (double)argc - 1;
      if (px_arr_has(p, from)) {
        ScrDyn *v = px_arr_get(p, from);
        if (v == NULL) { *out = NULL; return true; }
        bool ok = px_arr_set(p, to, v, false);
        scr_dyn_release(v);
        if (!ok) { *out = NULL; return true; }
      } else if (!px_arr_delete(p, to)) {
        *out = NULL;
        return true;
      }
      if (scr_exc_pending()) { *out = NULL; return true; }
    }
    for (size_t j = 0; j < argc; j++)
      if (!px_arr_set(p, (double)j, args[j], false)) { *out = NULL; return true; }
  }
  if (!px_arr_setnum(p, len + (double)argc)) { *out = NULL; return true; }
  *out = scr_dyn_new_num(len + (double)argc);
  return true;
}

ScrDyn *scr_dyn_proxy_invoke(ScrDyn *p, const ScrStr *key, ScrDyn *const *args, size_t argc, const char *what) {
  /* [[Get]] through the proxy (the get trap, else the target's own member),
   * then Call with this = the PROXY — so a method body's own property
   * accesses run the traps too. A name the target holds only as a prototype
   * intrinsic (toString, hasOwnProperty, an array's push) is not a stored
   * function: it runs on the target (its inner accesses bypass the traps). */
  ScrDyn *f = scr_dyn_proxy_get(p, key);
  if (f == NULL) return NULL;
  /* An array target's push/pop/shift/unshift (the intrinsic, not a function
   * the handler or target substituted) run through the traps. */
  if (p->v.proxy.target->kind == SCR_DYN_ARR &&
      (f->kind == SCR_DYN_UNDEF || (f->kind == SCR_DYN_FUNC && f->v.fn.thunk == dyn_bound_intrinsic_thunk))) {
    ScrDyn *out;
    if (px_array_mutator(p, key->data, args, argc, &out)) {
      scr_dyn_release(f);
      return out;
    }
  }
  if (f->kind == SCR_DYN_UNDEF) {
    bool threw;
    ScrDyn *gt = scr_dyn_proxy_trap(p, "get", &threw);
    if (threw) {
      scr_dyn_release(f);
      return NULL;
    }
    if (gt == NULL) {
      scr_dyn_release(f);
      return scr_dyn_invoke(p->v.proxy.target, key->data, args, argc, what);
    }
    scr_dyn_release(gt);
  }
  if (f->kind != SCR_DYN_FUNC && f->kind != SCR_DYN_PROXY) {
    scr_dyn_release(f);
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, what);
    scr_jb_puts(&b, " is not a function");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  scr_dyn_this_push_dyn(p);
  ScrDyn *r = scr_dyn_call(f, args, argc, what);
  scr_dyn_this_pop();
  scr_dyn_release(f);
  return r;
}

/* `a.keys()` / `a.values()` / `a.entries()` on a dyn ARRAY or typed-array
 * (BYTES) receiver, drained where they are made: a fresh dyn array of the
 * indices, the elements, or the [index, element] pairs. The frontend routes
 * these names here only in the contexts that consume the iterator at once (a
 * for-of subject, a spread element, the sole argument of Array.from or of
 * new Map / new Set), where a snapshot IS what the live iterator would have
 * produced. mode: 1 keys, 2 values, 3 entries. */
static ScrDyn *dyn_seq_snapshot(ScrDyn *recv, int mode) {
  ScrDyn *out = scr_dyn_new_arr();
  size_t n = recv->kind == SCR_DYN_ARR ? recv->v.arr.len : (size_t)scr_bytes_len(recv->v.bytes);
  for (size_t i = 0; i < n; i++) {
    ScrDyn *el = recv->kind == SCR_DYN_ARR ? scr_dyn_retain(recv->v.arr.items[i])
                                           : scr_dyn_new_num(scr_bytes_get(recv->v.bytes, (double)i));
    if (mode == 2) {
      scr_dyn_arr_push(out, el);
    } else if (mode == 1) {
      scr_dyn_release(el);
      scr_dyn_arr_push(out, scr_dyn_new_num((double)i));
    } else {
      ScrDyn *pair = scr_dyn_new_arr();
      scr_dyn_arr_push(pair, scr_dyn_new_num((double)i));
      scr_dyn_arr_push(pair, el);
      scr_dyn_arr_push(out, pair);
    }
  }
  return out;
}

static int dyn_iter_name_mode(const char *method) {
  return dyn_name_is(method, "keys") ? 1 : dyn_name_is(method, "values") ? 2 : dyn_name_is(method, "entries") ? 3 : 0;
}

/* ── Map / Set methods on a drivable map box (SCR_DYN_MAP) ────────────────
 *
 * `m.set(k, v)`, `m.get(k)`, `s.add(x)`, ... on a Map or Set reached through
 * a dyn value. Two kinds of box are driven here:
 *
 *  - a DYN-FLAVORED one (scr_dyn_new_dynmap: untyped JS's `new Map()`), whose
 *    keys and values are dyn boxes, so each method is the map primitive over
 *    the boxes themselves and SameValueZero comes from the key kind;
 *  - a TYPED one boxed across the boundary (a `Map<string, number>` handed to
 *    an `any` parameter), whose slots are static: its box carries the emitted
 *    conversion table (ScrDynMapOps), and each method converts the dyn
 *    argument to the slot (a probe that does not fit the key type is a MISS,
 *    exactly what Map.prototype.get answers for a key that is not there; a
 *    STORE that does not fit throws the path-annotated TypeError, because a
 *    typed map has no slot for it) and the answer back to a dyn.
 *
 * forEach is LIVE: it walks the entry table by index with the iteration
 * bracket open (appends are visited, a delete is skipped, clear() ends it),
 * which is the specified behaviour and what the typed lowering's forEach
 * desugar already does. A typed box with NO table (a member type that has no
 * dyn form) is not handled and keeps the loud ladder. */
/* A probe key: false = no entry can hold it (typed map, wrong key type). The
 * slot is released by dm_key_done. */
static bool dm_probe(const ScrMap *m, const ScrDynMapOps *ops, const ScrDyn *k, uint64_t *slot) {
  if (ops == NULL) {
    *slot = (uint64_t)(uintptr_t)k;
    return true;
  }
  (void)m;
  return ops->key_probe(k, slot);
}

static void dm_key_done(const ScrDynMapOps *ops, uint64_t slot) {
  if (ops != NULL && ops->key_drop != NULL) ops->key_drop(slot);
}

ScrDyn *scr_dyn_map_invoke(ScrDyn *recv, const char *method, ScrDyn *const *args, size_t argc,
                           const char *what, bool *handled) {
  *handled = false;
  if (!scr_dyn_is_dynmap(recv)) return NULL;
  ScrMap *m = recv->v.map.m;
  const ScrDynMapOps *ops = recv->v.map.ops;
  int flavor = scr_dyn_map_flavor(recv);
  bool is_set = flavor == 1 || flavor == 3;
  bool weak = flavor >= 2;
  ScrDyn *und = scr_dyn_undefined();
  ScrDyn *a0 = argc > 0 ? args[0] : und;
  ScrDyn *a1 = argc > 1 ? args[1] : und;
  *handled = true;
  if (dyn_name_is(method, "has") || dyn_name_is(method, "delete")) {
    bool del = method[0] == 'd';
    uint64_t slot;
    if (!dm_probe(m, ops, a0, &slot)) return scr_dyn_new_bool(false);
    bool r;
    if (ops == NULL) r = del ? scr_map_delete_ref(m, a0) : scr_map_has_ref(m, a0);
    else r = del ? scr_map_delete_slot(m, slot) : scr_map_has_slot(m, slot);
    dm_key_done(ops, slot);
    return scr_dyn_new_bool(r);
  }
  /* clear() is a Map/Set member only: a weak collection has none (and no
   * forEach, size, keys, values or entries). */
  if (!weak && dyn_name_is(method, "clear")) {
    scr_map_clear(m);
    return scr_dyn_retain(und);
  }
  if (is_set) {
    if (dyn_name_is(method, "add")) {
      if (ops == NULL) {
        if (weak && !scr_dynmap_weak_key_check(a0, true)) return NULL;
        scr_dynmap_put(m, a0, NULL);
      } else {
        uint64_t slot;
        if (!ops->key_check(a0, &slot)) return NULL;
        scr_map_set_slot(m, slot, 0);
        dm_key_done(ops, slot);
      }
      return scr_dyn_retain(recv);
    }
  } else {
    if (dyn_name_is(method, "get")) {
      uint64_t slot;
      if (!dm_probe(m, ops, a0, &slot)) return scr_dyn_retain(und);
      ScrDyn *v;
      if (ops == NULL) {
        v = (ScrDyn *)scr_map_get_ref_ref(m, a0); /* +1 or NULL */
      } else {
        uint64_t vs;
        v = scr_map_get_slot(m, slot, &vs) ? ops->val_to_dyn(vs) : NULL;
      }
      dm_key_done(ops, slot);
      return v != NULL ? v : scr_dyn_retain(und);
    }
    if (dyn_name_is(method, "set")) {
      if (ops == NULL) {
        if (weak && !scr_dynmap_weak_key_check(a0, false)) return NULL;
        scr_dynmap_put(m, a0, a1);
      } else {
        uint64_t slot, vs;
        if (!ops->key_check(a0, &slot)) return NULL;
        if (!ops->val_check(a1, &vs)) {
          dm_key_done(ops, slot);
          return NULL;
        }
        scr_map_set_slot(m, slot, vs); /* the value slot moves in */
        dm_key_done(ops, slot);
      }
      return scr_dyn_retain(recv);
    }
  }
  if (weak) {
    *handled = false;
    return NULL;
  }
  if (dyn_name_is(method, "forEach")) {
    if (!dyn_cb_check(args, argc)) return NULL;
    ScrDyn *cb = args[0];
    scr_map_iter_enter(m);
    for (double i = 0; i < scr_map_iter_count(m); i++) {
      if (!scr_map_iter_live(m, i)) continue;
      ScrDyn *k = scr_dyn_map_key_at(recv, i); /* +1 */
      ScrDyn *v = is_set ? scr_dyn_retain(k) : scr_dyn_map_val_at(recv, i);
      ScrDyn *cbargs[3] = { v, k, recv };
      if (argc > 1) scr_dyn_this_push_dyn(a1);
      ScrDyn *r = scr_dyn_call(cb, cbargs, 3, "callback");
      if (argc > 1) scr_dyn_this_pop();
      scr_dyn_release(k);
      scr_dyn_release(v);
      if (!r) {
        scr_map_iter_exit(m);
        return NULL;
      }
      scr_dyn_release(r);
    }
    scr_map_iter_exit(m);
    return scr_dyn_retain(und);
  }
  if (dyn_name_is(method, "keys")) return scr_dyn_map_snapshot(recv, 1);
  if (dyn_name_is(method, "values")) return scr_dyn_map_snapshot(recv, 2);
  if (dyn_name_is(method, "entries")) return scr_dyn_map_snapshot(recv, 3);
  /* Not a member of this prototype (Map has no `add`, Set has no `get`/`set`,
   * and nothing else is declared): Node's own message for a missing method. */
  (void)what;
  *handled = false;
  return NULL;
}

ScrDyn *scr_dyn_invoke_pack(ScrDyn *recv, ScrDyn *pack, const ScrStr *method, const ScrStr *what) {
  return scr_dyn_invoke(recv, method->data, (ScrDyn *const *)pack->v.arr.items, pack->v.arr.len, what->data);
}

ScrDyn *scr_dyn_invoke(ScrDyn *recv, const char *method, ScrDyn *const *args, size_t argc, const char *what) {
  if (recv->kind == SCR_DYN_PROXY) {
    ScrStr *k = scr_str_new(method, strlen(method));
    ScrDyn *r = scr_dyn_proxy_invoke(recv, k, args, argc, what);
    scr_str_release(k);
    return r;
  }
  if (recv->kind == SCR_DYN_UNDEF || recv->kind == SCR_DYN_NULL) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Cannot read properties of ");
    scr_jb_puts(&b, recv->kind == SCR_DYN_UNDEF ? "undefined" : "null");
    scr_jb_puts(&b, " (reading '");
    scr_jb_puts(&b, method);
    scr_jb_puts(&b, "')");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }

  if (recv->kind == SCR_DYN_MAP) {
    bool handled = false;
    ScrDyn *r = scr_dyn_map_invoke(recv, method, args, argc, what, &handled);
    if (handled) return r;
    if (scr_dyn_is_dynmap(recv)) {
      dyn_throw_not_fn(what); /* a method the Map/Set prototype lacks: Node's own answer */
      return NULL;
    }
    /* A typed box with NO conversion table (a member type with no dyn form):
     * a method Node's Map/Set HAS must not answer "is not a function", the
     * lie this tail told for every typed map before the table existed. The
     * loud ladder names it; a name the prototype lacks still falls through
     * to Node's own answer. */
    static const char *const map_members[] = { "get", "set", "has", "delete", "clear", "forEach", "keys", "values", "entries", NULL };
    static const char *const set_members[] = { "add", "has", "delete", "clear", "forEach", "keys", "values", "entries", NULL };
    const char *const *members = scr_dyn_map_flavor(recv) == 1 ? set_members : map_members;
    for (size_t i = 0; members[i] != NULL; i++) {
      if (dyn_name_is(method, members[i])) {
        scr_dyn_map_fence(recv, "calling a method");
        return NULL;
      }
    }
  }

  /* Native handles dispatch through the tag's ops onto the same entry
   * points the static lowerings use (scr_http/scr_net register them at
   * main()); the ladder inside covers real-but-unimplemented members
   * loudly. */
  if (recv->kind == SCR_DYN_HANDLE) {
    return scr_dynh_dispatch(recv, method, args, argc, what);
  }

  /* Island-held receivers: the ENGINE runs its own prototypes (JS-exact
   * flatMap/map/forEach/filter — Array.prototype is the engine's) through
   * scr_jsval_call_method; arguments cross per the uniform conversion
   * (wrapped cells by reference, dyn data deep-copied, FUNC boxes through
   * the host shim), a missing member throws the engine's own TypeError,
   * and the result wraps back scalar-normalized. `what` is unused — the
   * engine's message names the failure. */
  if (recv->kind == SCR_DYN_JSVAL) {
    return scr_dyn_jsval_ops()->invoke(recv->v.jsval.cell, method, args, argc, what);
  }

  /* OBJ: `o.m(...)` is Get(o, "m") followed by Call, so the LOOKUP is
   * the whole [[Get]] — the very one the keyed read takes. Sharing
   * scr_dyn_obj_key_get is what keeps `o.m` and `o.m()` from disagreeing
   * about where a method lives, which they did while dispatch kept its
   * own walk: own member, own NON-ENUMERABLE property (a `{ value: fn }`
   * descriptor installs a method Object.keys must not report —
   * protobufjs's `CustomError.prototype.toString` is exactly that), an
   * accessor that RUNS, then the prototype chain.
   *
   * The chain half is the whole pre-class dispatch (`inst.method()`
   * where `method` came from `F.prototype.method = fn`), and the call
   * binds the INSTANCE as the receiver, not the prototype object that
   * stores the function. Anything non-callable is Node's
   * is-not-a-function. */
  /* OBJINST: a class instance's members are the emitted table's, and the
   * LOOKUP is the whole [[Get]] -- the OBJ arm's rule below, one kind
   * over, and for the same reason: `x.get` and `x.get()` must not be able
   * to disagree about where a method lives.
   *
   * Until this arm the ladder had NONE for OBJINST at all. A class
   * instance in a dyn slot fell past every arm to the tail and answered
   * Node's "x.get is not a function" for a method the object plainly has
   * -- a lie, and a MATCH->WRONG for ordinary JavaScript that node runs.
   * The methods were never dropped: a class's methods are static
   * functions in the emitted TU, and the box carried no way to name one.
   * The prototype-constructor spelling of the same program answered it
   * correctly the whole time, because that one lowers to a plain dyn
   * object whose members are real FUNC boxes.
   *
   * A class with NO table falls through exactly as before, so a program
   * whose classes carry none cannot tell this arm was added. */
  if (recv->kind == SCR_DYN_OBJINST && (scr_dyn_objinst_has_members(recv) || scr_dyn_objinst_error_rooted(recv))) {
    const ScrDynClassMember *cm = scr_dyn_objinst_member(recv, method, strlen(method));
    if (cm != NULL && cm->call != NULL) {
      /* The receiver binds by CONSTRUCTION here -- the emitted wrapper
       * passes the instance as the method's own first parameter, which
       * is what `this` is on the static side. No ambient window is
       * pushed, because none is read. */
      return cm->call(recv->v.inst.o, args, argc, what);
    }
    if (cm != NULL) {
      /* A DATA member holding a function value: `o.m()` is Get then Call,
       * and the call binds the instance (the OBJ arm's ambient-receiver
       * window, same reason). */
      ScrDyn *fv = cm->get(recv->v.inst.o);
      if (fv == NULL) return NULL; /* the read threw */
      if (fv->kind == SCR_DYN_FUNC ||
          (fv->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(fv, "function"))) {
        scr_dyn_this_push_dyn(recv);
        ScrDyn *r = scr_dyn_call(fv, args, argc, what);
        scr_dyn_this_pop();
        scr_dyn_release(fv);
        return r;
      }
      scr_dyn_release(fv);
      dyn_throw_not_fn(what);
      return NULL;
    }
    /* An Error-rooted instance: Error.prototype.toString is the runtime's
     * routine, and any other name is the error's own property (its bag), a
     * function value there being called with the instance as receiver. */
    if (scr_dyn_objinst_error_rooted(recv)) {
      if (strcmp(method, "toString") == 0) {
        ScrStr *s = scr_error_to_string((ScrError *)recv->v.inst.o);
        ScrDyn *r = scr_dyn_new_str(s);
        scr_str_release(s);
        return r;
      }
      ScrStr *mk = scr_str_new(method, strlen(method));
      ScrDyn *fv = scr_dyn_error_member_get(recv, mk);
      scr_str_release(mk);
      if (fv != NULL && fv->kind == SCR_DYN_FUNC) {
        scr_dyn_this_push_dyn(recv);
        ScrDyn *r = scr_dyn_call(fv, args, argc, what);
        scr_dyn_this_pop();
        scr_dyn_release(fv);
        return r;
      }
      scr_dyn_release(fv);
      if (dyn_objproto_knows(method)) return dyn_object_proto_method(recv, method, args, argc, what);
      dyn_throw_not_fn(what);
      return NULL;
    }
    /* A miss on a class WITH a table: the table is the class's whole
     * member set, so is-not-a-function is now a TRUE statement -- but
     * Object.prototype's own set is inherited by every instance and has
     * to be walked before a miss can be called one. */
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  if (recv->kind == SCR_DYN_OBJ) {
    ScrDyn *m = scr_dyn_obj_key_get(recv, method, strlen(method)); /* +1, or NULL */
    if (m == NULL) return NULL; /* a getter threw, or the `constructor` fence */
    if (m->kind == SCR_DYN_FUNC ||
        /* a WRAPPED engine function stored as a dyn member: the
         * routed call (scr_dyn_call's JSVAL arm) runs it. */
        (m->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(m, "function"))) {
      /* JS binds the receiver for the call (`obj.method()` — this === obj):
       * the ambient-receiver window (scr_runtime.h). */
      scr_dyn_this_push_dyn(recv);
      ScrDyn *r = scr_dyn_call(m, args, argc, what);
      scr_dyn_this_pop();
      scr_dyn_release(m);
      return r;
    }
    bool found = m->kind != SCR_DYN_UNDEF ||
                 scr_dyn_obj_key_present(recv, method, strlen(method));
    scr_dyn_release(m);
    /* A null-prototype dictionary inherits NOTHING: Object.create(null)
     * .hasOwnProperty("a") is "d.hasOwnProperty is not a function" in
     * Node, and protobufjs's `_listeners` maps are exactly that shape. */
    if (found || recv->null_proto) {
      dyn_throw_not_fn(what);
      return NULL;
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  if (recv->kind == SCR_DYN_FUNC) {
    if (dyn_name_is(method, "apply")) {
      /* fn.apply(thisArg, argsArray) — thisArg binds the ambient receiver
       * for the call window (the mustCall wrapper's `fn.apply(this,
       * arguments)` forwards whatever receiver the wrapper ran under). */
      const ScrDyn *thisv = argc >= 1 ? args[0] : scr_dyn_undefined();
      ScrDyn *list = argc >= 2 ? args[1] : NULL;
      if (list == NULL || list->kind == SCR_DYN_UNDEF || list->kind == SCR_DYN_NULL) {
        scr_dyn_this_push_dyn(thisv);
        ScrDyn *r = scr_dyn_call(recv, NULL, 0, what);
        scr_dyn_this_pop();
        return r;
      }
      if (list->kind != SCR_DYN_ARR) {
        /* An ARRAY-LIKE pack: CreateListFromArrayLike, not a kind test.
         * The fast path below stays for a real array — its items are
         * already a contiguous borrowed vector and no copy is owed. */
        size_t packc = 0;
        ScrDyn **pack = dyn_list_from_array_like(list, &packc);
        if (pack == NULL && scr_exc_pending()) return NULL;
        scr_dyn_this_push_dyn(thisv);
        ScrDyn *r = scr_dyn_call(recv, pack, packc, what);
        scr_dyn_this_pop();
        for (size_t i = 0; i < packc; i++) scr_dyn_release(pack[i]);
        free(pack);
        return r;
      }
      scr_dyn_this_push_dyn(thisv);
      ScrDyn *r = scr_dyn_call(recv, list->v.arr.items, list->v.arr.len, what);
      scr_dyn_this_pop();
      return r;
    }
    if (dyn_name_is(method, "call")) {
      scr_dyn_this_push_dyn(argc >= 1 ? args[0] : scr_dyn_undefined());
      ScrDyn *r = scr_dyn_call(recv, argc > 1 ? args + 1 : NULL, argc > 1 ? argc - 1 : 0, what);
      scr_dyn_this_pop();
      return r;
    }
    if (dyn_name_is(method, "bind") || dyn_name_is(method, "toString")) {
      dyn_throw_unsupported("Function", method);
      return NULL;
    }
    /* An OWN property on the FUNC box (defineProperties writes — the
     * mustCall-wrapper expando family): a callable member runs with the
     * box bound (JS's o.m() receiver), everything else keeps Node's
     * is-not-a-function. */
    {
      ScrDyn *own = scr_dyn_fn_get(recv, method, strlen(method));
      if (own) {
        if (own->kind == SCR_DYN_FUNC || own->kind == SCR_DYN_JSVAL) {
          scr_dyn_this_push_dyn(recv);
          ScrDyn *r = scr_dyn_call(own, args, argc, what);
          scr_dyn_this_pop();
          scr_dyn_release(own);
          return r;
        }
        scr_dyn_release(own);
      }
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  if (recv->kind == SCR_DYN_STR) {
    ScrStr *s = recv->v.str;
    {
      const ScrHtmlWrap *w = dyn_str_html_wrap(method);
      if (w) return dyn_str_create_html(s, w, args, argc);
    }
    if (dyn_name_is(method, "slice")) {
      double start = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double end = dyn_index_arg(args, argc, 1, scr_str_utf16_len(s), what);
      if (scr_exc_pending()) return NULL;
      ScrStr *piece = scr_str_slice(s, start, end);
      ScrDyn *r = scr_dyn_new_str(piece); /* retains */
      scr_str_release(piece);
      return r;
    }
    if (dyn_name_is(method, "at") || dyn_name_is(method, "concat") ||
        dyn_name_is(method, "indexOf") || dyn_name_is(method, "lastIndexOf") ||
        dyn_name_is(method, "includes")) {
      if ((dyn_name_is(method, "indexOf") || dyn_name_is(method, "lastIndexOf") ||
           dyn_name_is(method, "includes")) &&
          argc >= 1 && args[0]->kind == SCR_DYN_STR) {
        if (dyn_name_is(method, "includes")) return scr_dyn_new_bool(scr_str_includes(s, args[0]->v.str));
        if (dyn_name_is(method, "indexOf")) return scr_dyn_new_num(scr_str_index_of(s, args[0]->v.str, 0));
        return scr_dyn_new_num(scr_str_last_index_of(s, args[0]->v.str));
      }
      dyn_throw_unsupported("String", method);
      return NULL;
    }
    /* PARITY WITH THE DOT SPELLING, not a new String surface.
     *
     * `s.toUpperCase()` on a dyn receiver is answered by the FRONTEND,
     * out of DYN_STRING_ONLY_METHODS, before any runtime dispatch
     * happens. The ELEMENT spelling `s[k]()` can never consult that
     * table -- its key is a runtime value -- so it arrived here, found
     * no arm, and answered "is not a function" for names Node plainly
     * has. That is a LIE, and the worst-shaped one: it reads as a
     * missing MEMBER rather than a missing IMPLEMENTATION, so a program
     * feature-detecting with `if (s[k])` takes the wrong branch in
     * silence.
     *
     * Every arm below calls the SAME scr_str_* helper the static string
     * intrinsic calls for the dot spelling, so `s.trim()` and `s[k]()`
     * cannot drift into two answers. Names the dot spelling reaches
     * through the REGEX tables (split/replace/match/...) are not
     * reimplemented here; they fence loudly in dyn_str_proto_unimpl
     * below, which is a true statement where "is not a function" was a
     * false one. */
    /* toUpperCase/toLowerCase are NOT here, and the reason is a link-line
     * one rather than a semantic one. Their only correct implementation is
     * scr_str_case_conv in scr_regex.c, which reaches libregexp's Unicode
     * case tables (lre_case_conv) for the non-ASCII half and the final-
     * sigma rule. Naming it from this always-gated-together unit would put
     * "scr_regex.c" in RUNTIME_UNIT_DEPS["scr_dyn_invoke.c"] and pull the
     * vendored regex engine into every binary that makes ANY dyn method
     * call -- which is the exact size-class property RUNTIME_UNIT_DEPS
     * exists to protect, and a far worse trade than one fenced name.
     *
     * An ASCII-only inline conversion was considered and REFUSED: it would
     * be a silent wrong answer for every non-ASCII string, which is the
     * failure mode this whole line of work is about.
     *
     * So they fence, loudly and by name, through dyn_str_proto_unimpl
     * below -- true where "is not a function" was false. Pinned as 4152.
     */
    if (dyn_name_is(method, "trim") || dyn_name_is(method, "trimStart") ||
        dyn_name_is(method, "trimEnd")) {
      ScrStr *r = dyn_name_is(method, "trim")        ? scr_str_trim(s)
                : dyn_name_is(method, "trimStart")   ? scr_str_trim_start(s)
                                                     : scr_str_trim_end(s);
      ScrDyn *d = scr_dyn_new_str(r);
      scr_str_release(r);
      return d;
    }
    if (dyn_name_is(method, "charAt")) {
      double i = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      ScrStr *r = scr_str_char_at(s, i);
      if (scr_exc_pending()) { if (r) scr_str_release(r); return NULL; }
      ScrDyn *d = scr_dyn_new_str(r);
      scr_str_release(r);
      return d;
    }
    if (dyn_name_is(method, "charCodeAt")) {
      double i = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double c = scr_str_char_code_at(s, i);
      if (scr_exc_pending()) return NULL;
      return scr_dyn_new_num(c);
    }
    if (dyn_name_is(method, "startsWith") || dyn_name_is(method, "endsWith")) {
      if (argc < 1 || args[0]->kind != SCR_DYN_STR) {
        dyn_throw_unsupported("String", method);
        return NULL;
      }
      bool r = dyn_name_is(method, "startsWith") ? scr_str_starts_with(s, args[0]->v.str)
                                                 : scr_str_ends_with(s, args[0]->v.str);
      if (scr_exc_pending()) return NULL;
      return scr_dyn_new_bool(r);
    }
    if (dyn_name_is(method, "substring")) {
      double a0 = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double a1 = dyn_index_arg(args, argc, 1, scr_str_utf16_len(s), what);
      if (scr_exc_pending()) return NULL;
      ScrStr *r = scr_str_substring(s, a0, a1);
      if (scr_exc_pending()) { if (r) scr_str_release(r); return NULL; }
      ScrDyn *d = scr_dyn_new_str(r);
      scr_str_release(r);
      return d;
    }
    if (dyn_name_is(method, "substr")) {
      double a0 = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double a1 = dyn_index_arg(args, argc, 1, INFINITY, what);
      if (scr_exc_pending()) return NULL;
      ScrStr *r = scr_str_substr(s, a0, a1);
      if (scr_exc_pending()) { if (r) scr_str_release(r); return NULL; }
      ScrDyn *d = scr_dyn_new_str(r);
      scr_str_release(r);
      return d;
    }
    if (dyn_name_is(method, "repeat")) {
      double n = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      ScrStr *r = scr_str_repeat(s, n);
      if (scr_exc_pending()) { if (r) scr_str_release(r); return NULL; }
      ScrDyn *d = scr_dyn_new_str(r);
      scr_str_release(r);
      return d;
    }
    if (dyn_name_is(method, "padStart") || dyn_name_is(method, "padEnd")) {
      double n = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      ScrStr *fill = (argc >= 2 && args[1]->kind == SCR_DYN_STR)
                       ? scr_str_retain(args[1]->v.str)
                       : scr_str_new(" ", 1);
      ScrStr *r = dyn_name_is(method, "padStart") ? scr_str_pad_start(s, n, fill)
                                                  : scr_str_pad_end(s, n, fill);
      scr_str_release(fill);
      if (scr_exc_pending()) { if (r) scr_str_release(r); return NULL; }
      ScrDyn *d = scr_dyn_new_str(r);
      scr_str_release(r);
      return d;
    }
    /* String.prototype.toString answers the primitive itself. valueOf is
     * NOT here: it is Object.prototype's, answered once for every kind in
     * dyn_object_proto_method, which this arm falls through to. */
    if (dyn_name_is(method, "toString")) {
      return scr_dyn_retain(recv);
    }
    if (dyn_str_proto_unimpl(method)) {
      dyn_throw_unsupported("String", method);
      return NULL;
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  if (recv->kind == SCR_DYN_ARR) {
    /* A boundary copy of a LIVE number[] / boolean[] / string[] is a view
     * of its origin (scr_json.c, "live array views"): bring the copy up to
     * date before anything reads it. */
    if (recv->static_copy) {
      /* push and pop keep to the O(1) length check (view_before handles
       * them); every other method pays the O(n) verification it already
       * costs the order of. */
      if (!dyn_name_is(method, "push") && !dyn_name_is(method, "pop")) scr_dyn_view_sync_deep(recv);
      else scr_dyn_view_sync(recv);
    }
    size_t len = recv->v.arr.len;
    /* An IN-PLACE array method on a copy the static→dyn boundary made of
     * a value the caller still names. When the copy is a live view the
     * method runs on the copy and its result is committed to the origin
     * (the program names ONE array, so both see the write). Otherwise the
     * mutation would be confined to the copy, so refuse loudly instead of
     * dropping it (see scr_dyn_static_copy_refuse). The non-mutating
     * methods — map, slice, join, indexOf and the rest — read the copy,
     * which is exact, and are deliberately not listed here. */
    if (recv->static_copy &&
        (dyn_name_is(method, "push") || dyn_name_is(method, "pop") ||
         dyn_name_is(method, "shift") || dyn_name_is(method, "unshift") ||
         dyn_name_is(method, "splice") || dyn_name_is(method, "sort") ||
         dyn_name_is(method, "reverse") || dyn_name_is(method, "fill") ||
         dyn_name_is(method, "copyWithin"))) {
      if (scr_dyn_view_live(recv)) {
        if (!scr_dyn_view_before(recv, method, args, argc)) return NULL;
        /* Run the ordinary array method on the copy with the guard lifted,
         * then commit. The flag is the guard's whole input, and it goes back
         * before the commit because the origin lookup is behind it. */
        recv->static_copy = false;
        ScrDyn *r = scr_dyn_invoke(recv, method, args, argc, what);
        recv->static_copy = true;
        if (scr_exc_pending()) scr_dyn_view_sync_force(recv);
        else scr_dyn_view_after(recv, method, argc);
        return r;
      }
      char named[64];
      int n = snprintf(named, sizeof named, "calling '%s'", method);
      scr_dyn_static_copy_refuse(n > 0 ? named : "an in-place array method");
      return NULL;
    }
    if (dyn_name_is(method, "push")) {
      for (size_t i = 0; i < argc; i++) scr_dyn_arr_push(recv, scr_dyn_retain(args[i]));
      return scr_dyn_new_num((double)recv->v.arr.len);
    }
    if (dyn_name_is(method, "pop")) {
      if (len == 0) return scr_dyn_retain(scr_dyn_undefined());
      return recv->v.arr.items[--recv->v.arr.len]; /* ownership moves out */
    }
    if (dyn_name_is(method, "shift")) {
      if (len == 0) return scr_dyn_retain(scr_dyn_undefined());
      ScrDyn *first = recv->v.arr.items[0];
      memmove(recv->v.arr.items, recv->v.arr.items + 1, (len - 1) * sizeof(ScrDyn *));
      recv->v.arr.len = len - 1;
      return first; /* ownership moves out */
    }
    if (dyn_name_is(method, "unshift")) {
      /* Append first (the push path grows capacity and takes the +1s),
       * then rotate: the old block moves up and the SAME retained
       * pointers land at the front (args[] still names them, so the
       * memmove clobbering the appended slots loses nothing). */
      for (size_t i = 0; i < argc; i++) scr_dyn_arr_push(recv, scr_dyn_retain(args[i]));
      memmove(recv->v.arr.items + argc, recv->v.arr.items, len * sizeof(ScrDyn *));
      for (size_t i = 0; i < argc; i++) recv->v.arr.items[i] = args[i];
      return scr_dyn_new_num((double)recv->v.arr.len);
    }
    /* fill and copyWithin: the two in-place names the static-copy guard
     * above has always listed and could never reach, because
     * dyn_arr_proto_unimpl claimed them first and threw "not supported"
     * before the guard ran (estado-fence.md §3.2 found the two dead arms;
     * estado-pinned.md closes them by implementing the methods instead of
     * deleting the arms). Both answer THIS array, not a copy — JS returns
     * the receiver — so a chained `a.fill(0).length` keeps working. */
    if (dyn_name_is(method, "fill")) {
      ScrDyn *value = argc > 0 ? args[0] : scr_dyn_undefined();
      double startD = dyn_index_arg(args, argc, 1, 0, what);
      if (scr_exc_pending()) return NULL;
      double endD = dyn_index_arg(args, argc, 2, (double)len, what);
      if (scr_exc_pending()) return NULL;
      size_t start = dyn_rel_index(startD, len);
      size_t end = dyn_rel_index(endD, len);
      for (size_t i = start; i < end; i++) {
        /* Retain BEFORE releasing: `a.fill(a[0])` names a slot that the
         * release could otherwise free out from under the store. */
        ScrDyn *fresh = scr_dyn_retain(value);
        ScrDyn *old = recv->v.arr.items[i];
        recv->v.arr.items[i] = fresh;
        scr_dyn_release(old);
      }
      return scr_dyn_retain(recv);
    }
    if (dyn_name_is(method, "copyWithin")) {
      double targetD = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double startD = dyn_index_arg(args, argc, 1, 0, what);
      if (scr_exc_pending()) return NULL;
      double endD = dyn_index_arg(args, argc, 2, (double)len, what);
      if (scr_exc_pending()) return NULL;
      size_t to = dyn_rel_index(targetD, len);
      size_t from = dyn_rel_index(startD, len);
      size_t last = dyn_rel_index(endD, len);
      size_t count = last > from ? last - from : 0;
      if (count > len - to) count = len - to;
      if (count > 0 && to != from) {
        /* The ranges may OVERLAP, so the whole source run is retained
         * before any store: a release that dropped the last reference to a
         * slot still to be read would free it mid-copy. memmove alone is
         * not enough — these are refcounted pointers, not bytes. */
        ScrDyn **src = (ScrDyn **)malloc(count * sizeof(ScrDyn *));
        if (src == NULL) {
          scr_throw_error_msg(SCR_ERR_ERROR, "out of memory in copyWithin",
                              strlen("out of memory in copyWithin"));
          return NULL;
        }
        for (size_t i = 0; i < count; i++) src[i] = scr_dyn_retain(recv->v.arr.items[from + i]);
        for (size_t i = 0; i < count; i++) {
          ScrDyn *old = recv->v.arr.items[to + i];
          recv->v.arr.items[to + i] = src[i];
          scr_dyn_release(old);
        }
        free(src);
      }
      return scr_dyn_retain(recv);
    }
    if (dyn_name_is(method, "slice")) {
      double startD = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double endD = dyn_index_arg(args, argc, 1, (double)len, what);
      if (scr_exc_pending()) return NULL;
      size_t start = dyn_rel_index(startD, len);
      size_t end = dyn_rel_index(endD, len);
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = start; i < end; i++) scr_dyn_arr_push(out, scr_dyn_retain(recv->v.arr.items[i]));
      return out;
    }
    if (dyn_name_is(method, "at")) {
      double iD = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double idx = iD < 0 ? (double)len + iD : iD;
      if (idx < 0 || idx >= (double)len) return scr_dyn_retain(scr_dyn_undefined());
      return scr_dyn_retain(recv->v.arr.items[(size_t)idx]);
    }
    if (dyn_name_is(method, "indexOf") || dyn_name_is(method, "lastIndexOf") ||
        dyn_name_is(method, "includes")) {
      ScrDyn *needle = argc > 0 ? args[0] : scr_dyn_undefined();
      if (dyn_name_is(method, "lastIndexOf")) {
        for (size_t i = len; i > 0; i--) {
          if (scr_dyn_strict_eq(recv->v.arr.items[i - 1], needle)) return scr_dyn_new_num((double)(i - 1));
        }
        return scr_dyn_new_num(-1);
      }
      for (size_t i = 0; i < len; i++) {
        if (scr_dyn_strict_eq(recv->v.arr.items[i], needle)) {
          return dyn_name_is(method, "includes") ? scr_dyn_new_bool(true) : scr_dyn_new_num((double)i);
        }
      }
      return dyn_name_is(method, "includes") ? scr_dyn_new_bool(false) : scr_dyn_new_num(-1);
    }
    if (dyn_name_is(method, "join")) {
      /* Array.prototype.join, in the spec's order: ToString(separator)
       * runs ONCE and FIRST — before any element, and even when the
       * array is empty or holds a single item — then each element's
       * ToString in turn. Rendering the separator per gap instead called
       * a side-effecting separator (len-1) times where Node calls it
       * once, and called it AFTER the first element where Node calls it
       * before. Both are user code, so both are observable. */
      ScrJsonBuf sb;
      scr_jb_init(&sb);
      if (argc > 0 && args[0]->kind != SCR_DYN_UNDEF) scr_dyn_display_buf(&sb, args[0]);
      else scr_jb_putc(&sb, ',');
      ScrStr *sep = scr_jb_finish(&sb);
      if (scr_exc_pending()) { scr_str_release(sep); return NULL; }

      ScrJsonBuf b;
      scr_jb_init(&b);
      for (size_t i = 0; i < len; i++) {
        if (i > 0) for (size_t j = 0; j < sep->len; j++) scr_jb_putc(&b, sep->data[j]);
        /* `len` is the spec's up-front snapshot, but an element's own
         * toString can SHRINK the receiver — JS reads Get(O, k), which
         * answers undefined past the end and contributes the empty
         * string, and reading items[i] would be out of bounds. It can
         * also drop the last reference to the very element being
         * rendered, so the element is retained across its own call
         * (forEach above takes the same precaution for the same
         * reason). */
        if (i >= recv->v.arr.len) continue;
        ScrDyn *e = scr_dyn_retain(recv->v.arr.items[i]);
        if (e->kind == SCR_DYN_UNDEF || e->kind == SCR_DYN_NULL) { scr_dyn_release(e); continue; }
        scr_dyn_display_buf(&b, e);
        scr_dyn_release(e);
        /* An element's own toString threw: JS stops there, so the
         * remaining elements' toStrings do not run and the half-built
         * text is discarded — the pending exception is the answer. */
        if (scr_exc_pending()) {
          ScrStr *partial = scr_jb_finish(&b);
          scr_str_release(partial);
          scr_str_release(sep);
          return NULL;
        }
      }
      scr_str_release(sep);
      ScrStr *joined = scr_jb_finish(&b);
      ScrDyn *r = scr_dyn_new_str(joined); /* retains */
      scr_str_release(joined);
      return r;
    }
    if (dyn_name_is(method, "concat")) {
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = 0; i < len; i++) scr_dyn_arr_push(out, scr_dyn_retain(recv->v.arr.items[i]));
      for (size_t a = 0; a < argc; a++) {
        if (args[a]->kind == SCR_DYN_ARR) {
          for (size_t i = 0; i < args[a]->v.arr.len; i++) {
            scr_dyn_arr_push(out, scr_dyn_retain(args[a]->v.arr.items[i]));
          }
        } else {
          scr_dyn_arr_push(out, scr_dyn_retain(args[a]));
        }
      }
      return out;
    }
    if (dyn_name_is(method, "reverse")) {
      for (size_t i = 0; i < len / 2; i++) {
        ScrDyn *tmp = recv->v.arr.items[i];
        recv->v.arr.items[i] = recv->v.arr.items[len - 1 - i];
        recv->v.arr.items[len - 1 - i] = tmp;
      }
      return scr_dyn_retain(recv);
    }
    if (dyn_name_is(method, "forEach") || dyn_name_is(method, "map") ||
        dyn_name_is(method, "filter") || dyn_name_is(method, "some") ||
        dyn_name_is(method, "every") || dyn_name_is(method, "find") ||
        dyn_name_is(method, "findIndex")) {
      if (!dyn_cb_check(args, argc)) return NULL;
      ScrDyn *cb = args[0];
      ScrDyn *out = (dyn_name_is(method, "map") || dyn_name_is(method, "filter")) ? scr_dyn_new_arr() : NULL;
      /* JS iterates the LIVE array (a push mid-loop is visited); reading
       * len fresh each step matches that. */
      for (size_t i = 0; i < recv->v.arr.len; i++) {
        ScrDyn *item = scr_dyn_retain(recv->v.arr.items[i]);
        ScrDyn *r = dyn_call_cb(cb, item, i, recv);
        if (!r) { scr_dyn_release(item); scr_dyn_release(out); return NULL; }
        if (dyn_name_is(method, "map")) {
          scr_dyn_arr_push(out, r); /* ownership moves in */
          r = NULL;
        } else {
          bool truthy = scr_dyn_truthy(r);
          scr_dyn_release(r);
          if (dyn_name_is(method, "filter") && truthy) scr_dyn_arr_push(out, scr_dyn_retain(item));
          if (dyn_name_is(method, "some") && truthy) { scr_dyn_release(item); return scr_dyn_new_bool(true); }
          if (dyn_name_is(method, "every") && !truthy) { scr_dyn_release(item); return scr_dyn_new_bool(false); }
          if (dyn_name_is(method, "find") && truthy) return item; /* +1 moves out */
          if (dyn_name_is(method, "findIndex") && truthy) { scr_dyn_release(item); return scr_dyn_new_num((double)i); }
        }
        scr_dyn_release(item);
      }
      if (out) return out;
      if (dyn_name_is(method, "some")) return scr_dyn_new_bool(false);
      if (dyn_name_is(method, "every")) return scr_dyn_new_bool(true);
      if (dyn_name_is(method, "find")) return scr_dyn_retain(scr_dyn_undefined());
      if (dyn_name_is(method, "findIndex")) return scr_dyn_new_num(-1);
      return scr_dyn_retain(scr_dyn_undefined()); /* forEach */
    }
    /* reduce / reduceRight / findLast / findLastIndex / toReversed /
     * toSorted / with: the Array.prototype names that sat in
     * dyn_arr_proto_unimpl (or in no list at all, which answered "is not a
     * function" for a method every array has) and in the compiler's
     * name-level fence, so a call on an untyped array was a build refusal
     * in the dotted spelling and a loud throw in the computed one. They
     * run now, with the typed-array versions' order of coercions
     * (scr_json.c's tbm_* block is the Uint8Array twin of this block). */
    if (dyn_name_is(method, "reduce") || dyn_name_is(method, "reduceRight")) {
      const bool right = dyn_name_is(method, "reduceRight");
      if (!dyn_cb_check(args, argc)) return NULL;
      ScrDyn *cb = args[0];
      const size_t len0 = recv->v.arr.len; /* captured once, like the spec */
      size_t k = 0;
      ScrDyn *acc = NULL;
      if (argc > 1) {
        acc = scr_dyn_retain(args[1]);
      } else {
        /* the first PRESENT element seeds the accumulator */
        for (; k < len0 && acc == NULL; k++) {
          const size_t i = right ? len0 - 1 - k : k;
          if (i < recv->v.arr.len) acc = scr_dyn_retain(recv->v.arr.items[i]);
        }
        if (acc == NULL) {
          static const char msg[] = "Reduce of empty array with no initial value";
          scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
          return NULL;
        }
      }
      for (; k < len0; k++) {
        const size_t i = right ? len0 - 1 - k : k;
        if (i >= recv->v.arr.len) continue; /* the callback shrank it: a missing index is skipped */
        ScrDyn *item = scr_dyn_retain(recv->v.arr.items[i]);
        ScrDyn *idx = scr_dyn_new_num((double)i);
        ScrDyn *av[4] = { acc, item, idx, recv };
        scr_dyn_this_push_dyn(scr_dyn_undefined());
        ScrDyn *r = scr_dyn_call(cb, av, 4, "callback");
        scr_dyn_this_pop();
        scr_dyn_release(item);
        scr_dyn_release(idx);
        scr_dyn_release(acc);
        if (r == NULL) return NULL;
        acc = r;
      }
      return acc;
    }
    if (dyn_name_is(method, "findLast") || dyn_name_is(method, "findLastIndex")) {
      const bool wantIndex = dyn_name_is(method, "findLastIndex");
      if (!dyn_cb_check(args, argc)) return NULL;
      ScrDyn *cb = args[0];
      ScrDyn *thisArg = argc > 1 ? args[1] : scr_dyn_undefined();
      const size_t len0 = recv->v.arr.len;
      for (size_t step = 0; step < len0; step++) {
        const size_t i = len0 - 1 - step;
        /* findLast visits EVERY index (a shrunk one reads undefined) */
        ScrDyn *item = i < recv->v.arr.len ? scr_dyn_retain(recv->v.arr.items[i]) : scr_dyn_retain(scr_dyn_undefined());
        scr_dyn_this_push_dyn(thisArg);
        ScrDyn *r = dyn_call_cb(cb, item, i, recv);
        scr_dyn_this_pop();
        if (r == NULL) { scr_dyn_release(item); return NULL; }
        const bool hit = scr_dyn_truthy(r);
        scr_dyn_release(r);
        if (hit) {
          if (wantIndex) { scr_dyn_release(item); return scr_dyn_new_num((double)i); }
          return item;
        }
        scr_dyn_release(item);
      }
      return wantIndex ? scr_dyn_new_num(-1) : scr_dyn_retain(scr_dyn_undefined());
    }
    if (dyn_name_is(method, "toReversed")) {
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = recv->v.arr.len; i-- > 0;) scr_dyn_arr_push(out, scr_dyn_retain(recv->v.arr.items[i]));
      return out;
    }
    if (dyn_name_is(method, "flat")) {
      /* depth defaults to 1 only when absent/undefined; NaN and negatives
       * mean 0; Infinity flattens fully (dyn_index_arg is
       * ToIntegerOrInfinity). */
      double depth = dyn_index_arg(args, argc, 0, 1, what);
      if (scr_exc_pending()) return NULL;
      ScrDyn *out = scr_dyn_new_arr();
      if (!dyn_flatten_into(out, recv, depth)) { scr_dyn_release(out); return NULL; }
      return out;
    }
    if (dyn_name_is(method, "toSpliced")) {
      double startD = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      size_t start = dyn_rel_index(startD, len);
      size_t del;
      if (argc == 0) {
        del = 0;
      } else if (argc == 1) {
        del = len - start;
      } else {
        double dc = dyn_index_arg(args, argc, 1, 0, what);
        if (scr_exc_pending()) return NULL;
        double cap = (double)(len - start);
        del = dc <= 0 ? 0 : (dc >= cap ? len - start : (size_t)dc);
      }
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = 0; i < start; i++) scr_dyn_arr_push(out, scr_dyn_retain(recv->v.arr.items[i]));
      for (size_t i = 2; i < argc; i++) scr_dyn_arr_push(out, scr_dyn_retain(args[i]));
      for (size_t i = start + del; i < len; i++) scr_dyn_arr_push(out, scr_dyn_retain(recv->v.arr.items[i]));
      return out;
    }
    if (dyn_name_is(method, "toSorted")) {
      ScrDyn *cmp = argc > 0 ? args[0] : scr_dyn_undefined();
      if (cmp->kind != SCR_DYN_UNDEF && cmp->kind != SCR_DYN_FUNC) {
        scr_dyn_comparefn_throw(cmp);
        return NULL;
      }
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = 0; i < recv->v.arr.len; i++) scr_dyn_arr_push(out, scr_dyn_retain(recv->v.arr.items[i]));
      if (out->v.arr.len > 1 && !dyn_arr_sort(out, cmp->kind == SCR_DYN_FUNC ? cmp : NULL)) {
        scr_dyn_release(out);
        return NULL;
      }
      return out;
    }
    if (dyn_name_is(method, "with")) {
      double rel = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      const double actual = rel >= 0 ? rel : (double)len + rel;
      if (!(actual >= 0 && actual < (double)len)) {
        ScrJsonBuf b;
        scr_jb_init(&b);
        scr_jb_puts(&b, "Invalid index : ");
        scr_dyn_display_buf(&b, argc > 0 ? args[0] : scr_dyn_undefined());
        scr_throw_error(SCR_ERR_RANGE, scr_jb_finish(&b));
        return NULL;
      }
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = 0; i < recv->v.arr.len; i++) {
        scr_dyn_arr_push(out, scr_dyn_retain(i == (size_t)actual && argc > 1 ? args[1]
                                             : i == (size_t)actual ? scr_dyn_undefined()
                                                                   : recv->v.arr.items[i]));
      }
      return out;
    }
    if (dyn_name_is(method, "flatMap")) {
      /* JS Array.prototype.flatMap over a dyn array: map + a depth-1
       * flatten. Native dyn-array results flatten element-by-element; a
       * WRAPPED engine array flattens through the routed keyed reads
       * (elements wrap back scalar-normalized); everything else pushes
       * as a single element (JS keeps non-array callback results whole).
       * JS's spec snapshots the length up front (elements appended by
       * the callback are not visited). */
      if (!dyn_cb_check(args, argc)) return NULL;
      ScrDyn *cb = args[0];
      ScrDyn *out = scr_dyn_new_arr();
      size_t n = recv->v.arr.len;
      for (size_t i = 0; i < n && i < recv->v.arr.len; i++) {
        ScrDyn *item = scr_dyn_retain(recv->v.arr.items[i]);
        ScrDyn *r = dyn_call_cb(cb, item, i, recv);
        scr_dyn_release(item);
        if (!r) { scr_dyn_release(out); return NULL; }
        if (r->kind == SCR_DYN_ARR) {
          for (size_t j = 0; j < r->v.arr.len; j++) {
            scr_dyn_arr_push(out, scr_dyn_retain(r->v.arr.items[j]));
          }
          scr_dyn_release(r);
        } else if (scr_dyn_isl_is_array(r)) {
          /* An engine-array result: length + element reads through the
           * routed engine ops (a bridged surprise unwinds). */
          ScrStr *lk = scr_str_new("length", 6);
          ScrDyn *lenv = scr_dyn_isl_key_get(r, lk);
          scr_str_release(lk);
          if (!lenv) { scr_dyn_release(r); scr_dyn_release(out); return NULL; }
          size_t rn = lenv->kind == SCR_DYN_NUM ? (size_t)lenv->v.num : 0;
          scr_dyn_release(lenv);
          for (size_t j = 0; j < rn; j++) {
            char idx[24];
            int ilen = snprintf(idx, sizeof idx, "%zu", j);
            ScrStr *jk = scr_str_new(idx, (size_t)ilen);
            ScrDyn *el = scr_dyn_isl_key_get(r, jk);
            scr_str_release(jk);
            if (!el) { scr_dyn_release(r); scr_dyn_release(out); return NULL; }
            scr_dyn_arr_push(out, el); /* ownership moves in */
          }
          scr_dyn_release(r);
        } else {
          scr_dyn_arr_push(out, r); /* ownership moves in */
        }
      }
      return out;
    }
    if (dyn_name_is(method, "sort")) {
      ScrDyn *cmp = argc > 0 ? args[0] : scr_dyn_undefined();
      if (cmp->kind != SCR_DYN_UNDEF && cmp->kind != SCR_DYN_FUNC) {
        scr_dyn_comparefn_throw(cmp); /* V8 appends the offender's string image */
        return NULL;
      }
      if (len > 1 && !dyn_arr_sort(recv, cmp->kind == SCR_DYN_FUNC ? cmp : NULL)) return NULL;
      return scr_dyn_retain(recv);
    }
    if (dyn_name_is(method, "splice")) {
      /* ES 23.1.3.36. The three argument counts are genuinely different
       * operations and Node's own answers, measured: splice() deletes
       * NOTHING (actualDeleteCount 0), splice(start) deletes the whole
       * TAIL, and splice(start, n) deletes n. An in-band default for the
       * count cannot express that split, so argc decides it. */
      double startD = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      size_t start = dyn_rel_index(startD, len);
      size_t del;
      if (argc == 0) {
        del = 0;
      } else if (argc == 1) {
        del = len - start;
      } else {
        double dc = dyn_index_arg(args, argc, 1, 0, what);
        if (scr_exc_pending()) return NULL;
        double cap = (double)(len - start);
        del = dc <= 0 ? 0 : (dc >= cap ? len - start : (size_t)dc);
      }
      size_t ins = argc > 2 ? argc - 2 : 0;
      size_t tail = len - start - del;
      size_t newLen = len - del + ins;
      /* The removed run leaves FIRST, and its references TRANSFER to the
       * result — nothing below releases those slots, which is what makes
       * the moves that follow reference-neutral. */
      ScrDyn *out = scr_dyn_new_arr();
      for (size_t i = 0; i < del; i++) scr_dyn_arr_push(out, recv->v.arr.items[start + i]);
      /* Room for a longer array comes from the ordinary push path (it owns
       * capacity growth). EVERY slot above the old length is overwritten below
       * — [start, start+ins) by the inserts and [start+ins, newLen) by the
       * tail — so the placeholders are dropped rather than read, and the
       * release below is what balances the push's +1 without leaning on
       * the fact that undefined happens to be immortal. */
      while (recv->v.arr.len < newLen) scr_dyn_arr_push(recv, scr_dyn_retain(scr_dyn_undefined()));
      for (size_t i = len; i < newLen; i++) scr_dyn_release(recv->v.arr.items[i]);
      memmove(recv->v.arr.items + start + ins, recv->v.arr.items + start + del,
              tail * sizeof(ScrDyn *));
      for (size_t i = 0; i < ins; i++) recv->v.arr.items[start + i] = scr_dyn_retain(args[i + 2]);
      recv->v.arr.len = newLen;
      return out;
    }
    if (dyn_name_is(method, "toString")) {
      /* Array.prototype.toString is join(",") and takes NO argument --
       * `[1,2,3].toString(16)` is "1,2,3" in Node, the radix ignored. The
       * DOT spelling reaches this through the dyn method surface now that
       * a non-literal argument routes here instead of fencing in the
       * frontend, so the name has to answer rather than refuse. One body:
       * scr_dyn_to_string's ARR arm, the same one String(a) uses. */
      ScrStr *s = scr_dyn_to_string(recv, NULL);
      if (scr_exc_pending()) { if (s) scr_str_release(s); return NULL; }
      ScrDyn *d = scr_dyn_new_str(s);
      scr_str_release(s);
      return d;
    }
    if (dyn_name_is(method, "toLocaleString") && dyn_locale_answerable(args, argc)) {
      ScrStr *s = dyn_locale_str(recv, 0, argc >= 1 ? args[0] : NULL, argc >= 2 ? args[1] : NULL);
      if (s == NULL) return NULL;
      ScrDyn *d = scr_dyn_new_str(s);
      scr_str_release(s);
      return d;
    }
    if (dyn_iter_name_mode(method) != 0) return dyn_seq_snapshot(recv, dyn_iter_name_mode(method));
    if (dyn_arr_proto_unimpl(method)) {
      dyn_throw_unsupported("Array", method);
      return NULL;
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  /* PROMISE receivers: the then/catch/finally reactions ride the fiber
   * machinery (scr_dyn_promise_then — microtask-exact ordering); every
   * other Promise.prototype name is `then`-adjacent sugar JS doesn't
   * have, so the not-a-function answer IS the JS answer. */
  if (recv->kind == SCR_DYN_PROMISE) {
    if (dyn_name_is(method, "then")) {
      return scr_dyn_promise_then(recv->v.promise, argc >= 1 ? args[0] : NULL,
                                  argc >= 2 ? args[1] : NULL, NULL);
    }
    if (dyn_name_is(method, "catch")) {
      return scr_dyn_promise_then(recv->v.promise, NULL, argc >= 1 ? args[0] : NULL, NULL);
    }
    if (dyn_name_is(method, "finally")) {
      return scr_dyn_promise_then(recv->v.promise, NULL, NULL, argc >= 1 ? args[0] : NULL);
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  /* An ArrayBuffer (the value `x.buffer` answers): slice copies a byte
   * range into a fresh buffer; a fixed-length buffer cannot resize (V8's
   * incompatible-receiver TypeError); transfer detaches its receiver, which
   * this tier cannot represent, so it refuses by name. */
  if (recv->kind == SCR_DYN_ARRBUF) {
    ScrBytes *ab = recv->v.bytes;
    if (dyn_name_is(method, "slice")) {
      double s = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double e = dyn_index_arg(args, argc, 1, (double)ab->len, what);
      if (scr_exc_pending()) return NULL;
      size_t si = dyn_rel_index(s, ab->len), ei = dyn_rel_index(e, ab->len);
      size_t count = ei > si ? ei - si : 0;
      ScrBytes *out = scr_bytes_new(SCR_BYTES_BUF, (double)count);
      if (out == NULL) return NULL;
      if (count > 0) memcpy(out->data, ab->data + si, count);
      ScrDyn *d = scr_dyn_new_arrbuf_ref(out);
      scr_bytes_release(out);
      return d;
    }
    if (dyn_name_is(method, "resize")) {
      static const char msg[] = "Method ArrayBuffer.prototype.resize called on incompatible receiver #<ArrayBuffer>";
      scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
      return NULL;
    }
    if (dyn_name_is(method, "transfer") || dyn_name_is(method, "transferToFixedLength")) {
      dyn_throw_unsupported("ArrayBuffer", method);
      return NULL;
    }
    if (dyn_name_is(method, "toString")) {
      ScrStr *ts = scr_str_new("[object ArrayBuffer]", 20);
      ScrDyn *td = scr_dyn_new_str(ts);
      scr_str_release(ts);
      return td;
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  if (recv->kind == SCR_DYN_BYTES && recv->v.bytes->flavor == SCR_BF_DATAVIEW) {
    /* A DataView answers its accessors and NOTHING of the typed-array
     * surface (no at/slice/subarray/fill/...): the name is a DataView
     * method or it falls through to Object.prototype's, whose answer for
     * a name nobody declares is JS's is-not-a-function. */
    const DynDvMethod *dm = dyn_dv_lookup(method);
    if (dm != NULL) return dyn_dataview_invoke(recv, dm, args, argc);
    if (dyn_name_is(method, "toString")) {
      /* Object.prototype.toString: a DataView declares none of its own,
       * and its @@toStringTag is "DataView". */
      ScrStr *ts = scr_str_new("[object DataView]", 17);
      ScrDyn *td = scr_dyn_new_str(ts);
      scr_str_release(ts);
      return td;
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  if (recv->kind == SCR_DYN_BYTES) {
    if (dyn_iter_name_mode(method) != 0) return dyn_seq_snapshot(recv, dyn_iter_name_mode(method));
    /* The typed-array methods live in scr_json.c — ONE body, shared with
     * the %TypedArray%.prototype thunks, so `b.subarray(1, 3)` and
     * `Uint8Array.prototype.subarray.call(b, 1, 3)` cannot answer
     * differently. A name that is no method of this kind at all falls
     * through to JS's is-not-a-function below. */
    /* Buffer.prototype.toLocaleString IS Buffer.prototype.toString (an
     * alias in Node), so a Buffer decodes; a plain typed array joins its
     * elements' locale answers. */
    if (dyn_name_is(method, "toLocaleString") && (recv->buffer || recv->v.bytes->flavor == SCR_BF_BUFFER)) {
      bool tk = false;
      ScrDyn *tr = scr_dyn_bytes_method(recv, "toString", args, argc, what, &tk);
      if (tk) return tr;
    }
    if (dyn_name_is(method, "toLocaleString") && dyn_locale_answerable(args, argc)) {
      ScrStr *ls = dyn_locale_str(recv, 0, argc >= 1 ? args[0] : NULL, argc >= 2 ? args[1] : NULL);
      if (ls == NULL) return NULL;
      ScrDyn *ld = scr_dyn_new_str(ls);
      scr_str_release(ls);
      return ld;
    }
    bool known = false;
    ScrDyn *r = scr_dyn_bytes_method(recv, method, args, argc, what, &known);
    if (known) return r;
  }

  /* NUMBER and BOOLEAN receivers. Before this arm they had no method of
   * any kind: `n[k]()` for k="toString" fell through to
   * dyn_object_proto_method and answered "is not a function", which Node
   * never says about a number's toString. The DOT spelling answers it
   * from the frontend (dyn.toString, and num.toStringRadix for the radix
   * form); this arm answers from the SAME two runtime entry points, so
   * `n.toString(2)` and `n[k](2)` are one answer computed once.
   *
   * `this` binding is not at issue here and never was -- these methods
   * read the receiver through `recv`, not through the ambient window. */
  if (recv->kind == SCR_DYN_NUM || recv->kind == SCR_DYN_BOOL) {
    /* Boolean.prototype has no toLocaleString of its own: Object.prototype's runs toString. */
    if (dyn_name_is(method, "toString") || (recv->kind == SCR_DYN_BOOL && dyn_name_is(method, "toLocaleString"))) {
      if (recv->kind == SCR_DYN_NUM && argc >= 1 && args[0]->kind != SCR_DYN_UNDEF) {
        double radix = dyn_index_arg(args, argc, 0, 10, what);
        if (scr_exc_pending()) return NULL;
        ScrStr *rs = scr_num_to_str_radix(recv->v.num, radix);
        if (scr_exc_pending()) { if (rs) scr_str_release(rs); return NULL; }
        ScrDyn *d = scr_dyn_new_str(rs);
        scr_str_release(rs);
        return d;
      }
      ScrStr *rs = scr_dyn_to_string(recv, NULL);
      if (scr_exc_pending()) { if (rs) scr_str_release(rs); return NULL; }
      ScrDyn *d = scr_dyn_new_str(rs);
      scr_str_release(rs);
      return d;
    }
    /* Number.prototype.toFixed: the
     * SAME runtime formatters the static spelling calls (num.toFixed0 /
     * num.toFixed), so a dyn receiver and a typed one
     * answer alike. toFixed's digits argument is ToIntegerOrInfinity'd and
     * range-checked inside scr_num_to_fixed (V8's RangeError text). A BOOLEAN
     * has none of these names (they are Number's), so it meets the
     * not-a-function ladder below like any other missing member. */
    if (recv->kind == SCR_DYN_NUM && dyn_name_is(method, "toFixed")) {
      ScrStr *rs;
      if (argc == 0 || args[0]->kind == SCR_DYN_UNDEF) {
        rs = scr_num_to_fixed0(recv->v.num);
      } else {
        double digits = dyn_index_arg(args, argc, 0, 0, what);
        if (scr_exc_pending()) return NULL;
        rs = scr_num_to_fixed(recv->v.num, digits);
      }
      if (scr_exc_pending()) {
        if (rs) scr_str_release(rs);
        return NULL;
      }
      ScrDyn *d = scr_dyn_new_str(rs);
      scr_str_release(rs);
      return d;
    }
    /* valueOf falls through to dyn_object_proto_method with every other
     * kind's -- one body, one answer. */
    if ((recv->kind == SCR_DYN_NUM || recv->kind == SCR_DYN_BIG) && dyn_name_is(method, "toLocaleString") && dyn_locale_answerable(args, argc)) {
      ScrStr *s = dyn_locale_str(recv, 0, argc >= 1 ? args[0] : NULL, argc >= 2 ? args[1] : NULL);
      if (s == NULL) return NULL;
      ScrDyn *d = scr_dyn_new_str(s);
      scr_str_release(s);
      return d;
    }
    if (recv->kind == SCR_DYN_NUM && dyn_num_proto_unimpl(method)) {
      dyn_throw_unsupported("Number", method);
      return NULL;
    }
    return dyn_object_proto_method(recv, method, args, argc, what);
  }

  if (recv->kind == SCR_DYN_BIG && dyn_name_is(method, "toLocaleString") && dyn_locale_answerable(args, argc)) {
    ScrStr *s = dyn_locale_str(recv, 0, argc >= 1 ? args[0] : NULL, argc >= 2 ? args[1] : NULL);
    if (s == NULL) return NULL;
    ScrDyn *d = scr_dyn_new_str(s);
    scr_str_release(s);
    return d;
  }

  /* NUM/BOOL/BYTES-remainder: no method of this KIND — but every one of
   * them still inherits Object.prototype, so the is-not-a-function answer
   * is the fallback inside, not this line. */
  return dyn_object_proto_method(recv, method, args, argc, what);
}

/* The attribute half of ES's ValidateAndApplyPropertyDescriptor, which is
 * the rule everything below turns on and the one that is easy to get
 * silently wrong: a field the descriptor OMITS defaults to FALSE only
 * when the property is being CREATED. Over an EXISTING property the
 * current value is KEPT — and every own member of a dynamic object is
 * enumerable, writable and configurable, so a bare
 * `Object.defineProperty(o, "k", { value: v })` over `o.k = 1` leaves an
 * ORDINARY member behind rather than making a hidden one.
 *
 * Getting this backwards is not a throw, it is a key quietly leaving
 * Object.keys — so it is computed once, here, and every arm reads it. */
typedef struct { bool enumerable, writable, configurable; } DynAttrs;

static DynAttrs dyn_effective_attrs(ScrDyn *target, const char *key, size_t key_len,
                                    ScrDyn *desc) {
  bool curEnum = false, curWrite = false, curConf = false;
  if (target->kind == SCR_DYN_OBJ) {
    if (scr_dyn_obj_get(target, key, key_len) != NULL) {
      /* An own member: enumerable, writable and configurable, all three,
       * because that is the only data property `entries` can hold. */
      curEnum = curWrite = curConf = true;
    } else {
      /* An own hidden property, or nothing — in which case the three
       * stay false, which IS the creation default.
       *
       * `curEnum` comes out of the SAME call now rather than staying
       * false: an ENUMERABLE accessor is a hidden property whose
       * `enumerable` is true, and the arm above cannot see it because
       * scr_dyn_obj_get answers NULL for its slot. Leaving it false
       * would make a bare `{ get }` redefinition over an enumerable
       * accessor silently DEMOTE the key out of Object.keys, which is
       * the exact class of error this function exists to prevent. */
      scr_dyn_obj_hidden_attrs(target, key, key_len, NULL, &curWrite, &curConf, &curEnum);
    }
  }
  ScrDyn *en = scr_dyn_obj_get(desc, "enumerable", 10);
  ScrDyn *wr = scr_dyn_obj_get(desc, "writable", 8);
  ScrDyn *cf = scr_dyn_obj_get(desc, "configurable", 12);
  DynAttrs a;
  a.enumerable = en != NULL ? scr_dyn_truthy(en) : curEnum;
  a.writable = wr != NULL ? scr_dyn_truthy(wr) : curWrite;
  a.configurable = cf != NULL ? scr_dyn_truthy(cf) : curConf;
  return a;
}

/* The ACCESSOR half of a descriptor, shared by both spellings so the
 * singular and plural forms cannot disagree about what `{get,set}` means.
 * `api` is the caller's own name — Node spells it in every message.
 *
 * An OBJ target stores the pair as a real accessor property: reads call
 * the getter and writes the setter, both with `this` bound to the
 * RECEIVER, and the key stays OFF Object.keys. That is the
 * `pbjs --target static-module` shape,
 *
 *     Object.defineProperty(Message.prototype, "_f", {
 *       get: util.oneOfGetter(g), set: util.oneOfSetter(g) });
 *
 * repeated 2 920 times in the shipped protobuf bundle, whose whole job is
 * that `_f` reads run a function while `Object.keys(msg)` never mentions
 * it. Both halves are exact here (scr_json.c's accessor block).
 *
 * An EFFECTIVE `enumerable: true` used to be a refusal here, and its
 * message was the statement of a real blocker: Object.keys reads
 * `entries` and an accessor never entered it, so admitting the flag
 * would have answered a key set Node disagrees with. It lands now. The
 * accessor's descriptor still goes to `hidden`; what changed is that an
 * enumerable one ALSO takes a SLOT in `entries` — a position holder
 * carrying the key and nothing else — so scr_dyn_obj_key_order, the one
 * own-key projection this runtime has, lists the name where JS lists it.
 * scr_dyn_acc_slot's header comment is the whole representation.
 *
 * "Effective" was, and remains, the subtlety: ES only defaults an omitted
 * attribute to false when the property is being CREATED — over an
 * EXISTING one the omitted flags are KEPT — and every own member of a
 * dynamic object is enumerable. So a bare `{get}` over `o.k = v` is an
 * ENUMERABLE accessor in Node, and is one here.
 *
 * ONE shape stays LOUD rather than answer wrongly:
 *   FUNC target      a function's own properties live in its CLOSURE's
 *                    table, read through scr_dyn_fn_get rather than the
 *                    OBJ accessor walk; a half-wired accessor there would
 *                    answer undefined instead of running.
 *
 * Returns false with a pending catchable throw. Everything borrowed. */
static bool dyn_define_accessor_desc(ScrDyn *target, const char *key, size_t key_len,
                                     ScrDyn *desc, ScrDyn *getter, ScrDyn *setter,
                                     const char *api) {
  if (target->kind != SCR_DYN_OBJ) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, api);
    scr_jb_puts(&b, " with an accessor (get/set) descriptor on a dynamic FUNCTION value"
                    " is not supported yet (a function's own properties live in its closure's"
                    " table, which the accessor walk does not reach — define the accessor on a"
                    " plain object or on a prototype object)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return false;
  }
  DynAttrs at = dyn_effective_attrs(target, key, key_len, desc);
  /* Node's own check, and it fires before anything is stored. */
  bool badGet = getter != NULL && getter->kind != SCR_DYN_FUNC && getter->kind != SCR_DYN_UNDEF;
  bool badSet = setter != NULL && setter->kind != SCR_DYN_FUNC && setter->kind != SCR_DYN_UNDEF;
  if (badGet || badSet) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, badGet ? "Getter must be a function: " : "Setter must be a function: ");
    scr_dyn_diag_buf(&b, badGet ? getter : setter);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return false;
  }
  scr_dyn_obj_define_accessor(target, key, key_len,
                              getter ? getter : scr_dyn_undefined(),
                              setter ? setter : scr_dyn_undefined(),
                              at.configurable, at.enumerable);
  return true;
}

/* The DATA half of a descriptor, exact-or-loud, shared by the singular
 * `Object.defineProperty` and by `Object.create(proto, descriptors)`.
 *
 * `Object.defineProperty` defaults every flag to FALSE, so the bare
 * `{ value: v }` Node writes is a NON-ENUMERABLE, NON-WRITABLE property:
 * it stays out of Object.keys and assigning to it throws in strict mode.
 * That shape now HAS a representation — the OBJ node's `hidden` table
 * grew a data family beside its accessor one — so it is answered rather
 * than refused, `writable` and `configurable` carried along and honored
 * by [[Set]] and [[Delete]].
 *
 * Two shapes stay LOUD, and the enumerable one is the interesting half:
 *
 *   enumerable: true, writable: false   an ENUMERABLE non-writable
 *      property. It has to live in `entries` to be enumerated, and an
 *      entry carries no flags, so the write JS refuses would be accepted
 *      silently. (enumerable + writable IS an ordinary member, exactly,
 *      and is stored as one — `configurable` is accepted and ignored
 *      there, observable only through delete and redefinition.)
 *
 *   a FUNC target with any non-default flag
 *      a function's own properties live in the CLOSURE's table, read
 *      through scr_dyn_fn_get, which has no attribute room at all.
 *
 * Returns false with a pending catchable throw. Everything borrowed. */
static bool dyn_define_data_desc(ScrDyn *target, const char *key, size_t key_len,
                                 ScrDyn *desc, const char *api) {
  ScrDyn *value = scr_dyn_obj_get(desc, "value", 5);
  if (!value) {
    /* A descriptor that OMITS `value` over an EXISTING data property
     * keeps the current one — ES defaults an omitted field to `undefined`
     * only on CREATION, exactly as it defaults the flags to false only
     * on creation, and the flags half of that rule is already computed
     * below. Taking `undefined` here made
     * `Object.defineProperty(o, "k", { writable: false })` over `o.k = 1`
     * answer `undefined` where Node answers 1: a value silently
     * destroyed by a call that named only an attribute. */
    value = target->kind == SCR_DYN_OBJ ? scr_dyn_obj_own_data(target, key, key_len) : NULL;
    if (!value) value = scr_dyn_undefined();
  }
  DynAttrs at = dyn_effective_attrs(target, key, key_len, desc);
  bool enumerable = at.enumerable, writable = at.writable, configurable = at.configurable;
  if (target->kind != SCR_DYN_OBJ) {
    if (!enumerable || !writable) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, api);
      scr_jb_puts(&b, " with a ");
      scr_jb_puts(&b, !enumerable ? "NON-ENUMERABLE" : "NON-WRITABLE");
      scr_jb_puts(&b, " data descriptor on a dynamic FUNCTION value is not supported yet"
                      " (a function's own properties live in its closure's table, which"
                      " carries no property attributes — spell"
                      " `{ value: v, writable: true, enumerable: true }`, or define the"
                      " property on a plain object)");
      scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
      return false;
    }
    /* The same table the keyed write and scr_dyn_fn_get use — one
     * allocator (scr_dyn_fn_props) so the two spellings of "give this
     * function a property" can never end up with two tables. */
    ScrDyn *table = scr_dyn_fn_props(target); /* +1 */
    scr_dyn_obj_set(table, key, key_len, scr_dyn_retain(value));
    scr_dyn_release(table);
    return true;
  }
  if (enumerable && !writable) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, api);
    scr_jb_puts(&b, " with an ENUMERABLE NON-WRITABLE data descriptor is not supported yet"
                    " (an enumerated key has to live in the member table, whose entries carry"
                    " no attributes — so the write JS refuses would be accepted silently."
                    " A non-enumerable `{ value: v }` descriptor, with or without"
                    " `writable`, compiles exactly)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return false;
  }
  if (enumerable) {
    /* enumerable + writable IS an ordinary own member. Redefining a
     * hidden property into one drops the hidden entry, so the two tables
     * never both claim the key. */
    scr_dyn_obj_drop_hidden(target, key, key_len);
    scr_dyn_obj_set(target, key, key_len, scr_dyn_retain(value));
    return true;
  }
  scr_dyn_obj_define_hidden_data(target, key, key_len, value, writable, configurable);
  return true;
}

/* ONE descriptor onto one target — the whole of ES's
 * DefinePropertyOrThrow as this representation can answer it, and the
 * single installer behind `Object.defineProperty` and
 * `Object.create(proto, descriptors)` so the two spellings cannot
 * disagree about what a descriptor means. Borrows everything; returns
 * false with a pending catchable throw. */
static bool dyn_redefine_refused(ScrDyn *target, const char *key, size_t key_len);

/* A GENERIC descriptor over an EXISTING own ACCESSOR: keep the get/set
 * pair exactly as it is and re-apply only the flags. The pair is
 * BORROWED out of the entry that is about to be replaced, which is safe
 * because scr_dyn_obj_define_accessor retains both halves into the new
 * entry BEFORE the old one is released. */
static bool dyn_redefine_accessor_flags(ScrDyn *target, const char *key, size_t key_len,
                                        ScrDyn *desc) {
  ScrDyn *ent = scr_dyn_obj_get(scr_dyn_ext(target)->hidden, key, key_len);
  if (ent == NULL || ent->kind != SCR_DYN_ARR || ent->v.arr.len < 4) return false;
  DynAttrs at = dyn_effective_attrs(target, key, key_len, desc);
  scr_dyn_obj_define_accessor(target, key, key_len, ent->v.arr.items[1], ent->v.arr.items[2],
                              at.configurable, at.enumerable);
  return true;
}

static bool dyn_define_one(ScrDyn *target, const char *key, size_t key_len,
                           ScrDyn *desc, const char *api) {
  if (desc->kind != SCR_DYN_OBJ) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Property description must be an object: ");
    scr_dyn_diag_buf(&b, desc);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return false;
  }
  if (dyn_redefine_refused(target, key, key_len)) return false;
  /* ES asks HasProperty, not "is it a function": `{ get: f, set: undefined }`
   * — protobufjs's read-only `name` — IS an accessor descriptor. */
  ScrDyn *getter = scr_dyn_obj_get(desc, "get", 3);
  ScrDyn *setter = scr_dyn_obj_get(desc, "set", 3);
  if (getter != NULL || setter != NULL) {
    return dyn_define_accessor_desc(target, key, key_len, desc, getter, setter, api);
  }
  /* A GENERIC descriptor — no `get`, no `set` and no `value`, only flags.
   * ES does not convert the property: it applies the flags the
   * descriptor names and KEEPS everything else, so a generic descriptor
   * over an existing ACCESSOR leaves an accessor. Routing it to the data
   * half instead installed a data property whose value was `undefined`,
   * which turned `Object.defineProperty(o, k, { enumerable: false })`
   * over a getter into a silent loss of the getter. Only reachable at
   * all since an accessor could be enumerable — `{ enumerable: false }`
   * over a NON-enumerable accessor changes nothing and was never
   * spelled — which is why it lands in this block's change. */
  if (scr_dyn_obj_get(desc, "value", 5) == NULL && target->kind == SCR_DYN_OBJ) {
    bool is_data = false;
    if (scr_dyn_obj_hidden_attrs(target, key, key_len, &is_data, NULL, NULL, NULL) &&
        !is_data) {
      return dyn_redefine_accessor_flags(target, key, key_len, desc);
    }
  }
  return dyn_define_data_desc(target, key, key_len, desc, api);
}

/* JS's "Cannot redefine property" for the cases this representation can
 * see: an OWN hidden property — accessor or non-enumerable data — that
 * was not declared `configurable`. Redefining one is a TypeError in
 * Node, and answering silently would let a program install a getter it
 * believes is live over one that is not, or overwrite a sealed constant.
 *
 * DECLARED LIMIT, both directions:
 *   - a non-configurable ENUMERABLE property cannot be recognised: an
 *     entry in the member table carries no flags, so a `{ value }`
 *     define over a key an assignment already created is
 *     indistinguishable from a fresh one.
 *   - ES permits one redefinition of a non-configurable property — the
 *     one that changes NOTHING (same value, same flags, or writable
 *     true→false). This refuses it. That is a LOUD false refusal rather
 *     than a silent wrong answer, and it is the side of the trade the
 *     rest of this file takes. */
static bool dyn_redefine_refused(ScrDyn *target, const char *key, size_t key_len) {
  if (!scr_dyn_obj_hidden_sealed(target, key, key_len)) return false;
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, "Cannot redefine property: ");
  for (size_t i = 0; i < key_len; i++) scr_jb_putc(&b, key[i]);
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  return true;
}

/* Object.defineProperties over dyn values (see scr_runtime.h) — the
 * plural form. Its DATA stance is unchanged and deliberately so: the
 * three flags are accepted and IGNORED, which is a documented divergence
 * with shipped consumers (test/common's _mustCallInner copying
 * name/length). The singular form below does NOT repeat it. */
ScrDyn *scr_dyn_define_props(ScrDyn *target, ScrDyn *descs) {
  /* Island-held operands ARE objects to Node — the non-object TypeError
   * below would be a wrong claim. Loud fence (lane dyn-routing-ops). */
  scr_dyn_isl_fence(target, "Object.defineProperties");
  if (!scr_exc_pending()) scr_dyn_isl_fence(descs, "Object.defineProperties");
  if (scr_exc_pending()) return NULL;
  if (target->kind != SCR_DYN_OBJ && target->kind != SCR_DYN_FUNC) {
    scr_throw_error_msg(SCR_ERR_TYPE, "Object.defineProperties called on non-object",
                        strlen("Object.defineProperties called on non-object"));
    return NULL;
  }
  if (descs->kind != SCR_DYN_OBJ) {
    scr_throw_error_msg(SCR_ERR_TYPE, "Object.defineProperties called on non-object",
                        strlen("Object.defineProperties called on non-object"));
    return NULL;
  }
  /* ES reads each descriptor out of the MAP with [[Get]], so a
   * descriptor delivered by an ENUMERABLE ACCESSOR is legal there; this
   * walk reads the member table and would see the SLOT instead, and
   * "Property description must be an object: undefined" would name the
   * wrong problem. Loud and accurate. */
  scr_dyn_obj_acc_fence(descs, "Object.defineProperties' descriptor map");
  if (scr_exc_pending()) return NULL;
  for (size_t i = 0; i < descs->v.obj.len; i++) {
    ScrDynEntry *ent = &descs->v.obj.entries[i];
    if (ent->value->kind != SCR_DYN_OBJ) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "Property description must be an object: ");
      scr_dyn_diag_buf(&b, ent->value);
      scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
      return NULL;
    }
    if (dyn_redefine_refused(target, ent->key, ent->key_len)) return NULL;
    ScrDyn *getter = scr_dyn_obj_get(ent->value, "get", 3);
    ScrDyn *setter = scr_dyn_obj_get(ent->value, "set", 3);
    if (getter != NULL || setter != NULL) {
      if (!dyn_define_accessor_desc(target, ent->key, ent->key_len, ent->value,
                                    getter, setter, "Object.defineProperties")) {
        return NULL;
      }
      continue;
    }
    ScrDyn *value = scr_dyn_obj_get(ent->value, "value", 5);
    if (!value) value = scr_dyn_undefined();
    if (target->kind == SCR_DYN_OBJ) {
      scr_dyn_obj_drop_hidden(target, ent->key, ent->key_len);
      scr_dyn_obj_set(target, ent->key, ent->key_len, scr_dyn_retain(value));
    } else {
      /* The same table the keyed write and scr_dyn_fn_get use — one
       * allocator (scr_dyn_fn_props) so the two spellings of "give this
       * function a property" can never end up with two tables. */
      ScrDyn *table = scr_dyn_fn_props(target); /* +1 */
      scr_dyn_obj_set(table, ent->key, ent->key_len, scr_dyn_retain(value));
      scr_dyn_release(table);
    }
  }
  return scr_dyn_retain(target);
}

/* Object.defineProperty over a dyn target — the SINGULAR form, and the
 * spelling every non-default descriptor actually arrives in (see
 * scr_runtime.h for the full contract).
 *
 * Everything past the two fences is `dyn_define_one`, which is also what
 * `Object.create(proto, descriptors)` runs over each member of its map:
 * one installer, so the two spellings cannot disagree about what a
 * descriptor means. Its DATA arm is EXACT-OR-LOUD, which is where it
 * parts company with the plural form above — the plural form's three
 * flags are accepted and IGNORED, a grandfathered divergence with
 * shipped consumers that this one does not repeat. */
/* The defineProperty trap of a proxy (or the target's own definition when
 * the handler has none). `throw_on_false` is Object.defineProperty's
 * TypeError; Reflect.defineProperty answers the boolean. */
static bool dyn_px_define_ex(ScrDyn *p, ScrStr *key, ScrDyn *desc, bool throw_on_false) {
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_trap(p, "defineProperty", &threw);
  if (threw) return false;
  if (trap == NULL) {
    ScrDyn *r = scr_dyn_define_prop(p->v.proxy.target, key, desc);
    if (r == NULL) return false;
    scr_dyn_release(r);
    return true;
  }
  ScrDyn *k = scr_dyn_new_str(key); /* retains key */
  ScrDyn *args[3] = {p->v.proxy.target, k, desc};
  scr_dyn_this_push_dyn(p->v.proxy.handler);
  ScrDyn *r = scr_dyn_call(trap, args, 3, "defineProperty");
  scr_dyn_this_pop();
  scr_dyn_release(k);
  scr_dyn_release(trap);
  if (r == NULL) return false;
  bool ok = scr_dyn_truthy(r);
  scr_dyn_release(r);
  if (!ok && throw_on_false) {
    char msg[320];
    int n = snprintf(msg, sizeof msg, "'defineProperty' on proxy: trap returned falsish for property '%.200s'", key->data);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  }
  return ok;
}

bool scr_dyn_reflect_define(ScrDyn *target, ScrStr *key, ScrDyn *desc) {
  if (target->kind == SCR_DYN_PROXY) return dyn_px_define_ex(target, key, desc, false);
  ScrDyn *r = scr_dyn_define_prop(target, key, desc);
  if (r == NULL) return false;
  scr_dyn_release(r);
  return true;
}

ScrDyn *scr_dyn_define_prop(ScrDyn *target, ScrStr *key, ScrDyn *desc) {
  if (target->kind == SCR_DYN_PROXY) {
    /* Object.defineProperty(proxy, ...) answers the proxy itself. */
    if (!dyn_px_define_ex(target, key, desc, true)) return NULL;
    return scr_dyn_retain(target);
  }
  scr_dyn_isl_fence(target, "Object.defineProperty");
  if (!scr_exc_pending()) scr_dyn_isl_fence(desc, "Object.defineProperty");
  if (scr_exc_pending()) return NULL;
  if (target->kind != SCR_DYN_OBJ && target->kind != SCR_DYN_FUNC) {
    scr_throw_error_msg(SCR_ERR_TYPE, "Object.defineProperty called on non-object",
                        strlen("Object.defineProperty called on non-object"));
    return NULL;
  }
  if (!dyn_define_one(target, key->data, key->len, desc, "Object.defineProperty")) return NULL;
  return scr_dyn_retain(target);
}

/* ES's ObjectDefineProperties over an already-created target: every
 * member of `descs` is a property name, its value the descriptor. Shared
 * by both `Object.create` entry points below. Borrowed; false with a
 * pending catchable throw. */
static bool dyn_install_descs(ScrDyn *target, ScrDyn *descs) {
  scr_dyn_isl_fence(descs, "Object.create");
  if (scr_exc_pending()) return false;
  if (descs->kind == SCR_DYN_UNDEF || descs->kind == SCR_DYN_NULL) {
    /* Node's own text — ToObject(undefined/null) is where it fails. */
    const char *m = "Cannot convert undefined or null to object";
    scr_throw_error_msg(SCR_ERR_TYPE, m, strlen(m));
    return false;
  }
  if (descs->kind != SCR_DYN_OBJ) {
    /* ES wraps a primitive here and finds no own enumerable keys, so
     * Node answers a bare `{}`. That is a legal answer this could give,
     * but it is far likelier to be a mistake than an intention, and a
     * quiet empty object is the shape of a bug that surfaces later.
     * Loud, and named. */
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Object.create with a primitive properties-descriptor argument (");
    scr_dyn_diag_buf(&b, descs);
    scr_jb_puts(&b, ") is not supported yet — Node wraps it and finds no own keys,"
                    " answering an empty object; pass a descriptor MAP, or drop the"
                    " second argument");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return false;
  }
  /* The same reason as Object.defineProperties' map: this walk has no
   * getter path, so a descriptor behind one would arrive as the SLOT. */
  scr_dyn_obj_acc_fence(descs, "Object.create's descriptor map");
  if (scr_exc_pending()) return false;
  for (size_t i = 0; i < descs->v.obj.len; i++) {
    ScrDynEntry *ent = &descs->v.obj.entries[i];
    if (!dyn_define_one(target, ent->key, ent->key_len, ent->value, "Object.create")) return false;
  }
  return true;
}

/* `Object.create(proto, descriptors)` — the two-argument form, which ES
 * defines as OrdinaryObjectCreate followed by ObjectDefineProperties,
 * and which is exactly what this is.
 *
 * The order matters and is Node's: the PROTOTYPE is validated (and the
 * object minted) before any descriptor is installed, and a descriptor
 * that refuses leaves the half-built object unreachable — it is released
 * here, so a refusal costs nothing but the throw.
 *
 * This is protobufjs's `util.newError`, whose descriptor map carries two
 * non-enumerable data properties (`constructor`, `toString`) and one
 * getter-only accessor (`name`) — none of which an ordinary own member
 * can stand in for, which is why the shape fenced until the OBJ node had
 * a non-enumerable table to put them in. Both arguments borrowed;
 * returns the created object (+1) or NULL with a pending throw. */
ScrDyn *scr_dyn_obj_create_descs(ScrDyn *proto, ScrDyn *descs) {
  ScrDyn *o = scr_dyn_obj_create_proto(proto); /* +1, or NULL + pending */
  if (o == NULL) return NULL;
  if (!dyn_install_descs(o, descs)) {
    scr_dyn_release(o);
    return NULL;
  }
  return o;
}

/* `Object.create(null, descriptors)`: the same, over the null-prototype
 * dictionary — the shape whose whole point is that it inherits nothing,
 * so every property it has, the descriptor map put there. */
ScrDyn *scr_dyn_obj_create_null_descs(ScrDyn *descs) {
  ScrDyn *o = scr_dyn_new_obj_null_proto(); /* +1, never throws */
  if (!dyn_install_descs(o, descs)) {
    scr_dyn_release(o);
    return NULL;
  }
  return o;
}

/* ── the per-instance property table of a COMPILED class instance ─────
 * Contract, representation and the reason the table cannot escape are in
 * scr_runtime.h. Everything below is the five operations a compiled
 * instance can ask of it; there is no sixth, and that is what makes the
 * private-storage argument checkable rather than aspirational.
 *
 * It lives in THIS unit, not in the always-linked scr_json.c, and that is
 * a measured decision: parked there it cost every binary in the repository
 * 6 144 bytes — the size-class pair in island.test.ts and regex.test.ts
 * caught it on the first gate — for a table almost no program has. The
 * link switch is the property DEFINERS' own (moduleUsesDynInvoke), which
 * already gates scr_dyn_define_prop beside it.
 *
 * The five element readers below are scr_json.c's scr_hid_* by another
 * name. They are copied rather than exported because the LAYOUT is the
 * shared contract (the header states it) and a five-element entry read
 * through a four-element reader is exactly the mistake the shared order
 * exists to prevent. */
static bool clsprop_is_data(const ScrDyn *q) { return scr_dyn_truthy(q->v.arr.items[0]); }
static ScrDyn *clsprop_getter(const ScrDyn *q) { return q->v.arr.items[1]; }
static ScrDyn *clsprop_value(const ScrDyn *q) { return q->v.arr.items[1]; }
static bool clsprop_writable(const ScrDyn *q) { return scr_dyn_truthy(q->v.arr.items[2]); }
static bool clsprop_configurable(const ScrDyn *q) { return scr_dyn_truthy(q->v.arr.items[3]); }
/* The fifth element the `hidden` families do not carry. Absent on a
 * four-element entry, which is what every scr_dyn_obj_put_hidden writes
 * — so a `hidden` entry read through here is non-enumerable, exactly as
 * that table's contract says. */
static bool scr_clsprop_enumerable(const ScrDyn *q) {
  return q->v.arr.len >= 5 && scr_dyn_truthy(q->v.arr.items[4]);
}

ScrDyn *scr_cls_props_ensure(ScrDyn *cur) {
  if (cur != NULL && cur->kind == SCR_DYN_OBJ) return scr_dyn_retain(cur);
  return scr_dyn_new_obj();
}

bool scr_cls_props_has(const ScrDyn *tbl, const ScrStr *key) {
  if (tbl == NULL || tbl->kind != SCR_DYN_OBJ || key == NULL) return false;
  return scr_dyn_obj_get(tbl, key->data, key->len) != NULL;
}

/* How many ENUMERABLE properties the table holds. util.inspect asks
 * before its depth gate: Node prints `C {}` for an object with no own
 * enumerable keys whatever the depth budget says, and a class whose only
 * possible keys are run-time ones cannot answer that at compile time. */
double scr_cls_props_count(const ScrDyn *tbl) {
  if (tbl == NULL || tbl->kind != SCR_DYN_OBJ) return 0;
  size_t n = 0;
  for (size_t i = 0; i < tbl->v.obj.len; i++) {
    const ScrDyn *q = tbl->v.obj.entries[i].value;
    if (q->kind == SCR_DYN_ARR && scr_clsprop_enumerable(q)) n++;
  }
  return (double)n;
}

ScrDyn *scr_cls_props_get(const ScrDyn *tbl, const ScrStr *key) {
  if (tbl == NULL || tbl->kind != SCR_DYN_OBJ || key == NULL) return NULL;
  ScrDyn *ent = scr_dyn_obj_get(tbl, key->data, key->len);
  if (ent == NULL || ent->v.arr.len < 5) return NULL;
  if (clsprop_is_data(ent)) return scr_dyn_retain(clsprop_value(ent));
  ScrDyn *g = clsprop_getter(ent);
  /* A set-only accessor reads `undefined` — JS's answer, not a fence:
   * the property EXISTS and its [[Get]] is undefined. */
  if (g->kind != SCR_DYN_FUNC) return scr_dyn_retain(scr_dyn_undefined());
  /* No `this`: the lowering admits only an ARROW getter, whose `this` is
   * lexical and already captured. A getter that reads `this` would need
   * the compiled instance bound as a dyn receiver, which this table has
   * no way to spell — so the compiler refuses that spelling instead of
   * binding the wrong thing here. */
  return scr_dyn_call(g, NULL, 0, "a property getter");
}

/* `x.k` over the instance property table as a plain READ: +1, never NULL. */
ScrDyn *scr_cls_props_read(const ScrDyn *tbl, const ScrStr *key) {
  ScrDyn *v = scr_cls_props_get(tbl, key);
  if (v != NULL) return v;
  if (scr_exc_pending()) return NULL;
  return scr_dyn_retain(scr_dyn_undefined());
}

/* `x.k = v` over the instance property table: a plain [[Set]]. An existing
 * writable data entry takes the value; a missing key creates the ordinary
 * enumerable, writable, configurable data property; a non-writable data entry
 * and a getter-only accessor throw V8's strict-mode TypeErrors. An accessor
 * WITH a setter has no `this` to run it under here (see scr_cls_props_get) and
 * refuses loudly. */
void scr_cls_props_set(ScrDyn *tbl, const ScrStr *key, const ScrDyn *value) {
  if (tbl == NULL || tbl->kind != SCR_DYN_OBJ || key == NULL) {
    scr_throw_error_msg(SCR_ERR_ERROR, "the instance property table is missing", 37);
    return;
  }
  ScrDyn *ent = scr_dyn_obj_get(tbl, key->data, key->len);
  if (ent != NULL && ent->kind == SCR_DYN_ARR && ent->v.arr.len >= 5) {
    if (clsprop_is_data(ent)) {
      if (!clsprop_writable(ent)) {
        ScrJsonBuf b;
        scr_jb_init(&b);
        scr_jb_puts(&b, "Cannot assign to read only property '");
        scr_jb_write(&b, key->data, key->len);
        scr_jb_puts(&b, "' of object");
        scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
        return;
      }
      ScrDyn *old = ent->v.arr.items[1];
      ent->v.arr.items[1] = scr_dyn_retain((ScrDyn *)value);
      scr_dyn_release(old); /* after the retain: value may BE old */
      return;
    }
    ScrDyn *setter = ent->v.arr.items[2];
    if (setter->kind != SCR_DYN_FUNC) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "Cannot set property ");
      scr_jb_write(&b, key->data, key->len);
      scr_jb_puts(&b, " of #<Object> which has only a getter");
      scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
      return;
    }
    const char *msg = "assigning through an accessor defined on a compiled instance is not supported yet";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, strlen(msg));
    return;
  }
  ScrDyn *fresh = scr_dyn_new_arr();
  scr_dyn_arr_push(fresh, scr_dyn_new_bool(true));
  scr_dyn_arr_push(fresh, scr_dyn_retain((ScrDyn *)value));
  scr_dyn_arr_push(fresh, scr_dyn_new_bool(true));
  scr_dyn_arr_push(fresh, scr_dyn_new_bool(true));
  scr_dyn_arr_push(fresh, scr_dyn_new_bool(true));
  scr_dyn_obj_set(tbl, key->data, key->len, fresh); /* ownership moves in */
}

/* One boolean out of a descriptor: present-and-truthy, present-and-falsy,
 * or absent (which is what ES's ValidateAndApplyPropertyDescriptor keeps
 * the CURRENT value for). */
static bool clsprop_flag(const ScrDyn *desc, const char *name, size_t len,
                         bool current, bool *present) {
  ScrDyn *f = scr_dyn_obj_get(desc, name, len);
  if (present) *present = f != NULL;
  return f != NULL ? scr_dyn_truthy(f) : current;
}

bool scr_cls_props_define(ScrDyn *tbl, const ScrStr *key, ScrDyn *desc,
                          bool declared, const ScrStr *cname) {
  if (tbl == NULL || tbl->kind != SCR_DYN_OBJ || key == NULL) {
    scr_throw_error_msg(SCR_ERR_ERROR,
                        "Object.defineProperty: the instance property table is missing", 58);
    return false;
  }
  if (desc == NULL || desc->kind != SCR_DYN_OBJ) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Property description must be an object");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return false;
  }
  /* A run-time key that names a DECLARED member. Node redefines the
   * struct field; this representation cannot — the field is a typed C
   * cell and the table is beside it, so honouring the define would leave
   * TWO properties of one name, one of which every static read still
   * sees. Loud, and it names the collision. */
  if (declared) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Object.defineProperty on a compiled ");
    if (cname != NULL) scr_jb_write(&b, cname->data, cname->len);
    else scr_jb_puts(&b, "class");
    scr_jb_puts(&b, " instance with the run-time key \"");
    scr_jb_write(&b, key->data, key->len);
    scr_jb_puts(&b, "\", which names a member the class DECLARES, is not supported yet"
                    " (the declared member is a typed C field and the run-time table is"
                    " beside it, so the define would leave two properties of one name and"
                    " every statically-typed read would still see the field). Define a key"
                    " the class does not declare");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return false;
  }
  ScrDyn *getter = scr_dyn_obj_get(desc, "get", 3);
  ScrDyn *setter = scr_dyn_obj_get(desc, "set", 3);
  ScrDyn *value = scr_dyn_obj_get(desc, "value", 5);
  bool wr_present = false;
  bool writable = clsprop_flag(desc, "writable", 8, false, &wr_present);
  bool is_acc = getter != NULL || setter != NULL;
  bool is_data = value != NULL || wr_present;
  if (is_acc && is_data) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Invalid property descriptor. Cannot both specify accessors and a value"
                    " or writable attribute, #<Object>");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return false;
  }
  /* ES keeps every field the descriptor OMITS when the property already
   * EXISTS, and defaults it to false only on creation. The table is the
   * only place such a property can live, so `current` is read from it
   * and from nowhere else. */
  ScrDyn *cur = scr_dyn_obj_get(tbl, key->data, key->len);
  bool curEnum = false, curConf = false, curWrite = false;
  if (cur != NULL && cur->v.arr.len >= 5) {
    curEnum = scr_clsprop_enumerable(cur);
    curConf = clsprop_configurable(cur);
    curWrite = clsprop_is_data(cur) && clsprop_writable(cur);
    if (!curConf) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "Cannot redefine property: ");
      scr_jb_write(&b, key->data, key->len);
      scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
      return false;
    }
  }
  bool enumerable = clsprop_flag(desc, "enumerable", 10, curEnum, NULL);
  bool configurable = clsprop_flag(desc, "configurable", 12, curConf, NULL);
  if (!wr_present) writable = curWrite;
  if (is_acc) {
    bool badGet = getter != NULL && getter->kind != SCR_DYN_FUNC && getter->kind != SCR_DYN_UNDEF;
    bool badSet = setter != NULL && setter->kind != SCR_DYN_FUNC && setter->kind != SCR_DYN_UNDEF;
    if (badGet || badSet) {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, badGet ? "Getter must be a function: " : "Setter must be a function: ");
      char lite[128];
      scr_jb_puts(&b, scr_dyn_inspect_lite(badGet ? getter : setter, lite, sizeof lite));
      scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
      return false;
    }
  }
  ScrDyn *ent = scr_dyn_new_arr();
  scr_dyn_arr_push(ent, scr_dyn_new_bool(!is_acc));
  scr_dyn_arr_push(ent, scr_dyn_retain(is_acc ? (getter ? getter : scr_dyn_undefined())
                                              : (value ? value : scr_dyn_undefined())));
  scr_dyn_arr_push(ent, is_acc ? scr_dyn_retain(setter ? setter : scr_dyn_undefined())
                               : scr_dyn_new_bool(writable));
  scr_dyn_arr_push(ent, scr_dyn_new_bool(configurable));
  scr_dyn_arr_push(ent, scr_dyn_new_bool(enumerable));
  scr_dyn_obj_set(tbl, key->data, key->len, ent); /* ownership moves in */
  return true;
}


/* Local copies of two small helpers scr_json.c keeps static (so its own callers
 * keep them inlined and the always-linked unit exports nothing for them). */
static bool px_key_is_index(const char *key, size_t len, double *out) {
  if (len == 0 || len > 10) return false;
  if (key[0] == '0' && len > 1) return false;
  double v = 0;
  for (size_t i = 0; i < len; i++) {
    if (key[i] < '0' || key[i] > '9') return false;
    v = v * 10 + (key[i] - '0');
  }
  if (v > 4294967294.0) return false;
  *out = v;
  return true;
}

static bool px_is_prim(const ScrDyn *d) {
  if (!d) return false;
  switch (d->kind) {
  case SCR_DYN_NUM:
  case SCR_DYN_STR:
  case SCR_DYN_BOOL:
  case SCR_DYN_NULL:
  case SCR_DYN_UNDEF: return true;
  default: return false;
  }
}

/* ── Proxy (SCR_DYN_PROXY): the operations, in the gated unit ─────────────
 * Forward declarations for the statics the block below defines out of order. */
static void scr_dyn_proxy_install(void);
static ScrDyn *scr_dyn_proxy_walk(ScrDyn *p, int mode_i);
static ScrDyn *scr_dyn_proxy_json_form(ScrDyn *p);
static void scr_px_refuse(const ScrDyn *target, const char *what);

/* ── Proxy (SCR_DYN_PROXY) ─────────────────────────────────────────────
 * `new Proxy(target, handler)`. A proxy is an object whose property
 * operations call the handler's TRAPS: get, set, has, deleteProperty,
 * ownKeys, getOwnPropertyDescriptor and apply are implemented; a trap the
 * handler does not carry runs the operation on the target. A trap that
 * throws propagates; the spec's INVARIANT checks (a non-configurable target
 * property constraining a trap's answer) are not performed, and the traps
 * defineProperty, getPrototypeOf, setPrototypeOf, isExtensible,
 * preventExtensions and construct are not dispatched (an operation that
 * would need one meets the target directly or a named refusal). */

static bool scr_px_is_object(const ScrDyn *v) {
  switch (v->kind) {
  case SCR_DYN_OBJ: case SCR_DYN_ARR: case SCR_DYN_FUNC: case SCR_DYN_OBJINST:
  case SCR_DYN_MAP: case SCR_DYN_BYTES: case SCR_DYN_ARRBUF: case SCR_DYN_HANDLE:
  case SCR_DYN_PROMISE: case SCR_DYN_JSVAL: case SCR_DYN_PROXY:
    return true;
  default:
    return false;
  }
}

ScrDyn *scr_dyn_proxy_new(const ScrDyn *target, const ScrDyn *handler, bool strict) {
  if (!scr_px_is_object(target) || !scr_px_is_object(handler)) {
    static const char msg[] = "Cannot create proxy with a non-object as target or handler";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  if (target->kind == SCR_DYN_OBJINST || handler->kind == SCR_DYN_OBJINST) {
    /* A compiled method takes its instance as a typed struct pointer: it
     * cannot be handed the proxy as `this`, so the traps would be bypassed
     * for every access the method makes. Refused by name rather than
     * silently answering differently. */
    static const char msg[] = "a Proxy over (or handled by) a class instance is not supported yet: its methods run with the instance itself as `this`, so the traps would not see the accesses they make";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
    return NULL;
  }
  ScrDyn *p = scr_dyn_alloc_proxy();
  scr_dyn_proxy_install();
  p->v.proxy.target = scr_dyn_retain((ScrDyn *)target);
  p->v.proxy.handler = scr_dyn_retain((ScrDyn *)handler);
  p->v.proxy.strict = strict;
  p->v.proxy.revoked = false;
  return p;
}

bool scr_dyn_proxy_has_cstr(ScrDyn *p, const char *key, size_t len) {
  ScrStr *k = scr_str_new(key, len);
  bool r = scr_dyn_proxy_has(p, k);
  scr_str_release(k);
  return r;
}

bool scr_dyn_proxy_is_function(const ScrDyn *p) {
  const ScrDyn *t = p->v.proxy.target;
  return t->kind == SCR_DYN_FUNC || (t->kind == SCR_DYN_PROXY && scr_dyn_proxy_is_function(t));
}

static void scr_px_refuse(const ScrDyn *target, const char *what) {
  char msg[200];
  int n = snprintf(msg, sizeof msg, "%s through a Proxy over this kind of target (%s) is not supported yet", what,
                   scr_dyn_kind_name(target));
  scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
}

/* The handler's trap (+1), NULL for none; NULL with the exception pending
 * when reading it threw or it is not callable. */
ScrDyn *scr_dyn_proxy_trap(const ScrDyn *p, const char *name, bool *threw) {
  *threw = false;
  if (p->v.proxy.revoked) {
    char msg[160];
    int n = snprintf(msg, sizeof msg, "Cannot perform '%s' on a proxy that has been revoked", name);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
    *threw = true;
    return NULL;
  }
  ScrDyn *h = p->v.proxy.handler;
  ScrDyn *t = NULL;
  if (h->kind == SCR_DYN_OBJ) {
    t = scr_dyn_obj_key_get(h, name, strlen(name));
  } else if (h->kind == SCR_DYN_PROXY) {
    ScrStr *k = scr_str_new(name, strlen(name));
    t = scr_dyn_proxy_get(h, k);
    scr_str_release(k);
  } else {
    scr_px_refuse(h, "reading a trap");
    *threw = true;
    return NULL;
  }
  if (t == NULL) {
    *threw = true;
    return NULL;
  }
  if (t->kind == SCR_DYN_UNDEF || t->kind == SCR_DYN_NULL) {
    scr_dyn_release(t);
    return NULL;
  }
  if (t->kind != SCR_DYN_FUNC && t->kind != SCR_DYN_PROXY) {
    ScrStr *shown = scr_dyn_to_string(t, NULL);
    char msg[320];
    int n = snprintf(msg, sizeof msg, "'%.120s' returned for property '%s' of object '#<Object>' is not a function",
                     shown != NULL ? shown->data : "?", name);
    if (shown != NULL) scr_str_release(shown);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
    scr_dyn_release(t);
    *threw = true;
    return NULL;
  }
  return t;
}

static ScrDyn *scr_px_call(ScrDyn *handler, ScrDyn *trap, ScrDyn **args, size_t n) {
  scr_dyn_this_push_dyn(handler);
  ScrDyn *r = scr_dyn_call(trap, args, n, "proxy trap");
  scr_dyn_this_pop();
  return r;
}

static ScrDyn *scr_px_key(const ScrStr *k) {
  return scr_dyn_new_str((ScrStr *)k); /* retains */
}

/* [[Get]] on the target itself. */
static ScrDyn *scr_px_target_get(ScrDyn *t, const ScrStr *key) {
  switch (t->kind) {
  case SCR_DYN_OBJ:
    return scr_dyn_obj_key_get(t, key->data, key->len);
  case SCR_DYN_ARR: {
    if (key->len == 6 && memcmp(key->data, "length", 6) == 0) return scr_dyn_new_num((double)t->v.arr.len);
    double idx;
    if (px_key_is_index(key->data, key->len, &idx) && idx < (double)t->v.arr.len) {
      return scr_dyn_retain(t->v.arr.items[(size_t)idx]);
    }
    return scr_dyn_retain(scr_dyn_undefined());
  }
  case SCR_DYN_FUNC: {
    ScrDyn *v = scr_dyn_fn_get(t, key->data, key->len);
    return v != NULL ? v : scr_dyn_retain(scr_dyn_undefined());
  }
  case SCR_DYN_OBJINST: {
    const ScrDynClassMember *m = scr_dyn_objinst_member(t, key->data, key->len);
    if (m == NULL) return scr_dyn_retain(scr_dyn_undefined());
    if (m->get != NULL) return m->get(t->v.inst.o);
    scr_px_refuse(t, "reading a method as a value");
    return NULL;
  }
  case SCR_DYN_PROXY:
    return scr_dyn_proxy_get(t, key);
  default:
    scr_px_refuse(t, "a property read");
    return NULL;
  }
}

ScrDyn *scr_dyn_proxy_get(ScrDyn *p, const ScrStr *key) {
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_trap(p, "get", &threw);
  if (threw) return NULL;
  if (trap == NULL) return scr_px_target_get(p->v.proxy.target, key);
  ScrDyn *k = scr_px_key(key);
  ScrDyn *args[3] = {p->v.proxy.target, k, p};
  ScrDyn *r = scr_px_call(p->v.proxy.handler, trap, args, 3);
  scr_dyn_release(k);
  scr_dyn_release(trap);
  return r;
}

/* [[Set]] on a proxy. Answers the trap's truthiness (true for a trap-less
 * write that landed); `throw_on_false` is the strict-mode TypeError. */
static bool scr_px_set_ex(ScrDyn *p, ScrStr *key, ScrDyn *value, bool throw_on_false) {
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_trap(p, "set", &threw);
  if (threw) return false;
  if (trap == NULL) {
    ScrDyn *t = p->v.proxy.target;
    if (t->kind == SCR_DYN_PROXY || t->kind == SCR_DYN_OBJ || t->kind == SCR_DYN_ARR || t->kind == SCR_DYN_OBJINST ||
        t->kind == SCR_DYN_FUNC) {
      scr_dyn_key_set(t, key, value);
    } else {
      scr_px_refuse(t, "a property write");
    }
    return !scr_exc_pending();
  }
  ScrDyn *k = scr_px_key(key);
  ScrDyn *args[4] = {p->v.proxy.target, k, value, p};
  ScrDyn *r = scr_px_call(p->v.proxy.handler, trap, args, 4);
  scr_dyn_release(k);
  scr_dyn_release(trap);
  if (r == NULL) return false;
  bool ok = scr_dyn_truthy(r);
  scr_dyn_release(r);
  if (!ok && throw_on_false) {
    char msg[320];
    int n = snprintf(msg, sizeof msg, "'set' on proxy: trap returned falsish for property '%.200s'", key->data);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  }
  return ok;
}

void scr_dyn_proxy_set(ScrDyn *p, ScrStr *key, ScrDyn *value) {
  (void)scr_px_set_ex(p, key, value, p->v.proxy.strict);
}

bool scr_dyn_proxy_has(ScrDyn *p, const ScrStr *key) {
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_trap(p, "has", &threw);
  if (threw) return false;
  if (trap == NULL) return scr_dyn_has_key(p->v.proxy.target, key);
  ScrDyn *k = scr_px_key(key);
  ScrDyn *args[2] = {p->v.proxy.target, k};
  ScrDyn *r = scr_px_call(p->v.proxy.handler, trap, args, 2);
  scr_dyn_release(k);
  scr_dyn_release(trap);
  if (r == NULL) return false;
  bool ok = scr_dyn_truthy(r);
  scr_dyn_release(r);
  return ok;
}

static bool scr_px_delete_ex(ScrDyn *p, ScrStr *key, bool throw_on_false);

bool scr_dyn_proxy_delete(ScrDyn *p, ScrStr *key) {
  return scr_px_delete_ex(p, key, p->v.proxy.strict);
}

static bool scr_px_delete_ex(ScrDyn *p, ScrStr *key, bool throw_on_false) {
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_trap(p, "deleteProperty", &threw);
  if (threw) return false;
  if (trap == NULL) return scr_dyn_key_delete(p->v.proxy.target, key);
  ScrDyn *k = scr_px_key(key);
  ScrDyn *args[2] = {p->v.proxy.target, k};
  ScrDyn *r = scr_px_call(p->v.proxy.handler, trap, args, 2);
  scr_dyn_release(k);
  scr_dyn_release(trap);
  if (r == NULL) return false;
  bool ok = scr_dyn_truthy(r);
  scr_dyn_release(r);
  if (!ok && throw_on_false) {
    char msg[320];
    int n = snprintf(msg, sizeof msg, "'deleteProperty' on proxy: trap returned falsish for property '%.200s'", key->data);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
    return false;
  }
  return ok;
}

/* Reflect.set / Reflect.deleteProperty / Reflect.defineProperty over a dyn
 * target: the boolean the operation answers, never the strict-mode TypeError
 * a falsish trap would raise through the property syntax. A write that
 * cannot land on a non-proxy target keeps its loud refusal. */
bool scr_dyn_reflect_set(ScrDyn *recv, ScrStr *key, ScrDyn *value) {
  if (recv->kind == SCR_DYN_PROXY) return scr_px_set_ex(recv, key, value, false);
  scr_dyn_key_set(recv, key, value);
  return !scr_exc_pending();
}

bool scr_dyn_reflect_delete(ScrDyn *recv, ScrStr *key) {
  if (recv->kind == SCR_DYN_PROXY) return scr_px_delete_ex(recv, key, false);
  return scr_dyn_key_delete(recv, key);
}

/* Proxy.revocable: { proxy, revoke }. Revoking marks the proxy; every
 * later operation fails at its trap lookup with V8's TypeError. */
static ScrDyn *scr_px_revoke_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args;
  (void)argc;
  ScrDyn *p = (ScrDyn *)scr_box_get_ref(clo->caps[0]); /* +1 */
  p->v.proxy.revoked = true;
  scr_dyn_release(p);
  return scr_dyn_undefined();
}

ScrDyn *scr_dyn_proxy_revocable(const ScrDyn *target, const ScrDyn *handler, bool strict) {
  ScrDyn *p = scr_dyn_proxy_new(target, handler, strict);
  if (p == NULL) return NULL;
  ScrClosure *clo = scr_closure_new((void *)scr_px_revoke_thunk, 1);
  clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[0], scr_dyn_retain(p));
  ScrDyn *revoke = scr_dyn_new_func(clo, scr_px_revoke_thunk, 0, "()", "");
  ScrDyn *out = scr_dyn_new_obj();
  scr_dyn_obj_set(out, "proxy", 5, p);
  scr_dyn_obj_set(out, "revoke", 6, revoke);
  return out;
}

/* new P(...args) on a proxy (the construct trap): the trap is called with
 * (target, argsArray, newTarget = the proxy) and must answer an object; with
 * no trap the construction runs on the target. */
ScrDyn *scr_dyn_proxy_construct(const ScrDyn *pc, const ScrDyn *args, const ScrStr *what) {
  ScrDyn *p = (ScrDyn *)pc;
  if (!scr_dyn_proxy_is_function(p)) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, what && what->len ? what->data : "value");
    scr_jb_puts(&b, " is not a constructor");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_trap(p, "construct", &threw);
  if (threw) return NULL;
  if (trap == NULL) return scr_dyn_construct(p->v.proxy.target, args, what);
  ScrDyn *argv[3] = {p->v.proxy.target, (ScrDyn *)args, p};
  ScrDyn *r = scr_px_call(p->v.proxy.handler, trap, argv, 3);
  scr_dyn_release(trap);
  if (r == NULL) return NULL;
  if (px_is_prim(r) || r->kind == SCR_DYN_BIG) {
    scr_dyn_release(r);
    static const char msg[] = "proxy [[Construct]] must return an object";
    scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
    return NULL;
  }
  return r;
}

ScrDyn *scr_dyn_proxy_call(const ScrDyn *pc, ScrDyn *const *args, size_t argc, const char *what) {
  ScrDyn *p = (ScrDyn *)pc;
  if (!scr_dyn_proxy_is_function(p)) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, what);
    scr_jb_puts(&b, " is not a function");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  bool threw;
  ScrDyn *trap = scr_dyn_proxy_trap(p, "apply", &threw);
  if (threw) return NULL;
  if (trap == NULL) return scr_dyn_call(p->v.proxy.target, args, argc, what);
  ScrDyn *list = scr_dyn_new_arr();
  for (size_t i = 0; i < argc; i++) scr_dyn_arr_push(list, scr_dyn_retain(args[i]));
  ScrDyn *thisArg = scr_dyn_retain(scr_dyn_undefined());
  ScrDyn *targs[3] = {p->v.proxy.target, thisArg, list};
  ScrDyn *r = scr_px_call(p->v.proxy.handler, trap, targs, 3);
  scr_dyn_release(thisArg);
  scr_dyn_release(list);
  scr_dyn_release(trap);
  return r;
}

/* An own ENUMERABLE string key of the target (the default [[GetOwnProperty]]
 * answer Object.keys needs once ownKeys named the key). */
static bool scr_px_target_enumerable(ScrDyn *t, const ScrStr *key) {
  switch (t->kind) {
  case SCR_DYN_OBJ:
    return scr_dyn_obj_get(t, key->data, key->len) != NULL;
  case SCR_DYN_ARR: {
    double idx;
    return px_key_is_index(key->data, key->len, &idx) && idx < (double)t->v.arr.len;
  }
  case SCR_DYN_OBJINST: {
    const ScrDynClassMember *m = scr_dyn_objinst_member(t, key->data, key->len);
    return m != NULL && m->enumerable != 0 && m->get != NULL;
  }
  case SCR_DYN_PROXY: {
    ScrDyn *keys = scr_dyn_proxy_walk(t, SCR_OBJWALK_KEYS);
    if (keys == NULL) return false;
    bool found = false;
    for (size_t i = 0; i < keys->v.arr.len && !found; i++) {
      const ScrDyn *e = keys->v.arr.items[i];
      found = e->kind == SCR_DYN_STR && e->v.str->len == key->len && memcmp(e->v.str->data, key->data, key->len) == 0;
    }
    scr_dyn_release(keys);
    return found;
  }
  default:
    return false;
  }
}

/* Object.keys / values / entries over a proxy: [[OwnPropertyKeys]] (the
 * ownKeys trap, else the target's), each key filtered by
 * [[GetOwnProperty]]'s enumerable bit (the getOwnPropertyDescriptor trap,
 * else the target's), and for values/entries a [[Get]] through the get
 * trap per key. */
static ScrDyn *scr_dyn_proxy_walk(ScrDyn *p, int mode_i) {
  ScrObjWalk mode = (ScrObjWalk)mode_i;
  bool threw;
  ScrDyn *target = p->v.proxy.target;
  ScrDyn *own = scr_dyn_proxy_trap(p, "ownKeys", &threw);
  if (threw) return NULL;
  ScrDyn *keys;
  if (own != NULL) {
    ScrDyn *targs[1] = {target};
    keys = scr_px_call(p->v.proxy.handler, own, targs, 1);
    scr_dyn_release(own);
    if (keys == NULL) return NULL;
    if (keys->kind != SCR_DYN_ARR) {
      static const char msg[] = "CreateListFromArrayLike called on non-object";
      scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
      scr_dyn_release(keys);
      return NULL;
    }
  } else {
    keys = scr_dyn_objwalk(target, SCR_OBJWALK_KEYS);
    if (keys == NULL) return NULL;
  }
  ScrDyn *gopd = scr_dyn_proxy_trap(p, "getOwnPropertyDescriptor", &threw);
  if (threw) {
    scr_dyn_release(keys);
    return NULL;
  }
  ScrDyn *out = scr_dyn_new_arr();
  ScrDyn *failed = NULL;
  for (size_t i = 0; i < keys->v.arr.len && failed == NULL; i++) {
    ScrDyn *kd = keys->v.arr.items[i];
    if (kd->kind != SCR_DYN_STR) continue; /* symbols are not string keys */
    ScrStr *key = kd->v.str;
    bool enumerable;
    if (gopd != NULL) {
      ScrDyn *args[2] = {target, kd};
      ScrDyn *desc = scr_px_call(p->v.proxy.handler, gopd, args, 2);
      if (desc == NULL) { failed = out; break; }
      enumerable = false;
      if (desc->kind == SCR_DYN_OBJ) {
        const ScrDyn *en = scr_dyn_obj_get(desc, "enumerable", 10);
        enumerable = en != NULL && scr_dyn_truthy(en);
      }
      scr_dyn_release(desc);
    } else {
      enumerable = own == NULL ? true : scr_px_target_enumerable(target, key);
    }
    if (!enumerable) continue;
    if (mode == SCR_OBJWALK_KEYS) {
      scr_dyn_arr_push(out, scr_dyn_retain(kd));
      continue;
    }
    ScrDyn *val = scr_dyn_proxy_get(p, key);
    if (val == NULL) { failed = out; break; }
    scr_dyn_objwalk_push(out, mode, key->data, key->len, val);
    scr_dyn_release(val);
  }
  scr_dyn_release(keys);
  if (gopd != NULL) scr_dyn_release(gopd);
  if (failed != NULL) {
    scr_dyn_release(out);
    return NULL;
  }
  return out;
}

/* The value JSON.stringify sees through a proxy: a fresh ARRAY (target is an
 * array: length, then each index, through the get trap) or OBJECT (the
 * enumerable own string keys through ownKeys/descriptor/get). +1. */
static ScrDyn *scr_dyn_proxy_json_form(ScrDyn *p) {
  ScrDyn *root = p->v.proxy.target;
  while (root->kind == SCR_DYN_PROXY) root = root->v.proxy.target;
  if (root->kind == SCR_DYN_ARR) {
    ScrStr *lk = scr_str_new("length", 6);
    ScrDyn *len = scr_dyn_proxy_get(p, lk);
    scr_str_release(lk);
    if (len == NULL) return NULL;
    double n = len->kind == SCR_DYN_NUM ? len->v.num : 0;
    scr_dyn_release(len);
    ScrDyn *out = scr_dyn_new_arr();
    for (size_t i = 0; i < (size_t)n; i++) {
      char buf[32];
      int bl = snprintf(buf, sizeof buf, "%zu", i);
      ScrStr *ik = scr_str_new(buf, (size_t)bl);
      ScrDyn *v = scr_dyn_proxy_get(p, ik);
      scr_str_release(ik);
      if (v == NULL) {
        scr_dyn_release(out);
        return NULL;
      }
      scr_dyn_arr_push(out, v);
    }
    return out;
  }
  ScrDyn *entries = scr_dyn_proxy_walk(p, SCR_OBJWALK_ENTRIES);
  if (entries == NULL) return NULL;
  ScrDyn *out = scr_dyn_new_obj();
  for (size_t i = 0; i < entries->v.arr.len; i++) {
    ScrDyn *pair = entries->v.arr.items[i];
    ScrDyn *k = pair->v.arr.items[0];
    ScrStr *ks = scr_str_retain(k->v.str);
    scr_dyn_obj_set(out, ks->data, ks->len, scr_dyn_retain(pair->v.arr.items[1]));
    scr_str_release(ks);
  }
  scr_dyn_release(entries);
  return out;
}

/* The table the always-linked dyn code calls through (see scr_json.c). */
static const ScrDynProxyOps scr_px_ops = {
  scr_dyn_proxy_get,
  scr_dyn_proxy_set,
  scr_dyn_proxy_has,
  scr_dyn_proxy_delete,
  scr_dyn_proxy_call,
  scr_dyn_proxy_construct,
  scr_dyn_proxy_is_function,
  scr_dyn_proxy_walk,
  scr_dyn_proxy_json_form,
  scr_px_refuse,
  scr_dyn_proxy_trap,
};

static void scr_dyn_proxy_install(void) { scr_dyn_proxy_ops_ptr = &scr_px_ops; }

/* Error.captureStackTrace(target) over a dyn OBJECT: V8 formats the header
 * AT THE CALL (not lazily, unlike a real Error) as ErrorUtils::ToString does
 * over the target's `name` (absent: "Error") and `message` (absent: ""),
 * with the object's own toString ignored, and installs `stack` as an OWN
 * NON-ENUMERABLE writable configurable data property. A zero-frame capture
 * is the whole of what this runtime can produce, which is the header (the
 * frame lines are V8's and a compiled binary has none). Node's answers for
 * the non-objects: TypeError "invalid_argument". Borrowed target; a pending
 * catchable throw on refusal. */
void scr_dyn_capture_stack(ScrDyn *target) {
  scr_dyn_isl_fence(target, "Error.captureStackTrace");
  if (scr_exc_pending()) return;
  if (target->kind != SCR_DYN_OBJ) {
    if (target->kind == SCR_DYN_FUNC || target->kind == SCR_DYN_ARR) {
      scr_throw_error_msg(SCR_ERR_ERROR,
                          "Error.captureStackTrace over a function or an array is not supported yet "
                          "(their property tables cannot hold a non-enumerable member)",
                          strlen("Error.captureStackTrace over a function or an array is not supported yet "
                                 "(their property tables cannot hold a non-enumerable member)"));
      return;
    }
    if (target->kind == SCR_DYN_OBJINST) {
      scr_throw_error_msg(SCR_ERR_ERROR,
                          "Error.captureStackTrace over a class instance held as a dynamic value is not supported yet",
                          strlen("Error.captureStackTrace over a class instance held as a dynamic value is not supported yet"));
      return;
    }
    scr_throw_error_msg(SCR_ERR_TYPE, "invalid_argument", strlen("invalid_argument"));
    return;
  }
  ScrStr *name = NULL;
  ScrStr *msg = NULL;
  for (int pass = 0; pass < 2; pass++) {
    const char *key = pass == 0 ? "name" : "message";
    ScrDyn *v = scr_dyn_obj_key_get(target, key, strlen(key));
    if (v == NULL) {
      if (name) scr_str_release(name);
      return;
    }
    ScrStr *s = NULL;
    if (v->kind != SCR_DYN_UNDEF) {
      s = scr_dyn_string_coerce_js(v);
      if (s == NULL) {
        scr_dyn_release(v);
        if (name) scr_str_release(name);
        return;
      }
    }
    scr_dyn_release(v);
    if (pass == 0) name = s; else msg = s;
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  if (name == NULL) scr_jb_puts(&b, "Error"); else scr_jb_write(&b, name->data, name->len);
  size_t mlen = msg == NULL ? 0 : msg->len;
  if (mlen > 0) {
    if (b.len > 0) scr_jb_puts(&b, ": ");
    scr_jb_write(&b, msg->data, msg->len);
  }
  ScrStr *header = scr_jb_finish(&b);
  if (name) scr_str_release(name);
  if (msg) scr_str_release(msg);
  ScrDyn *value = scr_dyn_new_str(header);
  scr_str_release(header);
  scr_dyn_obj_drop_hidden(target, "stack", 5);
  scr_dyn_obj_define_hidden_data(target, "stack", 5, value, true, true);
  scr_dyn_release(value);
}
