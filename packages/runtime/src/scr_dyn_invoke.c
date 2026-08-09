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
       * dynamic tree's "%error" encoding (Error.prototype.toString)
       * second, "[object Object]" last. Delegating rather than
       * repeating is why this copy cannot drift from scr_dyn_to_string
       * — and the "%error" case that used to sit here, AHEAD of the
       * protocol, was precisely such a drift. */
      ScrStr *s = scr_dyn_to_string(d, NULL);
      for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
      scr_str_release(s);
      return;
    }
    /* Diagnostic: the constants, in the order the protocol would have
     * reached them had it been allowed to run. */
    const ScrDyn *marker = scr_dyn_obj_get(d, "%error", 6);
    if (marker) {
      const ScrDyn *en = scr_dyn_obj_get(d, "name", 4);
      const ScrDyn *em = scr_dyn_obj_get(d, "message", 7);
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

/* V8's CalledNonCallable rendering — a THIRD table, and deliberately not
 * either mode of dyn_str_buf above. `[1].forEach(x)` does not name x by
 * its string image; it names x by its TYPE, and only the three primitive
 * types that print short carry their value. Measured, Node v25.9.0:
 *
 *   {} / [] / /x/ / new Date / Object.create(null)  ->  "object"
 *   null            -> "object null"      undefined -> "undefined"
 *   5 / NaN / -0    -> "number 5" / "number NaN" / "number 0"
 *   "hi" / 'a"b'    -> 'string "hi"' / 'string "a"b"'  (NOT re-escaped)
 *   true / false    -> "boolean true" / "boolean false"
 *   Symbol("s")     -> "symbol"           5n        -> "bigint"
 *
 * Every object renders as the bare word, so an object carrying a user
 * `toString` cannot be reached through this message at all — the
 * property that makes it safe to build while an exception is being
 * raised. The `o.m()` spelling is a DIFFERENT template (V8's
 * CallPrinter names the source text) and stays with dyn_throw_not_fn. */
static void dyn_notfn_buf(ScrJsonBuf *b, const ScrDyn *cb) {
  switch (cb->kind) {
  case SCR_DYN_UNDEF: scr_jb_puts(b, "undefined"); return;
  case SCR_DYN_NULL: scr_jb_puts(b, "object null"); return;
  case SCR_DYN_BOOL:
    scr_jb_puts(b, cb->v.b ? "boolean true" : "boolean false");
    return;
  case SCR_DYN_NUM: {
    scr_jb_puts(b, "number ");
    ScrStr *s = scr_f64_to_scrstr(cb->v.num);
    for (size_t i = 0; i < s->len; i++) scr_jb_putc(b, s->data[i]);
    scr_str_release(s);
    return;
  }
  case SCR_DYN_STR:
    scr_jb_puts(b, "string \"");
    for (size_t i = 0; i < cb->v.str->len; i++) scr_jb_putc(b, cb->v.str->data[i]);
    scr_jb_putc(b, '"');
    return;
  case SCR_DYN_FUNC:
    /* Unreachable — a FUNC is callable and returned above. */
    scr_jb_puts(b, "function");
    return;
  case SCR_DYN_JSVAL:
    /* A wrapped value that is not a function. Primitives normalize to
     * the native kinds above when they cross, so what survives here is
     * an engine OBJECT; asking the engine for a value image would run
     * its ToString, which this message must not do. */
    scr_jb_puts(b, "object");
    return;
  case SCR_DYN_ARR:
  case SCR_DYN_OBJ:
  case SCR_DYN_BYTES:
  case SCR_DYN_ARRBUF:
  case SCR_DYN_HANDLE:
  case SCR_DYN_OBJINST:
  case SCR_DYN_PROMISE: scr_jb_puts(b, "object"); return;
  }
}

/* The callable-callback gate: JS's "<type of cb> is not a function". */
static bool dyn_cb_check(ScrDyn *const *args, size_t argc) {
  ScrDyn *cb = argc > 0 ? args[0] : scr_dyn_undefined();
  if (cb->kind == SCR_DYN_FUNC) return true;
  /* An ENGINE function is callable — scr_dyn_call's JSVAL arm routes it
   * (the loops below call through scr_dyn_call, which converts the checked-dynamic tree
   * element arguments per the uniform crossing). */
  if (cb->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(cb, "function")) return true;
  ScrJsonBuf b;
  scr_jb_init(&b);
  dyn_notfn_buf(&b, cb);
  scr_jb_puts(&b, " is not a function");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  return false;
}

static bool dyn_name_is(const char *m, const char *n) { return strcmp(m, n) == 0; }

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

/* Names each prototype declares BEYOND what's implemented here — these
 * fence loudly instead of mis-answering "is not a function". */
static bool dyn_arr_proto_unimpl(const char *m) {
  static const char *names[] = { "splice", "reduce", "reduceRight", "flat",
    "fill", "copyWithin", "keys", "values", "entries", "toReversed", "toSorted", "toSpliced",
    "with", "toString", "toLocaleString", NULL };
  for (size_t i = 0; names[i]; i++) if (dyn_name_is(m, names[i])) return true;
  return false;
}

ScrDyn *scr_dyn_invoke(ScrDyn *recv, const char *method, ScrDyn *const *args, size_t argc, const char *what) {
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
    scr_dyn_release(m);
    dyn_throw_not_fn(what);
    return NULL;
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
        scr_throw_error_msg(SCR_ERR_TYPE, "CreateListFromArrayLike called on non-object",
                            strlen("CreateListFromArrayLike called on non-object"));
        return NULL;
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
    dyn_throw_not_fn(what);
    return NULL;
  }

  if (recv->kind == SCR_DYN_STR) {
    ScrStr *s = recv->v.str;
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
    dyn_throw_not_fn(what);
    return NULL;
  }

  if (recv->kind == SCR_DYN_ARR) {
    size_t len = recv->v.arr.len;
    /* An IN-PLACE array method on a copy the static→dyn boundary made of
     * a value the caller still names: the mutation would be confined to
     * the copy, so refuse loudly instead of dropping it (see
     * scr_dyn_static_copy_refuse). The non-mutating methods — map, slice,
     * join, indexOf and the rest — read the copy, which is exact, and are
     * deliberately not listed here. */
    if (recv->static_copy &&
        (dyn_name_is(method, "push") || dyn_name_is(method, "pop") ||
         dyn_name_is(method, "shift") || dyn_name_is(method, "unshift") ||
         dyn_name_is(method, "splice") || dyn_name_is(method, "sort") ||
         dyn_name_is(method, "reverse") || dyn_name_is(method, "fill") ||
         dyn_name_is(method, "copyWithin"))) {
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
        /* V8 appends the received value's string image. */
        ScrJsonBuf b;
        scr_jb_init(&b);
        scr_jb_puts(&b, "The comparison function must be either a function or undefined: ");
        scr_dyn_diag_buf(&b, cmp);
        scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
        return NULL;
      }
      if (len > 1 && !dyn_arr_sort(recv, cmp->kind == SCR_DYN_FUNC ? cmp : NULL)) return NULL;
      return scr_dyn_retain(recv);
    }
    if (dyn_arr_proto_unimpl(method)) {
      dyn_throw_unsupported("Array", method);
      return NULL;
    }
    dyn_throw_not_fn(what);
    return NULL;
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
    dyn_throw_not_fn(what);
    return NULL;
  }

  if (recv->kind == SCR_DYN_BYTES) {
    /* The typed-array methods live in scr_json.c — ONE body, shared with
     * the %TypedArray%.prototype thunks, so `b.subarray(1, 3)` and
     * `Uint8Array.prototype.subarray.call(b, 1, 3)` cannot answer
     * differently. A name that is no method of this kind at all falls
     * through to JS's is-not-a-function below. */
    bool known = false;
    ScrDyn *r = scr_dyn_bytes_method(recv, method, args, argc, what, &known);
    if (known) return r;
  }

  /* NUM/BOOL/BYTES-remainder: the name is no method of this kind — JS's
   * own answer. */
  dyn_throw_not_fn(what);
  return NULL;
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
       * stay false, which IS the creation default. */
      scr_dyn_obj_hidden_attrs(target, key, key_len, NULL, &curWrite, &curConf);
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
 * Two shapes stay LOUD rather than answer wrongly:
 *   FUNC target      a function's own properties live in its CLOSURE's
 *                    table, read through scr_dyn_fn_get rather than the
 *                    OBJ accessor walk; a half-wired accessor there would
 *                    answer undefined instead of running.
 *   an EFFECTIVE `enumerable: true`
 *                    Object.keys reads `entries` and an accessor never
 *                    enters it, so admitting the flag would silently
 *                    answer a key set Node disagrees with. The DEFAULT —
 *                    what a bare get/set descriptor declares over a FRESH
 *                    key, and what pbjs writes — is exact.
 *
 *                    "Effective" is the whole subtlety: ES only defaults
 *                    an omitted attribute to false when the property is
 *                    being CREATED — over an EXISTING one the omitted
 *                    flags are KEPT — and every own member of a dynamic
 *                    object is enumerable. So a bare `{get}` over
 *                    `o.k = v` is an ENUMERABLE accessor in Node and
 *                    refuses here, while `{get, enumerable: false}` over
 *                    the same member is exact and lands.
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
  if (at.enumerable) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, api);
    scr_jb_puts(&b, " with an ENUMERABLE accessor descriptor is not supported yet"
                    " (Object.keys reads the member table and an accessor never enters it,"
                    " so the key would be missing from a set Node reports. A non-enumerable"
                    " accessor compiles exactly: reads call the getter, writes the setter."
                    " Over an EXISTING own member, `enumerable` is INHERITED as true unless"
                    " the descriptor says `enumerable: false` — say it, and this lands)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return false;
  }
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
                              at.configurable);
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
  if (!value) value = scr_dyn_undefined();
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
ScrDyn *scr_dyn_define_prop(ScrDyn *target, ScrStr *key, ScrDyn *desc) {
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
