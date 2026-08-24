/* fetch's `dispatcher`, honoured.
 *
 * WHAT THE ORACLE DOES, measured against Node v25.9.0 and re-measured on
 * every gate by tests/harness/fetch-dispatcher.test.ts: `fetch(url, {
 * dispatcher })` never dials. It builds undici's request-options record
 * and a ten-member handler and hands BOTH to
 * `dispatcher.dispatch(opts, handler)`; the dispatcher performs the
 * request over whatever transport it likes and drives the response back
 * through `handler.onHeaders(status, headers, resume, statusText)`,
 * `handler.onData(chunk)` and `handler.onComplete(trailers)`, or fails it
 * with `handler.onError(err)`.
 *
 * WHY THIS IS NOT scr_ws_dispatch.c, and the map is worth stating because
 * the shapes are IDENTICAL and the machinery is not. The handler is the
 * same ten members in the same order with the same arities, and `opts` is
 * the same seven keys in the same order -- both measured on both paths, on
 * one Node build, rather than read out of undici. What differs is which
 * members are ACTIVE and where the answer goes:
 *
 *   ws     onUpgrade / onRequestUpgrade carry a SOCKET; this unit's five
 *          response members are inert. The delivery end is an ScrNetSocket
 *          adopted into an ScrWsClient, and the response head is REBUILT
 *          so the handshake validator sees it.
 *   fetch  onHeaders / onData / onComplete carry the RESPONSE; the two
 *          upgrade members are inert. There is no socket at all: the
 *          delivery end is the ScrFetchXfer the request already owns, and
 *          the head is not rebuilt because there is no handshake to check.
 *
 * So nothing of scr_ws_dispatch.c's body is reusable -- it is socket
 * adoption and handshake replay from end to end -- while its PATTERN is
 * reused whole: closures minted with scr_dyn_new_func over a capture box,
 * a human-readable `sig` that can never collide with a typeKey, the
 * call/return ABI proved by the COMPILER rather than guessed here, the
 * last-handler-member release meaning "nobody can answer", and the pending
 * exception checked after `dispatch` returns.
 *
 * The two units are independently link-gated and neither names a symbol of
 * the other, which is also why the duplication is deliberate.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM NODE, and both are the loud
 * direction:
 *
 *   1. A REQUEST BODY is refused rather than delegated. `opts.body` is an
 *      async generator in the oracle and this runtime has no dyn value of
 *      that shape; handing a dispatcher a byte array instead would make
 *      `for await` yield one NUMBER per byte and send a body of decimal
 *      digits with nobody told. The refusal is in scr_fetch_static.c, at
 *      the call, and it names what is missing.
 *   2. `onError` AFTER the head errors the body; the oracle leaves the
 *      body promise unsettled FOREVER (measured: `.text()` had not settled
 *      after six seconds). A hang is not an answer, and this runtime's own
 *      dialled path already rejects a mid-body death with the TypeError
 *      "terminated" -- so a delegated one answers the same, and the
 *      oracle's hang is asserted from the oracle's side rather than
 *      reproduced.
 */
#ifndef SCR_FETCH_DISPATCH_H
#define SCR_FETCH_DISPATCH_H

#include <stdbool.h>
#include <stddef.h>

#include "scr_runtime.h"

/* Installed before %main runs, so the very first fetch sees the seam.
 * Declared in scr_runtime.h beside the seam it fills. */

#endif /* SCR_FETCH_DISPATCH_H */
