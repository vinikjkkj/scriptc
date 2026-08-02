/* AbortSignal — the fetch-cancellation slice's handle.
 *
 * This file is deliberately just the ownership bookkeeping. A signal has a
 * TYPE before it has behaviour, because the shape that actually appears in
 * real code is an OPTIONAL FIELD on an options record that the program
 * never reads:
 *
 *     interface FetchInput { readonly url: string; readonly signal?: AbortSignal }
 *
 * With no representation at all, that record does not compile, nor does
 * any record holding it, nor any class holding one of those — a chain that
 * reaches a long way from a member nothing touches. Giving the handle a
 * type ends the chain.
 *
 * Every way to OBSERVE or BUILD a signal (the statics timeout/abort/any,
 * the instance members aborted/reason/onabort/throwIfAborted, and
 * AbortController) fences in the frontend, so no value of this type is
 * ever constructed while only the type exists. The struct is therefore the
 * refcount and nothing else; the fields that make a signal do something
 * land with the lowering that needs them. */
#include <stdlib.h>

#include "scr_runtime.h"

struct ScrAbortSignal {
  size_t rc;
};

ScrAbortSignal *scr_abort_signal_retain(ScrAbortSignal *s) {
  if (s) s->rc++;
  return s;
}

void scr_abort_signal_release(ScrAbortSignal *s) {
  if (!s || --s->rc != 0) return;
  free(s);
}

void *scr_abort_signal_retain_v(void *p) { return scr_abort_signal_retain((ScrAbortSignal *)p); }
void scr_abort_signal_release_v(void *p) { scr_abort_signal_release((ScrAbortSignal *)p); }
