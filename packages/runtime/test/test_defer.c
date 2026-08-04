/* Ownership of a DEFERRED CALL THAT CARRIES AN ARGUMENT.
 *
 * Every deferral queue in this runtime holds ONE ZERO-ARGUMENT closure
 * per entry, so a deferred call with arguments is a closure that CAPTURED
 * them. That makes the arguments' lifetime the capture box's, and this
 * binary pins the moments where a mistake would be silent:
 *
 *   1. the deferral FIRES       — the arguments are alive and correct
 *                                 inside the call, and released after;
 *   2. the deferral NEVER fires — the loop's teardown drops the queue and
 *                                 must still release exactly once;
 *   3. the deferring call THROWS before it ever enqueues — randomFill
 *                                 validates its range Node-style, and the
 *                                 thunk it was handed must not leak.
 *
 * scr_random_fill.c needs exactly ONE runtime symbol beyond the bytes
 * core — the deferral entry point — so this binary supplies its own and
 * compiles the primitive against nothing else. A failure here can only
 * mean randomFill is wrong: the queue is right there in this file.
 *
 * Built with -DSCR_RC_AUDIT: scr_box_live_count / scr_closure_live_count
 * / scr_bytes_live_count / scr_str_live_count are the observers. A
 * missing release shows up as a count that never returns to its start; a
 * double release shows up as one that goes below it (and, where the
 * toolchain can link ASan, as a use-after-free).
 */
#include "../src/scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern long scr_box_live_count(void);
extern long scr_closure_live_count(void);
extern long scr_bytes_live_count(void);
extern long scr_str_live_count(void);

static int failures = 0;
#define CHECK(cond)                                                            \
  do {                                                                         \
    if (!(cond)) {                                                             \
      failures++;                                                              \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);          \
    }                                                                          \
  } while (0)

/* ── the deferral queue, standing in for the loop's ─────────────────────
 * scr_set_immediate's contract, and nothing else: the closure MOVES in, the
 * queue owns it, firing calls it and releases it, teardown releases it
 * without calling. Keeping it here is what lets the primitive compile
 * alone — and it is also the contract under test, so a randomFill that
 * released `done` on a path that also enqueued it would show up as a
 * count below the baseline. */
#define QCAP 8
static ScrClosure *queue[QCAP];
static size_t qlen;

double scr_set_immediate(ScrClosure *cb /*moves*/) {
  if (qlen >= QCAP) abort();
  queue[qlen++] = cb;
  return (double)qlen;
}

static size_t drain(void) {
  size_t n = qlen;
  for (size_t i = 0; i < n; i++) {
    ScrClosure *c = queue[i];
    ((void (*)(ScrClosure *))c->fn)(c);
    scr_closure_release(c);
  }
  qlen = 0;
  return n;
}

static void teardown(void) {
  for (size_t i = 0; i < qlen; i++) scr_closure_release(queue[i]);
  qlen = 0;
}

/* ── the compiled shape of a lifted deferral thunk ──────────────────────
 * A zero-argument closure whose captures ARE the callback's arguments:
 * caps[0] a string (standing in for the `error` argument), caps[1] the
 * bytes (Node's second argument — the SAME buffer, never a copy). */
static int ran;
static size_t seen_len;
static char seen_str[64];
static const uint8_t *seen_data;

static void thunk_impl(ScrClosure *env) {
  ran++;
  ScrStr *s = (ScrStr *)scr_box_get_ref(env->caps[0]);    /* +1 */
  ScrBytes *b = (ScrBytes *)scr_box_get_ref(env->caps[1]); /* +1 */
  snprintf(seen_str, sizeof seen_str, "%s", s->data);
  seen_len = b->len;
  seen_data = b->data;
  scr_str_release(s);
  scr_bytes_release(b);
}

/* Built the way the lowering builds one: the argument expressions are
 * evaluated at the DEFERRING call and moved into capture boxes, so the
 * closure owns them from the moment it is scheduled. */
static ScrClosure *make_thunk(const char *text, ScrBytes *arg /*borrowed*/) {
  ScrClosure *c = scr_closure_new((void *)&thunk_impl, 2);
  ScrBox *sb = scr_box_new(SCR_BOX_STR);
  scr_box_set_ref(sb, scr_str_new(text, strlen(text)));
  ScrBox *bb = scr_box_new_obj(&scr_bytes_retain_v, &scr_bytes_release_v, NULL);
  scr_box_set_ref(bb, scr_bytes_retain(arg));
  c->caps[0] = sb;
  c->caps[1] = bb;
  return c;
}

int main(void) {
  const long box0 = scr_box_live_count();
  const long clo0 = scr_closure_live_count();
  const long byt0 = scr_bytes_live_count();
  const long str0 = scr_str_live_count();

  ScrBytes *target = scr_bytes_new(SCR_BYTES_U8, 8);
  const long byt1 = scr_bytes_live_count(); /* target is live from here */

  /* ── 1. the deferral FIRES ──────────────────────────────────────────
   * Three deferrals, each carrying its own arguments. Every capture must
   * be gone afterwards, and each call must have seen ITS OWN argument. */
  ran = 0;
  scr_set_immediate(make_thunk("first", target));
  scr_set_immediate(make_thunk("second", target));
  scr_set_immediate(make_thunk("third", target));
  CHECK(scr_closure_live_count() == clo0 + 3); /* the queue owns them */
  CHECK(scr_box_live_count() == box0 + 6);
  CHECK(drain() == 3);
  CHECK(ran == 3);
  CHECK(strcmp(seen_str, "third") == 0); /* FIFO: the last one ran last */
  CHECK(seen_data == target->data);      /* the SAME buffer, not a copy */
  CHECK(scr_closure_live_count() == clo0);
  CHECK(scr_box_live_count() == box0);
  CHECK(scr_bytes_live_count() == byt1);
  CHECK(scr_str_live_count() == str0);

  /* ── 2. the deferral NEVER fires ────────────────────────────────────
   * The loop's teardown drops the queue at exit. The entry releases the
   * closure, and the closure releases the arguments — the path where a
   * leak is invisible because nothing ever touches the value again. */
  ran = 0;
  scr_set_immediate(make_thunk("dropped", target));
  scr_set_immediate(make_thunk("dropped-too", target));
  teardown();
  CHECK(ran == 0);
  CHECK(scr_closure_live_count() == clo0);
  CHECK(scr_box_live_count() == box0);
  CHECK(scr_bytes_live_count() == byt1);
  CHECK(scr_str_live_count() == str0);

  /* ── 3. the deferring call THROWS ───────────────────────────────────
   * randomFill validates offset/size Node-style and throws
   * ERR_OUT_OF_RANGE synchronously. The thunk was already handed over, so
   * the throwing path owns it: no enqueue, and no leak either. */
  ran = 0;
  scr_crypto_random_fill_deferred(target, 4, 99, true, make_thunk("never", target));
  CHECK(scr_exc_pending());
  scr_exc_clear();
  CHECK(qlen == 0);
  CHECK(ran == 0);
  CHECK(scr_closure_live_count() == clo0);
  CHECK(scr_box_live_count() == box0);
  CHECK(scr_bytes_live_count() == byt1);

  scr_crypto_random_fill_deferred(target, -1, 1, true, make_thunk("never", target));
  CHECK(scr_exc_pending());
  scr_exc_clear();
  CHECK(qlen == 0 && scr_closure_live_count() == clo0 && scr_box_live_count() == box0);

  scr_crypto_random_fill_deferred(target, 9, 0, true, make_thunk("never", target));
  CHECK(scr_exc_pending());
  scr_exc_clear();
  CHECK(qlen == 0 && scr_closure_live_count() == clo0 && scr_box_live_count() == box0);

  scr_crypto_random_fill_deferred(target, 0, 2147483648.0, true, make_thunk("never", target));
  CHECK(scr_exc_pending());
  scr_exc_clear();
  CHECK(qlen == 0 && scr_closure_live_count() == clo0 && scr_box_live_count() == box0);

  /* ── 4. the fill itself ─────────────────────────────────────────────
   * Bytes outside [offset, offset+size) are untouched, and the callback
   * is DEFERRED — not called during the call. */
  for (size_t i = 0; i < 8; i++) target->data[i] = 0xAA;
  ran = 0;
  scr_crypto_random_fill_deferred(target, 2, 4, true, make_thunk("filled", target));
  CHECK(!scr_exc_pending());
  CHECK(ran == 0); /* deferred, never called in line */
  CHECK(qlen == 1);
  CHECK(target->data[0] == 0xAA && target->data[1] == 0xAA);
  CHECK(target->data[6] == 0xAA && target->data[7] == 0xAA);
  CHECK(drain() == 1);
  CHECK(ran == 1);
  CHECK(scr_closure_live_count() == clo0 && scr_box_live_count() == box0);

  /* An OMITTED size fills to the end of the buffer from the offset — the
   * has_size=false arm, which no numeric sentinel could encode. */
  for (size_t i = 0; i < 8; i++) target->data[i] = 0;
  scr_crypto_random_fill_deferred(target, 5, 0, false, make_thunk("to-end", target));
  CHECK(!scr_exc_pending());
  CHECK(target->data[4] == 0); /* below the offset: untouched */
  {
    /* The tail is drawn: 3 bytes are zero together with probability
     * 2^-24, so a run of this that ever fails is a broken fill, not luck
     * — and the point is that the DEFAULT reached the end at all. */
    int nz = 0;
    for (size_t i = 5; i < 8; i++) if (target->data[i] != 0) nz++;
    CHECK(nz > 0);
  }
  CHECK(drain() == 1);

  /* A ZERO-length draw calls back IN LINE — Node's own quirk (a size of
   * 0, an empty buffer, or an offset at the end all answer synchronously;
   * a single byte does not). Nothing is queued, so this path owns the
   * release: a leak or a double release here shows in the counters. */
  ran = 0;
  scr_crypto_random_fill_deferred(target, 8, 0, true, make_thunk("empty", target));
  CHECK(!scr_exc_pending());
  CHECK(ran == 1);   /* called in line */
  CHECK(qlen == 0);  /* and never queued */
  CHECK(scr_closure_live_count() == clo0 && scr_box_live_count() == box0);
  ran = 0;
  scr_crypto_random_fill_deferred(target, 0, 0, false, make_thunk("empty-default", target));
  CHECK(scr_exc_pending() == false && ran == 0 && qlen == 1); /* len 8: deferred */
  CHECK(drain() == 1 && ran == 1);
  CHECK(scr_closure_live_count() == clo0 && scr_box_live_count() == box0);

  scr_bytes_release(target);
  CHECK(scr_bytes_live_count() == byt0);
  CHECK(scr_str_live_count() == str0);

  if (failures != 0) {
    fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  fprintf(stderr, "all defer tests passed\n");
  return 0;
}
