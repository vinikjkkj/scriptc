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
 * WHICH KEYS. Only kinds whose death reaches a chokepoint the runtime
 * owns, on EVERY route the object can die by. There are FOUR such
 * chokepoints:
 *
 *   - `scr_bytes_release` at `--rc == 0` — ScrBytes (Uint8Array). Not a
 *     cycle node; one route, one hook.
 *   - `scr_arr_release` at `--rc == 0` — an UNTRACED array. scr_arr_new_ref
 *     routes through scr_cyc_alloc only when elem_trace is non-NULL, so an
 *     untraced array is a plain malloc/free and has the same single route.
 *   - `scr_cyc_free` — every CYCLE-HEADERED object, which among admitted
 *     kinds means a TRACED array. This is the collector hook, and it is
 *     one line because the two routes converge on it: ordinary release to
 *     zero runs the type's teardown (scr_arr_gc_free) which ends in
 *     scr_cyc_free, and the collector's collectWhite loop calls that same
 *     teardown directly through scr_cyc_free_of(hdr). Verified by reading
 *     both, and by test_weak.c's collector cases.
 *   - scr_dyn_release at `--rc == 0` — a DYN box used as its own key. This
 *     one exists because the ScrDyn freelist is a give-back route
 *     scr_cyc_free never sees: a parked node keeps its address and
 *     scr_dyn_alloc hands it straight back out. The hook sits above both
 *     of that function's exits; the collector's route into a dyn value
 *     (scr_dyn_gcfree) still ends at scr_cyc_free and needs nothing.
 *
 * A FOURTH KEY TYPE, `WeakMap<object, V>`, KEYS ON THE PAYLOAD rather than
 * on the value handed in, and everything about it is in the DYN KEYS
 * section near the bottom of this file. It is the only key type whose
 * stamp is chosen at run time.
 *
 * RECORDS AND CLASS INSTANCES ARE STILL REFUSED, and no longer for want of
 * the collector hook — that argument is now spent. They are refused for
 * two reasons of their own, both in isSupportedWeakKey: a record
 * WIDTH-COERCES (the copy would key the entry on a temporary), and an
 * ACYCLIC class instance is calloc'd with no cycle header at all, so the
 * hook below cannot see it and the frontend predicate cannot tell which
 * classes those are. Both refusals hold on the dyn side too, where they
 * are answered by a throw from set() rather than by the strong-Map ride —
 * see scr_weak_dyn_key.
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

#include <stdio.h>
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
  void (*key_mark)(void *); /* the key kind's own stamp; see scr_weak_new */
  struct ScrWeakMap *next;  /* the global live list */
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

ScrWeakMap *scr_weak_new(void *(*val_retain)(void *), void (*val_release)(void *),
                         void (*key_mark)(void *)) {
  ScrWeakMap *m = (ScrWeakMap *)calloc(1, sizeof *m);
  if (!m) scr_weak_oom();
  m->rc = 1;
  m->val_retain = val_retain;
  m->val_release = val_release;
  m->key_mark = key_mark;
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
  if (m->key_mark != NULL) m->key_mark(key);
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

/* THE DEATH HOOK. Called the moment a key stops being that key and BEFORE
 * its storage is handed back, so the address can never be observed in this
 * table after it stops naming this object. Three call sites, one per
 * chokepoint listed at the top of this file — two releases and
 * scr_cyc_free, which is also the collector's route. See the header
 * comment on why lateness here is a wrong answer rather than a leak. */
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

/* ── DYN KEYS: `WeakMap<object, V>` ────────────────────────────────────
 *
 * TypeScript's bare `object` is the NonPrimitive intrinsic and mapType
 * lowers it to the DYN, so a table written `WeakMap<object, Uint8Array>`
 * has a ScrDyn in its key column and the key's kind is a RUNTIME fact.
 * zapo-js 1.8.2 writes exactly one (signal/session/encoding.ts:229) and
 * feeds it a `readonly RawSignalSessionSnapshot[]`, which is what the
 * function's own doc comment means by "cached per array instance".
 *
 * THE KEY IS THE PAYLOAD, NEVER THE BOX. scr_dyn_strict_eq is the
 * authority on where a dyn value's identity lives and this follows it arm
 * for arm, because a WeakMap and `===` must agree about what "the same
 * object" is or the table answers questions the language does not ask. A
 * ScrDyn wrapping a Uint8Array is a boundary artifact; the JS value is the
 * ScrBytes, and two boxes of one payload compare ===-equal. A table keyed
 * on boxes would miss every lookup a program makes — a silently useless
 * cache, which is not a better outcome than a refusal.
 *
 * For SCR_DYN_ARR and SCR_DYN_OBJ built in dyn-land there IS no payload:
 * the items vector and the entry table live in the box, strict_eq's
 * default arm answers `a == b`, and the box IS the JS value. Those key on
 * themselves — the same rule, not an exception to it.
 *
 * THE BOUNDARY COPY IS THE INTERESTING CASE and it is the one the site
 * above hits. A static array crossing into dyn cannot alias (a packed
 * ScrArr against a ScrDyn vector is different memory), so the converter
 * COPIES — and a copy is a temporary that dies at the end of the
 * statement, which is precisely the hazard weakKeyArgIsIdentity refuses
 * elsewhere. What makes this one different is that the copy is not
 * anonymous: scr_dyn_origin_mark records the object it was made from,
 * retained for the copy's life, and scr_dyn_origin_peek reads it back. So
 * the key is the ORIGIN — the ScrArr the caller still holds, which is the
 * identity Node uses and the one the program means. Two crossings of one
 * array make two boxes and ONE origin, so `get` after `set` hits.
 *
 * A record's boundary copy has an origin too and is REFUSED anyway: the
 * origin is a record, the kind isSupportedWeakKey refuses at the type
 * level for width coercion, and there is no field on it to stamp.
 *
 * THE STAMP SWITCHES ON THE RUNTIME KIND, and that is the one design rule
 * this file states that dyn keys break. Every other key kind hands
 * scr_weak_new a statically-chosen key_mark so that writing a field the
 * value does not have is impossible. A dyn key cannot: nothing static
 * knows which kind arrives. The switch is therefore in ONE function, and
 * every arm derives the address and its stamp TOGETHER from the same
 * inspection — which is the invariant the function pointer was buying,
 * enforced by locality instead of by type. The array arm reads
 * `elem_trace` off the object rather than recomputing tracedness, so it is
 * the trace fixpoint's own answer and cannot disagree with it. */

/* Node's own text, verbatim, measured on v25.9.0:
 *   > const w = new WeakMap(); w.set(1, 2)
 *   TypeError: Invalid value used as weak map key
 * Reproduced rather than reworded because Node refuses these for the same
 * reason this does — a primitive has no address — so a program that
 * catches on the message keeps working. */
static void scr_weak_dyn_refuse_primitive(void) {
  static const char msg[] = "Invalid value used as weak map key";
  scr_throw_error_msg(SCR_ERR_TYPE, msg, sizeof msg - 1);
}

/* The second family: kinds Node ACCEPTS as weak keys and this runtime
 * cannot watch die on every route. Node's text would be a lie here (the
 * value is a perfectly good weak key in JS), so these get their own,
 * naming the kind and the reason. A refusal is the only honest answer:
 * accepting would put an address in the table that the allocator is free
 * to hand out again, and the next object there would read this one's
 * value. That is the wrong answer the head of this file exists to
 * prevent, and it is worse than not compiling. */
static void scr_weak_dyn_refuse_unwatched(const char *what, const char *why) {
  char buf[320];
  int n = snprintf(buf, sizeof buf,
                   "a WeakMap key that is %s is not supported yet (%s) - "
                   "a weak entry is keyed by ADDRESS, so the runtime must see the key die "
                   "before its storage goes back; use a Map to hold this key strongly",
                   what, why);
  if (n < 0) n = 0;
  if ((size_t)n >= sizeof buf) n = (int)sizeof buf - 1;
  scr_throw_error_msg(SCR_ERR_TYPE, buf, (size_t)n);
}

typedef struct {
  void *addr;           /* the identity to key on; NULL = refused */
  void (*mark)(void *); /* its stamp, derived in the same arm */
  const char *what;     /* refusal only: what the value is */
  const char *why;      /* refusal only: NULL = the primitive family */
} ScrWeakDynKey;

static ScrWeakDynKey scr_weak_dyn_key(const ScrDyn *d) {
  ScrWeakDynKey k;
  k.addr = NULL;
  k.mark = NULL;
  k.what = NULL;
  k.why = NULL;
  if (d == NULL) return k; /* an uninitialized `let`; Node's undefined arm */
  switch (d->kind) {

  /* ADMITTED. The payload, and the chokepoint that observes its death. */
  case SCR_DYN_BYTES:
    /* The crossing SHARES the ScrBytes rather than copying it
     * (scr_dyn_new_bytes_ref), so the payload is the same pointer the
     * static side holds — and its death is scr_bytes_release at rc == 0,
     * the original phase-1 chokepoint. A VIEW carries its own header with
     * a `backing` link rather than its parent's, which is what keeps
     * `whole !== whole.subarray(0, n)` answering the way Node does here
     * too. */
    k.addr = d->v.bytes;
    k.mark = scr_bytes_weak_mark;
    return k;
  case SCR_DYN_ARR:
    if (d->static_copy) {
      int org_is_arr = 0;
      ScrArr *org = (ScrArr *)scr_dyn_origin_peek(d, &org_is_arr);
      if (org == NULL) {
        /* A marked copy with no origin of its own: an array NESTED inside
         * a boundary copy (scr_dyn_mark_static_copy stamps the whole
         * subtree, scr_dyn_origin_mark records only the root) or a module
         * namespace. Its lifetime is the enclosing copy's, so it is a
         * temporary however it is keyed — refuse rather than hand back a
         * cache that can only miss. */
        k.what = "an array reached THROUGH a static-to-dynamic boundary copy";
        k.why = "only the copy's ROOT records the object it was made from, so a nested "
                "array has no identity outside this statement";
        return k;
      }
      if (!org_is_arr) {
        /* AN ARR NODE WHOSE ORIGIN IS NOT AN ARRAY — a TUPLE. A tuple is
         * an IR *record* whose to-dyn converter builds scr_dyn_new_arr(),
         * so the node kind and the origin kind disagree for exactly this
         * one shape, and `d->kind` cannot be trusted to say what the
         * origin is. Reading it as an ScrArr is a stray store into a
         * record; the origin is a record besides, which is a refused key
         * kind on its own terms. See scr_dyn_origin_peek's comment for the
         * measurement.
         *
         * This arm is why the resolution asks the ORIGIN what it is rather
         * than asking the box. */
        k.what = "a tuple crossed into a dynamic value";
        k.why = "a tuple is a RECORD that converts to a dynamic array, so the object this "
                "copy was made from width-coerces like any record and carries no field to "
                "stamp";
        return k;
      }
      /* The origin, not the copy. See the note above; the stamp is chosen
       * from the array's OWN elem_trace, which is where the emitter's
       * trace fixpoint already wrote its answer:
       *   untraced -> plain malloc, one chokepoint, ScrArr::weakkey;
       *   traced   -> scr_cyc_alloc, two chokepoints that converge on
       *               scr_cyc_free, SCR_CYC_WEAKKEY in the header.
       * Exactly one of the two hooks can fire for a given array. */
      k.addr = org;
      k.mark = org->elem_trace != NULL ? scr_cyc_weak_mark : scr_arr_weak_mark;
      return k;
    }
    /* Built in dyn-land: the box is the value (strict_eq's default arm),
     * and it is scr_cyc_alloc'd so the header stamp fits it. Its death
     * reaches scr_dyn_release, which fires the hook above BOTH of its
     * exits — the freelist park included, which is the route
     * scr_cyc_free never sees. */
    k.addr = (void *)d;
    k.mark = scr_cyc_weak_mark;
    return k;

  case SCR_DYN_OBJ:
    if (d->static_copy) {
      k.what = d->module_ns ? "a compiled module's namespace"
                            : "a record crossed into a dynamic value";
      k.why = d->module_ns
                  ? "a namespace snapshot is rebuilt at each crossing and names no object "
                    "the program holds"
                  : "the object this copy was made from is a RECORD, which width-coerces - "
                    "the same reason a record-keyed WeakMap rides the strong Map";
      return k;
    }
    k.addr = (void *)d;
    k.mark = scr_cyc_weak_mark;
    return k;

  /* REFUSED, family 1: no address at all. Node refuses these too, for
   * this reason, so its message is reproduced above. */

  case SCR_DYN_NULL:
  case SCR_DYN_UNDEF:
  case SCR_DYN_BOOL:
  case SCR_DYN_NUM:
  case SCR_DYN_STR:
  case SCR_DYN_BIG:
    /* A STRING has a heap ScrStr behind it and is still refused, because
     * JS says a string is a PRIMITIVE: `new WeakMap().set("k", v)` throws
     * in Node. Keying on the ScrStr would also be wrong twice over — the
     * arena interns and recycles them, and two equal strings would be one
     * key where JS has two primitives that are already ===-equal. Same
     * for a bigint. */
    return k;

  /* REFUSED, family 2: an address exists, the death does not reach a
   * chokepoint this runtime owns on every route. */

  case SCR_DYN_ARRBUF:
    /* AND THE ARRAYBUFFER IS REFUSED, even though its payload is an
     * ScrBytes with the same hooked release the arm above uses. The
     * reason is that an address is a WEAKER key here than `===` is.
     * SCR_DYN_ARRBUF's payload is BY DESIGN the same ScrBytes a typed
     * array over it holds — "not an optimisation, it is the semantics",
     * says the kind's own comment, because `new Uint8Array(buf)` on
     * either side of the boundary must see the other's writes. So one
     * address can name two distinct JS values, and `scr_dyn_strict_eq`
     * tells them apart only because it compares the KIND first. This
     * table has one `void *` per entry and the death hook is handed a
     * bare address, so it has no room for the kind and would answer a
     * lookup on the ArrayBuffer with the view's value.
     *
     * That is not reachable TODAY: `.buffer` is frontend-fenced outside
     * `new DataView(x.buffer, …)` / `Buffer.from(x.buffer, …)` ("no
     * free-standing ArrayBuffer value exists" — measured, SC1090), and
     * both of those mint a view with its OWN header. But the soundness
     * would then rest on a FRONTEND FENCE rather than on anything this
     * file can see, which is the same shape as the acyclic-class refusal
     * and gets the same answer. The kind is admitted the day the key
     * carries its dyn kind alongside its address. */
    k.what = "an ArrayBuffer";
    k.why = "its payload is deliberately the SAME buffer a typed array over it holds, so "
            "one address would name two JS values that '===' tells apart by kind";
    return k;
  case SCR_DYN_OBJINST:
    k.what = "a class instance";
    k.why = "an ACYCLIC class is emitted with calloc and a lean one-word header and never "
            "reaches scr_cyc_free, and which classes those are is a module-level fixpoint";
    return k;
  case SCR_DYN_FUNC:
    k.what = "a function";
    k.why = "a closure literal is INTERNED as an immortal, so two functions the program "
            "wrote separately can share one address and neither ever dies";
    return k;
  case SCR_DYN_HANDLE:
    k.what = "a native handle";
    k.why = "the tags behind it are released through a dozen different unit-owned paths, "
            "and regex literals are interned one per pattern-and-flags pair";
    return k;
  case SCR_DYN_PROMISE:
    k.what = "a promise";
    k.why = "its release runs through an installed ops pointer in the gated fiber unit, "
            "which this always-linked core cannot hook";
    return k;
  case SCR_DYN_JSVAL:
    k.what = "a value that lives in the embedded engine";
    k.why = "the engine owns its lifetime and reports no death to this runtime";
    return k;
  case SCR_DYN_MAP:
    k.what = "a Map";
    k.why = "scr_map_release has no weak-key stamp to read and ScrMap has no field to "
            "carry one";
    return k;
  default:
    /* A kind added after this switch was written. Refusing is the safe
     * direction: a new kind is admitted by being NAMED here, never by
     * falling through. */
    k.what = "a dynamic value of a kind this table does not admit";
    k.why = "the kind was added to the runtime after the weak-key switch was written";
    return k;
  }
}

/* set() REFUSES and get/has DO NOT, which is exactly what Node does:
 * `wm.set(1, v)` throws while `wm.get(1)` answers undefined and
 * `wm.has(1)` answers false. A key the table can never hold cannot be
 * present, so the read side has an honest answer and only the write side
 * has a lie to tell. */
void scr_weak_dyn_set(ScrWeakMap *m, ScrDyn *key, void *val) {
  ScrWeakDynKey k = scr_weak_dyn_key(key);
  if (k.addr == NULL) {
    if (k.why == NULL) scr_weak_dyn_refuse_primitive();
    else scr_weak_dyn_refuse_unwatched(k.what, k.why);
    return;
  }
  /* scr_weak_set stamps through the map's own key_mark, which is NULL for
   * a dyn-keyed table precisely because the stamp is per-VALUE here. The
   * order is the one scr_weak_set uses: insert, then mark. */
  scr_weak_set(m, k.addr, val);
  k.mark(k.addr);
}

void *scr_weak_dyn_get_ref(ScrWeakMap *m, const ScrDyn *key) {
  ScrWeakDynKey k = scr_weak_dyn_key(key);
  return k.addr == NULL ? NULL : scr_weak_get_ref(m, k.addr);
}

int scr_weak_dyn_has(ScrWeakMap *m, const ScrDyn *key) {
  ScrWeakDynKey k = scr_weak_dyn_key(key);
  return k.addr == NULL ? 0 : scr_weak_has(m, k.addr);
}

/* Keys keep their mark for as long as they exist, even after every map
 * holding them drops the entry. Clearing it would need a per-key count of
 * how many maps hold it, and the only cost of a stale mark is one wasted
 * list walk in that key's own free - never a wrong answer. The trade is
 * deliberate.
 *
 * For a CYCLE-HEADERED key "for life" ends at the free, not after it:
 * scr_cyc_stamp rewrites ScrCycHdr::blk wholesale on every allocation, so
 * a recycled block comes back with the stamp clear. That is required, not
 * a bonus — the pool and the arena hand the same address out again, and an
 * inherited stamp would make the NEXT object at that address walk the
 * registry on its own free. Still not a wrong answer (the walk would find
 * nothing), but the address-reuse story is why nothing here may rely on a
 * mark outliving its object.
 *
 * AND A ScrDyn IS THE CASE THAT ARGUMENT DOES NOT COVER EITHER, because
 * the freelist park in scr_dyn_release bypasses scr_cyc_stamp entirely: a
 * parked node keeps its blk byte and comes back out of scr_dyn_alloc with
 * whatever its last life left there. So the hook at that site CLEARS the
 * stamp as it fires. Same rule, third mechanism. */
