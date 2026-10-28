/* request.destroy(value) with a checked-dynamic value (http.clientDestroyDyn).
 * Its own unit, gated on the IR call (cc.ts httpDyn): it reaches the http
 * unit's destroy pair and the stream dyn unit's error wrapper, so it cannot
 * live in scr_stream_dyn.c, which a stream-only program links WITHOUT http
 * (Windows lld-link has no dead-function stripping for an undefined symbol). */
#include "scr_runtime.h"

/* request.destroy(value) with a checked-dynamic value: the same three cases
 * as scr_stream_destroy_dyn, on the client request. Falsy -> plain destroy;
 * an Error encoding -> its ScrError; any other truthy value is carried as a
 * non-Error wrapper and emitted unchanged on 'error'. value borrowed. */
void scr_http_client_destroy_dyn(ScrHttpClientReq *c, ScrDyn *d) {
  if (!scr_dyn_truthy(d)) { scr_http_client_destroy(c); return; }
  if (scr_dyn_is_error_encoding(d)) {
    ScrError *e = scr_error_from_dyn(d);
    scr_http_client_destroy_err(c, e);
    scr_error_release(e);
    return;
  }
  ScrError *w = scr_error_wrap_nonerr(d);
  scr_http_client_destroy_err(c, w);
  scr_error_release(w);
}
