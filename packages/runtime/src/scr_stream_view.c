/* A net.Socket where a ReadableStream is expected.
 *
 * Node's class hierarchy: net.Socket extends stream.Duplex, which extends stream.Readable (and is a Writable). The ReadableStream
 * surface the typed lowering models is on/once of 'data' and 'end' (a ScrChildStream); a socket flowing into a slot of that type
 * (pg-protocol's parse(stream, callback) reads the connection's socket this way) is accepted as ITSELF: the typed value is a view that
 * forwards those two registrations to the socket, and boxing the view again answers the original socket box, so identity survives.
 * No data is copied and no event is re-implemented.
 *
 * This unit names both the socket unit and the child-stream unit, so the build links it exactly when the program holds both (cc.ts,
 * the scr_cipher_key.c pattern); it registers itself before main. */
#include "scr_runtime.h"

static void *sv_retain(void *obj) { return scr_net_sock_retain((ScrNetSocket *)obj); }
static void sv_release(void *obj) { scr_net_sock_release((ScrNetSocket *)obj); }
static void sv_on_data(void *obj, ScrClosure *cb, ScrChildStreamDataFn fn, bool once) {
  scr_net_sock_on_data((ScrNetSocket *)obj, cb, (ScrNetDataFn)fn, once);
}
static void sv_on_end(void *obj, ScrClosure *cb, bool once) { scr_net_sock_on_end((ScrNetSocket *)obj, cb, once); }

static const ScrChildStreamForeign sv_ops = { sv_retain, sv_release, sv_on_data, sv_on_end };

static void *sv_adopt(const ScrDyn *d) {
  if (d->kind != SCR_DYN_HANDLE || d->v.handle.tag != SCR_DYNH_NET_SOCKET) return NULL;
  ScrChildStream *view = scr_child_stream_foreign_new(d->v.handle.ptr, &sv_ops);
  return view;
}

static ScrDyn *sv_unadopt(void *view) {
  void *obj = scr_child_stream_foreign_obj((const ScrChildStream *)view);
  if (obj == NULL) return NULL;
  return scr_dyn_new_handle(obj, SCR_DYNH_NET_SOCKET);
}

__attribute__((constructor)) static void sv_register(void) {
  scr_dyn_readable_adopt = sv_adopt;
  scr_dyn_readable_unadopt = sv_unadopt;
}
