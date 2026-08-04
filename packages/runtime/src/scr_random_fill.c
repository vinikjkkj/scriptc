/* crypto.randomFill: the fill, and the DEFERRED callback.
 *
 * The draw is the same CSPRNG randomBytes uses and is three lines. What
 * makes randomFill a different function from randomFillSync is that Node
 * delivers its callback ASYNCHRONOUSLY — the job runs on the threadpool
 * and completes in the poll phase — so calling it in line would reorder
 * observably against every tick and microtask the caller scheduled
 * before it.
 *
 * `done` is the compiler's deferral thunk: a ZERO-argument closure that
 * has ALREADY CAPTURED the callback and the arguments it must be called
 * with (deferredCallThunk, in the call lowering). That is why nothing
 * here knows a randomFill callback takes `(err, buf)`: a deferral queue
 * entry is one closure, and a closure IS a call with its arguments
 * supplied — so the arguments are released with it, exactly once, by
 * scr_closure_release, whether the entry fires or the loop's teardown
 * drops it unrun. It is also why the station below is a free choice:
 * nothing about the arguments is tied to which queue carries them.
 *
 * THE STATION is the check phase (setImmediate's queue). Node's own
 * answer, measured over five runs, is
 * `micro | tick-before | tick-after | cb | immediate`: the callback lands
 * after the WHOLE nextTick/microtask checkpoint, and before an immediate.
 * Its order against a 0ms timer came out both ways — that one is a real
 * threadpool race, so nothing finer than this is pinnable.
 *
 * All three candidate queues were measured against that, and each is
 * exact on one side of it:
 *  - the TICK queue is too early: a tick runs FIFO with the ticks around
 *    it, so a nextTick written after the randomFill call would run second
 *    where Node runs it first (the differential showed exactly that).
 *  - the 0ms TIMER is too late: Node's own delay coercion clamps 0 to 1ms
 *    (scr_timer_coerce_ms), so it lands after the check phase, not before
 *    it — the differential showed that too.
 *  - the CHECK phase gets the checkpoint boundary right, and is wrong
 *    only against another immediate registered earlier. That is the
 *    narrowest of the three, so it wins.
 *
 * OWNERSHIP: `done` MOVES in. Every path either hands it to
 * scr_set_immediate (which takes it) or releases it. The three validation
 * throws are the paths that matter, because a leak there is invisible:
 * nothing else ever names the closure again.
 *
 * This is its own translation unit for the same reason scr_cipher.c is:
 * the deferral entry point is the ONLY runtime symbol it needs beyond
 * the bytes core, so the ownership test binary can supply that one
 * symbol itself and compile this file against nothing else. A failure
 * there can only mean randomFill is wrong.
 *
 * ONE NAMED DIVERGENCE from Node, inside what Node guarantees: the bytes
 * land before the call returns. Node's worker may write them at any
 * moment before the callback fires and promises nothing about the range
 * until then, so no conforming program can tell.
 */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h> /* arc4random_buf off win32 (scr_win.c declares the shim) */

void scr_crypto_random_fill_deferred(ScrBytes *b, double offset, double size,
                                     bool has_size, ScrClosure *done /*moves*/) {
  char recv[48];
  char msg[176];
  /* Node's validators in Node's order (assertOffset, then assertSize,
   * then the size+offset sum), so a call that is wrong twice reports the
   * one Node reports. Element size is 1: the lowering admits only
   * Uint8Array/Buffer targets.
   *
   * `has_size` distinguishes an OMITTED size (Node fills to the end of
   * the buffer) from a written one, because every numeric sentinel that
   * could encode "omitted" is a value Node itself rejects with an error
   * this would then have to stop reporting. */
  const double maxoff = (double)b->len;
  if (!(offset >= 0 && offset <= maxoff)) {
    size_t rn = scr_num_received(offset, recv);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"offset\" is out of range. It must be >= 0 && <= %.0f. Received %.*s",
                        maxoff, (int)rn, recv);
    scr_closure_release(done);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return;
  }
  if (!has_size) size = maxoff - (double)(size_t)offset;
  if (!(size >= 0 && size <= 2147483647)) {
    size_t rn = scr_num_received(size, recv);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"size\" is out of range. It must be >= 0 && <= 2147483647. Received %.*s",
                        (int)rn, recv);
    scr_closure_release(done);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return;
  }
  if (size + offset > maxoff) {
    size_t rn = scr_num_received(size + offset, recv);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"size + offset\" is out of range. It must be <= %.0f. Received %.*s",
                        maxoff, (int)rn, recv);
    scr_closure_release(done);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return;
  }
  /* Node truncates both toward zero (`>>> 0` over the validated values),
   * so a fractional offset addresses the byte below it. */
  size_t off = (size_t)offset;
  size_t len = (size_t)size;
  if (off + len > b->len) len = b->len - off; /* belt: the sum was checked */
  if (len == 0) {
    /* A ZERO-length draw calls back IN LINE. Node's quirk, not an
     * approximation of one: the differential caught it (`size0 cb sync?
     * true`, and the same for an empty buffer and for offset == length,
     * against `false` for a single byte). Nothing was queued, so this
     * path owns the release; a throw out of the callback propagates from
     * the randomFill call, which is also what Node does. */
    ((void (*)(ScrClosure *))done->fn)(done);
    scr_closure_release(done);
    return;
  }
  arc4random_buf(b->data + off, len);
  scr_set_immediate(done); /* takes ownership; the handle is not exposed */
}
