/* WeakMap: reference-identity keys held WEAKLY.
 *
 * WHY THIS EXISTS AT ALL, given the comment it overturns.
 *
 * lower-classes.ts carried this hint for every WeakMap a program wrote:
 *
 *   "weak collections observe garbage collection, which reference
 *    counting never exposes - a strong Map behaves identically
 *    in-language: use Map"
 *
 * The second half is true and the first half is not. Reference counting
 * exposes key death MORE precisely than a tracing collector does, not
 * less: `scr_bytes_release` reaching `--rc == 0` IS the death, exactly at
 * the instant it happens, with no collection cycle to wait for. What
 * refcounting cannot see is a key kept alive only by a CYCLE, and what it
 * cannot express without collector help is an EPHEMERON. Neither of those
 * is "never exposes". The hint conflated "we have no tracing GC" with "we
 * cannot know when an object dies", and a strong Map does NOT behave
 * identically: it behaves identically in every observable way EXCEPT
 * memory, which is the entire reason the caller reached for a WeakMap.
 *
 * EVICTION AT DEATH IS MANDATORY, NOT AN OPTIMISATION. This is the point
 * that must survive anyone later "simplifying" this file into a periodic
 * sweep. Keys are compared by ADDRESS. The string arena
 * (scr_string.c) and the cycle arena (scr_cycle.c) both recycle blocks
 * aggressively, so a freed key's address is handed out again quickly. If
 * a dead key's entry were allowed to linger until some later sweep, a
 * lookup on a NEW object that landed on the old address would find the
 * PREVIOUS occupant's value and return it. That is a wrong answer, not a
 * leak - silent, data-dependent, and effectively impossible to debug in a
 * crypto cache. Removing the entry inside the free path is what makes an
 * address-keyed table sound at all.
 *
 * WHAT IS NOT IMPLEMENTED: EPHEMERONS. A real WeakMap makes a value
 * reachable only THROUGH its key, so `wm.set(k, v)` where v reaches k
 * collects both. Here the value is held STRONGLY (which is correct for
 * every value that does not reach its own key) so such a pair leaks both
 * halves. Implementing the real rule needs the cycle collector to treat
 * the table as an ephemeron edge, which is deferred - see the note in
 * MEMORY-KNOBS / the block report.
 *
 * VERIFIED for the caches this was built for: zapo-js 1.8.2's
 * `publicDerivationCache` (crypto/core/xeddsa.ts:73) stores
 * `{ privateScalar: bigint, encodedPublic: Uint8Array, pubKeySignBit }`
 * where `encodedPublic` is FRESH out of `encodeExtendedPoint` - the value
 * never reaches the `privateKey` that keys it, so the non-ephemeron rule
 * is exact for it. Anyone adding a WeakMap must re-check that; the check
 * is "can the value reach the key", and it is not automated.
 *
 * WHICH KEYS. Only kinds whose death has a single refcount chokepoint the
 * runtime owns. Today that is ScrBytes (Uint8Array), whose
 * `scr_bytes_release` is a plain `--rc == 0` free and is NOT a cycle
 * node. Arrays, records and class instances are `scr_cyc_alloc` nodes: they
 * can die through the collector's collectWhite without passing through
 * any release this file could hook, so they need a collector-side hook and
 * are deliberately still refused by the frontend.
 *
 * THE REGISTRY IS A LIST, NOT A TABLE. A key can sit in several maps, so
 * a death must reach all of them. Rather than a second pointer-keyed
 * index (which would itself need eviction, and would be a table of the
 * same addresses this file is trying not to trust), every live WeakMap is
 * on one global list and a death walks it. Programs hold a handful of
 * WeakMaps - this program holds three - so the walk is shorter than the
 * hash it replaces. The per-free cost for a program with no WeakMap at
 * all is one already-cached byte test, and for a non-key ScrBytes in a
 * program that does use one it is the same byte test; only an actual key
 * pays the walk. */

#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>

/* Tombstone. A deleted slot must stay probeable or a linear probe would
 * stop short of an entry that hashed before it. */
#define SCR_WEAK_TOMB ((void *)(uintptr_t)1)

typedef struct {
  void *key; /* NULL empty, SCR_WEAK_TOMB deleted, else the raw key (NOT owned) */
  void *val; /* owned when key is a real pointer */
} ScrWeakEntry;

struct ScrWeakMap {
  size_t rc;
  ScrWeakEntry *tab;
  size_t cap;  /* power of two, 0 until first set */
  size_t used; /* live entries */
  size_t tomb; /* tombstones */
  void *(*val_retain)(void *);
  void (*val_release)(void *);
  struct ScrWeakMap *next; /* the global live list */
};

/* Every live WeakMap. Only scr_weak_key_died reads it. */
static ScrWeakMap *scr_weak_live = NULL;

/* Same shape scr_map.c uses: allocation failure is a trap, not a NULL the
 * callers would each have to answer for. */
static void scr_weak_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* Pointer hash. Fibonacci multiply then take the HIGH bits: the low bits
 * of a malloc'd pointer are alignment zeros and would collide every key
 * into one bucket run. */
static size_t scr_weak_hash(const void *p, size_t cap) {
  uint64_t h = (uint64_t)(uintptr_t)p;
  h *= 11400714819323198485ULL;
  return (size_t)(h >> 40) & (cap - 1u);
}

ScrWeakMap *scr_weak_new(void *(*val_retain)(void *), void (*val_release)(void *)) {
  ScrWeakMap *m = (ScrWeakMap *)calloc(1, sizeof *m);
  if (!m) scr_weak_oom();
  m->rc = 1;
  m->val_retain = val_retain;
  m->val_release = val_release;
  m->next = scr_weak_live;
  scr_weak_live = m;
  /* Arm the free path. Idempotent, and deliberately here rather than in a
   * constructor attribute: a binary that links this TU but never runs a
   * `new WeakMap` leaves scr_bytes_release exactly as it was. */
  scr_weak_died_hook = scr_weak_key_died;
  return m;
}

/* Find the slot k occupies, or the slot it would be inserted into.
 * Returns 0 only when cap is 0 (nothing allocated yet). */
static int scr_weak_slot(ScrWeakMap *m, const void *k, size_t *out, int for_insert) {
  size_t i, first_tomb = (size_t)-1;
  if (m->cap == 0) return 0;
  i = scr_weak_hash(k, m->cap);
  for (;;) {
    void *cur = m->tab[i].key;
    if (cur == NULL) {
      *out = (for_insert && first_tomb != (size_t)-1) ? first_tomb : i;
      return 0; /* not present */
    }
    if (cur == SCR_WEAK_TOMB) {
      if (first_tomb == (size_t)-1) first_tomb = i;
    } else if (cur == k) {
      *out = i;
      return 1; /* present */
    }
    i = (i + 1u) & (m->cap - 1u);
  }
}

static void scr_weak_grow(ScrWeakMap *m) {
  size_t ncap = m->cap ? m->cap * 2u : 8u;
  ScrWeakEntry *old = m->tab;
  size_t ocap = m->cap, i;
  ScrWeakEntry *fresh = (ScrWeakEntry *)calloc(ncap, sizeof *fresh);
  if (!fresh) scr_weak_oom();
  m->tab = fresh;
  m->cap = ncap;
  m->tomb = 0;
  for (i = 0; i < ocap; i++) {
    void *k = old[i].key;
    size_t s;
    if (k == NULL || k == SCR_WEAK_TOMB) continue;
    scr_weak_slot(m, k, &s, 1);
    m->tab[s].key = k;
    m->tab[s].val = old[i].val;
  }
  free(old);
}

/* BORROWS key, takes the value under the libcall convention (borrowed in,
 * retained here). Marking the key is what buys the cheap free-path test. */
void scr_weak_set(ScrWeakMap *m, void *key, void *val) {
  size_t s;
  if (key == NULL) return;
  /* Load factor 1/2 counting tombstones, so probes stay short. */
  if (m->cap == 0 || (m->used + m->tomb + 1u) * 2u >= m->cap) scr_weak_grow(m);
  if (scr_weak_slot(m, key, &s, 1)) {
    void *old = m->tab[s].val;
    m->tab[s].val = m->val_retain ? m->val_retain(val) : val;
    if (m->val_release && old) m->val_release(old);
    return;
  }
  if (m->tab[s].key == SCR_WEAK_TOMB) m->tomb--;
  m->tab[s].key = key;
  m->tab[s].val = m->val_retain ? m->val_retain(val) : val;
  m->used++;
  scr_weak_mark_key(key);
}

/* The stored value at +1, or NULL when absent — the `_ref` convention
 * scr_map_get_str_ref already sets, so the emitter's union-boxing path
 * for a weak read is the same shape as for a map read (ownership MOVES
 * into the box on a hit; a miss boxes the interned undefined arm). */
void *scr_weak_get_ref(ScrWeakMap *m, const void *key) {
  size_t s;
  void *v;
  if (key == NULL) return NULL;
  if (!scr_weak_slot(m, key, &s, 0)) return NULL;
  v = m->tab[s].val;
  if (v != NULL && m->val_retain) v = m->val_retain(v);
  return v;
}

int scr_weak_has(ScrWeakMap *m, const void *key) {
  size_t s;
  if (key == NULL) return 0;
  return scr_weak_slot(m, key, &s, 0);
}

/* Remove one key. Used by delete and by the death hook. */
static void scr_weak_drop(ScrWeakMap *m, const void *key) {
  size_t s;
  if (!scr_weak_slot(m, key, &s, 0)) return;
  if (m->val_release && m->tab[s].val) m->val_release(m->tab[s].val);
  m->tab[s].key = SCR_WEAK_TOMB;
  m->tab[s].val = NULL;
  m->used--;
  m->tomb++;
}

/* THE DEATH HOOK. Called from a key type's release the moment its
 * refcount reaches zero and BEFORE its storage is handed back, so the
 * address can never be observed in this table after it stops being this
 * object. See the header comment on why lateness here is a wrong answer
 * rather than a leak. */
void scr_weak_key_died(void *key) {
  ScrWeakMap *m;
  for (m = scr_weak_live; m != NULL; m = m->next) scr_weak_drop(m, key);
}

ScrWeakMap *scr_weak_retain(ScrWeakMap *m) {
  if (m && m->rc != SIZE_MAX) m->rc++;
  return m;
}

void scr_weak_release(ScrWeakMap *m) {
  if (!m || m->rc == SIZE_MAX) return;
  if (--m->rc == 0) {
    ScrWeakMap **pp = &scr_weak_live;
    size_t i;
    for (i = 0; i < m->cap; i++) {
      void *k = m->tab[i].key;
      if (k == NULL || k == SCR_WEAK_TOMB) continue;
      if (m->val_release && m->tab[i].val) m->val_release(m->tab[i].val);
    }
    /* Off the live list BEFORE the free, or a death arriving from one of
     * the value releases above would walk a half-torn map. */
    while (*pp != NULL) {
      if (*pp == m) { *pp = m->next; break; }
      pp = &(*pp)->next;
    }
    free(m->tab);
    free(m);
  }
}

void *scr_weak_retain_v(void *m) { return scr_weak_retain((ScrWeakMap *)m); }
void scr_weak_release_v(void *m) { scr_weak_release((ScrWeakMap *)m); }

/* Keys keep their mark for life, even after every map holding them drops
 * the entry. Clearing it would need a per-key count of how many maps hold
 * it, and the only cost of a stale mark is one wasted list walk in that
 * key's own free - never a wrong answer. The trade is deliberate. */
