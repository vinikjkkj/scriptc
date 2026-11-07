/* Frozen arrays: Object.freeze over a typed array or a fresh dyn array, the guarded stores and pushes of a program that freezes arrays, and V8's exact TypeErrors.
 * Linked only when the IR holds one of them (moduleUsesFrozenArrays); the always-linked array and dyn code reaches it through the guarded entry points the compiler
 * emits and the scr_dyn_frozen_ops hook, so a program that freezes no array carries none of it. */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

/* ── the GUARDED stores and pushes ─────────────────────────────────────
 * A program that freezes an array it keeps a mutable reference to gets these in place of the plain entry points, for the arrays of the frozen type
 * (Lowerer.frozenArrayRewrite). The flag test rides inside the call the store already makes, so the hot path pays one byte test and no extra
 * reference count traffic. `_fz` is strict code (a frozen array throws V8's TypeError), `_fzs` sloppy code (the write is ignored). The strict entry
 * points answer whether the array REFUSED the write (true; push answers -1 instead of the new length), so the caller unwinds only on that branch and
 * never reloads the exception flag per store. A value an owning entry point would have moved into the array is released here when the array refuses it. */
bool scr_arr_set_f64_fz(ScrArr *a, double i, double v) {
  if (a->flags & SCR_ARR_FROZEN) { scr_arr_frozen_fail(a, 9, i, 0, 0); return true; }
  scr_arr_set_f64(a, i, v);
  return false;
}
void scr_arr_set_f64_fzs(ScrArr *a, double i, double v) {
  if (a->flags & SCR_ARR_FROZEN) return;
  scr_arr_set_f64(a, i, v);
}
bool scr_arr_set_f64_hole_fz(ScrArr *a, double i, double v) {
  if (a->flags & SCR_ARR_FROZEN) { scr_arr_frozen_fail(a, 9, i, 0, 0); return true; }
  scr_arr_set_f64_hole(a, i, v);
  return false;
}
void scr_arr_set_f64_hole_fzs(ScrArr *a, double i, double v) {
  if (a->flags & SCR_ARR_FROZEN) return;
  scr_arr_set_f64_hole(a, i, v);
}
bool scr_arr_set_bool_fz(ScrArr *a, double i, bool v) {
  if (a->flags & SCR_ARR_FROZEN) { scr_arr_frozen_fail(a, 9, i, 0, 0); return true; }
  scr_arr_set_bool(a, i, v);
  return false;
}
void scr_arr_set_bool_fzs(ScrArr *a, double i, bool v) {
  if (a->flags & SCR_ARR_FROZEN) return;
  scr_arr_set_bool(a, i, v);
}
bool scr_arr_set_ref_fz(ScrArr *a, double i, void *v) {
  if (a->flags & SCR_ARR_FROZEN) {
    scr_arr_drop_value(a, v);
    scr_arr_frozen_fail(a, 9, i, 0, 0);
    return true;
  }
  scr_arr_set_ref(a, i, v);
  return false;
}
void scr_arr_set_ref_fzs(ScrArr *a, double i, void *v) {
  if (a->flags & SCR_ARR_FROZEN) {
    scr_arr_drop_value(a, v);
    return;
  }
  scr_arr_set_ref(a, i, v);
}
bool scr_arr_tombstone_fz(ScrArr *a, double i) {
  if (a->flags & SCR_ARR_FROZEN) { scr_arr_frozen_fail(a, 11, i, 0, 0); return true; }
  scr_arr_tombstone(a, i);
  return false;
}
void scr_arr_tombstone_fzs(ScrArr *a, double i) {
  if (a->flags & SCR_ARR_FROZEN) return;
  scr_arr_tombstone(a, i);
}
double scr_arr_push_f64_fz(ScrArr *a, double v) {
  if (a->flags & SCR_ARR_FROZEN) { scr_arr_frozen_fail(a, 1, 1, 0, 0); return -1; }
  return scr_arr_push_f64(a, v);
}
double scr_arr_push_bool_fz(ScrArr *a, bool v) {
  if (a->flags & SCR_ARR_FROZEN) { scr_arr_frozen_fail(a, 1, 1, 0, 0); return -1; }
  return scr_arr_push_bool(a, v);
}
double scr_arr_push_ref_fz(ScrArr *a, void *v) {
  if (a->flags & SCR_ARR_FROZEN) {
    scr_arr_drop_value(a, v);
    scr_arr_frozen_fail(a, 1, 1, 0, 0);
    return -1;
  }
  return scr_arr_push_ref(a, v);
}

ScrArr *scr_arr_freeze(ScrArr *a) {
  a->flags |= SCR_ARR_FROZEN;
  return scr_arr_retain(a);
}

bool scr_arr_is_frozen(const ScrArr *a) { return (a->flags & SCR_ARR_FROZEN) != 0; }

/* V8's four frozen-array TypeErrors. */
static void frozen_throw(const char *fmt, double idx) {
  char buf[160];
  int n = snprintf(buf, sizeof buf, fmt, idx);
  scr_throw_error_msg(SCR_ERR_TYPE, buf, (size_t)n);
}
static void frozen_add(size_t i) { frozen_throw("Cannot add property %.0f, object is not extensible", (double)i); }
static void frozen_ro(size_t i) { frozen_throw("Cannot assign to read only property '%.0f' of object '[object Array]'", (double)i); }
static void frozen_del(size_t i) { frozen_throw("Cannot delete property '%.0f' of [object Array]", (double)i); }
static void frozen_rolen(void) {
  static const char msg[] = "Cannot assign to read only property 'length' of object '[object Array]'";
  scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
}

/* The index normalizations below are the ones the unfrozen runtime applies (scr_arr_fill_*, scr_arr_copy_within, scr_arr_splice*). */
static size_t frozen_rel(double v, double len, bool nan_is_zero) {
  double s = nan_is_zero ? (isnan(v) ? 0 : trunc(v)) : v;
  if (s < 0) s += len;
  if (!(s >= 0)) s = 0;
  if (s > len) s = len;
  return (size_t)s;
}

void scr_arr_frozen_fail(ScrArr *a, double op, double x, double y, double z) {
  if (!(a->flags & SCR_ARR_FROZEN)) return;
  scr_frozen_fail_len(a->len, op, x, y, z);
}

void scr_frozen_fail_len(size_t len, double op, double x, double y, double z) {
  const double dlen = (double)len;
  switch ((int)op) {
    case 1: /* push */
      if (x < 1) frozen_rolen(); else frozen_add(len);
      return;
    case 2: /* pop */
      if (len == 0) frozen_rolen(); else frozen_del(len - 1);
      return;
    case 3: /* shift */
      if (len == 0) frozen_rolen(); else if (len == 1) frozen_del(0); else frozen_ro(0);
      return;
    case 4: /* unshift */
      if (x < 1) frozen_rolen(); else if (len > 0) frozen_add(len + (size_t)x - 1); else frozen_add(0);
      return;
    case 5: /* reverse */
      if (len >= 2) frozen_ro(0);
      return;
    case 6: { /* fill */
      size_t s = frozen_rel(x, dlen, false), e = frozen_rel(y, dlen, false);
      if (s < e) frozen_ro(s);
      return;
    }
    case 7: { /* copyWithin */
      size_t to = frozen_rel(x, dlen, true), from = frozen_rel(y, dlen, true);
      double e0 = isnan(z) ? 0 : trunc(z);
      if (e0 < 0) e0 += dlen;
      size_t fin = e0 <= 0 ? 0 : (e0 >= dlen ? len : (size_t)e0);
      size_t count = fin > from ? fin - from : 0;
      if (count > len - to) count = len - to;
      if (count == 0) return;
      if (from < to && to < from + count) frozen_ro(to + count - 1); else frozen_ro(to);
      return;
    }
    case 8: { /* splice */
      size_t from = frozen_rel(x, dlen, true);
      double avail = dlen - (double)from;
      double d0 = isnan(y) ? 0 : trunc(y);
      size_t n = d0 <= 0 ? 0 : d0 >= avail ? (size_t)avail : (size_t)d0;
      size_t m = z < 1 ? 0 : (size_t)z;
      if (m < n) {
        if (from < len - n) frozen_ro(from + m); else frozen_del(len - 1);
      } else if (m > n) {
        if (len - n > from) frozen_add(len - n + m - 1);
        else if (from < len) frozen_ro(from); else frozen_add(from);
      } else if (m > 0) {
        if (from < len) frozen_ro(from); else frozen_add(from);
      } else {
        frozen_rolen();
      }
      return;
    }
    case 9: /* element write */
      if (x >= 0 && x < dlen) frozen_ro((size_t)x); else frozen_add((size_t)x);
      return;
    case 10: /* length write */
      frozen_rolen();
      return;
    case 11: /* element clear (a write of the absent value) */
      frozen_ro((size_t)x);
      return;
    case 12: /* delete of an element */
      frozen_del((size_t)x);
      return;
    default:
      return;
  }
}

/* ── the dyn array's guards (reached through scr_dyn_frozen_ops, which only this unit installs) ──────────────────────────────
 * The checked-dynamic array writes (scr_json.c's keyed write and delete, scr_dyn_invoke.c's in-place methods) test the flag inline and call
 * here only when it is set, so a program that freezes no dyn array links none of this. */
static bool dyn_is_index(const ScrStr *key, size_t *out) {
  size_t idx = 0;
  int ok = key->len > 0 && key->len < 16 && !(key->len > 1 && key->data[0] == '0');
  for (size_t i = 0; ok && i < key->len; i++) {
    if (key->data[i] < '0' || key->data[i] > '9') ok = 0;
    else idx = idx * 10 + (size_t)(key->data[i] - '0');
  }
  *out = idx;
  return ok != 0;
}

/* `a[k] = v` on a frozen dyn array: sloppy code ignores it, strict code throws V8's TypeError for the first thing the write would do. */
static void frozen_dyn_set(ScrDyn *recv, ScrStr *key) {
  if (scr_dyn_sloppy_write()) return;
  size_t idx = 0;
  if (dyn_is_index(key, &idx)) scr_frozen_fail_len(recv->v.arr.len, 9, (double)idx, 0, 0);
  else if (key->len == 6 && memcmp(key->data, "length", 6) == 0) scr_frozen_fail_len(recv->v.arr.len, 10, 0, 0, 0);
  else {
    ScrJsonBuf fb;
    scr_jb_init(&fb);
    scr_jb_puts(&fb, "Cannot add property ");
    for (size_t i = 0; i < key->len; i++) scr_jb_putc(&fb, key->data[i]);
    scr_jb_puts(&fb, ", object is not extensible");
    scr_throw_error(SCR_ERR_TYPE, scr_jb_finish(&fb));
  }
}

/* `delete a[i]` on a frozen dyn array: sloppy code answers false, strict code throws. Answers whether the delete was refused. */
static bool frozen_dyn_delete(ScrDyn *recv, ScrStr *key) {
  size_t idx = 0;
  if (!dyn_is_index(key, &idx) || idx >= recv->v.arr.len) return false;
  if (!scr_dyn_sloppy_write()) scr_frozen_fail_len(recv->v.arr.len, 12, (double)idx, 0, 0);
  return true;
}

/* An in-place method on a frozen dyn array: throws V8's TypeError for the first write the spec algorithm makes (a no-op case, an empty fill range say, returns
 * and changes nothing). false = an exception is pending. */
static bool frozen_dyn_invoke(ScrDyn *recv, const char *method, ScrDyn **args, size_t argc) {
  int fop = 0;
  double fx = 0, fy = 0, fz = 0;
  const double inf = (double)INFINITY;
#define FRZ_NUM(i, dflt) ((i) < argc && args[(i)]->kind != SCR_DYN_UNDEF ? scr_dyn_to_number(args[(i)]) : (dflt))
  if (strcmp(method, "push") == 0) { fop = 1; fx = (double)argc; }
  else if (strcmp(method, "pop") == 0) fop = 2;
  else if (strcmp(method, "shift") == 0) fop = 3;
  else if (strcmp(method, "unshift") == 0) { fop = 4; fx = (double)argc; }
  else if (strcmp(method, "reverse") == 0 || strcmp(method, "sort") == 0) fop = 5;
  else if (strcmp(method, "fill") == 0) { fop = 6; fx = FRZ_NUM(1, 0); fy = FRZ_NUM(2, inf); }
  else if (strcmp(method, "copyWithin") == 0) { fop = 7; fx = FRZ_NUM(0, 0); fy = FRZ_NUM(1, 0); fz = FRZ_NUM(2, inf); }
  else if (strcmp(method, "splice") == 0) { fop = 8; fx = FRZ_NUM(0, 0); fy = argc < 2 ? inf : FRZ_NUM(1, 0); fz = argc > 2 ? (double)(argc - 2) : 0; }
#undef FRZ_NUM
  if (fop == 0) return true;
  if (scr_exc_pending()) return false;
  scr_frozen_fail_len(recv->v.arr.len, fop, fx, fy, fz);
  return !scr_exc_pending();
}

ScrDyn *scr_dyn_arr_freeze(ScrDyn *d) {
  if (d->kind != SCR_DYN_ARR) {
    static const char msg[] = "Object.freeze reached a dynamic value that is not an array (the compiler proves the operand of a dynamic freeze is a fresh array)";
    scr_throw_error_msg(SCR_ERR_ERROR, msg, sizeof msg - 1);
    return NULL;
  }
  d->null_proto = true; /* the ARR kind's frozen flag */
  return scr_dyn_retain(d);
}

static const ScrDynFrozenOps frozen_ops = { frozen_dyn_set, frozen_dyn_delete, frozen_dyn_invoke };
__attribute__((constructor)) static void frozen_install(void) { scr_dyn_frozen_ops = &frozen_ops; }
