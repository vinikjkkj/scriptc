/* Live array views: a dyn copy of a static array that stays a cache of its
 * origin. The section comment below says what it does; THIS FILE exists to keep
 * it out of every program that never lets an array cross into a dyn slot
 * (the compiler links it on moduleUsesDynView and the emitted main installs it).
 * The always-linked units reach it through scr_dyn_view_ops; the emitted keyed
 * read calls scr_dyn_view_key_get directly, and only in a module that links it. */
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_runtime.h"

/* ── LIVE ARRAY VIEWS ─────────────────────────────────────────────────
 * A dyn ARR that is a boundary COPY of a live static array (scr_dyn_origin_mark
 * recorded the ScrArr it was made from) is not a snapshot: the two are ONE
 * array in JavaScript, so a write through either must land in the other.
 * The two representations cannot share storage (a packed ScrArr against a
 * vector of boxes), so the copy is kept as a CACHE of the origin and the
 * origin stays the single truth:
 *
 *   - a mutation through the copy is applied to the copy AND committed to
 *     the origin (push and pop in O(1), everything else by rewriting the
 *     origin from the copy, which is O(n) like the mutation itself);
 *   - an index or `length` read answers FROM THE ORIGIN, so a mutation the
 *     static side made after the crossing is seen (O(1));
 *   - every other entry resynchronises the copy first when the origin's
 *     length moved.
 *
 * Only arrays whose element kind a dyn value can be written back into
 * without a type change take this path: number[], boolean[], string[] and
 * the dyn-element arrays. A statically typed array cannot hold a value of
 * another type, so a write that would change an element's type (`push("x")`
 * onto a number[]) is refused LOUDLY and leaves both sides untouched: that
 * is the one residue of keeping the static representation, and it needs the
 * array to be a dyn array from creation. Arrays of arrays, records and class
 * instances keep scr_dyn_static_copy_refuse (their elements are COPIES with
 * no origin of their own). */
static ScrArr *dyn_view_origin(const ScrDyn *d) {
  if (d == NULL || !d->static_copy || d->kind != SCR_DYN_ARR || d->module_ns) return NULL;
  int is_arr = 0;
  void *o = scr_dyn_origin_peek(d, &is_arr);
  if (o == NULL || !is_arr) return NULL;
  ScrArr *a = (ScrArr *)o;
  switch (a->elem) {
    case SCR_ELEM_F64:
    case SCR_ELEM_BOOL:
    case SCR_ELEM_STR:
      return a;
    case SCR_ELEM_REF:
      return a->elem_retain == &scr_dyn_retain_v ? a : NULL;
    default:
      return NULL;
  }
}

static const char *dyn_view_elem_name(const ScrArr *a) {
  switch (a->elem) {
    case SCR_ELEM_F64: return "number";
    case SCR_ELEM_BOOL: return "boolean";
    case SCR_ELEM_STR: return "string";
    default: return "unknown";
  }
}

static ScrDyn *dyn_view_box(const ScrArr *a, size_t i) {
  switch (a->elem) {
    case SCR_ELEM_F64: return scr_dyn_new_num(scr_arr_nochk_f64(a, (double)i));
    case SCR_ELEM_BOOL: return scr_dyn_new_bool(scr_arr_nochk_bool(a, (double)i));
    case SCR_ELEM_STR: return scr_dyn_new_str((ScrStr *)(uintptr_t)a->data[i]);
    default: {
      ScrDyn *e = (ScrDyn *)(uintptr_t)a->data[i];
      return e != NULL ? scr_dyn_retain(e) : scr_dyn_retain(scr_dyn_undefined());
    }
  }
}

static bool dyn_view_fits(const ScrArr *a, const ScrDyn *v) {
  switch (a->elem) {
    case SCR_ELEM_F64: return v->kind == SCR_DYN_NUM;
    case SCR_ELEM_BOOL: return v->kind == SCR_DYN_BOOL;
    case SCR_ELEM_STR: return v->kind == SCR_DYN_STR;
    default: return true;
  }
}

static void dyn_view_refuse_type(const ScrArr *a, const ScrDyn *v, const char *what) {
  const char *got = "a value";
  switch (v->kind) {
    case SCR_DYN_NUM: got = "a number"; break;
    case SCR_DYN_BOOL: got = "a boolean"; break;
    case SCR_DYN_STR: got = "a string"; break;
    case SCR_DYN_UNDEF: got = "undefined"; break;
    case SCR_DYN_NULL: got = "null"; break;
    case SCR_DYN_ARR: got = "an array"; break;
    case SCR_DYN_OBJ: got = "an object"; break;
    default: break;
  }
  ScrJsonBuf b;
  scr_jb_init(&b);
  scr_jb_puts(&b, what);
  scr_jb_puts(&b, " would store ");
  scr_jb_puts(&b, got);
  scr_jb_puts(&b, " in a ");
  scr_jb_puts(&b, dyn_view_elem_name(a));
  scr_jb_puts(&b, "[] that the program also holds with its static type: the array crossed into an"
                  " untyped slot by sharing its storage, and a statically typed array keeps its"
                  " element type, so a write that changes it cannot land on the object Node"
                  " writes. Nothing was written");
  scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
}

/* Rebuild the copy's items from the origin. */
static void dyn_view_pull(ScrDyn *n, const ScrArr *o) {
  while (n->v.arr.len > 0) {
    ScrDyn *gone = n->v.arr.items[n->v.arr.len - 1];
    n->v.arr.len--;
    scr_dyn_release(gone);
  }
  for (size_t i = 0; i < o->len; i++) scr_dyn_arr_push(n, dyn_view_box(o, i));
}

/* Resynchronise unconditionally (a mutation threw half way). */
static void dyn_view_impl_sync_force(ScrDyn *d) {
  ScrArr *o = dyn_view_origin(d);
  if (o != NULL) dyn_view_pull(d, o);
}

/* Does the copy's item i still say what the origin's slot i says? */
static bool dyn_view_item_current(const ScrDyn *n, const ScrArr *o, size_t i) {
  const ScrDyn *it = n->v.arr.items[i];
  switch (o->elem) {
    case SCR_ELEM_F64: {
      double v = scr_arr_nochk_f64(o, (double)i);
      return it->kind == SCR_DYN_NUM && memcmp(&it->v.num, &v, sizeof v) == 0;
    }
    case SCR_ELEM_BOOL: return it->kind == SCR_DYN_BOOL && it->v.b == scr_arr_nochk_bool(o, (double)i);
    case SCR_ELEM_STR: return it->kind == SCR_DYN_STR && it->v.str == (ScrStr *)(uintptr_t)o->data[i];
    default: return (const void *)it == (const void *)(uintptr_t)o->data[i];
  }
}

/* Length-only freshness: O(1), what push and pop need (neither reads an
 * existing element except pop's last, which view_before refreshes). */
static void dyn_view_impl_sync(ScrDyn *d) {
  ScrArr *o = dyn_view_origin(d);
  if (o != NULL && o->len != d->v.arr.len) dyn_view_pull(d, o);
}

/* Full freshness: the length AND every element, O(n): what every other
 * array method already costs, so it adds no order to the call. A static
 * `xs[0] = 9` made after the crossing keeps the length and is caught here. */
static void dyn_view_impl_sync_deep(ScrDyn *d) {
  ScrArr *o = dyn_view_origin(d);
  if (o == NULL) return;
  if (o->len != d->v.arr.len) { dyn_view_pull(d, o); return; }
  for (size_t i = 0; i < o->len; i++) {
    if (!dyn_view_item_current(d, o, i)) { dyn_view_pull(d, o); return; }
  }
}

/* The canonical array index a key spells, or false. */
static bool dyn_view_index(const ScrStr *k, size_t *out) {
  size_t idx = 0;
  if (k->len == 0 || k->len > 15 || (k->len > 1 && k->data[0] == '0')) return false;
  for (size_t i = 0; i < k->len; i++) {
    if (k->data[i] < '0' || k->data[i] > '9') return false;
    idx = idx * 10 + (size_t)(k->data[i] - '0');
  }
  *out = idx;
  return true;
}

/* d[k] read straight off the origin (+1), or NULL when this is not a live
 * view or the key is neither an index nor `length` (the caller continues
 * with the copy's own answer). */
ScrDyn *scr_dyn_view_key_get(ScrDyn *d, ScrStr *k) {
  ScrArr *o = dyn_view_origin(d);
  if (o == NULL) return NULL;
  if (k->len == 6 && memcmp(k->data, "length", 6) == 0) return scr_dyn_new_num((double)o->len);
  size_t idx;
  if (!dyn_view_index(k, &idx)) return NULL;
  if (idx >= o->len) return scr_dyn_retain(scr_dyn_undefined());
  return dyn_view_box(o, idx);
}

/* Write the value into the origin slot (i == len appends). The caller has
 * checked dyn_view_fits. */
static void dyn_view_store(ScrArr *o, size_t i, ScrDyn *v) {
  switch (o->elem) {
    case SCR_ELEM_F64:
      if (i == o->len) scr_arr_push_f64(o, v->v.num); else scr_arr_set_f64(o, (double)i, v->v.num);
      break;
    case SCR_ELEM_BOOL:
      if (i == o->len) scr_arr_push_bool(o, v->v.b); else scr_arr_set_bool(o, (double)i, v->v.b);
      break;
    case SCR_ELEM_STR:
      if (i == o->len) scr_arr_push_ref(o, scr_str_retain(v->v.str));
      else scr_arr_set_ref(o, (double)i, scr_str_retain(v->v.str));
      break;
    default:
      if (i == o->len) scr_arr_push_ref(o, scr_dyn_retain(v));
      else scr_arr_set_ref(o, (double)i, scr_dyn_retain(v));
      break;
  }
}

/* Rewrite the origin from the copy. False (with the refusal pending, the
 * copy restored from the untouched origin) when an element cannot be held. */
static bool dyn_view_commit(ScrDyn *n, ScrArr *o, const char *what) {
  size_t len = n->v.arr.len;
  for (size_t i = 0; i < len; i++) {
    if (!dyn_view_fits(o, n->v.arr.items[i])) {
      ScrDyn *bad = n->v.arr.items[i];
      dyn_view_pull(n, o);
      dyn_view_refuse_type(o, bad, what);
      return false;
    }
  }
  for (size_t i = 0; i < len; i++) {
    if (i < o->len) {
      /* same value already there: skip the store so a sort over a big
       * array does not retain/release every string */
      dyn_view_store(o, i, n->v.arr.items[i]);
    } else {
      dyn_view_store(o, o->len, n->v.arr.items[i]);
    }
  }
  if (o->len > len) scr_arr_truncate(o, (double)len);
  return true;
}

/* Is this receiver a live view that a mutation may go through? */
static bool dyn_view_impl_live(ScrDyn *d) { return dyn_view_origin(d) != NULL; }

/* An index or `length` write through a live view. Returns false when the key
 * is neither (the caller keeps the loud refusal); true when handled, with any
 * refusal already pending. */
static bool dyn_view_impl_key_set(ScrDyn *d, ScrStr *key, ScrDyn *value) {
  ScrArr *o = dyn_view_origin(d);
  if (o == NULL) return false;
  dyn_view_impl_sync(d);
  size_t idx;
  if (dyn_view_index(key, &idx)) {
    if (idx > o->len || !dyn_view_fits(o, value)) {
      /* a hole cannot be spelled in a typed array, and a foreign type cannot
       * be stored in one */
      dyn_view_refuse_type(o, idx > o->len ? scr_dyn_undefined() : value, "this index write");
      return true;
    }
    dyn_view_store(o, idx, value);
    if (idx == d->v.arr.len) {
      scr_dyn_arr_push(d, scr_dyn_retain(value));
    } else {
      ScrDyn *old = d->v.arr.items[idx];
      d->v.arr.items[idx] = scr_dyn_retain(value);
      scr_dyn_release(old);
    }
    return true;
  }
  if (key->len == 6 && memcmp(key->data, "length", 6) == 0) {
    double nl = scr_dyn_to_number(value);
    if (scr_exc_pending()) return true;
    if (!(nl >= 0) || nl > 4294967295.0 || nl != (double)(unsigned long long)nl) {
      static const char msg[] = "Invalid array length";
      scr_throw_error_msg(SCR_ERR_RANGE, msg, sizeof msg - 1);
      return true;
    }
    size_t want = (size_t)nl;
    if (want > o->len) {
      dyn_view_refuse_type(o, scr_dyn_undefined(), "growing the length");
      return true;
    }
    scr_arr_truncate(o, (double)want);
    while (d->v.arr.len > want) {
      ScrDyn *gone = d->v.arr.items[d->v.arr.len - 1];
      d->v.arr.len--;
      scr_dyn_release(gone);
    }
    return true;
  }
  return false;
}

/* The in-place array methods through a live view. `method` names one of
 * push / pop / shift / unshift / splice / sort / reverse / fill / copyWithin.
 * Validate (push, unshift), then let the caller's ordinary dyn array code run
 * on the copy, then commit: dyn_view_impl_before answers false when the call
 * must stop (refusal pending); dyn_view_impl_after commits the copy's new
 * state to the origin. */
static bool dyn_view_impl_before(ScrDyn *d, const char *method, ScrDyn *const *args, size_t argc) {
  ScrArr *o = dyn_view_origin(d);
  if (o == NULL) return false;
  if (strcmp(method, "push") == 0) {
    dyn_view_impl_sync(d);
  } else if (strcmp(method, "pop") == 0) {
    dyn_view_impl_sync(d);
    if (d->v.arr.len > 0 && !dyn_view_item_current(d, o, d->v.arr.len - 1)) dyn_view_pull(d, o);
  } else {
    dyn_view_impl_sync_deep(d);
  }
  if (strcmp(method, "push") == 0 || strcmp(method, "unshift") == 0) {
    for (size_t i = 0; i < argc; i++) {
      if (!dyn_view_fits(o, args[i])) {
        char what[48];
        snprintf(what, sizeof what, "calling '%s'", method);
        dyn_view_refuse_type(o, args[i], what);
        return false;
      }
    }
  }
  return true;
}

static void dyn_view_impl_after(ScrDyn *d, const char *method, size_t argc) {
  ScrArr *o = dyn_view_origin(d);
  if (o == NULL) return;
  if (strcmp(method, "push") == 0) {
    size_t len = d->v.arr.len;
    for (size_t i = len - argc; i < len; i++) dyn_view_store(o, o->len, d->v.arr.items[i]);
    return;
  }
  if (strcmp(method, "pop") == 0) {
    if (o->len > 0) scr_arr_truncate(o, (double)(o->len - 1));
    return;
  }
  char what[48];
  snprintf(what, sizeof what, "calling '%s'", method);
  dyn_view_commit(d, o, what);
}


static const ScrDynViewOps scr_dyn_view_impl = {
    dyn_view_impl_sync, dyn_view_impl_sync_force, dyn_view_impl_sync_deep,
    dyn_view_impl_key_set, dyn_view_impl_live, dyn_view_impl_before, dyn_view_impl_after,
};

void scr_dyn_view_install(void) { scr_dyn_view_ops = &scr_dyn_view_impl; }
