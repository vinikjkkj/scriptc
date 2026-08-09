#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Live heap-array count for the RC audit lane (-DSCR_RC_AUDIT); same
 * contract as scr_str_live_count in scr_string.c. */
#ifdef SCR_RC_AUDIT
static long scr_live_arrays = 0;
long scr_arr_live_count(void) { return scr_live_arrays; }
#endif

static void scr_arr_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* JS would return undefined for an OOB read and create holes for a far OOB
 * write; both are unrepresentable here (see SEMANTICS.md), so any invalid
 * index — negative, fractional, NaN, or past the allowed end — traps. */
static void scr_arr_trap_oob(double i, size_t len) {
  char buf[32];
  scr_f64_to_str(i, buf);
  scr_trap_fmt("scriptc: RangeError: array index %s out of bounds (length %zu)\n",
               buf, len);
}

/* An ABSENT reference slot read as a value. A ref-element slot holds NULL
 * when nothing has been written to it (arrayNewLen / `Array.from({length:
 * n})` / the growth half of `a.length = n`) or when the tombstone store
 * cleared it (`a[i] = null as unknown as T` — the GC-drop idiom). JS reads
 * undefined from a hole; scriptc arrays are dense, so the read REFUSES,
 * the same stance and the same shape as the out-of-bounds trap above.
 *
 * Before this fence the three readers that reach a NULL slot — the indexed
 * read, for-of, and the console.log/JSON walkers — handed the NULL on and
 * the program died on a field load, with no index, no length and no line;
 * `pop()` handed it to a typed local where `=== null` folds to the
 * constant false, which is a silent wrong answer rather than a crash. */
static void scr_arr_trap_absent(size_t i, size_t len) {
  scr_trap_fmt("scriptc: TypeError: array element %zu is absent (length %zu) "
               "-- the slot was never assigned, or was cleared with null; "
               "JS reads undefined from a hole\n",
               i, len);
}

/* Validate i as an element index. limit is a->len for reads, a->len + 1 for
 * writes (i == len appends). NaN fails the >= 0 test; fractional indices
 * fail the trunc test. */
static size_t scr_arr_check_index(const ScrArr *a, double i, bool allow_append) {
  size_t limit = a->len + (allow_append ? 1 : 0);
  if (!(i >= 0) || i != trunc(i) || i >= (double)limit) {
    scr_arr_trap_oob(i, a->len);
  }
  return (size_t)i;
}

/* ── slot packing: 8-byte slots hold doubles, bools, or pointers ───────── */

static uint64_t scr_slot_from_f64(double v) {
  uint64_t s;
  memcpy(&s, &v, sizeof s);
  return s;
}

static double scr_slot_to_f64(uint64_t s) {
  double v;
  memcpy(&v, &s, sizeof v);
  return v;
}

static uint64_t scr_slot_from_ptr(void *p) { return (uint64_t)(uintptr_t)p; }

static void *scr_slot_to_ptr(uint64_t s) { return (void *)(uintptr_t)s; }

static bool scr_elem_is_ref(ScrElemKind k) {
  return k == SCR_ELEM_STR || k == SCR_ELEM_ARR || k == SCR_ELEM_BYTES ||
         k == SCR_ELEM_REF;
}

static void scr_elem_release(const ScrArr *a, uint64_t slot) {
  void *p = scr_slot_to_ptr(slot);
  if (p == NULL) return; /* an ABSENT slot owns nothing */
  if (a->elem == SCR_ELEM_STR) scr_str_release((ScrStr *)p);
  else if (a->elem == SCR_ELEM_ARR) scr_arr_release((ScrArr *)p);
  else if (a->elem == SCR_ELEM_BYTES) scr_bytes_release((ScrBytes *)p);
  else if (a->elem == SCR_ELEM_REF) a->elem_release(p);
}

/* The retain half, and the ONE spelling of it: every element copy in this
 * file (get, the spread copy, slice, fill, copyWithin) went through its own
 * inline ladder, and only two of the five had the NULL guard an ABSENT slot
 * needs. Copies PROPAGATE absence — a hole survives a slice or a spread in
 * JS too; only a READ refuses it. */
static void *scr_elem_retain_p(const ScrArr *a, void *p) {
  if (p == NULL) return NULL; /* an ABSENT slot copies as absent */
  if (a->elem == SCR_ELEM_STR) return scr_str_retain((ScrStr *)p);
  if (a->elem == SCR_ELEM_ARR) return scr_arr_retain((ScrArr *)p);
  if (a->elem == SCR_ELEM_BYTES) return scr_bytes_retain((ScrBytes *)p);
  if (a->elem == SCR_ELEM_REF) return a->elem_retain(p);
  return p;
}

/* ── lifecycle ─────────────────────────────────────────────────────────── */

static void scr_arr_grow(ScrArr *a, size_t need) {
  if (need <= a->cap) return;
  size_t cap = a->cap ? a->cap : 4;
  while (cap < need) {
    if (cap > SIZE_MAX / 2 / sizeof(uint64_t)) scr_arr_oom();
    cap *= 2;
  }
  uint64_t *data = realloc(a->data, cap * sizeof(uint64_t));
  if (!data) scr_arr_oom();
  a->data = data;
  a->cap = cap;
}

ScrArr *scr_arr_new(ScrElemKind elem, size_t initial_cap) {
  ScrArr *a = malloc(sizeof(ScrArr));
  if (!a) scr_arr_oom();
  a->rc = 1;
  a->len = 0;
  a->cap = 0;
  a->elem = elem;
  a->elem_retain = NULL;
  a->elem_release = NULL;
  a->elem_trace = NULL;
  a->data = NULL;
  if (initial_cap > 0) scr_arr_grow(a, initial_cap);
#ifdef SCR_RC_AUDIT
  scr_live_arrays++;
#endif
  return a;
}

/* Collector trace of a cycle-capable array: every element is a headered
 * child (elem_trace non-NULL means the element TYPE carries a header, and
 * arrays are monomorphic), so trace visits all of them and the teardown
 * below releases none — the complement contract in scr_runtime.h. */
void scr_arr_trace_v(void *a0, ScrTraceVisit visit, void *ctx) {
  ScrArr *a = (ScrArr *)a0;
  for (size_t i = 0; i < a->len; i++) {
    void *p = scr_slot_to_ptr(a->data[i]);
    if (p != NULL) visit(p, ctx); /* an ABSENT slot is not an edge */
  }
}

static void scr_arr_gc_free(void *a0) {
  ScrArr *a = (ScrArr *)a0;
  free(a->data);
#ifdef SCR_RC_AUDIT
  scr_live_arrays--;
#endif
  scr_cyc_free(a);
}

ScrArr *scr_arr_new_ref(void *(*elem_retain)(void *),
                         void (*elem_release)(void *),
                         ScrTraceFn elem_trace, size_t initial_cap) {
  ScrArr *a;
  if (elem_trace) {
    a = scr_cyc_alloc(sizeof(ScrArr), &scr_arr_trace_v, &scr_arr_gc_free);
  } else {
    a = malloc(sizeof(ScrArr));
    if (!a) scr_arr_oom();
  }
  a->rc = 1;
  a->len = 0;
  a->cap = 0;
  a->elem = SCR_ELEM_REF;
  a->elem_retain = elem_retain;
  a->elem_release = elem_release;
  a->elem_trace = elem_trace;
  a->data = NULL;
  if (initial_cap > 0) scr_arr_grow(a, initial_cap);
#ifdef SCR_RC_AUDIT
  scr_live_arrays++;
#endif
  return a;
}

void scr_arr_release(ScrArr *a) {
  if (!a || a->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--a->rc == 0) {
    if (a->elem_trace) scr_cyc_on_dead(a);
    if (scr_elem_is_ref(a->elem)) {
      for (size_t i = 0; i < a->len; i++) scr_elem_release(a, a->data[i]);
    }
    if (a->elem_trace) {
      scr_arr_gc_free(a);
    } else {
      free(a->data);
#ifdef SCR_RC_AUDIT
      scr_live_arrays--;
#endif
      free(a);
    }
  } else if (a->elem_trace) {
    scr_cyc_on_release(a); /* possible cycle root; may collect */
  }
}

double scr_arr_len(ScrArr *a) { return (double)a->len; }

/* ── Math.max/min over one spread number[] ─────────────────────────────
 * The JS fold exactly (ECMA Math.max/min applied to the elements): any
 * NaN poisons the result, +0 beats -0 for max (the reverse for min), and
 * the empty array yields the zero-argument constants. Borrows the array. */
double scr_math_max_arr(ScrArr *a) {
  double best = -INFINITY;
  for (size_t i = 0; i < a->len; i++) {
    double v = scr_slot_to_f64(a->data[i]);
    if (isnan(v)) return v;
    if (v > best || (v == 0.0 && best == 0.0 && !signbit(v))) best = v;
  }
  return best;
}

double scr_math_min_arr(ScrArr *a) {
  double best = INFINITY;
  for (size_t i = 0; i < a->len; i++) {
    double v = scr_slot_to_f64(a->data[i]);
    if (isnan(v)) return v;
    if (v < best || (v == 0.0 && best == 0.0 && signbit(v))) best = v;
  }
  return best;
}

/* ── reads ─────────────────────────────────────────────────────────────── */

double scr_arr_get_f64(ScrArr *a, double i) {
  return scr_slot_to_f64(a->data[scr_arr_check_index(a, i, false)]);
}

bool scr_arr_get_bool(ScrArr *a, double i) {
  return a->data[scr_arr_check_index(a, i, false)] != 0;
}

void *scr_arr_get_ref(ScrArr *a, double i) {
  size_t idx = scr_arr_check_index(a, i, false);
  void *p = scr_slot_to_ptr(a->data[idx]);
  if (p == NULL) scr_arr_trap_absent(idx, a->len);
  return scr_elem_retain_p(a, p);
}

/* The COPY read: same +1, but an ABSENT slot copies through as absent
 * instead of refusing. Used by the spread and pushSpread loops the
 * emitters build, which are element-for-element copies — `[...a]` and
 * `b.push(...a)` over a holey array answer holes in JS, exactly like
 * `a.slice()`, and it would be incoherent for slice to survive a hole
 * while the spread beside it trapped. Bounds are still checked. */
void *scr_arr_copy_ref(ScrArr *a, double i) {
  void *p = scr_slot_to_ptr(a->data[scr_arr_check_index(a, i, false)]);
  return scr_elem_retain_p(a, p);
}

/* ── writes: i == len appends ──────────────────────────────────────────── */

static void scr_arr_set_slot(ScrArr *a, double i, uint64_t slot) {
  size_t idx = scr_arr_check_index(a, i, true);
  if (idx == a->len) {
    scr_arr_grow(a, a->len + 1);
    a->len++;
    a->data[idx] = slot;
    return;
  }
  /* Unlink-then-release: a release can trigger a cycle collection, which
   * must never see a heap edge whose count was already given up. */
  uint64_t old = a->data[idx];
  a->data[idx] = slot;
  if (scr_elem_is_ref(a->elem)) scr_elem_release(a, old);
}

void scr_arr_set_f64(ScrArr *a, double i, double v) {
  scr_arr_set_slot(a, i, scr_slot_from_f64(v));
}

void scr_arr_set_bool(ScrArr *a, double i, bool v) {
  scr_arr_set_slot(a, i, (uint64_t)(v ? 1 : 0));
}

void scr_arr_set_ref(ScrArr *a, double i, void *v) {
  scr_arr_set_slot(a, i, scr_slot_from_ptr(v));
}

/* ── push / pop ────────────────────────────────────────────────────────── */

static double scr_arr_push_slot(ScrArr *a, uint64_t slot) {
  scr_arr_grow(a, a->len + 1);
  a->data[a->len++] = slot;
  return (double)a->len;
}

double scr_arr_push_f64(ScrArr *a, double v) {
  return scr_arr_push_slot(a, scr_slot_from_f64(v));
}

double scr_arr_push_bool(ScrArr *a, bool v) {
  return scr_arr_push_slot(a, (uint64_t)(v ? 1 : 0));
}

double scr_arr_push_ref(ScrArr *a, void *v) {
  return scr_arr_push_slot(a, scr_slot_from_ptr(v));
}

/* ── unshift ───────────────────────────────────────────────────────────
 * push's mirror at the FRONT: the tail slides up one and the new element
 * takes index 0, answering the new length. Ownership of a refcounted
 * argument moves IN, exactly like push — the emitter's moveTemp gives up
 * the caller's reference. The variadic form is the emitter's: it
 * evaluates every argument left to right (JS order) and then unshifts
 * them RIGHT to left, which lands them in declaration order at the head.
 * One memmove per argument, and argument counts are single digits. */
static double scr_arr_unshift_slot(ScrArr *a, uint64_t slot) {
  scr_arr_grow(a, a->len + 1);
  memmove(a->data + 1, a->data, a->len * sizeof(uint64_t));
  a->data[0] = slot;
  a->len++;
  return (double)a->len;
}

double scr_arr_unshift_f64(ScrArr *a, double v) {
  return scr_arr_unshift_slot(a, scr_slot_from_f64(v));
}

double scr_arr_unshift_bool(ScrArr *a, bool v) {
  return scr_arr_unshift_slot(a, (uint64_t)(v ? 1 : 0));
}

double scr_arr_unshift_ref(ScrArr *a, void *v) {
  return scr_arr_unshift_slot(a, scr_slot_from_ptr(v));
}

/* ── reverse ───────────────────────────────────────────────────────────
 * In place, then the RECEIVER back (+1) for chaining — fill's contract,
 * and the reason `a.reverse()` and `a` stay the same array in JS. Slots
 * only swap positions, so no element's reference count changes. */
ScrArr *scr_arr_reverse(ScrArr *a) {
  if (a->len > 1) {
    for (size_t i = 0, j = a->len - 1; i < j; i++, j--) {
      uint64_t t = a->data[i];
      a->data[i] = a->data[j];
      a->data[j] = t;
    }
  }
  return scr_arr_retain(a);
}

/* ── copyWithin(target, start[, end]) ──────────────────────────────────
 * Copies the [start, end) run over the slots at target, IN PLACE and
 * without changing the length, then answers the receiver (+1). Every
 * index goes through ToIntegerOrInfinity with negative-from-the-end
 * resolution and clamping to [0, len] — splice's ladder — and the count
 * is min(end - start, len - target), so nothing ever runs off the end.
 * An omitted `end` arrives as +Infinity (the slice convention).
 *
 * Reference elements are the only interesting part: a copied value gains
 * a reference and an overwritten slot gives one up. Source and
 * destination OVERLAP in general (the ring-buffer compaction shape,
 * copyWithin(0, head), overlaps whenever head*2 < len), so the whole
 * source run is retained into scratch FIRST — a release during the write
 * can then never free a slot the copy still has to read. The writes
 * themselves are unlink-then-release, scr_arr_set_slot's discipline. */
ScrArr *scr_arr_copy_within(ScrArr *a, double target, double start,
                            double end) {
  double len = (double)a->len;
  double t0 = isnan(target) ? 0 : trunc(target);
  if (t0 < 0) t0 += len;
  size_t to = t0 <= 0 ? 0 : (t0 >= len ? a->len : (size_t)t0);
  double s0 = isnan(start) ? 0 : trunc(start);
  if (s0 < 0) s0 += len;
  size_t from = s0 <= 0 ? 0 : (s0 >= len ? a->len : (size_t)s0);
  double e0 = isnan(end) ? 0 : trunc(end);
  if (e0 < 0) e0 += len;
  size_t fin = e0 <= 0 ? 0 : (e0 >= len ? a->len : (size_t)e0);
  size_t count = fin > from ? fin - from : 0;
  if (count > a->len - to) count = a->len - to;
  if (count == 0) return scr_arr_retain(a);
  if (!scr_elem_is_ref(a->elem)) {
    memmove(a->data + to, a->data + from, count * sizeof(uint64_t));
    return scr_arr_retain(a);
  }
  uint64_t *tmp = malloc(count * sizeof(uint64_t));
  if (!tmp) scr_arr_oom();
  for (size_t i = 0; i < count; i++) {
    tmp[i] = scr_slot_from_ptr(
        scr_elem_retain_p(a, scr_slot_to_ptr(a->data[from + i])));
  }
  for (size_t i = 0; i < count; i++) {
    uint64_t old = a->data[to + i];
    a->data[to + i] = tmp[i];
    scr_elem_release(a, old);
  }
  free(tmp);
  return scr_arr_retain(a);
}

static uint64_t scr_arr_pop_slot(ScrArr *a) {
  if (a->len == 0) {
    scr_trap("scriptc: RangeError: pop() on an empty array\n");
  }
  return a->data[--a->len];
}

double scr_arr_pop_f64(ScrArr *a) { return scr_slot_to_f64(scr_arr_pop_slot(a)); }

bool scr_arr_pop_bool(ScrArr *a) { return scr_arr_pop_slot(a) != 0; }

/* pop/shift hand the element OUT to a typed slot, so an ABSENT one refuses
 * here for the same reason the indexed read does — and for one more: the
 * receiving slot's type has no null, so `p === null` on the result folds to
 * the constant false and the hole reads as a live object. */
void *scr_arr_pop_ref(ScrArr *a) {
  size_t idx = a->len ? a->len - 1 : 0;
  void *p = scr_slot_to_ptr(scr_arr_pop_slot(a));
  if (p == NULL) scr_arr_trap_absent(idx, a->len + 1);
  return p;
}

/* ── shift ─────────────────────────────────────────────────────────────
 * The first element out, tail sliding down. The EMITTER guards the empty
 * array (JS answers undefined there — the `elem | undefined` union), so
 * an empty receiver here is an internal error, pop's discipline. Ref
 * ownership moves out to the caller (no retain). */
static uint64_t scr_arr_shift_slot(ScrArr *a) {
  if (a->len == 0) {
    scr_trap("scriptc: internal error: shift() on an empty array\n");
  }
  uint64_t s = a->data[0];
  a->len--;
  memmove(a->data, a->data + 1, a->len * sizeof(uint64_t));
  return s;
}

double scr_arr_shift_f64(ScrArr *a) { return scr_slot_to_f64(scr_arr_shift_slot(a)); }

bool scr_arr_shift_bool(ScrArr *a) { return scr_arr_shift_slot(a) != 0; }

void *scr_arr_shift_ref(ScrArr *a) {
  void *p = scr_slot_to_ptr(scr_arr_shift_slot(a));
  if (p == NULL) scr_arr_trap_absent(0, a->len + 1);
  return p;
}

/* ── splice (the removal forms) ────────────────────────────────────────
 * a.splice(start, deleteCount) with Node's exact index handling: start
 * goes through ToIntegerOrInfinity with negative-from-the-end resolution
 * and clamps to [0, len]; deleteCount clamps to [0, len - start] (the
 * omitted-count form passes +Infinity — remove to the end). The removed
 * elements come back as a fresh +1 array IN ORDER, their ownership MOVED
 * out of the receiver (no retain/release churn); the tail slides down.
 * Borrows a. */
ScrArr *scr_arr_splice(ScrArr *a, double start, double deleteCount) {
  double len = (double)a->len;
  double s0 = isnan(start) ? 0 : trunc(start);
  if (s0 < 0) s0 += len;
  size_t from = s0 <= 0 ? 0 : s0 >= len ? a->len : (size_t)s0;
  double avail = len - (double)from;
  double d0 = isnan(deleteCount) ? 0 : trunc(deleteCount);
  size_t n = d0 <= 0 ? 0 : d0 >= avail ? (size_t)avail : (size_t)d0;
  ScrArr *out =
      a->elem == SCR_ELEM_REF
          ? scr_arr_new_ref(a->elem_retain, a->elem_release, a->elem_trace, n ? n : 1)
          : scr_arr_new(a->elem, n ? n : 1);
  if (n > 0) {
    memcpy(out->data, a->data + from, n * sizeof(uint64_t));
    out->len = n;
    memmove(a->data + from, a->data + from + n, (a->len - from - n) * sizeof(uint64_t));
    a->len -= n;
  }
  return out;
}

/* ── indexOf / includes ────────────────────────────────────────────────
 * indexOf uses JS strict equality (===): NaN never matches (NaN !== NaN),
 * -0 matches 0 (C == agrees on both). includes uses SameValueZero: the one
 * difference is that NaN DOES match NaN. Reference elements: strings by
 * content (JS strings are primitive values), arrays by pointer identity.
 * All needles are borrowed. */

static bool scr_arr_ref_eq(const ScrArr *a, uint64_t slot, void *v) {
  void *p = scr_slot_to_ptr(slot);
  /* An ABSENT slot matches only an absent needle: scr_str_eq dereferences
   * both sides, so the STR arm cannot be handed a hole. */
  if (p == NULL || v == NULL) return p == v;
  if (a->elem == SCR_ELEM_STR) return scr_str_eq((ScrStr *)p, (ScrStr *)v);
  return p == v;
}

double scr_arr_index_of_f64(ScrArr *a, double v) {
  for (size_t i = 0; i < a->len; i++) {
    if (scr_slot_to_f64(a->data[i]) == v) return (double)i; /* NaN: never */
  }
  return -1;
}

double scr_arr_index_of_bool(ScrArr *a, bool v) {
  for (size_t i = 0; i < a->len; i++) {
    if ((a->data[i] != 0) == v) return (double)i;
  }
  return -1;
}

double scr_arr_index_of_ref(ScrArr *a, void *v) {
  for (size_t i = 0; i < a->len; i++) {
    if (scr_arr_ref_eq(a, a->data[i], v)) return (double)i;
  }
  return -1;
}

bool scr_arr_includes_f64(ScrArr *a, double v) {
  for (size_t i = 0; i < a->len; i++) {
    double x = scr_slot_to_f64(a->data[i]);
    if (x == v || (x != x && v != v)) return true; /* SameValueZero: NaN hits */
  }
  return false;
}

bool scr_arr_includes_bool(ScrArr *a, bool v) {
  return scr_arr_index_of_bool(a, v) >= 0;
}

bool scr_arr_includes_ref(ScrArr *a, void *v) {
  return scr_arr_index_of_ref(a, v) >= 0;
}

/* ── join ──────────────────────────────────────────────────────────────── */

static void scr_join_append(char **buf, size_t *len, size_t *cap,
                             const char *bytes, size_t n) {
  if (*len + n > *cap) {
    size_t cap2 = *cap;
    while (*len + n > cap2) {
      if (cap2 > SIZE_MAX / 2) scr_arr_oom();
      cap2 *= 2;
    }
    char *grown = realloc(*buf, cap2);
    if (!grown) scr_arr_oom();
    *buf = grown;
    *cap = cap2;
  }
  memcpy(*buf + *len, bytes, n);
  *len += n;
}

/* `a.slice(start?, end?)` — a fresh shallow copy of the index range,
 * JS-exact: indices go through ToIntegerOrInfinity (the emitter fills the
 * omitted defaults 0 / +Infinity), negatives count from the end, both
 * clamp to [0, len]. Ref elements RETAIN into the copy — the same
 * references, exactly JS's shallow copy. Borrows a; returns +1. */
ScrArr *scr_arr_slice(ScrArr *a, double start, double end) {
  /* ToIntegerOrInfinity + relative-index resolution over the LENGTH. */
  double len = (double)a->len;
  double s0 = isnan(start) ? 0 : trunc(start);
  double e0 = isnan(end) ? 0 : trunc(end);
  if (s0 < 0) s0 += len;
  if (e0 < 0) e0 += len;
  size_t from = s0 <= 0 ? 0 : s0 >= len ? a->len : (size_t)s0;
  size_t to = e0 <= 0 ? 0 : e0 >= len ? a->len : (size_t)e0;
  size_t n = to > from ? to - from : 0;
  ScrArr *out =
      a->elem == SCR_ELEM_REF
          ? scr_arr_new_ref(a->elem_retain, a->elem_release, a->elem_trace, n ? n : 1)
          : scr_arr_new(a->elem, n ? n : 1);
  for (size_t i = 0; i < n; i++) {
    uint64_t slot = a->data[from + i];
    if (scr_elem_is_ref(a->elem)) {
      slot = scr_slot_from_ptr(scr_elem_retain_p(a, scr_slot_to_ptr(slot)));
    }
    out->data[out->len++] = slot;
  }
  return out;
}

ScrStr *scr_arr_join(ScrArr *a, ScrStr *sep) {
  size_t cap = 64, len = 0;
  char *buf = malloc(cap);
  if (!buf) scr_arr_oom();
  for (size_t i = 0; i < a->len; i++) {
    if (i > 0) scr_join_append(&buf, &len, &cap, sep->data, sep->len);
    switch (a->elem) {
      case SCR_ELEM_F64: {
        char nb[32];
        size_t n = scr_f64_to_str(scr_slot_to_f64(a->data[i]), nb);
        scr_join_append(&buf, &len, &cap, nb, n);
        break;
      }
      case SCR_ELEM_BOOL:
        if (a->data[i] != 0) scr_join_append(&buf, &len, &cap, "true", 4);
        else scr_join_append(&buf, &len, &cap, "false", 5);
        break;
      case SCR_ELEM_STR: {
        const ScrStr *s = (const ScrStr *)scr_slot_to_ptr(a->data[i]);
        scr_join_append(&buf, &len, &cap, s->data, s->len);
        break;
      }
      case SCR_ELEM_ARR:
      case SCR_ELEM_BYTES:
      case SCR_ELEM_REF:
        /* The compiler rejects join on ref-element arrays (SC1090). */
        scr_trap("scriptc: internal error: join on a ref-element array\n");
    }
  }
  ScrStr *out = scr_str_new(buf, len);
  free(buf);
  return out;
}

/* String.raw over the template's raw literals and PRE-STRINGIFIED
 * substitutions (the frontend applies the static ToString per value):
 * raw[0] sub[0] raw[1] sub[1] ... — substitutions beyond raw.len-1 drop,
 * missing ones skip, exactly the spec's loop. Both arrays are
 * SCR_ELEM_STR; borrows both; +1 result. Never throws. */
ScrStr *scr_str_raw(ScrArr *raw, ScrArr *subs) {
  size_t cap = 64, len = 0;
  char *buf = malloc(cap);
  if (!buf) scr_arr_oom();
  for (size_t i = 0; i < raw->len; i++) {
    const ScrStr *s = (const ScrStr *)scr_slot_to_ptr(raw->data[i]);
    scr_join_append(&buf, &len, &cap, s->data, s->len);
    if (i + 1 < raw->len && i < subs->len) {
      const ScrStr *v = (const ScrStr *)scr_slot_to_ptr(subs->data[i]);
      scr_join_append(&buf, &len, &cap, v->data, v->len);
    }
  }
  ScrStr *out = scr_str_new(buf, len);
  free(buf);
  return out;
}

/* ── fill(value[, start[, end]]) ──────────────────────────────────────────
 * Writes `v` into every slot of [start, end), then answers the RECEIVER
 * (+1 — the caller owns a reference, like every other returning method).
 * Index handling is the slice family's: relative from the end when
 * negative, clamped to [0, len]; an end at or before start writes
 * nothing. Writes go through scr_arr_set_*, so each one releases the slot
 * it replaces — which is what makes fill safe over an array of ABSENT
 * slots (the new Array(n) shape) and over one already holding values.
 *
 * The ref form BORROWS `v` and takes its own +1 per slot: the array owns
 * every element it holds, and one incoming reference cannot cover n of
 * them. */
ScrArr *scr_arr_fill_f64(ScrArr *a, double v, double start, double end) {
  double len = (double)a->len;
  double s = start < 0 ? start + len : start;
  double e = end < 0 ? end + len : end;
  if (!(s >= 0)) s = 0; /* NaN and negatives past the start clamp */
  if (s > len) s = len;
  if (!(e >= 0)) e = 0;
  if (e > len) e = len;
  for (double i = s; i < e; i += 1) scr_arr_set_f64(a, i, v);
  return scr_arr_retain(a);
}

ScrArr *scr_arr_fill_bool(ScrArr *a, bool v, double start, double end) {
  double len = (double)a->len;
  double s = start < 0 ? start + len : start;
  double e = end < 0 ? end + len : end;
  if (!(s >= 0)) s = 0;
  if (s > len) s = len;
  if (!(e >= 0)) e = 0;
  if (e > len) e = len;
  for (double i = s; i < e; i += 1) scr_arr_set_bool(a, i, v);
  return scr_arr_retain(a);
}

ScrArr *scr_arr_fill_ref(ScrArr *a, void *v, double start, double end) {
  double len = (double)a->len;
  double s = start < 0 ? start + len : start;
  double e = end < 0 ? end + len : end;
  if (!(s >= 0)) s = 0;
  if (s > len) s = len;
  if (!(e >= 0)) e = 0;
  if (e > len) e = len;
  for (double i = s; i < e; i += 1) scr_arr_set_ref(a, i, scr_elem_retain_p(a, v));
  return scr_arr_retain(a);
}

/* ── length = n, the SHRINK half ──────────────────────────────────────────
 * Drops every element from index n on, releasing refcounted ones (the
 * unlink-then-release discipline scr_arr_set_slot uses: the slot is gone
 * from the array before its count is given up, so a cycle collection
 * triggered by the release can never see a heap edge whose count was
 * already surrendered). n at or past the current length is a no-op --
 * GROWING is the emitter's half, since only it knows the element kind's
 * absent value. Index coercion is ToLength's: a fraction truncates, a
 * negative or NaN empties the array. */
void scr_arr_truncate(ScrArr *a, double n) {
  double want = n;
  if (!(want >= 0)) want = 0; /* NaN and negatives empty it */
  size_t target = want >= (double)a->len ? a->len : (size_t)want;
  while (a->len > target) {
    uint64_t slot = a->data[--a->len];
    if (scr_elem_is_ref(a->elem)) scr_elem_release(a, slot);
  }
}
