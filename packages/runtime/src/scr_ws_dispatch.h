/* The init bag's `dispatcher`, honoured.
 *
 * WHAT THE ORACLE DOES, measured against Node v25.9.0 and re-measured on
 * every gate by tests/harness/ws-init-bag.test.ts: a `globalThis.WebSocket`
 * whose init bag carries a `dispatcher` never dials. It builds undici's
 * request-options record and a ten-member handler and hands BOTH to
 * `dispatcher.dispatch(opts, handler)`; the dispatcher performs the HTTP
 * upgrade over whatever transport it likes and gives the connected socket
 * back through `handler.onUpgrade(statusCode, headers, socket)`.
 *
 * WHY THIS IS NOT A DUPLEX BRIDGE. The socket a dispatcher hands back is,
 * in JS, any Duplex. In a COMPILED program it is not: the only value a
 * scriptc program can produce that carries real bytes is a runtime handle,
 * and `net.connect` boxes one as SCR_DYNH_NET_SOCKET -- an ScrNetSocket
 * behind a dyn. So there is nothing to bridge: the pointer this unit
 * unboxes from `onUpgrade`'s third argument is the very type
 * scr_ws_client.c already pumps. Anything else meets a loud fence that
 * NAMES what it got, because a socket this runtime cannot drive must not
 * become a connection that silently does nothing.
 *
 * WHAT IS DELIBERATELY DIFFERENT FROM NODE, and why it is the loud
 * direction: undici advertises `sec-websocket-extensions:
 * permessage-deflate; client_max_window_bits` and this unit does not.
 * scr_websocket.c has no inflate; a server that ACCEPTED the offer would
 * send compressed frames the parser would read as garbage. Advertising a
 * capability the frame parser does not have is precisely the silent wrong
 * answer this project ranks above every other failure, so the offer is
 * withheld and the omission is asserted by
 * tests/harness/ws-dispatcher.test.ts rather than left to be discovered.
 * Every other member of `opts` and every member of the handler is
 * byte-identical to what the oracle builds (same names, same order, same
 * arities) -- all of it measured, none of it read out of undici.
 */
#ifndef SCR_WS_DISPATCH_H
#define SCR_WS_DISPATCH_H

#include <stdbool.h>
#include <stddef.h>

#include "scr_runtime.h"
#include "scr_ws_client.h"
#include "scr_ws_global.h"

typedef struct ScrWsDisp ScrWsDisp;

/* How the program spells `dispatch`. The compiler proves the shape
 * (wsInitBagPlan) and passes the arm; this unit does not guess, because a
 * closure called through the wrong C signature is not a diagnosable
 * failure. */
#define SCR_WSD_CALL_REST 0 /* (...args: unknown[]) -- one dyn ARRAY param */
#define SCR_WSD_CALL_TWO 1  /* (opts: unknown, handler: unknown) -- two dyn params */

/* What `dispatch` gives back, so the call site knows which C return type
 * to read. A dispatcher's return value is discarded either way -- undici's
 * is a boolean nobody consults for an upgrade -- but reading a `bool`
 * return as a pointer is undefined behaviour, not a wrong answer. */
#define SCR_WSD_RET_DYN 0
#define SCR_WSD_RET_BOOL 1
#define SCR_WSD_RET_VOID 2

/* THE EMITTED ENTRY POINT: the `globalThis.WebSocket` wrapper calls this
 * instead of scr_ws_global_new when the init bag's `dispatcher` is
 * present. Answers the API handle (+1), or NULL with an exception pending
 * (a bad URL, a non-ws scheme, or an out-of-memory).
 *
 * `call_kind`/`ret_kind` are the C signature of the program's `dispatch`,
 * proved by the compiler -- see below. */
ScrWsGlobal *scr_ws_disp_global_new(ScrStr *url /*borrowed*/,
                                    ScrStr *protocols /*borrowed, nullable*/,
                                    ScrStr *headers /*borrowed, nullable*/, ScrWsGlobalFire fire,
                                    ScrClosure *dispatch /*borrowed*/, int call_kind,
                                    int ret_kind);

/* Delegate the upgrade of `url`. Generates the Sec-WebSocket-Key, builds
 * `opts` and the handler, and CALLS `dispatch` before returning -- the
 * oracle's dispatch is synchronous from the constructor too.
 *
 * `protocols` is the Sec-WebSocket-Protocol value or NULL; `headers` is
 * the init bag's already-formed "Name: value\r\n" block or NULL (the same
 * two the dialled path takes, so one bag builds either transport).
 *
 * Answers the handle (+1) with a DETACHED ScrWsClient inside, or NULL with
 * an exception pending (a bad URL, a non-ws scheme). The client is in
 * CONNECTING until `onUpgrade` attaches a socket, so the API object's
 * readyState is right from the first turn. */
ScrWsDisp *scr_ws_disp_begin(ScrStr *url /*borrowed*/, ScrStr *protocols /*borrowed, nullable*/,
                             ScrStr *headers /*borrowed, nullable*/,
                             ScrClosure *dispatch /*borrowed*/, int call_kind, int ret_kind,
                             const ScrWsClientCallbacks *cb, void *user);

/* The client the handle drives. Borrowed; the handle owns it. */
ScrWsClient *scr_ws_disp_client(ScrWsDisp *d);

/* The owner is going away. The handler this unit handed the program may
 * outlive it -- a dispatcher is free to keep the object -- so the handle
 * is refcounted and this only marks it dead: a late onUpgrade then drops
 * its socket instead of attaching it to a freed client. */
void scr_ws_disp_invalidate(ScrWsDisp *d);
void scr_ws_disp_release(ScrWsDisp *d);

#endif /* SCR_WS_DISPATCH_H */
