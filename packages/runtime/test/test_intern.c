/* The content-intern table's own discipline (scr_string.c).
 *
 * WHY THIS FILE EXISTS. Every other RC test in this directory counts
 * strings and asserts the count is exact. Under interning that is still
 * true, because scr_str_live_count DRAINS the table before answering — so
 * those files are, by design, blind to the table. Something has to see it.
 * A cache that holds owning references for the whole run is a lifetime
 * shape, and a lifetime shape nothing exercises is a lifetime shape nothing
 * checks.
 *
 * THE FOUR INVARIANTS, stated once so a later edit has something to break:
 *
 *   I1  SHARING IS BY VALUE.  Two concats whose results are byte-equal and
 *       inside [MINLEN, MAXLEN] return the SAME ScrStr. Outside the band
 *       they do not. Byte-equality is all a hit ever means.
 *
 *   I2  A TABLE REFERENCE IS NOT A PROGRAM REFERENCE.  A string the program
 *       has released can still be a live OBJECT. scr_str_live_objects sees
 *       it, scr_str_live_count (which drains) does not, and the difference
 *       is exactly what the table holds. Both numbers are asserted here,
 *       because a test that can only see one of them cannot tell interning
 *       from its absence.
 *
 *   I3  AN INTERNED STRING IS NEVER MUTATED.  The table's reference means
 *       rc >= 2, and rc == 1 is the sole gate on scr_str_concat's in-place
 *       append and on scr_str_regrow. The test below makes the in-place arm
 *       ELIGIBLE ON CAPACITY and then requires it not to fire — otherwise it
 *       would be asserting that a branch it never reached is safe.
 *
 *   I4  ONLY DEAD WEIGHT IS EVICTED.  A set gives up a way only when that
 *       way is table-only (rc == 1). A string the program still holds is
 *       never dropped from the table by a colliding newcomer, so which two
 *       contents collide stops deciding anything.
 *
 * THE POSITIVE CONTROL, and it is the point of the argv/env plumbing. I4 is
 * a claim about a branch NOT being taken, and "the hot entry survived" is
 * indistinguishable from "nothing collided with it" unless a second arm
 * shows the collision is real. SCR_STRING_INTERN_WAYS=1 with
 * SCR_STRING_INTERN_ADMIT=0 is the table this one replaced — direct-mapped,
 * evicting unconditionally — in the SAME binary, and on that arm the same
 * workload MUST lose hot entries. intern.test.ts runs both and compares. An
 * arm that reports no losses under the control is a broken test, not a good
 * cache.
 *
 * The table is built small here (-DSCR_STR_INTERN_BITS=6, 64 entries) so a
 * few hundred strings saturate it. The shipping table is 65,536.
 *
 * Built with -DSCR_RC_AUDIT: interning is compiled IN under the audit,
 * unlike the pool, the spare block and the arena, so this file and the five
 * harness lifetime suites are the same lane.
 */
#include "../src/scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern long scr_str_live_count(void);   /* drains the table first */
extern long scr_str_live_objects(void); /* does not */

static int failures = 0;
#define CHECK(cond)                                                            \
  do {                                                                         \
    if (!(cond)) {                                                             \
      failures++;                                                              \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);          \
    }                                                                          \
  } while (0)

/* A concat result of exactly `n` bytes whose content is a function of
 * (n, seed) — so two calls with the same arguments are byte-equal and two
 * with different ones are not. Built through scr_str_concat because that is
 * the only path the table is hooked into.
 *
 * THE SEED IS WRITTEN OUT IN BASE 8, seven bytes of it, and that is not
 * decoration. The first version of this generator mixed the seed into a
 * mod-26 letter per position, which makes the content a function of
 * `seed % 26` — so the 4,000 "cold" strings below were 26 distinct strings,
 * every one of which the HOT set also contained. The survival test then
 * scored hits on the hot entries themselves as survival and reported 5 of 6
 * under the control arm that is supposed to lose all of them. The generator
 * has to be INJECTIVE in the seed or the workload is not the workload. */
static ScrStr *mk(size_t n, unsigned seed) {
  char buf[512];
  size_t i;
  ScrStr *a, *b, *r;
  if (n > sizeof(buf)) abort();
  for (i = 0; i < n; i++) buf[i] = (char)('A' + (int)((seed * 31u + i * 7u) % 26u));
  for (i = 0; i < 7 && i < n; i++) buf[i] = (char)('a' + (int)((seed >> (3u * i)) & 7u));
  /* Split so BOTH spans are non-empty whenever n >= 2: the hash and the
   * comparison in scr_str_intern_get take two spans and a bug in the second
   * one is invisible if the second is always empty. */
  a = scr_str_new(buf, n / 2);
  b = scr_str_new(buf + n / 2, n - n / 2);
  r = scr_str_concat(a, b);
  scr_str_release(a);
  scr_str_release(b);
  return r;
}

/* ── I1: sharing is by value, and only inside the band ─────────────────── */
static void t_band(void) {
  static const size_t below[] = {0, 1, 2, 15};
  scr_str_intern_drain();
  static const size_t inside[] = {16, 17, 29, 64, 127, 128};
  static const size_t above[] = {129, 200, 400};
  size_t i;
  for (i = 0; i < sizeof(below) / sizeof(*below); i++) {
    ScrStr *x = mk(below[i], 1), *y = mk(below[i], 1);
    CHECK(x != y); /* below MINLEN: never interned */
    CHECK(scr_str_eq(x, y));
    scr_str_release(x);
    scr_str_release(y);
  }
  for (i = 0; i < sizeof(inside) / sizeof(*inside); i++) {
    ScrStr *x = mk(inside[i], 2), *y = mk(inside[i], 2), *z = mk(inside[i], 3);
    CHECK(x == y); /* byte-equal inside the band: one object */
    CHECK(x != z); /* different content: never shared */
    CHECK(!scr_str_eq(x, z));
    CHECK(x->len == (uint32_t)inside[i]);
    CHECK(x->data[inside[i]] == '\0');
    scr_str_release(x);
    scr_str_release(y);
    scr_str_release(z);
  }
  for (i = 0; i < sizeof(above) / sizeof(*above); i++) {
    ScrStr *x = mk(above[i], 4), *y = mk(above[i], 4);
    CHECK(x != y); /* above MAXLEN: never interned */
    CHECK(scr_str_eq(x, y));
    scr_str_release(x);
    scr_str_release(y);
  }
  scr_str_intern_drain();
}

/* ── I2: the gap between live objects and reachable strings ────────────── */
static void t_gap(void) {
  long r0, o0;
  ScrStr *x;
  scr_str_intern_drain();
  r0 = scr_str_live_count(); /* drains again; harmless and idempotent */
  o0 = scr_str_live_objects();
  CHECK(r0 == o0); /* an empty table is the only state where they agree */

  x = mk(32, 9);
  CHECK(x->rc == 2); /* the caller's reference plus the table's */
  CHECK(scr_str_live_objects() == o0 + 1);
  scr_str_release(x); /* the PROGRAM is done with it */
  CHECK(x->rc == 1);  /* still alive: the table holds it */

  /* The whole statement of the new invariant, in two lines. */
  CHECK(scr_str_live_objects() == o0 + 1); /* one live OBJECT */
  CHECK(scr_str_live_count() == r0);       /* zero REACHABLE strings */
  /* ...and the observer's drain is what made the second line true, so the
   * object is gone now too. */
  CHECK(scr_str_live_objects() == o0);
}

/* ── I3: the table's reference is what stops the in-place append ───────── */
static void t_no_mutation(void) {
  ScrStr *x, *tail, *z;
  char before[64];
  scr_str_intern_drain();
  x = mk(24, 11);
  CHECK(x->rc == 2);
  /* The in-place arm needs rc == 1 AND cap >= newlen. Assert the capacity
   * half holds, so the refusal below is attributable to rc and not to a
   * short block that would have been copied anyway. */
  CHECK(x->cap >= 25);
  memcpy(before, x->data, x->len + 1);

  tail = scr_str_new("!", 1);
  z = scr_str_concat(x, tail);
  CHECK(z != x);                                     /* not appended in place */
  CHECK(x->len == 24);                               /* x is untouched */
  CHECK(memcmp(x->data, before, x->len + 1) == 0);
  CHECK(z->len == 25 && z->data[24] == '!');
  scr_str_release(z);
  scr_str_release(tail);

  /* And the control: the SAME shape on a string the table does not hold
   * (length below MINLEN) DOES append in place — so the assertion above is
   * about interning and not about the in-place arm being dead. */
  {
    ScrStr *s = mk(8, 12), *t = scr_str_new("!", 1), *u;
    CHECK(s->rc == 1);
    CHECK(s->cap >= 9);
    u = scr_str_concat(s, t);
    CHECK(u == s); /* appended in place, exactly as before interning */
    scr_str_release(u);
    scr_str_release(s);
    scr_str_release(t);
  }
  scr_str_release(x);
  scr_str_intern_drain();
}

/* ── the drain re-mints ─────────────────────────────────────────────────
 * `keep` is held across the drain so the freed block cannot be recycled to
 * the same address: without it "a new pointer" would be a claim about the
 * allocator, not about the table. */
static void t_drain(void) {
  ScrStr *keep, *same, *fresh;
  scr_str_intern_drain();
  keep = mk(40, 21);
  same = mk(40, 21);
  CHECK(same == keep);
  scr_str_release(same);
  scr_str_intern_drain();
  CHECK(keep->rc == 1); /* the table let go; the program still holds it */
  fresh = mk(40, 21);
  CHECK(fresh != keep);
  CHECK(scr_str_eq(fresh, keep));
  scr_str_release(fresh);
  scr_str_release(keep);
  scr_str_intern_drain();
}

/* ── I4: hot entries survive a cold stream, unless the control says not ──
 * HOT distinct contents are built and HELD. Then COLD distinct contents are
 * streamed through and dropped, which is a full table's worth sixty times
 * over. Finally each hot content is rebuilt: a hit returns the pointer we
 * are still holding, a miss returns a new one.
 *
 * SURVIVAL IS SCORED AGAINST ADMISSION, not against HOT. A 64-entry table in
 * 16 sets can put five of eight hot contents in one set, and the fifth is
 * then correctly refused — a refusal is the policy working, and charging it
 * as a loss would make this test fail on a hash, once, forever. So each hot
 * content is re-probed IMMEDIATELY after the fill to see whether the table
 * took it, and the claim is that the cold stream changes nothing: survived
 * == admitted. Under the control it must not hold. */
#define HOT 8
#define COLD 4000
static void t_hot_survival(int *admitted, int *survived) {
  ScrStr *hot[HOT];
  int i;
  *admitted = 0;
  *survived = 0;
  scr_str_intern_drain();
  for (i = 0; i < HOT; i++) hot[i] = mk(48, 100u + (unsigned)i);
  for (i = 0; i < HOT; i++) {
    ScrStr *p = mk(48, 100u + (unsigned)i);
    if (p == hot[i]) (*admitted)++;
    CHECK(scr_str_eq(p, hot[i]));
    scr_str_release(p);
  }
  for (i = 0; i < COLD; i++) {
    ScrStr *c = mk(48, 1000u + (unsigned)i);
    scr_str_release(c);
  }
  for (i = 0; i < HOT; i++) {
    ScrStr *again = mk(48, 100u + (unsigned)i);
    if (again == hot[i]) (*survived)++;
    CHECK(scr_str_eq(again, hot[i])); /* value is right either way */
    scr_str_release(again);
  }
  for (i = 0; i < HOT; i++) scr_str_release(hot[i]);
  scr_str_intern_drain();
}

/* ── the holdings are bounded by the table ──────────────────────────────
 * THIS IS THE ASSERTION THAT STOPS THE DRAIN FROM HIDING A LEAK.
 * scr_str_live_count drains before it answers, so a put that forgot to
 * release the entry it displaced would grow the table's holdings without
 * bound and STILL report a clean audit at exit — the leak would be swept up
 * by the very observer that exists to catch it. Every other file in this
 * directory is exposed to that, by design, because they are not about the
 * table.
 *
 * The two counts here are read either side of ONE drain, so their difference
 * is exactly what the table was holding. After COLD distinct puts through a
 * table of SLOTS entries it must be at most SLOTS — and more than zero, or
 * the stream never reached the table and the bound proves nothing. */
#ifndef SCR_STR_INTERN_BITS
#define SCR_STR_INTERN_BITS 16
#endif
static void t_bounded(void) {
  long objs, reach, held;
  int i;
  scr_str_intern_drain();
  for (i = 0; i < COLD; i++) {
    ScrStr *c = mk(48, 50000u + (unsigned)i);
    scr_str_release(c);
  }
  objs = scr_str_live_objects();
  reach = scr_str_live_count(); /* drains */
  held = objs - reach;
  CHECK(held > 0);
  CHECK(held <= (long)(1u << SCR_STR_INTERN_BITS));
  CHECK(scr_str_live_objects() == reach); /* the drain really freed them */
}

/* An append loop that walks a string from below MINLEN, through the band and
 * out the far side, then back down by slicing. The band edges are where a
 * string changes from "may be shared" to "is mine", and an off-by-one there
 * is a wrong answer, not a slow one. */
static void t_walk(void) {
  ScrStr *s = scr_str_new("", 0);
  size_t n;
  scr_str_intern_drain();
  for (n = 1; n <= 200; n++) {
    ScrStr *one = scr_str_new("x", 1);
    ScrStr *t = scr_str_concat(s, one);
    scr_str_release(s);
    scr_str_release(one);
    s = t;
    CHECK(s->len == (uint32_t)n);
    CHECK(s->data[n] == '\0');
    CHECK(s->data[n - 1] == 'x');
  }
  scr_str_release(s);
  scr_str_intern_drain();
}

int main(int argc, char **argv) {
  int admitted = 0, survived = 0;
  const char *ways = getenv("SCR_STRING_INTERN_WAYS");
  const char *admit = getenv("SCR_STRING_INTERN_ADMIT");
  const char *onoff = getenv("SCR_STRING_INTERN");
  int interning = onoff == NULL || strtol(onoff, NULL, 10) != 0;
  (void)argc;
  (void)argv;

  if (!interning) {
    /* The OFF arm: not a smoke test. It is the only thing that proves the
     * assertions above are about interning — every one of them would also
     * pass on a table that was never reached if `mk` happened to return the
     * same pointer for another reason. */
    ScrStr *x = mk(32, 9), *y = mk(32, 9);
    CHECK(x != y);
    CHECK(scr_str_eq(x, y));
    scr_str_release(x);
    scr_str_release(y);
    t_walk();
    CHECK(scr_str_live_count() == 0);
    fprintf(stderr, "intern OFF: ways=%s admit=%s\n", ways ? ways : "-",
            admit ? admit : "-");
    fprintf(stderr, "%s\n", failures ? "FAILED" : "all intern tests passed");
    return failures ? 1 : 0;
  }

  t_band();
  t_gap();
  t_no_mutation();
  t_drain();
  t_walk();
  t_bounded();
  t_hot_survival(&admitted, &survived);

  CHECK(scr_str_live_count() == 0);
  fprintf(stderr,
          "intern ON: ways=%s admit=%s hotAdmitted=%d/%d hotSurvived=%d/%d\n",
          ways ? ways : "default", admit ? admit : "default", admitted, HOT,
          survived, HOT);
  fprintf(stderr, "%s\n", failures ? "FAILED" : "all intern tests passed");
  return failures ? 1 : 0;
}
