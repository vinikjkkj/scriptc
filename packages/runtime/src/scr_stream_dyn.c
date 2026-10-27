/* The dyn destroy and its non-Error wrapper, in their own unit: linked exactly
 * when stream.destroyDyn is used (cc.ts streamDyn gate), which also links the
 * stream and inspect units (RUNTIME_UNIT_DEPS). Keeping it out of scr_stream.c
 * and scr_inspect.c lets a stream-only program and an inspect-only program each
 * link. This unit installs the unhandled-error text into the json hook. */
#include "scr_runtime.h"

extern ScrError *(*scr_nonerr_unhandled_fn)(const ScrDyn *payload);
ScrError *scr_insp_unhandled_nonerr(const ScrDyn *payload);

/* destroy(value) with a checked-dynamic value (the JS lane's `err`): Node's
 * `if (err)` picks the plain or the error path. An error-encoded value answers
 * its own ScrError; any other truthy value is carried as a non-Error wrapper
 * and emitted unchanged on 'error'. */
ScrStream *scr_stream_destroy_dyn(ScrStream *s, ScrDyn *d) {
  if (!scr_dyn_truthy(d)) return scr_stream_destroy(s, NULL);
  if (scr_dyn_is_error_encoding(d)) {
    ScrError *e = scr_error_from_dyn(d);
    ScrStream *r = scr_stream_destroy(s, e);
    scr_error_release(e);
    return r;
  }
  /* Node emits the value itself on 'error' (identity kept): the wrapper
   * carries it through the Error-typed slot; every dyn crossing unwraps. */
  ScrError *w = scr_error_wrap_nonerr(d);
  ScrStream *r = scr_stream_destroy(s, w);
  scr_error_release(w);
  return r;
}

