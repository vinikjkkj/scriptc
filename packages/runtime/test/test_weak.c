/* Unit tests for the WeakMap runtime (scr_weak.c). Built with ASan +
 * -DSCR_RC_AUDIT by weak.test.ts. Prints "N/N cases passed" to stderr.
 *
 * These are the properties the differential corpus CANNOT reach, because
 * they are precisely the ones JS cannot observe from inside the language:
 *
 *  - the table does not retain its key (a strong Map would, and that is
 *    the whole defect this replaces);
 *  - an entry disappears at the instant the key's refcount hits zero,
 *    not at some later sweep;
 *  - ADDRESS REUSE after a key dies does not resurrect the dead key's
 *    value. This is the case that makes the design sound rather than
 *    merely tidy: keys are compared by address, and the allocator hands
 *    the same address out again, so a table that evicted lazily would
 *    answer a NEW object with the PREVIOUS occupant's value;
 *  - a key in several maps is spliced from all of them;
 *  - values are held strongly and released exactly once;
 *  - and, since phase 3, that a key reclaimed by the COLLECTOR is spliced
 *    too. That one is not merely unobservable from in-language, it is
 *    unreachable: nothing a compiled program can write makes a cycle
 *    collection happen at a point it can then look at. Cases 10-12 build
 *    the ring in C and call scr_collect_cycles by hand.
 */
#include "../src/scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef SCR_RC_AUDIT
long scr_str_live_count(void);   /* scr_string.c */
#endif

static long total = 0, failed = 0;

static void check(bool ok, const char *what) {
  total++;
  if (!ok) {
    failed++;
    fprintf(stderr, "FAIL: %s\n", what);
  }
}

static ScrStr *S(const char *s) { return scr_str_new(s, strlen(s)); }

/* A fresh 32-byte Uint8Array — the shape of every key in the caches this
 * was built for (a Curve25519 private key). */
static ScrBytes *K(unsigned char tag) {
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, 32);
  memset(b->data, tag, 32);
  return b;
}

static ScrWeakMap *W(void) {
  return scr_weak_new(&scr_str_retain_v, &scr_str_release_v, &scr_bytes_weak_mark);
}

/* An UNTRACED array: trace NULL means scr_arr_new_ref uses a plain malloc
 * and scr_arr_release a plain free, which is exactly the property that
 * makes it an admissible weak key. */
static ScrArr *A(const char *tag) {
  ScrArr *a = scr_arr_new_ref(&scr_str_retain_v, &scr_str_release_v, NULL, 0);
  ScrStr *e = S(tag);
  scr_arr_push_ref(a, e);
  scr_str_release(e);
  return a;
}

static ScrWeakMap *WA(void) {
  return scr_weak_new(&scr_str_retain_v, &scr_str_release_v, &scr_arr_weak_mark);
}

/* ── 8. UNTRACED ARRAY keys (phase 2) ────────────────────────────────── */
static void test_array_keys(void) {
  ScrWeakMap *m = WA();
  ScrArr *k1 = A("alpha");
  ScrArr *k2 = A("alpha"); /* equal CONTENTS, a different key */
  ScrStr *v = S("arr-value");
  size_t rc_before;

  check(k1->elem_trace == NULL, "the array under test is UNTRACED");
  rc_before = k1->rc;
  scr_weak_set(m, k1, v);
  check(k1->rc == rc_before, "set() does not retain an array key either");
  check(k1->weakkey == 1, "the ARRAY stamp is the one that got written");

  ScrStr *got = (ScrStr *)scr_weak_get_ref(m, k1);
  check(got == v, "array-keyed hit returns the stored value");
  if (got) scr_str_release(got);
  check(!scr_weak_has(m, k2), "an equal-CONTENTS array is a different key");

  scr_str_release(v);
#ifdef SCR_RC_AUDIT
  long live_before = scr_str_live_count();
#endif
  scr_arr_release(k1); /* THE DEATH, through the untraced free path */
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == live_before - 1,
        "the value is released when an ARRAY key dies");
#endif
  scr_arr_release(k2);
  scr_weak_release(m);
}

/* ── 9. address reuse, array flavour ─────────────────────────────────── */
static void test_array_address_reuse(void) {
  ScrWeakMap *m = WA();
  ScrStr *v = S("stale-arr");
  ScrArr *k = A("gone");
  void *dead = (void *)k;
  int reused = 0, tries = 0;

  scr_weak_set(m, k, v);
  scr_str_release(v);
  scr_arr_release(k);

  for (; tries < 64 && !reused; tries++) {
    ScrArr *fresh = A("new");
    if ((void *)fresh == dead) {
      reused = 1;
      check(scr_weak_get_ref(m, fresh) == NULL,
            "a recycled ARRAY address does not inherit the dead key value");
      check(!scr_weak_has(m, fresh),
            "has() false for an array reusing a dead address");
    }
    scr_arr_release(fresh);
  }
  if (!reused) {
    fprintf(stderr, "NOTE: array address never recycled in %d tries — reuse case not exercised\n", tries);
  } else {
    check(1, "array address reuse was actually exercised");
  }
  scr_weak_release(m);
}

/* A TRACED array: a non-NULL elem_trace is what routes scr_arr_new_ref
 * through scr_cyc_alloc, so this array carries a CYCLE HEADER and can be
 * reclaimed by the collector without scr_arr_release ever running. Its
 * elements are arrays, which is also what lets the cycle cases below build
 * a ring out of two of them. */
static ScrArr *TA(void) {
  return scr_arr_new_ref(&scr_arr_retain_v, &scr_arr_release_v, &scr_arr_trace_v, 0);
}

static ScrWeakMap *WC(void) {
  return scr_weak_new(&scr_str_retain_v, &scr_str_release_v, &scr_cyc_weak_mark);
}

/* ── 10. TRACED array keys (phase 3): the stamp lands in the HEADER ── */
static void test_cycle_keys(void) {
  ScrWeakMap *m = WC();
  ScrArr *k1 = TA();
  ScrArr *k2 = TA();
  ScrStr *v = S("cyc-value");
  size_t rc_before;

  check(k1->elem_trace != NULL, "the array under test is TRACED");
  rc_before = k1->rc;
  scr_weak_set(m, k1, v);
  check(k1->rc == rc_before, "set() does not retain a cycle-headered key");
  /* Trap 3, from the outside: a shared stamp would have written ScrArr's
   * own byte. The cycle stamp must write the HEADER and leave that alone,
   * or scr_arr_release would fire the hook a second time. */
  check(k1->weakkey == 0, "the cycle stamp did NOT write ScrArr::weakkey");
  check((scr_cyc_hdr(k1)->blk & SCR_CYC_WEAKKEY) != 0,
        "the cycle stamp DID write SCR_CYC_WEAKKEY in the header");

  ScrStr *got = (ScrStr *)scr_weak_get_ref(m, k1);
  check(got == v, "cycle-keyed hit returns the stored value");
  if (got) scr_str_release(got);
  check(!scr_weak_has(m, k2), "another empty traced array is a different key");

  scr_str_release(v);
#ifdef SCR_RC_AUDIT
  long live_before = scr_str_live_count();
#endif
  scr_arr_release(k1); /* death by ordinary release-to-zero */
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == live_before - 1,
        "the value is released when a TRACED key dies through its release");
#endif
  scr_arr_release(k2);
  scr_weak_release(m);
}

/* ── 11. THE CASE THE COLLECTOR HOOK EXISTS FOR ──
 * A key held only by a CYCLE. Nothing releases it to zero: its refcount
 * never reaches 0 on its own, and scr_collect_cycles reclaims it by
 * calling the per-type teardown DIRECTLY (scr_cyc_free_of(hdr)(obj)),
 * which no release-side hook can see. Before scr_cyc_free was hooked, the
 * entry survived its key here -- and since the arena hands the address
 * out again, a later object at that address would have read this value.
 * That is the wrong answer this whole design exists to prevent, so this is
 * the case that decides whether phase 3 is real. */
static void test_cycle_collector_death(void) {
  ScrWeakMap *m = WC();
  ScrStr *v = S("collected");
  ScrArr *a, *b;
  void *dead;

  /* Drain the candidate-root buffer FIRST. The collector paces itself off
   * how many candidates have accumulated, so without this an unrelated
   * earlier case can push the count over the threshold and run a pass
   * inside one of the releases below — which would still splice the entry
   * correctly, but would rob the "a cycle keeps the key alive" check of
   * its meaning. That check is what separates this case from case 10: it
   * proves the key does NOT die by refcount, so the eviction that follows
   * can only have come from the collector. */
  scr_collect_cycles();
  a = TA();
  b = TA();

  /* a -> b -> a, then drop both external references. Each is now held
   * only by the other, so refcounting alone frees neither.
   *
   * The retains are load-bearing: scr_arr_push_ref MOVES ownership in (the
   * emitter's moveTemp gives up the caller's reference), so pushing the
   * bare pointers would build a CHAIN, not a ring — releasing b would free
   * b, whose teardown would release a to zero, and the entry would be
   * spliced by the ordinary release path with the collector never
   * involved. That is a case-10 pass wearing case 11's name. */
  scr_arr_push_ref(a, scr_arr_retain(b));
  scr_arr_push_ref(b, scr_arr_retain(a));
  scr_weak_set(m, a, v);
  check(scr_weak_has(m, a), "the key is in the table before collection");
  dead = (void *)a;
  scr_str_release(v);
  scr_arr_release(b);
  scr_arr_release(a);
  check(scr_weak_has(m, dead), "still there: a cycle keeps the key alive");

  scr_collect_cycles();

  check(!scr_weak_has(m, dead),
        "the collector's free spliced the entry (THE phase-3 property)");
  check(scr_weak_get_ref(m, dead) == NULL,
        "and get() on the collected key's address answers NULL");
  scr_weak_release(m);
}

/* ── 12. address reuse, cycle flavour ──
 * The arena recycles far more aggressively than malloc does, so this is
 * the flavour of the reuse test most likely to actually fire. It REPORTS
 * when the allocator declined to recycle rather than passing quietly -- a
 * reuse case that never reused has tested nothing. */
static void test_cycle_address_reuse(void) {
  ScrWeakMap *m = WC();
  ScrStr *v = S("stale-cyc");
  ScrArr *k = TA();
  void *dead = (void *)k;
  int reused = 0, tries = 0;

  scr_weak_set(m, k, v);
  scr_str_release(v);
  scr_arr_release(k);

  for (; tries < 64 && !reused; tries++) {
    ScrArr *fresh = TA();
    if ((void *)fresh == dead) {
      reused = 1;
      check(scr_weak_get_ref(m, fresh) == NULL,
            "a recycled CYCLE-BLOCK address does not inherit the dead value");
      check(!scr_weak_has(m, fresh),
            "has() false for a cycle block reusing a dead address");
      /* The recycled block must also come back with a CLEAR stamp, or the
       * next object at this address walks the registry on its own free
       * for no reason. scr_cyc_stamp rewriting blk is what buys this. */
      check((scr_cyc_hdr(fresh)->blk & SCR_CYC_WEAKKEY) == 0,
            "a recycled block does not inherit the previous key's stamp");
    }
    scr_arr_release(fresh);
  }
  if (!reused) {
    fprintf(stderr, "NOTE: cycle block address never recycled in %d tries "
                    "- reuse case not exercised\n", tries);
  } else {
    check(1, "cycle-block address reuse was actually exercised");
  }
  scr_weak_release(m);
}

/* ── 1. get/set/has, and identity rather than value ──────────────────── */
static void test_basic_identity(void) {
  ScrWeakMap *m = W();
  ScrBytes *k1 = K(0xAA);
  ScrBytes *k2 = K(0xAA); /* BYTE-IDENTICAL to k1, and a different key */
  ScrStr *v = S("one");

  check(scr_weak_get_ref(m, k1) == NULL, "miss on an empty table");
  check(!scr_weak_has(m, k1), "has() false on an empty table");

  scr_weak_set(m, k1, v);
  ScrStr *got = (ScrStr *)scr_weak_get_ref(m, k1);
  check(got != NULL, "hit after set");
  check(got == v, "the stored value comes back");
  scr_str_release(got); /* the _ref accessor returns +1 */

  check(scr_weak_has(m, k1), "has() true for a stored key");
  /* THE identity property: two byte-identical Uint8Arrays are two keys. */
  check(scr_weak_get_ref(m, k2) == NULL, "a byte-identical array is a DIFFERENT key");
  check(!scr_weak_has(m, k2), "has() false for a byte-identical other key");

  scr_str_release(v);
  scr_bytes_release(k1);
  scr_bytes_release(k2);
  scr_weak_release(m);
}

/* ── 2. the table does not retain the key ────────────────────────────── */
static void test_key_not_retained(void) {
  ScrWeakMap *m = W();
  ScrBytes *k = K(0xBB);
  ScrStr *v = S("two");
  size_t before = k->rc;
  scr_weak_set(m, k, v);
  check(k->rc == before, "set() does NOT retain the key (a strong Map would)");
  check(k->weakkey == 1, "set() marks the key so its free path checks the table");
  scr_str_release(v);
  scr_bytes_release(k);
  scr_weak_release(m);
}

/* ── 3. the entry dies with the key, and the value is released ───────── */
static void test_entry_dies_with_key(void) {
  ScrWeakMap *m = W();
  ScrBytes *k = K(0xCC);
  ScrStr *v = S("three");
  scr_weak_set(m, k, v);
  scr_str_release(v); /* the table now holds the only reference */

#ifdef SCR_RC_AUDIT
  long live_before = scr_str_live_count();
#endif
  check(scr_weak_has(m, k), "entry present while the key lives");
  scr_bytes_release(k); /* THE DEATH */
#ifdef SCR_RC_AUDIT
  check(scr_str_live_count() == live_before - 1,
        "the value is released when the key dies");
#endif
  scr_weak_release(m);
}

/* ── 4. ADDRESS REUSE — the case the whole design exists for ─────────── */
static void test_address_reuse(void) {
  ScrWeakMap *m = W();
  ScrStr *v = S("stale");
  ScrBytes *k = K(0xDD);
  void *dead = (void *)k;
  int reused = 0, tries = 0;

  scr_weak_set(m, k, v);
  scr_str_release(v);
  scr_bytes_release(k); /* k is now freed; its ADDRESS is up for grabs */

  /* Ask the allocator for the same shape until it hands the address back.
   * On every allocator measured this happens on the first try; the loop is
   * so a miss is inconclusive rather than a hang. */
  for (; tries < 64 && !reused; tries++) {
    ScrBytes *fresh = K(0xEE);
    if ((void *)fresh == dead) {
      reused = 1;
      /* THE ASSERTION. A lazily-swept table would answer this NEW object
       * with the DEAD key's value — a wrong answer, not a leak. */
      check(scr_weak_get_ref(m, fresh) == NULL,
            "a recycled address does NOT inherit the dead key's value");
      check(!scr_weak_has(m, fresh),
            "has() is false for an object that merely reuses a dead address");
    }
    scr_bytes_release(fresh);
  }
  /* Report rather than silently pass: a run that never recycled has not
   * tested anything, and a green tick there would be a lie. */
  if (!reused) {
    fprintf(stderr, "NOTE: address never recycled in %d tries — reuse case not exercised\n", tries);
  } else {
    check(1, "address reuse was actually exercised");
  }
  scr_weak_release(m);
}

/* ── 5. one key, several maps ────────────────────────────────────────── */
static void test_multi_map_splice(void) {
  ScrWeakMap *a = W();
  ScrWeakMap *b = W();
  ScrBytes *k = K(0x11);
  ScrStr *va = S("in-a");
  ScrStr *vb = S("in-b");
  scr_weak_set(a, k, va);
  scr_weak_set(b, k, vb);
  scr_str_release(va);
  scr_str_release(vb);
  check(scr_weak_has(a, k) && scr_weak_has(b, k), "the key is in both tables");
  scr_bytes_release(k);
  check(!scr_weak_has(a, k) && !scr_weak_has(b, k),
        "one death splices the key out of EVERY table holding it");
  scr_weak_release(a);
  scr_weak_release(b);
}

/* ── 6. overwrite, and teardown with live entries ────────────────────── */
static void test_overwrite_and_teardown(void) {
  ScrWeakMap *m = W();
  ScrBytes *k = K(0x22);
  ScrStr *v1 = S("first");
  ScrStr *v2 = S("second");
  scr_weak_set(m, k, v1);
  scr_weak_set(m, k, v2); /* replaces, releasing v1's table reference */
  ScrStr *got = (ScrStr *)scr_weak_get_ref(m, k);
  check(got == v2, "overwrite replaces the value");
  scr_str_release(got);
  scr_str_release(v1);
  scr_str_release(v2);
#ifdef SCR_RC_AUDIT
  long live = scr_str_live_count();
  check(live >= 1, "the table still holds the surviving value");
#endif
  /* Teardown WITH a live entry: the value must be released exactly once,
   * and the key (which the table never owned) must not be touched. */
  scr_weak_release(m);
  check(k->rc == 1, "teardown does not touch a key the table never owned");
  scr_bytes_release(k);
}

/* ── 7. growth and probing past tombstones ───────────────────────────── */
static void test_growth(void) {
  enum { N = 500 };
  ScrWeakMap *m = W();
  ScrBytes *keys[N];
  ScrStr *v = S("bulk");
  int i, hits = 0;
  for (i = 0; i < N; i++) {
    keys[i] = K((unsigned char)(i & 0xff));
    scr_weak_set(m, keys[i], v);
  }
  for (i = 0; i < N; i++) if (scr_weak_has(m, keys[i])) hits++;
  check(hits == N, "every key survives growth and rehashing");
  /* Kill half, then re-probe: the survivors must still be findable past
   * the tombstones the deaths left. */
  for (i = 0; i < N; i += 2) scr_bytes_release(keys[i]);
  hits = 0;
  for (i = 1; i < N; i += 2) if (scr_weak_has(m, keys[i])) hits++;
  check(hits == N / 2, "survivors are still found past tombstones");
  for (i = 1; i < N; i += 2) scr_bytes_release(keys[i]);
  scr_str_release(v);
  scr_weak_release(m);
}

/* ── the DYN key cases ────────────────────────────────────────────────
 *
 * `WeakMap<object, V>` is the one key type whose address and whose stamp
 * are both chosen at RUN time, so it is the one whose "picked the wrong
 * field" failure mode no static reasoning rules out. Everything below is
 * therefore a check on WHICH ADDRESS the table ended up keyed on, asked
 * from outside through the public entry points.
 *
 * A dyn-keyed map takes a NULL key_mark: the stamp is per-VALUE here, and
 * scr_weak_dyn_set applies it after the insert. */
static ScrWeakMap *WD(void) {
  return scr_weak_new(&scr_str_retain_v, &scr_str_release_v, NULL);
}

/* ── 13. the key is the PAYLOAD, not the box ──
 * The property that decides whether a dyn-keyed table is a cache or a
 * useless one. A ScrBytes crossing into dyn is SHARED, not copied, so two
 * boxes of one buffer are two boundary artifacts over one JS value —
 * scr_dyn_strict_eq answers ===-equal for them, and this table must agree.
 * Keyed on the box, every single line below would miss. */
static void test_dyn_bytes_payload(void) {
  ScrWeakMap *m = WD();
  ScrBytes *k = K(0xD1);
  ScrStr *v = S("payload");
  ScrDyn *box1 = scr_dyn_new_bytes_ref(k); /* retains k */
  ScrDyn *box2 = scr_dyn_new_bytes_ref(k); /* a SECOND box of the SAME k */
  check(box1 != box2, "the two boxes really are different nodes");

  scr_weak_dyn_set(m, box1, v);
  check(scr_weak_dyn_has(m, box2), "a second box of one payload finds the entry");
  ScrStr *got = (ScrStr *)scr_weak_dyn_get_ref(m, box2);
  check(got == v, "and reads the same value back");
  scr_str_release(got);

  /* The entry is keyed on the ScrBytes, so it must survive both boxes and
   * die with the buffer. Dropping a box drops only a reference to k. */
  scr_dyn_release(box1);
  scr_dyn_release(box2);
  check(scr_weak_has(m, k), "the entry outlives every box of its payload");
  check(k->rc == 1, "and the table never retained the payload either");

  ScrBytes *dead = k;
  scr_bytes_release(k);
  check(!scr_weak_has(m, dead), "the entry dies with the PAYLOAD, at its own release");

  scr_str_release(v);
  scr_weak_release(m);
}

/* ── 14. the boundary copy keys on its ORIGIN ──
 * A static array crossing into dyn cannot alias (a packed ScrArr against a
 * ScrDyn vector is different memory), so the converter copies — and every
 * crossing makes a NEW copy. Keyed on the copy this is a cache that can
 * never hit: `set` and `get` in adjacent statements are two boxes.
 *
 * scr_dyn_origin_mark is what makes it work: the copy records the object it
 * was made from, and the table keys on THAT. This case is the whole reason
 * zapo-js's `prevSessionsSuffixCache` compiles, and it is the one that
 * fails loudly if anyone "simplifies" the resolution to use the box. */
static void test_dyn_array_origin(void) {
  ScrWeakMap *m = WD();
  ScrArr *a = A("origin-elem"); /* untraced: its stamp must be ScrArr::weakkey */
  ScrStr *v = S("origin");
  ScrDyn *c1 = scr_dyn_origin_mark(scr_dyn_new_arr(), a, "array<f64>",
                                   &scr_arr_retain_v, &scr_arr_release_v);
  ScrDyn *c2 = scr_dyn_origin_mark(scr_dyn_new_arr(), a, "array<f64>",
                                   &scr_arr_retain_v, &scr_arr_release_v);
  check(c1 != c2, "two crossings really are two copies");

  scr_weak_dyn_set(m, c1, v);
  check(scr_weak_dyn_has(m, c2),
        "the SECOND copy of one array finds the first's entry (THE origin property)");
  check(scr_weak_has(m, a), "and the entry is keyed on the array itself");
  check(a->weakkey == 1, "an UNTRACED origin takes ScrArr's own stamp");
  /* And deliberately NO check that the cycle header is clean: an untraced
   * array HAS no header, so scr_cyc_hdr(a) reads the sixteen bytes before
   * the allocation. A first draft of this case asserted on those bytes and
   * failed intermittently on heap garbage -- which is the stray read the
   * whole per-kind-stamp rule exists to prevent, committed by the test
   * meant to police it. What separates the two stamps is pinned in 14b
   * instead, from the side that does have a header. */

  /* The copies die at the end of their statements in real code; the entry
   * must not. */
  scr_dyn_release(c1);
  scr_dyn_release(c2);
  check(scr_weak_has(m, a), "the entry outlives the boundary copies");

  ScrArr *dead = a;
  scr_str_release(v);
  scr_arr_release(a);
  check(!scr_weak_has(m, dead), "and dies with the ORIGIN's own release");
  scr_weak_release(m);
}

/* ── 14b. a TRACED origin takes the OTHER stamp ──
 * The runtime switch reads `elem_trace` off the array rather than being
 * told, so this is the arm that would be a stray store if it guessed. A
 * traced array has a cycle header and its death lands in scr_cyc_free;
 * ScrArr::weakkey must stay 0 or BOTH hooks would fire for one key. */
static void test_dyn_array_origin_traced(void) {
  ScrWeakMap *m = WD();
  ScrArr *a = TA();
  ScrStr *v = S("traced-origin");
  ScrDyn *c = scr_dyn_origin_mark(scr_dyn_new_arr(), a, "array<array<f64>>",
                                  &scr_arr_retain_v, &scr_arr_release_v);
  scr_weak_dyn_set(m, c, v);
  check(scr_weak_has(m, a), "a traced origin is keyed on the array too");
  check((scr_cyc_hdr(a)->blk & SCR_CYC_WEAKKEY) != 0,
        "a TRACED origin takes the CYCLE HEADER's stamp");
  check(a->weakkey == 0,
        "and NOT ScrArr::weakkey, or both hooks would fire for one key");
  scr_dyn_release(c);
  ScrArr *dead = a;
  scr_str_release(v);
  scr_arr_release(a);
  check(!scr_weak_has(m, dead), "the traced origin's death splices the entry");
  scr_weak_release(m);
}

/* ── 15. the loud refusals, and the silent reads ──
 * Node throws `TypeError: Invalid value used as weak map key` from set()
 * and answers undefined/false from get()/has(). A key the table can never
 * hold cannot be present, so only the write side has a lie to tell. What is
 * pinned here is that a refused set INSERTS NOTHING: a refusal that threw
 * after writing the slot would be the address-reuse hazard with extra
 * steps. */
static void test_dyn_refusals(void) {
  ScrWeakMap *m = WD();
  ScrStr *v = S("refused");
  ScrDyn *num = scr_dyn_new_num(42.0);
  ScrDyn *nul = scr_dyn_new_null();

  scr_weak_dyn_set(m, num, v);
  check(scr_exc_pending(), "a NUMBER key throws from set()");
  scr_exc_clear();
  /* THE RAW ADDRESS, not scr_weak_dyn_has. The _dyn read refuses the same
   * kinds set() does, so it answers false BEFORE consulting the table and
   * would pass here even if the refused set had written a slot -- which is
   * the one thing this case exists to pin. A first draft asked it that way
   * and was checking nothing. */
  check(!scr_weak_has(m, (void *)num), "and inserted nothing, on any address");
  check(scr_weak_dyn_get_ref(m, num) == NULL, "get() on it answers NULL, silently");
  check(!scr_exc_pending(), "the read side does not throw");

  scr_weak_dyn_set(m, nul, v);
  check(scr_exc_pending(), "a NULL key throws from set()");
  scr_exc_clear();
  check(!scr_weak_has(m, (void *)nul), "and inserted nothing");

  /* THE STRING, which is the refusal with a real heap payload behind it
   * and therefore the one a "has an address" rule would wrongly admit. JS
   * says a string is a PRIMITIVE and Node throws for it; keying on the
   * ScrStr would also be wrong twice over, because the arena interns and
   * recycles them and two equal strings would be one key where JS has two
   * primitives that are already ===-equal. */
  ScrStr *sv = S("a-string-key");
  ScrDyn *sbox = scr_dyn_new_str(sv);
  scr_weak_dyn_set(m, sbox, v);
  check(scr_exc_pending(), "a STRING key throws from set(), payload or no payload");
  scr_exc_clear();
  check(!scr_weak_has(m, (void *)sv), "and did NOT key on the ScrStr behind it");

  /* A bare copy mark with no origin: an array reached THROUGH a boundary
   * copy. Its lifetime is the enclosing copy's, so it is a temporary
   * however it is keyed, and it is refused rather than cached uselessly. */
  ScrDyn *orphan = scr_dyn_mark_static_copy(scr_dyn_new_arr());
  scr_weak_dyn_set(m, orphan, v);
  check(scr_exc_pending(), "a marked copy with no origin throws from set()");
  scr_exc_clear();
  check(!scr_weak_has(m, (void *)orphan), "and inserted nothing");

  /* THE TUPLE, and it is the reason this whole resolution asks the ORIGIN
   * what it is instead of asking the box. A tuple is an IR *record* whose
   * to-dyn converter builds scr_dyn_new_arr(), so it arrives as an ARR
   * node carrying a RECORD struct as its origin -- the one pair where the
   * node kind and the origin kind disagree. An earlier draft trusted the
   * node kind, cast the record to ScrArr *, read elem_trace at offset 48
   * and stamped offset 28. It is stood up here with a record's own release
   * adapter, which is exactly what the emitted crossing passes and what
   * scr_dyn_origin_peek reads to tell the two apart.
   *
   * ScrStr stands in for the record: any object whose release is not
   * scr_arr_release_v reproduces the case, and using a real one means the
   * teardown is honest. */
  ScrStr *fake_rec = S("not-an-array-and-long-enough-to-cover-offset-28");
  const size_t frlen = fake_rec->len;
  char frcopy[64];
  memcpy(frcopy, fake_rec->data, frlen);
  ScrDyn *tup = scr_dyn_origin_mark(scr_dyn_new_arr(), fake_rec, "record:r0",
                                    &scr_str_retain_v, &scr_str_release_v);
  scr_weak_dyn_set(m, tup, v);
  check(scr_exc_pending(), "an ARR node whose origin is NOT an array throws from set()");
  scr_exc_clear();
  check(!scr_weak_has(m, (void *)fake_rec),
        "and NOTHING was keyed on the non-array origin");
  check(!scr_weak_has(m, (void *)tup), "nor on the box");
  /* Belt and braces on the STAMP, since refusing to store is not the same
   * as refusing to stamp: scr_arr_weak_mark writes 1 at offset 28 of
   * whatever it is handed. ARMED and reported honestly -- reintroducing the
   * bug (`if (0 && !org_is_arr)`) turns the two checks ABOVE red and leaves
   * this one green, because the wrong branch reads elem_trace out of this
   * object and takes the CYCLE stamp, which writes sixteen bytes BEFORE the
   * allocation rather than into its data. So the entry checks are what
   * catches it; this line is here to catch the other stamp if the arm ever
   * picks that one instead. */
  check(fake_rec->len == frlen && memcmp(fake_rec->data, frcopy, frlen) == 0,
        "and the non-array origin was NOT STAMPED - no stray store");

  scr_dyn_release(num);
  scr_dyn_release(nul);
  scr_dyn_release(orphan);
  scr_dyn_release(tup);
  scr_dyn_release(sbox);
  scr_str_release(sv);
  scr_str_release(fake_rec);
  scr_str_release(v);
  scr_weak_release(m);
}

/* ── 16. a dyn ARRAY/OBJECT built in dyn-land keys on ITSELF ──
 * There is no second representation behind one, so scr_dyn_strict_eq's
 * default arm answers `a == b` and the box IS the JS value. That makes the
 * box the only honest key — and it puts a WeakMap key on the FREELIST,
 * which is what the hook in scr_dyn_release is for.
 *
 * THE PARK ROUTE IS ONLY LIVE OUTSIDE THE AUDIT. scr_dyn_release parks a
 * dead node on a per-shape freelist and scr_dyn_alloc hands the same
 * address back out — except under SCR_RC_AUDIT, where the freelist is
 * compiled out so ASan sees real frees. So the reuse half of this case
 * runs in the plain binary and the eviction half runs in both; weak.test.ts
 * builds the source twice for exactly that reason. */
static void test_dyn_box_is_its_own_key(void) {
  ScrWeakMap *m = WD();
  ScrStr *v = S("boxed");
  ScrDyn *o = scr_dyn_new_obj();
  void *dead = (void *)o;

  scr_weak_dyn_set(m, o, v);
  check(scr_weak_dyn_has(m, o), "a dyn-land object keys on itself");
  check(scr_weak_has(m, o), "and the raw address is what the table holds");
  check((scr_cyc_hdr(o)->blk & SCR_CYC_WEAKKEY) != 0,
        "its stamp is the cycle header's, which every ScrDyn has");

  scr_str_release(v);
  scr_dyn_release(o);
  check(!scr_weak_has(m, dead),
        "the entry is spliced when the box dies -- INCLUDING when it is only PARKED");
  check(scr_weak_get_ref(m, dead) == NULL, "and get() on that address answers NULL");
  scr_weak_release(m);
}

#ifndef SCR_RC_AUDIT
/* ── 17. the freelist hands the address back, and it is clean ──
 * The case the park hook exists for, and it cannot run under the audit
 * because the audit compiles the freelist out. A parked ScrDyn keeps its
 * address; scr_cyc_free never runs, so scr_cyc_free's hook never fires and
 * scr_cyc_stamp never clears the mark. Both halves are the hook's job.
 *
 * It REPORTS when the allocator declined to recycle rather than passing
 * quietly, the stance case 12 already takes: a reuse case that never
 * reused has tested nothing. */
static void test_dyn_freelist_reuse(void) {
  ScrWeakMap *m = WD();
  ScrStr *v = S("stale-dyn");
  ScrDyn *k = scr_dyn_new_obj();
  void *dead = (void *)k;
  int reused = 0, tries = 0;

  scr_weak_dyn_set(m, k, v);
  scr_str_release(v);
  scr_dyn_release(k); /* PARKED, not freed: same address, still resident */

  for (; tries < 64 && !reused; tries++) {
    ScrDyn *fresh = scr_dyn_new_obj();
    if ((void *)fresh == dead) {
      reused = 1;
      check(scr_weak_dyn_get_ref(m, fresh) == NULL,
            "a node off the FREELIST does not inherit the dead key's value");
      check(!scr_weak_has(m, fresh), "has() false for a parked address handed back");
      check((scr_cyc_hdr(fresh)->blk & SCR_CYC_WEAKKEY) == 0,
            "and it comes back with a CLEAR stamp - scr_cyc_stamp never ran");
    }
    scr_dyn_release(fresh);
  }
  if (!reused) {
    fprintf(stderr, "NOTE: dyn freelist never returned the same address in %d tries "
                    "- park-reuse case not exercised\n", tries);
  } else {
    check(1, "dyn freelist address reuse was actually exercised");
  }
  scr_weak_release(m);
}
#endif

int main(void) {
  test_basic_identity();
  test_key_not_retained();
  test_entry_dies_with_key();
  test_address_reuse();
  test_multi_map_splice();
  test_overwrite_and_teardown();
  test_growth();
  test_array_keys();
  test_array_address_reuse();
  test_cycle_keys();
  test_cycle_collector_death();
  test_cycle_address_reuse();
  test_dyn_bytes_payload();
  test_dyn_array_origin();
  test_dyn_array_origin_traced();
  test_dyn_refusals();
  test_dyn_box_is_its_own_key();
#ifndef SCR_RC_AUDIT
  test_dyn_freelist_reuse();
#endif
  fprintf(stderr, "%ld/%ld cases passed\n", total - failed, total);
  return failed == 0 ? 0 : 1;
}
