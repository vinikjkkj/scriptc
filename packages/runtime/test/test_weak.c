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
 *  - values are held strongly and released exactly once.
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
  return scr_weak_new(&scr_str_retain_v, &scr_str_release_v);
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

int main(void) {
  test_basic_identity();
  test_key_not_retained();
  test_entry_dies_with_key();
  test_address_reuse();
  test_multi_map_splice();
  test_overwrite_and_teardown();
  test_growth();
  fprintf(stderr, "%ld/%ld cases passed\n", total - failed, total);
  return failed == 0 ? 0 : 1;
}
