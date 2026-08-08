/* Prototype-method dispatch on checked-dynamic receivers (scr_dyn_invoke)
 * and its companions: JS String() over the checked-dynamic tree (scr_dyn_display — join
 * and the error texts need it standalone) and the two property definers
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

/* JS String() over a dyn value, runtime-side (join needs it standalone —
 * the emitted sc_ds walker exists only in programs that spell
 * String(unknown) themselves). Same rules: arrays join with "," and
 * null/undefined elements print empty, the checked-dynamic tree's error encoding renders
 * "name: message", functions render the native-code form, plain objects
 * are [object Object]. */
static void scr_dyn_display_buf(ScrJsonBuf *b, const ScrDyn *d) {
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
      scr_dyn_display_buf(b, e);
    }
    return;
  case SCR_DYN_OBJ: {
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
  case SCR_DYN_FUNC:
    scr_jb_puts(b, "function ");
    if (d->v.fn.name) scr_jb_puts(b, d->v.fn.name);
    scr_jb_puts(b, "() { [native code] }");
    return;
  case SCR_DYN_HANDLE:
    /* Object.prototype.toString — Node's String() over these classes. */
    scr_jb_puts(b, "[object Object]");
    return;
  case SCR_DYN_PROMISE:
    /* Object.prototype.toString — promises carry no own toString, and
     * their @@toStringTag is not modeled here; Node's String() answer
     * for a bare promise is "[object Promise]". */
    scr_jb_puts(b, "[object Promise]");
    return;
  case SCR_DYN_JSVAL:
    /* The engine's own ToString (a bridged failure leaves the exception
     * pending and appends nothing — the loud path). */
    scr_dyn_isl_tostr_buf(b, d);
    return;
  }
}

ScrStr *scr_dyn_display(const ScrDyn *d) {
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_dyn_display_buf(&b, d);
  return scr_jb_finish(&b);
}

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
  if (i >= argc || args[i]->kind == SCR_DYN_UNDEF) return dflt;
  if (args[i]->kind == SCR_DYN_NUM) {
    double n = args[i]->v.num;
    if (n != n) return 0;
    return trunc(n);
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, ": non-number index arguments on a dynamic receiver are not supported yet");
  scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
  return 0;
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

/* The callable-callback gate: JS's "<String(cb)> is not a function". */
static bool dyn_cb_check(ScrDyn *const *args, size_t argc) {
  ScrDyn *cb = argc > 0 ? args[0] : scr_dyn_undefined();
  if (cb->kind == SCR_DYN_FUNC) return true;
  /* An ENGINE function is callable — scr_dyn_call's JSVAL arm routes it
   * (the loops below call through scr_dyn_call, which converts the checked-dynamic tree
   * element arguments per the uniform crossing). A wrapped NON-function
   * falls through to the display path: String(cb) renders through the
   * engine, exactly Node's message. */
  if (cb->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(cb, "function")) return true;
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_dyn_display_buf(&b, cb);
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
 * surrogate boundary (SEMANTICS.md). A comparator result converts
 * loosely to number; NaN and non-numeric answers count as 0 (ToNumber's
 * common cases; exotic ToString-of-object coercions stay 0). */
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
  ScrStr *xs = dyn_sort_str(x);
  ScrStr *ys = dyn_sort_str(y);
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
static bool dyn_bytes_proto_real(const char *m) {
  static const char *names[] = { "slice", "at", "indexOf", "lastIndexOf", "includes", "join",
    "forEach", "map", "filter", "some", "every", "find", "findIndex", "reverse", "fill", "set",
    "subarray", "sort", "keys", "values", "entries", "reduce", "reduceRight", "copyWithin",
    "toString", "toLocaleString", NULL };
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

  /* OBJ: the own member calls (own properties shadow prototypes in JS
   * too), then the PROTOTYPE CHAIN — `inst.method()` where `method` came
   * from `F.prototype.method = fn` is the whole pre-class dispatch, and
   * it must bind the INSTANCE as the receiver, not the prototype object
   * that stores the function. Anything else is Node's is-not-a-function. */
  if (recv->kind == SCR_DYN_OBJ) {
    ScrDyn *m = scr_dyn_obj_get(recv, method, strlen(method));
    if (m == NULL) m = scr_dyn_proto_get(recv, method, strlen(method));
    if (m && (m->kind == SCR_DYN_FUNC ||
              /* a WRAPPED engine function stored as a dyn member: the
               * routed call (scr_dyn_call's JSVAL arm) runs it. */
              (m->kind == SCR_DYN_JSVAL && scr_dyn_isl_typeof_is(m, "function")))) {
      /* JS binds the receiver for the call (`obj.method()` — this === obj):
       * the ambient-receiver window (scr_runtime.h). */
      scr_dyn_this_push_dyn(recv);
      ScrDyn *r = scr_dyn_call(m, args, argc, what);
      scr_dyn_this_pop();
      return r;
    }
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
      ScrJsonBuf b;
      scr_jb_init(&b);
      for (size_t i = 0; i < len; i++) {
        if (i > 0) {
          if (argc > 0 && args[0]->kind != SCR_DYN_UNDEF) scr_dyn_display_buf(&b, args[0]);
          else scr_jb_putc(&b, ',');
        }
        const ScrDyn *e = recv->v.arr.items[i];
        if (e->kind == SCR_DYN_UNDEF || e->kind == SCR_DYN_NULL) continue;
        scr_dyn_display_buf(&b, e);
      }
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
        scr_dyn_display_buf(&b, cmp);
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
    ScrBytes *bytes = recv->v.bytes;
    size_t blen = bytes->len;
    if (dyn_name_is(method, "at")) {
      double iD = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double idx = iD < 0 ? (double)blen + iD : iD;
      if (idx < 0 || idx >= (double)blen) return scr_dyn_retain(scr_dyn_undefined());
      return scr_dyn_new_num((double)bytes->data[(size_t)idx]);
    }
    if (dyn_name_is(method, "slice") || dyn_name_is(method, "subarray")) {
      /* Both COPY (no views in this runtime — the static lane's
       * documented divergence for subarray/Buffer.slice); the result
       * keeps the receiver's Buffer flavor. */
      double startD = dyn_index_arg(args, argc, 0, 0, what);
      if (scr_exc_pending()) return NULL;
      double endD = dyn_index_arg(args, argc, 1, (double)blen, what);
      if (scr_exc_pending()) return NULL;
      ScrBytes *out = scr_bytes_slice(bytes, startD, endD);
      ScrDyn *d = recv->buffer ? scr_dyn_new_buffer_copy(out) : scr_dyn_new_bytes_copy(out);
      scr_bytes_release(out);
      return d;
    }
    if (dyn_bytes_proto_real(method)) {
      dyn_throw_unsupported("Uint8Array", method);
      return NULL;
    }
  }

  /* NUM/BOOL/BYTES-remainder: the name is no method of this kind — JS's
   * own answer. */
  dyn_throw_not_fn(what);
  return NULL;
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
 *   enumerable:true  Object.keys reads `entries` and an accessor never
 *                    enters it, so admitting the flag would silently
 *                    answer a key set Node disagrees with. The DEFAULT —
 *                    what a bare get/set descriptor declares, and what
 *                    pbjs writes — is exact.
 *   over an existing own DATA member
 *                    the same refusal in disguise: ES keeps the
 *                    attributes a REDEFINITION omits, and dyn members are
 *                    enumerable, so the result would be an enumerable
 *                    accessor.
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
  ScrDyn *en = scr_dyn_obj_get(desc, "enumerable", 10);
  if (en != NULL && scr_dyn_truthy(en)) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, api);
    scr_jb_puts(&b, " with an ENUMERABLE accessor descriptor is not supported yet"
                    " (a non-enumerable accessor — the default, and what a bare get/set"
                    " descriptor declares — compiles: reads call the getter, writes the setter,"
                    " and Object.keys/JSON skip the key exactly as they should)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return false;
  }
  /* Redefining an EXISTING own member as an accessor is the same refusal
   * wearing a disguise. ES only defaults the attributes a descriptor
   * omits when the property is being CREATED — over an existing one the
   * omitted flags are KEPT — and every own member of a dynamic object is
   * enumerable. So `{get}` over `o.k = v` produces an ENUMERABLE accessor
   * in Node, which this representation cannot answer. (Over an existing
   * ACCESSOR there is nothing to inherit: those are non-enumerable here
   * by construction, so that redefinition is exact and is allowed.) */
  if (scr_dyn_obj_get(target, key, key_len) != NULL) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, api);
    scr_jb_puts(&b, " redefining an existing own DATA property as an accessor is not supported"
                    " yet (JS keeps the attributes a redefinition omits, and an own member of a"
                    " dynamic object is enumerable — so the result would be an ENUMERABLE"
                    " accessor, which Object.keys would have to report and this representation"
                    " cannot. Define the accessor before the member exists)");
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
    scr_dyn_display_buf(&b, badGet ? getter : setter);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return false;
  }
  ScrDyn *cf = scr_dyn_obj_get(desc, "configurable", 12);
  scr_dyn_obj_define_accessor(target, key, key_len,
                              getter ? getter : scr_dyn_undefined(),
                              setter ? setter : scr_dyn_undefined(),
                              cf != NULL && scr_dyn_truthy(cf));
  return true;
}

/* JS's "Cannot redefine property" for the case this representation can
 * see: an OWN accessor that was not declared `configurable`. Redefining
 * one is a TypeError in Node, and answering silently would let a program
 * install a getter it believes is live over one that is not.
 *
 * DECLARED LIMIT: a non-configurable DATA property cannot be recognised —
 * a dyn own member carries no flags, so a `{value}` define over a key an
 * assignment already created is indistinguishable from a fresh one. That
 * is the plural form's grandfathered flags-are-ignored class, unchanged
 * and not widened: the singular form's data arm admits only the
 * explicitly writable+enumerable descriptor, whose meaning a plain member
 * reproduces. */
static bool dyn_redefine_refused(ScrDyn *target, const char *key, size_t key_len) {
  if (!scr_dyn_obj_accessor_sealed(target, key, key_len)) return false;
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
      scr_dyn_display_buf(&b, ent->value);
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
      scr_dyn_obj_drop_accessor(target, ent->key, ent->key_len);
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
 * spelling the accessor descriptor actually arrives in (see
 * scr_runtime.h for the full contract).
 *
 * Its DATA arm is EXACT-OR-LOUD, which is where it parts company with the
 * plural form above. `Object.defineProperty` defaults every flag to
 * FALSE, so the bare `{ value: v }` Node writes is a NON-ENUMERABLE,
 * NON-WRITABLE property: it does not appear in Object.keys and assigning
 * to it throws in strict mode. A dyn own member is enumerable and
 * writable, so storing one there would answer both questions wrongly and
 * silently — and unlike the plural form, this arm has no shipped
 * consumers to grandfather. It therefore admits only the descriptor whose
 * meaning a plain own member reproduces exactly (`enumerable` and
 * `writable` both true) and refuses the rest by name.
 *
 * `configurable` is accepted and ignored on that admitted shape: it is
 * observable only through `delete` and redefinition, neither of which
 * lowers over a dyn receiver today. Declared, not hidden. */
ScrDyn *scr_dyn_define_prop(ScrDyn *target, ScrStr *key, ScrDyn *desc) {
  scr_dyn_isl_fence(target, "Object.defineProperty");
  if (!scr_exc_pending()) scr_dyn_isl_fence(desc, "Object.defineProperty");
  if (scr_exc_pending()) return NULL;
  if (target->kind != SCR_DYN_OBJ && target->kind != SCR_DYN_FUNC) {
    scr_throw_error_msg(SCR_ERR_TYPE, "Object.defineProperty called on non-object",
                        strlen("Object.defineProperty called on non-object"));
    return NULL;
  }
  if (desc->kind != SCR_DYN_OBJ) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Property description must be an object: ");
    scr_dyn_display_buf(&b, desc);
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&b));
    return NULL;
  }
  if (dyn_redefine_refused(target, key->data, key->len)) return NULL;
  ScrDyn *getter = scr_dyn_obj_get(desc, "get", 3);
  ScrDyn *setter = scr_dyn_obj_get(desc, "set", 3);
  if (getter != NULL || setter != NULL) {
    if (!dyn_define_accessor_desc(target, key->data, key->len, desc,
                                  getter, setter, "Object.defineProperty")) {
      return NULL;
    }
    return scr_dyn_retain(target);
  }
  ScrDyn *en = scr_dyn_obj_get(desc, "enumerable", 10);
  ScrDyn *wr = scr_dyn_obj_get(desc, "writable", 8);
  if (en == NULL || !scr_dyn_truthy(en) || wr == NULL || !scr_dyn_truthy(wr)) {
    ScrJsonBuf b;
    scr_jb_init(&b);
    scr_jb_puts(&b, "Object.defineProperty with a ");
    scr_jb_puts(&b, (en == NULL || !scr_dyn_truthy(en)) ? "NON-ENUMERABLE" : "NON-WRITABLE");
    scr_jb_puts(&b, " data descriptor is not supported yet on a dynamic value"
                    " (defineProperty defaults every flag to false, and an own member of a"
                    " dynamic object is enumerable and writable — storing one would put the key"
                    " in Object.keys and accept a write that JS refuses. Spell"
                    " `{ value: v, writable: true, enumerable: true }`, or assign `o.k = v`;"
                    " a get/set descriptor is the non-enumerable shape that does compile)");
    scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
    return NULL;
  }
  ScrDyn *value = scr_dyn_obj_get(desc, "value", 5);
  if (!value) value = scr_dyn_undefined();
  if (target->kind == SCR_DYN_OBJ) {
    /* Redefining an accessor property as a DATA property drops the pair,
     * so the two tables never both claim one key. */
    scr_dyn_obj_drop_accessor(target, key->data, key->len);
    scr_dyn_obj_set(target, key->data, key->len, scr_dyn_retain(value));
  } else {
    ScrDyn *table = scr_dyn_fn_props(target); /* +1 */
    scr_dyn_obj_set(table, key->data, key->len, scr_dyn_retain(value));
    scr_dyn_release(table);
  }
  return scr_dyn_retain(target);
}
