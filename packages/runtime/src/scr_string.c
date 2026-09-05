#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* Live heap-string count for the RC audit lane (-DSCR_RC_AUDIT): the test
 * harness builds with it to prove the emitted retain/release discipline
 * leaks nothing and frees nothing twice (double-free shows up as ASan
 * use-after-free on the rc field or a negative count here). */
#ifdef SCR_RC_AUDIT
static long scr_live_strings = 0;
/* THE OBSERVER DRAINS THE CONTENT-INTERN TABLE FIRST, and that is the whole
 * re-statement of this counter's contract under interning.
 *
 * What it counted before interning: live heap-string OBJECTS, which was the
 * same number as "strings the program can still reach", because the runtime
 * held no string of its own. Interning breaks that equality in one
 * direction only -- the table is an extra OWNING reference, so a string the
 * program has finished with can still be an object. It is never the other
 * way round: the table cannot make a reachable string unreachable.
 *
 * So the two numbers are "objects" and "objects the program can reach", and
 * this function answers the SECOND, by dropping the table before it looks.
 * That keeps every assertion written against it literally true -- `strings0
 * + 4`, "aa and bb released, cc and dd shared", "no strings leaked", and
 * scr_console.c's atexit audit -- and it keeps them MEANING what they said,
 * which deleting them or slackening them to an inequality would not.
 *
 * The first number is not lost: scr_str_live_objects() below reports it
 * undrained, and packages/runtime/test/test_intern.c asserts the gap between
 * the two is exactly the table's holdings. A test that could not see the
 * gap would be a test that cannot tell interning from its absence. */
long scr_str_live_count(void) {
  scr_str_intern_drain();
  return scr_live_strings;
}
/* Undrained: live string OBJECTS, table holdings included. */
long scr_str_live_objects(void) { return scr_live_strings; }
#endif

static void scr_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* ── UTF-16 index cache ───────────────────────────────────────────────
 * JS string semantics are UTF-16 indices over our UTF-8 storage, so
 * .length, charCodeAt, charAt, indexOf and slice all need unit↔byte
 * conversions. Computed from scratch each is O(len), which turns the
 * canonical `for (i = 0; i < s.length; i++) s.charCodeAt(i)` loop into
 * O(len²). This small direct cache remembers, per recently-touched string,
 * the UTF-16 length (computed once) and one unit↔byte cursor that walking
 * code advances incrementally — sequential scans in either direction
 * become O(1) amortized per access.
 *
 * Correctness: entries are keyed by pointer, so any path that frees a
 * string MUST purge its entry (all frees go through scr_str_release) and
 * the in-place concat below invalidates the cached length (the prefix —
 * and therefore the cursor — stays valid). Strings are immutable in every
 * other respect. The runtime is single-threaded by design.
 */
#define SCR_SIDX_N 4
#define SCR_U16_UNKNOWN SIZE_MAX
typedef struct {
  const ScrStr *s; /* NULL = empty slot */
  size_t u16len;   /* SCR_U16_UNKNOWN until computed */
  size_t cu, cb;   /* cursor: byte offset cb starts the char at unit cu */
} ScrSidx;
static ScrSidx scr_sidx_tab[SCR_SIDX_N];
static unsigned scr_sidx_clock;

static void scr_sidx_purge(const ScrStr *s) {
  for (int i = 0; i < SCR_SIDX_N; i++) {
    if (scr_sidx_tab[i].s == s) scr_sidx_tab[i].s = NULL;
  }
}

static ScrSidx *scr_sidx(const ScrStr *s) {
  for (int i = 0; i < SCR_SIDX_N; i++) {
    if (scr_sidx_tab[i].s == s) return &scr_sidx_tab[i];
  }
  ScrSidx *e = &scr_sidx_tab[scr_sidx_clock++ % SCR_SIDX_N];
  e->s = s;
  e->u16len = SCR_U16_UNKNOWN;
  e->cu = 0;
  e->cb = 0;
  return e;
}

/* Slack handed to a concat whose LEFT side is SHARED and whose result is
 * short, so the next link of an `a + b + c` chain can append in place.
 * 0 disables it, which is what the ablation control is built with.
 *
 * 8 was measured against 16 and 32, not chosen, and the choice is a TRADE
 * rather than a free win. At identical fixed work on the messaging bench's
 * SEND group (1,500,000 map sets on both sides, and scr_str_concat /
 * scr_str_release / scr_map_set call counts BIT-IDENTICAL so nothing was
 * skipped) the exact instrument counts, slack 16 against none:
 *     scr_str_alloc   4,542,077 -> 3,041,069   (-1,501,008, -33.0%)
 * exactly ONE allocation removed per inner iteration, plus the
 * scr_sidx_purge and scr_str_take_spare that ride on it.
 *
 * Timing, isolated, 15 alternating runs, machine quiet, A/A control quoted:
 *   SEND group   slack 8  1.115x wall  1.1036x CPU  peak RSS 1.1032x BETTER
 *                slack 16 1.123x       1.1152x                1.1067x
 *                A/A      1.033x       1.0290x                0.9998x
 *   SEND 1:1     slack 8  0.977x wall  0.9792x CPU  peak RSS 0.9305x WORSE
 *                slack 16 0.954x       0.9592x                0.9308x
 *                A/A      0.983x       0.9792x                1.0000x
 *
 * So 8 buys SEND group's win at a CPU cost on SEND 1:1 that is IDENTICAL
 * to the A/A control (0.9792 both), where 16 costs a further 4.1% there.
 * The peak-RSS cost is the same for both and is real: the digest strings
 * SEND 1:1 stores carry the slack, +7.5% on that scenario, against -10%
 * on SEND group, whose stored key is no longer the 1.5x-grown copy.
 * Whole-bench peak RSS moves 92,506 -> 90,890 KiB, i.e. down. 32 measured
 * no better on either scenario and costs more capacity per string. */
#ifndef SCR_STR_CHAIN_SLACK
#define SCR_STR_CHAIN_SLACK 8
#endif

/* The arena's counters, tests/perf/cycstat/scr_cyc_stat.h's, which already
 * carries the cycle arena's five. With that header absent every hook below
 * is nothing at all, so an uninstrumented build carries no instruction of
 * it -- the same contract scr_cycle.c states for the same macros. They are
 * the POSITIVE CONTROL for this arena: a carve is invisible to any malloc
 * interposer, because no malloc happens, so "the residency profile moved"
 * and "the arena ran" are two claims and only one of them has a counter. */
#ifndef SCR_CS_BUMP
#define SCR_CS_BUMP(which) ((void)0)
#endif
#ifndef SCR_CS_ARM
#define SCR_CS_ARM() ((void)0)
#endif

/* ── allocation ─────────────────────────────────────────────────────── */

/* Blocks freed by scr_str_release come back here instead of going to the
 * CRT. Every string this file allocates and every string it frees goes
 * through these two functions, so the pool is self-consistent by
 * construction: a block is only ever given back to the class its own
 * `cap` puts it in, and `cap` is the field the size was computed from.
 *
 * This is the one line the previous block's allocation profile named:
 * scr_string.c:68 was 85.6% of every allocation and 92.5% of every byte
 * on the messaging workload, at a mean of 76 bytes - squarely inside the
 * pool's range and nowhere near the 512-byte floor of the one-slot spare
 * block below, which is why the spare could never touch it. */
static ScrPool scr_str_blocks;

#ifdef SCR_POOLSTAT_ON
__attribute__((constructor)) static void scr_poolstat_reg_string(void) {
  scr_poolstat_name(&scr_str_blocks, "str");
}
#endif

/* ── CONTENT INTERNING ────────────────────────────────────────────────
 * WHAT IT IS FOR. The census of the real messaging bench (SCR_STRCEN_ON)
 * says the live heap-string population at its high-water mark is 541,092
 * strings, and that only 20,322 of the 456,257 the walk reads are
 * DISTINCT -- 95.55% of the live population is byte-equal to another live
 * string. That is 41% of the whole live heap duplicated. No allocator
 * change can touch it; only not making the copy can. It is not a few hot
 * strings either: the top 24 contents hold 1.72% of the peak, and the
 * count scales as group_members x messages, one retained JID copy per
 * (group message x recipient) out of send_group's fanout.
 *
 * THE SHAPE. A fixed-size SET-ASSOCIATIVE cache of OWNING references, not
 * a table with eviction sweeps. Two properties carry it:
 *
 *   OWNING. An entry always has rc >= 1 from the table, so an interned
 *   string can never be seen with rc == 1 by scr_str_concat's in-place
 *   arm or by scr_str_regrow (whose contract is rc == 1 and whose only
 *   caller is the JSON builder's own buffer, never a concat result). The
 *   one way interning could corrupt a value -- mutating a string the
 *   table still points at -- cannot arise. It is the whole safety
 *   argument, and it is a property of the DATA, not of a review of the
 *   call sites.
 *
 *   SET-ASSOCIATIVE, WITH ADMISSION BY rc. A direct-mapped table was
 *   MEASURED and rejected: 156.68-181.20 MiB across six runs of the same
 *   arm, a 15.6% spread where every other arm held inside 1.2%, because
 *   whichever two hot contents happened to collide decided the run. Ways
 *   alone do not fix that -- a cold stream still walks a full set. So the
 *   victim is the LEAST-REFERENCED way, and a set whose every way is
 *   still referenced by the PROGRAM (rc > 1) refuses the newcomer
 *   entirely. rc == 1 means "the table is the only thing holding this",
 *   i.e. dead weight, and dead weight is all the table ever gives up. A
 *   hot entry is therefore never evicted by a cold one, and which two
 *   contents collide stops deciding anything.
 *
 * WAYS IS A RUNTIME KNOB, and that is deliberate: SCR_STRING_INTERN_WAYS=1
 * turns this back into exactly the direct-mapped table, in the SAME image
 * with the same hash and the same array, so the spread claim above is an
 * A/B and not a comparison across binaries. It is also the POSITIVE
 * CONTROL for the counters -- see scr_cs_sievict / scr_cs_sirefuse in
 * tests/perf/cycstat/scr_cyc_stat.h: on ways 1 the eviction counter must
 * be enormous, and a build where it reads small on BOTH settings is a
 * broken instrument, not a well-behaved cache.
 *
 * Only scr_str_concat's copy path is hooked, because that is where the
 * measured population is born, and because a narrow hook is a narrow blast
 * radius. Nothing that builds a string by any other route -- slice,
 * Buffer.toString, the JSON builder, scr_str_alloc_raw's nine call sites --
 * can reach the table at all. MINLEN keeps chain INTERMEDIATES out:
 * `"5511" + digits` is 14 bytes and is not a value anyone stores, and
 * interning it would only cost the next link its in-place append.
 *
 * IT IS COMPILED IN UNDER SCR_RC_AUDIT, unlike the pool, the spare block
 * and the arena. Those three are compiled out because that lane exists to
 * prove every logical free is a real free and ASan can only see that if
 * the free reaches the CRT -- an argument about WHERE a block goes. A
 * table that holds references across the whole run is a different thing:
 * it is a LIFETIME shape, and a lifetime shape that the lifetime lane does
 * not run is a lifetime shape nothing checks. So it runs there, and
 * scr_str_live_count drains the table before answering -- see the note on
 * that function. */
#ifndef SCR_STR_INTERN
#define SCR_STR_INTERN 1
#endif
#ifndef SCR_STR_INTERN_BITS
#define SCR_STR_INTERN_BITS 16
#endif
#define SCR_STR_INTERN_SLOTS (1u << SCR_STR_INTERN_BITS)
/* 4, over 16,384 sets for the bench's 20,322 distinct live contents: mean
 * occupancy 1.24 per set, so a Poisson tail puts ~1.2% of sets at four or
 * more and the refusal counter can be read against that. 1 is the
 * direct-mapped control. */
#ifndef SCR_STR_INTERN_WAYS
#define SCR_STR_INTERN_WAYS 4
#endif
#ifndef SCR_STR_INTERN_MINLEN
#define SCR_STR_INTERN_MINLEN 16
#endif
#ifndef SCR_STR_INTERN_MAXLEN
#define SCR_STR_INTERN_MAXLEN 128
#endif

static ScrStr *scr_str_itab[SCR_STR_INTERN_SLOTS];
/* Non-NULL slots. Only so the drain below can be O(1) when nothing was ever
 * interned: a table-wide scan would otherwise fault in all 512 KiB of BSS
 * in a program that never made a single concat in the band. */
static size_t scr_str_itab_used;

static int scr_str_intern_on(void) {
  static int cached = -1;
  SCR_CS_ARM();
  if (cached < 0) {
    const char *env = getenv("SCR_STRING_INTERN");
    cached = env != NULL ? (strtol(env, NULL, 10) != 0) : (SCR_STR_INTERN != 0);
  }
  return cached;
}

/* Ways, clamped to a power of two in [1, 64] that divides the table. An
 * unparseable or out-of-range value falls back to the compiled default
 * rather than to 1: a typo must not silently select the arm this cache
 * exists to avoid. */
static unsigned scr_str_intern_ways(void) {
  static unsigned cached = 0;
  if (cached == 0) {
    unsigned w = (unsigned)SCR_STR_INTERN_WAYS;
    const char *env = getenv("SCR_STRING_INTERN_WAYS");
    if (env != NULL) {
      long v = strtol(env, NULL, 10);
      if (v >= 1 && v <= 64 && (v & (v - 1)) == 0) w = (unsigned)v;
    }
    if (w > SCR_STR_INTERN_SLOTS) w = SCR_STR_INTERN_SLOTS;
    cached = w;
  }
  return cached;
}

/* Admission: 1 = a set gives up only a way the PROGRAM has finished with
 * (rc == 1), 0 = a miss always evicts the least-referenced way. This is a
 * SECOND knob and not folded into ways for one reason: the table that
 * thrashed was direct-mapped AND unconditionally evicting, and those are two
 * changes. With them separate, WAYS=1 ADMIT=0 reproduces that table exactly,
 * in the same image, so the variance this cache was rebuilt to remove can be
 * attributed to one of them rather than to "the rewrite". */
static int scr_str_intern_admit(void) {
  static int cached = -1;
  if (cached < 0) {
    const char *env = getenv("SCR_STRING_INTERN_ADMIT");
    cached = env != NULL ? (strtol(env, NULL, 10) != 0) : 1;
  }
  return cached;
}

/* FNV-1a over the CONCATENATION of two spans, without forming it. */
static unsigned scr_str_ihash(const char *x, size_t nx, const char *y, size_t ny) {
  unsigned long long h = 1469598103934665603ULL;
  size_t i;
  for (i = 0; i < nx; i++) { h ^= (unsigned char)x[i]; h *= 1099511628211ULL; }
  for (i = 0; i < ny; i++) { h ^= (unsigned char)y[i]; h *= 1099511628211ULL; }
  h ^= (unsigned long long)(nx + ny) * 2654435761ULL;
  h ^= h >> 32;
  return (unsigned)h & (SCR_STR_INTERN_SLOTS - 1u);
}

/* A RETAINED string with these bytes if the cache holds one, else NULL.
 * *slot is always written with the SET BASE: a miss still names where a put
 * would look, so the caller hashes once. */
static ScrStr *scr_str_intern_get(const char *x, size_t nx, const char *y,
                                  size_t ny, unsigned *slot) {
  unsigned w = scr_str_intern_ways();
  unsigned base = scr_str_ihash(x, nx, y, ny) & ~(w - 1u);
  unsigned i;
  *slot = base;
  for (i = 0; i < w; i++) {
    ScrStr *e = scr_str_itab[base + i];
    if (e == NULL) continue;
    if ((size_t)e->len != nx + ny) continue;
    /* rc is 32 bits and UINT32_MAX is the immortal marker. Half of it is
     * more references than any real program holds (the bench's measured
     * maximum is 1,001), and stopping there means the counter can never
     * reach the marker by sharing. */
    if (e->rc > (SCR_STR_IMMORTAL >> 1)) continue;
    if (nx != 0 && memcmp(e->data, x, nx) != 0) continue;
    if (ny != 0 && memcmp(e->data + nx, y, ny) != 0) continue;
    e->rc++;
    SCR_CS_BUMP(sihit);
    return e;
  }
  SCR_CS_BUMP(simiss);
  return NULL;
}

/* Offer s to the set at `base`. Takes an empty way; failing that, evicts the
 * least-referenced way, but ONLY when that way is table-only (rc == 1). A
 * set every one of whose ways the program still holds keeps them all and s
 * is simply not cached -- see the admission note above. */
static void scr_str_intern_put(unsigned base, ScrStr *s) {
  unsigned w = scr_str_intern_ways();
  unsigned i, victim = base;
  uint32_t best = UINT32_MAX;
  for (i = 0; i < w; i++) {
    ScrStr *e = scr_str_itab[base + i];
    if (e == NULL) {
      s->rc++; /* the table's OWN reference; see the note on rc >= 1 above */
      scr_str_itab[base + i] = s;
      scr_str_itab_used++;
      SCR_CS_BUMP(siput);
      return;
    }
    if (e->rc < best) { best = e->rc; victim = base + i; }
  }
  if (best != 1 && scr_str_intern_admit()) {
    /* every way is still referenced by the program */
    SCR_CS_BUMP(sirefuse);
    return;
  }
  {
    ScrStr *e = scr_str_itab[victim];
    s->rc++;
    scr_str_itab[victim] = s;
    SCR_CS_BUMP(siput);
    SCR_CS_BUMP(sievict);
    scr_str_release(e);
  }
}

/* Drop every reference the table holds. A cache reference is not a program
 * reference: dropping the whole table can change WHEN a string is freed and
 * can never change any value, because an entry is byte-equal to whatever the
 * next miss will build. This is what makes scr_str_live_count mean the same
 * thing it meant before interning existed. */
void scr_str_intern_drain(void) {
  size_t i;
  if (scr_str_itab_used == 0) return;
  for (i = 0; i < SCR_STR_INTERN_SLOTS; i++) {
    ScrStr *e = scr_str_itab[i];
    if (e == NULL) continue;
    scr_str_itab[i] = NULL;
    scr_str_release(e);
  }
  scr_str_itab_used = 0;
}

/* 512, MEASURED, not chosen. On the real zapo messaging bench, memory store,
 * six runs per arm pooled over both halves of a palindrome arm order (so the
 * per-arm mean position, and with it the 11.1% cycle drift across a rep, is
 * identical for every arm):
 *
 *     arena off, growth 0   191.93 MiB peak working set   (this is main)
 *     arena on,  growth 0   183.21   -8.71
 *     arena on,  growth 512 178.07  -13.85
 *
 * with an A/A floor of 0.43% on peak RSS taken from the SAME session, and
 * six-phase cycles at 0.9478 against a cycle floor of 11.1% -- i.e. no cycle
 * claim in either direction.
 *
 * WHY THE THRESHOLD IS SAFE, as a bound rather than as a benchmark. Above
 * 512 bytes nothing changes at all: both geometric arms still apply, so an
 * accumulator is amortized exactly as it is today. Below 512 a result falls
 * to the SCR_STR_CHAIN_SLACK arm and grows by a constant instead, so a
 * string built from empty pays at most 512/SCR_STR_CHAIN_SLACK = 64 extra
 * reallocations and 512^2/(2*8) = 16 KiB of extra copying on its way to the
 * threshold, once, and nothing after it. That is the whole worst case.
 *
 * WHAT IT BUYS, from the census rather than from the delta: 93.70% of the
 * live heap strings at the bench's high-water mark carry capacity 50 for a
 * payload of about 28 bytes, and every one of those 22 slack bytes comes
 * from the `a->rc == 1` arm below firing on a 28-byte result. The arm was
 * measured on CHURN and had never been priced against RETENTION. */
#ifndef SCR_STR_GROWTH_MIN
#define SCR_STR_GROWTH_MIN 512
#endif

/* The minimum RESULT LENGTH at which the geometric arms apply. 0 = always,
 * which is the shipped behaviour. A threshold is the interesting shape and a
 * boolean is not: the arms exist to amortize APPEND LOOPS, and an append
 * loop is large by the time it matters, while the population this costs is
 * 28 bytes long. Gating on length keeps the amortization where it pays and
 * removes the slack where it is only retained.
 *
 * SCR_STRING_GROWTH=0 is kept as the spelling for "never", because the first
 * measurement in this block used it and the two arms have to stay
 * comparable. SCR_STRING_SLACK overrides SCR_STR_CHAIN_SLACK the same way,
 * so ONE image can hold every point on the curve. */
static size_t scr_str_growth_min(void) {
  static int done = 0;
  static size_t cached = 0;
  if (!done) {
    const char *env = getenv("SCR_STRING_GROWTH_MIN");
    const char *off = getenv("SCR_STRING_GROWTH");
    done = 1;
    cached = (size_t)SCR_STR_GROWTH_MIN;
    if (env != NULL) cached = (size_t)strtoull(env, NULL, 10);
    else if (off != NULL && strtol(off, NULL, 10) == 0) cached = (size_t)-1;
  }
  return cached;
}

static size_t scr_str_slack(void) {
  static int done = 0;
  static size_t cached = 0;
  if (!done) {
    const char *env = getenv("SCR_STRING_SLACK");
    done = 1;
    cached = env != NULL ? (size_t)strtoull(env, NULL, 10)
                         : (size_t)SCR_STR_CHAIN_SLACK;
  }
  return cached;
}

/* ── the string block arena ───────────────────────────────────────────
 * The pool above recycles blocks; it does not change where a block COMES
 * FROM, and on the real messaging bench that is where the bytes are.
 * Residency-profiled there, this file's malloc is the #1 live-heap site,
 * and ScrStr's header is already 12 bytes — the header is not what is
 * left. THE COUNT OF CRT BLOCKS IS: every malloc'd block carries the
 * allocator's own per-block cost, which on this target is an 8-byte header
 * rounded to a 16-byte grain, i.e. 8 or 16 bytes on top of a request that
 * is already a multiple of SCR_POOL_GRAIN. Twelve bytes on average, on a
 * population whose mean physical block is under 60. That term is in no
 * header this file controls.
 *
 * So the pool miss carves out of 64 KiB chunks instead. This is
 * scr_cycle.c's arena, ported, and it can be simpler in exactly one way
 * that matters:
 *
 *   PROVENANCE NEEDS NO BIT, because it is a FUNCTION OF `cap`. The arena
 *   serves exactly the class range the pool serves — scr_pool_bytes(want)
 *   in [SCR_POOL_GRAIN, SCR_POOL_MAX] — and every block in that range
 *   comes from here. `cap` is the field the size was computed from at
 *   birth and the field scr_str_release recomputes the class from at
 *   death, so the two cannot disagree: the same predicate that decides
 *   "the pool may hold this" decides "this must never reach free()".
 *   scr_cycle.c had to spend ScrCycHdr::pad on the question because a
 *   cycle block's size is not recoverable from any field the object
 *   itself carries; a string's is.
 *
 *   The one place the invariant could be broken is scr_str_regrow, which
 *   is a realloc. It is redirected to copy-and-give for a carved block —
 *   see the comment there.
 *
 * NO ARENA HEADER, and BLOCKS NEVER MIGRATE between classes: the free list
 * is indexed by the same class the pool's is, so a block handed back is
 * handed out at exactly its own width. The carve stride is the physical
 * size itself, already a multiple of SCR_POOL_GRAIN (8) — enough for the
 * free-list link that lives in the block's first word and for ScrStr's own
 * 4-byte fields. The arena does not return chunks; the < 256 B tail of a
 * chunk that cannot fit the next stride is abandoned (0.4% at worst).
 *
 * OFF UNDER SCR_RC_AUDIT for exactly the reason the pool is: that lane
 * exists to prove every logical free is a real free, and ASan can only see
 * that if the free reaches the CRT.
 *
 * SCR_STRING_ARENA=0 restores the malloc. It is an env knob, not a build
 * flag, so both arms are the same binary — and it is read once and cached,
 * so it cannot change between a block's birth and its death. */
#ifndef SCR_STR_ARENA
#define SCR_STR_ARENA 1
#endif
#ifndef SCR_STR_ARENA_CHUNK
#define SCR_STR_ARENA_CHUNK ((size_t)64 << 10)
#endif

/* Compiled out entirely in the audit lane, exactly like scr_str_spare below
 * and for the same reason, so that lane carries no instruction of it. */
#ifndef SCR_RC_AUDIT

/* One list per SCR_POOL_GRAIN class. Index r / SCR_POOL_GRAIN, 1..CLASSES. */
static void *scr_str_ar_free[SCR_POOL_CLASSES + 1];
static unsigned char *scr_str_ar_cur;
static unsigned char *scr_str_ar_lim;

static int scr_str_arena_on(void) {
  static int cached = -1;
  /* Armed HERE and not at the carve: this is called on every pool miss in
   * the class range whatever the knob answers, so an arm with the arena OFF
   * still writes a report -- and that report says STRING ARENA NEVER CARVED
   * rather than saying nothing at all. An instrument that is silent in the
   * arm it is supposed to refute is not an instrument. */
  SCR_CS_ARM();
  if (cached < 0) {
    const char *env = getenv("SCR_STRING_ARENA");
    cached = env != NULL ? (strtol(env, NULL, 10) != 0) : (SCR_STR_ARENA != 0);
  }
  return cached;
}

/* NULL when the chunk could not be had; the caller falls back to malloc, so
 * a failure here is a slower program and not a broken one. A block that
 * came from that fallback still reaches scr_str_ar_give at death — it is
 * never handed to free(), which is safe (it is reused from the free list
 * forever) and is the only shape in which the cap predicate can be wrong
 * about where a block came from. */
static void *scr_str_ar_take(size_t r) {
  size_t c = r / SCR_POOL_GRAIN;
  void *b = scr_str_ar_free[c];
  SCR_CS_ARM();
  if (b != NULL) {
    __builtin_memcpy(&scr_str_ar_free[c], b, sizeof(void *));
    SCR_CS_BUMP(sarhit);
    return b;
  }
  if ((size_t)(scr_str_ar_lim - scr_str_ar_cur) < r) {
    unsigned char *k = (unsigned char *)malloc(SCR_STR_ARENA_CHUNK);
    if (k == NULL) return NULL;
    scr_str_ar_cur = k;
    scr_str_ar_lim = k + SCR_STR_ARENA_CHUNK;
    SCR_CS_BUMP(sarchunk);
  }
  b = scr_str_ar_cur;
  scr_str_ar_cur += r;
  SCR_CS_BUMP(sarcarve);
  return b;
}

static void scr_str_ar_give(void *b, size_t r) {
  size_t c = r / SCR_POOL_GRAIN;
  __builtin_memcpy(b, &scr_str_ar_free[c], sizeof(void *));
  scr_str_ar_free[c] = b;
  SCR_CS_BUMP(sargive);
}

#endif /* !SCR_RC_AUDIT */

static ScrStr *scr_str_alloc(size_t len, size_t cap) {
  /* The one fence every heap string passes through. len <= cap at every call
   * site, but checking both costs one predictable branch and makes the
   * invariant a property of this function rather than of its callers. */
  scr_str_size_check(len);
  scr_str_size_check(cap);
  size_t want = sizeof(ScrStr) + cap + 1;
  ScrStr *s = scr_pool_take(&scr_str_blocks, want);
  /* scr_pool_bytes, not want: a recycled block is a whole class wide and
   * the class is what give() will put it back into. */
  if (!s) {
    size_t r = scr_pool_bytes(want);
#ifndef SCR_RC_AUDIT
    if (r <= SCR_POOL_MAX && r != 0 && scr_str_arena_on()) {
      s = (ScrStr *)scr_str_ar_take(r);
      if (!s) SCR_CS_BUMP(sarmalloc);
    }
#endif
    if (!s) s = malloc(r);
  }
  if (!s) scr_oom();
  s->rc = 1;
  s->len = (uint32_t)len;
  s->cap = (uint32_t)cap;
#ifdef SCR_RC_AUDIT
  scr_live_strings++;
#endif
#ifdef SCR_STRCEN_ON
  scr_strcen_born(s, (long long)len, (long long)cap);
#endif
  return s;
}

#ifdef SCR_STRCEN_ON
#include "scr_str_census_walk.h"
#endif

ScrStr *scr_str_new(const char *bytes, size_t len) {
  ScrStr *s = scr_str_alloc(len, len);
  memcpy(s->data, bytes, len);
  s->data[len] = '\0';
  return s;
}

/* One-slot free-block cache for append loops: `s += x` compiles to
 * concat + release-of-the-old-string every iteration, so the block freed
 * on iteration n is (with the geometric slack below) big enough for the
 * allocation on iteration n+1 — the loop ping-pongs between two warm
 * blocks instead of paging in fresh zero-filled memory 40k times. Disabled
 * in the audit lane so ASan sees every logical free as a real free. */
#ifndef SCR_RC_AUDIT
static ScrStr *scr_str_spare;
#endif

/* A spare-block reuse must not waste grossly (cap <= 4x the need) and only
 * sizable blocks are worth stashing (>= 512). */
static ScrStr *scr_str_take_spare(size_t len) {
#ifndef SCR_RC_AUDIT
  ScrStr *s = scr_str_spare;
  if (s && s->cap >= len && s->cap / 4 <= len) {
    scr_str_spare = NULL;
    s->rc = 1;
    s->len = (uint32_t)len; /* keeps its larger cap; s->cap >= len was tested */
#ifdef SCR_STRCEN_ON
    scr_strcen_born(s, (long long)len, (long long)s->cap);
#endif
    return s;
  }
#else
  (void)len;
#endif
  return NULL;
}

/* Builder entry points (scr_json.c): raw block with undefined bytes, and
 * an rc==1-only grow. The spare block is worth trying first — a stringify
 * loop's previous output is usually the right size for the next one. */
ScrStr *scr_str_alloc_raw(size_t len, size_t cap) {
  scr_str_size_check(cap); /* the spare path skips scr_str_alloc's fence */
  ScrStr *s = scr_str_take_spare(cap);
  if (!s) return scr_str_alloc(len, cap);
  s->len = (uint32_t)len; /* keeps its (possibly larger) cap */
  return s;
}

ScrStr *scr_str_regrow(ScrStr *s, size_t newcap) {
  scr_str_size_check(newcap); /* realloc, not scr_str_alloc: its own fence */
  /* THE rc == 1 CONTRACT, MACHINE-CHECKED IN THE AUDIT LANE. This function
   * is a realloc: it frees `s` and hands back a different address, so any
   * second holder of `s` is left with a dangling pointer. Its only caller
   * is scr_jb_grow over the JSON builder's own buffer, which comes from
   * scr_str_alloc_raw and is never published -- but "only caller" is a fact
   * about today's tree, and content interning makes the failure mode much
   * worse: the intern table would be left pointing at freed memory, and the
   * next hit on those bytes would hand a program a dangling string.
   *
   * An interned string always has rc >= 2 (the table's own reference plus
   * the caller's), so this fence is exactly the statement "the table can
   * never reach here", checked rather than reasoned. It is audit-lane only:
   * the shipping lane keeps the historical instruction stream, and the
   * lane that would catch a violation is the lane that runs under ASan. */
#ifdef SCR_RC_AUDIT
  if (s->rc != 1) {
    scr_trap("scriptc: scr_str_regrow on a shared string\n");
  }
#endif
  /* A CARVED BLOCK CANNOT BE realloc'd — it did not come from the CRT. The
   * test is the same predicate the allocation used, over the same field, so
   * it cannot disagree with where the block came from. This is not a rare
   * path: scr_jb_grow's first buffer is `scr_jb_hint` bytes, 64 at startup,
   * which is squarely inside the arena's range, and it doubles from there.
   *
   * `s->cap + 1` bytes are copied, not `s->len`: the JSON builder holds its
   * own length and leaves ScrStr::len at 0 for the whole build, so a copy
   * sized from len would silently truncate every stringify. realloc copied
   * the whole block; so does this. */
#ifndef SCR_RC_AUDIT
  if (scr_str_arena_on() &&
      scr_pool_bytes(sizeof(ScrStr) + (size_t)s->cap + 1) <= SCR_POOL_MAX) {
    ScrStr *g = scr_str_alloc(s->len, newcap);
    size_t n = (size_t)s->cap < newcap ? (size_t)s->cap : newcap;
    memcpy(g->data, s->data, n + 1);
    /* Runs the sidx purge and both census hooks on its own; the contract is
     * rc == 1, so this is the free the realloc would have done. */
    scr_str_release(s);
    return g;
  }
#endif
  scr_sidx_purge(s); /* realloc may move; the old address may be recycled */
#ifdef SCR_STRCEN_ON
  scr_strcen_died(s, (long long)s->len, (long long)s->cap);
#endif
  ScrStr *r = realloc(s, scr_pool_bytes(sizeof(ScrStr) + newcap + 1));
  if (!r) scr_oom();
  r->cap = (uint32_t)newcap;
#ifdef SCR_STRCEN_ON
  scr_strcen_born(r, (long long)r->len, (long long)newcap);
#endif
  return r;
}

void scr_str_release(ScrStr *s) {
  if (!s || s->rc == SCR_STR_IMMORTAL) return; /* NULL: an uninitialized `let` */
  if (--s->rc == 0) {
    scr_sidx_purge(s); /* the address may be recycled by the next malloc */
#ifdef SCR_STRCEN_ON
    scr_strcen_died(s, (long long)s->len, (long long)s->cap);
#endif
#ifdef SCR_RC_AUDIT
    scr_live_strings--;
#endif
#ifndef SCR_RC_AUDIT
    /* The pool first: it covers the small end (mean 76 bytes), the spare
     * block below covers the large end (>= 512), and the two ranges do
     * not overlap, so neither can steal the other's blocks. */
    if (scr_pool_give(&scr_str_blocks, s, sizeof(ScrStr) + s->cap + 1)) return;
    /* The pool refused: either the block is out of its class range, or its
     * byte budget is full. In the SECOND case a carved block would reach
     * free() — so the arena's own list catches it first. The predicate is
     * `cap`, exactly as at birth. */
    if (scr_str_arena_on()) {
      size_t r = scr_pool_bytes(sizeof(ScrStr) + (size_t)s->cap + 1);
      if (r != 0 && r <= SCR_POOL_MAX) {
        scr_str_ar_give(s, r);
        return;
      }
    }
    if (s->cap >= 512) {
      ScrStr *old = scr_str_spare;
      scr_str_spare = s;
      if (!old) return;
      s = old; /* evict the previous spare */
    }
#endif
    free(s);
  }
}

ScrStr *scr_str_concat(ScrStr *a, ScrStr *b) {
  /* The cast is on an OPERAND, not on the sum. With 32-bit lengths
   * `a->len + b->len` is evaluated in unsigned int and WRAPS before the
   * assignment widens it, so a guard written against the sum would be
   * checking a number that had already lost the overflow it exists to
   * catch. Same reason for every (size_t) below. */
  size_t newlen = (size_t)a->len + (size_t)b->len;
  scr_str_size_check(newlen);
  /* In-place append: a is uniquely owned by the caller's borrow (rc == 1 —
   * never an interned literal, those are SCR_STR_IMMORTAL) and has room. Fires on
   * concat chains (`a + b + c`, template literals), where each intermediate
   * result reaches the next concat as a sole-reference temp. Any string
   * with rc > 1 might be aliased and is copied, never mutated. */
  if (a->rc == 1 && a != b && a->cap >= newlen) {
    memcpy(a->data + a->len, b->data, b->len);
    a->len = (uint32_t)newlen;
    a->data[newlen] = '\0';
    /* A cached UTF-16 length for a is stale now; its cursor still valid. */
    for (int i = 0; i < SCR_SIDX_N; i++) {
      if (scr_sidx_tab[i].s == a) scr_sidx_tab[i].u16len = SCR_U16_UNKNOWN;
    }
    a->rc = 2; /* +1 for the returned reference, beside the caller's borrow */
    return a;
  }
  /* Copy path. Geometric slack keeps appenders amortized: a uniquely-owned
   * left side that outgrew its capacity is a concat chain, and any sizable
   * result is presumed an append loop's accumulator (`s += x` reaches here
   * with rc == 2 — the variable plus the emitted temp — every iteration;
   * the slack is what lets the free-block cache above satisfy the next
   * iteration's slightly-larger allocation). */
  /* The interning probe, BEFORE the allocation it would replace. A hit
   * returns a string that already holds these bytes, so the memcpy, the
   * block and the eventual free all do not happen. Compiled in under
   * SCR_RC_AUDIT as well -- see the header comment on the table. */
  unsigned islot = 0;
  int iwant = 0;
  if (newlen >= SCR_STR_INTERN_MINLEN && newlen <= SCR_STR_INTERN_MAXLEN &&
      scr_str_intern_on()) {
    ScrStr *hit = scr_str_intern_get(a->data, a->len, b->data, b->len, &islot);
    if (hit != NULL) return hit;
    iwant = 1;
  }
  size_t newcap = newlen;
  size_t gmin = scr_str_growth_min();
  if (a->rc == 1 && newlen >= gmin) {
    size_t grown = (size_t)a->cap + ((size_t)a->cap >> 1) + 16;
    if (grown > newcap) newcap = grown;
  } else if (newlen >= 512 && newlen <= SCR_STR_MAX_LEN / 2 && newlen >= gmin) {
    newcap = newlen + (newlen >> 1);
  }
#if SCR_STR_CHAIN_SLACK
  /* A SHARED left side (an array element, a variable, an interned literal)
     gets no slack from either arm above, so `a + b + c` with a shared `a`
     allocates twice: the first concat returns cap == len, and the second
     therefore cannot take the in-place arm even though its left side is a
     sole-reference temp. A small constant slack on short results is what
     lets it. The messaging profile's SEND group is exactly this shape
     (`members[m] + "|" + seq`). Measured, not assumed - see the ablation. */
  else if (newlen < 512) newcap = newlen + scr_str_slack();
#endif
  /* Slack is an optimisation and is never worth a trap: a result that fits
   * but whose SLACK would not is allocated exact. */
  if (newcap > SCR_STR_MAX_LEN) newcap = newlen;
  ScrStr *s = scr_str_take_spare(newlen);
  if (!s) s = scr_str_alloc(newlen, newcap);
  memcpy(s->data, a->data, a->len);
  memcpy(s->data + a->len, b->data, b->len);
  s->data[newlen] = '\0';
  if (iwant) scr_str_intern_put(islot, s);
  return s;
}

bool scr_str_eq(ScrStr *a, ScrStr *b) {
  return a == b || (a->len == b->len && memcmp(a->data, b->data, a->len) == 0);
}

int scr_str_cmp(ScrStr *a, ScrStr *b) {
  size_t min = a->len < b->len ? a->len : b->len;
  int c = memcmp(a->data, b->data, min);
  if (c != 0) return c;
  return a->len < b->len ? -1 : (a->len > b->len ? 1 : 0);
}

/* UTF-16 code-unit comparison over well-formed UTF-8 (the default
 * Array.sort/toSorted and URLSearchParams.sort order). Byte order ALMOST
 * matches — the exception is U+E000..U+FFFF (3-byte UTF-8, single high code
 * units) vs supplementary code points (4-byte UTF-8, surrogate pairs
 * 0xD800..0xDFFF): bytes put the 4-byte form last, code units put it first.
 * Decode code points and compare their leading UTF-16 units. */
static uint32_t scr_str_lead_u16(const unsigned char *s, size_t len,
                                size_t *adv) {
  unsigned char b = s[0];
  uint32_t cp;
  size_t n;
  if (b < 0x80) {
    cp = b; n = 1;
  } else if ((b & 0xe0) == 0xc0) {
    cp = b & 0x1fu; n = 2;
  } else if ((b & 0xf0) == 0xe0) {
    cp = b & 0x0fu; n = 3;
  } else {
    cp = b & 0x07u; n = 4;
  }
  if (n > len) n = len; /* defensive: strings are well-formed by contract */
  for (size_t i = 1; i < n; i++) cp = (cp << 6) | (s[i] & 0x3fu);
  *adv = n;
  if (cp >= 0x10000) return 0xd800 + ((cp - 0x10000) >> 10);
  return cp;
}

int scr_str_cmp_u16(ScrStr *a, ScrStr *b) {
  size_t ia = 0, ib = 0;
  while (ia < a->len && ib < b->len) {
    size_t na, nb;
    uint32_t ua = scr_str_lead_u16(
        (const unsigned char *)a->data + ia, a->len - ia, &na);
    uint32_t ub = scr_str_lead_u16(
        (const unsigned char *)b->data + ib, b->len - ib, &nb);
    if (ua != ub) return ua < ub ? -1 : 1;
    /* Equal leading units: equal whole code points (both single units or
     * both pairs with equal highs — lows only differ if cps differ). */
    if (na == 4 && nb == 4) {
      uint32_t cpa = 0, cpb = 0;
      for (size_t i = 0; i < 4; i++) {
        cpa = (cpa << 6) |
              (i == 0 ? (unsigned char)a->data[ia] & 0x07u
                      : (unsigned char)a->data[ia + i] & 0x3fu);
        cpb = (cpb << 6) |
              (i == 0 ? (unsigned char)b->data[ib] & 0x07u
                      : (unsigned char)b->data[ib + i] & 0x3fu);
      }
      if (cpa != cpb) return cpa < cpb ? -1 : 1;
    }
    ia += na;
    ib += nb;
  }
  if (ia < a->len) return 1;
  if (ib < b->len) return -1;
  return 0;
}

/* ── interned strings ─────────────────────────────────────────────────
 * The empty string and every single-character ASCII string are immortal
 * statics (same layout the emitter uses for literals): charAt/slice churn
 * in tight loops returns these without allocating.
 */
typedef SCR_STR_LIT(2) ScrChar1;
#define SCR_A(c) {SCR_STR_IMMORTAL, 1, 1, {(char)(c), 0}}
#define SCR_A8(c) \
  SCR_A(c), SCR_A(c + 1), SCR_A(c + 2), SCR_A(c + 3), \
  SCR_A(c + 4), SCR_A(c + 5), SCR_A(c + 6), SCR_A(c + 7)
static const ScrChar1 scr_ascii1[128] = {
  SCR_A8(0),   SCR_A8(8),   SCR_A8(16),  SCR_A8(24),
  SCR_A8(32),  SCR_A8(40),  SCR_A8(48),  SCR_A8(56),
  SCR_A8(64),  SCR_A8(72),  SCR_A8(80),  SCR_A8(88),
  SCR_A8(96),  SCR_A8(104), SCR_A8(112), SCR_A8(120),
};
static const SCR_STR_LIT(1) scr_lit_empty = {SCR_STR_IMMORTAL, 0, 0, ""};

static ScrStr *scr_str_empty(void) { return (ScrStr *)&scr_lit_empty; }

/* Interned when the content is empty or one ASCII byte; fresh otherwise. */
static ScrStr *scr_str_from_span(const char *bytes, size_t len) {
  if (len == 0) return scr_str_empty();
  if (len == 1 && (unsigned char)bytes[0] < 0x80) {
    return (ScrStr *)&scr_ascii1[(unsigned char)bytes[0]];
  }
  return scr_str_new(bytes, len);
}

/* ── string methods: UTF-16 semantics over UTF-8 storage ──────────
 * All strings in the system are well-formed UTF-8 (the compiler replaces
 * lone surrogates in literals with U+FFFD), so the decode helpers below
 * may assume valid sequences and never validate.
 */

/* UTF-8 encoding of U+FFFD REPLACEMENT CHARACTER — stands in for the lone
 * surrogate JS would produce when charAt/slice split an astral pair. */
#define SCR_REPLACEMENT "\xEF\xBF\xBD"
#define SCR_REPLACEMENT_LEN ((size_t)3)

/* Byte length of the well-formed UTF-8 sequence starting at lead byte c. */
static size_t scr_utf8_seq_len(unsigned char c) {
  if (c < 0x80) return 1;
  if (c < 0xE0) return 2;
  if (c < 0xF0) return 3;
  return 4;
}

/* Decode the code point at p (well-formed UTF-8); *adv gets the byte
 * length of the sequence. */
static uint32_t scr_utf8_decode(const char *p, size_t *adv) {
  unsigned char c = (unsigned char)p[0];
  if (c < 0x80) {
    *adv = 1;
    return c;
  }
  if (c < 0xE0) {
    *adv = 2;
    return ((uint32_t)(c & 0x1F) << 6) | ((unsigned char)p[1] & 0x3F);
  }
  if (c < 0xF0) {
    *adv = 3;
    return ((uint32_t)(c & 0x0F) << 12) |
           ((uint32_t)((unsigned char)p[1] & 0x3F) << 6) |
           ((unsigned char)p[2] & 0x3F);
  }
  *adv = 4;
  return ((uint32_t)(c & 0x07) << 18) |
         ((uint32_t)((unsigned char)p[1] & 0x3F) << 12) |
         ((uint32_t)((unsigned char)p[2] & 0x3F) << 6) |
         ((unsigned char)p[3] & 0x3F);
}

/* Is every byte of [d, d+n) below 0x80? Then the string is pure ASCII, and
 * its UTF-16 length is n with no classification work at all.
 *
 * WHY THE SHORT CASES CARRY NO LOOP, measured rather than assumed. On the
 * string-build scenario scr_str_utf16_len costs 133.3 instructions per call
 * over strings whose mean length is 5.83 bytes — thirteen instructions per
 * byte. Callgrind, per instruction, puts 56.9 of them in ONE region: LLVM
 * autovectorises the trailing byte loop of scr_utf16_units below, and the
 * vector body it emits is ~40 SSE instructions to classify FOUR bytes. A
 * six-byte string enters that body once and leaves two bytes to the scalar
 * loop, which costs a further 20.4. The bytes are not the expense; the LOOP
 * is, and no amount of tuning inside it helps a string this short.
 *
 * So 0..16 bytes are answered by at most two OVERLAPPING unaligned loads and
 * no loop of any kind. Re-reading a few bytes is free and both loads stay
 * strictly inside the string, which matters: an ScrStr is allocated as
 * sizeof(ScrStr) + cap + 1 and an interned literal is a bare `char data[n]`,
 * so there is no padding to read into. Below four bytes, d[0], d[n/2] and
 * d[n-1] cover every byte of a 1-, 2- or 3-byte string exactly. Above
 * sixteen the trip count is large enough that a loop earns its prologue. */
static bool scr_utf8_all_ascii(const unsigned char *d, size_t n) {
  const uint64_t hibits = 0x8080808080808080ull;
  uint64_t a, b;
  if (n <= 16) {
    if (n >= 8) {
      memcpy(&a, d, 8);
      memcpy(&b, d + n - 8, 8);
      return ((a | b) & hibits) == 0;
    }
    if (n >= 4) {
      uint32_t x, y;
      memcpy(&x, d, 4);
      memcpy(&y, d + n - 4, 4);
      return ((x | y) & 0x80808080u) == 0;
    }
    if (n == 0) return true;
    return ((unsigned)d[0] | d[n >> 1] | d[n - 1]) < 0x80u;
  }
  {
    uint64_t acc = 0;
    size_t i = 0;
    for (; i + 8 <= n; i += 8) {
      memcpy(&a, d + i, 8);
      acc |= a;
    }
    memcpy(&b, d + n - 8, 8); /* n > 16, so this overlaps rather than overruns */
    return ((acc | b) & hibits) == 0;
  }
}

/* Number of UTF-16 code units in s (BMP char = 1, astral char = 2).
 * Byte-classification is position-independent (well-formed UTF-8):
 * units = #bytes - #continuation-bytes + #4-byte-leads, so the word-wise
 * loop counts eight bytes at a time — bits 10xxxxxx mark a continuation,
 * 11110xxx an astral lead — with an all-ASCII early out per word. */
static size_t scr_utf16_units(const ScrStr *s) {
  const unsigned char *d = (const unsigned char *)s->data;
  const uint64_t hibits = 0x8080808080808080ull;
  size_t units = 0, i = 0;
  /* Pure ASCII answers itself: every byte is one code unit, so units is the
   * byte length. Every population this project has censused is 100% ASCII,
   * and the classification below cannot be cheaper than not running. */
  if (scr_utf8_all_ascii(d, s->len)) return s->len;
  while (i + 8 <= s->len) {
    uint64_t w;
    memcpy(&w, d + i, 8);
    i += 8;
    if ((w & hibits) == 0) { /* all ASCII */
      units += 8;
      continue;
    }
    uint64_t cont = w & ~(w << 1) & hibits;
    uint64_t lead4 = w & (w << 1) & (w << 2) & (w << 3) & hibits;
    units += 8 - (size_t)__builtin_popcountll(cont) +
             (size_t)__builtin_popcountll(lead4);
  }
  while (i < s->len) {
    unsigned char c = d[i++];
    if ((c & 0xC0) == 0x80) continue;  /* continuation byte */
    units += c >= 0xF0 ? 2 : 1;
  }
  return units;
}

/* Cached UTF-16 length; computes and remembers on first use. Note that
 * u16len == byte len is exactly "all ASCII" — the walkers below use that
 * to answer conversions in O(1) without a cursor. */
static size_t scr_sidx_len(const ScrStr *s, ScrSidx *e) {
  if (e->u16len == SCR_U16_UNKNOWN) e->u16len = scr_utf16_units(s);
  return e->u16len;
}

/* Step the cursor back one char (cb must be > 0 and on a boundary). */
static void scr_sidx_back(const ScrStr *s, size_t *cu, size_t *cb) {
  size_t p = *cb - 1;
  while (p > 0 && ((unsigned char)s->data[p] & 0xC0) == 0x80) p--;
  *cu -= scr_utf8_seq_len((unsigned char)s->data[p]) == 4 ? 2 : 1;
  *cb = p;
}

/* Convert a UTF-16 index to a byte offset, walking from the cached cursor
 * (either direction). If u16 addresses the second (low-surrogate) unit of
 * an astral char, *mid is set and the returned offset is the START of that
 * 4-byte sequence. u16 at or past the end returns s->len with *mid false.
 * Same contract as a from-scratch scan; O(distance from cursor). */
static size_t scr_u16_to_byte_c(const ScrStr *s, ScrSidx *e, size_t u16,
                                 bool *mid) {
  if (e->u16len == s->len) { /* all ASCII: identity mapping */
    *mid = false;
    return u16 < s->len ? u16 : s->len;
  }
  size_t cu = e->cu, cb = e->cb;
  /* Restart from whichever end is closer than the cursor. */
  if (u16 < cu && cu - u16 > u16) {
    cu = 0;
    cb = 0;
  }
  while (cu > u16) scr_sidx_back(s, &cu, &cb);
  bool m = false;
  while (cu < u16 && cb < s->len) {
    size_t seq = scr_utf8_seq_len((unsigned char)s->data[cb]);
    size_t w = seq == 4 ? 2 : 1;
    if (cu + w > u16) { /* u16 lands between the halves of an astral char */
      m = true;
      break;
    }
    cu += w;
    cb += seq;
  }
  e->cu = cu;
  e->cb = cb;
  *mid = m;
  return cb;
}

/* Convert a byte offset (must be a char boundary) to a UTF-16 index,
 * walking from the cached cursor. */
static size_t scr_byte_to_u16_c(const ScrStr *s, ScrSidx *e,
                                 size_t byte_off) {
  if (e->u16len == s->len) return byte_off; /* all ASCII */
  size_t cu = e->cu, cb = e->cb;
  if (byte_off < cb && cb - byte_off > byte_off) {
    cu = 0;
    cb = 0;
  }
  while (cb > byte_off) scr_sidx_back(s, &cu, &cb);
  while (cb < byte_off) {
    size_t seq = scr_utf8_seq_len((unsigned char)s->data[cb]);
    cu += seq == 4 ? 2 : 1;
    cb += seq;
  }
  e->cu = cu;
  e->cb = cb;
  return cu;
}

/* ECMA-262 ToIntegerOrInfinity for a double already known to be a Number:
 * NaN → +0, otherwise truncate toward zero, ±Infinity preserved. */
static double scr_to_integer_or_infinity(double x) {
  if (isnan(x)) return 0.0;
  return trunc(x);
}

/* Naive byte substring search (needle and hay are both well-formed UTF-8,
 * so any byte-level match starts on a char boundary — UTF-8 is
 * self-synchronizing). Empty needle matches at hay. */
static const char *scr_byte_find(const char *hay, size_t hay_len,
                                  const char *nee, size_t nee_len) {
  if (nee_len == 0) return hay;
  if (nee_len > hay_len) return NULL;
  for (size_t i = 0; i + nee_len <= hay_len; i++) {
    if (hay[i] == nee[0] && memcmp(hay + i, nee, nee_len) == 0)
      return hay + i;
  }
  return NULL;
}

double scr_str_utf16_len(ScrStr *s) {
#ifdef SCR_U16CEN_ON
  /* tests/perf/u16census/scr_u16_census.h. Inert -- the symbol is
   * undefined -- unless that header is -include'd, which is the only way
   * to answer "how often does the REAL program ask, and on what". */
  {
    int hit = 0, ascii = 1, i;
    size_t k;
    for (i = 0; i < SCR_SIDX_N; i++) {
      if (scr_sidx_tab[i].s == s && scr_sidx_tab[i].u16len != SCR_U16_UNKNOWN) {
        hit = 1;
        break;
      }
    }
    for (k = 0; k < s->len; k++) {
      if ((unsigned char)s->data[k] & 0x80u) { ascii = 0; break; }
    }
    scr_u16cen_call((long long)s->len, ascii, hit);
  }
#endif
  return (double)scr_sidx_len(s, scr_sidx(s));
}

double scr_str_char_code_at(ScrStr *s, double i) {
  double idx = scr_to_integer_or_infinity(i);
  if (!(idx >= 0)) return NAN; /* negative or -Infinity */
  /* UTF-16 length <= byte length always, so this also fences the cast. */
  if (idx >= (double)s->len) return NAN;
  ScrSidx *e = scr_sidx(s);
  if (e->u16len == s->len) return (double)(unsigned char)s->data[(size_t)idx];
  bool mid;
  size_t off = scr_u16_to_byte_c(s, e, (size_t)idx, &mid);
  if (off >= s->len) return NAN; /* idx >= length */
  size_t adv;
  uint32_t cp = scr_utf8_decode(s->data + off, &adv);
  if (cp < 0x10000) return (double)cp;
  uint32_t v = cp - 0x10000;
  return mid ? (double)(0xDC00 + (v & 0x3FF)) : (double)(0xD800 + (v >> 10));
}

double scr_str_index_of(ScrStr *s, ScrStr *needle, double fromIndex) {
  double pos = scr_to_integer_or_infinity(fromIndex);
  ScrSidx *e = scr_sidx(s);
  size_t len16 = scr_sidx_len(s, e);
  size_t start16 = pos <= 0             ? 0
                   : pos >= (double)len16 ? len16
                                          : (size_t)pos;
  /* Per spec, the empty needle is found at the clamped fromIndex itself —
   * even when that index is between the halves of an astral pair. */
  if (needle->len == 0) return (double)start16;
  bool mid;
  size_t start_b = scr_u16_to_byte_c(s, e, start16, &mid);
  /* A match can't begin on a low-surrogate half (needles are well-formed),
   * so resume at the next char boundary. */
  if (mid) start_b += 4;
  const char *found =
      scr_byte_find(s->data + start_b, s->len - start_b, needle->data,
                     needle->len);
  if (!found) return -1.0;
  return (double)scr_byte_to_u16_c(s, e, (size_t)(found - s->data));
}

/* substring: slice's clamp-and-swap sibling — ToIntegerOrInfinity both
 * boundaries (NaN → 0), clamp each to [0, len16] (negatives clamp to 0,
 * NOT relative like slice's), swap when start > end, then extract exactly
 * like slice (whose relative/negative handling is inert on the
 * already-clamped values — delegation is exact). */
ScrStr *scr_str_substring(ScrStr *s, double start, double end) {
  ScrSidx *e = scr_sidx(s);
  double len16 = (double)scr_sidx_len(s, e);
  double a = scr_to_integer_or_infinity(start);
  double b = scr_to_integer_or_infinity(end);
  double fa = a < 0 ? 0 : a > len16 ? len16 : a;
  double fb = b < 0 ? 0 : b > len16 ? len16 : b;
  return fa < fb ? scr_str_slice(s, fa, fb) : scr_str_slice(s, fb, fa);
}

bool scr_str_includes(ScrStr *s, ScrStr *needle) {
  return scr_byte_find(s->data, s->len, needle->data, needle->len) != NULL;
}

bool scr_str_starts_with(ScrStr *s, ScrStr *needle) {
  return needle->len <= s->len &&
         memcmp(s->data, needle->data, needle->len) == 0;
}

bool scr_str_ends_with(ScrStr *s, ScrStr *needle) {
  return needle->len <= s->len &&
         memcmp(s->data + (s->len - needle->len), needle->data,
                needle->len) == 0;
}

/* Resolve one slice() boundary: negatives are relative to the end, then
 * clamp to [0, len16]. Handles ±Infinity (already through
 * ToIntegerOrInfinity). */
static size_t scr_slice_boundary(double v, size_t len16) {
  if (v < 0) {
    double t = v + (double)len16; /* -Infinity stays -Infinity */
    return t <= 0 ? 0 : (size_t)t;
  }
  return v >= (double)len16 ? len16 : (size_t)v;
}

ScrStr *scr_str_slice(ScrStr *s, double start, double end) {
  ScrSidx *e = scr_sidx(s);
  size_t len16 = scr_sidx_len(s, e);
  size_t from = scr_slice_boundary(scr_to_integer_or_infinity(start), len16);
  size_t to = scr_slice_boundary(scr_to_integer_or_infinity(end), len16);
  if (from >= to) return scr_str_empty();

  bool from_mid, to_mid;
  size_t from_b = scr_u16_to_byte_c(s, e, from, &from_mid);
  size_t to_b = scr_u16_to_byte_c(s, e, to, &to_mid);
  /* Both *_mid offsets point at the start of the split astral char; the
   * kept content is the whole chars strictly inside the boundaries. */
  size_t content_b = from_mid ? from_b + 4 : from_b;
  size_t content_len = to_b - content_b;

  if (!from_mid && !to_mid)
    return scr_str_from_span(s->data + from_b, content_len);

  /* Divergence: JS would emit the lone surrogate half; we emit U+FFFD. */
  size_t total = content_len + (from_mid ? SCR_REPLACEMENT_LEN : 0) +
                 (to_mid ? SCR_REPLACEMENT_LEN : 0);
  char *tmp = malloc(total);
  if (!tmp) scr_oom();
  size_t o = 0;
  if (from_mid) {
    memcpy(tmp + o, SCR_REPLACEMENT, SCR_REPLACEMENT_LEN);
    o += SCR_REPLACEMENT_LEN;
  }
  memcpy(tmp + o, s->data + content_b, content_len);
  o += content_len;
  if (to_mid) memcpy(tmp + o, SCR_REPLACEMENT, SCR_REPLACEMENT_LEN);
  ScrStr *r = scr_str_new(tmp, total);
  free(tmp);
  return r;
}

ScrStr *scr_str_repeat(ScrStr *s, double count) {
  double n = scr_to_integer_or_infinity(count);
  if (n < 0 || (isinf(n) && n > 0)) {
    scr_trap("scriptc: RangeError: Invalid count value\n");
  }
  if (n == 0 || s->len == 0) return scr_str_empty();
  /* n is a finite non-negative integer here. Reject sizes malloc could not
   * satisfy anyway before the double→size_t conversion can overflow. */
  if (n > (double)(SCR_STR_MAX_LEN / s->len)) scr_oom();
  size_t total = (size_t)n * s->len;
  ScrStr *r = scr_str_alloc(total, total);
  memcpy(r->data, s->data, s->len);
  size_t filled = s->len;
  while (filled < total) { /* doubling fill */
    size_t chunk = filled <= total - filled ? filled : total - filled;
    memcpy(r->data + filled, r->data, chunk);
    filled += chunk;
  }
  r->data[total] = '\0';
  return r;
}

/* Exact ECMA-262 WhiteSpace ∪ LineTerminator membership. */
static bool scr_is_js_whitespace(uint32_t cp) {
  switch (cp) {
    case 0x0009: case 0x000A: case 0x000B: case 0x000C: case 0x000D:
    case 0x0020: case 0x00A0: case 0x1680: case 0x2028: case 0x2029:
    case 0x202F: case 0x205F: case 0x3000: case 0xFEFF:
      return true;
    default:
      return cp >= 0x2000 && cp <= 0x200A;
  }
}

ScrStr *scr_str_trim(ScrStr *s) {
  size_t b = 0, e = s->len;
  while (b < e) {
    size_t adv;
    uint32_t cp = scr_utf8_decode(s->data + b, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    b += adv;
  }
  while (e > b) {
    size_t cs = e - 1; /* back up to the lead byte of the last char */
    while (cs > b && ((unsigned char)s->data[cs] & 0xC0) == 0x80) cs--;
    size_t adv;
    uint32_t cp = scr_utf8_decode(s->data + cs, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    e = cs;
  }
  return scr_str_from_span(s->data + b, e - b);
}

ScrStr *scr_str_char_at(ScrStr *s, double i) {
  double idx = scr_to_integer_or_infinity(i);
  if (!(idx >= 0)) return scr_str_empty();
  if (idx >= (double)s->len) return scr_str_empty(); /* len16 <= len */
  ScrSidx *e = scr_sidx(s);
  if (e->u16len == s->len) { /* all ASCII */
    return (ScrStr *)&scr_ascii1[(unsigned char)s->data[(size_t)idx]];
  }
  bool mid;
  size_t off = scr_u16_to_byte_c(s, e, (size_t)idx, &mid);
  if (off >= s->len) return scr_str_empty(); /* out of range */
  size_t adv;
  uint32_t cp = scr_utf8_decode(s->data + off, &adv);
  if (cp >= 0x10000) {
    /* Divergence: JS returns the lone surrogate half; we return U+FFFD. */
    return scr_str_new(SCR_REPLACEMENT, SCR_REPLACEMENT_LEN);
  }
  return scr_str_from_span(s->data + off, adv);
}

/* trimStart()/trimEnd(): the one-sided halves of trim — same exact JS
 * WhiteSpace ∪ LineTerminator set, same scan loops. */
ScrStr *scr_str_trim_start(ScrStr *s) {
  size_t b = 0;
  while (b < s->len) {
    size_t adv;
    uint32_t cp = scr_utf8_decode(s->data + b, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    b += adv;
  }
  return scr_str_from_span(s->data + b, s->len - b);
}

ScrStr *scr_str_trim_end(ScrStr *s) {
  size_t e = s->len;
  while (e > 0) {
    size_t cs = e - 1; /* back up to the lead byte of the last char */
    while (cs > 0 && ((unsigned char)s->data[cs] & 0xC0) == 0x80) cs--;
    size_t adv;
    uint32_t cp = scr_utf8_decode(s->data + cs, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    e = cs;
  }
  return scr_str_from_span(s->data, e);
}

/* Immortal U+FFFD — the divergence-2 stand-in wherever JS would produce a
 * lone surrogate (empty-separator split of an astral char, a pad fill
 * truncated mid-pair). */
static const SCR_STR_LIT(4) scr_lit_fffd = {SCR_STR_IMMORTAL, 3, 3, "\xEF\xBF\xBD"};

/* split(separator) with a STRING separator, no limit (ECMA-262 22.1.3.23):
 * an empty separator splits into single UTF-16 code units ("".split("") is
 * [] — no probe matches nothing); a non-empty separator splits on every
 * byte-level occurrence (well-formed UTF-8 is self-synchronizing, so byte
 * matches are exactly code-point matches), keeping empty pieces at the
 * ends and between adjacent separators; an empty subject with a non-empty
 * separator is [""]. Where JS's per-unit split of an astral char would
 * yield the two lone surrogate halves, each half is U+FFFD here
 * (divergence 2 — the same substitution the island's boundary marshal
 * applied). Borrows both; returns a +1 string[]. */
ScrArr *scr_str_split(ScrStr *s, ScrStr *sep) {
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, 0);
  if (sep->len == 0) {
    size_t i = 0;
    while (i < s->len) {
      size_t adv;
      uint32_t cp = scr_utf8_decode(s->data + i, &adv);
      if (cp >= 0x10000) { /* two units in JS: both halves become U+FFFD */
        scr_arr_push_ref(out, scr_str_retain((ScrStr *)&scr_lit_fffd));
        scr_arr_push_ref(out, scr_str_retain((ScrStr *)&scr_lit_fffd));
      } else {
        scr_arr_push_ref(out, scr_str_from_span(s->data + i, adv));
      }
      i += adv;
    }
    return out;
  }
  size_t start = 0;
  for (;;) {
    const char *found = scr_byte_find(s->data + start, s->len - start,
                                       sep->data, sep->len);
    if (!found) break;
    size_t at = (size_t)(found - s->data);
    scr_arr_push_ref(out, scr_str_from_span(s->data + start, at - start));
    start = at + sep->len;
  }
  scr_arr_push_ref(out, scr_str_from_span(s->data + start, s->len - start));
  return out;
}

/* StringPad (ECMA-262 22.1.3.16/17): target length in UTF-16 units, the
 * filler built from whole repetitions of `fill` plus a truncated prefix.
 * A target at or below the length (or an empty fill) returns the receiver
 * unchanged. A truncation that would split an astral char in the fill
 * emits U+FFFD for the kept half (one unit, like the lone surrogate JS
 * keeps — divergence 2). Sizes beyond what malloc can satisfy abort (the
 * repeat() policy; JS's RangeError fires around 2^29 units). Borrows both;
 * returns +1. */
static ScrStr *scr_pad_impl(ScrStr *s, double maxLength, ScrStr *fill,
                             bool at_start) {
  double target = scr_to_integer_or_infinity(maxLength);
  ScrSidx *e = scr_sidx(s);
  size_t len16 = scr_sidx_len(s, e);
  if (!(target > (double)len16) || fill->len == 0) return scr_str_retain(s);
  /* Reject pad sizes malloc could not satisfy before the double→size_t
   * conversion can overflow (each unit is at most 3 bytes here: BMP chars
   * and the U+FFFD stand-in; astral chars are 4 bytes for 2 units). */
  if (target > (double)(SCR_STR_MAX_LEN / 4)) scr_oom();
  size_t pad16 = (size_t)target - len16;
  size_t fill16 = scr_sidx_len(fill, scr_sidx(fill));
  size_t reps = pad16 / fill16, rem16 = pad16 % fill16;
  /* The truncated prefix of fill: whole chars while they fit in rem16
   * units; a final astral char that doesn't fit contributes U+FFFD. */
  size_t prefix_b = 0, prefix_units = 0;
  bool prefix_fffd = false;
  while (prefix_units < rem16) {
    size_t seq = scr_utf8_seq_len((unsigned char)fill->data[prefix_b]);
    size_t w = seq == 4 ? 2 : 1;
    if (prefix_units + w > rem16) { /* astral char split by the truncation */
      prefix_fffd = true;
      prefix_units += 1;
      break;
    }
    prefix_b += seq;
    prefix_units += w;
  }
  size_t pad_b = reps * fill->len + prefix_b +
                 (prefix_fffd ? SCR_REPLACEMENT_LEN : 0);
  if (pad_b > SCR_STR_MAX_LEN - s->len) scr_oom();
  size_t total = s->len + pad_b;
  ScrStr *r = scr_str_alloc(total, total);
  char *w = r->data + (at_start ? 0 : s->len);
  for (size_t i = 0; i < reps; i++) {
    memcpy(w, fill->data, fill->len);
    w += fill->len;
  }
  memcpy(w, fill->data, prefix_b);
  w += prefix_b;
  if (prefix_fffd) {
    memcpy(w, SCR_REPLACEMENT, SCR_REPLACEMENT_LEN);
    w += SCR_REPLACEMENT_LEN;
  }
  memcpy(at_start ? w : r->data, s->data, s->len);
  r->data[total] = '\0';
  return r;
}

ScrStr *scr_str_pad_start(ScrStr *s, double maxLength, ScrStr *fill) {
  return scr_pad_impl(s, maxLength, fill, true);
}

ScrStr *scr_str_pad_end(ScrStr *s, double maxLength, ScrStr *fill) {
  return scr_pad_impl(s, maxLength, fill, false);
}

/* ── parseInt: ECMA-262 19.2.5, exactly ───────────────────────────────
 * Skip JS whitespace, take an optional sign, resolve the radix through
 * ToInt32 (0 → 10 with a 0x/0X hex escape; 16 also strips the prefix;
 * outside 2..36 → NaN), scan the longest digit prefix, and round the
 * EXACT mathematical value to double. The fast path accumulates in u64
 * (u64→double conversion is correctly rounded); digit strings that
 * overflow 64 bits go through a small base-2^32 bignum and round-to-
 * nearest-even on the top 53 bits, so thousand-digit inputs in any radix
 * are Node-exact, Infinity overflow included. */

static double scr_to_int32_d(double d) {
  if (!isfinite(d) || d == 0) return 0;
  double m = fmod(trunc(d), 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return m >= 2147483648.0 ? m - 4294967296.0 : m;
}

static int scr_digit_value(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'z') return c - 'a' + 10;
  if (c >= 'A' && c <= 'Z') return c - 'A' + 10;
  return 99;
}

/* Digit string → double (digits already validated against the radix,
 * leading zeros stripped, count >= 1). Node (V8) is the oracle, and V8 is
 * only EXACT where the spec requires it (radix 2, 4, 8, 10, 16, 32); for
 * every other radix it runs a 32-bit-chunked double accumulation whose
 * rounding error the spec explicitly permits ("mathInt may be an
 * implementation-dependent approximation"). Reproduce both behaviors
 * bit-exactly: the chunk loop for the approximate radixes, correct
 * rounding (u64 fast path, bignum beyond) for the exact ones. */
static double scr_digits_to_double(const char *p, size_t n, int radix) {
  if (radix != 10 && (radix & (radix - 1)) != 0) {
    /* V8's generic-radix loop (numbers/conversions.cc): consume the
     * longest digit run whose multiplier stays below 0xFFFFFFFF/36, then
     * fold with one double multiply-add per chunk — the rounding of each
     * fold IS the observable Node behavior. */
    const uint32_t kMaximumMultiplier = 0xFFFFFFFFu / 36u;
    double v = 0.0;
    size_t i = 0;
    bool done = false;
    do {
      uint32_t part = 0, multiplier = 1;
      for (;;) {
        if (i == n) {
          done = true;
          break;
        }
        uint32_t d = (uint32_t)scr_digit_value(p[i]);
        uint32_t m = multiplier * (uint32_t)radix;
        if (m > kMaximumMultiplier) break; /* digit starts the next chunk */
        part = part * (uint32_t)radix + d;
        multiplier = m;
        i++;
      }
      v = v * (double)multiplier + (double)part;
    } while (!done);
    return v;
  }
  /* u64 fast path: exact while the accumulator fits. */
  uint64_t acc = 0;
  size_t i = 0;
  for (; i < n; i++) {
    int dv = scr_digit_value(p[i]);
    if (acc > (UINT64_MAX - (uint64_t)dv) / (uint64_t)radix) break;
    acc = acc * (uint64_t)radix + (uint64_t)dv;
  }
  if (i == n) return (double)acc;
  /* Bignum path: base-2^32 limbs, little-endian, multiply-add per digit. */
  size_t cap = 4 + (n * 6) / 32; /* log2(36) < 6 bits per digit */
  uint32_t *limbs = malloc(cap * sizeof(uint32_t));
  if (!limbs) scr_oom();
  limbs[0] = (uint32_t)acc;
  limbs[1] = (uint32_t)(acc >> 32);
  size_t nl = limbs[1] ? 2 : 1;
  for (; i < n; i++) {
    uint64_t carry = (uint64_t)scr_digit_value(p[i]);
    for (size_t j = 0; j < nl; j++) {
      uint64_t t = (uint64_t)limbs[j] * (uint64_t)radix + carry;
      limbs[j] = (uint32_t)t;
      carry = t >> 32;
    }
    if (carry) {
      if (nl == cap) { /* unreachable by the cap bound; belt and braces */
        cap *= 2;
        limbs = realloc(limbs, cap * sizeof(uint32_t));
        if (!limbs) scr_oom();
      }
      limbs[nl++] = (uint32_t)carry;
    }
  }
  /* Round the bignum to double: top 53 bits, guard, sticky, half-even. */
  size_t topbits = 32 - (size_t)__builtin_clz(limbs[nl - 1]);
  size_t bitlen = 32 * (nl - 1) + topbits;
  /* bitlen > 64 here (the fast path overflowed), so shift > 0. */
  size_t shift = bitlen - 54; /* keep 53 mantissa bits + 1 guard bit */
  uint64_t top = 0;
  for (size_t k = 0; k < 54; k++) {
    size_t bit = shift + k;
    uint64_t b = (limbs[bit / 32] >> (bit % 32)) & 1u;
    top |= b << k;
  }
  bool sticky = false;
  for (size_t bit = 0; bit < shift && !sticky; bit++) {
    sticky = ((limbs[bit / 32] >> (bit % 32)) & 1u) != 0;
  }
  free(limbs);
  uint64_t mant = top >> 1;
  bool guard = (top & 1u) != 0;
  if (guard && (sticky || (mant & 1u))) mant++;
  int exp2 = (int)shift + 1;
  if (mant == (1ull << 53)) { /* rounding carried into a new bit */
    mant >>= 1;
    exp2++;
  }
  return ldexp((double)mant, exp2); /* overflow → HUGE_VAL, JS's Infinity */
}

double scr_parse_int(ScrStr *s, double radix) {
  double r32 = scr_to_int32_d(radix);
  const char *p = s->data;
  size_t n = s->len, i = 0;
  while (i < n) {
    size_t adv;
    uint32_t cp = scr_utf8_decode(p + i, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    i += adv;
  }
  double sign = 1.0;
  if (i < n && (p[i] == '+' || p[i] == '-')) {
    if (p[i] == '-') sign = -1.0;
    i++;
  }
  int radix_i;
  bool strip_prefix = true;
  if (r32 != 0) {
    if (r32 < 2 || r32 > 36) return NAN;
    radix_i = (int)r32;
    if (radix_i != 16) strip_prefix = false;
  } else {
    radix_i = 10;
  }
  if (strip_prefix && i + 1 < n && p[i] == '0' &&
      (p[i + 1] == 'x' || p[i + 1] == 'X')) {
    i += 2;
    radix_i = 16;
  }
  size_t dig_start = i;
  while (i < n && scr_digit_value(p[i]) < radix_i) i++;
  if (i == dig_start) return NAN;
  while (dig_start < i && p[dig_start] == '0') dig_start++;
  if (dig_start == i) return sign * 0.0; /* all zeros; "-0" is -0 */
  return sign * scr_digits_to_double(p + dig_start, i - dig_start, radix_i);
}

/* ES parseFloat (ECMA-262 StrDecimalLiteral prefix over the trimmed
 * input): skip JS whitespace, then take the LONGEST decimal-literal
 * prefix — [+-]? (Infinity | digits [. digits*] | . digits) with an
 * optional [eE][+-]?digits exponent — and answer NaN when none exists.
 * Deliberately narrower than strtod's own grammar (no hex, no
 * "inf"/"nan" spellings, "Infinity" exact-case only), so the validated
 * span is COPIED before strtod sees it — handing strtod the raw tail
 * would let it claim "0x10" as hex where JS answers 0. strtod on the
 * validated span is correctly rounded (the JSON parser's precedent). */
double scr_parse_float(ScrStr *s) {
  const char *p = s->data;
  size_t n = s->len, i = 0;
  while (i < n) {
    size_t adv;
    uint32_t cp = scr_utf8_decode(p + i, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    i += adv;
  }
  size_t start = i;
  double sign = 1.0;
  if (i < n && (p[i] == '+' || p[i] == '-')) {
    if (p[i] == '-') sign = -1.0;
    i++;
  }
  if (i + 8 <= n && memcmp(p + i, "Infinity", 8) == 0) {
    return sign * (double)INFINITY;
  }
  size_t int_digits = 0, frac_digits = 0;
  while (i < n && p[i] >= '0' && p[i] <= '9') {
    i++;
    int_digits++;
  }
  if (i < n && p[i] == '.') {
    size_t j = i + 1;
    while (j < n && p[j] >= '0' && p[j] <= '9') {
      j++;
      frac_digits++;
    }
    /* "." alone is not a literal; "1." is (trailing dot, no fraction). */
    if (int_digits > 0 || frac_digits > 0) i = j;
  }
  if (int_digits == 0 && frac_digits == 0) return NAN;
  size_t end = i;
  if (i < n && (p[i] == 'e' || p[i] == 'E')) {
    size_t j = i + 1;
    if (j < n && (p[j] == '+' || p[j] == '-')) j++;
    size_t ed = j;
    while (j < n && p[j] >= '0' && p[j] <= '9') j++;
    if (j > ed) end = j; /* exponent joins only with digits ("1e" is 1) */
  }
  size_t span = end - start;
  char buf[64];
  char *tmp = span < sizeof(buf) ? buf : malloc(span + 1);
  if (!tmp) scr_oom();
  memcpy(tmp, p + start, span);
  tmp[span] = '\0';
  double r = strtod(tmp, NULL);
  if (tmp != buf) free(tmp);
  return r;
}

/* ToNumber(string) — ECMA-262 7.1.4.1 StringToNumber, exactly. The
 * grammar (StringNumericLiteral) differs from parseFloat's in all three
 * directions: the WHOLE trimmed span must match (trailing garbage → NaN,
 * where parseFloat keeps the longest prefix), the non-decimal 0x/0o/0b
 * integer literals join (UNSIGNED only — a sign on them is NaN), and the
 * empty/whitespace-only string is +0 (parseFloat: NaN). Decimal spans
 * convert through strtod like parseFloat (copied first — strtod's own
 * grammar is wider — inheriting correct rounding, the JSON precedent);
 * 0x/0o/0b digits are the exact mathematical value rounded to nearest-
 * even via scr_digits_to_double (u64 fast path, bignum beyond 2^64 —
 * Node-exact for giant hex, Infinity overflow included: power-of-two
 * radixes take the exact path, never V8's approximate chunk loop). */
double scr_string_to_number(ScrStr *s) {
#ifdef SCR_ARRCEN_ON
  scr_arrcen_note(SCR_ARRCEN_STR2NUM, (long long)s->len);
#endif
  const char *p = s->data;
  size_t b = 0, e = s->len;
  while (b < e) {
    size_t adv;
    uint32_t cp = scr_utf8_decode(p + b, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    b += adv;
  }
  while (e > b) {
    size_t cs = e - 1; /* back up to the lead byte of the last char */
    while (cs > b && ((unsigned char)p[cs] & 0xC0) == 0x80) cs--;
    size_t adv;
    uint32_t cp = scr_utf8_decode(p + cs, &adv);
    if (!scr_is_js_whitespace(cp)) break;
    e = cs;
  }
  if (b == e) return 0.0; /* empty or all StrWhiteSpace */
  p += b;
  size_t n = e - b;
  /* NonDecimalIntegerLiteral: 0x/0X, 0o/0O, 0b/0B — no sign admitted. */
  if (n >= 2 && p[0] == '0' &&
      (p[1] == 'x' || p[1] == 'X' || p[1] == 'o' || p[1] == 'O' ||
       p[1] == 'b' || p[1] == 'B')) {
    int radix = (p[1] == 'x' || p[1] == 'X') ? 16
              : (p[1] == 'o' || p[1] == 'O') ? 8
                                             : 2;
    size_t i = 2, dig_start = 2;
    while (i < n && scr_digit_value(p[i]) < radix) i++;
    if (i == dig_start || i != n) return NAN; /* no digits, or garbage */
    while (dig_start < i && p[dig_start] == '0') dig_start++;
    if (dig_start == i) return 0.0;
    return scr_digits_to_double(p + dig_start, i - dig_start, radix);
  }
  /* StrDecimalLiteral, whole-span: [+-]? (Infinity | digits [. digits*]
   * | . digits) ([eE][+-]?digits)? — nothing before, nothing after. */
  size_t i = 0;
  double sign = 1.0;
  if (p[0] == '+' || p[0] == '-') {
    if (p[0] == '-') sign = -1.0;
    i = 1;
  }
  if (n - i == 8 && memcmp(p + i, "Infinity", 8) == 0) {
    return sign * (double)INFINITY;
  }
  size_t int_digits = 0, frac_digits = 0;
  while (i < n && p[i] >= '0' && p[i] <= '9') {
    i++;
    int_digits++;
  }
  if (i < n && p[i] == '.') {
    i++;
    while (i < n && p[i] >= '0' && p[i] <= '9') {
      i++;
      frac_digits++;
    }
  }
  if (int_digits == 0 && frac_digits == 0) return NAN; /* ".", "+", "e5" */
  if (i < n && (p[i] == 'e' || p[i] == 'E')) {
    i++;
    if (i < n && (p[i] == '+' || p[i] == '-')) i++;
    size_t ed = i;
    while (i < n && p[i] >= '0' && p[i] <= '9') i++;
    if (i == ed) return NAN; /* "1e", "1e+" — exponent needs digits */
  }
  if (i != n) return NAN; /* trailing garbage ("1_000", "1.2.3", "12px") */
  char buf[64];
  char *tmp = n < sizeof(buf) ? buf : malloc(n + 1);
  if (!tmp) scr_oom();
  memcpy(tmp, p, n);
  tmp[n] = '\0';
  double r = strtod(tmp, NULL);
  if (tmp != buf) free(tmp);
  return r;
}

ScrStr *scr_f64_to_scrstr(double x) {
  char buf[32];
  size_t len = scr_f64_to_str(x, buf);
  return scr_str_new(buf, len);
}

/* ── encodeURIComponent / encodeURI ───────────────────────────────────
 * ECMA-262 Encode() over the UTF-8 storage. The spec transcodes UTF-16
 * to UTF-8 and percent-encodes every byte outside the unescaped set —
 * storage here already IS well-formed UTF-8 (lone surrogates were
 * substituted with U+FFFD at their producers, SEMANTICS.md 2), so the
 * walk is byte-wise and the spec's URIError arm (unpaired surrogates)
 * is unreachable: the encoders are total. Unescaped sets are the
 * spec's: uriUnescaped = ALPHA / DIGIT / -_.!~*'() for
 * encodeURIComponent; encodeURI keeps uriReserved ;/?:@&=+$, and #
 * too. Hex digits are uppercase, per spec. Borrows s; result +1. */
static bool scr_uri_unescaped(unsigned char c, bool keep_reserved) {
  if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) return true;
  switch (c) {
    case '-': case '_': case '.': case '!': case '~': case '*': case '\'': case '(': case ')':
      return true;
    default:
      break;
  }
  if (!keep_reserved) return false;
  switch (c) {
    case ';': case '/': case '?': case ':': case '@': case '&': case '=':
    case '+': case '$': case ',': case '#':
      return true;
    default:
      return false;
  }
}

static ScrStr *scr_encode_uri_impl(ScrStr *s, bool keep_reserved) {
  const unsigned char *b = (const unsigned char *)s->data;
  size_t n = s->len, out_len = 0;
  for (size_t i = 0; i < n; i++) out_len += scr_uri_unescaped(b[i], keep_reserved) ? 1 : 3;
  if (out_len == n) return scr_str_retain(s); /* nothing escapes — share */
  ScrStr *out = scr_str_alloc_raw(out_len, out_len);
  static const char hex[] = "0123456789ABCDEF";
  char *w = out->data;
  for (size_t i = 0; i < n; i++) {
    if (scr_uri_unescaped(b[i], keep_reserved)) {
      *w++ = (char)b[i];
    } else {
      *w++ = '%';
      *w++ = hex[b[i] >> 4];
      *w++ = hex[b[i] & 0xF];
    }
  }
  out->len = (uint32_t)out_len;
  out->data[out_len] = '\0';
  return out;
}

ScrStr *scr_encode_uri_component(ScrStr *s) { return scr_encode_uri_impl(s, false); }

ScrStr *scr_encode_uri(ScrStr *s) { return scr_encode_uri_impl(s, true); }

/* ── isWellFormed / toWellFormed ──────────────────────────────────────
 * Storage here IS well-formed by invariant: every producer substitutes
 * the lone surrogates JS strings could carry with U+FFFD at creation
 * (SEMANTICS.md 2), so no string this runtime can hold is ill-formed.
 * isWellFormed answers the constant the invariant guarantees and
 * toWellFormed is the identity (per spec both are no-ops on well-formed
 * input). A program whose Node run would see `false` already diverged
 * at the string's creation, not here. */
bool scr_str_is_well_formed(ScrStr *s) {
  (void)s;
  return true;
}

ScrStr *scr_str_to_well_formed(ScrStr *s) { return scr_str_retain(s); }

/* Immortal interned booleans (same layout trick the emitter uses for
 * string literals). */
static const SCR_STR_LIT(5) scr_lit_true = {SCR_STR_IMMORTAL, 4, 4, "true"};
static const SCR_STR_LIT(6) scr_lit_false = {SCR_STR_IMMORTAL, 5, 5, "false"};

ScrStr *scr_bool_to_scrstr(bool b) {
  return b ? (ScrStr *)&scr_lit_true : (ScrStr *)&scr_lit_false;
}

/* The string iterator's step (for-of over strings): the full CHARACTER at
 * UTF-16 index i — one code POINT, so an astral char comes back as its
 * whole two-unit string where charAt would truncate to U+FFFD. The
 * iterating loop advances by the result's UTF-16 length, exactly JS's
 * String[Symbol.iterator] contract. Storage is valid UTF-8 by invariant
 * (literals canonicalized lone surrogates to U+FFFD at creation), so every
 * decode is a whole char; an i addressing the LOW half of an astral pair
 * (unreachable from the iterator, which only lands on char starts) answers
 * the containing char. Out of range → empty string. Borrows s; +1. */
ScrStr *scr_str_cp_at(ScrStr *s, double i) {
  double idx = scr_to_integer_or_infinity(i);
  if (!(idx >= 0)) return scr_str_empty();
  if (idx >= (double)s->len) return scr_str_empty(); /* len16 <= len */
  ScrSidx *e = scr_sidx(s);
  if (e->u16len == s->len) { /* all ASCII */
    return (ScrStr *)&scr_ascii1[(unsigned char)s->data[(size_t)idx]];
  }
  bool mid;
  size_t off = scr_u16_to_byte_c(s, e, (size_t)idx, &mid);
  if (off >= s->len) return scr_str_empty(); /* out of range */
  size_t adv;
  (void)scr_utf8_decode(s->data + off, &adv);
  return scr_str_from_span(s->data + off, adv);
}


/* ── the URI component codecs (encodeURIComponent/decodeURIComponent) ──
 * ECMA-262 Encode/Decode with the component sets, byte-wise over the
 * runtime's UTF-8 storage: the spec percent-encodes each code point's
 * UTF-8 bytes, which over UTF-8 storage is exactly a byte scan, and
 * Decode's "octets must form a valid UTF-8 encoding" is a strict
 * validation of the assembled escape bytes (raw bytes copy through —
 * they are the already-valid encoding of code points the spec leaves
 * untouched). */

/* The component unreserved set: ALPHA / DIGIT / - _ . ! ~ * ' ( ). */
static bool scr_uri_unreserved(unsigned char c) {
  if ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9')) return true;
  switch (c) {
    case '-': case '_': case '.': case '!': case '~':
    case '*': case '\'': case '(': case ')':
      return true;
    default:
      return false;
  }
}

ScrStr *scr_str_encode_uri_component(ScrStr *s) {
  size_t extra = 0;
  for (size_t i = 0; i < s->len; i++) {
    if (!scr_uri_unreserved((unsigned char)s->data[i])) extra += 2;
  }
  if (extra == 0) {
    scr_str_retain(s);
    return s;
  }
  static const char hex[] = "0123456789ABCDEF";
  ScrStr *out = scr_str_alloc_raw(s->len + extra, s->len + extra);
  char *w = out->data;
  for (size_t i = 0; i < s->len; i++) {
    unsigned char c = (unsigned char)s->data[i];
    if (scr_uri_unreserved(c)) {
      *w++ = (char)c;
    } else {
      *w++ = '%';
      *w++ = hex[c >> 4];
      *w++ = hex[c & 0xf];
    }
  }
  out->data[out->len] = '\0';
  return out;
}

static void scr_uri_malformed(void) {
  scr_throw_error_named(scr_str_new("URIError", 8),
                        scr_str_new("URI malformed", 13));
}

/* One %XX escape's byte, or -1 (bad hex / truncated). */
static int scr_uri_hex_byte(const char *p, size_t rem) {
  if (rem < 3 || p[0] != '%') return -1;
  int hi, lo;
  char a = p[1], b = p[2];
  if (a >= '0' && a <= '9') hi = a - '0';
  else if (a >= 'A' && a <= 'F') hi = a - 'A' + 10;
  else if (a >= 'a' && a <= 'f') hi = a - 'a' + 10;
  else return -1;
  if (b >= '0' && b <= '9') lo = b - '0';
  else if (b >= 'A' && b <= 'F') lo = b - 'A' + 10;
  else if (b >= 'a' && b <= 'f') lo = b - 'a' + 10;
  else return -1;
  return (hi << 4) | lo;
}

/* The non-throwing core of decodeURIComponent: NULL on malformed input
 * (bad hex, invalid UTF-8 octets) instead of the URIError — the
 * querystring unit's unescape needs exactly the try/catch shape Node's
 * qsUnescape wraps around decodeURIComponent (scr_qs.c), and the throwing
 * entry point below stays byte-identical by rethrowing over NULL. */
ScrStr *scr_str_decode_uri_component_try(ScrStr *s) {
  /* Decoding only ever shrinks (%XX → 1 byte), so len is a safe cap. */
  ScrStr *out = scr_str_alloc_raw(0, s->len);
  size_t w = 0;
  const char *p = s->data;
  size_t n = s->len, i = 0;
  while (i < n) {
    if (p[i] != '%') {
      out->data[w++] = p[i++];
      continue;
    }
    int b0 = scr_uri_hex_byte(p + i, n - i);
    if (b0 < 0) goto malformed;
    i += 3;
    if (b0 < 0x80) {
      /* The empty component reserved set: every ASCII escape decodes. */
      out->data[w++] = (char)b0;
      continue;
    }
    /* Multibyte: the continuation bytes must ALSO be escapes (a raw byte
     * is its own code point in the spec's string, never a continuation),
     * and the whole sequence must be strictly valid UTF-8. */
    int need;                /* continuation count */
    int lo = 0x80, hi = 0xBF; /* first continuation's tightened range */
    if (b0 >= 0xC2 && b0 <= 0xDF) need = 1;
    else if (b0 == 0xE0) { need = 2; lo = 0xA0; }
    else if (b0 == 0xED) { need = 2; hi = 0x9F; } /* no surrogates */
    else if (b0 >= 0xE1 && b0 <= 0xEF) need = 2;
    else if (b0 == 0xF0) { need = 3; lo = 0x90; }
    else if (b0 == 0xF4) { need = 3; hi = 0x8F; } /* <= U+10FFFF */
    else if (b0 >= 0xF1 && b0 <= 0xF3) need = 3;
    else goto malformed; /* 0x80..0xC1, 0xF5..0xFF: never a leading byte */
    out->data[w++] = (char)b0;
    for (int k = 0; k < need; k++) {
      int bc = scr_uri_hex_byte(p + i, n - i);
      if (bc < 0) goto malformed;
      if (k == 0 ? (bc < lo || bc > hi) : (bc < 0x80 || bc > 0xBF)) goto malformed;
      i += 3;
      out->data[w++] = (char)bc;
    }
  }
  out->len = (uint32_t)w;
  out->data[w] = '\0';
  return out;
malformed:
  scr_str_release(out);
  return NULL;
}

ScrStr *scr_str_decode_uri_component(ScrStr *s) {
  ScrStr *out = scr_str_decode_uri_component_try(s);
  if (!out) {
    scr_uri_malformed();
    return NULL;
  }
  return out;
}
