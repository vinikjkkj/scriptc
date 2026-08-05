/* Unit tests for the array runtime (scr_array.c). Built with ASan +
 * -DSCR_RC_AUDIT by array.test.ts, which also asserts the trap modes abort:
 *
 *   (no args)          run all assertions; prints "N/N cases passed"
 *   --crash-get-oob    read past the end        → RangeError + abort()
 *   --crash-get-frac   read a fractional index  → RangeError + abort()
 *   --crash-set-oob    write past len (holes)   → RangeError + abort()
 *   --crash-pop-empty  pop an empty array       → RangeError + abort()
 *
 * The RC-recursion cases (array of strings, array of arrays of strings)
 * assert live counts directly: releasing the outer array must release
 * every reachable element exactly once.
 */
#include "../src/scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef SCR_RC_AUDIT
long scr_str_live_count(void); /* provided by scr_string.c */
long scr_arr_live_count(void); /* provided by scr_array.c */
#endif

static long total = 0, failed = 0;

static void check(bool ok, const char *what) {
  total++;
  if (!ok) {
    failed++;
    fprintf(stderr, "FAIL: %s\n", what);
  }
}

static void check_f64(double got, double want, const char *what) {
  check(got == want, what);
  if (got != want) fprintf(stderr, "  got %g want %g\n", got, want);
}

static void test_f64_basics(void) {
  ScrArr *a = scr_arr_new(SCR_ELEM_F64, 0);
  check_f64(scr_arr_len(a), 0, "new array is empty");
  check_f64(scr_arr_push_f64(a, 1.5), 1, "push returns new length");
  check_f64(scr_arr_push_f64(a, -0.0), 2, "push returns new length (2)");
  check_f64(scr_arr_get_f64(a, 0), 1.5, "get_f64[0]");
  check(scr_arr_get_f64(a, 1) == 0 && signbit(scr_arr_get_f64(a, 1)),
        "-0 round-trips through a slot");
  scr_arr_set_f64(a, 0, 7);
  check_f64(scr_arr_get_f64(a, 0), 7, "set_f64 replaces");
  scr_arr_set_f64(a, 2, 9); /* i == len appends */
  check_f64(scr_arr_len(a), 3, "set at len appends");
  check_f64(scr_arr_get_f64(a, 2), 9, "appended value readable");
  check_f64(scr_arr_pop_f64(a), 9, "pop returns last");
  check_f64(scr_arr_len(a), 2, "pop shrinks");
  /* NaN round-trips bit-exactly through the uint64_t slot. */
  scr_arr_push_f64(a, 0.0 / 0.0);
  check(scr_arr_get_f64(a, 2) != scr_arr_get_f64(a, 2), "NaN round-trips");
  /* growth across many appends */
  for (double i = 0; i < 1000; i++) scr_arr_push_f64(a, i);
  check_f64(scr_arr_len(a), 1003, "1000 pushes grow");
  check_f64(scr_arr_get_f64(a, 1002), 999, "last survives growth");
  check_f64(scr_arr_get_f64(a, 0), 7, "first survives growth");
  scr_arr_release(a);
}

static void test_bool(void) {
  ScrArr *a = scr_arr_new(SCR_ELEM_BOOL, 2);
  scr_arr_push_bool(a, true);
  scr_arr_push_bool(a, false);
  check(scr_arr_get_bool(a, 0) == true, "get_bool true");
  check(scr_arr_get_bool(a, 1) == false, "get_bool false");
  scr_arr_set_bool(a, 0, false);
  check(scr_arr_get_bool(a, 0) == false, "set_bool replaces");
  check(scr_arr_pop_bool(a) == false, "pop_bool");
  scr_arr_release(a);
}

static void test_str_rc(void) {
#ifdef SCR_RC_AUDIT
  long strings0 = scr_str_live_count();
  long arrays0 = scr_arr_live_count();
#endif
  ScrArr *a = scr_arr_new(SCR_ELEM_STR, 0);
  scr_arr_push_ref(a, scr_str_new("one", 3)); /* ownership moves in */
  scr_arr_push_ref(a, scr_str_new("two", 3));

  /* get_ref returns +1: the array and the caller each own a reference. */
  ScrStr *s = (ScrStr *)scr_arr_get_ref(a, 0);
  check(s->rc == 2, "get_ref retained");
  check(strcmp(s->data, "one") == 0, "get_ref content");
  scr_str_release(s);

  /* set_ref releases the replaced element and owns the new one. */
  scr_arr_set_ref(a, 0, scr_str_new("uno", 3));
  ScrStr *r = (ScrStr *)scr_arr_get_ref(a, 0);
  check(strcmp(r->data, "uno") == 0, "set_ref replaced content");
  scr_str_release(r);

  /* pop_ref transfers ownership out: rc unchanged, array no longer owns. */
  ScrStr *popped = (ScrStr *)scr_arr_pop_ref(a);
  check(popped->rc == 1, "pop_ref transfers ownership");
  check(strcmp(popped->data, "two") == 0, "pop_ref content");
  scr_str_release(popped);

  /* immortal literals in arrays: retain/release must stay no-ops */
  static struct { size_t rc; size_t len; size_t cap; char data[4]; } lit = {SIZE_MAX, 3, 3, "lit"};
  scr_arr_push_ref(a, (ScrStr *)&lit);
  ScrStr *l = (ScrStr *)scr_arr_get_ref(a, 1);
  check(l->rc == SIZE_MAX, "immortal element stays immortal");

  scr_arr_release(a); /* must release "uno" (and skip the literal) */
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0, "no strings leaked");
  check(scr_arr_live_count() == arrays0, "no arrays leaked");
#endif
}

static void test_nested_rc(void) {
#ifdef SCR_RC_AUDIT
  long strings0 = scr_str_live_count();
  long arrays0 = scr_arr_live_count();
#endif
  /* [[ "a" ], [ "b", "c" ]] — releasing the outer array must cascade. */
  ScrArr *outer = scr_arr_new(SCR_ELEM_ARR, 0);
  ScrArr *row0 = scr_arr_new(SCR_ELEM_STR, 0);
  scr_arr_push_ref(row0, scr_str_new("a", 1));
  scr_arr_push_ref(outer, row0);
  ScrArr *row1 = scr_arr_new(SCR_ELEM_STR, 0);
  scr_arr_push_ref(row1, scr_str_new("b", 1));
  scr_arr_push_ref(row1, scr_str_new("c", 1));
  scr_arr_push_ref(outer, row1);

  ScrArr *row = (ScrArr *)scr_arr_get_ref(outer, 1);
  check(row->rc == 2, "nested get_ref retained");
  check_f64(scr_arr_len(row), 2, "inner length");
  scr_arr_release(row);

  scr_arr_release(outer);
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0, "nested: no strings leaked");
  check(scr_arr_live_count() == arrays0, "nested: no arrays leaked");
#endif
}

static void test_index_of_includes(void) {
  /* f64: indexOf is strict equality (NaN never matches, -0 == 0);
   * includes is SameValueZero (NaN matches NaN). */
  ScrArr *a = scr_arr_new(SCR_ELEM_F64, 0);
  scr_arr_push_f64(a, 1);
  scr_arr_push_f64(a, 0.0 / 0.0);
  scr_arr_push_f64(a, -0.0);
  check_f64(scr_arr_index_of_f64(a, 1), 0, "indexOf f64 hit");
  check_f64(scr_arr_index_of_f64(a, 2), -1, "indexOf f64 miss");
  check_f64(scr_arr_index_of_f64(a, 0.0 / 0.0), -1, "indexOf NaN never matches");
  check(scr_arr_includes_f64(a, 0.0 / 0.0), "includes NaN matches NaN");
  check_f64(scr_arr_index_of_f64(a, 0.0), 2, "indexOf 0 matches -0");
  check(scr_arr_includes_f64(a, 0.0), "includes 0 matches -0");
  check(!scr_arr_includes_f64(a, 5), "includes miss");
  scr_arr_release(a);

  /* bool by value. */
  ScrArr *b = scr_arr_new(SCR_ELEM_BOOL, 0);
  scr_arr_push_bool(b, false);
  scr_arr_push_bool(b, true);
  check_f64(scr_arr_index_of_bool(b, true), 1, "indexOf bool");
  check(scr_arr_includes_bool(b, false), "includes bool");
  scr_arr_release(b);

  /* strings by CONTENT; needle borrowed (rc unchanged, released by us). */
  ScrArr *s = scr_arr_new(SCR_ELEM_STR, 0);
  scr_arr_push_ref(s, scr_str_new("aa", 2));
  scr_arr_push_ref(s, scr_str_new("bb", 2));
  ScrStr *needle = scr_str_new("bb", 2);
  check_f64(scr_arr_index_of_ref(s, needle), 1, "indexOf string by content");
  check(scr_arr_includes_ref(s, needle), "includes string by content");
  check(needle->rc == 1, "indexOf/includes borrow the needle");
  scr_str_release(needle);
  scr_arr_release(s);

  /* nested arrays by reference identity. */
  ScrArr *outer = scr_arr_new(SCR_ELEM_ARR, 0);
  ScrArr *inner = scr_arr_new(SCR_ELEM_F64, 0);
  ScrArr *other = scr_arr_new(SCR_ELEM_F64, 0);
  scr_arr_push_ref(outer, scr_arr_retain(inner));
  check_f64(scr_arr_index_of_ref(outer, inner), 0, "indexOf array by identity");
  check_f64(scr_arr_index_of_ref(outer, other), -1, "structurally-equal array misses");
  scr_arr_release(inner);
  scr_arr_release(other);
  scr_arr_release(outer);
}

/* ── SCR_ELEM_REF: a mock "record" the runtime cannot lay out ─────────
 * Acyclic flavor: 1-word rc header, retain/release via the stored fn ptrs
 * (the compiler's `_v` adapters stand in). Cyclic flavor: allocated with a
 * collector header whose trace visits an owner ARRAY slot — the record can
 * point back at the array holding it, the REF cycle case. */
typedef struct MockRec {
  size_t rc;
  int value;
  ScrArr *owner; /* cyclic flavor only: traced edge back at an array */
} MockRec;

static long mock_live = 0;

static void *mock_retain(void *p) {
  MockRec *r = (MockRec *)p;
  if (r->rc != SIZE_MAX) r->rc++;
  return r;
}

static void mock_release(void *p) {
  MockRec *r = (MockRec *)p;
  if (!r || r->rc == SIZE_MAX) return;
  if (--r->rc == 0) {
    mock_live--;
    free(r);
  }
}

static MockRec *mock_new(int value) {
  MockRec *r = calloc(1, sizeof *r);
  r->rc = 1;
  r->value = value;
  mock_live++;
  return r;
}

static void mock_trace(void *p, ScrTraceVisit visit, void *ctx) {
  MockRec *r = (MockRec *)p;
  if (r->owner) visit(r->owner, ctx);
}

static void mock_gcfree(void *p) {
  /* trace visits owner (headered); nothing else refcounted to release */
  mock_live--;
  scr_cyc_free(p);
}

static void *mock_cyc_retain(void *p) {
  MockRec *r = (MockRec *)p;
  if (r->rc != SIZE_MAX) {
    r->rc++;
    scr_cyc_mark_live(r);
  }
  return r;
}

static void mock_cyc_release(void *p) {
  MockRec *r = (MockRec *)p;
  if (!r || r->rc == SIZE_MAX) return;
  if (--r->rc == 0) {
    scr_cyc_on_dead(r);
    if (r->owner) scr_arr_release(r->owner);
    mock_live--;
    scr_cyc_free(r);
  } else {
    scr_cyc_on_release(r);
  }
}

static MockRec *mock_cyc_new(int value) {
  MockRec *r = scr_cyc_alloc(sizeof *r, &mock_trace, &mock_gcfree);
  r->rc = 1;
  r->value = value;
  mock_live++;
  return r;
}

static void test_ref_elements(void) {
#ifdef SCR_RC_AUDIT
  long arrays0 = scr_arr_live_count();
#endif
  ScrArr *a = scr_arr_new_ref(&mock_retain, &mock_release, NULL, 0);
  scr_arr_push_ref(a, mock_new(1)); /* ownership moves in */
  scr_arr_push_ref(a, mock_new(2));
  check_f64(scr_arr_len(a), 2, "ref push grows");

  /* get_ref retains through the stored fn ptr. */
  MockRec *r = (MockRec *)scr_arr_get_ref(a, 0);
  check(r->rc == 2, "ref get_ref retained via elem_retain");
  check(r->value == 1, "ref get_ref content");
  mock_release(r);

  /* set_ref releases the replaced element through elem_release. */
  scr_arr_set_ref(a, 0, mock_new(10));
  check(mock_live == 2, "ref set_ref released the old element");
  MockRec *rr = (MockRec *)scr_arr_get_ref(a, 0);
  check(rr->value == 10, "ref set_ref replaced content");
  mock_release(rr);

  /* indexOf/includes: POINTER identity, needle borrowed. */
  MockRec *second = (MockRec *)scr_arr_get_ref(a, 1);
  check_f64(scr_arr_index_of_ref(a, second), 1, "ref indexOf by identity");
  check(scr_arr_includes_ref(a, second), "ref includes by identity");
  MockRec *stranger = mock_new(2);
  check_f64(scr_arr_index_of_ref(a, stranger), -1, "ref equal-value stranger misses");
  check(second->rc == 2, "ref indexOf borrows the needle");
  mock_release(stranger);

  /* pop_ref transfers ownership out. */
  MockRec *popped = (MockRec *)scr_arr_pop_ref(a);
  check(popped == second, "ref pop_ref returns the element");
  check(popped->rc == 2, "ref pop_ref transfers (our get_ref + the pop)");
  mock_release(popped);
  mock_release(second);

  scr_arr_release(a); /* releases the remaining element */
  check(mock_live == 0, "ref elements all released");
#ifdef SCR_RC_AUDIT
  check(scr_arr_live_count() == arrays0, "ref: no arrays leaked");
#endif
}

static void test_ref_cycle(void) {
#ifdef SCR_RC_AUDIT
  long arrays0 = scr_arr_live_count();
#endif
  /* arr -> rec -> arr: drop the external references, then collect. */
  ScrArr *arr = scr_arr_new_ref(&mock_cyc_retain, &mock_cyc_release, &mock_trace, 0);
  MockRec *rec = mock_cyc_new(7);
  rec->owner = (ScrArr *)scr_arr_retain(arr); /* rec points back at arr */
  scr_arr_push_ref(arr, rec);                 /* arr owns rec */
  check(mock_live == 1, "cycle: element alive");
  scr_arr_release(arr); /* external edge gone; the cycle keeps both alive */
  scr_collect_cycles();
  check(mock_live == 0, "cycle collected through the array element");
#ifdef SCR_RC_AUDIT
  check(scr_arr_live_count() == arrays0, "cycle: no arrays leaked");
#endif
}

static void test_join(void) {
#ifdef SCR_RC_AUDIT
  long strings0 = scr_str_live_count();
#endif
  ScrStr *sep = scr_str_new(",", 1);

  ScrArr *n = scr_arr_new(SCR_ELEM_F64, 0);
  ScrStr *empty = scr_arr_join(n, sep);
  check(empty->len == 0, "join of empty array is \"\"");
  scr_str_release(empty);
  scr_arr_push_f64(n, 1.5);
  scr_arr_push_f64(n, -0.0);
  scr_arr_push_f64(n, 0.0 / 0.0);
  ScrStr *nums = scr_arr_join(n, sep);
  check(strcmp(nums->data, "1.5,0,NaN") == 0, "join f64 (JS formatting, -0 -> \"0\")");
  scr_str_release(nums);
  scr_arr_release(n);

  ScrArr *b = scr_arr_new(SCR_ELEM_BOOL, 0);
  scr_arr_push_bool(b, true);
  scr_arr_push_bool(b, false);
  ScrStr *bools = scr_arr_join(b, sep);
  check(strcmp(bools->data, "true,false") == 0, "join bool");
  scr_str_release(bools);
  scr_arr_release(b);

  ScrArr *s = scr_arr_new(SCR_ELEM_STR, 0);
  scr_arr_push_ref(s, scr_str_new("a", 1));
  scr_arr_push_ref(s, scr_str_new("", 0));
  scr_arr_push_ref(s, scr_str_new("c", 1));
  ScrStr *sep0 = scr_str_new("", 0);
  ScrStr *sepless = scr_arr_join(s, sep0); /* join borrows the separator */
  check(strcmp(sepless->data, "ac") == 0, "join with empty separator");
  scr_str_release(sepless);
  scr_str_release(sep0);
  ScrStr *sep2 = scr_str_new("--", 2);
  ScrStr *strs = scr_arr_join(s, sep2);
  check(strcmp(strs->data, "a----c") == 0, "join strings verbatim, empty kept");
  scr_str_release(strs);
  scr_str_release(sep2);
  scr_arr_release(s);

  scr_str_release(sep);
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0, "join: no strings leaked");
#endif
}

/* ── unshift / reverse / copyWithin ───────────────────────────────────
 * The three IN-PLACE mutators. unshift mirrors push (ownership moves IN,
 * new length back); reverse only permutes slots (no count moves) and
 * answers the receiver +1; copyWithin overwrites a run with a copy of
 * another run of the SAME array, which is where the reference counting
 * matters: source and destination overlap in the ring-buffer compaction
 * shape, so every copied value must gain a reference before any
 * overwritten slot gives one up.
 *
 * Live counts are asserted directly (SCR_RC_AUDIT), so a leak or a double
 * release fails here rather than silently. */
static void check_str_at(ScrArr *a, double i, const char *want, const char *what) {
  ScrStr *s = (ScrStr *)scr_arr_get_ref(a, i); /* +1, released below */
  check(strcmp(s->data, want) == 0, what);
  if (strcmp(s->data, want) != 0) fprintf(stderr, "  got %s want %s\n", s->data, want);
  scr_str_release(s);
}

static void test_in_place_mutators(void) {
#ifdef SCR_RC_AUDIT
  long strings0 = scr_str_live_count();
  long arrays0 = scr_arr_live_count();
#endif
  /* unshift: the scalar path, and growth. */
  ScrArr *a = scr_arr_new(SCR_ELEM_F64, 0);
  check_f64(scr_arr_unshift_f64(a, 3), 1, "unshift onto empty returns 1");
  check_f64(scr_arr_unshift_f64(a, 2), 2, "unshift returns new length");
  check_f64(scr_arr_unshift_f64(a, 1), 3, "unshift returns new length (3)");
  check_f64(scr_arr_get_f64(a, 0), 1, "unshift puts the newest first");
  check_f64(scr_arr_get_f64(a, 2), 3, "unshift slides the tail up");
  for (double i = 0; i < 500; i++) scr_arr_unshift_f64(a, i);
  check_f64(scr_arr_len(a), 503, "500 unshifts grow");
  check_f64(scr_arr_get_f64(a, 0), 499, "last unshift is at 0 after growth");
  check_f64(scr_arr_get_f64(a, 502), 3, "original tail survives growth");

  ScrArr *ab = scr_arr_new(SCR_ELEM_BOOL, 0);
  check_f64(scr_arr_unshift_bool(ab, true), 1, "unshift_bool returns length");
  scr_arr_unshift_bool(ab, false);
  check(!scr_arr_get_bool(ab, 0) && scr_arr_get_bool(ab, 1), "unshift_bool order");
  scr_arr_release(ab);

  /* reverse: in place, receiver back (+1 — the caller owns it). */
  ScrArr *r = scr_arr_new(SCR_ELEM_F64, 0);
  ScrArr *rr = scr_arr_reverse(r);
  check(rr == r, "reverse of an empty array answers the receiver");
  check_f64(scr_arr_len(r), 0, "reverse of empty stays empty");
  scr_arr_release(rr);
  scr_arr_push_f64(r, 1);
  scr_arr_release(scr_arr_reverse(r));
  check_f64(scr_arr_get_f64(r, 0), 1, "reverse of one element");
  scr_arr_push_f64(r, 2);
  scr_arr_push_f64(r, 3);
  scr_arr_push_f64(r, 4);
  ScrArr *back = scr_arr_reverse(r);
  check(back == r, "reverse answers the receiver, not a copy");
  check(r->rc == 2, "reverse returns +1");
  scr_arr_release(back);
  check_f64(scr_arr_get_f64(r, 0), 4, "reverse: 4 first");
  check_f64(scr_arr_get_f64(r, 3), 1, "reverse: 1 last");
  scr_arr_push_f64(r, 0);
  scr_arr_release(scr_arr_reverse(r)); /* odd length: the middle stays put */
  check_f64(scr_arr_get_f64(r, 2), 2, "odd-length reverse keeps the middle in place");
  check_f64(scr_arr_get_f64(r, 0), 0, "odd-length reverse: first is the old last");
  check_f64(scr_arr_get_f64(r, 4), 4, "odd-length reverse: last is the old first");
  scr_arr_release(r);

  /* copyWithin: the receiver comes back and the length never moves. */
  ScrArr *c = scr_arr_new(SCR_ELEM_F64, 0);
  for (double i = 0; i < 5; i++) scr_arr_push_f64(c, i);
  ScrArr *cw = scr_arr_copy_within(c, 0, 3, INFINITY);
  check(cw == c, "copyWithin answers the receiver");
  check(c->rc == 2, "copyWithin returns +1");
  scr_arr_release(cw);
  check_f64(scr_arr_len(c), 5, "copyWithin never changes the length");
  check_f64(scr_arr_get_f64(c, 0), 3, "copyWithin(0,3): 3 lands at 0");
  check_f64(scr_arr_get_f64(c, 1), 4, "copyWithin(0,3): 4 lands at 1");
  check_f64(scr_arr_get_f64(c, 2), 2, "copyWithin(0,3): the tail is untouched");
  scr_arr_release(c);

  /* The index ladder: negatives resolve from the end, everything clamps,
   * and the count is min(end - start, len - target). An omitted `end`
   * arrives as +Infinity (the frontend's completion). */
  static const struct {
    double target, start, end;
    const char *want;
    const char *what;
  } ix[] = {
      {2, 0, 4, "01012367", "copyWithin(2,0,4)"},
      {0, 3, 6, "34534567", "copyWithin(0,3,6)"},
      {-2, 0, INFINITY, "01234501", "copyWithin(-2,0)"},
      {0, -2, INFINITY, "67234567", "copyWithin(0,-2)"},
      {0, 1, -1, "12345667", "copyWithin(0,1,-1)"},
      {10, 0, INFINITY, "01234567", "copyWithin(10,0) is a no-op"},
      {0, 4, 2, "01234567", "copyWithin(0,4,2) is a no-op"},
      {0, 10, INFINITY, "01234567", "copyWithin(0,10) is a no-op"},
      {-100, 1, INFINITY, "12345677", "copyWithin(-100,1) clamps the target to 0"},
      {3, 0, 100, "01201234", "copyWithin(3,0,100) clamps the end"},
      {1.7, 0.9, INFINITY, "00123456", "copyWithin truncates its indices"},
      {0, 0, INFINITY, "01234567", "copyWithin(0,0) is the identity"},
  };
  for (size_t k = 0; k < sizeof ix / sizeof ix[0]; k++) {
    ScrArr *t = scr_arr_new(SCR_ELEM_F64, 0);
    for (double i = 0; i < 8; i++) scr_arr_push_f64(t, i);
    scr_arr_release(scr_arr_copy_within(t, ix[k].target, ix[k].start, ix[k].end));
    char got[16];
    for (size_t i = 0; i < 8; i++) got[i] = (char)('0' + (int)scr_arr_get_f64(t, (double)i));
    got[8] = '\0';
    check(strcmp(got, ix[k].want) == 0, ix[k].what);
    if (strcmp(got, ix[k].want) != 0) fprintf(stderr, "  got %s want %s\n", got, ix[k].want);
    scr_arr_release(t);
  }

  /* REFERENCE elements — where the counting lives. unshift_ref takes
   * ownership like push_ref; copyWithin retains the copied run and
   * releases the overwritten one, with the runs overlapping BOTH ways. */
  ScrArr *s = scr_arr_new(SCR_ELEM_STR, 0);
  scr_arr_unshift_ref(s, scr_str_new("dd", 2));
  scr_arr_unshift_ref(s, scr_str_new("cc", 2));
  scr_arr_unshift_ref(s, scr_str_new("bb", 2));
  scr_arr_unshift_ref(s, scr_str_new("aa", 2));
  check_str_at(s, 0, "aa", "unshift_ref puts the newest first");
  check_str_at(s, 3, "dd", "unshift_ref keeps the oldest last");
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0 + 4, "four strings live before copyWithin");
#endif
  /* forward overlap: destination BELOW the source (the compaction shape) */
  scr_arr_release(scr_arr_copy_within(s, 0, 2, INFINITY));
  check_str_at(s, 0, "cc", "forward overlap [0]");
  check_str_at(s, 1, "dd", "forward overlap [1]");
  check_str_at(s, 2, "cc", "forward overlap leaves the source [2]");
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0 + 2, "aa and bb released, cc and dd shared");
#endif
  /* backward overlap: destination ABOVE the source */
  scr_arr_release(scr_arr_copy_within(s, 2, 0, 2));
  check_str_at(s, 3, "dd", "backward overlap [3]");
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0 + 2, "backward overlap balances");
#endif
  /* a full self-copy must keep every element alive */
  scr_arr_release(scr_arr_copy_within(s, 0, 0, INFINITY));
  check_str_at(s, 0, "cc", "self-copy is the identity");
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0 + 2, "self-copy balances");
#endif
  scr_arr_release(s);
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == strings0, "copyWithin over strings leaks nothing");
#endif

  /* Nested arrays (SCR_ELEM_ARR): the same story, one refcount kind over. */
  ScrArr *outer = scr_arr_new(SCR_ELEM_ARR, 0);
  for (int i = 0; i < 4; i++) {
    ScrArr *in = scr_arr_new(SCR_ELEM_F64, 0);
    scr_arr_push_f64(in, i);
    scr_arr_unshift_ref(outer, in); /* ownership moves in */
  }
  scr_arr_release(scr_arr_reverse(outer));
  scr_arr_release(scr_arr_copy_within(outer, 0, 2, INFINITY));
  check_f64(scr_arr_len(outer), 4, "nested copyWithin keeps the length");
  ScrArr *first = (ScrArr *)scr_arr_get_ref(outer, 0); /* +1 */
  check_f64(scr_arr_get_f64(first, 0), 2, "nested copyWithin copies the right inner array");
  scr_arr_release(first);
  scr_arr_release(outer);
#ifdef SCR_RC_AUDIT
  check(scr_arr_live_count() == arrays0 + 1, "nested copyWithin releases every inner array");
#endif

  scr_arr_release(a);
#ifdef SCR_RC_AUDIT
  check(scr_arr_live_count() == arrays0, "in-place mutators leak no arrays");
  check(scr_str_live_count() == strings0, "in-place mutators leak no strings");
#endif
}

int main(int argc, char **argv) {
  if (argc > 1) {
    ScrArr *a = scr_arr_new(SCR_ELEM_F64, 0);
    scr_arr_push_f64(a, 1);
    if (strcmp(argv[1], "--crash-get-oob") == 0) {
      scr_arr_get_f64(a, 1); /* len is 1 */
    } else if (strcmp(argv[1], "--crash-get-frac") == 0) {
      scr_arr_get_f64(a, 0.5);
    } else if (strcmp(argv[1], "--crash-set-oob") == 0) {
      scr_arr_set_f64(a, 2, 9); /* would create a hole */
    } else if (strcmp(argv[1], "--crash-pop-empty") == 0) {
      scr_arr_pop_f64(a);
      scr_arr_pop_f64(a); /* now empty */
    } else {
      fprintf(stderr, "unknown mode %s\n", argv[1]);
      return 2;
    }
    fprintf(stderr, "expected a trap, still alive\n");
    return 2;
  }

  test_f64_basics();
  test_bool();
  test_str_rc();
  test_nested_rc();
  test_index_of_includes();
  test_ref_elements();
  test_ref_cycle();
  test_join();
  test_in_place_mutators();

  fprintf(stderr, "%ld/%ld cases passed\n", total - failed, total);
  return failed == 0 ? 0 : 1;
}
