/* scr_opaque.c -- the ownership pair of the named standard-library handles.
 *
 * `Blob` and `PromiseConstructor` are TYPES FIRST, exactly like ScrRequest,
 * ScrDate and ScrRtcPeerConnection: mapping them is what lets a union or a
 * record that mentions one have a representation, so that mysql2's
 * `QueryValues` (a union with a `Blob` arm) and
 * `Connection.promise(promiseImpl?: PromiseConstructor)` map instead of being
 * dropped from their shapes.
 *
 * A Blob is never built: its pointer is always NULL and every function here
 * takes its NULL branch. The PromiseConstructor is ONE immortal object, the
 * value the global `Promise` identifier lowers to (opaque.promiseCtor), so
 * `impl === Promise` is a pointer compare and the retain/release pair is
 * balanced by the immortal rc (SIZE_MAX), like an interned top-level function.
 *
 * Behind a LINK GATE (moduleUsesOpaque on the IR): a program with no such
 * value or type keeps its exact link line and its exact bytes. */

#include <stdlib.h>

#include "scr_runtime.h"

struct ScrOpaque {
  size_t rc;
};

ScrOpaque *scr_opaque_retain(ScrOpaque *p) {
  if (p != NULL && p->rc != SIZE_MAX) p->rc++;
  return p;
}

void scr_opaque_release(ScrOpaque *p) {
  if (p == NULL || p->rc == SIZE_MAX) return;
  if (--p->rc == 0) free(p);
}

void *scr_opaque_retain_v(void *p) { return scr_opaque_retain((ScrOpaque *)p); }
void scr_opaque_release_v(void *p) { scr_opaque_release((ScrOpaque *)p); }

static ScrOpaque scr_opaque_promise_ctor_obj = { SIZE_MAX };

ScrOpaque *scr_opaque_promise_ctor(void) { return &scr_opaque_promise_ctor_obj; }
