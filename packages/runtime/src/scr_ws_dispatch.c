/* The init bag's `dispatcher`, honoured — see scr_ws_dispatch.h for what
 * the oracle does and for the one deliberate divergence. */
#include "scr_ws_dispatch.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "scr_url_internal.h"
#include "scr_websocket.h"

struct ScrWsDisp {
  size_t rc;
  /* OWNED. The API object's handle borrows it; this unit outlives that
   * handle whenever the program kept the handler we gave its dispatcher,
   * so the client cannot belong to the shorter-lived side. */
  ScrWsClient *c;
  /* The owner is gone. A handler call that lands afterwards must drop
   * whatever it was given rather than drive a freed client. */
  bool dead;
  /* onUpgrade/onError already ran. undici's own handler is single-shot,
   * and a dispatcher that calls twice is a dispatcher bug, not a second
   * connection. */
  bool settled;
  /* THE ANSWER, PARKED FOR ONE MICROTASK TURN.
   *
   * A dispatcher may call onUpgrade SYNCHRONOUSLY -- undici's own does
   * whenever the proxy connection is already up -- and `dispatch` runs
   * from inside the WebSocket constructor. Attaching there would fire
   * `open` before the constructor had returned: before the API record
   * exists, before scr_ws_global_set_user names it, and therefore into a
   * NULL user. It is also not what the oracle does. undici queues its
   * events, so `open` never lands in the turn that built the object.
   *
   * So the validated socket and the rebuilt response head park here and a
   * microtask delivers them. The turn is the fix and the fidelity at
   * once. Both are +1 and both are dropped by the teardown below, which
   * is what a program that threw away the WebSocket in the same turn
   * depends on. */
  ScrStr *pending_head;
  /* The delegation failed and the failure is likewise parked: an `error`
   * event has the same "not before the constructor returned" problem. */
  ScrStr *pending_fail;
  /* The API handle, BORROWED -- it owns this state, so the edge back is
   * never counted. It exists for exactly one thing: telling the handle to
   * let go of the program's record when nobody can answer any more. See
   * wsd_release_v. */
  ScrWsGlobal *g;
  /* The program let go of every handler member without settling, so no
   * answer can ever arrive. Recorded rather than acted on immediately,
   * because a dispatcher can reach this state INSIDE the constructor --
   * before scr_ws_global_set_user has a record to let go of. */
  bool orphaned;
};

static void wsd_free(ScrWsDisp *d) {
  if (d->c != NULL) {
    scr_ws_client_free(d->c);
    d->c = NULL;
  }
  scr_str_release(d->pending_head);
  scr_str_release(d->pending_fail);
  free(d);
}

static ScrWsDisp *wsd_retain(ScrWsDisp *d) {
  if (d != NULL) d->rc++;
  return d;
}

void scr_ws_disp_release(ScrWsDisp *d) {
  if (d == NULL) return;
  if (--d->rc == 0) wsd_free(d);
}

static void *wsd_retain_v(void *p) { return wsd_retain((ScrWsDisp *)p); }

/* THE HANDLER'S OWN RELEASE, and the one place that can tell that nobody
 * will ever answer.
 *
 * Every one of the ten handler members holds this state, so while any of
 * them is reachable an onUpgrade or an onError can still arrive and the
 * WebSocket has to stay alive -- 6060's dispatcher answers a turn later
 * and depends on exactly that. When the LAST of them goes, the only
 * reference left is the API handle's own, and at that instant the program
 * has dropped every way it had of answering. A dispatcher that returned
 * without dialling leaves nothing to keep the loop alive either, so the
 * process is on its way out with the record still held.
 *
 * rc == 1 after the decrement is that instant. The handle then lets go of
 * the record, silently, because the oracle fires nothing here either. */
static void wsd_release_v(void *p) {
  ScrWsDisp *d = (ScrWsDisp *)p;
  if (d == NULL) return;
  /* AN EXCEPTION IN FLIGHT IS AN ANSWER NOT YET RECORDED. A dispatcher
   * that THROWS releases the handler on the way out -- the emitted callee
   * drops its dyn parameters on the throw path -- so the last handler
   * member dies BEFORE scr_ws_disp_begin has seen the pending exception
   * and turned it into a parked failure. Treating that as "nobody can
   * answer" dropped the record a moment before the failure needed it, and
   * the `error`/close pair the oracle produces went missing. Measured:
   * the throwing row of tests/corpus/6061 lost both its lines. */
  if (d->rc == 2 && !d->settled && !d->dead && !scr_exc_pending()) {
    d->rc = 1;
    d->orphaned = true;
    /* NULL until scr_ws_disp_global_new adopts, which is AFTER the
     * delegation ran -- a dispatcher that dropped the handler in its own
     * call lands here first. set_user then asks `orphaned` and never
     * takes the reference at all. */
    if (d->g != NULL) scr_ws_global_drop_user(d->g);
    return;
  }
  scr_ws_disp_release(d);
}

ScrWsClient *scr_ws_disp_client(ScrWsDisp *d) { return d == NULL ? NULL : d->c; }

void scr_ws_disp_invalidate(ScrWsDisp *d) {
  if (d == NULL || d->dead) return;
  d->dead = true;
  if (d->c != NULL) {
    scr_ws_client_free(d->c);
    d->c = NULL;
  }
}

/* ── small dyn helpers ──────────────────────────────────────────────── */

static void wsd_set(ScrDyn *obj, const char *k, ScrDyn *v) {
  scr_dyn_obj_set(obj, k, strlen(k), v); /* MOVES v */
}

static void wsd_set_str(ScrDyn *obj, const char *k, const char *v, size_t vlen) {
  ScrStr *s = scr_str_new(v, vlen);
  wsd_set(obj, k, scr_dyn_new_str(s));
  scr_str_release(s);
}

static ScrWsDisp *wsd_of(ScrClosure *clo) {
  ScrWsDisp *d = (ScrWsDisp *)scr_box_get_ref(clo->caps[0]);
  /* scr_box_get_ref answers +1; the closure's own reference outlives this
   * synchronous call, so give the extra one back at once rather than
   * threading a release through every early return below. */
  if (d != NULL) scr_ws_disp_release(d);
  return d;
}

/* ── the fence ──────────────────────────────────────────────────────── */

/* A dispatcher that answered something this runtime cannot pump. LOUD, and
 * it NAMES what arrived: the reason the refusal this replaces was correct
 * is that a proxy quietly ignored is worse than a proxy refused, and that
 * is just as true one layer down. */
static void wsd_bad_socket(const ScrDyn *got) {
  const char *what = "a value";
  if (got == NULL) what = "nothing";
  else if (got->kind == SCR_DYN_UNDEF) what = "undefined";
  else if (got->kind == SCR_DYN_NULL) what = "null";
  else if (got->kind == SCR_DYN_HANDLE) what = scr_dyn_handle_cls(got);
  else if (got->kind == SCR_DYN_OBJ) what = "a plain object";
  else if (got->kind == SCR_DYN_STR) what = "a string";
  else if (got->kind == SCR_DYN_NUM) what = "a number";
  char msg[320];
  int n = snprintf(msg, sizeof msg,
                   "the WebSocket dispatcher's onUpgrade was given %s as its socket, and only a "
                   "net.Socket can carry a compiled WebSocket -- a Duplex written in the program "
                   "has no lowering yet",
                   what);
  if (n < 0) return;
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)n, "SC2020");
}

/* ── onUpgrade ──────────────────────────────────────────────────────── */

/* One header name or value out of whatever the dispatcher passed. undici
 * hands raw Buffers; a program is just as likely to hand strings, and both
 * are the same bytes on the wire. */
static ScrStr *wsd_hdr_piece(const ScrDyn *d) {
  if (d == NULL) return NULL;
  if (d->kind == SCR_DYN_STR || d->kind == SCR_DYN_NUM) return scr_dyn_string_coerce(d);
  if (d->kind == SCR_DYN_BYTES) {
    ScrBytes *b = scr_dyn_bytes_unbox(d);
    if (b == NULL) return NULL;
    return scr_str_new((const char *)b->data, b->len);
  }
  return NULL;
}

/* Rebuild the response head the dispatcher already read, so the SAME
 * handshake validation runs as on the dialled path (scr_ws_conn_recv
 * drives the handshake before it parses a frame). Nothing here trusts the
 * dispatcher: a forged Sec-WebSocket-Accept fails in
 * scr_ws_check_handshake exactly as it would have on a direct dial. */
static bool wsd_build_head(ScrStr **out, double status, const ScrDyn *headers) {
  size_t cap = 256;
  char *buf = malloc(cap);
  if (buf == NULL) return false;
  int wrote = snprintf(buf, cap, "HTTP/1.1 %d Switching Protocols\r\n", (int)status);
  if (wrote < 0) {
    free(buf);
    return false;
  }
  size_t n = (size_t)wrote;
  double len = scr_dyn_arr_len(headers);
  for (double i = 0; i + 1 < len; i += 2) {
    ScrDyn *kd = scr_dyn_arr_at(headers, i);
    ScrDyn *vd = scr_dyn_arr_at(headers, i + 1);
    ScrStr *k = wsd_hdr_piece(kd);
    ScrStr *v = wsd_hdr_piece(vd);
    scr_dyn_release(kd);
    scr_dyn_release(vd);
    if (k != NULL && v != NULL) {
      size_t need = n + k->len + v->len + 8;
      if (need > cap) {
        while (cap < need) cap *= 2;
        char *nb = realloc(buf, cap);
        if (nb == NULL) {
          scr_str_release(k);
          scr_str_release(v);
          free(buf);
          return false;
        }
        buf = nb;
      }
      memcpy(buf + n, k->data, k->len);
      n += k->len;
      buf[n++] = ':';
      buf[n++] = ' ';
      memcpy(buf + n, v->data, v->len);
      n += v->len;
      buf[n++] = '\r';
      buf[n++] = '\n';
    }
    scr_str_release(k);
    scr_str_release(v);
  }
  if (n + 3 > cap) {
    char *nb = realloc(buf, n + 3);
    if (nb == NULL) {
      free(buf);
      return false;
    }
    buf = nb;
  }
  buf[n++] = '\r';
  buf[n++] = '\n';
  *out = scr_str_new(buf, n);
  free(buf);
  return true;
}

/* One microtask turn after the dispatcher answered. Attaching and feeding
 * HERE rather than inside the handler call is what keeps `open` out of the
 * constructor's own turn -- see the pending_* fields. */
static void wsd_deliver(void *p) {
  ScrWsDisp *d = (ScrWsDisp *)p;
  if (d->dead || d->c == NULL) return;
  if (d->pending_fail != NULL) {
    ScrStr *m = d->pending_fail;
    d->pending_fail = NULL;
    scr_ws_client_fail(d->c, m->data);
    scr_str_release(m);
    return;
  }
  ScrStr *head = d->pending_head;
  d->pending_head = NULL;
  if (head == NULL) return;
  /* Feeding the head is what OPENS the connection: scr_ws_conn_recv
   * validates it -- status, Upgrade/Connection tokens, and the
   * Sec-WebSocket-Accept against the key WE generated -- and only then
   * fires on_open, which reaches the API record's `onopen` through the
   * same path a dialled socket takes. */
  scr_ws_client_feed(d->c, (const uint8_t *)head->data, head->len);
  scr_str_release(head);
}

static void wsd_park(ScrWsDisp *d) {
  scr_queue_microtask_raw(&wsd_deliver, wsd_retain(d), &wsd_release_v);
}

static void wsd_park_fail(ScrWsDisp *d, const char *msg) {
  scr_str_release(d->pending_fail);
  d->pending_fail = scr_str_new(msg, strlen(msg));
  wsd_park(d);
}

static ScrDyn *wsd_upgrade_at(ScrClosure *clo, ScrDyn *const *args, size_t argc, size_t base) {
  ScrWsDisp *d = wsd_of(clo);
  if (d == NULL || d->dead || d->settled || d->c == NULL) return scr_dyn_undefined();
  d->settled = true;
  if (argc < base + 3) {
    wsd_park_fail(d, "the WebSocket dispatcher called onUpgrade without a socket");
    return scr_dyn_undefined();
  }
  const ScrDyn *sd = args[base + 2];
  if (sd == NULL || sd->kind != SCR_DYN_HANDLE || sd->v.handle.tag != SCR_DYNH_NET_SOCKET) {
    wsd_bad_socket(sd);
    /* The fence IS the report, and it is SYNCHRONOUS: it throws out of the
     * dispatcher's own onUpgrade call, where the program can see it.
     * Failing the client as well would race a second `error` event
     * against the throw the program is already about to get. */
    return NULL;
  }
  ScrStr *head = NULL;
  if (!wsd_build_head(&head, scr_dyn_to_number(args[base]), args[base + 1])) {
    wsd_park_fail(d, "out of memory rebuilding the upgrade response");
    return scr_dyn_undefined();
  }
  /* ATTACH NOW, FEED NEXT TURN. The socket gets its owner in this call,
   * exactly as undici's does -- the dispatcher is about to unshift the
   * bytes that arrived with the 101, and the read loop re-delivers them
   * immediately. Whoever owns the socket at that instant gets them; if it
   * were still the dispatcher's own 'data' listener they would be dropped
   * on the floor. The client HOLDS them until the head lands (see
   * scr_ws_client.c's head_pending), so nothing reaches the parser before
   * the handshake it has to validate. */
  if (!scr_ws_client_attach(d->c, (ScrNetSocket *)sd->v.handle.ptr)) {
    scr_str_release(head);
    wsd_park_fail(d, "the WebSocket dispatcher called onUpgrade twice");
    return scr_dyn_undefined();
  }
  d->pending_head = head;
  wsd_park(d);
  return scr_dyn_undefined();
}

static ScrDyn *wsd_on_upgrade(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  return wsd_upgrade_at(clo, args, argc, 0);
}

/* undici's newer spelling: (controller, statusCode, headers, socket). The
 * same three values, one slot along. */
static ScrDyn *wsd_on_request_upgrade(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  return wsd_upgrade_at(clo, args, argc, 1);
}

static ScrDyn *wsd_on_error(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrWsDisp *d = wsd_of(clo);
  if (d == NULL || d->dead || d->settled || d->c == NULL) return scr_dyn_undefined();
  d->settled = true;
  ScrStr *m = argc > 0 && args[0] != NULL ? scr_dyn_string_coerce(args[0]) : NULL;
  wsd_park_fail(d, m != NULL && m->len > 0 ? m->data : "the WebSocket dispatcher failed");
  scr_str_release(m);
  return scr_dyn_undefined();
}

/* onConnect / onResponseStarted / onHeaders / onData / onComplete. They
 * exist because the ORACLE's handler has them and a dispatcher written
 * against undici calls them; for an upgrade none carries information this
 * transport needs. Present and inert beats absent: a dispatcher that calls
 * `handler.onConnect(abort)` must not meet "not a function". */
static ScrDyn *wsd_nop(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  (void)args;
  (void)argc;
  return scr_dyn_undefined();
}

/* ── the handler and the request options ────────────────────────────── */

/* `sig` is NOT decoration and it must never be a typeKey. The emitted
 * dynCheck for a function type does
 *
 *     if (strcmp(d->v.fn.sig, "func(f64,dyn,dyn)=>void") == 0)
 *         return scr_closure_retain(d->v.fn.clo);
 *
 * -- an exact-signature match UNWRAPS the closure and calls `clo->fn`
 * through the STATIC C signature. These closures carry the dyn THUNK in
 * `fn`, so that would be a call through the wrong signature. A
 * human-readable spelling can never collide with a typeKey, which is the
 * convention scr_stream.c and scr_dc.c already follow, and it forces the
 * per-target adapter every time. (A NULL sig is worse still: it segfaults
 * inside that strcmp, in emitted code, naming nothing. Measured.) */
static ScrDyn *wsd_fn(ScrWsDisp *d, ScrDynThunk t, uint32_t arity, const char *sig,
                      const char *name) {
  ScrClosure *c = scr_closure_new((void *)t, 1);
  c->caps[0] = scr_box_new_obj(&wsd_retain_v, &wsd_release_v, NULL);
  scr_box_set_ref(c->caps[0], wsd_retain(d));
  return scr_dyn_new_func(c, t, arity, sig, name);
}

/* The ten-member handler, in the oracle's own property order and with the
 * oracle's own arities. MEASURED, including that `body` and `abort` are
 * null VALUES rather than functions -- undici fills `abort` in from the
 * argument it passes to onConnect. */
static ScrDyn *wsd_handler(ScrWsDisp *d) {
  ScrDyn *h = scr_dyn_new_obj();
  wsd_set(h, "body", scr_dyn_new_null());
  wsd_set(h, "abort", scr_dyn_new_null());
  wsd_set(h, "onConnect", wsd_fn(d, &wsd_nop, 1, "(abort)", "onConnect"));
  wsd_set(h, "onResponseStarted", wsd_fn(d, &wsd_nop, 0, "()", "onResponseStarted"));
  wsd_set(h, "onHeaders",
          wsd_fn(d, &wsd_nop, 4, "(statusCode,headers,resume,statusText)", "onHeaders"));
  wsd_set(h, "onData", wsd_fn(d, &wsd_nop, 1, "(chunk)", "onData"));
  wsd_set(h, "onComplete", wsd_fn(d, &wsd_nop, 0, "(trailers)", "onComplete"));
  wsd_set(h, "onError", wsd_fn(d, &wsd_on_error, 1, "(err)", "onError"));
  wsd_set(h, "onRequestUpgrade",
          wsd_fn(d, &wsd_on_request_upgrade, 4, "(controller,statusCode,headers,socket)",
                 "onRequestUpgrade"));
  wsd_set(h, "onUpgrade", wsd_fn(d, &wsd_on_upgrade, 3, "(statusCode,headers,socket)", "onUpgrade"));
  return h;
}

/* The bag's header block ("Name: value" lines) split back into the object
 * undici puts in `opts.headers`. The block is what the DIALLED path
 * appends verbatim; the delegated path has to hand the same names to the
 * dispatcher instead. The bag's own headers go in FIRST because that is
 * where the oracle puts them -- measured, and it is also why a bag
 * `user-agent` REPLACES undici's rather than joining it. */
static void wsd_bag_headers(ScrDyn *obj, const ScrStr *block) {
  if (block == NULL) return;
  size_t i = 0;
  while (i < block->len) {
    size_t e = i;
    while (e + 1 < block->len && !(block->data[e] == '\r' && block->data[e + 1] == '\n')) e++;
    if (e + 1 >= block->len) e = block->len;
    size_t colon = i;
    while (colon < e && block->data[colon] != ':') colon++;
    if (colon < e) {
      size_t vs = colon + 1;
      while (vs < e && (block->data[vs] == ' ' || block->data[vs] == '\t')) vs++;
      ScrStr *v = scr_str_new(block->data + vs, e - vs);
      scr_dyn_obj_set(obj, block->data + i, colon - i, scr_dyn_new_str(v));
      scr_str_release(v);
    }
    if (e >= block->len) break;
    i = e + 2;
  }
}

/* `opts`, in the oracle's key order. Every value measured, none guessed --
 * including that `origin` drops the scheme's default port and that `path`
 * is pathname+search, with "/" for an empty path. */
static ScrDyn *wsd_opts(const ScrUrl *u, bool secure, const char *path, const char *key_b64,
                        const ScrStr *protocols, const ScrStr *headers) {
  ScrDyn *o = scr_dyn_new_obj();
  wsd_set_str(o, "path", path, strlen(path));

  char origin[400];
  int on = snprintf(origin, sizeof origin, "%s://%.*s", secure ? "https" : "http",
                    (int)u->host->len, u->host->data);
  if (on > 0 && u->port->len > 0) {
    const char *dflt = secure ? "443" : "80";
    bool is_default =
        u->port->len == strlen(dflt) && memcmp(u->port->data, dflt, u->port->len) == 0;
    if (!is_default) {
      int more = snprintf(origin + on, sizeof origin - (size_t)on, ":%.*s", (int)u->port->len,
                          u->port->data);
      if (more > 0) on += more;
    }
  }
  wsd_set_str(o, "origin", origin, on > 0 ? (size_t)on : 0);
  wsd_set_str(o, "method", "GET", 3);
  wsd_set(o, "body", scr_dyn_new_null());

  ScrDyn *h = scr_dyn_new_obj();
  wsd_bag_headers(h, headers);
  wsd_set_str(h, "sec-websocket-key", key_b64, strlen(key_b64));
  wsd_set_str(h, "sec-websocket-version", "13", 2);
  if (protocols != NULL && protocols->len > 0) {
    wsd_set_str(h, "sec-websocket-protocol", protocols->data, protocols->len);
  }
  /* NO sec-websocket-extensions -- see the header's divergence note. */
  wsd_set_str(h, "accept", "*/*", 3);
  wsd_set_str(h, "accept-language", "*", 1);
  wsd_set_str(h, "sec-fetch-mode", "websocket", 9);
  wsd_set_str(h, "user-agent", "node", 4);
  wsd_set_str(h, "pragma", "no-cache", 8);
  wsd_set_str(h, "cache-control", "no-cache", 8);
  wsd_set_str(h, "accept-encoding", "gzip, deflate", 13);
  wsd_set(o, "headers", h);

  wsd_set(o, "maxRedirections", scr_dyn_new_num(0));
  wsd_set_str(o, "upgrade", "websocket", 9);
  return o;
}

/* ── the call ───────────────────────────────────────────────────────── */

static void wsd_throw_syntax(const char *msg) {
  scr_throw_error_named(scr_str_new("SyntaxError", 11), scr_str_new(msg, strlen(msg)));
}

ScrWsDisp *scr_ws_disp_begin(ScrStr *url, ScrStr *protocols, ScrStr *headers,
                             ScrClosure *dispatch, int call_kind, int ret_kind,
                             const ScrWsClientCallbacks *cb, void *user) {
  ScrUrl *u = scr_url_new(url); /* throws "Invalid URL" itself */
  if (u == NULL) return NULL;
  bool secure;
  if (u->scheme->len == 3 && memcmp(u->scheme->data, "wss", 3) == 0) secure = true;
  else if (u->scheme->len == 2 && memcmp(u->scheme->data, "ws", 2) == 0) secure = false;
  else {
    scr_url_release(u);
    wsd_throw_syntax("expected a ws: or wss: url");
    return NULL;
  }

  size_t plen = u->path->len + u->query->len;
  char *pbuf = malloc(plen + 2);
  if (pbuf == NULL) {
    scr_url_release(u);
    return NULL;
  }
  size_t pn = 0;
  if (u->path->len == 0) pbuf[pn++] = '/';
  else {
    memcpy(pbuf, u->path->data, u->path->len);
    pn = u->path->len;
  }
  memcpy(pbuf + pn, u->query->data, u->query->len);
  pn += u->query->len;
  pbuf[pn] = '\0';

  uint8_t seed[16];
  arc4random_buf(seed, sizeof seed);
  char key_b64[25];
  scr_ws_key_b64(seed, key_b64);
  char accept[29];
  scr_ws_accept_key(key_b64, 24, accept);

  ScrWsDisp *d = calloc(1, sizeof *d);
  if (d == NULL) {
    free(pbuf);
    scr_url_release(u);
    return NULL;
  }
  d->rc = 1;
  /* The API handle IS the callbacks' user pointer, and it exists before
   * the delegation runs -- which matters, because a dispatcher can drop
   * the handler inside its own call and the drop path needs a handle to
   * talk to. */
  d->g = (ScrWsGlobal *)user;
  d->c = scr_ws_client_detached(accept, cb, user);
  if (d->c == NULL) {
    free(d);
    free(pbuf);
    scr_url_release(u);
    return NULL;
  }

  ScrDyn *opts = wsd_opts(u, secure, pbuf, key_b64, protocols, headers);
  ScrDyn *handler = wsd_handler(d);
  free(pbuf);
  scr_url_release(u);

  /* THE DELEGATION. Both arguments MOVE IN: a dyn parameter is released by
   * the callee, which is read off the emitted C rather than assumed, so
   * nothing here releases them afterwards. The C signature is chosen by
   * the arm the COMPILER proved (wsInitBagPlan) -- a closure called
   * through the wrong signature is undefined behaviour, not a diagnosable
   * failure, so this unit never guesses it. */
  ScrClosure *fn = scr_closure_retain(dispatch);
  if (call_kind == SCR_WSD_CALL_REST) {
    ScrDyn *argv = scr_dyn_new_arr();
    scr_dyn_arr_push(argv, opts);
    scr_dyn_arr_push(argv, handler);
    if (ret_kind == SCR_WSD_RET_BOOL) {
      (void)((bool (*)(ScrClosure *, ScrDyn *))fn->fn)(fn, argv);
    } else if (ret_kind == SCR_WSD_RET_VOID) {
      ((void (*)(ScrClosure *, ScrDyn *))fn->fn)(fn, argv);
    } else {
      ScrDyn *r = ((ScrDyn * (*)(ScrClosure *, ScrDyn *))fn->fn)(fn, argv);
      scr_dyn_release(r);
    }
  } else {
    if (ret_kind == SCR_WSD_RET_BOOL) {
      (void)((bool (*)(ScrClosure *, ScrDyn *, ScrDyn *))fn->fn)(fn, opts, handler);
    } else if (ret_kind == SCR_WSD_RET_VOID) {
      ((void (*)(ScrClosure *, ScrDyn *, ScrDyn *))fn->fn)(fn, opts, handler);
    } else {
      ScrDyn *r = ((ScrDyn * (*)(ScrClosure *, ScrDyn *, ScrDyn *))fn->fn)(fn, opts, handler);
      scr_dyn_release(r);
    }
  }

  scr_closure_release(fn);
  /* A dispatcher that THREW. The oracle does not let it out of the
   * constructor: undici catches it and fails the connection instead, so
   * the program sees `error` then close 1006 -- measured on v25.9.0
   * beside the onError shape, which produces the identical pair. Letting
   * the exception ride out of `new WebSocket(...)` here would be a
   * divergence AND a worse one, because the object the program is holding
   * would never settle. */
  if (scr_exc_pending()) {
    ScrCaught *c = scr_exc_take();
    /* A throw AFTER the handler already answered does not un-answer it:
     * the oracle's "onError then onUpgrade" and "onUpgrade then onError"
     * both settle on whichever came FIRST (measured). */
    if (!d->settled) {
      d->settled = true;
      ScrStr *m = scr_caught_to_string(c);
      wsd_park_fail(d, m != NULL && m->len > 0 ? m->data : "the WebSocket dispatcher failed");
      scr_str_release(m);
    }
    scr_caught_release(c);
  }
  return d;
}

/* ── the emitted entry point ────────────────────────────────────────── */

static bool wsd_orphaned(void *p) {
  ScrWsDisp *d = (ScrWsDisp *)p;
  /* `settled` can be set AFTER the orphan flag: the delegation's own
   * pending-exception arm parks a failure once `dispatch` has returned,
   * and that failure still needs the record. */
  return d != NULL && d->orphaned && !d->settled;
}

static const ScrWsDispOps WSD_OPS = {
    .invalidate = (void (*)(void *)) & scr_ws_disp_invalidate,
    .release = (void (*)(void *)) & scr_ws_disp_release,
    .orphaned = &wsd_orphaned,
};

ScrWsGlobal *scr_ws_disp_global_new(ScrStr *url, ScrStr *protocols, ScrStr *headers,
                                    ScrWsGlobalFire fire, ScrClosure *dispatch, int call_kind,
                                    int ret_kind) {

  ScrWsGlobal *g = scr_ws_global_new_detached(fire);
  if (g == NULL) return NULL;
  /* The handle exists BEFORE the delegation, and that is the point: the
   * dispatcher can call onUpgrade synchronously (a proxy that is already
   * connected does), so the state machine has to be reachable by the time
   * `dispatch` runs. What is not reachable yet is the API RECORD --
   * scr_ws_global_set_user has not run -- and the events that would want
   * it cannot fire, because on_open only follows the response head that
   * onUpgrade feeds, and this handle has no client until adopt below. */
  ScrWsDisp *d =
      scr_ws_disp_begin(url, protocols, headers, dispatch, call_kind, ret_kind,
                        scr_ws_global_client_cbs(), g);
  if (d == NULL) { /* a bad URL / non-ws scheme: exception pending */
    scr_ws_global_free(g);
    return NULL;
  }
  scr_ws_global_adopt(g, scr_ws_disp_client(d), d, &WSD_OPS);
  return g;
}
