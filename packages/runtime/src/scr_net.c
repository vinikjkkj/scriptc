/* node:net — the inbound-networking slice: TCP servers and sockets over
 * the event loop's readiness poller, the first LISTENING capability of
 * the runtime. The poller is the scr_platform.h contract — kqueue on
 * macOS/BSD (scr_loop_kqueue.c, a stateless spelling of the syscall
 * sequences this file inlined historically), epoll+timerfd on Linux
 * (scr_loop_epoll.c). Two Linux-only obligations shape this file's use
 * of the seam: a watched fd is scrp_forget-ed BEFORE close(2) (epoll
 * registrations can outlive a close; the kqueue backend's forget is a
 * no-op so macOS behavior is untouched), and socket sends go through
 * scr_net_send (MSG_NOSIGNAL where it exists) because Linux has no
 * SO_NOSIGPIPE — a write to a closed peer must surface as an 'error'
 * event, never a process-killing SIGPIPE.
 *
 * ── Design note (the server core) ────────────────────────────────────
 *
 * Object model. Two refcounted handle kinds, both LEAN allocations (no
 * cycle header — the child precedent): ScrNetServer (a listener: fd,
 * bound port, connection/error/close listener lists) and ScrNetSocket (a
 * connection: fd, a state machine over the read/write halves, a growable
 * write buffer, data/end/close/error/connect listener lists, an optional
 * pipe destination, and — for accepted sockets — a +1 backref to the
 * owning server so its connection count can gate the server's 'close').
 * Listeners MOVE in (+1) and are released when the handle settles (a
 * socket's 'close' fired, a server's 'close' fired, or the listen/connect
 * failure delivered) — so a listener capturing its own handle cannot
 * cycle past settlement, exactly the ScrChild ownership story. Handles a
 * program abandons at exit are released by the unit's atexit cleanup, so
 * the RC audit never mistakes a process-lifetime server for a leak.
 *
 * Event dispatch. One poller owned by this unit (lazily created), fds all
 * non-blocking. The loop (scr_async.c) calls scr_net_dispatch() at every
 * turn top — the scr_events.c hook shape — which alternates two phases
 * until neither has work: (1) a SWEEP delivering deferred emits
 * ('listening' callbacks, listen/connect failures, socket 'close', then
 * server 'close' — socket-before-server order is what lets a drained
 * server observe its last connection die in the same pass), and (2) a
 * zero-timeout poller drain (accepts, reads, connect completions, write
 * flushes) whose callbacks fire directly, macrotask-style on the main
 * stack. The alternation stops early when a callback enqueued microtasks
 * (scr_loop_has_ready) so promise jobs interleave between event batches,
 * or when a callback threw (the loop surfaces the uncaught exception).
 * Between turns the loop's idle poll(2) watches this unit's poller FD —
 * kqueue and epoll fds both poll readable while events are pending — so socket
 * readiness ends the sleep immediately; while curl's io poll owns the
 * sleep instead (a --dynamic fetch in flight), net latency is capped at
 * the signal-poll granularity, like signals.
 *
 * Read model. Sockets are CONSUMER-DRIVEN like the stdin slice: the read
 * filter is armed only while a consumer exists (a 'data' listener or a
 * pipe destination), one read(2) per arrived chunk, delivered borrowed to
 * the listener snapshot (Node's emit-over-a-copy semantics; `once`
 * entries leave the live list before running) and appended to the pipe
 * destination. EOF fires 'end', then — allowHalfOpen is always false, the
 * Node default — ends the write half; when both halves are done the fd
 * closes and 'close' fires on the next sweep.
 *
 * Write model. write() attempts the syscall immediately when nothing is
 * buffered (the common case: small responses go out in one call) and
 * buffers the remainder with the write filter armed; end() marks the
 * write half ENDING so the FIN (shutdown) goes out when the buffer
 * drains. Backpressure is not modeled — Node's write() returns false and
 * keeps buffering; this write() is void and buffers without bound.
 *
 * Loop liveness. A handle keeps the process alive from listen()/connect()
 * until its 'close' delivers (scr_net_pending — the loop's exhaustion
 * test): a listening server is a live interval, server.close() releases
 * once every accepted connection drains, and an open socket holds the
 * loop like Node's active TCP handle. A server that never listened and a
 * socket already closed hold nothing.
 *
 * Close semantics, Node-matched: server.close() stops accepting NOW
 * (the listening fd closes) and fires close callbacks + 'close' when the
 * connection count reaches zero; socket 'end' precedes 'close';
 * connect/listen failures fire 'error' then 'close' ('error' with no
 * listener prints the error and exits 1 — the unhandled-'error'
 * EventEmitter behavior, the child precedent); listeners registered
 * after settlement release immediately and never fire; 'listening' (the
 * listen callback) is deferred to the next dispatch pass, Node's
 * next-tick emit.
 *
 * The differential harness pattern (tests/harness/server.test.ts): a
 * LISTENING program cannot be compared by stdout alone — something must
 * talk to it. Each fixture binds port 0, reports the real port over
 * stderr (`PORT <n>\n` — stderr is never compared), and a per-case Node
 * driver script issues the same requests against both lanes; the SERVER
 * program's stdout/exit code and the DRIVER's stdout must each match
 * byte-for-byte between the Node lane and the compiled lane. Ephemeral
 * ports never appear in compared output. This is the template TLS/http2
 * lanes inherit.
 */
#include "scr_platform.h"
#include "scr_runtime.h"

#include <errno.h>
#include <math.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netdb.h> /* getaddrinfo — the client bridges' blocking lookup */
#include <netinet/in.h>
#include <netinet/tcp.h>
#include <sys/socket.h>
#endif

static void scr_net_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

#ifdef _WIN32
/* ── the winsock arm ───────────────────────────────────────────────────
 * The BSD socket calls this file speaks, respelled once so every call
 * site below stays byte-identical: SOCKETs narrow through the int fd
 * contract (kernel handles fit — scr_child.c's stdio plumbing relies on
 * the same), failures land their WSA code in errno TRANSLATED to the
 * POSIX constant the call sites and the error-name table test (libuv
 * performs the same translation for Node, so the spellings agree with
 * the Windows oracle), socket reads are recv (ReadFile/_read do not
 * apply to winsock handles), and close is closesocket. WSAStartup lives
 * in scrp_poller_new (scr_loop_wsapoll.c) — every socket() site in this
 * file is preceded by scr_net_poller_init(). Two call-shape notes: a
 * pending nonblocking connect answers WSAEWOULDBLOCK where the sites
 * test EINPROGRESS (the connect wrapper translates), and SO_ERROR
 * answers a WSA code the getsockopt wrapper maps before the table sees
 * it. No SIGPIPE exists on Windows — a closed-peer send just fails. */
static int scr_w32_map_err(int e) {
  switch (e) {
  case WSAEWOULDBLOCK: return EAGAIN;
  case WSAEINTR: return EINTR;
  case WSAECONNREFUSED: return ECONNREFUSED;
  case WSAECONNRESET: return ECONNRESET;
  case WSAECONNABORTED: return ECONNABORTED;
  case WSAESHUTDOWN: return EPIPE; /* libuv's map: send-after-shutdown is EPIPE */
  case WSAEADDRINUSE: return EADDRINUSE;
  case WSAEACCES: return EACCES;
  case WSAEADDRNOTAVAIL: return EADDRNOTAVAIL;
  case WSAETIMEDOUT: return ETIMEDOUT;
  case WSAEHOSTUNREACH: return EHOSTUNREACH;
  case WSAENETUNREACH: return ENETUNREACH;
  case WSAEINVAL: return EINVAL;
  default: return e;
  }
}

static void scr_w32_seterr(void) { errno = scr_w32_map_err((int)WSAGetLastError()); }

static int scr_w32_socket(int af, int type, int proto) {
  SOCKET s = socket(af, type, proto);
  if (s == INVALID_SOCKET) {
    scr_w32_seterr();
    return -1;
  }
  return (int)s;
}

static int scr_w32_bind(int fd, const struct sockaddr *sa, socklen_t len) {
  if (bind((SOCKET)fd, sa, (int)len) != 0) {
    scr_w32_seterr();
    return -1;
  }
  return 0;
}

static int scr_w32_connect(int fd, const struct sockaddr *sa, socklen_t len) {
  if (connect((SOCKET)fd, sa, (int)len) != 0) {
    int e = (int)WSAGetLastError();
    /* pending nonblocking connect: WSAEWOULDBLOCK here is the callers'
     * EINPROGRESS, not recv's EAGAIN */
    errno = e == WSAEWOULDBLOCK ? EINPROGRESS : scr_w32_map_err(e);
    return -1;
  }
  return 0;
}

static int scr_w32_listen(int fd, int backlog) {
  if (listen((SOCKET)fd, backlog) != 0) {
    scr_w32_seterr();
    return -1;
  }
  return 0;
}

static int scr_w32_accept(int fd, struct sockaddr *sa, socklen_t *len) {
  int ilen = len != NULL ? (int)*len : 0;
  SOCKET s = accept((SOCKET)fd, sa, len != NULL ? &ilen : NULL);
  if (len != NULL) *len = (socklen_t)ilen;
  if (s == INVALID_SOCKET) {
    scr_w32_seterr();
    return -1;
  }
  return (int)s;
}

static int scr_w32_getsockname(int fd, struct sockaddr *sa, socklen_t *len) {
  int ilen = (int)*len;
  int rc = getsockname((SOCKET)fd, sa, &ilen);
  *len = (socklen_t)ilen;
  if (rc != 0) {
    scr_w32_seterr();
    return -1;
  }
  return 0;
}

static int scr_w32_setsockopt(int fd, int level, int name, const void *val, socklen_t len) {
  if (setsockopt((SOCKET)fd, level, name, (const char *)val, (int)len) != 0) {
    scr_w32_seterr();
    return -1;
  }
  return 0;
}

static int scr_w32_getsockopt(int fd, int level, int name, void *val, socklen_t *len) {
  int ilen = (int)*len;
  int rc = getsockopt((SOCKET)fd, level, name, (char *)val, &ilen);
  *len = (socklen_t)ilen;
  if (rc != 0) {
    scr_w32_seterr();
    return -1;
  }
  if (level == SOL_SOCKET && name == SO_ERROR && ilen == (int)sizeof(int)) {
    *(int *)val = scr_w32_map_err(*(int *)val); /* the table speaks POSIX */
  }
  return 0;
}

static ssize_t scr_w32_read(int fd, void *buf, size_t len) {
  int n = recv((SOCKET)fd, (char *)buf, len > 0x40000000 ? 0x40000000 : (int)len, 0);
  if (n < 0) scr_w32_seterr();
  return n;
}

static int scr_w32_close(int fd) {
  if (closesocket((SOCKET)fd) != 0) {
    scr_w32_seterr();
    return -1;
  }
  return 0;
}

#define socket(af, type, proto) scr_w32_socket((af), (type), (proto))
#define bind(fd, sa, len) scr_w32_bind((fd), (sa), (len))
#define connect(fd, sa, len) scr_w32_connect((fd), (sa), (len))
#define listen(fd, backlog) scr_w32_listen((fd), (backlog))
#define accept(fd, sa, len) scr_w32_accept((fd), (sa), (len))
#define getsockname(fd, sa, len) scr_w32_getsockname((fd), (sa), (len))
#define setsockopt(fd, l, n, v, len) scr_w32_setsockopt((fd), (l), (n), (v), (len))
#define getsockopt(fd, l, n, v, len) scr_w32_getsockopt((fd), (l), (n), (v), (len))
#define read(fd, buf, len) scr_w32_read((fd), (buf), (len))
#define close(fd) scr_w32_close(fd)
#define SHUT_WR SD_SEND
#endif /* _WIN32 */

/* Node's error-code names for the socket errors this slice can meet. */
static const char *scr_net_errname(int err) {
  switch (err) {
  case ECONNREFUSED: return "ECONNREFUSED";
  case ECONNRESET: return "ECONNRESET";
  case ECONNABORTED: return "ECONNABORTED";
  case EPIPE: return "EPIPE";
  case EADDRINUSE: return "EADDRINUSE";
  case EACCES: return "EACCES";
  case EADDRNOTAVAIL: return "EADDRNOTAVAIL";
  case ETIMEDOUT: return "ETIMEDOUT";
  case EHOSTUNREACH: return "EHOSTUNREACH";
  case ENETUNREACH: return "ENETUNREACH";
#ifdef EHOSTDOWN
  case EHOSTDOWN: return "EHOSTDOWN"; /* absent from the win32 CRT */
#endif
  case EINVAL: return "EINVAL";
  default: return "EUNKNOWN";
  }
}

/* ── listener lists (the events/child snapshot discipline) ─────────────
 * The types live in scr_runtime.h: scr_http.c reuses the whole family
 * for its request-body listener lists. */

void scr_net_ls_add(ScrNetLs *l, ScrClosure *cb, void *fn, bool once) {
  if (l->n == l->cap) {
    l->cap = l->cap ? l->cap * 2 : 2;
    l->ls = realloc(l->ls, l->cap * sizeof *l->ls);
    if (!l->ls) scr_net_oom();
  }
  l->ls[l->n].cb = cb;
  l->ls[l->n].fn = fn;
  l->ls[l->n].once = once;
  l->n++;
}

void scr_net_ls_drop(ScrNetLs *l) {
  for (size_t i = 0; i < l->n; i++) scr_closure_release(l->ls[i].cb);
  free(l->ls);
  l->ls = NULL;
  l->n = l->cap = 0;
}

/* Snapshot for a firing pass: entries retained; `once` entries leave the
 * LIVE list before their callback runs (Node's once semantics — a
 * re-delivery during the callback re-registers cleanly). Caller invokes
 * each snapshot entry, releases it, and frees the vector. */
size_t scr_net_ls_snapshot(ScrNetLs *l, ScrNetL **out) {
  size_t n = l->n;
  if (n == 0) {
    *out = NULL;
    return 0;
  }
  ScrNetL *snap = malloc(n * sizeof *snap);
  if (!snap) scr_net_oom();
  for (size_t i = 0; i < n; i++) {
    snap[i] = l->ls[i];
    scr_closure_retain(snap[i].cb);
  }
  /* remove the once entries from the live list */
  size_t w = 0;
  for (size_t i = 0; i < l->n; i++) {
    if (l->ls[i].once) {
      scr_closure_release(l->ls[i].cb);
    } else {
      l->ls[w++] = l->ls[i];
    }
  }
  l->n = w;
  *out = snap;
  return n;
}

/* Fire a zero-payload event list (end/close/connect/listening) with the
 * emitting handle bound as the ambient receiver for each callback (Node
 * calls listeners with `this` === the emitter — scr_runtime.h's design
 * note). `self` is BORROWED (the caller keeps the handle alive across
 * the pass); NULL binds the undefined receiver. */
void scr_net_fire0_this(ScrNetLs *l, void *self, ScrDynHandleTag tag) {
  ScrNetL *snap;
  size_t n = scr_net_ls_snapshot(l, &snap);
  scr_dyn_this_push(self, tag);
  for (size_t i = 0; i < n; i++) {
    if (!scr_exc_pending()) ((void (*)(ScrClosure *))snap[i].cb->fn)(snap[i].cb);
    scr_closure_release(snap[i].cb);
  }
  scr_dyn_this_pop();
  free(snap);
}

void scr_net_fire0(ScrNetLs *l) { scr_net_fire0_this(l, NULL, 0); }

/* A SOCKET's 'close' list: the same zero-payload pass, except that a
 * listener which asked for `hadError` gets it. WHICH listeners those are
 * is recorded in the entry's adapter slot at registration (NULL = the
 * zero-argument shape, which is every listener this list held before and
 * every checked-dynamic one still), so the split costs one pointer test
 * per listener and nothing at all to a program that never spells the
 * parameter. It is the pointer dispatch scr_net_fire_err_impl already
 * uses, for the same reason it does: the (ScrClosure *) call convention
 * eight other handle families share stays unwidened. */
static void scr_net_fire_close(ScrNetLs *l, void *self, ScrDynHandleTag tag, bool had_error) {
  ScrNetL *snap;
  size_t n = scr_net_ls_snapshot(l, &snap);
  scr_dyn_this_push(self, tag);
  for (size_t i = 0; i < n; i++) {
    if (!scr_exc_pending()) {
      if (snap[i].fn != NULL) ((ScrNetCloseFn)snap[i].fn)(snap[i].cb, had_error);
      else ((void (*)(ScrClosure *))snap[i].cb->fn)(snap[i].cb);
    }
    scr_closure_release(snap[i].cb);
  }
  scr_dyn_this_pop();
  free(snap);
}

/* Fire an error list through the ScrChildErrFn adapters (msg borrowed),
 * the emitting handle bound as the ambient receiver. An 'error' with NO
 * listener is fatal, like Node's unhandled 'error' EventEmitter throw:
 * print and die 1 (_Exit skips atexit on purpose — the loop dies
 * mid-turn with registries live, like process.exit). Exported:
 * scr_http.c's req/res/client fire their 'error' the same way. */
/* `obj` NULL = the ordinary message-only fan-out. Non-NULL = the caller
 * has the actual Error OBJECT (request.destroy(err)) and the listeners
 * must receive THAT, with its identity, name, code and own properties
 * intact — rebuilding a lookalike from the message would answer `false`
 * to `e === sent`, `"Error"` to the name of every subclass, and
 * `undefined` to every code that is not an errno name.
 *
 * How the object reaches a listener without widening the shared
 * (ScrClosure *, ScrStr *msg) ABI that nine handle families use: the
 * adapter POINTER says what the listener wants. The compiler emits
 * exactly two of them — scr_child_err_thunk_error for `(err) => …` and
 * scr_child_err_thunk0 for `() => …` — so recognising the first one is
 * enough to call the user's closure directly with the real error.
 *
 * The earlier version of this was an ambient "current error object"
 * global read by the thunk. It worked, and it cost a stream-free
 * hello-world 512 BYTES, because the thunk lives in scr_child.c, which
 * is unconditionally linked and has no dead stripping — the brief's
 * named hazard, measured. Dispatching on the pointer here instead keeps
 * every byte of this inside scr_net.c, which is gated, and removes the
 * global's nesting hazard (an 'error' raised from inside a destroy(err)
 * listener could have inherited the outer object) by having no global
 * at all. */
static void scr_net_fire_err_impl(ScrNetLs *l, ScrStr *msg, ScrError *obj,
                                  void *self, ScrDynHandleTag tag) {
  if (l->n == 0) {
    fflush(stdout);
    fprintf(stderr, "Unhandled 'error' event: Error: %s\n", msg->data);
    _Exit(1);
  }
  ScrNetL *snap;
  size_t n = scr_net_ls_snapshot(l, &snap);
  scr_dyn_this_push(self, tag);
  for (size_t i = 0; i < n; i++) {
    if (!scr_exc_pending()) {
      if (obj != NULL && snap[i].fn == (void *)&scr_child_err_thunk_error) {
        /* the listener owns a +1 error param, the universal convention */
        ((void (*)(ScrClosure *, ScrError *))snap[i].cb->fn)(
            snap[i].cb, scr_error_retain(obj));
      } else {
        ((ScrChildErrFn)snap[i].fn)(snap[i].cb, msg);
      }
    }
    scr_closure_release(snap[i].cb);
  }
  scr_dyn_this_pop();
  free(snap);
}

void scr_net_fire_err_this(ScrNetLs *l, ScrStr *msg, void *self, ScrDynHandleTag tag) {
  scr_net_fire_err_impl(l, msg, NULL, self, tag);
}

void scr_net_fire_err(ScrNetLs *l, ScrStr *msg) { scr_net_fire_err_impl(l, msg, NULL, NULL, 0); }

void scr_net_fire_err_obj(ScrNetLs *l, ScrError *err /*borrowed*/) {
  scr_net_fire_err_impl(l, err->message, err, NULL, 0);
}

void scr_net_fire_err_obj_this(ScrNetLs *l, ScrError *err /*borrowed*/, void *self,
                               ScrDynHandleTag tag) {
  scr_net_fire_err_impl(l, err->message, err, self, tag);
}

/* ── the handles ─────────────────────────────────────────────────────── */

enum { SCR_NET_K_SERVER = 1, SCR_NET_K_SOCKET = 2, SCR_NET_K_DIAL = 3 };

/* Per family, the most candidate addresses a dial chain will hold. Node
 * has no cap; a chain longer than this stops growing (documented). */
#define SCR_NET_HE_MAX 16

/* The attempt timer's poller identity. The idle timer is keyed by the
 * SOCKET pointer, so this one needs a key of its own — a sub-struct
 * whose address is unique and whose FIRST int routes the drain, exactly
 * like the server and socket handles. */
typedef struct ScrNetDialTimer {
  int kind; /* FIRST: poller udata routes on it */
  struct ScrNetSocket *sock;
} ScrNetDialTimer;

struct ScrNetServer {
  int kind; /* FIRST: poller udata routes on it */
  size_t rc;
  int fd; /* -1 while not listening */
  int port;
  bool listening;
  bool closing;       /* close() called; 'close' fires when conns drain */
  bool close_emitted; /* settled: off the registry, listeners dropped */
  bool emit_listening;
  bool defer_conn; /* TLS: 'connection' fires post-handshake, not at accept */
  bool bound_v6;       /* the bound family (address()'s 'IPv6'/'IPv4' split) */
  ScrStr *bound_host;  /* the explicit bind host (NULL = the host-less any:
                        * '::' when bound_v6, else '0.0.0.0' — Node's own
                        * address().address answers) */
  ScrStr *pending_err; /* deferred listen failure */
  size_t nconns;
  ScrNetLs conn_ls, err_ls, close_ls, listening_cbs;
  /* protocol layer (scr_http.c): a C-level connection consumer + its
   * context, freed with the handle */
  ScrNetNativeConnFn native_conn;
  void *native_ctx;
  void (*native_ctx_free)(void *);
  /* the HTTP-parser ctx ALIAS (borrowed — owned through the native-conn
   * chain): late 'request' installs reach it even after a TLS wrap
   * replaced native_ctx (the https/http2 servers). NULL = no parser. */
  void *http_ctx;
  /* The protocol layer's settle hook (scr_http.c): drops the ctx's OWN
   * listener lists when the server settles — the settle-releases-
   * listeners story extended across the layer seam. A request handler
   * capturing its own server through a dyn binding box would otherwise
   * cycle through edges the collector cannot trace (box → dyn → handle →
   * ctx → closure → box). Takes http_ctx; NULL = no hook. */
  void (*proto_settle)(void *http_ctx);
  /* wrapper.close = fn — the portless close-proxy idiom: when set,
   * server.close() invokes THIS closure (a compiler-emitted zero-arg
   * wrapper around the user override) instead of closing; the override
   * body reaches the real close through its bound `origClose` value
   * (scr_net_server_close_direct — never re-consults the override). */
  ScrClosure *close_override;
  /* DUE order: a global stamp taken the moment this server first becomes
   * drained-and-closing — i.e. the moment Node's _emitCloseIfDrained
   * would have scheduled its emitCloseNT tick. Due servers settle in
   * ascending order. Close-REQUEST order is the special case where every
   * server was already drained when close() ran (the wrapper-closes-inner
   * idiom), and it still holds there, because they are all stamped inside
   * their own close_direct in call order. Where the two differ — a busy
   * server closed BEFORE a drained one — close-request order is wrong:
   * Node emits the drained one first, and did so 100/100 while this
   * runtime reversed it at a rate. 0 = not due yet. */
  size_t due_seq;
  size_t due_epoch; /* the epoch due_seq was taken in -- see scr_net_epoch */
  bool in_registry;
  struct ScrNetServer *next;
};

struct ScrNetSocket {
  int kind; /* FIRST: poller udata routes on it */
  size_t rc;
  int fd; /* -1 once closed */
  bool connecting;
  bool rd_eof;    /* peer FIN seen (or read half abandoned) */
  bool enc_utf8;  /* setEncoding('utf8'): 'data' delivers strings */
  bool wr_ending; /* end() called: FIN when the buffer drains */
  bool wr_done;   /* FIN sent (or write half dead) */
  bool had_error;
  bool emit_close;    /* fd closed; 'close' fires at the next sweep */
  bool close_emitted; /* settled */
  /* This socket is still counted in server->nconns. Node drops the count
   * inside Socket._destroy — SYNCHRONOUSLY, at destroy() time — and not
   * when the socket's own 'close' is finally delivered, so the server's
   * _emitCloseIfDrained tick is scheduled a whole event-loop phase before
   * any close callback runs. We do the same: the count comes off in
   * scr_net_sock_detach_server() the moment the fd goes, and this flag is
   * the one-shot that keeps the later settle from decrementing twice. */
  bool conn_counted;
  /* CLOSE-PHASE order. libuv pushes a closing handle onto the front of
   * loop->closing_handles and uv__run_closing_handles walks that list, so
   * the close callbacks of one iteration run in REVERSE order of the
   * uv_close() calls: two sockets destroyed in one turn emit 'close' in
   * the opposite order. Stamped once, when the fd goes; 0 = not closing. */
  size_t close_seq;
  size_t close_epoch; /* the epoch close_seq was taken in -- see scr_net_epoch */
  /* This socket was destroyed while ITS OWN event was being delivered.
   * See scr_net_sock_close_phase: such a socket's 'close' lands a whole
   * loop iteration ahead of the others on this platform. */
  bool close_self;
  /* Held back by the self rule: this socket's 'close' belongs to a LATER
   * iteration than the one the close phase just ran, so its close_epoch is
   * re-stamped at each sweep head until it is emitted. */
  bool close_deferred;
  bool read_armed, write_armed;
  /* Consumer-less back-off: a socket nobody reads was PEEKED and found
   * bytes waiting. Node stops reading at its high-water mark for the same
   * reason; here the bytes stay in the kernel, so the poller must stop
   * signalling until a consumer appears (a level-triggered readable that
   * nothing drains is a spin). Cleared the moment there is a consumer. */
  bool rd_probe_off;
  /* write buffer: [whead, wlen) of wbuf is unsent */
  char *wbuf;
  size_t whead, wlen, wcap;
  /* receive buffer: [rhead, rlen) of rbuf is arrived-but-unconsumed —
   * fed by paused-mode reads ('readable' consumers) and unshift; drained
   * FIRST by every consumer (data listeners, the parser attach, the TLS
   * bio) so a peeked byte re-enters the stream ahead of the kernel's */
  char *rbuf;
  size_t rhead, rlen, rcap;
  ScrNetSocket *pipe_dst; /* +1; src EOF end()s the dst, Node's pipe default */
  /* peer identity for Node-shaped connect error messages */
  char peer_ip[64];
  int peer_port;
  /* remoteAddress, cached at first read like Node's _getpeername — a
   * value read while connected survives destroy; never-read sockets
   * answer undefined after close */
  ScrStr *remote_cache;
  ScrStr *pending_err; /* deferred connect failure */
  /* the caller-lookup dial (net.connect with a lookup option): true while
   * the lookup decides; dial_ips holds its answered addresses (+1 each),
   * dialed in order — a connect failure closes the fd and tries
   * dial_ips[dial_i]; the LAST failure's message surfaces (Node's
   * autoSelectFamily aggregate is the documented divergence) */
  bool lookup_wait;
  /* a deferred dial (the http agent's maxSockets queue): registered and
   * "connecting" (writes buffer), the actual dial starts on
   * scr_net_sock_dial_start */
  bool dial_deferred;
  ScrStr **dial_ips;
  size_t dial_n, dial_i;
  /* the in-flight dial chain's LAST failure — surfaced (moved into
   * pending_err) only when the list exhausts; a later success drops it */
  ScrStr *dial_err;
  /* Node's autoSelectFamily attempt schedule. A dial that still has a
   * candidate BEHIND it gets an attempt budget; when it elapses the
   * attempt is abandoned — its fd CLOSED (Node's handle.close(), so
   * exactly one socket is ever in flight) — and the chain moves on to
   * the next family. The FINAL candidate carries NO budget: it runs to
   * the OS's own connect timeout, measured as Node's rule too
   * (`current < context.addresses.length - 1`). dial_attempt_ms == 0
   * turns the schedule off, which is what a caller-supplied lookup's
   * chain keeps (its documented behaviour is dial-in-order). */
  ScrNetDialTimer dial_timer;
  bool dial_timer_armed;
  double dial_attempt_ms;
  ScrNetLs data_ls, end_ls, close_ls, err_ls, conn_ls, timeout_ls, readable_ls;
  /* Flow control (pause()/resume()): user_paused holds reads OFF even
   * with consumers (kernel/TCP backpressure is the buffer); flowing
   * counts as a consumer even with no 'data' listener
   * (resume()'s flow-and-discard drain, how Node reaches 'end' on an
   * unconsumed stream). resume() clears user_paused and sets flowing. */
  bool user_paused;
  bool flowing;
  /* destroySoon(): end() now, destroy once the FIN actually went out */
  bool destroy_on_finish;
  /* socket.bytesWritten: every byte accepted by the write paths (user
   * writes, protocol heads, pipe deliveries — plaintext on TLS sockets) */
  size_t bytes_written;
  /* end(callback)/write(chunk, callback): 'finish'-shaped callbacks fire
   * from the SWEEP (never the registering stack — Node defers them too).
   * finish_ls waits for the FIN (wr_done); wcb_ls waits for the write
   * buffer to drain (this surface's flush moment). */
  ScrNetLs finish_ls, wcb_ls;
  bool finish_pending; /* wr_done seen: fire finish_ls at the next sweep */
  /* a server whose 'connection' waits for this socket's handshake — the
   * TLS defer target (+1; the socket's own `server` backref stays the
   * ACCEPTING server, which may be the demux wrapper) */
  ScrNetServer *conn_pending;
  /* the idle timer (setTimeout): a one-shot poller timer keyed by this
   * socket's pointer, re-armed on every read/write/connect activity —
   * 'timeout' fires once per idle period and never destroys the socket,
   * Node's semantics */
  double timeout_ms;
  bool timeout_armed;
  ScrNetServer *server; /* +1 backref (accepted sockets), NULL for clients */
  /* protocol layer (scr_http.c): a C-level reader — counts as a consumer
   * for read-arming; its context BORROWS this socket and is freed with it */
  ScrNetNativeDataFn native_data;
  ScrNetNativeEventFn native_eof;
  ScrNetNativeEventFn native_closed;
  ScrNetNativeEventFn native_timeout;
  ScrNetNativeEventFn native_established; /* client connect completed (the
                                           * h2 session's 'connect' moment;
                                           * fires before conn_ls) */
  ScrNetNativeErrFn native_err; /* true = consumed (the protocol layer owns
                                 * the error story); false falls through to
                                 * this socket's own err_ls */
  void *native_ctx;
  void (*native_ctx_free)(void *);
  /* transport layer (scr_tls.c): reads/writes redirect through the ops
   * once set; writes buffer and readiness drives the handshake until
   * t_est. Sits BELOW the protocol layer — an https socket carries both
   * (the parser in native_*, the TLS engine here). */
  const ScrNetTransportOps *tops;
  void *tctx;
  bool t_est;
  bool t_want_write; /* a handshake send hit EAGAIN: arm the write filter */
  bool in_registry;
  struct ScrNetSocket *next;
};

#ifdef SCR_RC_AUDIT
static long scr_net_live = 0;
long scr_net_live_count(void) { return scr_net_live; }
#endif

static ScrNetServer *scr_net_servers = NULL; /* registry: +1 each, tail-appended */
static ScrNetSocket *scr_net_socks = NULL;
static ScrPoller *scr_net_poller = NULL;

/* ── RC ──────────────────────────────────────────────────────────────── */

static void scr_net_close_fd_raw(int fd); /* forget-then-close, defined below */

ScrNetServer *scr_net_server_retain(ScrNetServer *s) {
  if (s->rc != SIZE_MAX) s->rc++;
  return s;
}

void scr_net_server_release(ScrNetServer *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) {
    if (s->native_ctx_free) s->native_ctx_free(s->native_ctx);
    scr_net_ls_drop(&s->conn_ls);
    scr_net_ls_drop(&s->err_ls);
    scr_net_ls_drop(&s->close_ls);
    scr_net_ls_drop(&s->listening_cbs);
    scr_closure_release(s->close_override);
    scr_str_release(s->bound_host);
    scr_str_release(s->pending_err);
    if (s->fd >= 0) scr_net_close_fd_raw(s->fd);
#ifdef SCR_RC_AUDIT
    scr_net_live--;
#endif
    free(s);
  }
}

void *scr_net_server_retain_v(void *p) { return scr_net_server_retain((ScrNetServer *)p); }
void scr_net_server_release_v(void *p) { scr_net_server_release((ScrNetServer *)p); }

ScrNetSocket *scr_net_sock_retain(ScrNetSocket *s) {
  if (s->rc != SIZE_MAX) s->rc++;
  return s;
}

void scr_net_sock_release(ScrNetSocket *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) {
    if (s->native_ctx_free) s->native_ctx_free(s->native_ctx);
    if (s->tops && s->tops->free_fn) s->tops->free_fn(s->tctx);
    scr_net_ls_drop(&s->data_ls);
    scr_net_ls_drop(&s->end_ls);
    scr_net_ls_drop(&s->close_ls);
    scr_net_ls_drop(&s->err_ls);
    scr_net_ls_drop(&s->conn_ls);
    scr_net_ls_drop(&s->timeout_ls);
    scr_net_ls_drop(&s->readable_ls);
    scr_net_ls_drop(&s->finish_ls);
    scr_net_ls_drop(&s->wcb_ls);
    scr_str_release(s->pending_err);
    scr_str_release(s->remote_cache);
    for (size_t i = 0; i < s->dial_n; i++) scr_str_release(s->dial_ips[i]);
    free(s->dial_ips);
    scr_str_release(s->dial_err);
    /* the attempt key must leave the poller table before this struct
     * does — the table holds &s->dial_timer, which is inside it */
    if (s->dial_timer_armed && scr_net_poller != NULL) {
      scrp_timer_cancel(scr_net_poller, &s->dial_timer);
    }
    free(s->wbuf);
    free(s->rbuf);
    if (s->pipe_dst) scr_net_sock_release(s->pipe_dst);
    if (s->conn_pending) scr_net_server_release(s->conn_pending);
    if (s->server) scr_net_server_release(s->server);
    if (s->fd >= 0) scr_net_close_fd_raw(s->fd);
#ifdef SCR_RC_AUDIT
    scr_net_live--;
#endif
    free(s);
  }
}

void *scr_net_sock_retain_v(void *p) { return scr_net_sock_retain((ScrNetSocket *)p); }
void scr_net_sock_release_v(void *p) { scr_net_sock_release((ScrNetSocket *)p); }

/* ── poller plumbing (the scr_platform.h seam) ───────────────────────── */

static bool scr_net_poller_init(void) {
  if (scr_net_poller != NULL) return true;
  scr_net_poller = scrp_poller_new();
  return scr_net_poller != NULL;
}

static void scr_net_nonblock(int fd) {
#ifdef _WIN32
  u_long one = 1;
  ioctlsocket((SOCKET)fd, FIONBIO, &one);
  /* FD_CLOEXEC's spelling: spawned children must not inherit the socket */
  SetHandleInformation((HANDLE)(SOCKET)fd, HANDLE_FLAG_INHERIT, 0);
#else
  fcntl(fd, F_SETFL, O_NONBLOCK);
  fcntl(fd, F_SETFD, FD_CLOEXEC);
#ifdef SO_NOSIGPIPE
  int one = 1;
  setsockopt(fd, SOL_SOCKET, SO_NOSIGPIPE, &one, sizeof one);
#endif
#endif
}

/* SO_REUSEADDR on listeners, POSIX only — libuv's exact split. On Unix
 * the flag lets a restarted server rebind its TIME_WAIT port (Node's
 * behavior, so the historical call stands). On Windows the SAME flag
 * means port hijacking: a second bind of an actively-listened port
 * SUCCEEDS and so does its listen(), so EADDRINUSE never surfaces — the
 * net-port-check/net-error-codes fixtures hang waiting for an 'error'
 * that never comes. Winsock's default already permits the TIME_WAIT
 * rebind, so omitting the flag there loses nothing and restores Node's
 * (libuv's) EADDRINUSE. */
static void scr_net_listen_reuseaddr(int fd) {
#ifdef _WIN32
  (void)fd;
#else
  int one = 1;
  setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
#endif
}

/* write(2) to a socket with SIGPIPE suppressed. macOS sets SO_NOSIGPIPE
 * per fd above (send() path unchanged: write, exactly the historical
 * call); Linux has no SO_NOSIGPIPE — MSG_NOSIGNAL on each send is the
 * per-socket equivalent, turning a closed-peer write into EPIPE for the
 * deferred 'error' sweep instead of process death. */
static ssize_t scr_net_send(int fd, const void *buf, size_t len) {
#if defined(_WIN32)
  /* No SIGPIPE exists on Windows: a closed-peer send fails outright
   * (WSAECONNRESET/WSAESHUTDOWN, mapped) for the deferred 'error' sweep. */
  int n = send((SOCKET)fd, (const char *)buf, len > 0x40000000 ? 0x40000000 : (int)len, 0);
  if (n < 0) scr_w32_seterr();
  return n;
#elif defined(MSG_NOSIGNAL)
  return send(fd, buf, len, MSG_NOSIGNAL);
#else
  return write(fd, buf, len);
#endif
}

/* The idle timer rides the same poller: one-shot, keyed by the socket
 * pointer (kqueue: EVFILT_TIMER ident; epoll: a per-key timerfd), in
 * milliseconds. Re-arming an armed key replaces the deadline. */
static void scr_net_sock_timer_arm(ScrNetSocket *s) {
  if (scr_net_poller == NULL || s->fd < 0 || s->timeout_ms <= 0) return;
  (void)scrp_timer_arm(scr_net_poller, s, s->timeout_ms, s);
  s->timeout_armed = true;
}

static void scr_net_sock_timer_cancel(ScrNetSocket *s) {
  if (!s->timeout_armed) return;
  s->timeout_armed = false;
  if (scr_net_poller == NULL) return;
  scrp_timer_cancel(scr_net_poller, s); /* may already have fired */
}

/* The attempt timer rides the SAME poller, keyed by &s->dial_timer so it
 * is a different key from the idle timer's (which is `s`): a socket can
 * legitimately hold both at once — setTimeout() before connect() arms
 * the idle clock while the dial chain is still choosing a family. */
static void scr_net_sock_attempt_arm(ScrNetSocket *s) {
  if (scr_net_poller == NULL || s->fd < 0 || s->dial_attempt_ms <= 0) return;
  (void)scrp_timer_arm(scr_net_poller, &s->dial_timer, s->dial_attempt_ms, &s->dial_timer);
  s->dial_timer_armed = true;
}

static void scr_net_sock_attempt_cancel(ScrNetSocket *s) {
  if (!s->dial_timer_armed) return;
  s->dial_timer_armed = false;
  if (scr_net_poller == NULL) return;
  scrp_timer_cancel(scr_net_poller, &s->dial_timer); /* may already have fired */
}

/* Activity: every read/write/connect resets the idle clock (re-arming an
 * existing timer replaces its deadline). */
static void scr_net_sock_touch(ScrNetSocket *s) {
  if (s->timeout_ms > 0 && s->fd >= 0) scr_net_sock_timer_arm(s);
}

/* Drop a watched fd's registrations and close it — forget MUST precede
 * close(2) under epoll (see scr_platform.h; the kqueue forget is a
 * no-op). Every close of a possibly-watched fd in this unit goes through
 * here. */
static void scr_net_close_fd_raw(int fd) {
  if (fd < 0) return;
  if (scr_net_poller != NULL) scrp_forget(scr_net_poller, fd);
  close(fd);
}

/* NULL-poller-safe watch wrappers (the historical scr_net_filter guards);
 * registration failures are ignored exactly as kevent's always were. */
static void scr_net_watch_read(int fd, void *udata, bool on) {
  if (scr_net_poller == NULL) return;
  (void)scrp_watch_read(scr_net_poller, fd, udata, on);
}

static void scr_net_watch_write(int fd, void *udata, bool on) {
  if (scr_net_poller == NULL) return;
  (void)scrp_watch_write(scr_net_poller, fd, udata, on);
}

/* ── registries ──────────────────────────────────────────────────────── */

static void scr_net_server_register(ScrNetServer *s) {
  if (s->in_registry) return;
  s->in_registry = true;
  s->next = NULL;
  ScrNetServer **link = &scr_net_servers;
  while (*link) link = &(*link)->next;
  *link = scr_net_server_retain(s);
}

static void scr_net_server_unregister(ScrNetServer *s) {
  if (!s->in_registry) return;
  ScrNetServer **link = &scr_net_servers;
  while (*link && *link != s) link = &(*link)->next;
  if (*link) {
    *link = s->next;
    s->next = NULL;
    s->in_registry = false;
    scr_net_server_release(s);
  }
}

static void scr_net_sock_register(ScrNetSocket *s) {
  if (s->in_registry) return;
  s->in_registry = true;
  s->next = NULL;
  ScrNetSocket **link = &scr_net_socks;
  while (*link) link = &(*link)->next;
  *link = scr_net_sock_retain(s);
}

static void scr_net_sock_unregister(ScrNetSocket *s) {
  if (!s->in_registry) return;
  ScrNetSocket **link = &scr_net_socks;
  while (*link && *link != s) link = &(*link)->next;
  if (*link) {
    *link = s->next;
    s->next = NULL;
    s->in_registry = false;
    scr_net_sock_release(s);
  }
}

/* ── socket state machine ────────────────────────────────────────────── */

static ScrNetSocket *scr_net_sock_new(void) {
  ScrNetSocket *s = calloc(1, sizeof *s);
  if (!s) scr_net_oom();
  s->kind = SCR_NET_K_SOCKET;
  s->rc = 1;
  s->fd = -1;
  s->dial_timer.kind = SCR_NET_K_DIAL;
  s->dial_timer.sock = s;
  /* the PROCESS-WIDE budget, read here — a socket is minted at its
   * connect, which is where Node reads
   * autoSelectFamilyAttemptTimeoutDefault too, so a
   * setDefaultAutoSelectFamilyAttemptTimeout before the dial takes
   * effect and one after it does not */
  s->dial_attempt_ms = scr_net_get_autosel_timeout();
#ifdef SCR_RC_AUDIT
  scr_net_live++;
#endif
  return s;
}

/* One byte of MSG_PEEK: 1 when bytes are waiting, 0 at the peer's FIN,
 * -1/EAGAIN when neither has arrived yet. Peeking answers "FIN or data?"
 * WITHOUT taking anything out of the kernel — which is the whole point:
 * a socket nobody reads can see EOF exactly where Node does while the
 * bytes it did not ask for stay where they were, so back-pressure and a
 * late listener's byte count are both untouched. */
static ssize_t scr_net_peek1(int fd) {
  char b;
#ifdef _WIN32
  int n = recv((SOCKET)fd, &b, 1, MSG_PEEK);
  if (n < 0) scr_w32_seterr();
  return n;
#else
  return recv(fd, &b, 1, MSG_PEEK);
#endif
}

/* Read arming. Consumers drive a real read (the stdin discipline: never
 * take a byte nobody consumes — the socket buffer is the backpressure).
 * A socket with NO consumer is watched too, because Node's afterConnect
 * and its accepted-socket constructor both call read(0): a socket that is
 * not paused notices its peer's FIN with no 'data' listener anywhere, and
 * without that this one never leaves the registry and the loop never
 * drains. That watch is served by a PEEK rather than a read (see
 * scr_net_sock_read) and switches itself off through rd_probe_off the
 * moment the peek finds bytes nobody wants. An explicitly PAUSED socket
 * is watched by neither rule — Node's paused socket does not observe EOF
 * either (measured against the oracle). */
static void scr_net_sock_update_read(ScrNetSocket *s) {
  bool consumer = s->data_ls.n > 0 || s->pipe_dst != NULL || s->native_data != NULL ||
                  s->flowing /* resume(): flow (and discard sans listeners) */ ||
                  s->readable_ls.n > 0 /* paused-mode consumer: bytes buffer */ ||
                  s->tops != NULL /* a transport is ALWAYS a consumer: the TLS
                                   * layer must process protocol frames (the
                                   * handshake, close_notify, 1.3 tickets)
                                   * even when no app consumer exists, and a
                                   * peer's FIN must reach the teardown —
                                   * decrypted app data buffers like the
                                   * paused-mode path's */ ||
                  s->wr_done /* FIN sent: drain to EOF so the peer's close is
                              * seen even with no consumer — Node resumes a
                              * finished socket the same way */;
  if (consumer) s->rd_probe_off = false; /* a consumer re-opens the peek */
  bool want = s->fd >= 0 && !s->connecting && !s->rd_eof && !s->user_paused &&
              (consumer || !s->rd_probe_off);
  if (want && !s->read_armed) {
    scr_net_watch_read(s->fd, s, true);
    s->read_armed = true;
  } else if (!want && s->read_armed) {
    scr_net_watch_read(s->fd, s, false);
    s->read_armed = false;
  }
}

static void scr_net_sock_update_write(ScrNetSocket *s) {
  bool want = s->fd >= 0 && (s->connecting || s->wlen > s->whead || s->t_want_write);
  if (want && !s->write_armed) {
    scr_net_watch_write(s->fd, s, true);
    s->write_armed = true;
  } else if (!want && s->write_armed) {
    scr_net_watch_write(s->fd, s, false);
    s->write_armed = false;
  }
}

static void scr_net_server_mark_due(ScrNetServer *s);

/* The EPOCH is this runtime's stand-in for "which loop iteration's
 * callback was on the stack". It advances once per poller event delivered
 * in the dispatch drain, and once per sweep pass. Everything a single JS
 * callback does -- every socket it destroys, every server it drains --
 * therefore shares one epoch, and two sockets whose readiness the kernel
 * reported as separate events do not. */
static size_t scr_net_epoch = 1;

/* The socket whose event is being delivered right now (NULL between
 * deliveries). Set around every place a socket's own callbacks run: the
 * dispatch drain's per-socket events, the sweep's per-socket walk, and the
 * close phase. */
static ScrNetSocket *scr_net_cur_sock = NULL;

/* Stamps this socket's place in the close phase (see close_seq). */
static void scr_net_sock_mark_closing(ScrNetSocket *s) {
  static size_t scr_net_sock_close_seq = 0;
  if (s->close_seq == 0 && !s->close_emitted) {
    s->close_seq = ++scr_net_sock_close_seq;
    s->close_epoch = scr_net_epoch;
    s->close_self = (s == scr_net_cur_sock);
  }
}

/* Drops this socket from its server's connection count, and stamps the
 * server's settle order if that emptied it.
 *
 * Node's Socket.prototype._destroy runs `this._server._connections--`
 * and `_emitCloseIfDrained()` on the destroying STACK, while the socket's
 * own 'close' waits for libuv to run the handle's close callback in the
 * loop's close phase. The nextTick queue drains before that phase, so a
 * server drained by a dying socket emits its 'close' BEFORE the socket
 * that drained it, and before every other socket closing in the same
 * turn. Decrementing here — rather than in the sweep's close-emission
 * branch, where it used to live — is what puts the server's stamp on the
 * right side of that boundary.
 *
 * The server REFERENCE is deliberately left in place: scr_net_sock_server()
 * is the receiver scr_http.c/scr_http2.c push as `this` for handlers that
 * may still run, and the ref is released at the settle as before. Only the
 * count and the due stamp move. */
static void scr_net_sock_detach_server(ScrNetSocket *s) {
  if (!s->conn_counted || s->server == NULL) return;
  s->conn_counted = false;
  s->server->nconns--;
  if (s->server->closing && s->server->nconns == 0 && !s->server->close_emitted) {
    scr_net_server_mark_due(s->server);
  }
}

/* Close the fd (registrations dropped first — the epoll obligation) and
 * flag the 'close' sweep. */
static void scr_net_sock_close_fd(ScrNetSocket *s) {
  scr_net_sock_timer_cancel(s);
  scr_net_sock_attempt_cancel(s);
  if (s->fd >= 0) {
    scr_net_close_fd_raw(s->fd);
    s->fd = -1;
    s->read_armed = s->write_armed = false;
  }
  if (!s->close_emitted) {
    s->emit_close = true;
    scr_net_sock_mark_closing(s);
  }
  scr_net_sock_detach_server(s); /* Node counts down inside _destroy */
}

/* The FIN half: called when the write half is ENDING and the buffer just
 * drained (or was empty). Full close once the read half is done too. */
static void scr_net_sock_maybe_finish_write(ScrNetSocket *s) {
  if (s->fd < 0 || !s->wr_ending || s->wr_done || s->wlen > s->whead) return;
  /* a transport says goodbye first (TLS close_notify), best-effort */
  if (s->tops && s->t_est) s->tops->shutdown_write(s->tctx);
  shutdown(s->fd, SHUT_WR);
  s->wr_done = true;
  if (s->finish_ls.n > 0) s->finish_pending = true; /* end(cb): the sweep fires it */
  if (s->destroy_on_finish) {
    /* destroySoon(): the FIN is out — tear down now (Node's 'finish'-then-
     * destroy). The close emits through the ordinary sweep. */
    scr_net_sock_close_fd(s);
    return;
  }
  if (s->rd_eof) scr_net_sock_close_fd(s);
  else scr_net_sock_update_read(s); /* the drain-to-EOF mode arms here */
}

/* Append bytes to the write buffer (post-immediate-write remainder, or
 * everything while connecting/buffered). */
static void scr_net_sock_buffer(ScrNetSocket *s, const char *data, size_t len) {
  if (len == 0) return;
  /* compact the consumed head first */
  if (s->whead > 0) {
    memmove(s->wbuf, s->wbuf + s->whead, s->wlen - s->whead);
    s->wlen -= s->whead;
    s->whead = 0;
  }
  if (s->wlen + len > s->wcap) {
    size_t cap = s->wcap ? s->wcap : 4096;
    while (cap < s->wlen + len) cap *= 2;
    s->wbuf = realloc(s->wbuf, cap);
    if (!s->wbuf) scr_net_oom();
    s->wcap = cap;
  }
  memcpy(s->wbuf + s->wlen, data, len);
  s->wlen += len;
}

/* The write path shared by write()/end(data)/pipe delivery. Ignored on a
 * dead or ended write half (Node fires 'error' there; this slice drops —
 * SEMANTICS.md documents the bound). */
static void scr_net_sock_write_raw(ScrNetSocket *s, const char *data, size_t len) {
  /* A socket whose dial hasn't STARTED yet (the agent's deferred dial,
   * the caller-lookup wait) has no fd but is logically connecting —
   * bytes buffer and flush at establishment like any mid-connect write. */
  bool pre_dial = s->fd < 0 && (s->dial_deferred || s->lookup_wait) &&
                  !s->wr_ending && !s->close_emitted;
  if (!pre_dial && (s->fd < 0 || s->wr_ending || s->close_emitted)) return;
  if (len == 0) return;
  s->bytes_written += len; /* accepted bytes (Node counts buffered ones too) */
  if (pre_dial || s->connecting || s->wlen > s->whead || (s->tops && !s->t_est)) {
    /* mid-connect and mid-handshake bytes buffer; the flush after
     * 'connect'/establishment sends them */
    scr_net_sock_buffer(s, data, len);
    scr_net_sock_update_write(s);
    return;
  }
  ssize_t sent = s->tops ? s->tops->xwrite(s->tctx, data, len) : scr_net_send(s->fd, data, len);
  if (sent > 0) scr_net_sock_touch(s);
  if (sent < 0) {
    if (errno == EAGAIN || errno == EWOULDBLOCK || errno == EINTR) sent = 0;
    else {
      /* Delivery failure (EPIPE/ECONNRESET): defer to the error sweep. */
      char msg[96];
      snprintf(msg, sizeof msg, "write %s", scr_net_errname(errno));
      if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
      s->had_error = true;
      scr_net_sock_close_fd(s);
      return;
    }
  }
  if ((size_t)sent < len) {
    scr_net_sock_buffer(s, data + sent, len - (size_t)sent);
    scr_net_sock_update_write(s);
  }
}

/* Flush on write-readiness; drives the FIN when ENDING. */
static void scr_net_sock_flush(ScrNetSocket *s) {
  if (s->tops && !s->t_est) return; /* nothing moves until the handshake ends */
  while (s->fd >= 0 && s->wlen > s->whead) {
    ssize_t sent = s->tops ? s->tops->xwrite(s->tctx, s->wbuf + s->whead, s->wlen - s->whead)
                           : scr_net_send(s->fd, s->wbuf + s->whead, s->wlen - s->whead);
    if (sent < 0) {
      if (errno == EINTR) continue;
      if (errno == EAGAIN || errno == EWOULDBLOCK) return;
      char msg[96];
      snprintf(msg, sizeof msg, "write %s", scr_net_errname(errno));
      if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
      s->had_error = true;
      scr_net_sock_close_fd(s);
      return;
    }
    if (sent > 0) scr_net_sock_touch(s);
    s->whead += (size_t)sent;
  }
  if (s->wlen == s->whead) {
    s->whead = s->wlen = 0;
    scr_net_sock_update_write(s);
    scr_net_sock_maybe_finish_write(s);
  }
}

/* EOF: 'end' fires now (directly — Node's poll-phase emit), then the
 * write half ends (allowHalfOpen false), and the fd closes once the FIN
 * is out. 'close' waits for the sweep. */
static void scr_net_sock_eof(ScrNetSocket *s) {
  s->rd_eof = true;
  scr_net_sock_update_read(s);
  if (s->native_eof) {
    s->native_eof(s->native_ctx);
    if (scr_exc_pending()) return;
  }
  if (s->pipe_dst) {
    /* pipe's end-the-destination default */
    ScrNetSocket *dst = s->pipe_dst;
    if (!dst->wr_ending && dst->fd >= 0) {
      dst->wr_ending = true;
      scr_net_sock_maybe_finish_write(dst);
    }
  }
  scr_net_fire0_this(&s->end_ls, s, SCR_DYNH_NET_SOCKET);
  if (scr_exc_pending()) return;
  if (!s->wr_ending) {
    s->wr_ending = true;
    scr_net_sock_maybe_finish_write(s);
  }
  if (s->wr_done) scr_net_sock_close_fd(s);
}

/* Deliver one arrived chunk to the socket's consumers (the protocol
 * layer, the pipe destination, the 'data' listeners). Returns false when
 * a callback threw (the caller bails; the loop surfaces it). */
static bool scr_net_sock_deliver(ScrNetSocket *s, const char *buf, size_t n) {
  if (s->native_data) {
    s->native_data(s->native_ctx, buf, n);
    if (scr_exc_pending()) return false;
    /* the protocol layer OWNS this chunk exclusively — an upgrade
     * handover inside the call (native reader cleared, 'data' listeners
     * registered) must not re-deliver bytes the parser consumed; the
     * next chunk takes the listener path */
    return true;
  }
  if (s->pipe_dst) scr_net_sock_write_raw(s->pipe_dst, buf, n);
  if (s->data_ls.n > 0) {
    ScrBytes *chunk = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)n));
    memcpy(chunk->data, buf, n);
    ScrNetL *snap;
    size_t nl = scr_net_ls_snapshot(&s->data_ls, &snap);
    scr_dyn_this_push(s, SCR_DYNH_NET_SOCKET);
    scr_dyn_chunk_enc(s->enc_utf8);
    for (size_t i = 0; i < nl; i++) {
      if (!scr_exc_pending()) ((ScrNetDataFn)snap[i].fn)(snap[i].cb, chunk);
      scr_closure_release(snap[i].cb);
    }
    scr_dyn_chunk_enc(false);
    scr_dyn_this_pop();
    free(snap);
    scr_bytes_release(chunk);
    if (scr_exc_pending()) return false;
  }
  return true;
}

/* One readable wake: read until EAGAIN/EOF, one 'data' emit per read(2)
 * chunk (Node's chunking is arrival-driven too — only the reassembled
 * bytes are contractual, the stdin stance). Peeked/unshifted bytes in
 * the receive buffer deliver first — they precede the kernel's in the
 * stream. A TLS socket drains those through the engine's bio instead. */
static void scr_net_sock_append_rbuf(ScrNetSocket *s, const char *data, size_t len);
static void scr_net_sock_transport_pump(ScrNetSocket *s);

static void scr_net_sock_read(ScrNetSocket *s) {
  if (s->tops && !s->t_est) return; /* readiness feeds the handshake pump instead */
  for (;;) {
    if (s->fd < 0 || s->user_paused) return;
    bool flowing = s->data_ls.n > 0 || s->pipe_dst || s->native_data || s->flowing;
    /* buffered (peeked/unshifted) bytes first — they precede the
     * kernel's in the stream; a TLS engine drains them through its bio */
    if (!s->tops && flowing && s->rlen > s->rhead) {
      char buf[65536];
      size_t take = scr_net_sock_take_buffered(s, buf, sizeof buf);
      if (!scr_net_sock_deliver(s, buf, take)) return;
      scr_net_sock_update_read(s);
      continue;
    }
    if (s->rd_eof) return;
    if (!flowing && s->readable_ls.n == 0 && !s->wr_done &&
        !(s->tops != NULL && s->t_est)) {
      /* No consumer — but not "stay paused" either. Node's afterConnect
       * and its accepted-socket constructor both call read(0), so a
       * socket with no 'data' listener still notices its peer's FIN and
       * still closes; without that it never leaves the registry,
       * scr_net_pending never goes false, and THE LOOP NEVER DRAINS.
       *
       * The answer is a PEEK, not a read. Node buffers what it takes only
       * up to the high-water mark and then stops; taking bytes here would
       * change back-pressure and hand a listener added later a different
       * byte count, so one byte of MSG_PEEK separates the only two cases
       * that matter and consumes neither:
       *
       *   0  the peer's FIN with nothing in front of it — Node ends the
       *      readable side here (its buffer is empty), so 'end'/'close'
       *      fire and the loop drains.
       *   >0 bytes nobody asked for. Node stops reading at its mark and
       *      does NOT see the FIN behind them: 1000 unread bytes leave
       *      readableEnded false and no 'close' ever fires (measured).
       *      So stop watching until a consumer appears; the bytes stay
       *      in the kernel exactly where they were.
       *
       * An ESTABLISHED transport is excluded above — it must keep
       * processing protocol frames (close alerts, 1.3 tickets) so a
       * peer's close reaches the teardown (the handler-less TLS server
       * whose client hangs up), and it reads them for real. */
      ssize_t p = scr_net_peek1(s->fd);
      if (p > 0) {
        s->rd_probe_off = true;
        scr_net_sock_update_read(s);
        return;
      }
      if (p < 0) {
        if (errno == EINTR) continue;
        if (errno == EAGAIN || errno == EWOULDBLOCK) return;
        char msg[96];
        snprintf(msg, sizeof msg, "read %s", scr_net_errname(errno));
        if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
        s->had_error = true;
        scr_net_sock_close_fd(s);
        return;
      }
      scr_net_sock_eof(s); /* p == 0: FIN, nothing in front of it */
      return;
    }
    char buf[65536];
    ssize_t n = s->tops ? s->tops->xread(s->tctx, buf, sizeof buf) : read(s->fd, buf, sizeof buf);
    if (n < 0) {
      if (errno == EINTR) continue;
      if (errno == EAGAIN || errno == EWOULDBLOCK) return;
      char msg[96];
      snprintf(msg, sizeof msg, "read %s", scr_net_errname(errno));
      if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
      s->had_error = true;
      scr_net_sock_close_fd(s);
      return;
    }
    if (n == 0) {
      /* EOF announces 'readable' first (Node: a read() there answers
       * null — the demux's dead-peer arm), then 'end' and the teardown */
      scr_net_fire0_this(&s->readable_ls, s, SCR_DYNH_NET_SOCKET);
      if (scr_exc_pending()) return;
      scr_net_sock_eof(s);
      return;
    }
    scr_net_sock_touch(s);
    if (flowing) {
      if (!scr_net_sock_deliver(s, buf, (size_t)n)) return;
    } else if (s->readable_ls.n == 0) {
      /* the drain-to-EOF modes (wr_done, or an established transport
       * with no consumer): bytes arriving with nobody listening drop —
       * Node's resumed-but-unconsumed stream for the FIN-sent arm; for
       * the transport arm the peer would have to send app data at a
       * handler-less server for the difference to observe */
    } else {
      /* paused mode ('readable' consumers only): buffer and announce —
       * the listener consumes via read()/unshift */
      scr_net_sock_append_rbuf(s, buf, (size_t)n);
      scr_net_fire0_this(&s->readable_ls, s, SCR_DYNH_NET_SOCKET);
      if (scr_exc_pending()) return;
      if (s->tops && !s->t_est) {
        /* the listener routed this socket into a TLS server: the peeked
         * bytes now belong to the engine, and the poller may never signal
         * again if the whole flight is already buffered — pump NOW */
        scr_net_sock_transport_pump(s);
        return;
      }
    }
    scr_net_sock_update_read(s); /* a once-listener may have been the last consumer */
  }
}

static void scr_net_sock_transport_pump(ScrNetSocket *s);

static void scr_net_sock_dial_next(ScrNetSocket *s);

/* Connect completion (write-readiness while connecting). */
static void scr_net_sock_connect_done(ScrNetSocket *s) {
  int err = 0;
  socklen_t len = sizeof err;
  if (getsockopt(s->fd, SOL_SOCKET, SO_ERROR, &err, &len) != 0) err = errno;
  s->connecting = false;
  /* this attempt has ANSWERED (either way): its budget is spent, and a
   * stale timer must not fire into the next attempt's fd */
  scr_net_sock_attempt_cancel(s);
  if (err != 0 && s->dial_i < s->dial_n) {
    /* a caller-lookup dial with addresses left: record the failure
     * (last-wins, surfaced only on exhaustion) and retry QUIETLY — no
     * 'error'/'close' until the list runs out */
    char msg[128];
    snprintf(msg, sizeof msg, "connect %s %s:%d", scr_net_errname(err), s->peer_ip,
             s->peer_port);
    scr_str_release(s->dial_err);
    s->dial_err = scr_str_new(msg, strlen(msg));
    scr_net_close_fd_raw(s->fd); /* registrations dropped, then the fd */
    s->fd = -1;
    s->read_armed = s->write_armed = false;
    scr_net_sock_dial_next(s);
    return;
  }
  if (err != 0) {
    char msg[128];
    snprintf(msg, sizeof msg, "connect %s %s:%d", scr_net_errname(err), s->peer_ip,
             s->peer_port);
    if (s->dial_n > 0) {
      /* the dial chain's LAST address failed asynchronously */
      scr_str_release(s->dial_err);
      s->dial_err = NULL;
      if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
    } else if (!s->pending_err) {
      s->pending_err = scr_str_new(msg, strlen(msg));
    }
    s->had_error = true;
    scr_net_sock_close_fd(s);
    return;
  }
  if (s->dial_err) {
    /* an earlier address failed but THIS one connected: the recorded
     * failure never surfaces */
    scr_str_release(s->dial_err);
    s->dial_err = NULL;
  }
  scr_net_sock_update_write(s); /* keeps the filter iff bytes are buffered */
  scr_net_sock_update_read(s);
  scr_net_sock_touch(s);
  if (s->tops && !s->t_est) {
    /* TCP is up; the TLS handshake starts now. 'connect' listeners wait
     * for establishment (they registered as secureConnect) and buffered
     * bytes flush there too. */
    scr_net_sock_transport_pump(s);
    return;
  }
  if (s->native_established) {
    s->native_established(s->native_ctx);
    if (scr_exc_pending()) return;
  }
  scr_net_fire0_this(&s->conn_ls, s, SCR_DYNH_NET_SOCKET);
  if (scr_exc_pending()) return;
  scr_net_sock_flush(s);
}

/* Drive the transport handshake off readiness until it settles. On
 * establishment: the protocol layer attaches (https' parser), a
 * deferred server 'connection' fires ('secureConnection' timing), the
 * socket's own 'connect' listeners fire (the client's secureConnect),
 * buffered writes flush, and any plaintext that rode in with the final
 * handshake flight delivers. Failure already tore the socket down via
 * scr_net_sock_transport_error. */
static void scr_net_sock_transport_pump(ScrNetSocket *s) {
  if (!s->tops || s->t_est || s->fd < 0 || s->connecting) return;
  int r = s->tops->handshake(s->tctx);
  if (r == 0) {
    scr_net_sock_update_read(s);
    scr_net_sock_update_write(s);
    return;
  }
  if (r < 0) return; /* the transport reported the failure */
  s->t_est = true;
  scr_net_sock_touch(s);
  if (s->tops->on_established) {
    s->tops->on_established(s->tctx);
    if (scr_exc_pending()) return;
  }
  if (s->conn_pending) {
    /* the deferred 'connection' ('secureConnection' timing): the target
     * is the server this socket was routed INTO — the accepting server
     * for a plain TLS accept, the emit('connection') target after a
     * demux */
    ScrNetServer *target = s->conn_pending;
    s->conn_pending = NULL;
    if (!target->close_emitted) {
      ScrNetL *snap;
      size_t n = scr_net_ls_snapshot(&target->conn_ls, &snap);
      scr_dyn_this_push(target, SCR_DYNH_NET_SERVER);
      for (size_t i = 0; i < n; i++) {
        if (!scr_exc_pending()) ((ScrNetConnFn)snap[i].fn)(snap[i].cb, scr_net_sock_retain(s));
        scr_closure_release(snap[i].cb);
      }
      scr_dyn_this_pop();
      free(snap);
    }
    scr_net_server_release(target);
    if (scr_exc_pending()) return;
  }
  if (s->native_established) {
    s->native_established(s->native_ctx);
    if (scr_exc_pending()) return;
  }
  scr_net_fire0_this(&s->conn_ls, s, SCR_DYNH_NET_SOCKET);
  if (scr_exc_pending()) return;
  scr_net_sock_flush(s);
  scr_net_sock_update_read(s);
  scr_net_sock_update_write(s);
  scr_net_sock_read(s); /* plaintext buffered inside the engine, if any */
}

/* ── the server ──────────────────────────────────────────────────────── */

static ScrNetServer *scr_net_server_new(void) {
  ScrNetServer *s = calloc(1, sizeof *s);
  if (!s) scr_net_oom();
  s->kind = SCR_NET_K_SERVER;
  s->rc = 1;
  s->fd = -1;
#ifdef SCR_RC_AUDIT
  scr_net_live++;
#endif
  return s;
}

ScrNetServer *scr_net_create_server(ScrClosure *handler /*moves, nullable*/, ScrNetConnFn fn) {
  ScrNetServer *s = scr_net_server_new();
  if (handler) scr_net_ls_add(&s->conn_ls, handler, (void *)fn, false);
  return s;
}

/* listen(port): bind + listen NOW (Node fails synchronously into an async
 * 'error'); success defers the listen callback ('listening') to the next
 * dispatch pass, Node's next-tick emit. Binds like Node's host-less
 * listen: IPv6 any with dual-stack when the kernel allows, IPv4 fallback. */
void scr_net_listen(ScrNetServer *s, double port, ScrClosure *cb /*moves, nullable*/) {
  if (cb) scr_net_ls_add(&s->listening_cbs, cb, NULL, true);
  if (s->listening || s->close_emitted) return;
  if (!scr_net_poller_init()) {
    fputs("scriptc: event poller init failed\n", stderr);
    abort();
  }
  int p = (int)port;
  int fd = socket(AF_INET6, SOCK_STREAM, 0);
  bool v6 = fd >= 0;
  if (v6) {
    int off = 0;
    setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof off);
  } else {
    fd = socket(AF_INET, SOCK_STREAM, 0);
  }
  if (fd < 0) {
    fputs("scriptc: socket() failed\n", stderr);
    abort();
  }
  scr_net_listen_reuseaddr(fd);
  scr_net_nonblock(fd);
  int rc;
  if (v6) {
    struct sockaddr_in6 addr;
    memset(&addr, 0, sizeof addr);
    addr.sin6_family = AF_INET6;
    addr.sin6_addr = in6addr_any;
    addr.sin6_port = htons((uint16_t)p);
    rc = bind(fd, (struct sockaddr *)&addr, sizeof addr);
  } else {
    struct sockaddr_in addr;
    memset(&addr, 0, sizeof addr);
    addr.sin_family = AF_INET;
    addr.sin_addr.s_addr = INADDR_ANY;
    addr.sin_port = htons((uint16_t)p);
    rc = bind(fd, (struct sockaddr *)&addr, sizeof addr);
  }
  if (rc == 0) rc = listen(fd, 511); /* Node's default backlog */
  if (rc != 0) {
    int err = errno;
    close(fd);
    char msg[128];
    /* Node: "listen EADDRINUSE: address already in use :::4000" */
    snprintf(msg, sizeof msg, "listen %s: %s %s:%d", scr_net_errname(err),
             err == EADDRINUSE ? "address already in use" : "permission denied",
             v6 ? "::" : "0.0.0.0", p);
    if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
    scr_net_server_register(s); /* the sweep delivers the failure */
    return;
  }
  /* the real port (ephemeral listen(0) discovers it here) */
  struct sockaddr_storage bound;
  socklen_t blen = sizeof bound;
  if (getsockname(fd, (struct sockaddr *)&bound, &blen) == 0) {
    s->port = bound.ss_family == AF_INET6
                  ? ntohs(((struct sockaddr_in6 *)&bound)->sin6_port)
                  : ntohs(((struct sockaddr_in *)&bound)->sin_port);
  }
  s->fd = fd;
  s->listening = true;
  s->emit_listening = true;
  s->bound_v6 = v6;
  scr_net_watch_read(fd, s, true);
  scr_net_server_register(s);
}

/* listen({ port, host, ipv6Only }) — the explicit-interface bind
 * (portless's listenOnProxyInterface): host is an IP literal ("" = the
 * host-less dual-stack default above; "localhost" pins to 127.0.0.1, the
 * connect-side divergence); ipv6Only sets IPV6_V6ONLY before the bind
 * (meaningful on v6 addresses — "::" with ipv6Only leaves v4 to its own
 * listener, exactly the portless pair). Failures are the async 'error'
 * with Node's listen message naming the requested host; a non-IP host is
 * the async getaddrinfo ENOTFOUND (no resolver in this slice). */
void scr_net_listen_opts(ScrNetServer *s, double port, ScrStr *host /*borrowed*/,
                          bool ipv6_only, ScrClosure *cb /*moves, nullable*/) {
  if (host == NULL || host->len == 0) {
    scr_net_listen(s, port, cb);
    return;
  }
  if (cb) scr_net_ls_add(&s->listening_cbs, cb, NULL, true);
  if (s->listening || s->close_emitted) return;
  if (!scr_net_poller_init()) {
    fputs("scriptc: event poller init failed\n", stderr);
    abort();
  }
  int p = (int)port;
  char h[64];
  snprintf(h, sizeof h, "%.*s", (int)(host->len < 63 ? host->len : 63), host->data);
  if (strcmp(h, "localhost") == 0) snprintf(h, sizeof h, "127.0.0.1");
  struct sockaddr_in a4;
  struct sockaddr_in6 a6;
  struct sockaddr *sa = NULL;
  socklen_t salen = 0;
  bool v6 = false;
  memset(&a4, 0, sizeof a4);
  memset(&a6, 0, sizeof a6);
  if (inet_pton(AF_INET, h, &a4.sin_addr) == 1) {
    a4.sin_family = AF_INET;
    a4.sin_port = htons((uint16_t)p);
    sa = (struct sockaddr *)&a4;
    salen = sizeof a4;
  } else if (inet_pton(AF_INET6, h, &a6.sin6_addr) == 1) {
    a6.sin6_family = AF_INET6;
    a6.sin6_port = htons((uint16_t)p);
    sa = (struct sockaddr *)&a6;
    salen = sizeof a6;
    v6 = true;
  }
  if (!sa) {
    char msg[160];
    snprintf(msg, sizeof msg, "getaddrinfo ENOTFOUND %s", h);
    if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
    scr_net_server_register(s);
    return;
  }
  int fd = socket(sa->sa_family, SOCK_STREAM, 0);
  if (fd < 0) {
    fputs("scriptc: socket() failed\n", stderr);
    abort();
  }
  if (v6) {
    int only = ipv6_only ? 1 : 0;
    setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &only, sizeof only);
  }
  scr_net_listen_reuseaddr(fd);
  scr_net_nonblock(fd);
  int rc = bind(fd, sa, salen);
  if (rc == 0) rc = listen(fd, 511); /* Node's default backlog */
  if (rc != 0) {
    int err = errno;
    close(fd);
    char msg[160];
    snprintf(msg, sizeof msg, "listen %s: %s %s:%d", scr_net_errname(err),
             err == EADDRINUSE      ? "address already in use"
             : err == EADDRNOTAVAIL ? "address not available"
                                    : "permission denied",
             h, p);
    if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
    scr_net_server_register(s);
    return;
  }
  struct sockaddr_storage bound;
  socklen_t blen = sizeof bound;
  if (getsockname(fd, (struct sockaddr *)&bound, &blen) == 0) {
    s->port = bound.ss_family == AF_INET6
                  ? ntohs(((struct sockaddr_in6 *)&bound)->sin6_port)
                  : ntohs(((struct sockaddr_in *)&bound)->sin_port);
  }
  s->fd = fd;
  s->listening = true;
  s->emit_listening = true;
  s->bound_v6 = v6;
  scr_str_release(s->bound_host);
  s->bound_host = scr_str_new(h, strlen(h));
  scr_net_watch_read(fd, s, true);
  scr_net_server_register(s);
}

double scr_net_server_port(ScrNetServer *s) { return (double)s->port; }

/* address()'s null discriminator. Node's server.address() reads the bound
 * handle: null before it exists and after close(), the record while it
 * does. `listening` tracks exactly that handle here, so the two agree in
 * every state EXCEPT one: Node defers the bind to a later tick when
 * listen() is given a host string to resolve, and answers null in the
 * window before it; this listen binds synchronously and answers the
 * record there. Measured, and recorded beside the fixture. */
bool scr_net_server_listening(ScrNetServer *s) { return s->listening; }

/* address()'s other two fields — the bound host ('::'/'0.0.0.0' for the
 * host-less any, the normalized explicit host otherwise) and the family
 * string. Answer the any-form defaults before listen (Node answers null
 * there — the serverPort stance, port 0). */
ScrStr *scr_net_server_addr_ip(ScrNetServer *s) {
  if (s->bound_host) return scr_str_retain(s->bound_host);
  return s->bound_v6 ? scr_str_new("::", 2) : scr_str_new("0.0.0.0", 7);
}

ScrStr *scr_net_server_addr_family(ScrNetServer *s) {
  return s->bound_v6 ? scr_str_new("IPv6", 4) : scr_str_new("IPv4", 4);
}

/* Stamps the server's place in the settle queue the first time its
 * 'close' becomes due (closing, drained, not yet emitted). Once stamped it
 * never re-stamps, so a second close() cannot move a server ahead of one
 * that came due before it. */
static size_t scr_net_due_seq = 0;

static void scr_net_server_mark_due(ScrNetServer *s) {
  if (s->due_seq == 0 && !s->close_emitted) {
    s->due_seq = ++scr_net_due_seq;
    s->due_epoch = scr_net_epoch;
  }
}

/* The REAL close — what the bound `origClose` value reaches (never
 * consults the override, so the portless proxy-through idiom cannot
 * recurse). */
void scr_net_server_close_direct(ScrNetServer *s, ScrClosure *cb /*moves, nullable*/) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  if (cb) scr_net_ls_add(&s->close_ls, cb, NULL, true);
  if (s->listening) {
    scr_net_close_fd_raw(s->fd); /* stops accepting NOW (registrations dropped first) */
    s->fd = -1;
    s->listening = false;
  }
  /* A close BEFORE the deferred 'listening' delivered cancels it — Node's
   * emitListeningNT checks the handle close() nulled, so the listen
   * callback never runs (test-net-listen-close-server's mustNotCall). */
  if (s->emit_listening) {
    s->emit_listening = false;
    scr_net_ls_drop(&s->listening_cbs);
  }
  s->closing = true; /* the sweep fires 'close' once nconns drains */
  /* Already drained: this is Node's _emitCloseIfDrained scheduling the
   * tick, so the due stamp is taken HERE and not when the sweep gets
   * round to noticing. */
  if (s->nconns == 0) scr_net_server_mark_due(s);
}

void scr_net_server_close(ScrNetServer *s, ScrClosure *cb /*moves, nullable*/) {
  if (s->close_override != NULL && !s->close_emitted) {
    /* The override runs INSTEAD of the close; a close callback still
     * fires when the override's origClose completes the close — Node's
     * behavior with the callback passed through. */
    if (cb) scr_net_ls_add(&s->close_ls, cb, NULL, true);
    ScrClosure *ov = scr_closure_retain(s->close_override);
    ((void (*)(ScrClosure *))ov->fn)(ov);
    scr_closure_release(ov);
    return;
  }
  scr_net_server_close_direct(s, cb);
}

/* wrapper.close = fn: the override MOVES in (a compiler-emitted zero-arg
 * wrapper — see the struct comment); reassignment releases the old one,
 * matching JS's last-write-wins. */
void scr_net_server_set_close_override(ScrNetServer *s, ScrClosure *ov /*moves*/) {
  scr_closure_release(s->close_override);
  s->close_override = ov;
}

void scr_net_server_on_error(ScrNetServer *s, ScrClosure *cb /*moves*/, ScrChildErrFn fn,
                              bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->err_ls, cb, (void *)fn, once);
}

void scr_net_server_on_close(ScrNetServer *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->close_ls, cb, NULL, once);
}

/* server.on('listening', cb): joins the deferred 'listening' list the
 * listen(port, cb) callback rides (the sweep fires it once after a
 * successful bind — Node's next-tick emit). A registration AFTER the
 * emit sits inert forever, exactly Node's once-per-listen event; a
 * settled (closed) server releases the closure unregistered. */
void scr_net_server_on_listening(ScrNetServer *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->listening_cbs, cb, NULL, once);
}

/* 'secureConnection': a TLS server's 'connection' list already fires at
 * handshake completion (defer_conn) — Node's secureConnection timing; on
 * a plain server the event never fires in Node, so the registration is
 * released unread. */
void scr_net_server_on_secure_connection(ScrNetServer *s, ScrClosure *cb /*moves*/,
                                          ScrNetConnFn fn, bool once) {
  if (!s->defer_conn) {
    scr_closure_release(cb);
    return;
  }
  scr_net_server_on_connection(s, cb, fn, once);
}

void scr_net_server_on_connection(ScrNetServer *s, ScrClosure *cb /*moves*/, ScrNetConnFn fn,
                                   bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->conn_ls, cb, (void *)fn, once);
}

/* Accept until EAGAIN; each connection fires the 'connection' listeners
 * directly (the accepted socket passes +1 per listener via the adapter). */
static void scr_net_server_accept(ScrNetServer *srv) {
  for (;;) {
    if (!srv->listening || srv->fd < 0) return;
    int fd = accept(srv->fd, NULL, NULL);
    if (fd < 0) {
      if (errno == EINTR) continue;
      return; /* EAGAIN or a transient failure: the next wake retries */
    }
    scr_net_nonblock(fd);
    int one = 1;
    setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
    ScrNetSocket *sock = scr_net_sock_new();
    sock->fd = fd;
    sock->server = scr_net_server_retain(srv);
    srv->nconns++;
    sock->conn_counted = true;
    scr_net_sock_register(sock);
    if (srv->native_conn) {
      /* the protocol layer (scr_http.c / scr_tls.c) claims the connection */
      srv->native_conn(srv->native_ctx, sock);
      if (scr_exc_pending()) return;
    }
    if (srv->defer_conn) {
      /* 'connection' waits for the handshake (secureConnection timing) */
      sock->conn_pending = scr_net_server_retain(srv);
    }
    if (!srv->defer_conn) {
      ScrNetL *snap;
      size_t n = scr_net_ls_snapshot(&srv->conn_ls, &snap);
      scr_dyn_this_push(srv, SCR_DYNH_NET_SERVER);
      for (size_t i = 0; i < n; i++) {
        if (!scr_exc_pending()) ((ScrNetConnFn)snap[i].fn)(snap[i].cb, scr_net_sock_retain(sock));
        scr_closure_release(snap[i].cb);
      }
      scr_dyn_this_pop();
      free(snap);
    }
    /* Node's accepted-socket constructor ends with this.read(0) unless
     * pauseOnConnect: an accepted socket is watched from the moment the
     * 'connection' listeners have had their say, whether or not any of
     * them asked for data. Without this call a handler-less connection is
     * never watched at all, so the peer's FIN is never seen, the socket
     * never leaves the registry, and the loop never drains. The watch is
     * a peek while there is no consumer (see scr_net_sock_update_read). */
    scr_net_sock_update_read(sock);
    scr_net_sock_release(sock); /* registry + server-count refs remain */
    if (scr_exc_pending()) return;
  }
}

/* ── the client ──────────────────────────────────────────────────────── */

/* connect(port, host): numeric IPv4/IPv6 hosts and "localhost" (pinned to
 * 127.0.0.1 — the documented divergence from Node's family autoselect).
 * The connect callback registers as once('connect'). Never throws: every
 * failure is the async 'error' event, like Node. */
/* Blocking hostname resolution for the CLIENT bridges — the dns.lookup
 * precedent (scr_dgram.c): getaddrinfo runs AT CALL TIME. The dial keeps
 * the WHOLE answer (scr_net_lookup_candidates below); a caller that only
 * wants one address still gets the first, through
 * scr_net_blocking_lookup. node:net's own connect surface stays
 * resolver-less on purpose (Node's async lookup semantics are not this). */
/* getaddrinfo's WHOLE answer for `host`, in Node's autoSelectFamily
 * order. Read off net.js (lookupAndConnectMultiple) and then MEASURED on
 * v25.9.0 with a synthetic lookup: the answers split into two family
 * groups, group 0 being the family of the FIRST answer; each group
 * dedupes by address text; the chain is then the two groups
 * INTERLEAVED — g0[0], g1[0], g0[1], g1[1], … — so a preference for a
 * family that cannot egress still costs only one attempt budget.
 *
 * Answers 0 for the cases scr_net_blocking_lookup always passed through
 * unchanged: "localhost", an IP literal, and a resolution failure (whose
 * dial must keep delivering Node's deferred "getaddrinfo ENOTFOUND
 * host"). *out is malloc'd with +1 on every entry; the caller owns both. */
static size_t scr_net_lookup_candidates(ScrStr *host /*borrowed*/, ScrStr ***out) {
  *out = NULL;
  if (host == NULL || host->len == 0) return 0;
  if (host->len == 9 && memcmp(host->data, "localhost", 9) == 0) return 0;
  struct in_addr a4;
  struct in6_addr a6;
  if (inet_pton(AF_INET, host->data, &a4) == 1 || inet_pton(AF_INET6, host->data, &a6) == 1) {
    return 0;
  }
  if (!scr_net_poller_init()) return 0; /* WSAStartup on win32 */
  struct addrinfo hints;
  memset(&hints, 0, sizeof hints);
  hints.ai_socktype = SOCK_STREAM;
  struct addrinfo *res = NULL;
  if (getaddrinfo(host->data, NULL, &hints, &res) != 0 || res == NULL) {
    if (res) freeaddrinfo(res);
    return 0;
  }
  ScrStr *g[2][SCR_NET_HE_MAX];
  size_t gn[2] = {0, 0};
  int lead = 0; /* the first answer's ai_family; 0 = none seen yet */
  for (struct addrinfo *ai = res; ai != NULL; ai = ai->ai_next) {
    char ip[INET6_ADDRSTRLEN] = "";
    const char *o = NULL;
    if (ai->ai_family == AF_INET) {
      o = inet_ntop(AF_INET, &((struct sockaddr_in *)ai->ai_addr)->sin_addr, ip, sizeof ip);
    } else if (ai->ai_family == AF_INET6) {
      o = inet_ntop(AF_INET6, &((struct sockaddr_in6 *)ai->ai_addr)->sin6_addr, ip, sizeof ip);
    }
    if (o == NULL) continue; /* neither family, or unprintable: not a candidate */
    if (lead == 0) lead = ai->ai_family;
    size_t d = ai->ai_family == lead ? 0 : 1;
    if (gn[d] >= SCR_NET_HE_MAX) continue;
    size_t iplen = strlen(ip);
    bool dup = false;
    for (size_t i = 0; i < gn[d]; i++) {
      if (g[d][i]->len == iplen && memcmp(g[d][i]->data, ip, iplen) == 0) {
        dup = true;
        break;
      }
    }
    if (dup) continue; /* Node keeps each address once, within its group */
    g[d][gn[d]++] = scr_str_new(ip, iplen);
  }
  freeaddrinfo(res);
  size_t n = gn[0] + gn[1];
  if (n == 0) return 0;
  ScrStr **list = malloc(n * sizeof *list);
  if (!list) scr_net_oom();
  size_t k = 0;
  size_t m = gn[0] > gn[1] ? gn[0] : gn[1];
  for (size_t i = 0; i < m; i++) {
    if (i < gn[0]) list[k++] = g[0][i];
    if (i < gn[1]) list[k++] = g[1][i];
  }
  *out = list;
  return n;
}

ScrStr *scr_net_blocking_lookup(ScrStr *host /*borrowed*/) {
  ScrStr **ips = NULL;
  size_t n = scr_net_lookup_candidates(host, &ips);
  if (n == 0) return scr_str_retain(host);
  ScrStr *first = ips[0];
  for (size_t i = 1; i < n; i++) scr_str_release(ips[i]);
  free(ips);
  return first; /* the preferred family's first address: the old answer */
}

/* The dial itself (peer_ip/peer_port already set): the sockaddr arms,
 * socket(), and the nonblocking connect(). Shared by the immediate dial
 * (scr_net_connect) and the DEFERRED one (the http agent's maxSockets
 * queue — the socket exists, buffers writes, and dials when a slot
 * frees). */
static void scr_net_sock_dial_peer(ScrNetSocket *s) {
  const char *h = s->peer_ip;
  struct sockaddr_in a4;
  struct sockaddr_in6 a6;
  struct sockaddr *sa = NULL;
  socklen_t salen = 0;
  memset(&a4, 0, sizeof a4);
  memset(&a6, 0, sizeof a6);
  if (inet_pton(AF_INET, h, &a4.sin_addr) == 1) {
    a4.sin_family = AF_INET;
    a4.sin_port = htons((uint16_t)s->peer_port);
    sa = (struct sockaddr *)&a4;
    salen = sizeof a4;
  } else if (inet_pton(AF_INET6, h, &a6.sin6_addr) == 1) {
    a6.sin6_family = AF_INET6;
    a6.sin6_port = htons((uint16_t)s->peer_port);
    sa = (struct sockaddr *)&a6;
    salen = sizeof a6;
  }
  if (!sa) {
    /* Non-numeric host: no resolver in this slice. Node's shape for a
     * failed lookup is ENOTFOUND; deliver it deferred. */
    char msg[160];
    snprintf(msg, sizeof msg, "getaddrinfo ENOTFOUND %s", h);
    s->pending_err = scr_str_new(msg, strlen(msg));
    s->had_error = true;
    s->emit_close = true;
    scr_net_sock_mark_closing(s);
    s->connecting = false;
    return;
  }
  int fd = socket(sa->sa_family, SOCK_STREAM, 0);
  if (fd < 0) {
    fputs("scriptc: socket() failed\n", stderr);
    abort();
  }
  scr_net_nonblock(fd);
  int one = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
  s->fd = fd;
  int rc = connect(fd, sa, salen);
  if (rc == 0) {
    /* Immediate success (loopback can): still async — the write filter
     * fires at once and connect_done delivers 'connect' from dispatch. */
    s->connecting = true;
    scr_net_sock_update_write(s);
  } else if (errno == EINPROGRESS) {
    s->connecting = true;
    scr_net_sock_update_write(s);
  } else {
    char msg[128];
    snprintf(msg, sizeof msg, "connect %s %s:%d", scr_net_errname(errno), s->peer_ip,
             s->peer_port);
    s->pending_err = scr_str_new(msg, strlen(msg));
    s->had_error = true;
    s->connecting = false;
    scr_net_sock_close_fd(s);
  }
}

ScrNetSocket *scr_net_connect(double port, ScrStr *host /*borrowed, nullable*/,
                               ScrClosure *cb /*moves, nullable*/) {
  ScrNetSocket *s = scr_net_sock_new();
  if (cb) scr_net_ls_add(&s->conn_ls, cb, NULL, true);
  s->peer_port = (int)port;
  const char *h = host && host->len > 0 ? host->data : "localhost";
  if (strcmp(h, "localhost") == 0) h = "127.0.0.1";
  snprintf(s->peer_ip, sizeof s->peer_ip, "%s", h);
  if (!scr_net_poller_init()) {
    fputs("scriptc: event poller init failed\n", stderr);
    abort();
  }
  scr_net_sock_dial_peer(s);
  scr_net_sock_register(s);
  return s;
}

/* connect(port, HOSTNAME) with Node's autoSelectFamily — the entry every
 * protocol client that dials by name uses (the ws client, the http and
 * http2 clients, tls.connect). It resolves ONCE here, keeps the whole
 * answer, and dials it on the staggered schedule; a single candidate (or
 * a literal, or localhost, or a name that will not resolve) collapses to
 * scr_net_connect and is byte-for-byte the previous behaviour, including
 * Node's rule that a lone address gets no attempt budget.
 *
 * Only the DIAL takes the address: the caller keeps the name for the
 * Host header, SNI, and certificate verification, exactly as it did when
 * it called scr_net_blocking_lookup itself. */
ScrNetSocket *scr_net_connect_host(double port, ScrStr *host /*borrowed, nullable*/,
                                    ScrClosure *cb /*moves, nullable*/) {
  ScrStr **ips = NULL;
  size_t n = host != NULL ? scr_net_lookup_candidates(host, &ips) : 0;
  if (n <= 1) {
    ScrStr *one = n == 1 ? ips[0] : NULL;
    free(ips);
    ScrNetSocket *s = scr_net_connect(port, one != NULL ? one : host, cb);
    if (one != NULL) scr_str_release(one);
    return s;
  }
  ScrNetSocket *s = scr_net_sock_new();
  if (cb) scr_net_ls_add(&s->conn_ls, cb, NULL, true);
  s->peer_port = (int)port;
  if (!scr_net_poller_init()) {
    fputs("scriptc: event poller init failed\n", stderr);
    abort();
  }
  s->dial_ips = ips; /* the +1s move onto the socket */
  s->dial_n = n;
  s->dial_i = 0;
  s->connecting = true;
  scr_net_sock_dial_next(s); /* sets peer_ip; exhaustion defers the error */
  scr_net_sock_register(s);
  return s;
}

/* ── the connect option-bag validation ladders (checked-dynamic lane) ──
 * Node-order validation over dyn option values with Node's exact typed
 * errors; the honest tail (connect for the validated forms, the
 * compiler-rendered fence for bags with unmodeled keys) runs only after
 * every validation passes. */

static bool scr_net_attempt_timeout_chk(const ScrDyn *t, const char *name) {
  if (t->kind != SCR_DYN_NUM) {
    scr_dyn_prop_type_fail(name, "of type number", t);
    return false;
  }
  char recv[48], msg[192];
  if (!(isfinite(t->v.num) && trunc(t->v.num) == t->v.num)) {
    scr_num_received(t->v.num, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be an integer. Received %s",
                       name, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  if (t->v.num < 1 || t->v.num > 2147483647.0) {
    scr_num_received(t->v.num, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be >= 1 && <= 2147483647. Received %s",
                       name, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  return true;
}

/* connect({ ..., autoSelectFamilyAttemptTimeout }): the budget validates
 * (validateInt32 from 1, Node's exact texts) and is then inert — this
 * slice's single dial has nothing to time, the same simplification the
 * autoSelectFamily flag already takes. NULL with the throw pending. */
ScrNetSocket *scr_net_connect_attempt(double port, ScrStr *host, const ScrDyn *t) {
  if (!scr_net_attempt_timeout_chk(t, "options.autoSelectFamilyAttemptTimeout")) return NULL;
  return scr_net_connect(port, host, NULL);
}

static bool scr_net_dyn_truthy(const ScrDyn *v) {
  switch (v->kind) {
  case SCR_DYN_UNDEF:
  case SCR_DYN_NULL: return false;
  case SCR_DYN_BOOL: return v->v.b;
  case SCR_DYN_NUM: return v->v.num == v->v.num && v->v.num != 0;
  case SCR_DYN_STR: return v->v.str->len > 0;
  default: return true;
  }
}

/* net.connect/createConnection over a RUNTIME option bag (computed keys
 * — the invalid-input probes): Node's Socket-constructor order — the
 * objectMode trio throws ERR_INVALID_ARG_VALUE first, then the port
 * (validatePort), the host's string contract, autoSelectFamily's boolean
 * contract, and the attempt budget. A bag that survives everything meets
 * the compiler-rendered fence: an unmodeled key must refuse loudly, never
 * silently drop. Always leaves an exception pending. */
void scr_net_connect_opts_chk(const ScrDyn *opts, const ScrStr *fence) {
  if (opts == NULL || opts->kind != SCR_DYN_OBJ) {
    scr_dyn_arg_type_fail("options", "of type object",
                          opts ? opts : scr_dyn_undefined());
    return;
  }
  static const char *const om[] = { "objectMode", "readableObjectMode", "writableObjectMode" };
  for (size_t i = 0; i < 3; i++) {
    const ScrDyn *v = scr_dyn_obj_get(opts, om[i], strlen(om[i]));
    if (v != NULL && scr_net_dyn_truthy(v)) {
      char name[48];
      snprintf(name, sizeof name, "options.%s", om[i]);
      scr_dyn_arg_value_fail(name, "is not supported", v);
      return;
    }
  }
  const ScrDyn *port = scr_dyn_obj_get(opts, "port", 4);
  if (port != NULL && port->kind != SCR_DYN_UNDEF) {
    bool ok = port->kind == SCR_DYN_NUM && trunc(port->v.num) == port->v.num &&
              port->v.num >= 0 && port->v.num < 65536;
    if (!ok && port->kind == SCR_DYN_STR) {
      ScrStr *ps = scr_str_retain(port->v.str);
      double n = scr_string_to_number(ps);
      scr_str_release(ps);
      ok = n == n && trunc(n) == n && n >= 0 && n < 65536 && port->v.str->len > 0;
    }
    if (!ok) {
      char detail[64], msg[160];
      const char *d = scr_dyn_specific_type(port, detail, sizeof detail);
      int len = snprintf(msg, sizeof msg,
                         "options.port should be >= 0 and < 65536. Received %s", d);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_SOCKET_BAD_PORT");
      return;
    }
  }
  const ScrDyn *host = scr_dyn_obj_get(opts, "host", 4);
  if (host != NULL && host->kind != SCR_DYN_UNDEF && host->kind != SCR_DYN_STR) {
    scr_dyn_prop_type_fail("options.host", "of type string", host);
    return;
  }
  const ScrDyn *asf = scr_dyn_obj_get(opts, "autoSelectFamily", 16);
  if (asf != NULL && asf->kind != SCR_DYN_UNDEF && asf->kind != SCR_DYN_BOOL) {
    scr_dyn_prop_type_fail("options.autoSelectFamily", "of type boolean", asf);
    return;
  }
  const ScrDyn *att = scr_dyn_obj_get(opts, "autoSelectFamilyAttemptTimeout", 30);
  if (att != NULL && att->kind != SCR_DYN_UNDEF &&
      !scr_net_attempt_timeout_chk(att, "options.autoSelectFamilyAttemptTimeout")) {
    return;
  }
  scr_throw_lowering_fence(fence);
}

/* A dial the caller starts LATER (the http agent's maxSockets queue):
 * the socket exists, registers, and buffers writes as "connecting" —
 * scr_net_sock_dial_start runs the actual dial when a slot frees. */
ScrNetSocket *scr_net_connect_deferred(double port, ScrStr *host /*borrowed, nullable*/) {
  ScrNetSocket *s = scr_net_sock_new();
  s->peer_port = (int)port;
  const char *h = host && host->len > 0 ? host->data : "localhost";
  if (strcmp(h, "localhost") == 0) h = "127.0.0.1";
  snprintf(s->peer_ip, sizeof s->peer_ip, "%s", h);
  if (!scr_net_poller_init()) {
    fputs("scriptc: event poller init failed\n", stderr);
    abort();
  }
  s->connecting = true; /* logically connecting while the dial waits */
  s->dial_deferred = true;
  scr_net_sock_register(s);
  return s;
}

void scr_net_sock_dial_start(ScrNetSocket *s) {
  if (!s->dial_deferred || s->close_emitted || s->emit_close || s->fd >= 0) return;
  s->dial_deferred = false;
  /* peer_ip holds whatever the caller QUEUED, and the http agent queues
   * the request's host — which is a NAME. scr_net_sock_dial_peer only
   * knows literals, so a queued request to a hostname used to answer
   * "getaddrinfo ENOTFOUND <name>" while the very same request answered
   * 200 when a slot happened to be free. It resolves HERE, at the moment
   * the slot frees, which is where Node creates the socket and looks the
   * host up too, and it takes the same staggered chain as any other
   * dial-by-name. */
  ScrStr *queued = scr_str_new(s->peer_ip, strlen(s->peer_ip));
  ScrStr **ips = NULL;
  size_t n = scr_net_lookup_candidates(queued, &ips);
  scr_str_release(queued);
  if (n <= 1) {
    if (n == 1) {
      snprintf(s->peer_ip, sizeof s->peer_ip, "%.*s", (int)(ips[0]->len < 63 ? ips[0]->len : 63),
               ips[0]->data);
      scr_str_release(ips[0]);
    }
    free(ips);
    scr_net_sock_dial_peer(s);
    return;
  }
  s->dial_ips = ips; /* the +1s move onto the socket */
  s->dial_n = n;
  s->dial_i = 0;
  scr_net_sock_dial_next(s);
}

/* ── the caller-lookup dial (net.connect with a lookup option) ─────────
 *
 * portless's createLoopbackConnection: connect({ host, port,
 * autoSelectFamily: true, lookup }) — the runtime invokes the caller's
 * resolver exactly as Node does (lookup(hostname, options, callback))
 * and dials its answered addresses IN ORDER: each connect failure closes
 * the fd and tries the next; the last failure's message is the socket's
 * 'error' (Node's AggregateError under autoSelectFamily is a documented
 * divergence). The answer callback is a runtime-minted closure over the
 * boxed socket whose fn is an emitter-synthesized per-shape thunk (the
 * SNI-answer pattern); late, repeated, or dead-socket answers are
 * ignored. */

/* Dials one IP now. Success (established or in progress) answers true;
 * failure records the message (LAST-wins — the retry chain's contract),
 * closes any fd, and answers false without emitting. */
static bool scr_net_sock_dial_ip(ScrNetSocket *s, const ScrStr *ip) {
  char h[64];
  snprintf(h, sizeof h, "%.*s", (int)(ip->len < 63 ? ip->len : 63), ip->data);
  snprintf(s->peer_ip, sizeof s->peer_ip, "%s", h);
  struct sockaddr_in a4;
  struct sockaddr_in6 a6;
  struct sockaddr *sa = NULL;
  socklen_t salen = 0;
  memset(&a4, 0, sizeof a4);
  memset(&a6, 0, sizeof a6);
  if (inet_pton(AF_INET, h, &a4.sin_addr) == 1) {
    a4.sin_family = AF_INET;
    a4.sin_port = htons((uint16_t)s->peer_port);
    sa = (struct sockaddr *)&a4;
    salen = sizeof a4;
  } else if (inet_pton(AF_INET6, h, &a6.sin6_addr) == 1) {
    a6.sin6_family = AF_INET6;
    a6.sin6_port = htons((uint16_t)s->peer_port);
    sa = (struct sockaddr *)&a6;
    salen = sizeof a6;
  }
  char msg[160];
  if (!sa) {
    /* a non-IP answer: the lookup was supposed to resolve — Node's
     * lookup-failure shape */
    snprintf(msg, sizeof msg, "getaddrinfo ENOTFOUND %s", h);
    scr_str_release(s->dial_err);
    s->dial_err = scr_str_new(msg, strlen(msg));
    return false;
  }
  int fd = socket(sa->sa_family, SOCK_STREAM, 0);
  if (fd < 0) {
    fputs("scriptc: socket() failed\n", stderr);
    abort();
  }
  scr_net_nonblock(fd);
  int one = 1;
  setsockopt(fd, IPPROTO_TCP, TCP_NODELAY, &one, sizeof one);
  int rc = connect(fd, sa, salen);
  if (rc == 0 || errno == EINPROGRESS) {
    s->fd = fd;
    s->connecting = true;
    scr_net_sock_update_write(s);
    return true;
  }
  snprintf(msg, sizeof msg, "connect %s %s:%d", scr_net_errname(errno), s->peer_ip, s->peer_port);
  scr_str_release(s->dial_err);
  s->dial_err = scr_str_new(msg, strlen(msg));
  close(fd);
  return false;
}

/* Dials the next answered addresses until one starts; exhaustion flags
 * the deferred 'error' + 'close' (the last dial's message stands).
 *
 * A started attempt with a candidate STILL BEHIND it gets the attempt
 * budget (Node: `if (current < context.addresses.length - 1)`); the last
 * one does not, so a chain whose tail is black-holed ends at the OS's
 * connect timeout rather than early. dial_i has already advanced past
 * the address just dialled, so `dial_i < dial_n` IS "one behind it". */
static void scr_net_sock_dial_next(ScrNetSocket *s) {
  while (s->dial_i < s->dial_n) {
    const ScrStr *ip = s->dial_ips[s->dial_i++];
    if (scr_net_sock_dial_ip(s, ip)) {
      if (s->dial_i < s->dial_n) scr_net_sock_attempt_arm(s);
      return;
    }
  }
  /* exhausted: the last failure surfaces now */
  if (s->dial_err != NULL && s->pending_err == NULL) {
    s->pending_err = s->dial_err;
    s->dial_err = NULL;
  }
  s->connecting = false;
  s->had_error = true;
  s->emit_close = true;
  scr_net_sock_mark_closing(s);
}

/* The attempt budget elapsed with the connect still unanswered — the
 * black-holed family, which is the whole reason this exists: a refusal
 * comes back as an error in milliseconds and never reaches here.
 *
 * Node abandons the attempt: `req.oncomplete = undefined`, an ETIMEDOUT
 * pushed onto the error list, and `handle.close()`. We do the same three
 * things — the fd is CLOSED before the next family starts, so at no
 * moment are two of this socket's sockets in flight, and a completion
 * that lands on the abandoned fd cannot surface (it is gone from the
 * poller and the fd is closed). The recorded failure is last-wins like
 * every other link in the chain: it surfaces only if the chain
 * EXHAUSTS, so a family that fails while the other succeeds is silent. */
static void scr_net_sock_attempt_timeout(ScrNetSocket *s) {
  s->dial_timer_armed = false;
  if (!s->connecting || s->fd < 0 || s->dial_i >= s->dial_n) return;
  char msg[128];
  snprintf(msg, sizeof msg, "connect ETIMEDOUT %s:%d", s->peer_ip, s->peer_port);
  scr_str_release(s->dial_err);
  s->dial_err = scr_str_new(msg, strlen(msg));
  scr_net_close_fd_raw(s->fd); /* registrations dropped, then the fd */
  s->fd = -1;
  s->read_armed = s->write_armed = false;
  scr_net_sock_dial_next(s);
}

ScrNetSocket *scr_net_connect_lookup(double port, ScrStr *host /*borrowed*/,
                                      ScrClosure *lookup /*moves*/, void *answer_fn) {
  ScrNetSocket *s = scr_net_sock_new();
  s->peer_port = (int)port;
  snprintf(s->peer_ip, sizeof s->peer_ip, "%.*s",
           (int)(host->len < 63 ? host->len : 63), host->data);
  if (!scr_net_poller_init()) {
    fputs("scriptc: event poller init failed\n", stderr);
    abort();
  }
  s->connecting = true; /* logically connecting while the lookup decides */
  s->lookup_wait = true;
  scr_net_sock_register(s);
  ScrClosure *ans = scr_closure_new(answer_fn, 1);
  ScrBox *box = scr_box_new_obj(&scr_net_sock_retain_v, &scr_net_sock_release_v, NULL);
  scr_box_set_ref(box, scr_net_sock_retain(s));
  ans->caps[0] = box;
  /* the lookup owns its +1 params per the universal convention; options
   * crosses as the dyn undefined (Node passes its option bag — the
   * lowered resolver shape types it `unknown` and portless ignores it) */
  ((void (*)(ScrClosure *, ScrStr *, ScrDyn *, ScrClosure *))lookup->fn)(
      lookup, scr_str_retain(host), scr_dyn_undefined(), ans);
  scr_closure_release(lookup);
  /* a synchronous throw inside the lookup left the exception pending —
   * the emitter's may-throw check unwinds past this return */
  return s;
}

/* The answer closure's runtime half (its fn is the emitted per-shape
 * thunk; caps[0] boxes the socket). msg/ips are borrowed (nullable). */
void scr_net_lookup_answer(ScrClosure *self, bool has_err, ScrStr *msg /*borrowed, nullable*/,
                            ScrArr *ips /*borrowed, nullable*/) {
  ScrNetSocket *s = (ScrNetSocket *)scr_box_get_ref(self->caps[0]);
  if (s == NULL) return;
  if (!s->lookup_wait || s->close_emitted || s->fd >= 0) {
    scr_net_sock_release(s);
    return; /* late/repeated/dead-socket answers: the first decided */
  }
  s->lookup_wait = false;
  size_t n = ips != NULL ? (size_t)scr_arr_len(ips) : 0;
  if (has_err || n == 0) {
    /* lookup failure: the deferred 'error' (Node defers these too); an
     * EMPTY answer wears getaddrinfo's shape */
    if (msg != NULL && msg->len > 0) {
      scr_str_release(s->pending_err);
      s->pending_err = scr_str_retain(msg);
    } else if (s->pending_err == NULL) {
      char fb[160];
      snprintf(fb, sizeof fb, "getaddrinfo ENOTFOUND %s", s->peer_ip);
      s->pending_err = scr_str_new(fb, strlen(fb));
    }
    s->connecting = false;
    s->had_error = true;
    s->emit_close = true;
    scr_net_sock_mark_closing(s);
    scr_net_sock_release(s);
    return;
  }
  s->dial_ips = malloc(n * sizeof *s->dial_ips);
  if (!s->dial_ips) scr_net_oom();
  for (size_t i = 0; i < n; i++) s->dial_ips[i] = (ScrStr *)scr_arr_get_ref(ips, (double)i);
  s->dial_n = n;
  s->dial_i = 0;
  scr_net_sock_dial_next(s);
  scr_net_sock_release(s);
}

/* ── the socket surface ──────────────────────────────────────────────── */

void scr_net_sock_write_str(ScrNetSocket *s, ScrStr *data /*borrowed*/) {
  scr_net_sock_write_raw(s, data->data, data->len);
}

void scr_net_sock_write_bytes(ScrNetSocket *s, ScrBytes *data /*borrowed*/) {
  scr_net_sock_write_raw(s, (const char *)data->data, data->len);
}

void scr_net_sock_end(ScrNetSocket *s) {
  if (s->fd < 0 || s->wr_ending) return;
  s->wr_ending = true;
  scr_net_sock_maybe_finish_write(s);
  if (s->rd_eof && s->wr_done) scr_net_sock_close_fd(s);
}

void scr_net_sock_end_str(ScrNetSocket *s, ScrStr *data /*borrowed*/) {
  scr_net_sock_write_str(s, data);
  scr_net_sock_end(s);
}

void scr_net_sock_end_bytes(ScrNetSocket *s, ScrBytes *data /*borrowed*/) {
  scr_net_sock_write_bytes(s, data);
  scr_net_sock_end(s);
}

/* socket.pause(): reads stay off — the kernel buffer (and TCP flow
 * control) holds arrived bytes. Delivery restarts on
 * resume(), always from the poller/sweep, never this stack. Answers the
 * socket (+1) — Node's chaining. */
ScrNetSocket *scr_net_sock_pause(ScrNetSocket *s) {
  s->user_paused = true;
  scr_net_sock_update_read(s);
  return scr_net_sock_retain(s);
}

/* socket.resume(): flowing mode — a consumer even with no 'data'
 * listener (arrived bytes discard, so 'end' can be reached, Node's
 * resumed-but-unconsumed stream). Buffered bytes deliver from the next
 * sweep (flags_pending sees the flowing consumer), not this stack.
 * Answers the socket (+1) — Node's chaining. */
ScrNetSocket *scr_net_sock_resume(ScrNetSocket *s) {
  s->user_paused = false;
  s->flowing = true;
  scr_net_sock_update_read(s);
  return scr_net_sock_retain(s);
}

/* socket.setNoDelay(enable): TCP_NODELAY on the live fd (client dials
 * already set it — Node's default there is off, a documented divergence
 * in the dial path; this call makes the state explicit either way).
 * Answers the socket (+1) — Node's chaining. */
ScrNetSocket *scr_net_sock_set_nodelay(ScrNetSocket *s, bool enable) {
  if (s->fd >= 0) {
    int v = enable ? 1 : 0;
    setsockopt(s->fd, IPPROTO_TCP, TCP_NODELAY, &v, sizeof v);
  }
  return scr_net_sock_retain(s);
}

/* socket.destroySoon(): end the write half now, destroy once the FIN is
 * actually out (buffered bytes flush first — Node's 'finish'-then-destroy). */
void scr_net_sock_destroy_soon(ScrNetSocket *s) {
  if (s->fd < 0) return;
  if (s->wr_done) {
    scr_net_sock_close_fd(s);
    return;
  }
  s->destroy_on_finish = true;
  s->wr_ending = true;
  scr_net_sock_maybe_finish_write(s);
}

/* end(callback): fires once the FIN went out ('finish'), from the sweep. */
void scr_net_sock_on_finish(ScrNetSocket *s, ScrClosure *cb /*moves*/) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->finish_ls, cb, NULL, true);
  if (s->wr_done) s->finish_pending = true; /* already finished: next sweep */
}

/* write(chunk, callback): fires when the write buffer drains (this
 * surface's flush moment), from the sweep. */
void scr_net_sock_on_write_flush(ScrNetSocket *s, ScrClosure *cb /*moves*/) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->wcb_ls, cb, NULL, true);
}

double scr_net_sock_bytes_written(ScrNetSocket *s) { return (double)s->bytes_written; }

/* socket.readable: true until the read half is done (peer FIN / destroy). */
bool scr_net_sock_readable(ScrNetSocket *s) { return s->fd >= 0 && !s->rd_eof; }

/* socket.setTimeout(ms): ms > 0 arms the idle timer NOW (Node starts the
 * clock at the call — connecting time counts), ms <= 0 disables. */
void scr_net_sock_set_timeout(ScrNetSocket *s, double ms) {
  if (ms > 0 && s->fd >= 0) {
    s->timeout_ms = ms;
    scr_net_sock_timer_arm(s);
  } else {
    s->timeout_ms = 0;
    scr_net_sock_timer_cancel(s);
  }
}

void scr_net_sock_on_timeout(ScrNetSocket *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->timeout_ls, cb, NULL, once);
}

/* socket.remoteAddress: the peer's address (+1), cached at first read
 * (Node's _getpeername cache: a value read while connected survives
 * destroy), or NULL — the undefined arm — for a never-read socket after
 * close. A dual-stack accept of an IPv4 peer reads "::ffff:a.b.c.d",
 * like Node. */
/* socket.encrypted: true iff the socket carries a TLS transport (Node
 * types `encrypted: true` on TLSSocket from construction; plain sockets
 * answer the undefined arm — the emitter maps false to it). */
bool scr_net_sock_encrypted(ScrNetSocket *s) { return s->tops != NULL; }

ScrStr *scr_net_sock_remote_address(ScrNetSocket *s) {
  if (s->remote_cache) return scr_str_retain(s->remote_cache);
  if (s->fd < 0) return NULL;
  struct sockaddr_storage ss;
  socklen_t len = sizeof ss;
  if (getpeername(s->fd, (struct sockaddr *)&ss, &len) != 0) return NULL;
  char buf[INET6_ADDRSTRLEN];
  const char *out = NULL;
  if (ss.ss_family == AF_INET) {
    out = inet_ntop(AF_INET, &((struct sockaddr_in *)&ss)->sin_addr, buf, sizeof buf);
  } else if (ss.ss_family == AF_INET6) {
    out = inet_ntop(AF_INET6, &((struct sockaddr_in6 *)&ss)->sin6_addr, buf, sizeof buf);
  }
  if (!out) return NULL;
  s->remote_cache = scr_str_new(out, strlen(out));
  return scr_str_retain(s->remote_cache);
}

void scr_net_sock_destroy(ScrNetSocket *s) {
  if (s->fd < 0 && !s->in_registry) return;
  s->rd_eof = true;
  s->wr_done = true;
  scr_net_sock_close_fd(s); /* 'close' fires at the next sweep */
}

/* ── the paused-mode surface (the demux path: once('readable') +
 * read(1) + unshift) ─────────────────────────────────────────────────── */

/* Append arrived bytes to the receive buffer (paused-mode reads). */
static void scr_net_sock_append_rbuf(ScrNetSocket *s, const char *data, size_t len) {
  if (len == 0) return;
  if (s->rhead > 0) {
    memmove(s->rbuf, s->rbuf + s->rhead, s->rlen - s->rhead);
    s->rlen -= s->rhead;
    s->rhead = 0;
  }
  if (s->rlen + len > s->rcap) {
    size_t cap = s->rcap ? s->rcap : 4096;
    while (cap < s->rlen + len) cap *= 2;
    s->rbuf = realloc(s->rbuf, cap);
    if (!s->rbuf) scr_net_oom();
    s->rcap = cap;
  }
  memcpy(s->rbuf + s->rlen, data, len);
  s->rlen += len;
}

void scr_net_sock_on_readable(ScrNetSocket *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->close_emitted || s->rd_eof) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->readable_ls, cb, NULL, once);
  scr_net_sock_update_read(s);
}

/* socket.read(n): n > 0 answers exactly n buffered bytes or NULL (Node's
 * less-than-n-buffered answer); n <= 0 (the read() form) drains the
 * whole buffer, NULL when empty. Always +1. */
ScrBytes *scr_net_sock_read_bytes(ScrNetSocket *s, double n) {
  size_t avail = s->rlen - s->rhead;
  size_t want = n > 0 ? (size_t)n : avail;
  if (avail == 0 || want == 0 || want > avail) return NULL;
  ScrBytes *out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)want));
  size_t took = scr_net_sock_take_buffered(s, (char *)out->data, want);
  (void)took;
  return out;
}

/* socket.unshift(buf): the bytes re-enter the FRONT of the receive
 * buffer — every consumer (data listeners, an http parser, a TLS bio)
 * sees them before anything still in the kernel. */
void scr_net_sock_unshift_bytes(ScrNetSocket *s, ScrBytes *data /*borrowed*/) {
  if (data->len == 0) return;
  size_t avail = s->rlen - s->rhead;
  if (s->rhead >= data->len) {
    /* room at the front (the read(1)-then-unshift shape: the byte slots
     * straight back where it came from) */
    s->rhead -= data->len;
    memcpy(s->rbuf + s->rhead, data->data, data->len);
    return;
  }
  size_t total = data->len + avail;
  char *fresh = malloc(total > 0 ? total : 1);
  if (!fresh) scr_net_oom();
  memcpy(fresh, data->data, data->len);
  if (avail > 0) memcpy(fresh + data->len, s->rbuf + s->rhead, avail);
  free(s->rbuf);
  s->rbuf = fresh;
  s->rhead = 0;
  s->rlen = total;
  s->rcap = total > 0 ? total : 1;
}

/* server.emit('connection', socket): route an accepted socket into
 * ANOTHER server — the demux pattern (portless's first-byte TLS peek).
 * The target's protocol layer claims the socket (the http parser, or
 * the TLS transport whose deferred 'connection' fires post-handshake);
 * the socket's owning server stays the accepting one, exactly Node's
 * connection accounting. */
void scr_net_server_emit_connection(ScrNetServer *srv, ScrNetSocket *sock) {
  if (srv->close_emitted) return;
  if (srv->native_conn) {
    srv->native_conn(srv->native_ctx, sock);
    if (scr_exc_pending()) return;
  }
  if (srv->defer_conn) {
    if (sock->conn_pending) scr_net_server_release(sock->conn_pending);
    sock->conn_pending = scr_net_server_retain(srv);
    return;
  }
  ScrNetL *snap;
  size_t n = scr_net_ls_snapshot(&srv->conn_ls, &snap);
  scr_dyn_this_push(srv, SCR_DYNH_NET_SERVER);
  for (size_t i = 0; i < n; i++) {
    if (!scr_exc_pending()) ((ScrNetConnFn)snap[i].fn)(snap[i].cb, scr_net_sock_retain(sock));
    scr_closure_release(snap[i].cb);
  }
  scr_dyn_this_pop();
  free(snap);
}

/* The accepting server of a server-side socket (BORROWED; NULL on client
 * sockets) — the protocol layer binds it as the ambient receiver when
 * firing server-level events ('request': Node's this === server). */
ScrNetServer *scr_net_sock_server(ScrNetSocket *s) { return s->server; }

/* socket.setEncoding(enc) — the req twin (scr_http_req_set_encoding's
 * contract: utf8 flips 'data' to strings, real-but-unsupported encodings
 * fence loudly, unknown names throw ERR_UNKNOWN_ENCODING). */
void scr_net_sock_set_encoding(ScrNetSocket *s, ScrStr *enc /*borrowed*/) {
  if ((enc->len == 4 && memcmp(enc->data, "utf8", 4) == 0) ||
      (enc->len == 5 && memcmp(enc->data, "utf-8", 5) == 0)) {
    s->enc_utf8 = true;
    return;
  }
  static const char *const known[] = { "ascii", "latin1", "binary", "base64",
    "base64url", "hex", "ucs2", "ucs-2", "utf16le", "utf-16le", NULL };
  for (size_t i = 0; known[i]; i++) {
    if (enc->len == strlen(known[i]) && memcmp(enc->data, known[i], enc->len) == 0) {
      char msg[128];
      int n = snprintf(msg, sizeof msg, "setEncoding('%s') is not supported yet (only 'utf8' here)",
                       known[i]);
      scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
      return;
    }
  }
  char msg[128];
  int n = snprintf(msg, sizeof msg, "Unknown encoding: %.*s",
                   (int)(enc->len < 64 ? enc->len : 64), enc->data);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)n, "ERR_UNKNOWN_ENCODING");
}

/* pipe(dst): every arrived chunk forwards to dst; src EOF end()s dst
 * (Node's default). Also arms the read side — a pipe is a consumer. */
void scr_net_sock_pipe(ScrNetSocket *src, ScrNetSocket *dst) {
  if (src->pipe_dst) scr_net_sock_release(src->pipe_dst);
  src->pipe_dst = scr_net_sock_retain(dst);
  scr_net_sock_update_read(src);
}

void scr_net_sock_on_data(ScrNetSocket *s, ScrClosure *cb /*moves*/, ScrNetDataFn fn,
                           bool once) {
  if (s->close_emitted || s->rd_eof) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->data_ls, cb, (void *)fn, once);
  scr_net_sock_update_read(s);
}

void scr_net_sock_on_end(ScrNetSocket *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->close_emitted || s->rd_eof) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->end_ls, cb, NULL, once);
}

void scr_net_sock_on_close(ScrNetSocket *s, ScrClosure *cb /*moves*/, ScrNetCloseFn fn,
                            bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->close_ls, cb, (void *)fn, once);
}

/* The `hadError` adapter. The listener owns a plain bool -- nothing to
 * retain, so the thunk is the one cast (the data/conn thunk pattern). */
void scr_net_close_thunk_bool(ScrClosure *cb, bool had_error) {
  ((void (*)(ScrClosure *, bool))cb->fn)(cb, had_error);
}

void scr_net_sock_on_error(ScrNetSocket *s, ScrClosure *cb /*moves*/, ScrChildErrFn fn,
                            bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->err_ls, cb, (void *)fn, once);
}

void scr_net_sock_on_connect(ScrNetSocket *s, ScrClosure *cb /*moves*/, bool once) {
  if (s->close_emitted || (!s->connecting && s->fd < 0)) {
    scr_closure_release(cb);
    return;
  }
  if (!s->connecting) {
    /* already connected: Node fires a late once('connect')… never — the
     * event is past. Release, like listeners after 'exit'. */
    scr_closure_release(cb);
    return;
  }
  scr_net_ls_add(&s->conn_ls, cb, NULL, once);
}

/* The runtime-provided data adapters (the child/stdin thunk pattern). */
void scr_net_data_thunk0(ScrClosure *cb, ScrBytes *chunk) {
  (void)chunk;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

void scr_net_data_thunk_bytes(ScrClosure *cb, ScrBytes *chunk) {
  /* the listener owns its +1 param per the universal convention */
  ((void (*)(ScrClosure *, ScrBytes *))cb->fn)(cb, scr_bytes_retain(chunk));
}

/* The checked-dynamic data listener (a dynCheck-adapted (dyn) => void
 * closure): the chunk boxes BUFFER-flavored — Node hands Buffers to
 * 'data', so toString()/string coercion decode utf8 (the stream lane's
 * box-by-tag stance). The adapter owns its +1 dyn param. */
void scr_net_data_thunk_dyn(ScrClosure *cb, ScrBytes *chunk) {
  ScrDyn *d = scr_dyn_new_chunk(chunk);
  ((void (*)(ScrClosure *, ScrDyn *))cb->fn)(cb, d);
}

/* The string-TYPED data listener ((chunk: string) => void — the
 * setEncoding('utf8') shape): the chunk decodes as UTF-8 (WHATWG
 * replacement, Buffer.toString's algorithm) into the string the
 * annotation promises. Without setEncoding Node would hand a Buffer —
 * a string-typed listener there mistypes its own input, and the decode
 * is the honest reading of the annotation. */
void scr_net_data_thunk_str(ScrClosure *cb, ScrBytes *chunk) {
  ScrStr *enc = scr_str_new("utf8", 4);
  ScrStr *text = scr_bytes_to_str(chunk, enc);
  scr_str_release(enc);
  ((void (*)(ScrClosure *, ScrStr *))cb->fn)(cb, text);
}

/* The connection-handler adapters: the socket arrives +1 from the firing
 * site; the zero-param shape releases it. */
void scr_net_conn_thunk0(ScrClosure *cb, ScrNetSocket *sock) {
  scr_net_sock_release(sock);
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

void scr_net_conn_thunk_sock(ScrClosure *cb, ScrNetSocket *sock) {
  ((void (*)(ScrClosure *, ScrNetSocket *))cb->fn)(cb, sock);
}

/* ── the protocol-layer hooks (scr_http.c) ───────────────────────────── */

void scr_net_server_set_native_conn(ScrNetServer *s, ScrNetNativeConnFn fn, void *ctx,
                                     void (*ctx_free)(void *)) {
  s->native_conn = fn;
  s->native_ctx = ctx;
  s->native_ctx_free = ctx_free;
}

void scr_net_server_set_proto_settle(ScrNetServer *s, void (*fn)(void *)) {
  s->proto_settle = fn;
}

bool scr_net_server_settled(ScrNetServer *s) { return s->close_emitted; }

void scr_net_server_set_http_ctx(ScrNetServer *s, void *ctx) { s->http_ctx = ctx; }
void *scr_net_server_get_http_ctx(ScrNetServer *s) { return s->http_ctx; }

void scr_net_sock_set_native_reader(ScrNetSocket *s, ScrNetNativeDataFn data,
                                     ScrNetNativeEventFn eof, ScrNetNativeEventFn closed,
                                     void *ctx, void (*ctx_free)(void *)) {
  s->native_data = data;
  s->native_eof = eof;
  s->native_closed = closed;
  s->native_ctx = ctx;
  s->native_ctx_free = ctx_free;
  scr_net_sock_update_read(s);
}

/* The upgrade handover: clear the native reader's FN POINTERS but keep
 * the ctx (still freed at socket death as registered) — the protocol
 * parser steps aside mid-call and 'data'/pipe consumers take the raw
 * stream from the next byte on. */
void scr_net_sock_clear_native_reader(ScrNetSocket *s) {
  s->native_data = NULL;
  s->native_eof = NULL;
  s->native_closed = NULL;
  scr_net_sock_update_read(s);
}

/* socket.destroyed — true once the fd is gone (destroy() or full close),
 * Node's flag for "this stream is done". */
bool scr_net_sock_destroyed(ScrNetSocket *s) { return s->fd < 0; }

/* socket.writable — Node's stream flag: the write half is open (no end()
 * yet, no FIN sent, fd alive). Connecting sockets answer true — writes
 * queue, exactly Node. */
bool scr_net_sock_writable(ScrNetSocket *s) {
  return s->fd >= 0 && !s->wr_ending && !s->wr_done;
}

/* The protocol layer's timeout/error hooks (scr_http.c's client and the
 * server parser's error swallowing). */
void scr_net_sock_set_native_events(ScrNetSocket *s, ScrNetNativeEventFn timeout,
                                     ScrNetNativeErrFn err) {
  s->native_timeout = timeout;
  s->native_err = err;
}

/* Client connect completion for the protocol layer (the h2 session's
 * 'connect' moment) — fires before the socket's own conn_ls. */
void scr_net_sock_set_native_established(ScrNetSocket *s, ScrNetNativeEventFn fn) {
  s->native_established = fn;
}

/* Raw bytes from the protocol layer (head/framing text). */
void scr_net_sock_write_native(ScrNetSocket *s, const char *buf, size_t n) {
  scr_net_sock_write_raw(s, buf, n);
}

/* ── the transport hooks (scr_tls.c) ─────────────────────────────────── */

void scr_net_sock_set_transport(ScrNetSocket *s, const ScrNetTransportOps *ops, void *tctx) {
  s->tops = ops;
  s->tctx = tctx;
  s->t_est = false;
  scr_net_sock_update_read(s); /* the handshake is a consumer */
  scr_net_sock_update_write(s);
}

int scr_net_sock_fd(ScrNetSocket *s) { return s->fd; }

/* Drain up to n bytes of the receive buffer (peeked/unshifted bytes) —
 * consumers call this BEFORE the fd so re-queued bytes keep their
 * position in the stream. */
size_t scr_net_sock_take_buffered(ScrNetSocket *s, char *buf, size_t n) {
  size_t avail = s->rlen - s->rhead;
  if (avail == 0) return 0;
  size_t take = n < avail ? n : avail;
  memcpy(buf, s->rbuf + s->rhead, take);
  s->rhead += take;
  if (s->rhead == s->rlen) s->rhead = s->rlen = 0;
  return take;
}

void scr_net_sock_transport_want_write(ScrNetSocket *s) {
  s->t_want_write = true;
  scr_net_sock_update_write(s);
}

/* The transport context, guarded by ops identity — the SNI answer path
 * re-finds its engine from the boxed socket, which may have died (or
 * been re-routed) between the callback and the answer. */
void *scr_net_sock_transport_ctx_for(ScrNetSocket *s, const ScrNetTransportOps *ops) {
  return s->tops == ops ? s->tctx : NULL;
}

/* Re-drive a parked handshake (the asynchronous SNI answer arrived; no
 * fd readiness is coming — the client is waiting for the ServerHello). */
void scr_net_sock_transport_resume(ScrNetSocket *s) { scr_net_sock_transport_pump(s); }

/* Replay raw bytes at the FRONT of the receive buffer (the SNI
 * pre-parse handing the consumed ClientHello back to the TLS bio) —
 * unshift's shape over a raw span. */
void scr_net_sock_replay(ScrNetSocket *s, const char *data, size_t len) {
  if (len == 0) return;
  size_t avail = s->rlen - s->rhead;
  if (s->rhead >= len) {
    s->rhead -= len;
    memcpy(s->rbuf + s->rhead, data, len);
    return;
  }
  size_t total = len + avail;
  char *fresh = malloc(total);
  if (!fresh) scr_net_oom();
  memcpy(fresh, data, len);
  if (avail > 0) memcpy(fresh + len, s->rbuf + s->rhead, avail);
  free(s->rbuf);
  s->rbuf = fresh;
  s->rhead = 0;
  s->rlen = total;
  s->rcap = total;
}

void scr_net_sock_transport_error(ScrNetSocket *s, const char *msg) {
  if (msg != NULL) {
    if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
    s->had_error = true;
  }
  scr_net_sock_close_fd(s); /* the sweep delivers 'error' (if any) then 'close' */
}

void scr_net_server_defer_connections(ScrNetServer *s) { s->defer_conn = true; }

void scr_net_server_get_native_conn(ScrNetServer *s, ScrNetNativeConnFn *fn, void **ctx,
                                     void (**ctx_free)(void *)) {
  *fn = s->native_conn;
  *ctx = s->native_ctx;
  *ctx_free = s->native_ctx_free;
}

/* ── the sweep: deferred emits ───────────────────────────────────────── */

/* The protocol layer's deferred-emit hook (scr_http.c: response/request
 * 'close' events and the client teardown queue fire from the sweep, one
 * pass after the work that flagged them — Node's later-than-the-handler
 * emits). Registered once by scr_http install-time code. */
enum { SCR_NET_PROTO_SLOTS = 4 };
static bool (*scr_net_proto_pendings[SCR_NET_PROTO_SLOTS])(void);
static void (*scr_net_proto_sweeps[SCR_NET_PROTO_SLOTS])(void);
static size_t scr_net_proto_n = 0;

/* ADDITIVE registration (each protocol unit — scr_http.c, scr_http2.c —
 * claims a slot at its install; both can co-link in one binary). */
void scr_net_set_proto_sweep(bool (*pending)(void), void (*sweep)(void)) {
  if (scr_net_proto_n == SCR_NET_PROTO_SLOTS) abort();
  scr_net_proto_pendings[scr_net_proto_n] = pending;
  scr_net_proto_sweeps[scr_net_proto_n] = sweep;
  scr_net_proto_n++;
}

static bool scr_net_proto_pending(void) {
  for (size_t i = 0; i < scr_net_proto_n; i++) {
    if (scr_net_proto_pendings[i]()) return true;
  }
  return false;
}

static void scr_net_proto_sweep(void) {
  for (size_t i = 0; i < scr_net_proto_n; i++) {
    scr_net_proto_sweeps[i]();
    if (scr_exc_pending()) return;
  }
}

static bool scr_net_flags_pending(void) {
  if (scr_net_proto_pending()) return true;
  for (ScrNetSocket *s = scr_net_socks; s; s = s->next) {
    if (s->pending_err || (s->emit_close && !s->close_emitted)) return true;
    if (s->finish_pending && s->finish_ls.n > 0) return true;
    if (s->wcb_ls.n > 0 && (s->wlen == s->whead || s->fd < 0)) return true;
    /* bytes already out of the kernel with a consumer waiting — decrypted
     * plaintext inside a transport, or unshifted bytes in the receive
     * buffer: the poller can't re-signal them, the sweep must deliver */
    bool consumers = (s->data_ls.n > 0 || s->pipe_dst || s->native_data || s->flowing) &&
                     !s->user_paused;
    if (consumers && s->fd >= 0) {
      if (s->tops && s->t_est && s->tops->pending && s->tops->pending(s->tctx)) return true;
      if (!s->tops && s->rlen > s->rhead) return true;
    }
  }
  for (ScrNetServer *s = scr_net_servers; s; s = s->next) {
    if (s->pending_err || s->emit_listening) return true;
    if (s->closing && s->nconns == 0 && !s->close_emitted) return true;
  }
  return false;
}

/* Settles a server whose 'close' is due: fires the close callbacks and
 * listeners, drops every listener list (the cycle story), and leaves the
 * registry. Shared by the server sweep and the socket settle below —
 * Node emits a DRAINED server's 'close' before the dying socket's own
 * 'close', so the socket settle calls this mid-flight. */
static void scr_net_server_settle(ScrNetServer *srv) {
  srv->close_emitted = true;
  scr_net_fire0_this(&srv->close_ls, srv, SCR_DYNH_NET_SERVER);
  scr_net_ls_drop(&srv->conn_ls);
  scr_net_ls_drop(&srv->err_ls);
  scr_net_ls_drop(&srv->close_ls);
  scr_net_ls_drop(&srv->listening_cbs);
  if (srv->proto_settle && srv->http_ctx) srv->proto_settle(srv->http_ctx);
  scr_net_server_unregister(srv);
}

/* Every drained closing server whose 'close' is DUE, settled now, in the
 * order they BECAME due (due_seq) rather than registry order — which for
 * servers that were all drained when close() ran is close-request order,
 * Node's emission order when several drain in one turn.
 *
 * Called at BOTH ends of the sweep, and the leading call is the load-
 * bearing one. Node's Server.close() on an already-drained server runs
 * _emitCloseIfDrained, which schedules emitCloseNT on a NEXT TICK: the
 * 'close' lands before any further I/O is delivered. This runtime has no
 * per-server tick; the settle is polled out of the sweep. Settling only
 * at the sweep's END put that 'close' AFTER every socket serviced in the
 * same pass — after their 'close' events, and after any OTHER server
 * those sockets drained through the mid-sweep settle below. So a program
 * that closes a busy server and then a drained one saw the drained one's
 * 'close' last, where Node emits it first.
 *
 * The shape that found it (tests/fixtures/server/cases/http-proxy-pipe,
 * and the deterministic tests/corpus/6010 witness): proxy.close() with the
 * request's own connection still up, then backend.close() already drained.
 * Whether the proxy's connection died in the SAME sweep pass as the
 * backend's pending settle decided the order, so the program printed
 * "backend closed" then "proxy closed" most of the time and the reverse
 * the rest — a silent wrong answer at a rate, invisible to any gate that
 * runs the case once. Settling first thing in the pass removes the pass
 * from the question: a 'close' that was already due beats every socket
 * event the pass is about to deliver, which is exactly what a next tick
 * buys Node. */
static void scr_net_settle_due_after(size_t floor) {
  for (;;) {
    ScrNetServer *due = NULL;
    for (ScrNetServer *it = scr_net_servers; it; it = it->next) {
      if (it->closing && it->nconns == 0 && !it->close_emitted && it->due_seq > floor &&
          (due == NULL || it->due_seq < due->due_seq)) {
        due = it;
      }
    }
    if (due == NULL) return;
    scr_net_server_retain(due);
    scr_net_server_settle(due);
    scr_net_server_release(due);
    if (scr_exc_pending()) return;
  }
}

static void scr_net_settle_due_servers(void) { scr_net_settle_due_after(0); }

/* The settle at the HEAD of a sweep pass, which is where a 'close' that
 * came due in an earlier turn beats the socket events this pass is about
 * to deliver. It skips a server that came due in a LATER epoch than a
 * socket 'close' already waiting to be emitted.
 *
 * Node's rule is unconditional -- the tick queue always outruns the close
 * phase -- and within one loop iteration this is that rule, because a
 * callback that destroys sockets and drains servers stamps all of them
 * with one epoch. Across iterations it is not, and the difference is
 * visible:
 *
 *   a client socket reads its peer's FIN, ends, and is destroyed; the
 *   server-side socket reads the client's FIN in a LATER iteration and
 *   drains its closing server.
 *
 * Node prints the client socket's 'close' first, because it belonged to
 * the earlier iteration's close phase and the server's tick had not been
 * scheduled yet. This runtime often sees both readiness events in ONE
 * poller drain, so without the epoch test the server's 'close' would
 * overtake a socket 'close' that was already queued -- an ordering Node
 * never produces. The epoch is what keeps the two apart. */
static void scr_net_settle_due_head(void) {
  size_t oldest = (size_t)-1;
  for (ScrNetSocket *s = scr_net_socks; s; s = s->next) {
    if (!s->emit_close || s->close_emitted || s->fd >= 0) continue;
    if (s->close_deferred) s->close_epoch = scr_net_epoch; /* it waits for THIS pass */
    if (s->close_epoch < oldest) oldest = s->close_epoch;
  }
  for (;;) {
    ScrNetServer *due = NULL;
    for (ScrNetServer *it = scr_net_servers; it; it = it->next) {
      if (it->closing && it->nconns == 0 && !it->close_emitted && it->due_epoch <= oldest &&
          (due == NULL || it->due_seq < due->due_seq)) {
        due = it;
      }
    }
    if (due == NULL) return;
    scr_net_server_retain(due);
    scr_net_server_settle(due);
    scr_net_server_release(due);
    if (scr_exc_pending()) return;
  }
}

/* One socket's 'close': the tick queue first (every server already due
 * emits before any close callback — see scr_net_settle_due_servers), then
 * the protocol layer's teardown, the listeners, and the settle that drops
 * every list and leaves the registry. Answers false if a callback left an
 * exception pending; the caller stops the phase. The socket is retained by
 * the caller. */
static bool scr_net_sock_emit_close(ScrNetSocket *sock, size_t due_floor) {
  sock->close_emitted = true;
  sock->emit_close = false;
  scr_net_sock_detach_server(sock); /* belt and braces: a socket that
                                     * reached emit_close without a
                                     * close_fd (a failed dial) */
  /* Node drains the tick queue BETWEEN close callbacks, so a server this
   * phase's earlier close handlers drained emits before the next socket's
   * 'close'. Measured: two clients destroyed in one turn, the first
   * close handler destroying the last connection of a closing server, and
   * Node v25.9.0 prints y closed / srv closed / x closed 5/5.
   *
   * The FLOOR is what keeps that from also dragging forward a server that
   * came due earlier in the same sweep pass, out in the poll phase. It
   * should not need to: Node runs those ticks before the close phase too.
   * But this runtime delivers a half-closed server socket's EOF a whole
   * turn earlier than Node does (see the q3 note in
   * tests/fixtures/server/cases/net-close-order-drain), so a server it
   * drains is due here while Node's is not yet, and settling it would
   * print the server's 'close' ahead of a client socket's that Node puts
   * first. Until that EOF timing is fixed, servers due before the phase
   * settle at the sweep's tail, where they landed before. */
  scr_net_settle_due_after(due_floor);
  if (scr_exc_pending()) return false;
  if (sock->server) {
    ScrNetServer *srv = sock->server;
    sock->server = NULL;
    scr_net_server_release(srv);
  }
  if (sock->native_closed) {
    sock->native_closed(sock->native_ctx);
    if (scr_exc_pending()) return false;
  }
  scr_net_fire_close(&sock->close_ls, sock, SCR_DYNH_NET_SOCKET, sock->had_error);
  /* settle: listeners drop (cycle story) */
  scr_net_ls_drop(&sock->data_ls);
  scr_net_ls_drop(&sock->end_ls);
  scr_net_ls_drop(&sock->close_ls);
  scr_net_ls_drop(&sock->err_ls);
  scr_net_ls_drop(&sock->conn_ls);
  scr_net_ls_drop(&sock->timeout_ls);
  scr_net_ls_drop(&sock->readable_ls);
  scr_net_ls_drop(&sock->finish_ls);
  scr_net_ls_drop(&sock->wcb_ls);
  if (sock->pipe_dst) {
    scr_net_sock_release(sock->pipe_dst);
    sock->pipe_dst = NULL;
  }
  if (sock->conn_pending) {
    scr_net_server_release(sock->conn_pending);
    sock->conn_pending = NULL;
  }
  scr_net_sock_unregister(sock);
  return !scr_exc_pending();
}

/* The CLOSE PHASE, run once per sweep pass after every other socket event
 * — libuv's uv__run_closing_handles, modelled where it is observable.
 *
 * Two properties of it show through to JavaScript and neither held before.
 * First, it comes LAST: 'close' is a close-phase callback, while 'data',
 * 'error' and the write/finish callbacks come out of the poll phase, so in
 * Node every one of those beats every 'close' of the same turn. Emitting
 * the close inline in the socket walk fired one socket's 'close' before
 * the next socket's 'data'.
 *
 * Second, a socket destroyed while ITS OWN event was being delivered goes
 * FIRST, ahead of everything else the same turn destroyed. On win32
 * uv_tcp_close can only run the handle's endgame once its outstanding
 * overlapped requests have completed; the socket whose read completion
 * just fired has none left, so its close callback runs in this iteration
 * while the others wait for their cancelled reads to come back and close
 * in the next. Measured against Node v25.9.0 -- four sockets, all
 * destroyed inside socket K's own 'data' callback, two runs of each cell:
 *
 *   K=0 destroyed 0,1,2,3 -> 'close' 0,3,2,1     K=0 destroyed 3,2,1,0 -> 0,1,2,3
 *   K=2 destroyed 0,1,2,3 -> 'close' 2,3,1,0     K=2 destroyed 3,2,1,0 -> 2,0,1,3
 *   K=3 destroyed 0,1,2,3 -> 'close' 3,2,1,0     K=3 destroyed 3,2,1,0 -> 3,0,1,2
 *
 * K first every time, the rest in reverse destroy order. With no socket
 * event on the stack -- the same four destroyed from a timer -- it is
 * plain reverse destroy order, 3/3 on each of three destroy orders.
 *
 * K does not merely go first: it goes a whole ITERATION first, and that is
 * observable whenever the intervening poll produces anything. Three
 * clients destroyed inside s1's own 'data' handler, with the server closed
 * in the same handler, print
 *
 *   s1 closed / srv closed / s2 closed / s0 closed
 *
 * under Node -- the server drains in the poll phase BETWEEN s1's close and
 * the other two. So the phase emits the self sockets and leaves the rest
 * for the next sweep pass rather than ordering them all in one batch.
 *
 * Third, it is LIFO. uv_close pushes onto the FRONT of
 * loop->closing_handles and uv__run_closing_handles walks that list, so
 * one iteration's callbacks run in the reverse of the destroy order:
 *
 *   sockets destroyed 0,1,2,3  ->  'close' 3,2,1,0
 *   sockets destroyed 3,2,0,1  ->  'close' 1,0,2,3
 *
 * (measured against Node v25.9.0, four sockets, both orders, three runs
 * each). Walking the socket registry forwards gave the opposite of that
 * for any two connections destroyed in one turn.
 *
 * The BARRIER is the other half of libuv's shape: uv__run_closing_handles
 * takes the whole list and nulls it before running a single callback, so a
 * handle closed BY a close callback belongs to the next iteration and not
 * to this batch. Without it, LIFO would let a socket that a 'close'
 * handler destroys jump ahead of sockets that were already waiting.
 * Sockets stamped after the phase began are left for the next sweep pass;
 * the loop keeps running while any socket is registered, so nothing is
 * stranded.
 *
 * O(n^2) in the sockets closing at once, like the due-server settle beside
 * it. Nothing here has closed more than a handful in one pass; a program
 * that closed hundreds would want a stamped list rather than a scan. */
static void scr_net_sock_close_phase(void) {
  const size_t due_floor = scr_net_due_seq; /* what was already due when the phase began */
  size_t barrier = 0;
  bool any_self = false;
  for (ScrNetSocket *it = scr_net_socks; it; it = it->next) {
    if (it->emit_close && !it->close_emitted && it->fd < 0) {
      if (it->close_seq > barrier) barrier = it->close_seq;
      if (it->close_self) any_self = true;
    }
  }
  if (barrier == 0) return;
  if (any_self) {
    /* the others belong to the next iteration -- their epoch is re-stamped
     * at the sweep head so a server that drains in between still emits
     * ahead of them, which is where Node puts it */
    for (ScrNetSocket *it = scr_net_socks; it; it = it->next) {
      if (it->emit_close && !it->close_emitted && it->fd < 0 && !it->close_self) {
        it->close_deferred = true;
      }
    }
  }
  for (;;) {
    ScrNetSocket *pick = NULL;
    for (ScrNetSocket *it = scr_net_socks; it; it = it->next) {
      if (!it->emit_close || it->close_emitted || it->fd >= 0 || it->close_seq > barrier) continue;
      if (any_self && !it->close_self) continue;
      if (pick == NULL || it->close_seq > pick->close_seq) pick = it;
    }
    if (pick == NULL) return;
    scr_net_sock_retain(pick);
    ScrNetSocket *outer = scr_net_cur_sock;
    scr_net_cur_sock = pick;
    bool ok = scr_net_sock_emit_close(pick, due_floor);
    scr_net_cur_sock = outer;
    scr_net_sock_release(pick);
    if (!ok) return;
  }
}

/* Sockets first (a dying connection may drain its server), servers after.
 * Every fire checks for a pending exception and bails — the loop surfaces
 * it as an uncaught throw. */
static void scr_net_sweep(void) {
  scr_net_epoch++;
  scr_net_cur_sock = NULL; /* an unwound pass leaves no receiver behind */
  /* Ticks before I/O: a 'close' that came due in an earlier turn fires
   * before this pass delivers a single socket event (see the helper). */
  scr_net_settle_due_head();
  if (scr_exc_pending()) return;
  scr_net_proto_sweep();
  if (scr_exc_pending()) return;
  ScrNetSocket *sock = scr_net_socks;
  while (sock) {
    ScrNetSocket *next = sock->next; /* may unregister below */
    scr_net_sock_retain(sock);      /* callbacks may drop every other ref */
    scr_net_cur_sock = sock;
    if (sock->fd >= 0 && !sock->user_paused &&
        (sock->data_ls.n > 0 || sock->pipe_dst || sock->native_data || sock->flowing) &&
        ((sock->tops && sock->t_est && sock->tops->pending && sock->tops->pending(sock->tctx)) ||
         (!sock->tops && sock->rlen > sock->rhead))) {
      /* deliver bytes the kernel can't re-signal (see flags_pending) */
      scr_net_sock_read(sock);
      if (scr_exc_pending()) {
        scr_net_sock_release(sock);
        return;
      }
    }
    if (sock->wcb_ls.n > 0 && (sock->wlen == sock->whead || sock->fd < 0)) {
      /* write(chunk, cb): the buffer drained (this surface's flush
       * moment) — the callbacks fire off the sweep, never the writing
       * stack. A dead socket fires them too (the buffered bytes are
       * gone either way; Node errors them — documented divergence,
       * the no-backpressure stance). */
      scr_net_fire0_this(&sock->wcb_ls, sock, SCR_DYNH_NET_SOCKET);
      if (scr_exc_pending()) {
        scr_net_sock_release(sock);
        return;
      }
    }
    if (sock->finish_pending) {
      sock->finish_pending = false;
      scr_net_fire0_this(&sock->finish_ls, sock, SCR_DYNH_NET_SOCKET);
      if (scr_exc_pending()) {
        scr_net_sock_release(sock);
        return;
      }
    }
    if (sock->pending_err) {
      ScrStr *msg = sock->pending_err;
      sock->pending_err = NULL;
      /* the protocol layer gets first claim (the http conn/client owns
       * the error story: 'error' on the req, or Node's silent server-side
       * teardown); unconsumed errors fall through to the socket's own
       * listeners — and the unhandled-'error' exit */
      bool consumed = false;
      if (sock->native_err) consumed = sock->native_err(sock->native_ctx, msg);
      if (!consumed && !scr_exc_pending()) scr_net_fire_err_this(&sock->err_ls, msg, sock, SCR_DYNH_NET_SOCKET);
      scr_str_release(msg);
      if (scr_exc_pending()) {
        scr_net_sock_release(sock);
        return;
      }
    }
    scr_net_cur_sock = NULL;
    scr_net_sock_release(sock);
    sock = next;
  }
  scr_net_sock_close_phase(); /* libuv's close phase: last, and LIFO */
  if (scr_exc_pending()) return;
  ScrNetServer *srv = scr_net_servers;
  while (srv) {
    ScrNetServer *next = srv->next;
    scr_net_server_retain(srv);
    if (srv->emit_listening) {
      srv->emit_listening = false;
      scr_net_fire0_this(&srv->listening_cbs, srv, SCR_DYNH_NET_SERVER);
      if (scr_exc_pending()) {
        scr_net_server_release(srv);
        return;
      }
    }
    if (srv->pending_err) {
      ScrStr *msg = srv->pending_err;
      srv->pending_err = NULL;
      scr_net_fire_err_this(&srv->err_ls, msg, srv, SCR_DYNH_NET_SERVER);
      scr_str_release(msg);
      /* A failed listen SETTLES the handle: listeners drop (an error
       * listener capturing its own server would otherwise cycle forever —
       * the RC audit caught exactly that) and it leaves the registry. A
       * later listen() starts fresh; pre-failure listeners are gone,
       * where Node's would survive (SEMANTICS.md divergence 48). */
      if (!srv->listening && !srv->closing) {
        scr_net_ls_drop(&srv->conn_ls);
        scr_net_ls_drop(&srv->err_ls);
        scr_net_ls_drop(&srv->close_ls);
        scr_net_ls_drop(&srv->listening_cbs);
        scr_net_server_unregister(srv);
      }
      if (scr_exc_pending()) {
        scr_net_server_release(srv);
        return;
      }
    }
    scr_net_server_release(srv);
    srv = next;
  }
  scr_net_settle_due_servers();
}

/* ── the loop hooks (scr_async.c) ────────────────────────────────────── */

static bool scr_net_pending(void) {
  if (scr_net_servers != NULL || scr_net_socks != NULL) return true;
  return scr_net_proto_pending();
}

static int scr_net_pollfd(void) {
  return scr_net_poller != NULL ? scrp_poller_fd(scr_net_poller) : -1;
}

static void scr_net_dispatch(void) {
  if (!scr_net_servers && !scr_net_socks &&
      !scr_net_proto_pending()) {
    return;
  }
  for (;;) {
    scr_net_sweep();
    if (scr_exc_pending()) return;
    if (scr_net_poller == NULL) return;
    ScrPollerEvent evs[64];
    int n = scrp_drain(scr_net_poller, evs, 64);
    for (int i = 0; i < n; i++) {
      scr_net_epoch++; /* one delivered event = one callback turn */
      void *udata = evs[i].udata;
      if (!udata) continue;
      int kind = *(int *)udata;
      if (kind == SCR_NET_K_SERVER) {
        scr_net_server_accept((ScrNetServer *)udata);
      } else if (kind == SCR_NET_K_DIAL) {
        /* the attempt budget: only ever a timer, never fd readiness */
        scr_net_sock_attempt_timeout(((ScrNetDialTimer *)udata)->sock);
      } else if (kind == SCR_NET_K_SOCKET) {
        ScrNetSocket *s = (ScrNetSocket *)udata;
        scr_net_cur_sock = s;
        /* A callback earlier in this batch may have closed this fd
         * (destroy inside a data listener) — its remaining events are
         * stale; the handle itself stays alive until the sweep. */
        if (s->fd < 0) continue;
        if (evs[i].events & SCRP_TIMER) {
          /* the idle period elapsed: 'timeout' fires once (one-shot — the
           * next activity re-arms); the socket stays open, like Node */
          s->timeout_armed = false;
          if (s->native_timeout) {
            s->native_timeout(s->native_ctx);
            if (scr_exc_pending()) return;
          }
          scr_net_fire0_this(&s->timeout_ls, s, SCR_DYNH_NET_SOCKET);
        }
        /* kqueue delivers one direction per event (today's exact order);
         * epoll may coalesce both into one — writes first (connect
         * completion, flushes), then reads, re-checking the fd a write
         * failure may have closed. */
        if (evs[i].events & SCRP_WRITABLE) {
          if (s->connecting) scr_net_sock_connect_done(s);
          else if (s->tops && !s->t_est) {
            s->t_want_write = false;
            scr_net_sock_transport_pump(s);
            if (!scr_exc_pending() && s->fd >= 0) scr_net_sock_update_write(s);
          } else {
            s->t_want_write = false;
            scr_net_sock_flush(s);
          }
        }
        if ((evs[i].events & SCRP_READABLE) && !scr_exc_pending() && s->fd >= 0) {
          if (s->tops && !s->t_est) scr_net_sock_transport_pump(s);
          else scr_net_sock_read(s);
        }
      }
      scr_net_cur_sock = NULL;
      if (scr_exc_pending()) return;
    }
    if (!scr_net_flags_pending()) return;
    if (scr_loop_has_ready()) return; /* microtasks interleave first */
  }
}

/* Exit-time registry cleanup (the events-unit precedent): handles a
 * program legitimately leaves live at exit — a server running until
 * SIGTERM, sockets the peer never closed — release their listeners and
 * registry references so the RC audit sees a clean heap. */
static void scr_net_cleanup_atexit(void) {
  while (scr_net_socks) {
    ScrNetSocket *s = scr_net_socks;
    scr_net_ls_drop(&s->data_ls);
    scr_net_ls_drop(&s->end_ls);
    scr_net_ls_drop(&s->close_ls);
    scr_net_ls_drop(&s->err_ls);
    scr_net_ls_drop(&s->conn_ls);
    scr_net_ls_drop(&s->timeout_ls);
    scr_net_ls_drop(&s->readable_ls);
    /* Tear down the protocol layer's parser NOW: an in-flight http
     * exchange (a handler that threw before res.end()) holds req/res,
     * and the res holds this socket back — a cycle the lean untraced
     * handles cannot collect, visible only to the RC audit. No reads
     * follow at exit, so the parser hooks unhook first and the ctx
     * frees (scr_http_conn_free drops the in-flight pair; its close
     * emits are discarded at exit — the http unit's exiting flag). */
    if (s->native_ctx_free) {
      void (*ctx_free)(void *) = s->native_ctx_free;
      void *ctx = s->native_ctx;
      s->native_ctx_free = NULL;
      s->native_ctx = NULL;
      s->native_data = NULL;
      s->native_eof = NULL;
      s->native_closed = NULL;
      s->native_timeout = NULL;
      s->native_established = NULL;
      s->native_err = NULL;
      ctx_free(ctx);
    }
    if (s->pipe_dst) {
      scr_net_sock_release(s->pipe_dst);
      s->pipe_dst = NULL;
    }
    if (s->conn_pending) {
      scr_net_server_release(s->conn_pending);
      s->conn_pending = NULL;
    }
    if (s->server) {
      if (s->conn_counted) {
        s->conn_counted = false;
        s->server->nconns--;
      }
      scr_net_server_release(s->server);
      s->server = NULL;
    }
    scr_net_sock_unregister(s);
  }
  while (scr_net_servers) {
    ScrNetServer *s = scr_net_servers;
    scr_net_ls_drop(&s->conn_ls);
    scr_net_ls_drop(&s->err_ls);
    scr_net_ls_drop(&s->close_ls);
    scr_net_ls_drop(&s->listening_cbs);
    scr_closure_release(s->close_override);
    s->close_override = NULL;
    scr_net_server_unregister(s);
  }
}

#ifdef SCR_LOOP_WHY
/* What the net unit is holding, for the loop's SCR_LOOP_WHY line: a socket
 * only leaves the registry at its 'close' settle (emit_close && fd < 0), so
 * a socket whose fd is already -1 and whose close never got queued is
 * exactly the shape that keeps the loop alive with nothing left to do. */
static size_t scr_net_why(char *buf, size_t cap) {
  size_t socks = 0, srvs = 0, open_fd = 0, closed_no_emit = 0, connecting = 0;
  for (ScrNetSocket *s = scr_net_socks; s; s = s->next) {
    socks++;
    if (s->fd >= 0) open_fd++;
    if (s->connecting) connecting++;
    if (s->fd < 0 && !s->emit_close && !s->close_emitted) closed_no_emit++;
  }
  for (ScrNetServer *s = scr_net_servers; s; s = s->next) srvs++;
  int n = snprintf(buf, cap, "socks=%zu(openfd=%zu connecting=%zu closed-no-emit=%zu) servers=%zu proto=%d",
                   socks, open_fd, connecting, closed_no_emit, srvs,
                   scr_net_proto_pending() ? 1 : 0);
  if (n < 0) return 0;
  return (size_t)n < cap ? (size_t)n : cap;
}
#endif

void scr_net_install(void) {
  static bool installed = false;
  if (installed) return;
  installed = true;
  atexit(scr_net_cleanup_atexit);
  scr_loop_set_net(&scr_net_pending, &scr_net_dispatch, &scr_net_pollfd);
#ifdef SCR_LOOP_WHY
  scr_loop_why_register("net", &scr_net_why);
#endif
}

/* ── checked-dynamic handle dispatch (SCR_DYNH_NET_SOCKET ops) ─────────
 * The socket half of the HANDLE crossing (scr_http.c hosts the req/res
 * half and the shared design comment): members dispatch onto the same
 * entry points the static lowerings use; real-but-unmodeled members meet
 * the loud "not supported yet" ladder; unknown names answer Node's own
 * shapes ("<what> is not a function" / the undefined singleton). */

static void scr_net_dynh_unsupported(const char *member, const char *why) {
  char msg[160];
  int n = snprintf(msg, sizeof msg, "'Socket.prototype.%s' on a dynamic value is not supported yet%s%s",
                   member, why ? " — " : "", why ? why : "");
  scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
}

/* The TLS-member hooks (scr_tls.c registers them when linked): TLSSocket
 * property reads, event names, and method names layer over the plain
 * socket dispatch without this unit naming that one's symbols. */
static const ScrNetDynhTlsHooks *scr_net_dynh_tls = NULL;
void scr_net_set_dynh_tls(const ScrNetDynhTlsHooks *hooks) { scr_net_dynh_tls = hooks; }

static bool scr_net_dynh_name_is(const ScrDyn *name, const char *lit) {
  size_t n = strlen(lit);
  return name->kind == SCR_DYN_STR && name->v.str->len == n &&
         memcmp(name->v.str->data, lit, n) == 0;
}

static ScrDyn *scr_net_dynh_sock_invoke(void *h, ScrDyn *self, const char *method,
                                        ScrDyn *const *args, size_t argc, const char *what) {
  ScrNetSocket *s = (ScrNetSocket *)h;
  bool reg = false, once = false;
  if (strcmp(method, "on") == 0 || strcmp(method, "addListener") == 0) reg = true;
  else if (strcmp(method, "once") == 0) { reg = true; once = true; }
  if (reg) {
    const ScrDyn *name = argc > 0 ? args[0] : scr_dyn_undefined();
    const ScrDyn *cb = argc > 1 ? args[1] : scr_dyn_undefined();
    scr_dyn_check_listener(cb, "listener");
    if (scr_exc_pending()) return NULL;
    if (scr_net_dynh_name_is(name, "data")) {
      scr_net_sock_on_data(s, scr_dyn_listener_closure_data(cb), (ScrNetDataFn)&scr_dyn_listener_fire_data, once);
    } else if (scr_net_dynh_name_is(name, "end")) {
      scr_net_sock_on_end(s, scr_dyn_listener_closure0(cb), once);
    } else if (scr_net_dynh_name_is(name, "close")) {
      scr_net_sock_on_close(s, scr_dyn_listener_closure0(cb), NULL, once);
    } else if (scr_net_dynh_name_is(name, "error")) {
      scr_net_sock_on_error(s, scr_dyn_listener_closure_err(cb), (ScrChildErrFn)&scr_dyn_listener_fire_err, once);
    } else if (scr_net_dynh_name_is(name, "connect")) {
      scr_net_sock_on_connect(s, scr_dyn_listener_closure0(cb), once);
    } else if (scr_net_dynh_name_is(name, "timeout")) {
      scr_net_sock_on_timeout(s, scr_dyn_listener_closure0(cb), once);
    } else if (scr_net_dynh_name_is(name, "readable")) {
      scr_net_sock_on_readable(s, scr_dyn_listener_closure0(cb), once);
    } else if (scr_net_dynh_name_is(name, "finish")) {
      /* fires once when the FIN goes out — once either way */
      scr_net_sock_on_finish(s, scr_dyn_listener_closure0(cb));
    } else if (scr_net_dynh_name_is(name, "drain")) {
      /* This surface never backpressures (write answers true) — an
       * accepted, never-fired registration is the consistent answer. */
    } else if (scr_net_dynh_tls != NULL && name->kind == SCR_DYN_STR &&
               scr_net_dynh_tls->on(s, name->v.str->data, cb, once)) {
      /* a TLS event name ('secureConnect'), handled by the TLS unit */
    } else {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "listening for '");
      if (name->kind == SCR_DYN_STR) {
        for (size_t i = 0; i < name->v.str->len; i++) scr_jb_putc(&b, name->v.str->data[i]);
      }
      scr_jb_puts(&b, "' on a dynamic Socket is not supported yet");
      scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
      return NULL;
    }
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "write") == 0) {
    const ScrDyn *chunk = argc > 0 ? args[0] : scr_dyn_undefined();
    if (chunk->kind != SCR_DYN_STR && chunk->kind != SCR_DYN_BYTES) {
      scr_dyn_arg_type_fail("chunk", "of type string or an instance of Buffer or Uint8Array", chunk);
      return NULL;
    }
    if (chunk->kind == SCR_DYN_STR) scr_net_sock_write_str(s, chunk->v.str);
    else scr_net_sock_write_bytes(s, chunk->v.bytes);
    if (argc > 1 && args[1]->kind == SCR_DYN_FUNC) {
      /* write(chunk, cb): fires when the buffer drains (sweep-deferred) */
      scr_net_sock_on_write_flush(s, scr_dyn_listener_closure0(args[1]));
    }
    return scr_dyn_new_bool(true); /* backpressure is not modeled (SEMANTICS.md) */
  }
  if (strcmp(method, "end") == 0) {
    const ScrDyn *chunk = argc > 0 ? args[0] : scr_dyn_undefined();
    const ScrDyn *cb = NULL;
    if (chunk->kind == SCR_DYN_FUNC) { /* end(callback) */
      cb = chunk;
      chunk = scr_dyn_undefined();
    } else if (argc > 1 && args[1]->kind == SCR_DYN_FUNC) {
      cb = args[1]; /* end(chunk, callback) */
    }
    if (cb != NULL) scr_net_sock_on_finish(s, scr_dyn_listener_closure0(cb));
    if (chunk->kind == SCR_DYN_STR) scr_net_sock_end_str(s, chunk->v.str);
    else if (chunk->kind == SCR_DYN_BYTES) scr_net_sock_end_bytes(s, chunk->v.bytes);
    else if (chunk->kind == SCR_DYN_UNDEF || argc == 0) scr_net_sock_end(s);
    else {
      scr_dyn_arg_type_fail("chunk", "of type string or an instance of Buffer or Uint8Array", chunk);
      return NULL;
    }
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "pause") == 0) {
    scr_net_sock_release(scr_net_sock_pause(s)); /* the chaining +1; self answers */
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "resume") == 0) {
    scr_net_sock_release(scr_net_sock_resume(s));
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "setNoDelay") == 0) {
    /* setNoDelay([enable]) — missing/undefined means true, Node */
    bool enable = argc == 0 || args[0]->kind == SCR_DYN_UNDEF || scr_dyn_truthy(args[0]);
    scr_net_sock_release(scr_net_sock_set_nodelay(s, enable));
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "destroySoon") == 0) {
    scr_net_sock_destroy_soon(s);
    return scr_dyn_retain(scr_dyn_undefined());
  }
  if (strcmp(method, "destroy") == 0) {
    if (argc > 0 && args[0]->kind != SCR_DYN_UNDEF) {
      scr_net_dynh_unsupported("destroy", "destroy(error) carries a payload this surface does not model");
      return NULL;
    }
    scr_net_sock_destroy(s);
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "setTimeout") == 0) {
    const ScrDyn *ms = argc > 0 ? args[0] : scr_dyn_undefined();
    if (ms->kind != SCR_DYN_NUM) {
      scr_dyn_arg_type_fail("msecs", "of type number", ms);
      return NULL;
    }
    scr_net_sock_set_timeout(s, ms->v.num);
    if (argc > 1 && args[1]->kind == SCR_DYN_FUNC) {
      scr_net_sock_on_timeout(s, scr_dyn_listener_closure0(args[1]), true);
    } else if (argc > 1 && args[1]->kind != SCR_DYN_UNDEF) {
      scr_dyn_check_listener(args[1], "callback");
      return NULL;
    }
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "setEncoding") == 0) {
    const ScrDyn *enc = argc > 0 ? args[0] : scr_dyn_undefined();
    if (enc->kind != SCR_DYN_STR) {
      scr_dyn_arg_type_fail("encoding", "of type string", enc);
      return NULL;
    }
    scr_net_sock_set_encoding(s, enc->v.str);
    if (scr_exc_pending()) return NULL;
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "pipe") == 0) {
    const ScrDyn *dst = argc > 0 ? args[0] : scr_dyn_undefined();
    if (dst->kind == SCR_DYN_HANDLE && dst->v.handle.tag == SCR_DYNH_NET_SOCKET) {
      scr_net_sock_pipe(s, (ScrNetSocket *)dst->v.handle.ptr);
      return scr_dyn_retain((ScrDyn *)dst);
    }
    if (dst->kind == SCR_DYN_HANDLE) {
      /* Cross-unit destinations (a ServerResponse) accept the source
       * through their pipe_from hook — this unit cannot name theirs. */
      const ScrDynHandleOps *dops = scr_dyn_handle_ops_of(dst);
      if (dops->pipe_from && dops->pipe_from(dst->v.handle.ptr, self)) {
        return scr_dyn_retain((ScrDyn *)dst);
      }
    }
    scr_net_dynh_unsupported("pipe", "only Socket and ServerResponse destinations are modeled");
    return NULL;
  }
  if (strcmp(method, "toString") == 0) {
    ScrStr *str = scr_str_new("[object Object]", 15);
    ScrDyn *d = scr_dyn_new_str(str);
    scr_str_release(str);
    return d;
  }
  if (scr_net_dynh_tls != NULL) {
    ScrDyn *out = NULL;
    if (scr_net_dynh_tls->invoke(s, method, args, argc, &out)) return out;
  }
  {
    static const char *const known[] = { "connect", "setKeepAlive",
      "address", "ref", "unref", "cork", "uncork", "read", "unpipe",
      "off", "removeListener", "removeAllListeners", "emit", "prependListener",
      "prependOnceListener", "listenerCount", "listeners", "resetAndDestroy", NULL };
    for (size_t i = 0; known[i]; i++) {
      if (strcmp(method, known[i]) == 0) {
        scr_net_dynh_unsupported(method, NULL);
        return NULL;
      }
    }
  }
  {
    char msg[160];
    int n = snprintf(msg, sizeof msg, "%s is not a function", what);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  }
  return NULL;
}

static ScrDyn *scr_net_dynh_sock_get(void *h, const char *key, size_t key_len) {
  ScrNetSocket *s = (ScrNetSocket *)h;
  (void)key_len;
  if (strcmp(key, "destroyed") == 0) return scr_dyn_new_bool(scr_net_sock_destroyed(s));
  if (strcmp(key, "writable") == 0) return scr_dyn_new_bool(scr_net_sock_writable(s));
  if (strcmp(key, "remoteAddress") == 0) {
    ScrStr *a = scr_net_sock_remote_address(s);
    if (!a) return NULL; /* the undefined arm, the static lane's split */
    ScrDyn *d = scr_dyn_new_str(a);
    scr_str_release(a);
    return d;
  }
  if (strcmp(key, "encrypted") == 0) {
    /* Node types `encrypted: true` on TLSSocket only; plain sockets read
     * undefined — the static lane's false→undefined mapping. */
    return scr_net_sock_encrypted(s) ? scr_dyn_new_bool(true) : NULL;
  }
  if (strcmp(key, "bytesWritten") == 0) return scr_dyn_new_num(scr_net_sock_bytes_written(s));
  if (strcmp(key, "readable") == 0) return scr_dyn_new_bool(scr_net_sock_readable(s));
  if (strcmp(key, "writableHighWaterMark") == 0 || strcmp(key, "readableHighWaterMark") == 0) {
    /* Node's default stream highWaterMark — a constant here (backpressure
     * is not modeled; SEMANTICS.md) */
    return scr_dyn_new_num(16384);
  }
  if (scr_net_dynh_tls != NULL) {
    ScrDyn *out = NULL;
    if (scr_net_dynh_tls->get(s, key, &out)) return out;
  }
  {
    static const char *const known[] = { "remotePort", "remoteFamily", "localAddress",
      "localPort", "localFamily", "bytesRead", "connecting", "pending",
      "readyState", "bufferSize", "timeout", "closed", "errored", NULL };
    for (size_t i = 0; known[i]; i++) {
      if (strcmp(key, known[i]) == 0) {
        scr_net_dynh_unsupported(key, NULL);
        return NULL;
      }
    }
  }
  return NULL;
}

static bool scr_net_dynh_sock_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  (void)h; (void)key; (void)key_len; (void)value;
  return false;
}

static const ScrDynHandleOps scr_net_dynh_sock_ops = {
  "Socket",
  &scr_net_sock_retain_v,
  &scr_net_sock_release_v,
  &scr_net_dynh_sock_invoke,
  &scr_net_dynh_sock_get,
  &scr_net_dynh_sock_set,
  NULL,
};

/* ── checked-dynamic handle dispatch (SCR_DYNH_NET_SERVER ops) ─────────
 * The server half: `let server; server = createServer(...)` puts the
 * handle into a dyn binding, and every listener body's `this` answers
 * the emitting server (the ambient receiver) — both dispatch here.
 * Members ride the same entry points the static lowerings use. HTTP
 * server events ('request') route through the hook scr_http.c registers
 * at its dyn install — this unit cannot name http entry points without
 * breaking the link gate. */

static bool (*scr_net_dynh_http_on)(ScrNetServer *s, const char *event, const ScrDyn *cb,
                                    bool once);
void scr_net_set_dynh_http_on(bool (*fn)(ScrNetServer *, const char *, const ScrDyn *, bool)) {
  scr_net_dynh_http_on = fn;
}

static void scr_net_dynh_srv_unsupported(const char *member, const char *why) {
  char msg[160];
  int n = snprintf(msg, sizeof msg, "'Server.prototype.%s' on a dynamic value is not supported yet%s%s",
                   member, why ? " — " : "", why ? why : "");
  scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
}

/* The 'connection' fire for a dyn listener: box the socket by reference
 * and call through the checked-dynamic machinery (the ScrNetConnFn ABI —
 * sock arrives +1 and the adapter owns it, like the static adapters). */
static void scr_net_dynh_fire_conn(ScrClosure *cb, ScrNetSocket *sock /* +1 */) {
  ScrDyn *fn = scr_dyn_listener_fn(cb);
  ScrDyn *dsock = scr_dyn_new_handle(sock, SCR_DYNH_NET_SOCKET);
  ScrDyn *args[1] = { dsock };
  ScrDyn *r = scr_dyn_call(fn, args, 1, "listener");
  scr_dyn_release(r);
  scr_dyn_release(dsock);
  scr_dyn_release(fn);
  scr_net_sock_release(sock);
}

/* server.address() — Node's { address, family, port } object, null while
 * not listening (never bound, or already closed). */
static ScrDyn *scr_net_dynh_srv_address(ScrNetServer *s) {
  if (!s->listening || s->fd < 0) return scr_dyn_new_null();
  ScrDyn *o = scr_dyn_new_obj();
  {
    ScrStr *a = s->bound_host ? scr_str_retain(s->bound_host)
                              : scr_str_new(s->bound_v6 ? "::" : "0.0.0.0", s->bound_v6 ? 2 : 7);
    scr_dyn_obj_set(o, "address", 7, scr_dyn_new_str(a));
    scr_str_release(a);
  }
  {
    const char *fam = s->bound_v6 ? "IPv6" : "IPv4";
    ScrStr *f = scr_str_new(fam, 4);
    scr_dyn_obj_set(o, "family", 6, scr_dyn_new_str(f));
    scr_str_release(f);
  }
  scr_dyn_obj_set(o, "port", 4, scr_dyn_new_num((double)s->port));
  return o;
}

static ScrDyn *scr_net_dynh_srv_invoke(void *h, ScrDyn *self, const char *method,
                                       ScrDyn *const *args, size_t argc, const char *what) {
  ScrNetServer *s = (ScrNetServer *)h;
  bool reg = false, once = false;
  if (strcmp(method, "on") == 0 || strcmp(method, "addListener") == 0) reg = true;
  else if (strcmp(method, "once") == 0) { reg = true; once = true; }
  if (reg) {
    const ScrDyn *name = argc > 0 ? args[0] : scr_dyn_undefined();
    const ScrDyn *cb = argc > 1 ? args[1] : scr_dyn_undefined();
    scr_dyn_check_listener(cb, "listener");
    if (scr_exc_pending()) return NULL;
    if (scr_net_dynh_name_is(name, "listening")) {
      scr_net_server_on_listening(s, scr_dyn_listener_closure0(cb), once);
    } else if (scr_net_dynh_name_is(name, "close")) {
      scr_net_server_on_close(s, scr_dyn_listener_closure0(cb), once);
    } else if (scr_net_dynh_name_is(name, "error")) {
      scr_net_server_on_error(s, scr_dyn_listener_closure_err(cb),
                              (ScrChildErrFn)&scr_dyn_listener_fire_err, once);
    } else if (scr_net_dynh_name_is(name, "connection")) {
      scr_net_server_on_connection(s, scr_dyn_listener_closure_fn(cb, (void *)&scr_net_dynh_fire_conn),
                                   (ScrNetConnFn)&scr_net_dynh_fire_conn, once);
    } else if (scr_net_dynh_name_is(name, "secureConnection") && s->defer_conn) {
      /* a TLS server's 'connection' list IS post-handshake (deferred) —
       * exactly Node's secureConnection timing; on a plain server the
       * name falls through to the fence below */
      scr_net_server_on_connection(s, scr_dyn_listener_closure_fn(cb, (void *)&scr_net_dynh_fire_conn),
                                   (ScrNetConnFn)&scr_net_dynh_fire_conn, once);
    } else if (name->kind == SCR_DYN_STR && scr_net_dynh_http_on &&
               scr_net_dynh_http_on(s, name->v.str->data, cb, once)) {
      /* the http layer accepted the event ('request') */
    } else {
      ScrJsonBuf b;
      scr_jb_init(&b);
      scr_jb_puts(&b, "listening for '");
      if (name->kind == SCR_DYN_STR) {
        for (size_t i = 0; i < name->v.str->len; i++) scr_jb_putc(&b, name->v.str->data[i]);
      }
      scr_jb_puts(&b, "' on a dynamic Server is not supported yet");
      scr_throw_error(SCR_ERR_ERROR, scr_jb_finish(&b));
      return NULL;
    }
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "listen") == 0) {
    /* listen([port][, host][, cb]) — the static lowering's shapes over
     * dyn arguments; the options-object form fences loudly. */
    double port = 0;
    ScrStr *host = NULL;
    const ScrDyn *cb = NULL;
    size_t i = 0;
    if (i < argc && args[i]->kind == SCR_DYN_NUM) { port = args[i]->v.num; i++; }
    else if (i < argc && args[i]->kind == SCR_DYN_STR && args[i]->v.str->len > 0 &&
             args[i]->v.str->data[0] >= '0' && args[i]->v.str->data[0] <= '9') {
      /* Node coerces a numeric port string */
      port = strtod(args[i]->v.str->data, NULL);
      i++;
    } else if (i < argc && args[i]->kind == SCR_DYN_OBJ) {
      scr_net_dynh_srv_unsupported("listen", "the options-object form on a dynamic value is not modeled (use listen(port[, host][, cb]))");
      return NULL;
    }
    if (i < argc && args[i]->kind == SCR_DYN_STR) { host = args[i]->v.str; i++; }
    if (i < argc && args[i]->kind == SCR_DYN_FUNC) { cb = args[i]; i++; }
    if (i < argc && args[i]->kind != SCR_DYN_UNDEF && args[i]->kind != SCR_DYN_NULL) {
      scr_net_dynh_srv_unsupported("listen", "unrecognized arguments (the modeled shape is listen(port[, host][, cb]))");
      return NULL;
    }
    ScrClosure *clo = cb ? scr_dyn_listener_closure0(cb) : NULL;
    if (host) scr_net_listen_opts(s, port, host, false, clo);
    else scr_net_listen(s, port, clo);
    return scr_dyn_retain(self); /* Node's `return this` chaining */
  }
  if (strcmp(method, "close") == 0) {
    const ScrDyn *cb = argc > 0 ? args[0] : scr_dyn_undefined();
    if (cb->kind == SCR_DYN_FUNC) {
      scr_net_server_close(s, scr_dyn_listener_closure0(cb));
    } else if (cb->kind == SCR_DYN_UNDEF || argc == 0) {
      scr_net_server_close(s, NULL);
    } else {
      scr_dyn_check_listener(cb, "callback");
      return NULL;
    }
    return scr_dyn_retain(self);
  }
  if (strcmp(method, "address") == 0) {
    return scr_net_dynh_srv_address(s);
  }
  if (strcmp(method, "emit") == 0 && argc > 0 && scr_net_dynh_name_is(args[0], "connection")) {
    const ScrDyn *sockd = argc > 1 ? args[1] : scr_dyn_undefined();
    if (sockd->kind == SCR_DYN_HANDLE && sockd->v.handle.tag == SCR_DYNH_NET_SOCKET) {
      scr_net_server_emit_connection(s, (ScrNetSocket *)sockd->v.handle.ptr);
      return scr_dyn_new_bool(true);
    }
    scr_dyn_arg_type_fail("socket", "an instance of Socket", sockd);
    return NULL;
  }
  if (strcmp(method, "toString") == 0) {
    ScrStr *str = scr_str_new("[object Object]", 15);
    ScrDyn *d = scr_dyn_new_str(str);
    scr_str_release(str);
    return d;
  }
  {
    static const char *const known[] = { "ref", "unref", "setTimeout", "getConnections",
      "off", "removeListener", "removeAllListeners", "emit", "prependListener",
      "prependOnceListener", "listenerCount", "listeners", "closeAllConnections",
      "closeIdleConnections", NULL };
    for (size_t i = 0; known[i]; i++) {
      if (strcmp(method, known[i]) == 0) {
        scr_net_dynh_srv_unsupported(method, NULL);
        return NULL;
      }
    }
  }
  {
    char msg[160];
    int n = snprintf(msg, sizeof msg, "%s is not a function", what);
    scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)n);
  }
  return NULL;
}

static ScrDyn *scr_net_dynh_srv_get(void *h, const char *key, size_t key_len) {
  ScrNetServer *s = (ScrNetServer *)h;
  (void)key_len;
  if (strcmp(key, "listening") == 0) return scr_dyn_new_bool(s->listening);
  {
    static const char *const known[] = { "maxConnections", "connections", "maxHeadersCount",
      "timeout", "keepAliveTimeout", "headersTimeout", "requestTimeout", NULL };
    for (size_t i = 0; known[i]; i++) {
      if (strcmp(key, known[i]) == 0) {
        scr_net_dynh_srv_unsupported(key, NULL);
        return NULL;
      }
    }
  }
  return NULL;
}

static bool scr_net_dynh_srv_set(void *h, const char *key, size_t key_len, const ScrDyn *value) {
  (void)h; (void)key; (void)key_len; (void)value;
  return false;
}

static const ScrDynHandleOps scr_net_dynh_srv_ops = {
  "Server",
  &scr_net_server_retain_v,
  &scr_net_server_release_v,
  &scr_net_dynh_srv_invoke,
  &scr_net_dynh_srv_get,
  &scr_net_dynh_srv_set,
  NULL,
};

void scr_net_dyn_install(void) {
  scr_dyn_handle_install(SCR_DYNH_NET_SOCKET, &scr_net_dynh_sock_ops);
  scr_dyn_handle_install(SCR_DYNH_NET_SERVER, &scr_net_dynh_srv_ops);
}

/* Checked-dynamic chunks into a TYPED socket (an untyped JS payload
 * flowing into socket.write/end — the static lowering's dyn-data arm):
 * STR/BYTES dispatch onto the typed entries; undefined/null end()s plain
 * (Node accepts them); anything else throws Node's ERR_INVALID_ARG_TYPE
 * chunk TypeError. Both borrowed. */
void scr_net_sock_write_dynv(ScrNetSocket *s, const ScrDyn *d) {
  if (d->kind == SCR_DYN_STR) scr_net_sock_write_str(s, d->v.str);
  else if (d->kind == SCR_DYN_BYTES) scr_net_sock_write_bytes(s, d->v.bytes);
  else scr_dyn_arg_type_fail("chunk", "of type string or an instance of Buffer or Uint8Array", d);
}

void scr_net_sock_end_dynv(ScrNetSocket *s, const ScrDyn *d) {
  if (d->kind == SCR_DYN_STR) scr_net_sock_end_str(s, d->v.str);
  else if (d->kind == SCR_DYN_BYTES) scr_net_sock_end_bytes(s, d->v.bytes);
  else if (d->kind == SCR_DYN_UNDEF || d->kind == SCR_DYN_NULL) scr_net_sock_end(s);
  else scr_dyn_arg_type_fail("chunk", "of type string or an instance of Buffer or Uint8Array", d);
}
