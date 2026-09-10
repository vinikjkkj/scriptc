/* ES Map<K, V> — the compact-dict design (see scr_runtime.h for the API
 * contract): a dense, insertion-ordered entries array plus an open-addressing
 * bucket table of entry indices. Deletions tombstone their entry (key and
 * value released immediately; the bucket slot keeps pointing at the dead
 * entry so probe chains stay intact); tombstones are compacted away when the
 * entries array grows — but never while an iteration is active (iter_depth),
 * which is what keeps the forEach desugar's plain indices stable under
 * arbitrary mutation from the callback.
 *
 * Cycle capability is per-map, decided at construction: val_trace non-NULL
 * means the value type carries a collector header, so records/objects stored
 * as values could point back at this map — the map allocates with the hidden
 * cycle header, its trace visits every live value, and the collector
 * teardown releases the complement (string keys) per the trace/teardown
 * contract in scr_runtime.h. Scalar-, string- and array-valued maps keep the
 * lean 1-word header and never touch the collector.
 */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Live heap-map count for the RC audit lane (-DSCR_RC_AUDIT); same contract
 * as scr_str_live_count in scr_string.c. */
#ifdef SCR_RC_AUDIT
static long scr_live_maps = 0;
long scr_map_live_count(void) { return scr_live_maps; }
#endif

#define SCR_MAP_EMPTY SIZE_MAX
/* The empty marker INSIDE the bucket array, which is uint32_t (see the
 * note on ScrMap::buckets). SCR_MAP_EMPTY stays size_t and stays the
 * "no such entry" answer scr_map_find returns; the two are deliberately
 * separate names because they are separate widths. */
#define SCR_MAP_BUCKET_EMPTY UINT32_MAX
/* A dense entry index has to fit a bucket slot. Reaching this needs ~4
 * billion entries, i.e. 64 GB of ScrMapEntry alone before a single key
 * or value is counted, so it is an out-of-memory condition reported as
 * one rather than a silent truncation. */
#define SCR_MAP_MAX_ENTRIES ((size_t)UINT32_MAX - 1)

/* â”€â”€ idle shrink: give a sparse map's tables back â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
 * THE DEFECT. scr_map_compact drops tombstones but only ever densifies IN
 * PLACE: `ecap` is never reduced and `entries`/`live`/`buckets` are never
 * realloc'd down. scr_map_clear is worse -- it sets nentries to 0 and
 * frees nothing at all. So a map that held 200,000 entries and was
 * cleared keeps every byte of its three tables for the life of the map,
 * which is the "memory never comes back" shape this objective is about.
 *
 * WHERE IT RUNS, AND WHY THAT IS THE WHOLE DESIGN. The shrink runs from
 * scr_collect_cycles_idle -- the event loop's BETWEEN-TURNS point -- and
 * NOT at the end of scr_collect_cycles, where the cycle arena's page
 * return already sweeps. That is not a stylistic choice. A measured audit
 * of every site that caches one of these buffer pointers in a C local
 * across a call gave:
 *
 *     mover-on-grow (today's realloc contract)   0 sites
 *     end of scr_collect_cycles                  0 sites for scr_map,
 *                                                9 for ScrDyn::obj.entries
 *     between loop turns                         0 by construction
 *
 * scr_map is safe in all three, but a collection can begin inside
 * scr_cyc_on_release, which the runtime calls from the middle of
 * arbitrary functions -- 771 of 3,461 runtime functions can reach one.
 * Page return survives that because it only touches FREE pages no live
 * pointer names; a table move is a different proposition. Between turns
 * no C local is live at all, so the hazard is zero by construction rather
 * than by audit, and the audit is what says the difference is real.
 *
 * THE SECOND INVARIANT, WHICH A POINTER COUNT CANNOT SEE. Zero cached
 * pointers does not make a move safe: compaction renumbers ENTRY INDICES,
 * and the forEach desugar iterates by plain index. iter_depth exists for
 * exactly that, and it is NOT redundant here -- a synchronous forEach
 * cannot span a loop turn, but an async iteration (`for await` over a map)
 * holds iter_depth across precisely the point this pass runs. A map with
 * an iteration in flight is skipped, counted separately, and picked up on
 * a later pass.
 *
 * REACHING THE MAPS. There is no registry of live maps and this does not
 * add one: a map is linked into a WORKLIST only when a delete or a clear
 * leaves it sparse, and the pass drains that list. Cost is two pointers
 * and a flag per map, paid only in the struct, plus O(1) link/unlink. No
 * retain is taken -- retaining would set the cycle color to BLACK through
 * scr_map_retain and tell the collector a garbage map is live -- so both
 * free paths unlink instead. */

#ifndef SCR_MAP_SHRINK
#define SCR_MAP_SHRINK 1
#endif

#ifndef SCR_MAP_SHRINK_STAT
#define SCR_MAP_SHRINK_STAT 0
#endif

/* Below this capacity the tail is not worth a realloc: 32 entries is 512
 * bytes of ScrMapEntry, and a map this small is usually about to grow
 * again. */
#ifndef SCR_MAP_SHRINK_MIN_ECAP
#define SCR_MAP_SHRINK_MIN_ECAP 32
#endif

/* Counters first, and the code that bumps them after -- a byte delta on an
 * inert path is the failure shape this instrument exists to refuse. Every
 * outcome is counted, including the ones that do nothing, so that "never
 * ran", "ran and nothing shrank" and "shrank" cannot read alike. */
static struct {
  unsigned long queued;      /* linked onto the worklist */
  unsigned long requeued;    /* queue attempt on an already-queued map */
  unsigned long unlinked;    /* freed while queued */
  unsigned long turns;       /* scr_map_idle_shrink calls, work or not */
  unsigned long passes;      /* ... of those, the ones that did work */
  unsigned long visited;     /* maps taken off the worklist */
  unsigned long skip_iter;   /* skipped: iteration in flight (iter_depth) */
  unsigned long skip_small;  /* skipped: ecap already at or below the floor */
  unsigned long skip_dense;  /* visited, compacted, but no tail to give back */
  unsigned long shrunk;      /* tables actually realloc'd down */
  unsigned long failed;      /* a shrinking realloc refused (old kept) */
  unsigned long long ebytes; /* ... of which entries */
  unsigned long long lbytes; /* ... of which live */
  unsigned long long bbytes; /* ... of which buckets */
} scr_map_sh = {0};

/* The worklist. Doubly linked so a free is O(1) rather than a scan. */
static ScrMap *scr_map_sh_head = NULL;

#if SCR_MAP_SHRINK_STAT
static void scr_map_shrink_arm(void);
static void scr_map_shrink_tick(void);
#endif

static bool scr_map_shrink_on(void) {
#if !SCR_MAP_SHRINK
  return false;
#else
  static bool once = false;
  static bool on = true;
  if (!once) {
    const char *env = getenv("SCR_MAP_SHRINK");
    if (env != NULL && env[0] == '0' && env[1] == 0) on = false;
    once = true;
  }
  return on;
#endif
}

static void scr_map_sh_unlink(ScrMap *m) {
  if (!m->sh_queued) return;
  scr_map_sh.unlinked++;
  if (m->sh_prev) m->sh_prev->sh_next = m->sh_next;
  else scr_map_sh_head = m->sh_next;
  if (m->sh_next) m->sh_next->sh_prev = m->sh_prev;
  m->sh_prev = NULL;
  m->sh_next = NULL;
  m->sh_queued = 0;
}

/* Called where a map LOSES entries. Cheap and total: the policy check is
 * two comparisons, and a map that is not worth shrinking is never linked,
 * so the pass walks candidates rather than the heap. */
static void scr_map_sh_queue(ScrMap *m) {
  /* Already-queued is the COMMON case on a bulk delete -- the
   * self-test saw 1,998 requeue attempts against 1 queue for a
   * 4,000-entry drain -- so it is tested first, one load and one
   * branch, ahead of the policy comparisons and the knob.
   * Correct when disabled too: nothing is ever queued, so the flag
   * is always 0 and the knob check below still runs. */
  if (m->sh_queued) { scr_map_sh.requeued++; return; }
  if (!scr_map_shrink_on()) return;
  if (m->ecap <= SCR_MAP_SHRINK_MIN_ECAP) return;
  if (m->nlive > m->ecap / 2) return;
  m->sh_prev = NULL;
  m->sh_next = scr_map_sh_head;
  if (scr_map_sh_head) scr_map_sh_head->sh_prev = m;
  scr_map_sh_head = m;
  m->sh_queued = 1;
  scr_map_sh.queued++;
  /* Install the collector's between-turns hook here rather than from a
   * constructor. This is the first instant the pass has anything to do, so
   * there is no init-order question and no cost in a program that links
   * scr_map.c but never makes a map sparse. */
  scr_cyc_idle_hook = scr_map_idle_shrink;
}

static void scr_map_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* ── key normalization + hashing (SameValueZero) ───────────────────────
 * -0 normalizes to +0 (JS Map stores the +0 key: [...m.keys()] shows 0
 * after set(-0)) and every NaN collapses to one canonical bit pattern, so
 * hashing the bit pattern IS SameValueZero hashing. */

static uint64_t scr_map_f64_bits(double k) {
  if (k != k) return UINT64_C(0x7ff8000000000000); /* canonical NaN */
  if (k == 0) k = 0; /* -0 -> +0 */
  uint64_t bits;
  memcpy(&bits, &k, sizeof bits);
  return bits;
}

static uint64_t scr_map_fnv1a(const unsigned char *bytes, size_t n) {
  uint64_t h = UINT64_C(0xcbf29ce484222325);
  for (size_t i = 0; i < n; i++) {
    h ^= bytes[i];
    h *= UINT64_C(0x100000001b3);
  }
  return h;
}

static uint64_t scr_map_hash_str(const ScrStr *k) {
  return scr_map_fnv1a((const unsigned char *)k->data, k->len);
}

/* ── slot packing (8-byte slots, like ScrArr) ──────────────────────────── */

static uint64_t scr_map_slot_from_f64(double v) {
  uint64_t s;
  memcpy(&s, &v, sizeof s);
  return s;
}

static double scr_map_slot_to_f64(uint64_t s) {
  double v;
  memcpy(&v, &s, sizeof v);
  return v;
}

static uint64_t scr_map_slot_from_ptr(void *p) { return (uint64_t)(uintptr_t)p; }

static void *scr_map_slot_to_ptr(uint64_t s) { return (void *)(uintptr_t)s; }

/* Stored keys are pre-normalized, so bit equality IS SameValueZero for f64
 * keys (probe keys normalize through the same function). */
static bool scr_map_key_eq(const ScrMap *m, uint64_t stored, uint64_t probe) {
  /* f64 keys are pre-normalized and REF keys are pointers, so bit equality
   * IS the honest compare for both (SameValueZero; reference identity). */
  if (m->key_kind != SCR_MAP_KEY_STR) return stored == probe;
  return scr_str_eq((ScrStr *)scr_map_slot_to_ptr(stored),
                     (ScrStr *)scr_map_slot_to_ptr(probe));
}

/* ── lookup ────────────────────────────────────────────────────────────
 * Returns the LIVE entry index holding the key, or SCR_MAP_EMPTY. Probes
 * skip tombstoned entries (their bucket slots keep chains intact). */
static size_t scr_map_find(const ScrMap *m, uint64_t hash, uint64_t key) {
  if (m->nbuckets == 0) return SCR_MAP_EMPTY;
  size_t mask = m->nbuckets - 1;
  for (size_t i = hash & mask;; i = (i + 1) & mask) {
    uint32_t b = m->buckets[i];
    if (b == SCR_MAP_BUCKET_EMPTY) return SCR_MAP_EMPTY;
    if (m->live[b] && scr_map_key_eq(m, m->entries[b].key, key)) return b;
  }
}

/* Rebuild the bucket table (size must be a power of two >= 2 * nentries):
 * only live entries are inserted, in dense order — dead markers vanish. */
static void scr_map_rebuild_buckets(ScrMap *m, size_t nbuckets) {
  uint32_t *buckets = malloc(nbuckets * sizeof *buckets);
  if (!buckets) scr_map_oom();
  for (size_t i = 0; i < nbuckets; i++) buckets[i] = SCR_MAP_BUCKET_EMPTY;
  free(m->buckets);
  m->buckets = buckets;
  m->nbuckets = nbuckets;
  size_t mask = nbuckets - 1;
  for (size_t e = 0; e < m->nentries; e++) {
    if (!m->live[e]) continue;
    uint64_t hash = m->key_kind != SCR_MAP_KEY_STR
                        ? scr_map_fnv1a((const unsigned char *)&m->entries[e].key, 8)
                        : scr_map_hash_str((ScrStr *)scr_map_slot_to_ptr(m->entries[e].key));
    size_t i = hash & mask;
    while (buckets[i] != SCR_MAP_BUCKET_EMPTY) i = (i + 1) & mask;
    buckets[i] = (uint32_t)e;
  }
}

/* Drop tombstones, preserving insertion order. Only legal when no iteration
 * is active (the forEach desugar's indices would shift). */
static void scr_map_compact(ScrMap *m) {
  size_t w = 0;
  for (size_t r = 0; r < m->nentries; r++) {
    if (!m->live[r]) continue;
    m->entries[w] = m->entries[r];
    m->live[w] = 1;
    w++;
  }
  m->nentries = w;
  if (m->nbuckets > 0) scr_map_rebuild_buckets(m, m->nbuckets);
}

/* Shrink one visited map. Compaction first (it is what makes the tail
 * dead), then the three tables down to the next power of two that holds
 * the survivors. Returns true if anything was given back. */
static bool scr_map_shrink_one(ScrMap *m) {
  /* Index stability, not pointer stability: compaction renumbers entries
   * and an async iteration holds iter_depth across a loop turn. Skipped,
   * not dropped -- the map stays a candidate for a later pass. */
  if (m->iter_depth != 0) { scr_map_sh.skip_iter++; return false; }
  if (m->ecap <= SCR_MAP_SHRINK_MIN_ECAP) { scr_map_sh.skip_small++; return false; }

  if (m->nlive < m->nentries) scr_map_compact(m);

  size_t want = SCR_MAP_SHRINK_MIN_ECAP;
  while (want < m->nentries) want *= 2;
  /* Only a HALVING is worth the realloc and the bucket rebuild. */
  if (want > m->ecap / 2) { scr_map_sh.skip_dense++; return false; }

  size_t oldecap = m->ecap;
  size_t oldnb = m->nbuckets;

  ScrMapEntry *e2 = realloc(m->entries, want * sizeof *e2);
  if (e2 == NULL) { scr_map_sh.failed++; return false; }
  m->entries = e2;
  uint8_t *l2 = realloc(m->live, want * sizeof *l2);
  if (l2 == NULL) {
    /* entries already moved; ecap must describe the SMALLER of the two or
     * a later append walks off the live array. Take the shrink on entries
     * only and leave live oversized -- oversized is safe, undersized is
     * not. */
    m->ecap = want;
    scr_map_sh.failed++;
    scr_map_sh.ebytes += (unsigned long long)(oldecap - want) * sizeof *e2;
    scr_map_sh.shrunk++;
    return true;
  }
  m->live = l2;
  m->ecap = want;
  scr_map_sh.ebytes += (unsigned long long)(oldecap - want) * sizeof *e2;
  scr_map_sh.lbytes += (unsigned long long)(oldecap - want) * sizeof *l2;

  /* Buckets: the invariant scr_map_reserve_append relies on is
   * nbuckets >= 2 * (nentries + 1), so size for the new capacity and
   * never below it. rebuild_buckets already mallocs the new table and
   * frees the old, so the shrink is the same call with a smaller size. */
  size_t wantnb = 8;
  while (wantnb < 2 * (want + 1)) wantnb *= 2;
  if (wantnb < oldnb) {
    scr_map_rebuild_buckets(m, wantnb);
    scr_map_sh.bbytes += (unsigned long long)(oldnb - wantnb) * sizeof(uint32_t);
  }
  scr_map_sh.shrunk++;
  return true;
}

/* The between-turns pass. Drains the worklist; a map that cannot be
 * shrunk right now (an iteration is in flight) is re-queued so it is not
 * lost. Runs BEFORE scr_collect_cycles_idle's pace gate: this is not a
 * collection and must not be paced by the root count. */
void scr_map_idle_shrink(void) {
  scr_map_sh.turns++;
#if SCR_MAP_SHRINK_STAT
  /* THE REPORTER RUNS BEFORE THE EARLY RETURNS, and that is the point.
   * It used to sit below them, so it could only speak on a turn that
   * already had work -- meaning the NEVER RAN state it exists to
   * distinguish could never be printed, and a workload where no map goes
   * sparse produced NO FILE AT ALL. That is indistinguishable from a
   * broken instrument, and it cost a 40-minute zapo run to find. A
   * reporter downstream of the condition it reports on is not an
   * instrument. */
  scr_map_shrink_arm();
  scr_map_shrink_tick();
#endif
  if (!scr_map_shrink_on()) return;
  if (scr_map_sh_head == NULL) return;
  scr_map_sh.passes++;
  ScrMap *m = scr_map_sh_head;
  scr_map_sh_head = NULL;
  while (m != NULL) {
    ScrMap *next = m->sh_next;
    m->sh_prev = NULL;
    m->sh_next = NULL;
    m->sh_queued = 0;
    scr_map_sh.visited++;
    bool busy = (m->iter_depth != 0);
    scr_map_shrink_one(m);
    /* Only an ITERATION is a reason to come back; "nothing to give back"
     * is an answer, not a deferral, and re-queueing it would spin. */
    if (busy) scr_map_sh_queue(m);
    m = next;
  }
}

#if SCR_MAP_SHRINK_STAT
/* Diagnostic only, and OFF by default: this arm references atexit, which
 * is an ambient symbol that fails the library-mode audit (the same reason
 * scr_array.c's SCR_ARR_VM_STAT report is gated). Note also that a program
 * leaving through _Exit -- zapo-rest does -- skips atexit entirely, so on
 * that target read the counters from a test rather than from exit. */
#include <stdio.h>
void scr_map_shrink_report(const char *when) {
  FILE *f = stderr;
  const char *out = getenv("SCR_MAP_SHRINK_OUT");
  if (out != NULL) {
    FILE *g = fopen(out, "a");
    if (g != NULL) f = g;
  }
  fprintf(f, "[mapshrink] %s: ", when != NULL ? when : "(unnamed)");
  if (!scr_map_shrink_on()) {
    fprintf(f, "DISABLED -- SCR_MAP_SHRINK=0, the pass was compiled in and never armed\n");
  } else if (scr_map_sh.passes == 0) {
    fprintf(f, "NEVER RAN -- %lu idle turns, no pass did work (queued=%lu). "
               "Compiled in and armed; nothing became a shrink candidate. "
               "A zero byte delta says nothing about the mechanism.\n",
            scr_map_sh.turns, scr_map_sh.queued);
  } else if (scr_map_sh.shrunk == 0) {
    fprintf(f, "RAN AND NOTHING SHRANK -- passes=%lu visited=%lu "
               "skip_iter=%lu skip_small=%lu skip_dense=%lu failed=%lu\n",
            scr_map_sh.passes, scr_map_sh.visited, scr_map_sh.skip_iter,
            scr_map_sh.skip_small, scr_map_sh.skip_dense, scr_map_sh.failed);
  } else {
    fprintf(f, "SHRANK -- passes=%lu visited=%lu shrunk=%lu bytes=%llu "
               "(entries=%llu live=%llu buckets=%llu) "
               "queued=%lu requeued=%lu unlinked=%lu "
               "skip_iter=%lu skip_small=%lu skip_dense=%lu failed=%lu\n",
            scr_map_sh.passes, scr_map_sh.visited, scr_map_sh.shrunk,
            (scr_map_sh.ebytes + scr_map_sh.lbytes + scr_map_sh.bbytes), scr_map_sh.ebytes, scr_map_sh.lbytes,
            scr_map_sh.bbytes, scr_map_sh.queued, scr_map_sh.requeued,
            scr_map_sh.unlinked, scr_map_sh.skip_iter, scr_map_sh.skip_small,
            scr_map_sh.skip_dense, scr_map_sh.failed);
  }
  if (f != stderr) fclose(f);
}
static void scr_map_shrink_atexit(void) { scr_map_shrink_report("atexit"); }

/* PERIODIC REPORT, and it is not a nicety: zapo-rest leaves through _Exit,
 * which skips atexit, so an exit-only report produces NO FILE AT ALL on the
 * one target that matters -- silently. That already cost a run once, and
 * SCR_PAGECEN_EVERY=1 is the same workaround for the same reason.
 * SCR_MAP_SHRINK_EVERY=N reports every N passes that did work; the LAST
 * line written is then the answer, whether or not exit handlers run. */
static void scr_map_shrink_tick(void) {
  static long every = -1;
  if (every < 0) {
    const char *e = getenv("SCR_MAP_SHRINK_EVERY");
    every = (e != NULL) ? strtol(e, NULL, 10) : 0;
    if (every < 0) every = 0;
  }
  if (every == 0) return;
  /* Keyed on TURNS, not passes: passes can legitimately stay 0 for a whole
   * run, and 0 % n == 0 would then report on every idle turn rather than
   * never. */
  if ((scr_map_sh.turns % (unsigned long)every) != 0) return;
  scr_map_shrink_report("every");
}
static void scr_map_shrink_arm(void) {
  static bool armed = false;
  if (armed) return;
  armed = true;
  atexit(scr_map_shrink_atexit);
}
#endif

/* Make room to append one entry. Prefers compaction (tombstone-heavy maps
 * reuse their storage) and grows otherwise; while an iteration is active it
 * ONLY grows — indices must stay stable under callback mutation. */
static void scr_map_reserve_append(ScrMap *m) {
  if (m->nentries < m->ecap && m->nbuckets >= 2 * (m->nentries + 1)) return;
  if (m->iter_depth == 0 && m->nlive <= m->nentries / 2 && m->nentries > 0) {
    scr_map_compact(m);
  }
  if (m->nentries >= SCR_MAP_MAX_ENTRIES) scr_map_oom();
  if (m->nentries == m->ecap) {
    size_t cap = m->ecap ? m->ecap : 8;
    while (cap < m->nentries + 1) {
      if (cap > SIZE_MAX / 2 / sizeof(ScrMapEntry)) scr_map_oom();
      cap *= 2;
    }
    ScrMapEntry *entries = realloc(m->entries, cap * sizeof *entries);
    if (!entries) scr_map_oom();
    m->entries = entries;
    /* The liveness bytes carry the same dense index, so they grow in
     * lockstep. Only slots below nentries are ever read and
     * scr_map_insert writes the byte for the slot it appends, so the
     * fresh tail needs no initialization. */
    uint8_t *live = realloc(m->live, cap * sizeof *live);
    if (!live) scr_map_oom();
    m->live = live;
    m->ecap = cap;
  }
  if (m->nbuckets < 2 * (m->nentries + 1)) {
    size_t nbuckets = m->nbuckets ? m->nbuckets : 16;
    while (nbuckets < 2 * (m->nentries + 1)) {
      if (nbuckets > SIZE_MAX / 2 / sizeof(uint32_t)) scr_map_oom();
      nbuckets *= 2;
    }
    scr_map_rebuild_buckets(m, nbuckets);
  }
}

/* ── entry release helpers ─────────────────────────────────────────────── */

static void scr_map_release_key(ScrMap *m, uint64_t key) {
  if (m->key_kind == SCR_MAP_KEY_STR) {
    scr_str_release((ScrStr *)scr_map_slot_to_ptr(key));
  } else if (m->key_kind == SCR_MAP_KEY_REF) {
    m->key_release(scr_map_slot_to_ptr(key));
  }
}

static void scr_map_release_val(ScrMap *m, uint64_t val) {
  if (m->val_kind == SCR_MAP_VAL_REF) m->val_release(scr_map_slot_to_ptr(val));
}

/* ── lifecycle ─────────────────────────────────────────────────────────── */

/* Headered iff SOME side is cycle-capable: values (a Map of records) or
 * keys (a Set of them). Every collector hook keys off this, and it has to
 * be the same answer scr_cyc_alloc was given at construction. */
static inline bool scr_map_headered(const ScrMap *m) {
  return m->val_trace != NULL || m->key_trace != NULL;
}

static void scr_map_trace(void *o, ScrTraceVisit visit, void *ctx) {
  ScrMap *m = (ScrMap *)o;
  for (size_t e = 0; e < m->nentries; e++) {
    if (!m->live[e]) continue;
    /* Values only when the VALUE side is cycle-capable: a set's values are
     * bools, and slot_to_ptr over one is not a pointer. */
    if (m->val_trace) visit(scr_map_slot_to_ptr(m->entries[e].val), ctx);
    /* Keys when the KEY side is: a Set stores its elements here. */
    if (m->key_trace) visit(scr_map_slot_to_ptr(m->entries[e].key), ctx);
  }
}

/* Collector teardown: the trace already accounted every edge it visited,
 * so what this releases is the COMPLEMENT of the trace. Keys are in it
 * only while key_trace is NULL -- once the trace visits them, releasing
 * here would free them a second time. */
static void scr_map_gcfree(void *o) {
  ScrMap *m = (ScrMap *)o;
  if (!m->key_trace) {
    for (size_t e = 0; e < m->nentries; e++) {
      if (m->live[e]) scr_map_release_key(m, m->entries[e].key);
    }
  }
  scr_map_sh_unlink(m);
  free(m->entries);
  free(m->live);
  free(m->buckets);
#ifdef SCR_RC_AUDIT
  scr_live_maps--;
#endif
  scr_cyc_free(m);
}

ScrMap *scr_map_new(ScrMapKeyKind key_kind, ScrMapValKind val_kind,
                     void *(*val_retain)(void *), void (*val_release)(void *),
                     ScrTraceFn val_trace) {
  ScrMap *m;
  if (val_trace) {
    /* Cycle-capable values can point back: collector header + trace. */
    m = scr_cyc_alloc(sizeof *m, &scr_map_trace, &scr_map_gcfree);
  } else {
    m = calloc(1, sizeof *m);
    if (!m) scr_map_oom();
  }
  m->rc = 1;
  m->key_kind = key_kind;
  m->val_kind = val_kind;
  m->val_retain = val_retain;
  m->val_release = val_release;
  m->val_trace = val_trace;
#ifdef SCR_RC_AUDIT
  scr_live_maps++;
#endif
  return m;
}

ScrMap *scr_map_retain(ScrMap *m) {
  if (m->rc != SIZE_MAX) {
    m->rc++;
    if (scr_map_headered(m)) scr_cyc_mark_live(m);
  }
  return m;
}

void scr_map_release(ScrMap *m) {
  if (!m || m->rc == SIZE_MAX) return; /* NULL: an uninitialized `let` local */
  if (--m->rc == 0) {
    if (scr_map_headered(m)) scr_cyc_on_dead(m);
    for (size_t e = 0; e < m->nentries; e++) {
      if (!m->live[e]) continue;
      scr_map_release_key(m, m->entries[e].key);
      scr_map_release_val(m, m->entries[e].val);
    }
    scr_map_sh_unlink(m);
    free(m->entries);
    free(m->live);
    free(m->buckets);
#ifdef SCR_RC_AUDIT
    scr_live_maps--;
#endif
    if (scr_map_headered(m)) scr_cyc_free(m);
    else free(m);
  } else if (scr_map_headered(m)) {
    scr_cyc_on_release(m); /* possible cycle root; may collect — m is done */
  }
}

void *scr_map_retain_v(void *m) { return scr_map_retain((ScrMap *)m); }
void scr_map_release_v(void *m) { scr_map_release((ScrMap *)m); }
void scr_map_trace_v(void *m, ScrTraceVisit visit, void *ctx) {
  scr_map_trace(m, visit, ctx);
}

double scr_map_size(const ScrMap *m) { return (double)m->nlive; }

/* A RETENTION BUG IN ITS OWN RIGHT, and not a subclause of the idle
 * shrink below: clear() releases every key and value and sets nentries to
 * 0, but it FREES NOTHING. entries, live and buckets all keep the capacity
 * the map reached at its peak, for the life of the map. A reader of this
 * function would reasonably assume it frees -- `map.clear()` is the most
 * explicit thing a caller can say about no longer wanting the contents --
 * and it does not. A cleared 200,000-entry map holds roughly 4.8 MB of
 * tables afterwards (entries 3.2 MB, live 0.2, buckets 1.4).
 *
 * That is the user's complaint in miniature, inside our own runtime:
 * memory that never comes back after a burst. It is why clear() queues,
 * and the queue is the FIX rather than the description -- but the bug is
 * this function's, it predates the shrink, and it should be read as its
 * own defect. See tests/perf/mapshrink/README.md. */
void scr_map_clear(ScrMap *m) {
  for (size_t e = 0; e < m->nentries; e++) {
    if (!m->live[e]) continue;
    m->live[e] = 0;
    scr_map_release_key(m, m->entries[e].key);
    scr_map_release_val(m, m->entries[e].val);
  }
  m->nlive = 0;
  if (m->iter_depth == 0) {
    /* Full reset; an active iteration instead keeps the (now all-dead)
     * entries so its indices stay stable — entries added by the callback
     * after the clear append past them and ARE visited (Node-exact). */
    m->nentries = 0;
  }
  for (size_t i = 0; i < m->nbuckets; i++) m->buckets[i] = SCR_MAP_BUCKET_EMPTY;
  scr_map_sh_queue(m);
}

/* ── has / delete ──────────────────────────────────────────────────────── */

bool scr_map_has_f64(const ScrMap *m, double key) {
  uint64_t k = scr_map_f64_bits(key);
  return scr_map_find(m, scr_map_fnv1a((const unsigned char *)&k, 8), k) != SCR_MAP_EMPTY;
}

bool scr_map_has_str(const ScrMap *m, const ScrStr *key) {
  uint64_t k = scr_map_slot_from_ptr((void *)key);
  return scr_map_find(m, scr_map_hash_str(key), k) != SCR_MAP_EMPTY;
}

static bool scr_map_delete_found(ScrMap *m, size_t e) {
  if (e == SCR_MAP_EMPTY) return false;
  m->live[e] = 0; /* bucket slot stays: probe chains intact */
  m->nlive--;
  scr_map_release_key(m, m->entries[e].key);
  scr_map_release_val(m, m->entries[e].val);
  scr_map_sh_queue(m);
  return true;
}

bool scr_map_delete_f64(ScrMap *m, double key) {
  uint64_t k = scr_map_f64_bits(key);
  return scr_map_delete_found(m, scr_map_find(m, scr_map_fnv1a((const unsigned char *)&k, 8), k));
}

bool scr_map_delete_str(ScrMap *m, const ScrStr *key) {
  uint64_t k = scr_map_slot_from_ptr((void *)key);
  return scr_map_delete_found(m, scr_map_find(m, scr_map_hash_str(key), k));
}

/* REF keys: identity hashing over the pointer bits (see the header's
 * SCR_MAP_KEY_REF note). Probes never retain; storage does. */
static size_t scr_map_find_ref(const ScrMap *m, const void *key) {
  uint64_t k = scr_map_slot_from_ptr((void *)key);
  return scr_map_find(m, scr_map_fnv1a((const unsigned char *)&k, 8), k);
}

bool scr_map_has_ref(const ScrMap *m, const void *key) {
  return scr_map_find_ref(m, key) != SCR_MAP_EMPTY;
}

bool scr_map_delete_ref(ScrMap *m, const void *key) {
  return scr_map_delete_found(m, scr_map_find_ref(m, key));
}

/* ── set ───────────────────────────────────────────────────────────────
 * Overwrite keeps the entry (insertion position preserved, stored key kept
 * — only the value is replaced-and-released). A new key appends: reserve
 * space FIRST (compaction/growth may rebuild buckets), then probe for the
 * insertion slot. */

static void scr_map_set(ScrMap *m, uint64_t hash, uint64_t key, uint64_t val) {
  size_t e = scr_map_find(m, hash, key);
  if (e != SCR_MAP_EMPTY) {
    uint64_t old = m->entries[e].val;
    m->entries[e].val = val; /* unlink before releasing (cycle collector) */
    scr_map_release_val(m, old);
    return;
  }
  scr_map_reserve_append(m);
  size_t idx = m->nentries++;
  m->entries[idx].key = key;
  m->entries[idx].val = val;
  m->live[idx] = 1;
  m->nlive++;
  if (m->key_kind == SCR_MAP_KEY_STR) {
    scr_str_retain((ScrStr *)scr_map_slot_to_ptr(key)); /* key is borrowed */
  } else if (m->key_kind == SCR_MAP_KEY_REF) {
    m->key_retain(scr_map_slot_to_ptr(key)); /* key is borrowed */
  }
  size_t mask = m->nbuckets - 1;
  size_t i = hash & mask;
  while (m->buckets[i] != SCR_MAP_BUCKET_EMPTY) i = (i + 1) & mask;
  m->buckets[i] = (uint32_t)idx;
}

static void scr_map_set_f64_key(ScrMap *m, double key, uint64_t val) {
  uint64_t k = scr_map_f64_bits(key); /* stores +0 for -0, canonical NaN */
  scr_map_set(m, scr_map_fnv1a((const unsigned char *)&k, 8), k, val);
}

static void scr_map_set_str_key(ScrMap *m, ScrStr *key, uint64_t val) {
  scr_map_set(m, scr_map_hash_str(key), scr_map_slot_from_ptr(key), val);
}

void scr_map_set_f64_f64(ScrMap *m, double key, double v) {
  scr_map_set_f64_key(m, key, scr_map_slot_from_f64(v));
}

void scr_map_set_f64_bool(ScrMap *m, double key, bool v) {
  scr_map_set_f64_key(m, key, (uint64_t)(v ? 1 : 0));
}

void scr_map_set_f64_ref(ScrMap *m, double key, void *v) {
  scr_map_set_f64_key(m, key, scr_map_slot_from_ptr(v));
}

void scr_map_set_str_f64(ScrMap *m, ScrStr *key, double v) {
  scr_map_set_str_key(m, key, scr_map_slot_from_f64(v));
}

void scr_map_set_str_bool(ScrMap *m, ScrStr *key, bool v) {
  scr_map_set_str_key(m, key, (uint64_t)(v ? 1 : 0));
}

void scr_map_set_str_ref(ScrMap *m, ScrStr *key, void *v) {
  scr_map_set_str_key(m, key, scr_map_slot_from_ptr(v));
}

void scr_map_set_ref_f64(ScrMap *m, void *key, double v) {
  uint64_t k = scr_map_slot_from_ptr(key);
  scr_map_set(m, scr_map_fnv1a((const unsigned char *)&k, 8), k, scr_map_slot_from_f64(v));
}

/* REF-KEY maps: the key is a refcounted pointer hashed and compared by
 * IDENTITY (SCR_MAP_KEY_REF), which is exactly JS object-key semantics —
 * SameValueZero on references. Sets have used the kind since it existed;
 * these are the Map half, mirroring the _str_ family one for one. */
static void scr_map_set_ref_key(ScrMap *m, void *key, uint64_t val) {
  uint64_t k = scr_map_slot_from_ptr(key);
  scr_map_set(m, scr_map_fnv1a((const unsigned char *)&k, 8), k, val);
}

void scr_map_set_ref_bool(ScrMap *m, void *key, bool v) {
  scr_map_set_ref_key(m, key, (uint64_t)(v ? 1 : 0));
}

void scr_map_set_ref_ref(ScrMap *m, void *key, void *v) {
  scr_map_set_ref_key(m, key, scr_map_slot_from_ptr(v));
}

bool scr_map_get_ref_f64(const ScrMap *m, const void *key, double *out) {
  size_t e = scr_map_find_ref(m, key);
  if (e == SCR_MAP_EMPTY) return false;
  *out = scr_map_slot_to_f64(m->entries[e].val);
  return true;
}

bool scr_map_get_ref_bool(const ScrMap *m, const void *key, bool *out) {
  size_t e = scr_map_find_ref(m, key);
  if (e == SCR_MAP_EMPTY) return false;
  *out = m->entries[e].val != 0;
  return true;
}

void *scr_map_get_ref_ref(const ScrMap *m, const void *key) {
  size_t e = scr_map_find_ref(m, key);
  if (e == SCR_MAP_EMPTY) return NULL;
  return m->val_retain(scr_map_slot_to_ptr(m->entries[e].val)); /* +1 */
}

/* The ref-key constructor: scr_set_new_ref's twin with a real VALUE side. */
ScrMap *scr_map_new_ref(ScrMapValKind val_kind, void *(*key_retain)(void *),
                        void (*key_release)(void *), void *(*val_retain)(void *),
                        void (*val_release)(void *), ScrTraceFn val_trace) {
  ScrMap *m = scr_map_new(SCR_MAP_KEY_REF, val_kind, val_retain, val_release, val_trace);
  m->key_retain = key_retain;
  m->key_release = key_release;
  return m;
}

ScrMap *scr_set_new_ref(void *(*elem_retain)(void *), void (*elem_release)(void *)) {
  ScrMap *m = scr_map_new(SCR_MAP_KEY_REF, SCR_MAP_VAL_F64, NULL, NULL, NULL);
  m->key_retain = elem_retain;
  m->key_release = elem_release;
  return m;
}

ScrMap *scr_set_new_ref_traced(void *(*elem_retain)(void *), void (*elem_release)(void *),
                               ScrTraceFn elem_trace) {
  /* Headered allocation: scr_map_new keys that off val_trace, and a set has
   * no value side, so the header is taken here and the trace hooked after. */
  ScrMap *m = scr_cyc_alloc(sizeof *m, &scr_map_trace, &scr_map_gcfree);
  m->rc = 1;
  m->key_kind = SCR_MAP_KEY_REF;
  m->val_kind = SCR_MAP_VAL_F64;
  m->key_retain = elem_retain;
  m->key_release = elem_release;
  m->key_trace = elem_trace;
#ifdef SCR_RC_AUDIT
  scr_live_maps++;
#endif
  return m;
}

/* ── get ───────────────────────────────────────────────────────────────── */

static size_t scr_map_find_f64(const ScrMap *m, double key) {
  uint64_t k = scr_map_f64_bits(key);
  return scr_map_find(m, scr_map_fnv1a((const unsigned char *)&k, 8), k);
}

static size_t scr_map_find_str(const ScrMap *m, const ScrStr *key) {
  return scr_map_find(m, scr_map_hash_str(key), scr_map_slot_from_ptr((void *)key));
}

bool scr_map_get_f64_f64(const ScrMap *m, double key, double *out) {
  size_t e = scr_map_find_f64(m, key);
  if (e == SCR_MAP_EMPTY) return false;
  *out = scr_map_slot_to_f64(m->entries[e].val);
  return true;
}

bool scr_map_get_f64_bool(const ScrMap *m, double key, bool *out) {
  size_t e = scr_map_find_f64(m, key);
  if (e == SCR_MAP_EMPTY) return false;
  *out = m->entries[e].val != 0;
  return true;
}

void *scr_map_get_f64_ref(const ScrMap *m, double key) {
  size_t e = scr_map_find_f64(m, key);
  if (e == SCR_MAP_EMPTY) return NULL;
  return m->val_retain(scr_map_slot_to_ptr(m->entries[e].val)); /* +1 */
}

bool scr_map_get_str_f64(const ScrMap *m, const ScrStr *key, double *out) {
  size_t e = scr_map_find_str(m, key);
  if (e == SCR_MAP_EMPTY) return false;
  *out = scr_map_slot_to_f64(m->entries[e].val);
  return true;
}

bool scr_map_get_str_bool(const ScrMap *m, const ScrStr *key, bool *out) {
  size_t e = scr_map_find_str(m, key);
  if (e == SCR_MAP_EMPTY) return false;
  *out = m->entries[e].val != 0;
  return true;
}

void *scr_map_get_str_ref(const ScrMap *m, const ScrStr *key) {
  size_t e = scr_map_find_str(m, key);
  if (e == SCR_MAP_EMPTY) return NULL;
  return m->val_retain(scr_map_slot_to_ptr(m->entries[e].val)); /* +1 */
}

/* ── iteration primitives (the forEach desugar) ────────────────────────── */

double scr_map_iter_count(const ScrMap *m) { return (double)m->nentries; }

bool scr_map_iter_live(const ScrMap *m, double i) {
  if (!(i >= 0) || i >= (double)m->nentries) return false;
  return m->live[(size_t)i];
}

static const ScrMapEntry *scr_map_iter_at(const ScrMap *m, double i) {
  if (!(i >= 0) || i >= (double)m->nentries || !m->live[(size_t)i]) {
    scr_trap("scriptc: internal error: map iteration index out of range\n");
  }
  return &m->entries[(size_t)i];
}

double scr_map_iter_key_f64(const ScrMap *m, double i) {
  return scr_map_slot_to_f64(scr_map_iter_at(m, i)->key);
}

ScrStr *scr_map_iter_key_str(const ScrMap *m, double i) {
  return scr_str_retain((ScrStr *)scr_map_slot_to_ptr(scr_map_iter_at(m, i)->key));
}

void *scr_map_iter_key_ref(const ScrMap *m, double i) {
  return m->key_retain(scr_map_slot_to_ptr(scr_map_iter_at(m, i)->key)); /* +1 */
}

double scr_map_iter_val_f64(const ScrMap *m, double i) {
  return scr_map_slot_to_f64(scr_map_iter_at(m, i)->val);
}

bool scr_map_iter_val_bool(const ScrMap *m, double i) {
  return scr_map_iter_at(m, i)->val != 0;
}

void *scr_map_iter_val_ref(const ScrMap *m, double i) {
  return m->val_retain(scr_map_slot_to_ptr(scr_map_iter_at(m, i)->val)); /* +1 */
}

void scr_map_iter_enter(ScrMap *m) { m->iter_depth++; }

void scr_map_iter_exit(ScrMap *m) {
  if (m->iter_depth > 0) m->iter_depth--;
  /* A churny callback may have left many tombstones; with no iteration
   * active they are safe to drop now (bounds memory under forEach-heavy
   * add/delete workloads). */
  if (m->iter_depth == 0 && m->nlive <= m->nentries / 2 && m->nentries >= 16) {
    scr_map_compact(m);
  }
}

/* ── seeded Set construction ───────────────────────────────────────────── */

/* `new Set(values)`: add() every element of one borrowed T[] in order —
 * duplicates overwrite the unit value in place, so first insertion
 * position wins (SameValueZero, exactly JS). The map is a set (value kind
 * pinned to f64, every stored value 0); elements are the set's key kind —
 * f64 or string, matching the array's element kind. */
void scr_set_add_all(ScrMap *set, ScrArr *values) {
  size_t n = values->len;
  for (size_t i = 0; i < n; i++) {
    if (values->elem == SCR_ELEM_STR) {
      ScrStr *s = (ScrStr *)scr_arr_get_ref(values, (double)i); /* +1 */
      scr_map_set_str_f64(set, s, 0);                           /* borrows; retains stored copy */
      scr_str_release(s);
    } else if (set->key_kind == SCR_MAP_KEY_REF) {
      void *p = scr_arr_get_ref(values, (double)i); /* +1 */
      scr_map_set_ref_f64(set, p, 0);               /* borrows; retains stored copy */
      set->key_release(p);
    } else {
      scr_map_set_f64_f64(set, scr_arr_get_f64(values, (double)i), 0);
    }
  }
}

/* ── JS own-key ordering over the overflow map ─────────────────────────── */

/* Canonical array index test: "0".."4294967294" — digits only, no leading
 * zero (except "0" itself), value <= 2^32 - 2. JS orders these OWN keys
 * first, ascending numerically, before every other string key. */
static bool scr_map_key_array_index(const ScrStr *k, uint32_t *out) {
  size_t n = k->len;
  if (n == 0 || n > 10) return false;
  const char *s = k->data;
  if (s[0] == '0' && n > 1) return false;
  uint64_t v = 0;
  for (size_t i = 0; i < n; i++) {
    if (s[i] < '0' || s[i] > '9') return false;
    v = v * 10 + (uint64_t)(s[i] - '0');
  }
  if (v > UINT64_C(4294967294)) return false;
  *out = (uint32_t)v;
  return true;
}

/* The live STRING keys of `m` in JS OWN-KEY ORDER (Object.keys over the
 * index-signature overflow): integer-like keys (canonical array indices)
 * first in ascending numeric order, then the rest in insertion order.
 * Returns a fresh ScrStr* array (+1); the map is borrowed. Insertion sort
 * over the integer-like subset — overflow maps are small, and ties are
 * impossible (keys are unique). */
ScrArr *scr_map_keys_js_order(const ScrMap *m) {
#ifdef SCR_ARRCEN_ON
  scr_arrcen_note(SCR_ARRCEN_MAPKEYS, (long long)m->nlive);
#endif
  size_t n = m->nentries;
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, m->nlive);
  size_t nidx = 0;
  struct { uint32_t v; ScrStr *k; } *idx = NULL;
  for (size_t i = 0; i < n; i++) {
    if (!m->live[i]) continue;
    ScrStr *k = (ScrStr *)scr_map_slot_to_ptr(m->entries[i].key);
    uint32_t v;
    if (!scr_map_key_array_index(k, &v)) continue;
    if (nidx % 16 == 0) {
      idx = realloc(idx, (nidx + 16) * sizeof *idx);
      if (!idx) scr_map_oom();
    }
    size_t j = nidx++;
    while (j > 0 && idx[j - 1].v > v) {
      idx[j] = idx[j - 1];
      j--;
    }
    idx[j].v = v;
    idx[j].k = k;
  }
  for (size_t i = 0; i < nidx; i++) {
    scr_arr_push_ref(out, scr_str_retain(idx[i].k));
  }
  free(idx);
  for (size_t i = 0; i < n; i++) {
    if (!m->live[i]) continue;
    ScrStr *k = (ScrStr *)scr_map_slot_to_ptr(m->entries[i].key);
    uint32_t v;
    if (scr_map_key_array_index(k, &v)) continue;
    scr_arr_push_ref(out, scr_str_retain(k));
  }
  return out;
}

/* The map's LIVE ENTRY SLOTS in the same JS own-key order
 * scr_map_keys_js_order answers (canonical array indices ascending first,
 * then the rest in insertion order) - an f64 array of indices the
 * scr_map_iter_* accessors take. A compiler-generated record walker uses it
 * to read a key AND its value out of ONE entry, instead of snapshotting the
 * keys and looking each one back up: an entry read has no miss to answer,
 * so such a walker never reaches the by-key helper's "record has no key"
 * trap. Every index pushed is LIVE, so scr_map_iter_at cannot trap either.
 * Borrows m; returns a +1 f64 array. */
ScrArr *scr_map_slots_js_order(const ScrMap *m) {
  size_t n = m->nentries;
  ScrArr *out = scr_arr_new(SCR_ELEM_F64, m->nlive);
  size_t nidx = 0;
  struct { uint32_t v; size_t i; } *idx = NULL;
  for (size_t i = 0; i < n; i++) {
    if (!m->live[i]) continue;
    ScrStr *k = (ScrStr *)scr_map_slot_to_ptr(m->entries[i].key);
    uint32_t v;
    if (!scr_map_key_array_index(k, &v)) continue;
    if (nidx % 16 == 0) {
      idx = realloc(idx, (nidx + 16) * sizeof *idx);
      if (!idx) scr_map_oom();
    }
    size_t j = nidx++;
    while (j > 0 && idx[j - 1].v > v) {
      idx[j] = idx[j - 1];
      j--;
    }
    idx[j].v = v;
    idx[j].i = i;
  }
  for (size_t i = 0; i < nidx; i++) {
    scr_arr_push_f64(out, (double)idx[i].i);
  }
  free(idx);
  for (size_t i = 0; i < n; i++) {
    if (!m->live[i]) continue;
    ScrStr *k = (ScrStr *)scr_map_slot_to_ptr(m->entries[i].key);
    uint32_t v;
    if (scr_map_key_array_index(k, &v)) continue;
    scr_arr_push_f64(out, (double)i);
  }
  return out;
}
