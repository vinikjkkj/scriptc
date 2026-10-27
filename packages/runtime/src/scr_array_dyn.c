/* Dyn-element array operations (ScrArr over ScrDyn* boxes): pop/shift, splice with
 * items, join, sort, the dyn iterable spread, and the f64 view of an any[] apply.
 * These reference the dyn tier (scr_json.c), so they live in their own unit: the
 * standalone runtime test link sets that build scr_array.c without the dyn tier
 * do not link this file. cc.ts links it with the other runtime units. */
#include "scr_runtime.h"

/* Helpers defined in scr_array.c (file-private there until this unit needed them). */
void scr_arr_oom_ext(void);
uint64_t scr_slot_from_ptr_ext(void *p);
void *scr_slot_to_ptr_ext(uint64_t s);
void *scr_elem_retain_p_ext(const ScrArr *a, void *p);
uint64_t scr_arr_shift_slot_ext(ScrArr *a);
void scr_arr_grow_ext(ScrArr *a, size_t need);
void scr_join_append_ext(char **buf, size_t *len, size_t *cap, const char *bytes, size_t n);
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* pop/shift over DYN-element arrays: an empty array or an ABSENT slot is
 * undefined, which is the immortal dyn undefined (never freed), and a present
 * element moves out as its own +1 box. */
void *scr_arr_pop_dyn(ScrArr *a) {
  if (a->len == 0) return scr_dyn_undefined();
  void *p = scr_slot_to_ptr_ext(a->data[--a->len]);
  return p != NULL ? p : scr_dyn_undefined();
}

void *scr_arr_shift_dyn(ScrArr *a) {
  if (a->len == 0) return scr_dyn_undefined();
  void *p = scr_slot_to_ptr_ext(scr_arr_shift_slot_ext(a));
  return p != NULL ? p : scr_dyn_undefined();
}

/* splice(start, deleteCount, ...items) with the inserted items as an ARRAY
 * (same element kind; borrowed). The removed elements come back as a fresh
 * +1 array exactly as scr_arr_splice (moved out). The inserted items are
 * RETAINED into the receiver: a snapshot of them is taken before the
 * receiver is touched, so `a.splice(0, 0, ...a)` inserts JS's pre-call copy.
 * Borrows a and items. */
ScrArr *scr_arr_splice_ins(ScrArr *a, double start, double deleteCount, ScrArr *items) {
  double len = (double)a->len;
  double s0 = isnan(start) ? 0 : trunc(start);
  if (s0 < 0) s0 += len;
  size_t from = s0 <= 0 ? 0 : s0 >= len ? a->len : (size_t)s0;
  double avail = len - (double)from;
  double d0 = isnan(deleteCount) ? 0 : trunc(deleteCount);
  size_t n = d0 <= 0 ? 0 : d0 >= avail ? (size_t)avail : (size_t)d0;
  size_t m = items->len;
  /* Snapshot the items, retained (the aliasing case reads items == a). */
  uint64_t *ins = m ? malloc(m * sizeof(uint64_t)) : NULL;
  if (m && !ins) scr_arr_oom_ext();
  for (size_t i = 0; i < m; i++) {
    uint64_t s = items->data[i];
    if (a->elem == SCR_ELEM_F64 || a->elem == SCR_ELEM_BOOL) {
      ins[i] = s;
      continue;
    }
    void *p = scr_slot_to_ptr_ext(s);
    ins[i] = p == NULL ? s : scr_slot_from_ptr_ext(scr_elem_retain_p_ext(a, p));
  }
  ScrArr *out =
      a->elem == SCR_ELEM_REF
          ? scr_arr_new_ref(a->elem_retain, a->elem_release, a->elem_trace, n ? n : 1)
          : scr_arr_new(a->elem, n ? n : 1);
  if (n > 0) {
    memcpy(out->data, a->data + from, n * sizeof(uint64_t));
    out->len = n;
  }
  size_t tail = a->len - from - n;
  uint64_t *keep = tail ? malloc(tail * sizeof(uint64_t)) : NULL;
  if (tail && !keep) scr_arr_oom_ext();
  if (tail) memcpy(keep, a->data + from + n, tail * sizeof(uint64_t));
  a->len = from;
  scr_arr_grow_ext(a, from + m + tail);
  for (size_t i = 0; i < m; i++) a->data[a->len++] = ins[i];
  for (size_t i = 0; i < tail; i++) a->data[a->len++] = keep[i];
  free(keep);
  free(ins);
  return out;
}

/* Array.prototype.join over a DYN-element array (ref slots holding ScrDyn*).
 * An absent slot (hole) and an undefined/null element print empty; every
 * other element is ToString'd with the object protocol, so a user toString
 * runs and its throw propagates: NULL with the exception pending (the
 * emitter's pending check unwinds). Borrows a and sep; +1 result. */
ScrStr *scr_arr_join_dyn(ScrArr *a, ScrStr *sep) {
  size_t cap = 64, len = 0;
  char *buf = malloc(cap);
  if (!buf) scr_arr_oom_ext();
  size_t n = a->len;
  for (size_t i = 0; i < n; i++) {
    if (i > 0) scr_join_append_ext(&buf, &len, &cap, sep->data, sep->len);
    /* Re-read the slot each step: a toString may have changed the array. */
    const ScrDyn *d = i < a->len ? (const ScrDyn *)scr_slot_to_ptr_ext(a->data[i]) : NULL;
    if (d == NULL || scr_dyn_is_nullish(d)) continue;
    ScrStr *s = scr_dyn_string_coerce_js(d);
    if (s == NULL) {
      free(buf);
      return NULL;
    }
    scr_join_append_ext(&buf, &len, &cap, s->data, s->len);
    scr_str_release(s);
  }
  ScrStr *out = scr_str_new(buf, len);
  free(buf);
  return out;
}

/* Array.prototype.sort() with no comparator over DYN-element arrays: the
 * elements compare by ToString (UTF-16 code units, the string sort's
 * order), undefined elements (holes included) sort LAST and are never
 * converted. The sort is stable (merge sort, as JS's TimSort is). Each
 * element's string is converted ONCE before the sort. `copy` sorts a fresh
 * copy instead (toSorted). Returns +1; NULL with the exception pending when
 * an element's toString throws. In place: returns the receiver, retained. */
typedef struct {
  ScrStr *key;   /* NULL for an undefined element (sorts last) */
  uint64_t slot; /* the element's slot, moved, never retained here */
} ScrDynSortItem;

static int scr_dyn_sort_before(const ScrDynSortItem *x, const ScrDynSortItem *y) {
  if (x->key == NULL) return 0;          /* undefined vs undefined: equal */
  if (y->key == NULL) return -1;         /* undefined sorts last */
  return scr_str_cmp_u16(x->key, y->key);
}

static void scr_dyn_sort_merge(ScrDynSortItem *v, ScrDynSortItem *tmp, size_t n) {
  if (n < 2) return;
  size_t h = n / 2;
  scr_dyn_sort_merge(v, tmp, h);
  scr_dyn_sort_merge(v + h, tmp, n - h);
  size_t i = 0, j = h, k = 0;
  while (i < h && j < n) {
    /* Take from the right only when strictly before: equal keys keep order. */
    if (scr_dyn_sort_before(&v[j], &v[i]) < 0) tmp[k++] = v[j++];
    else tmp[k++] = v[i++];
  }
  while (i < h) tmp[k++] = v[i++];
  while (j < n) tmp[k++] = v[j++];
  memcpy(v, tmp, n * sizeof *v);
}

ScrArr *scr_arr_sort_dyn(ScrArr *a, bool copy) {
  ScrArr *out = copy ? scr_arr_slice(a, 0, INFINITY) : scr_arr_retain(a);
  size_t n = out->len;
  if (n < 2) return out;
  ScrDynSortItem *v = malloc(n * sizeof *v);
  ScrDynSortItem *tmp = malloc(n * sizeof *tmp);
  if (!v || !tmp) scr_arr_oom_ext();
  for (size_t i = 0; i < n; i++) {
    uint64_t s = out->data[i];
    const ScrDyn *d = (const ScrDyn *)scr_slot_to_ptr_ext(s);
    v[i].slot = s;
    v[i].key = NULL;
    if (d != NULL && !scr_dyn_is_nullish(d)) {
      v[i].key = scr_dyn_string_coerce_js(d);
      if (v[i].key == NULL) {
        /* An element's toString threw: release what was converted. */
        for (size_t j = 0; j < i; j++) scr_str_release(v[j].key);
        free(v);
        free(tmp);
        scr_arr_release(out);
        return NULL;
      }
    }
  }
  scr_dyn_sort_merge(v, tmp, n);
  for (size_t i = 0; i < n; i++) out->data[i] = v[i].slot;
  for (size_t i = 0; i < n; i++) scr_str_release(v[i].key);
  free(v);
  free(tmp);
  return out;
}

ScrArr *scr_arr_sort_dyn_inplace(ScrArr *a) { return scr_arr_sort_dyn(a, false); }
ScrArr *scr_arr_to_sorted_dyn(ScrArr *a) { return scr_arr_sort_dyn(a, true); }

/* A dyn iterable spread into an any[] literal: the iterator pack's elements, in order,
 * as dyn boxes (an array hole is the undefined singleton). NULL with the exception
 * pending when the source is not iterable (scr_dyn_iter_pack's own TypeError). */
ScrArr *scr_arr_from_dyn_iter(const ScrDyn *src, const ScrStr *msg) {
  ScrDyn *pack = scr_dyn_iter_pack(src, msg);
  if (pack == NULL) return NULL;
  size_t n = (size_t)scr_dyn_arr_len(pack);
  ScrArr *out = scr_arr_new_ref(scr_dyn_retain_v, scr_dyn_release_v, scr_dyn_trace_v, n ? n : 1);
  for (size_t i = 0; i < n; i++) scr_arr_push_ref(out, scr_dyn_arr_at(pack, (double)i));
  scr_dyn_release(pack);
  return out;
}

/* An any[] (dyn elements) as an f64[] of its ToNumber values, a fresh copy: the
 * argument list of an apply() whose callee reads numbers (String.fromCharCode).
 * Each element converts once, in order; a hole is undefined, which is NaN. NaN
 * with the exception pending when an object element's conversion throws. */
ScrArr *scr_arr_to_f64_dyn(ScrArr *a) {
  ScrArr *out = scr_arr_new(SCR_ELEM_F64, a->len ? a->len : 1);
  for (size_t i = 0; i < a->len; i++) {
    const ScrDyn *d = (const ScrDyn *)scr_slot_to_ptr_ext(a->data[i]);
    scr_arr_push_f64(out, d == NULL ? NAN : scr_dyn_to_number(d));
  }
  return out;
}
