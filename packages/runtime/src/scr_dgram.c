/* node:dgram + node:dns — UDP sockets over the event loop's readiness
 * poller (the scr_platform.h contract — kqueue on macOS/BSD, epoll on
 * Linux; scr_net.c has the seam's full story), and the dns.lookup slice
 * that rides the same unit.
 *
 * ── Design note ──────────────────────────────────────────────────────
 *
 * Object model. One refcounted handle kind, a LEAN allocation (no cycle
 * header — the ScrNetSocket precedent): ScrDgramSocket (fd, the
 * bound/connected/closing state machine, message/listening/connect/
 * close/error listener lists, the unref flag). Listeners MOVE in (+1)
 * and are released when the handle settles ('close' fired, or the
 * exit-time cleanup) — the scr_net.c ownership story verbatim, so a
 * listener capturing its own socket cannot cycle past settlement.
 *
 * Event dispatch. One poller owned by this unit (lazily created), fds
 * non-blocking. The loop (scr_async.c) calls scr_dgram_dispatch() at
 * every turn top — the net hook's exact shape — alternating a SWEEP of
 * deferred emits ('listening'/'connect' callbacks, bind/send failures,
 * 'close', pending dns.lookup deliveries) with a zero-timeout poller
 * drain (arrived datagrams, delivered macrotask-style on the main
 * stack), stopping early when a callback enqueued microtasks or threw.
 * Between turns the loop's idle poll(2) watches this unit's poller fd.
 *
 * Read model. Consumer-driven like net sockets: the read filter is armed
 * only while a 'message' listener exists — unheard datagrams wait in
 * the kernel's socket buffer (and drop when it fills, UDP's contract
 * in Node too). One recvfrom(2) per datagram, one 'message' emit per
 * datagram, rinfo parts delivered borrowed to the per-shape adapters.
 *
 * Send model. sendto(2) immediately — a UDP datagram either goes out or
 * it doesn't; there is no partial-write buffering. An unbound sender
 * implicit-binds (the kernel's ephemeral port), like Node. Send
 * failures defer to the 'error' sweep.
 *
 * State errors, Node-matched: bind on a bound socket throws "Socket is
 * already bound"; connect on a connected one "Already connected";
 * send/close/address on a closed (or address on a never-bound) one
 * "Not running" — all synchronous catchable Errors with Node's
 * MESSAGES (the code/errno properties don't exist — the fs error
 * stance, SEMANTICS.md divergence 13). Runtime failures (EADDRINUSE,
 * unreachable sends, failed host lookups) are the async 'error' event;
 * an 'error' with no listener prints and exits 1, the unhandled
 * EventEmitter behavior. bind()/connect() emit 'listening' (connect
 * implicit-binds first, so BOTH fire, Node's order) and 'connect' on
 * the next dispatch pass — Node's next-tick emits.
 *
 * Loop liveness. An open (bound or connected) socket holds the loop
 * until 'close' delivers or unref() waives it — Node's unref
 * semantics; ref() re-arms. A created-but-never-bound socket holds
 * nothing. Handles abandoned at exit are released by the atexit
 * cleanup, so the RC audit stays clean.
 *
 * dns.lookup. getaddrinfo(AF_INET) runs AT CALL TIME — synchronously,
 * where Node uses its threadpool (SEMANTICS.md documents the blocking
 * divergence) — and the callback defers to the next dispatch pass, so
 * delivery is async like Node's. Failures deliver Node's message shape
 * ("getaddrinfo ENOTFOUND <hostname>") through the per-union adapters;
 * the address argument is "" on failure where Node passes undefined
 * (the string-typed slot cannot hold undefined). A pending lookup
 * holds the loop like an in-flight request. */
#include "scr_platform.h"
#include "scr_runtime.h"

#include <errno.h>
#include <fcntl.h>
#include <math.h>
#include <stdio.h>
#include <time.h>
#include <stdlib.h>
#include <string.h>
#ifndef _MSC_VER
#include <unistd.h>
#endif
#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h> /* getaddrinfo/EAI_*, inet_pton/ntop, socklen_t */
#else
#include <netdb.h>
#include <netinet/in.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#endif

static void scr_dgram_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

#ifdef _WIN32
/* ── the winsock arm (scr_net.c's respelling, restated so this unit links
 * without scr_net.c — the listener-list precedent below) ───────────────
 * The BSD socket calls this file speaks, respelled once so every call
 * site stays byte-identical: SOCKETs narrow through the int fd contract,
 * failures land their WSA code in errno TRANSLATED to the POSIX constant
 * scr_dgram_errname and the retry tests read (libuv performs the same
 * translation for Node, so the spellings agree with the Windows oracle),
 * and close is closesocket. WSAStartup rides scrp_poller_new
 * (scr_loop_wsapoll.c): every socket() site is preceded by
 * scr_dgram_poller_init(), and scr_dns_lookup initializes the poller on
 * this arm before getaddrinfo (which needs winsock started too). The
 * netdb surface (getaddrinfo/freeaddrinfo, the EAI_* codes) is native
 * winsock — ws2tcpip.h spells Node's exact codes, WSAHOST_NOT_FOUND
 * being EAI_NONAME. */
static int scr_dgram_w32_map_err(int e) {
  switch (e) {
  case WSAEWOULDBLOCK: return EAGAIN;
  case WSAEINTR: return EINTR;
  case WSAECONNREFUSED: return ECONNREFUSED;
  case WSAECONNRESET: return ECONNRESET;
  case WSAEADDRINUSE: return EADDRINUSE;
  case WSAEACCES: return EACCES;
  case WSAEADDRNOTAVAIL: return EADDRNOTAVAIL;
  case WSAEHOSTUNREACH: return EHOSTUNREACH;
  case WSAENETUNREACH: return ENETUNREACH;
  case WSAEMSGSIZE: return EMSGSIZE;
  case WSAEINVAL: return EINVAL;
  default: return e;
  }
}

static void scr_dgram_w32_seterr(void) { errno = scr_dgram_w32_map_err((int)WSAGetLastError()); }

static int scr_dgram_w32_socket(int af, int type, int proto) {
  SOCKET s = socket(af, type, proto);
  if (s == INVALID_SOCKET) {
    scr_dgram_w32_seterr();
    return -1;
  }
  return (int)s;
}

static int scr_dgram_w32_bind(int fd, const struct sockaddr *sa, socklen_t len) {
  if (bind((SOCKET)fd, sa, (int)len) != 0) {
    scr_dgram_w32_seterr();
    return -1;
  }
  return 0;
}

/* UDP connect(2) is local and immediate on winsock too — no EINPROGRESS
 * arm, unlike scr_net.c's stream wrapper. */
static int scr_dgram_w32_connect(int fd, const struct sockaddr *sa, socklen_t len) {
  if (connect((SOCKET)fd, sa, (int)len) != 0) {
    scr_dgram_w32_seterr();
    return -1;
  }
  return 0;
}

static int scr_dgram_w32_getsockname(int fd, struct sockaddr *sa, socklen_t *len) {
  int ilen = (int)*len;
  int rc = getsockname((SOCKET)fd, sa, &ilen);
  *len = (socklen_t)ilen;
  if (rc != 0) {
    scr_dgram_w32_seterr();
    return -1;
  }
  return 0;
}

static int scr_dgram_w32_setsockopt(int fd, int level, int name, const void *val, socklen_t len) {
  if (setsockopt((SOCKET)fd, level, name, (const char *)val, (int)len) != 0) {
    scr_dgram_w32_seterr();
    return -1;
  }
  return 0;
}

static ssize_t scr_dgram_w32_sendto(int fd, const void *buf, size_t len, int flags,
                                     const struct sockaddr *sa, socklen_t salen) {
  int n = sendto((SOCKET)fd, (const char *)buf, len > 0x40000000 ? 0x40000000 : (int)len, flags,
                 sa, (int)salen);
  if (n < 0) scr_dgram_w32_seterr();
  return n;
}

static ssize_t scr_dgram_w32_recvfrom(int fd, void *buf, size_t len, int flags,
                                       struct sockaddr *sa, socklen_t *salen) {
  int ilen = salen != NULL ? (int)*salen : 0;
  int n = recvfrom((SOCKET)fd, (char *)buf, len > 0x40000000 ? 0x40000000 : (int)len, flags, sa,
                   salen != NULL ? &ilen : NULL);
  if (salen != NULL) *salen = (socklen_t)ilen;
  if (n < 0) scr_dgram_w32_seterr();
  return n;
}

static int scr_dgram_w32_close(int fd) {
  if (closesocket((SOCKET)fd) != 0) {
    scr_dgram_w32_seterr();
    return -1;
  }
  return 0;
}

#define socket(af, type, proto) scr_dgram_w32_socket((af), (type), (proto))
#define bind(fd, sa, len) scr_dgram_w32_bind((fd), (sa), (len))
#define connect(fd, sa, len) scr_dgram_w32_connect((fd), (sa), (len))
#define getsockname(fd, sa, len) scr_dgram_w32_getsockname((fd), (sa), (len))
#define setsockopt(fd, l, n, v, len) scr_dgram_w32_setsockopt((fd), (l), (n), (v), (len))
#define sendto(fd, buf, len, fl, sa, salen) scr_dgram_w32_sendto((fd), (buf), (len), (fl), (sa), (salen))
#define recvfrom(fd, buf, len, fl, sa, salen) scr_dgram_w32_recvfrom((fd), (buf), (len), (fl), (sa), (salen))
#define close(fd) scr_dgram_w32_close(fd)
#endif /* _WIN32 */

/* Nonblocking + no-inherit, the scr_net.c spelling. The win32 arm also
 * turns OFF winsock's UDP connection-reset relay (an ICMP port-
 * unreachable from a PAST send failing a FUTURE recvfrom with
 * WSAECONNRESET) via SIO_UDP_CONNRESET — libuv does exactly this for
 * every Node UDP socket, so leaving it on would diverge from the
 * Windows oracle. */
static void scr_dgram_nonblock_ex(int fd, int keep_connreset) {
#ifdef _WIN32
  u_long one = 1;
  ioctlsocket((SOCKET)fd, FIONBIO, &one);
  SetHandleInformation((HANDLE)(SOCKET)fd, HANDLE_FLAG_INHERIT, 0);
#ifndef SIO_UDP_CONNRESET
#define SIO_UDP_CONNRESET _WSAIOW(IOC_VENDOR, 12)
#endif
  BOOL off = FALSE;
  DWORD bytes = 0;
  /* c-ares (Node's resolver) never turns the relay off: a refused DNS server is how the winsock oracle reports ECONNREFUSED for a query */
  if (!keep_connreset) WSAIoctl((SOCKET)fd, SIO_UDP_CONNRESET, &off, sizeof off, NULL, 0, &bytes, NULL, NULL);
#else
  (void)keep_connreset;
  fcntl(fd, F_SETFL, O_NONBLOCK);
  fcntl(fd, F_SETFD, FD_CLOEXEC);
#endif
}

static void scr_dgram_nonblock(int fd) { scr_dgram_nonblock_ex(fd, 0); }

/* Node's error-code names for the socket errors this slice can meet. */
static const char *scr_dgram_errname(int err) {
  switch (err) {
  case EADDRINUSE: return "EADDRINUSE";
  case EACCES: return "EACCES";
  case EADDRNOTAVAIL: return "EADDRNOTAVAIL";
  case ECONNREFUSED: return "ECONNREFUSED";
  case EHOSTUNREACH: return "EHOSTUNREACH";
  case ENETUNREACH: return "ENETUNREACH";
  case EMSGSIZE: return "EMSGSIZE";
  case EINVAL: return "EINVAL";
  default: return "EUNKNOWN";
  }
}

/* ── listener lists (the scr_net.c snapshot discipline, restated so this
 * unit links without scr_net.c) ─────────────────────────────────────── */

typedef struct {
  ScrClosure *cb;
  void *fn;
  bool once;
} ScrDgramL;

typedef struct {
  ScrDgramL *ls;
  size_t n, cap;
} ScrDgramLs;

static void scr_dgram_ls_add(ScrDgramLs *l, ScrClosure *cb, void *fn, bool once) {
  if (l->n == l->cap) {
    l->cap = l->cap ? l->cap * 2 : 2;
    l->ls = realloc(l->ls, l->cap * sizeof *l->ls);
    if (!l->ls) scr_dgram_oom();
  }
  l->ls[l->n].cb = cb;
  l->ls[l->n].fn = fn;
  l->ls[l->n].once = once;
  l->n++;
}

static void scr_dgram_ls_drop(ScrDgramLs *l) {
  for (size_t i = 0; i < l->n; i++) scr_closure_release(l->ls[i].cb);
  free(l->ls);
  l->ls = NULL;
  l->n = l->cap = 0;
}

/* Snapshot for a firing pass: entries retained; `once` entries leave the
 * LIVE list before their callback runs. */
static size_t scr_dgram_ls_snapshot(ScrDgramLs *l, ScrDgramL **out) {
  size_t n = l->n;
  if (n == 0) {
    *out = NULL;
    return 0;
  }
  ScrDgramL *snap = malloc(n * sizeof *snap);
  if (!snap) scr_dgram_oom();
  for (size_t i = 0; i < n; i++) {
    snap[i] = l->ls[i];
    scr_closure_retain(snap[i].cb);
  }
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

static void scr_dgram_fire0(ScrDgramLs *l) {
  ScrDgramL *snap;
  size_t n = scr_dgram_ls_snapshot(l, &snap);
  for (size_t i = 0; i < n; i++) {
    if (!scr_exc_pending()) ((void (*)(ScrClosure *))snap[i].cb->fn)(snap[i].cb);
    scr_closure_release(snap[i].cb);
  }
  free(snap);
}

/* 'error' with NO listener is fatal, like Node's unhandled EventEmitter
 * 'error' (the scr_net.c stance — _Exit skips atexit on purpose). */
static void scr_dgram_fire_err(ScrDgramLs *l, ScrStr *msg) {
  if (l->n == 0) {
    fflush(stdout);
    fprintf(stderr, "Unhandled 'error' event: Error: %s\n", msg->data);
    _Exit(1);
  }
  ScrDgramL *snap;
  size_t n = scr_dgram_ls_snapshot(l, &snap);
  for (size_t i = 0; i < n; i++) {
    if (!scr_exc_pending()) ((ScrChildErrFn)snap[i].fn)(snap[i].cb, msg);
    scr_closure_release(snap[i].cb);
  }
  free(snap);
}

/* ── the handle ──────────────────────────────────────────────────────── */

struct ScrDgramSocket {
  size_t rc;
  int fd; /* -1 until bound/connected, -1 again once closed */
  bool reuse_addr;
  bool bound;
  bool connected;
  bool closing;       /* close() called; 'close' fires at the next sweep */
  bool close_emitted; /* settled: off the registry, listeners dropped */
  bool unrefed;       /* waives loop liveness, Node's unref */
  bool read_armed;
  bool emit_listening;
  bool emit_connect;
  ScrStr *pending_err; /* deferred bind/connect/send failure */
  ScrDgramLs msg_ls, err_ls, listening_ls, close_ls, conn_ls;
  bool in_registry;
  struct ScrDgramSocket *next;
};


static ScrDgramSocket *scr_dgram_socks = NULL; /* registry: +1 each, tail-appended */
static ScrPoller *scr_dgram_poller = NULL;

/* Pending dns.lookup deliveries (already resolved — getaddrinfo ran at
 * the call; the sweep fires them FIFO). */
typedef struct ScrDnsPending {
  ScrClosure *cb; /* +1 */
  ScrDnsLookupFn fn;
  ScrStr *errmsg; /* +1 or NULL (success) */
  ScrStr *addr;   /* +1 ("" on failure) */
  double family;
  bool literal; /* an IP literal (or the empty name): answered without the resolver */
  bool warn_empty; /* the first empty-hostname lookup prints DEP0118 at delivery */
  struct ScrDnsPending *next;
} ScrDnsPending;

static ScrDnsPending *scr_dns_pending = NULL;
static bool scr_dns_empty_warned = false; /* DEP0118 fires once per process */

#ifdef _WIN32
#include <process.h>
#define SCR_DNS_PID() ((long)_getpid())
#else
#define SCR_DNS_PID() ((long)getpid())
#endif

/* DEP0118 (the empty name) goes through the process warning channel, the
 * way Node's emitWarning does: 'warning' listeners receive the
 * DeprecationWarning, and the default stderr report and its one-time trace
 * hint come from scr_emit_warning (scr_async_dyn.c, linked whenever a
 * dns.lookup is in the program — cc.ts/nodes.ts moduleUsesDynAsync). */
static ScrDnsWarnHookFn scr_dns_warn_hook = NULL;

void scr_dns_set_warn_hook(ScrDnsWarnHookFn fn) { scr_dns_warn_hook = fn; }

static void scr_dns_emit_empty_warning(void) {
  static const char text[] =
      "The provided hostname \"\" is not a valid hostname, and is supported in the dns module solely for compatibility.";
  ScrStr *m = scr_str_new(text, sizeof text - 1);
  if (scr_dns_warn_hook != NULL) {
    scr_dns_warn_hook("DeprecationWarning", "DEP0118", m);
  } else {
    /* The channel is not linked: no listener can exist, so the default
     * report alone is Node's output — "(node:pid) [CODE] Name: message"
     * and the one-time trace hint. */
    scr_warn_report("DeprecationWarning", "DEP0118", text, NULL);
  }
  scr_str_release(m);
}

/* ── RC ──────────────────────────────────────────────────────────────── */

static void scr_dgram_close_fd_raw(int fd); /* forget-then-close, defined below */

ScrDgramSocket *scr_dgram_retain(ScrDgramSocket *s) {
  if (s->rc != SIZE_MAX) s->rc++;
  return s;
}

void scr_dgram_release(ScrDgramSocket *s) {
  if (!s || s->rc == SIZE_MAX) return;
  if (--s->rc == 0) {
    scr_dgram_ls_drop(&s->msg_ls);
    scr_dgram_ls_drop(&s->err_ls);
    scr_dgram_ls_drop(&s->listening_ls);
    scr_dgram_ls_drop(&s->close_ls);
    scr_dgram_ls_drop(&s->conn_ls);
    scr_str_release(s->pending_err);
    if (s->fd >= 0) scr_dgram_close_fd_raw(s->fd);
    scr_dgram_free_note();
    free(s);
  }
}

void *scr_dgram_retain_v(void *p) { return scr_dgram_retain((ScrDgramSocket *)p); }
void scr_dgram_release_v(void *p) { scr_dgram_release((ScrDgramSocket *)p); }

/* ── poller plumbing (the scr_platform.h seam; read-only subset) ─────── */

static bool scr_dgram_poller_init(void) {
  if (scr_dgram_poller != NULL) return true;
  scr_dgram_poller = scrp_poller_new();
  return scr_dgram_poller != NULL;
}

/* Registration failures ignored exactly as kevent's always were. */
static void scr_dgram_watch_read(int fd, void *udata, bool on) {
  if (scr_dgram_poller == NULL || fd < 0) return;
  (void)scrp_watch_read(scr_dgram_poller, fd, udata, on);
}

/* Forget-then-close — the epoll obligation (scr_platform.h); the kqueue
 * backend's forget is a no-op, so macOS keeps its historical sequence. */
static void scr_dgram_close_fd_raw(int fd) {
  if (fd < 0) return;
  if (scr_dgram_poller != NULL) scrp_forget(scr_dgram_poller, fd);
  close(fd);
}

/* Consumer-driven read arming (the net-socket discipline). */
static void scr_dgram_update_read(ScrDgramSocket *s) {
  bool want = s->fd >= 0 && s->msg_ls.n > 0;
  if (want && !s->read_armed) {
    scr_dgram_watch_read(s->fd, s, true);
    s->read_armed = true;
  } else if (!want && s->read_armed) {
    scr_dgram_watch_read(s->fd, s, false);
    s->read_armed = false;
  }
}

/* ── registry ────────────────────────────────────────────────────────── */

static void scr_dgram_register(ScrDgramSocket *s) {
  if (s->in_registry) return;
  s->in_registry = true;
  s->next = NULL;
  ScrDgramSocket **link = &scr_dgram_socks;
  while (*link) link = &(*link)->next;
  *link = scr_dgram_retain(s);
}

static void scr_dgram_unregister(ScrDgramSocket *s) {
  if (!s->in_registry) return;
  ScrDgramSocket **link = &scr_dgram_socks;
  while (*link && *link != s) link = &(*link)->next;
  if (*link) {
    *link = s->next;
    s->next = NULL;
    s->in_registry = false;
    scr_dgram_release(s);
  }
}

/* ── the surface ─────────────────────────────────────────────────────── */

ScrDgramSocket *scr_dgram_create(bool reuse_addr) {
  ScrDgramSocket *s = calloc(1, sizeof *s);
  if (!s) scr_dgram_oom();
  s->rc = 1;
  s->fd = -1;
  s->reuse_addr = reuse_addr;
  scr_dgram_alloc_note();
  return s;
}

static void scr_dgram_throw(const char *msg) {
  /* Node's state errors carry their ERR_SOCKET_* codes; the message IS
   * the discriminant (each arm throws exactly one text). */
  const char *code =
      strcmp(msg, "Already connected") == 0 ? "ERR_SOCKET_DGRAM_IS_CONNECTED"
      : strcmp(msg, "Not running") == 0 ? "ERR_SOCKET_DGRAM_NOT_RUNNING"
      : strcmp(msg, "Socket is already bound") == 0 ? "ERR_SOCKET_ALREADY_BOUND"
      : NULL;
  if (code != NULL) {
    scr_throw_error_msg_code(0 /* Error */, msg, strlen(msg), code);
  } else {
    scr_throw_error_msg(0 /* Error */, msg, strlen(msg));
  }
}

/* Resolve a numeric host into a sockaddr_in; "" means any (bind's
 * default), "localhost" pins to 127.0.0.1 (the net stance). False for
 * non-numeric hosts — the caller defers Node's ENOTFOUND. */
static bool scr_dgram_host4(const char *host, uint16_t port, struct sockaddr_in *out) {
  memset(out, 0, sizeof *out);
  out->sin_family = AF_INET;
  out->sin_port = htons(port);
  if (host[0] == '\0') {
    out->sin_addr.s_addr = INADDR_ANY;
    return true;
  }
  if (strcmp(host, "localhost") == 0) host = "127.0.0.1";
  return inet_pton(AF_INET, host, &out->sin_addr) == 1;
}

/* Create the fd (idempotent). Aborts only on resource exhaustion, the
 * scr_net.c socket() stance. */
static void scr_dgram_ensure_fd(ScrDgramSocket *s) {
  if (s->fd >= 0) return;
  if (!scr_dgram_poller_init()) {
    fputs("scriptc: event poller init failed\n", stderr);
    abort();
  }
  int fd = socket(AF_INET, SOCK_DGRAM, 0);
  if (fd < 0) {
    fputs("scriptc: socket() failed\n", stderr);
    abort();
  }
  scr_dgram_nonblock(fd);
  if (s->reuse_addr) {
    int one = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &one, sizeof one);
  }
  s->fd = fd;
}

static void scr_dgram_defer_err(ScrDgramSocket *s, const char *msg) {
  if (!s->pending_err) s->pending_err = scr_str_new(msg, strlen(msg));
  scr_dgram_register(s); /* the sweep delivers it */
}

/* bind(port, host): binds NOW; 'listening' (and the bind callback) defer
 * to the next dispatch pass. State errors throw synchronously, runtime
 * failures defer to 'error' — both Node's split. */
void scr_dgram_bind(ScrDgramSocket *s, double port, ScrStr *host, ScrClosure *cb) {
  if (s->closing || s->close_emitted) {
    scr_closure_release(cb);
    scr_dgram_throw("Not running");
    return;
  }
  if (s->bound) {
    scr_closure_release(cb);
    scr_dgram_throw("Socket is already bound");
    return;
  }
  if (cb) scr_dgram_ls_add(&s->listening_ls, cb, NULL, true);
  struct sockaddr_in a4;
  if (!scr_dgram_host4(host->data, (uint16_t)(int)port, &a4)) {
    char msg[160];
    snprintf(msg, sizeof msg, "getaddrinfo ENOTFOUND %s", host->data);
    scr_dgram_defer_err(s, msg);
    return;
  }
  scr_dgram_ensure_fd(s);
  if (bind(s->fd, (struct sockaddr *)&a4, sizeof a4) != 0) {
    int err = errno;
    char ip[64];
    inet_ntop(AF_INET, &a4.sin_addr, ip, sizeof ip);
    char msg[128];
    /* Node: "bind EADDRINUSE 0.0.0.0:4000" */
    snprintf(msg, sizeof msg, "bind %s %s:%d", scr_dgram_errname(err), ip, (int)port);
    close(s->fd); /* never watched: bind precedes any read arm */
    s->fd = -1;
    scr_dgram_defer_err(s, msg);
    return;
  }
  s->bound = true;
  s->emit_listening = true;
  scr_dgram_register(s);
  scr_dgram_update_read(s);
}

/* connect(port, host): implicit-binds (Node emits 'listening' for that,
 * then 'connect'); UDP connect(2) is local and immediate, so failures
 * here are deferred 'error's only for bad hosts. */
void scr_dgram_connect(ScrDgramSocket *s, double port, ScrStr *host, ScrClosure *cb) {
  if (s->closing || s->close_emitted) {
    scr_closure_release(cb);
    scr_dgram_throw("Not running");
    return;
  }
  if (s->connected) {
    scr_closure_release(cb);
    scr_dgram_throw("Already connected");
    return;
  }
  if (cb) scr_dgram_ls_add(&s->conn_ls, cb, NULL, true);
  struct sockaddr_in a4;
  if (!scr_dgram_host4(host->data, (uint16_t)(int)port, &a4) || host->len == 0) {
    char msg[160];
    snprintf(msg, sizeof msg, "getaddrinfo ENOTFOUND %s", host->data);
    scr_dgram_defer_err(s, msg);
    return;
  }
  scr_dgram_ensure_fd(s);
  if (!s->bound) {
    s->bound = true;
    s->emit_listening = true; /* Node's implicit bind emits 'listening' */
  }
  if (connect(s->fd, (struct sockaddr *)&a4, sizeof a4) != 0) {
    char msg[128];
    char ip[64];
    inet_ntop(AF_INET, &a4.sin_addr, ip, sizeof ip);
    snprintf(msg, sizeof msg, "connect %s %s:%d", scr_dgram_errname(errno), ip, (int)port);
    scr_dgram_defer_err(s, msg);
    return;
  }
  s->connected = true;
  s->emit_connect = true;
  scr_dgram_register(s);
  scr_dgram_update_read(s);
}

static void scr_dgram_send_raw(ScrDgramSocket *s, const char *data, size_t len, double port,
                                ScrStr *host) {
  if (s->closing || s->close_emitted) {
    scr_dgram_throw("Not running");
    return;
  }
  if (s->connected) {
    scr_dgram_throw("Already connected");
    return;
  }
  struct sockaddr_in a4;
  if (!scr_dgram_host4(host->data, (uint16_t)(int)port, &a4) || host->len == 0) {
    char msg[160];
    snprintf(msg, sizeof msg, "getaddrinfo ENOTFOUND %s", host->data);
    scr_dgram_defer_err(s, msg);
    return;
  }
  scr_dgram_ensure_fd(s);
  if (!s->bound) {
    /* Implicit ephemeral bind — Node's send-before-bind, 'listening'
     * emits for it there too. */
    s->bound = true;
    s->emit_listening = true;
  }
  scr_dgram_register(s); /* an open sender holds the loop, like Node */
  if (sendto(s->fd, data, len, 0, (struct sockaddr *)&a4, sizeof a4) < 0 &&
      errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
    char ip[64];
    inet_ntop(AF_INET, &a4.sin_addr, ip, sizeof ip);
    char msg[128];
    snprintf(msg, sizeof msg, "send %s %s:%d", scr_dgram_errname(errno), ip, (int)port);
    scr_dgram_defer_err(s, msg);
  }
  scr_dgram_update_read(s);
}

/* send(msg) on a CONNECTED socket -- zapo's WaSctpRelay.ts:663 spelling,
 * `conn.udpSocket.send(new Uint8Array(data))`, and the only form the FNA
 * relay path uses.
 *
 * The destination is the one connect(2) already installed, so this is
 * sendto with a NULL address rather than a second address resolution.
 * NULL/0 is the portable spelling of "use the connected peer" and rides
 * the existing win32 sendto shim, so no new shim is needed.
 *
 * On an UNCONNECTED socket Node does NOT report a connection error: it
 * validates the absent port argument first and throws
 * ERR_SOCKET_BAD_PORT "Port should be > 0 and < 65536. Received
 * undefined." (verified against node v25.9.0). Matching that exactly is
 * why this branch renders a port error rather than the "Not connected"
 * one a reader would expect. A connected socket is always bound and
 * always has an fd -- scr_dgram_connect implicit-binds -- so there is no
 * ensure_fd/bind bookkeeping here. */
static void scr_dgram_send_conn_raw(ScrDgramSocket *s, const char *data, size_t len) {
  /* ORDER MATTERS, and it is not the intuitive one. Node validates the
   * ABSENT port argument before it looks at connection or running state,
   * so a socket that is merely closed answers ERR_SOCKET_BAD_PORT rather
   * than "Not running" -- verified against node v25.9.0, where BOTH an
   * unconnected and a closed socket report
   *   RangeError [ERR_SOCKET_BAD_PORT]: Port should be > 0 and < 65536.
   *   Received undefined.
   * Checking `closing` first, which is what every other entry point in
   * this file does, would have produced a wrong answer for the closed
   * case while passing the happy path. */
  if (!s->connected) {
    static const char msg[] = "Port should be > 0 and < 65536. Received undefined.";
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, sizeof msg - 1, "ERR_SOCKET_BAD_PORT");
    return;
  }
  if (s->closing || s->close_emitted) {
    scr_dgram_throw("Not running");
    return;
  }
  scr_dgram_register(s); /* an open sender holds the loop, like Node */
  if (sendto(s->fd, data, len, 0, NULL, 0) < 0 &&
      errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR) {
    char msg[128];
    snprintf(msg, sizeof msg, "send %s", scr_dgram_errname(errno));
    scr_dgram_defer_err(s, msg);
  }
  scr_dgram_update_read(s);
}

void scr_dgram_send_conn_str(ScrDgramSocket *s, ScrStr *data) {
  scr_dgram_send_conn_raw(s, data->data, data->len);
}

void scr_dgram_send_conn_bytes(ScrDgramSocket *s, ScrBytes *data) {
  scr_dgram_send_conn_raw(s, (const char *)data->data, data->len);
}

void scr_dgram_send_str(ScrDgramSocket *s, ScrStr *data, double port, ScrStr *host) {
  scr_dgram_send_raw(s, data->data, data->len, port, host);
}

void scr_dgram_send_bytes(ScrDgramSocket *s, ScrBytes *data, double port, ScrStr *host) {
  scr_dgram_send_raw(s, (const char *)data->data, data->len, port, host);
}

/* address() parts. The ip read carries the "Not running" throw; family
 * and port only run after it succeeded. */
ScrStr *scr_dgram_addr_ip(ScrDgramSocket *s) {
  if (s->fd < 0 || !s->bound) {
    scr_dgram_throw("Not running");
    return NULL;
  }
  struct sockaddr_storage sa;
  socklen_t salen = sizeof sa;
  char ip[64] = "0.0.0.0";
  if (getsockname(s->fd, (struct sockaddr *)&sa, &salen) == 0 && sa.ss_family == AF_INET) {
    inet_ntop(AF_INET, &((struct sockaddr_in *)&sa)->sin_addr, ip, sizeof ip);
  }
  return scr_str_new(ip, strlen(ip));
}

ScrStr *scr_dgram_addr_family(ScrDgramSocket *s) {
  (void)s; /* udp4 is the one lowered type */
  return scr_str_new("IPv4", 4);
}

double scr_dgram_addr_port(ScrDgramSocket *s) {
  struct sockaddr_storage sa;
  socklen_t salen = sizeof sa;
  if (s->fd >= 0 && getsockname(s->fd, (struct sockaddr *)&sa, &salen) == 0 &&
      sa.ss_family == AF_INET) {
    return (double)ntohs(((struct sockaddr_in *)&sa)->sin_port);
  }
  return 0;
}

/* close([cb]): the fd closes NOW; 'close' (and the callback, registered
 * as once('close')) fires at the next sweep. Node throws "Not running"
 * on a second close. */
void scr_dgram_close(ScrDgramSocket *s, ScrClosure *cb) {
  if (s->closing || s->close_emitted) {
    scr_closure_release(cb);
    scr_dgram_throw("Not running");
    return;
  }
  if (cb) scr_dgram_ls_add(&s->close_ls, cb, NULL, true);
  if (s->fd >= 0) {
    scr_dgram_close_fd_raw(s->fd); /* registrations dropped, then the fd */
    s->fd = -1;
    s->read_armed = false;
  }
  s->closing = true;
  /* Move to the registry TAIL so 'close' emits in close() CALL order
   * (Node's per-close scheduled emit), not socket-creation order. The
   * caller's borrowed reference keeps the handle alive across the
   * unregister/register pair. */
  scr_dgram_unregister(s);
  scr_dgram_register(s); /* the sweep fires 'close' and settles */
}

void scr_dgram_unref(ScrDgramSocket *s) { s->unrefed = true; }
void scr_dgram_ref(ScrDgramSocket *s) { s->unrefed = false; }

void scr_dgram_on_message(ScrDgramSocket *s, ScrClosure *cb, ScrDgramMsgFn fn, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_dgram_ls_add(&s->msg_ls, cb, (void *)fn, once);
  scr_dgram_update_read(s);
}

void scr_dgram_on_error(ScrDgramSocket *s, ScrClosure *cb, ScrChildErrFn fn, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_dgram_ls_add(&s->err_ls, cb, (void *)fn, once);
}

void scr_dgram_on_listening(ScrDgramSocket *s, ScrClosure *cb, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_dgram_ls_add(&s->listening_ls, cb, NULL, once);
}

void scr_dgram_on_close(ScrDgramSocket *s, ScrClosure *cb, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_dgram_ls_add(&s->close_ls, cb, NULL, once);
}

void scr_dgram_on_connect(ScrDgramSocket *s, ScrClosure *cb, bool once) {
  if (s->close_emitted) {
    scr_closure_release(cb);
    return;
  }
  scr_dgram_ls_add(&s->conn_ls, cb, NULL, once);
}

/* The runtime-provided message adapters (msg/rinfo parts borrowed; the
 * listener owns its +1 params per the universal convention). */
void scr_dgram_msg_thunk0(ScrClosure *cb, ScrBytes *msg, ScrStr *addr, ScrStr *family,
                           double port, double size) {
  (void)msg; (void)addr; (void)family; (void)port; (void)size;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

void scr_dgram_msg_thunk1(ScrClosure *cb, ScrBytes *msg, ScrStr *addr, ScrStr *family,
                           double port, double size) {
  (void)addr; (void)family; (void)port; (void)size;
  ((void (*)(ScrClosure *, ScrBytes *))cb->fn)(cb, scr_bytes_retain(msg));
}

/* One readable wake: recvfrom until EAGAIN, one 'message' emit per
 * datagram (arrival-driven, like net's read chunks). */
static void scr_dgram_read(ScrDgramSocket *s) {
  while (s->fd >= 0 && s->msg_ls.n > 0) {
    char buf[65536];
    struct sockaddr_storage from;
    socklen_t fromlen = sizeof from;
    ssize_t n = recvfrom(s->fd, buf, sizeof buf, 0, (struct sockaddr *)&from, &fromlen);
    if (n < 0) {
      if (errno == EINTR) continue;
      return; /* EAGAIN or a transient failure: the next wake retries */
    }
    char ip[64] = "0.0.0.0";
    int rport = 0;
    if (from.ss_family == AF_INET) {
      inet_ntop(AF_INET, &((struct sockaddr_in *)&from)->sin_addr, ip, sizeof ip);
      rport = ntohs(((struct sockaddr_in *)&from)->sin_port);
    }
    ScrBytes *chunk = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)n));
    memcpy(chunk->data, buf, (size_t)n);
    ScrStr *addr = scr_str_new(ip, strlen(ip));
    ScrStr *family = scr_str_new("IPv4", 4);
    ScrDgramL *snap;
    size_t nl = scr_dgram_ls_snapshot(&s->msg_ls, &snap);
    for (size_t i = 0; i < nl; i++) {
      if (!scr_exc_pending()) {
        ((ScrDgramMsgFn)snap[i].fn)(snap[i].cb, chunk, addr, family, (double)rport, (double)n);
      }
      scr_closure_release(snap[i].cb);
    }
    free(snap);
    scr_bytes_release(chunk);
    scr_str_release(addr);
    scr_str_release(family);
    if (scr_exc_pending()) return;
    scr_dgram_update_read(s); /* a once-listener may have been the last consumer */
  }
}

/* ── dns.lookup ──────────────────────────────────────────────────────── */

/* The Error a dns.lookup failure delivers: Node's dnsException shape.
 * Message "getaddrinfo <CODE> <hostname>"; `code` = <CODE>; errno = the
 * libuv value of that code (UV_EAI_* -30xx, negative, as Node reports);
 * syscall "getaddrinfo"; hostname. The runtime hands the adapter only the
 * message (ScrDnsLookupFn), so all four are read back from it: the code is
 * the token after "getaddrinfo ", the hostname is everything after it. */
ScrError *scr_dns_error_new(ScrStr *msg /*borrowed*/) {
  ScrError *e = scr_error_new(SCR_ERR_ERROR, msg);
  const char *sp = strchr(msg->data, ' ');
  if (!sp) return e;
  const char *code = sp + 1;
  const char *end = strchr(code, ' ');
  if (!end) return e;
  size_t n = (size_t)(end - code);
  char buf[32];
  if (n == 0 || n >= sizeof buf) return e;
  memcpy(buf, code, n);
  buf[n] = '\0';
  scr_error_set_code(e, buf);
  double errno_val =
      strcmp(buf, "ENOTFOUND") == 0 ? -3008.0 /* UV_EAI_NONAME */
      : strcmp(buf, "EAI_AGAIN") == 0 ? -3001.0 /* UV_EAI_AGAIN */
      : -3004.0; /* UV_EAI_FAIL */
  scr_error_set_ext_dns(e, errno_val, "getaddrinfo", end + 1);
  return e;
}

/* dns.lookup(hostname, family, cb): family is 0 (AF_UNSPEC: Node's default),
 * 4 or 6. Node's answer for an IP LITERAL never reaches the resolver: it
 * is the hostname verbatim with the literal's own family, whatever family
 * was asked for (lib/dns.js's isIP fast path), delivered on process.nextTick
 * — so it queues AHEAD of every resolver answer of the same turn. A name
 * resolves through getaddrinfo with Node's hints (socktype STREAM, no
 * flags) and the FIRST answer in getaddrinfo's order (verbatim). */
/* The dyn dns.lookup value's extra options, read by the one resolver below at the call that sets them (and cleared after): getaddrinfo's
 * hint flags, and `all` (every address in getaddrinfo's order, delivered through the adapter as "F:address" lines, family -1). */
static int scr_dns_lookup_flags = 0;
static bool scr_dns_lookup_all = false;
/* `order` / `verbatim` of the same call: how the getaddrinfo answers are ordered before the first is taken (or `all` is built). Node 24's default
 * is verbatim (the resolver's own order); ipv4first and ipv6first are a STABLE partition by family (`verbatim: false` is ipv4first). */
#define SCR_DNS_ORDER_VERBATIM 0
#define SCR_DNS_ORDER_IPV4FIRST 1
#define SCR_DNS_ORDER_IPV6FIRST 2
static int scr_dns_lookup_order = SCR_DNS_ORDER_VERBATIM;

/* The family of one getaddrinfo answer in the order the lookup uses: 4, 6, or 0 for anything the lookup skips. */
static int scr_dns_ai_family(const struct addrinfo *a) { return a->ai_family == AF_INET6 ? 6 : a->ai_family == AF_INET ? 4 : 0; }

/* The answers of `res` that survive the lookup (families 4 and 6), stably partitioned by `order`, into `out` (capacity = their count). */
static size_t scr_dns_order_answers(struct addrinfo *res, int order, struct addrinfo **out) {
  size_t n = 0;
  int first = order == SCR_DNS_ORDER_IPV6FIRST ? 6 : 4;
  if (order == SCR_DNS_ORDER_VERBATIM) {
    for (struct addrinfo *a = res; a != NULL; a = a->ai_next) if (scr_dns_ai_family(a) != 0) out[n++] = a;
    return n;
  }
  for (struct addrinfo *a = res; a != NULL; a = a->ai_next) if (scr_dns_ai_family(a) == first) out[n++] = a;
  for (struct addrinfo *a = res; a != NULL; a = a->ai_next) if (scr_dns_ai_family(a) != 0 && scr_dns_ai_family(a) != first) out[n++] = a;
  return n;
}

void scr_dns_lookup(ScrStr *hostname, double family, ScrClosure *cb, ScrDnsLookupFn fn) {
#ifdef _WIN32
  /* getaddrinfo needs winsock started (WSANOTINITIALISED otherwise); the
   * poller owns WSAStartup on this arm, so a lookup-only program rides
   * the same init the socket paths do. */
  (void)scr_dgram_poller_init();
#endif
  ScrDnsPending *p = calloc(1, sizeof *p);
  if (!p) scr_dgram_oom();
  p->cb = cb; /* moves */
  p->fn = fn;
  p->family = 4;
  unsigned char lit[16];
  if (hostname->len == 0) {
    /* Node's lib/dns.js: an empty name is not a lookup at all. It answers
     * null (the address slot, NULL here) with the requested family's
     * default (6 for family 6, else 4) on nextTick, and warns DEP0118 once
     * per process. */
    p->family = family == 6 ? 6 : 4;
    p->literal = true;
    p->addr = NULL;
    if (scr_dns_lookup_all) {
      p->family = -1;
      p->addr = scr_str_new("", 0);
    }
    if (!scr_dns_empty_warned) {
      scr_dns_empty_warned = true;
      p->warn_empty = true;
    }
  } else if (inet_pton(AF_INET, hostname->data, lit) == 1) {
    p->family = 4;
    p->literal = true;
    p->addr = scr_str_new(hostname->data, strlen(hostname->data));
    if (scr_dns_lookup_all) {
      char line[96];
      int ln = snprintf(line, sizeof line, "4:%s", hostname->data);
      scr_str_release(p->addr);
      p->addr = scr_str_new(line, (size_t)ln);
      p->family = -1;
    }
  } else if (inet_pton(AF_INET6, hostname->data, lit) == 1) {
    p->family = 6;
    p->literal = true;
    p->addr = scr_str_new(hostname->data, strlen(hostname->data));
    if (scr_dns_lookup_all) {
      char line[96];
      int ln = snprintf(line, sizeof line, "6:%s", hostname->data);
      scr_str_release(p->addr);
      p->addr = scr_str_new(line, (size_t)ln);
      p->family = -1;
    }
  } else {
    struct addrinfo hints;
    memset(&hints, 0, sizeof hints);
    hints.ai_family = family == 6 ? AF_INET6 : family == 4 ? AF_INET : AF_UNSPEC;
    hints.ai_socktype = SOCK_STREAM;
    hints.ai_flags = scr_dns_lookup_flags;
    struct addrinfo *res = NULL;
    int rc = getaddrinfo(hostname->data, NULL, &hints, &res);
    size_t nans = 0;
    struct addrinfo **ans = NULL;
    if (rc == 0 && res) {
      for (struct addrinfo *a = res; a != NULL; a = a->ai_next) nans++;
      ans = (struct addrinfo **)malloc((nans + 1) * sizeof *ans);
      if (!ans) scr_dgram_oom();
      nans = scr_dns_order_answers(res, scr_dns_lookup_order, ans);
    }
    if (rc == 0 && res && scr_dns_lookup_all) {
      char lines[2048];
      size_t lo = 0;
      for (size_t i = 0; i < nans && lo + 80 < sizeof lines; i++) {
        const struct addrinfo *a = ans[i];
        char ip[64];
        if (a->ai_family == AF_INET6) inet_ntop(AF_INET6, &((struct sockaddr_in6 *)a->ai_addr)->sin6_addr, ip, sizeof ip);
        else inet_ntop(AF_INET, &((struct sockaddr_in *)a->ai_addr)->sin_addr, ip, sizeof ip);
        lo += (size_t)snprintf(lines + lo, sizeof lines - lo, "%s%c:%s", lo ? "\n" : "", a->ai_family == AF_INET6 ? '6' : '4', ip);
      }
      p->family = -1;
      p->addr = scr_str_new(lines, lo);
    } else if (rc == 0 && res) {
      const struct addrinfo *a = nans > 0 ? ans[0] : res;
      char ip[64] = "0.0.0.0";
      if (a->ai_family == AF_INET6) {
        inet_ntop(AF_INET6, &((struct sockaddr_in6 *)a->ai_addr)->sin6_addr, ip, sizeof ip);
        p->family = 6;
      } else {
        inet_ntop(AF_INET, &((struct sockaddr_in *)a->ai_addr)->sin_addr, ip, sizeof ip);
        p->family = 4;
      }
      p->addr = scr_str_new(ip, strlen(ip));
    } else {
      /* Node maps name-not-found (and macOS's EAI_NODATA) to ENOTFOUND;
       * everything else surfaces its EAI_* name. Message shape:
       * "getaddrinfo ENOTFOUND <hostname>". */
      const char *code =
          (rc == EAI_NONAME
#ifdef EAI_NODATA
           || rc == EAI_NODATA
#endif
           )
              ? "ENOTFOUND"
          : rc == EAI_AGAIN ? "EAI_AGAIN"
                            : "EAI_FAIL";
      char msg[192];
      snprintf(msg, sizeof msg, "getaddrinfo %s %s", code, hostname->data);
      p->errmsg = scr_str_new(msg, strlen(msg));
      p->addr = NULL; /* Node passes undefined here */
    }
    free(ans);
    if (res) freeaddrinfo(res);
  }
  /* Queue order: literals (nextTick) before resolver answers, FIFO within
   * each class. */
  ScrDnsPending **link = &scr_dns_pending;
  if (p->literal) {
    while (*link && (*link)->literal) link = &(*link)->next;
  } else {
    while (*link) link = &(*link)->next;
  }
  p->next = *link;
  *link = p;
}

void scr_dns_thunk0(ScrClosure *cb, ScrStr *errmsg, ScrStr *addr, double family) {
  (void)errmsg; (void)addr; (void)family;
  ((void (*)(ScrClosure *))cb->fn)(cb);
}

/* ── the sweep: deferred emits ───────────────────────────────────────── */

/* ── node:dns resolver — a c-ares-shaped, NON-BLOCKING DNS client ───────────
 *
 * dns.resolveSrv / Resolver#resolveSrv, dns.setServers / getServers: the query is a DNS datagram sent over a UDP socket
 * registered on THIS unit's poller (the dgram sockets' own readiness), answered or timed out through the same dispatch pass. Nothing
 * blocks the loop: a pending query holds it like an in-flight request, and the callback runs on the main stack at a dispatch turn.
 *
 *   - nameservers: /etc/resolv.conf on POSIX, GetNetworkParams (iphlpapi, loaded at run time so the link line does not change) on
 *     Windows, 127.0.0.1 when neither names one; dns.setServers / Resolver#setServers override them (Node's `ip`, `ip:port`,
 *     `[ipv6]:port` spellings; getServers prints the port only when it is not 53).
 *   - the query: header (random id, RD), one question, answered when id and the echoed question match; a reply from another
 *     address, or one whose id/question differ, is ignored (c-ares' rule).
 *   - retries: each attempt goes to the next server in turn; the wait doubles per full round of the servers (timeout, then
 *     2x, ...; `timeout` -1 is c-ares' default 5000 ms, `tries` defaults to 4); a reply with TC set retries the SAME server over TCP.
 *   - errors, Node's: ENODATA (NOERROR with no answer), ENOTFOUND (NXDOMAIN), ESERVFAIL, EREFUSED, EFORMERR, ENOTIMP,
 *     ECONNREFUSED (every attempt refused), ETIMEOUT; message "querySrv CODE host", `syscall` "querySrv", `hostname`.
 *
 * Divergence: c-ares jitters its retransmission times; ours are the plain doubling. No other resolve* record type exists here yet. */
/* A dyn string over a fresh heap string (scr_dyn_new_str retains its argument: the creation reference is dropped here). */
static ScrDyn *scr_dns_dyn_str(const char *bytes, size_t len) {
  ScrStr *t = scr_str_new(bytes, len);
  ScrDyn *d = scr_dyn_new_str(t);
  scr_str_release(t);
  return d;
}

#define SCR_DNS_MAX_SERVERS 16
#define SCR_DNS_QMAGIC 0x53444e51u /* "QNDS": tags a query among the poller's udata pointers */
#define SCR_DNS_TYPE_SRV 33

typedef struct {
  int family; /* AF_INET or AF_INET6 */
  unsigned char addr[16];
  unsigned short port;
} ScrDnsServer;

typedef struct ScrResolver {
  ScrDnsServer srv[SCR_DNS_MAX_SERVERS];
  size_t nsrv;
  bool inited; /* srv[] holds the system's (or an override) list */
  double timeout_ms; /* <= 0: the default */
  int tries;
  double max_timeout_ms; /* <= 0: none */
  bool local4_set; /* setLocalAddress: the source address the UDP and TCP sockets bind to before connect(), per family of the server (all-zero: any) */
  bool local6_set;
  unsigned char local4[4];
  unsigned char local6[16];
  ScrDyn *fn_srv; /* +1, the resolver-bound function boxes (Node binds resolveSrv/getServers to ONE resolver) */
  ScrDyn *fn_get;
  struct ScrResolver *next_alloc; /* every heap resolver, freed at exit */
} ScrResolver;

static ScrResolver scr_dns_boot_resolver = {.tries = 4};
/* Node's DEFAULT resolver: dns.setServers REPLACES it with a fresh one, and resolveSrv/getServers captured before the swap stay bound to
 * the old resolver (and its servers); a member read after the swap is bound to the new one. */
static ScrResolver *scr_dns_cur = &scr_dns_boot_resolver;
static ScrResolver *scr_dns_allocated = NULL;

/* One Node-spelled server string into a slot. False for anything isIP rejects. */
static bool scr_dns_parse_server(const char *s, ScrDnsServer *out) {
  char host[96];
  unsigned long port = 53;
  size_t n = strlen(s);
  if (n == 0 || n >= sizeof host) return false;
  if (s[0] == '[') {
    const char *rb = strchr(s, ']');
    if (!rb) return false;
    size_t hl = (size_t)(rb - s - 1);
    memcpy(host, s + 1, hl);
    host[hl] = '\0';
    if (rb[1] == ':') {
      char *end;
      port = strtoul(rb + 2, &end, 10);
      if (*end != '\0' || rb[2] == '\0') return false;
    } else if (rb[1] != '\0') {
      return false;
    }
  } else {
    memcpy(host, s, n + 1);
    const char *c1 = strchr(host, ':');
    if (c1 != NULL && strchr(c1 + 1, ':') == NULL) { /* exactly one colon: ip:port */
      char *end;
      port = strtoul(c1 + 1, &end, 10);
      if (*end != '\0' || c1[1] == '\0') return false;
      host[c1 - host] = '\0';
    }
  }
  if (port > 65535) return false;
  memset(out, 0, sizeof *out);
  out->port = (unsigned short)port;
  if (inet_pton(AF_INET, host, out->addr) == 1) {
    out->family = AF_INET;
    return true;
  }
  if (inet_pton(AF_INET6, host, out->addr) == 1) {
    out->family = AF_INET6;
    return true;
  }
  return false;
}

static void scr_dns_server_text(const ScrDnsServer *s, char *buf, size_t cap) {
  char ip[64];
  inet_ntop(s->family, s->addr, ip, sizeof ip);
  if (s->port == 53) snprintf(buf, cap, "%s", ip);
  else if (s->family == AF_INET6) snprintf(buf, cap, "[%s]:%u", ip, (unsigned)s->port);
  else snprintf(buf, cap, "%s:%u", ip, (unsigned)s->port);
}

static void scr_dns_add_server(ScrResolver *r, const char *ip) {
  if (r->nsrv >= SCR_DNS_MAX_SERVERS) return;
  char clean[96];
  size_t k = 0;
  for (; ip[k] != '\0' && ip[k] != '%' && k + 1 < sizeof clean; k++) clean[k] = ip[k];
  clean[k] = '\0';
  ScrDnsServer sv;
  if (scr_dns_parse_server(clean, &sv)) r->srv[r->nsrv++] = sv;
}

#ifdef _WIN32
#include <iptypes.h>
typedef DWORD(WINAPI *ScrGetNetworkParamsFn)(PFIXED_INFO, PULONG);
static void scr_dns_load_system_servers(ScrResolver *r) {
  HMODULE lib = LoadLibraryA("iphlpapi.dll");
  if (lib == NULL) return;
  ScrGetNetworkParamsFn fn = (ScrGetNetworkParamsFn)(void *)GetProcAddress(lib, "GetNetworkParams");
  if (fn != NULL) {
    ULONG len = 0;
    (void)fn(NULL, &len);
    if (len > 0) {
      PFIXED_INFO fi = (PFIXED_INFO)malloc(len);
      if (fi != NULL) {
        if (fn(fi, &len) == NO_ERROR) {
          for (PIP_ADDR_STRING a = &fi->DnsServerList; a != NULL; a = a->Next) {
            if (a->IpAddress.String[0] != '\0') scr_dns_add_server(r, a->IpAddress.String);
          }
        }
        free(fi);
      }
    }
  }
  FreeLibrary(lib);
}
#else
static void scr_dns_load_system_servers(ScrResolver *r) {
  FILE *f = fopen("/etc/resolv.conf", "r");
  if (f == NULL) return;
  char line[512];
  while (fgets(line, sizeof line, f) != NULL) {
    char *p = line;
    while (*p == ' ' || *p == '\t') p++;
    if (strncmp(p, "nameserver", 10) != 0 || (p[10] != ' ' && p[10] != '\t')) continue;
    p += 10;
    while (*p == ' ' || *p == '\t') p++;
    char *e = p;
    while (*e != '\0' && *e != ' ' && *e != '\t' && *e != '\r' && *e != '\n') e++;
    *e = '\0';
    if (*p != '\0') scr_dns_add_server(r, p);
  }
  fclose(f);
}
#endif

static void scr_dns_ensure_servers(ScrResolver *r) {
  if (r->inited) return;
  r->inited = true;
  r->nsrv = 0;
  scr_dns_load_system_servers(r);
  if (r->nsrv == 0) scr_dns_add_server(r, "127.0.0.1");
}

/* ── a query in flight ─────────────────────────────────────────── */
typedef struct ScrDnsQuery ScrDnsQuery;
struct ScrDnsQuery {
  unsigned magic;
  ScrDnsQuery *next;
  ScrResolver *res;
  ScrDyn *cb; /* +1, the user's callback */
  char *name; /* the hostname as given (for the error) */
  unsigned qtype;
  unsigned char q[600]; /* the query message */
  size_t qlen;
  unsigned short id;
  int attempt; /* sends so far */
  int fd;      /* -1 between attempts */
  bool tcp;
  bool connecting;
  size_t sent;                   /* tcp: bytes of the length-prefixed query written */
  unsigned char tbuf[2 + 65535]; /* tcp: the reply as it arrives (length prefix first) */
  size_t tgot;
  int last_errno; /* ECONNREFUSED tracking: the last attempt's failure */
  bool all_refused;
  const char *deferred_code; /* settle at the next dispatch turn with this error code (cancel(), an unencodable name) */
  ScrDnsServer cur;
};

static ScrDnsQuery *scr_dns_queries = NULL;

static bool scr_dns_is_query(void *udata) {
  for (ScrDnsQuery *q = scr_dns_queries; q; q = q->next) {
    if ((void *)q == udata) return true;
  }
  return false;
}

static void scr_dns_unlink(ScrDnsQuery *q) {
  for (ScrDnsQuery **l = &scr_dns_queries; *l; l = &(*l)->next) {
    if (*l == q) {
      *l = q->next;
      return;
    }
  }
}

static void scr_dns_close_sock(ScrDnsQuery *q) {
  if (q->fd >= 0) {
    scr_dgram_close_fd_raw(q->fd);
    q->fd = -1;
  }
  q->tcp = false;
  q->connecting = false;
  if (scr_dgram_poller != NULL) scrp_timer_cancel(scr_dgram_poller, q);
}

static void scr_dns_free_query(ScrDnsQuery *q) {
  scr_dns_close_sock(q);
  scr_dns_unlink(q);
  scr_dyn_release(q->cb);
  free(q->name);
  free(q);
}

/* The domain name, wire form, into out. Labels over 63 bytes or a name over 253 are refused (false). */
static bool scr_dns_encode_name(const char *name, unsigned char *out, size_t cap, size_t *len) {
  size_t o = 0;
  size_t n = strlen(name);
  if (n > 0 && name[n - 1] == '.') n--; /* a trailing dot is the root */
  if (n > 253) return false;
  size_t i = 0;
  while (i < n) {
    size_t j = i;
    while (j < n && name[j] != '.') j++;
    size_t ll = j - i;
    if (ll == 0 || ll > 63 || o + 1 + ll + 1 > cap) return false;
    out[o++] = (unsigned char)ll;
    memcpy(out + o, name + i, ll);
    o += ll;
    i = j + 1;
  }
  if (o + 1 > cap) return false;
  out[o++] = 0;
  *len = o;
  return true;
}

/* A (possibly compressed) name at msg[pos] into dotted text; returns the offset after it in the record, or 0 on a malformed one. */
static size_t scr_dns_decode_name(const unsigned char *msg, size_t msglen, size_t pos, char *out, size_t cap) {
  size_t o = 0, after = 0;
  int jumps = 0;
  bool jumped = false;
  for (;;) {
    if (pos >= msglen) return 0;
    unsigned c = msg[pos];
    if (c == 0) {
      if (!jumped) after = pos + 1;
      break;
    }
    if ((c & 0xC0) == 0xC0) {
      if (pos + 1 >= msglen) return 0;
      size_t ptr = ((c & 0x3F) << 8) | msg[pos + 1];
      if (!jumped) after = pos + 2;
      jumped = true;
      if (++jumps > 32 || ptr >= msglen) return 0;
      pos = ptr;
      continue;
    }
    if ((c & 0xC0) != 0) return 0;
    if (pos + 1 + c > msglen) return 0;
    if (o != 0 && o + 1 < cap) out[o++] = '.';
    for (unsigned k = 0; k < c; k++) {
      if (o + 1 < cap) out[o++] = (char)msg[pos + 1 + k];
    }
    pos += 1 + c;
  }
  if (cap > 0) out[o < cap ? o : cap - 1] = '\0';
  return after;
}

static unsigned scr_dns_u16(const unsigned char *p) { return ((unsigned)p[0] << 8) | p[1]; }

/* The Error a failed query delivers: message "querySrv CODE host", code, errno undefined, syscall, hostname. */
static ScrDyn *scr_dns_query_error(const char *syscall, const char *code, const char *host) {
  char msg[400];
  int n = snprintf(msg, sizeof msg, "%s %s %s", syscall, code, host);
  ScrStr *m = scr_str_new(msg, (size_t)n);
  ScrError *e = scr_error_new(SCR_ERR_ERROR, m);
  scr_str_release(m);
  scr_error_set_code(e, code);
  scr_error_set_ext_dns(e, 0, syscall, host);
  ScrDyn *d = scr_dyn_from_error(e);
  scr_error_release(e);
  scr_dyn_obj_set(d, "errno", 5, scr_dyn_undefined()); /* c-ares errors carry no libuv errno: the own key reads undefined */
  return d;
}

static void scr_dns_finish(ScrDnsQuery *q, ScrDyn *err /* +1 or NULL */, ScrDyn *result /* +1 or NULL */) {
  ScrDyn *cb = scr_dyn_retain(q->cb);
  scr_dns_free_query(q);
  ScrDyn *args[2] = {err != NULL ? err : scr_dyn_new_null(), result != NULL ? result : scr_dyn_undefined()};
  ScrDyn *r = scr_dyn_call(cb, args, 2, "the dns callback");
  scr_dyn_release(r);
  scr_dyn_release(args[0]);
  scr_dyn_release(args[1]);
  scr_dyn_release(cb);
}

static void scr_dns_try_send(ScrDnsQuery *q);

/* Parse a reply into either a result array (SRV records) or an error code. */
static ScrDyn *scr_dns_parse_srv(const unsigned char *m, size_t len, const char **errcode) {
  *errcode = NULL;
  if (len < 12) {
    *errcode = "EBADRESP";
    return NULL;
  }
  unsigned flags = scr_dns_u16(m + 2);
  unsigned rcode = flags & 0xF;
  unsigned qd = scr_dns_u16(m + 4), an = scr_dns_u16(m + 6);
  if (rcode == 1) { *errcode = "EFORMERR"; return NULL; }
  if (rcode == 2) { *errcode = "ESERVFAIL"; return NULL; }
  if (rcode == 3) { *errcode = "ENOTFOUND"; return NULL; }
  if (rcode == 4) { *errcode = "ENOTIMP"; return NULL; }
  if (rcode == 5) { *errcode = "EREFUSED"; return NULL; }
  if (rcode != 0) { *errcode = "EBADRESP"; return NULL; }
  size_t pos = 12;
  char nm[260];
  for (unsigned i = 0; i < qd; i++) {
    size_t a = scr_dns_decode_name(m, len, pos, nm, sizeof nm);
    if (a == 0 || a + 4 > len) { *errcode = "EBADRESP"; return NULL; }
    pos = a + 4;
  }
  ScrDyn *arr = scr_dyn_new_arr();
  for (unsigned i = 0; i < an; i++) {
    size_t a = scr_dns_decode_name(m, len, pos, nm, sizeof nm);
    if (a == 0 || a + 10 > len) { scr_dyn_release(arr); *errcode = "EBADRESP"; return NULL; }
    unsigned type = scr_dns_u16(m + a), rdlen = scr_dns_u16(m + a + 8);
    size_t rd = a + 10;
    if (rd + rdlen > len) { scr_dyn_release(arr); *errcode = "EBADRESP"; return NULL; }
    if (type == SCR_DNS_TYPE_SRV && rdlen >= 7) {
      char target[260];
      if (scr_dns_decode_name(m, len, rd + 6, target, sizeof target) == 0) { scr_dyn_release(arr); *errcode = "EBADRESP"; return NULL; }
      ScrDyn *o = scr_dyn_new_obj();
      scr_dyn_obj_set(o, "name", 4, scr_dns_dyn_str(target, strlen(target)));
      scr_dyn_obj_set(o, "port", 4, scr_dyn_new_num((double)scr_dns_u16(m + rd + 4)));
      scr_dyn_obj_set(o, "priority", 8, scr_dyn_new_num((double)scr_dns_u16(m + rd)));
      scr_dyn_obj_set(o, "weight", 6, scr_dyn_new_num((double)scr_dns_u16(m + rd + 2)));
      scr_dyn_obj_set(o, "type", 4, scr_dns_dyn_str("SRV", 3));
      scr_dyn_arr_push(arr, o);
    }
    pos = rd + rdlen;
  }
  if (arr->v.arr.len == 0) {
    scr_dyn_release(arr);
    *errcode = "ENODATA";
    return NULL;
  }
  return arr;
}

/* A complete reply is in hand: ours (id + question echo) settles the query; anything else is ignored. Returns true when settled. */
static bool scr_dns_handle_reply(ScrDnsQuery *q, const unsigned char *m, size_t len) {
  if (len < 12 || scr_dns_u16(m) != q->id) return false;
  if ((m[2] & 0x80) == 0) return false; /* not a response */
  if (scr_dns_u16(m + 4) != 1) return false;
  /* the question must be ours: the encoded name and the type/class */
  size_t qnl = q->qlen - 12 - 4;
  if (len < 12 + qnl + 4 || memcmp(m + 12, q->q + 12, qnl) != 0) return false;
  if (scr_dns_u16(m + 12 + qnl) != q->qtype) return false;
  const char *code = NULL;
  ScrDyn *res = scr_dns_parse_srv(m, len, &code);
  if (res != NULL) {
    scr_dns_finish(q, NULL, res);
  } else {
    scr_dns_finish(q, scr_dns_query_error("querySrv", code != NULL ? code : "EBADRESP", q->name), NULL);
  }
  return true;
}

static void scr_dns_sockaddr(const ScrDnsServer *s, struct sockaddr_storage *ss, socklen_t *sl) {
  memset(ss, 0, sizeof *ss);
  if (s->family == AF_INET6) {
    struct sockaddr_in6 *a = (struct sockaddr_in6 *)ss;
    a->sin6_family = AF_INET6;
    a->sin6_port = htons(s->port);
    memcpy(&a->sin6_addr, s->addr, 16);
    *sl = sizeof *a;
  } else {
    struct sockaddr_in *a = (struct sockaddr_in *)ss;
    a->sin_family = AF_INET;
    a->sin_port = htons(s->port);
    memcpy(&a->sin_addr, s->addr, 4);
    *sl = sizeof *a;
  }
}

/* Bind a fresh socket to the resolver's local address for the server's family (c-ares binds before connect when one is set). */
static bool scr_dns_bind_local(const ScrResolver *r, int fd, int family) {
  struct sockaddr_storage ss;
  socklen_t sl;
  memset(&ss, 0, sizeof ss);
  if (family == AF_INET6) {
    if (!r->local6_set) return true;
    struct sockaddr_in6 *a = (struct sockaddr_in6 *)&ss;
    a->sin6_family = AF_INET6;
    memcpy(&a->sin6_addr, r->local6, 16);
    sl = sizeof *a;
  } else {
    if (!r->local4_set) return true;
    struct sockaddr_in *a = (struct sockaddr_in *)&ss;
    a->sin_family = AF_INET;
    memcpy(&a->sin_addr, r->local4, 4);
    sl = sizeof *a;
  }
  return bind(fd, (struct sockaddr *)&ss, sl) == 0;
}

/* Move to the next attempt (or settle the query when the tries are spent). `refused`: the last attempt was ECONNREFUSED. */
static void scr_dns_next_attempt(ScrDnsQuery *q, bool refused) {
  scr_dns_close_sock(q);
  if (!refused) q->all_refused = false;
  scr_dns_try_send(q);
}

/* Send attempt number q->attempt: server (attempt % nsrv), round (attempt / nsrv). */
static void scr_dns_try_send(ScrDnsQuery *q) {
  ScrResolver *r = q->res;
  size_t ns = r->nsrv;
  int tries = r->tries > 0 ? r->tries : 4;
  if (ns == 0 || q->attempt >= tries * (int)ns) {
    scr_dns_finish(q, scr_dns_query_error("querySrv", q->all_refused && q->attempt > 0 ? "ECONNREFUSED" : "ETIMEOUT", q->name), NULL);
    return;
  }
  size_t idx = (size_t)q->attempt % ns;
  int round = q->attempt / (int)ns;
  q->attempt++;
  q->cur = r->srv[idx];
  if (!scr_dgram_poller_init()) {
    scr_dns_finish(q, scr_dns_query_error("querySrv", "ECONNREFUSED", q->name), NULL);
    return;
  }
  int fd = socket(q->cur.family, SOCK_DGRAM, 0);
  if (fd < 0) {
    q->all_refused = false;
    scr_dns_try_send(q);
    return;
  }
  scr_dgram_nonblock_ex(fd, 1);
  if (!scr_dns_bind_local(r, fd, q->cur.family)) { /* c-ares: an unbindable local address is a refused connection */
    scr_dgram_close_fd_raw(fd);
    scr_dns_try_send(q);
    return;
  }
  struct sockaddr_storage ss;
  socklen_t sl;
  scr_dns_sockaddr(&q->cur, &ss, &sl);
  /* connected: the kernel filters foreign senders and reports a refused port as ECONNREFUSED on the next recv */
  if (connect(fd, (struct sockaddr *)&ss, sl) != 0 || sendto(fd, (const char *)q->q, q->qlen, 0, NULL, 0) < 0) {
    scr_dgram_close_fd_raw(fd);
    q->all_refused = false;
    scr_dns_try_send(q);
    return;
  }
  q->fd = fd;
  q->tcp = false;
  (void)scrp_watch_read(scr_dgram_poller, fd, q, true);
  double base = r->timeout_ms > 0 ? r->timeout_ms : 5000.0;
  double ms = base;
  for (int i = 0; i < round; i++) ms *= 2;
  if (r->max_timeout_ms > 0 && ms > r->max_timeout_ms) ms = r->max_timeout_ms;
  (void)scrp_timer_arm(scr_dgram_poller, q, ms, q);
}

/* TC=1: the same server again over TCP (length-prefixed). */
static void scr_dns_start_tcp(ScrDnsQuery *q) {
  scr_dns_close_sock(q);
  int fd = socket(q->cur.family, SOCK_STREAM, 0);
  if (fd < 0) {
    scr_dns_next_attempt(q, false);
    return;
  }
  scr_dgram_nonblock(fd);
  if (!scr_dns_bind_local(q->res, fd, q->cur.family)) {
    scr_dgram_close_fd_raw(fd);
    scr_dns_next_attempt(q, true);
    return;
  }
  struct sockaddr_storage ss;
  socklen_t sl;
  scr_dns_sockaddr(&q->cur, &ss, &sl);
  int rc = connect(fd, (struct sockaddr *)&ss, sl);
  bool inprogress = false;
  if (rc != 0) {
    inprogress = errno == EINPROGRESS || errno == EWOULDBLOCK || errno == EAGAIN
#ifdef _WIN32
                 || errno == EALREADY
#endif
        ;
    if (!inprogress) {
      scr_dgram_close_fd_raw(fd);
      scr_dns_next_attempt(q, false);
      return;
    }
  }
  q->fd = fd;
  q->tcp = true;
  q->connecting = inprogress;
  q->sent = 0;
  q->tgot = 0;
  (void)scrp_watch_write(scr_dgram_poller, fd, q, true);
  (void)scrp_watch_read(scr_dgram_poller, fd, q, true);
  double base = q->res->timeout_ms > 0 ? q->res->timeout_ms : 5000.0;
  (void)scrp_timer_arm(scr_dgram_poller, q, base, q);
}

static void scr_dns_tcp_io(ScrDnsQuery *q, unsigned events) {
  if ((events & SCRP_WRITABLE) != 0 || q->connecting) {
    if (q->connecting) {
      int err = 0;
      socklen_t el = sizeof err;
#ifdef _WIN32
      getsockopt((SOCKET)q->fd, SOL_SOCKET, SO_ERROR, (char *)&err, &el);
#else
      getsockopt(q->fd, SOL_SOCKET, SO_ERROR, &err, &el);
#endif
      if (err != 0) {
        scr_dns_next_attempt(q, err == ECONNREFUSED);
        return;
      }
      q->connecting = false;
    }
    unsigned char out[2 + 600];
    out[0] = (unsigned char)(q->qlen >> 8);
    out[1] = (unsigned char)(q->qlen & 0xFF);
    memcpy(out + 2, q->q, q->qlen);
    size_t total = 2 + q->qlen;
    while (q->sent < total) {
      long w = (long)sendto(q->fd, (const char *)out + q->sent, total - q->sent, 0, NULL, 0);
      if (w < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) break;
        scr_dns_next_attempt(q, false);
        return;
      }
      q->sent += (size_t)w;
    }
    if (q->sent >= total && scr_dgram_poller != NULL) (void)scrp_watch_write(scr_dgram_poller, q->fd, q, false);
  }
  if ((events & SCRP_READABLE) != 0 && !q->connecting) {
    for (;;) {
      long g = (long)recvfrom(q->fd, (char *)q->tbuf + q->tgot, sizeof q->tbuf - q->tgot, 0, NULL, NULL);
      if (g < 0) {
        if (errno == EAGAIN || errno == EWOULDBLOCK) break;
        scr_dns_next_attempt(q, false);
        return;
      }
      if (g == 0) { /* closed before the whole reply */
        scr_dns_next_attempt(q, false);
        return;
      }
      q->tgot += (size_t)g;
      if (q->tgot >= 2) {
        size_t want = scr_dns_u16(q->tbuf);
        if (q->tgot >= 2 + want) {
          if (!scr_dns_handle_reply(q, q->tbuf + 2, want)) scr_dns_next_attempt(q, false);
          return;
        }
      }
    }
  }
}

/* One poller event for a query: a datagram, TCP progress, or the attempt's timer. */
static void scr_dns_on_event(ScrDnsQuery *q, unsigned events) {
  if ((events & SCRP_TIMER) != 0 && (events & (SCRP_READABLE | SCRP_WRITABLE)) == 0) {
    if (q->deferred_code != NULL) {
      scr_dns_finish(q, scr_dns_query_error("querySrv", q->deferred_code, q->name), NULL);
      return;
    }
    scr_dns_next_attempt(q, false); /* the attempt timed out */
    return;
  }
  if (q->tcp) {
    scr_dns_tcp_io(q, events);
    return;
  }
  if ((events & SCRP_READABLE) == 0) return;
  unsigned char buf[4096];
  long g = (long)recvfrom(q->fd, (char *)buf, sizeof buf, 0, NULL, NULL);
  if (g < 0) {
    if (errno == EAGAIN || errno == EWOULDBLOCK) return;
    /* ECONNREFUSED (an ICMP port-unreachable): try the next server at once. winsock relays the same ICMP as WSAECONNRESET on a connected UDP
     * socket (the relay is left on for this socket, see scr_dgram_nonblock_ex), which c-ares also reads as a refused connection. */
    int refused = errno == ECONNREFUSED;
#ifdef _WIN32
    refused = refused || errno == ECONNRESET;
#endif
    scr_dns_next_attempt(q, refused);
    if (!refused) q->all_refused = false;
    return;
  }
  if (g >= 12 && (buf[2] & 0x02) != 0 && scr_dns_u16(buf) == q->id) { /* TC: retry over TCP, same server */
    scr_dns_start_tcp(q);
    return;
  }
  (void)scr_dns_handle_reply(q, buf, (size_t)g); /* a foreign or mismatched reply is ignored; the timer still runs */
}

static bool scr_dns_random_id(unsigned short *out) {
  static unsigned s = 0;
  if (s == 0) s = (unsigned)(time(NULL) * 2654435761u) ^ (unsigned)(size_t)&s ^ 0x9e3779b9u;
  s ^= s << 13;
  s ^= s >> 17;
  s ^= s << 5;
  *out = (unsigned short)(s & 0xFFFF);
  return true;
}

/* Start an SRV query for `name`; `cb` (a function box, borrowed) gets (err, records). */
static void scr_dns_query_srv(ScrResolver *r, const char *name, ScrDyn *cb) {
  scr_dns_ensure_servers(r);
  ScrDnsQuery *q = calloc(1, sizeof *q);
  if (!q) scr_dgram_oom();
  q->magic = SCR_DNS_QMAGIC;
  q->res = r;
  q->cb = scr_dyn_retain(cb);
  q->name = strdup(name);
  q->qtype = SCR_DNS_TYPE_SRV;
  q->fd = -1;
  q->all_refused = true;
  (void)scr_dns_random_id(&q->id);
  q->q[0] = (unsigned char)(q->id >> 8);
  q->q[1] = (unsigned char)(q->id & 0xFF);
  q->q[2] = 0x01; /* RD */
  q->q[5] = 1;    /* QDCOUNT */
  size_t nl = 0;
  if (!scr_dns_encode_name(name, q->q + 12, sizeof q->q - 12 - 4, &nl)) {
    q->qlen = 0;
  } else {
    q->qlen = 12 + nl + 4;
    q->q[12 + nl] = (unsigned char)(q->qtype >> 8);
    q->q[12 + nl + 1] = (unsigned char)(q->qtype & 0xFF);
    q->q[12 + nl + 3] = 1; /* IN */
  }
  q->next = scr_dns_queries;
  scr_dns_queries = q;
  if (q->qlen == 0) {
    /* an unencodable name is answered from the next dispatch pass, ENOTFOUND-shaped like a name no server knows */
    if (!scr_dgram_poller_init()) {
      scr_dns_finish(q, scr_dns_query_error("querySrv", "EBADNAME", name), NULL);
      return;
    }
    q->deferred_code = "EBADNAME";
    (void)scrp_timer_arm(scr_dgram_poller, q, 0, q); /* the next dispatch turn settles it with the error */
    return;
  }
  scr_dns_try_send(q);
}

/* Node's "Received ..." tail for an ERR_INVALID_ARG_TYPE message. */
static void scr_dns_received(const ScrDyn *v, char *out, size_t cap) {
  if (v == NULL || v->kind == SCR_DYN_UNDEF) snprintf(out, cap, "undefined");
  else if (v->kind == SCR_DYN_NULL) snprintf(out, cap, "null");
  else if (v->kind == SCR_DYN_NUM) {
    char num[32];
    size_t n = scr_f64_to_str(v->v.num, num);
    snprintf(out, cap, "type number (%.*s)", (int)n, num);
  } else if (v->kind == SCR_DYN_BOOL) snprintf(out, cap, "type boolean (%s)", v->v.b ? "true" : "false");
  else if (v->kind == SCR_DYN_STR)
    snprintf(out, cap, "type string ('%.*s')", (int)(v->v.str->len < 28 ? v->v.str->len : 28), v->v.str->data);
  else if (v->kind == SCR_DYN_ARR) snprintf(out, cap, "an instance of Array");
  else if (v->kind == SCR_DYN_FUNC) snprintf(out, cap, "function");
  else snprintf(out, cap, "an instance of Object");
}

static void scr_dns_throw_arg(const char *argname, const char *want, const ScrDyn *got) {
  char recv[96], msg[256];
  scr_dns_received(got, recv, sizeof recv);
  int n = snprintf(msg, sizeof msg, "The \"%s\" argument must be %s. Received %s", argname, want, recv);
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)n, "ERR_INVALID_ARG_TYPE");
}

/* The loop's dispatch: route one poller event whose udata is a query. */
static bool scr_dns_route(void *udata, unsigned events) {
  if (!scr_dns_is_query(udata)) return false;
  scr_dns_on_event((ScrDnsQuery *)udata, events);
  return true;
}

static void scr_dns_cleanup_atexit(void) {
  while (scr_dns_queries) {
    ScrDnsQuery *q = scr_dns_queries;
    scr_dns_free_query(q);
  }
  scr_dyn_release(scr_dns_boot_resolver.fn_srv);
  scr_dyn_release(scr_dns_boot_resolver.fn_get);
  scr_dns_boot_resolver.fn_srv = scr_dns_boot_resolver.fn_get = NULL;
  while (scr_dns_allocated) {
    ScrResolver *r = scr_dns_allocated;
    scr_dns_allocated = r->next_alloc;
    scr_dyn_release(r->fn_srv);
    scr_dyn_release(r->fn_get);
    free(r);
  }
}

/* ── the dyn function values ─────────────────────────────────────────── */
static void *scr_dns_res_retain(void *p) { return p; }
static void scr_dns_res_release(void *p) { (void)p; }

static ScrDyn *scr_dns_resolve_srv_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  ScrDyn *name = argc > 0 ? args[0] : NULL;
  if (name == NULL || name->kind != SCR_DYN_STR) {
    scr_dns_throw_arg("name", "of type string", name);
    return NULL;
  }
  ScrDyn *cb = argc > 1 ? args[1] : NULL;
  if (cb == NULL || cb->kind != SCR_DYN_FUNC) {
    scr_dns_throw_arg("callback", "of type function", cb);
    return NULL;
  }
  ScrResolver *res = (ScrResolver *)scr_box_get_ref(clo->caps[0]);
  scr_dns_query_srv(res, name->v.str->data, cb);
  return scr_dyn_undefined();
}

/* Node's setServers validation, shared by the module function and Resolver#setServers: an Array of strings, each a valid ip[:port]. */
static bool scr_dns_parse_server_list(ScrDyn *list, ScrDnsServer *tmp, size_t *count) {
  if (list == NULL || list->kind != SCR_DYN_ARR) {
    scr_dns_throw_arg("servers", "an instance of Array", list);
    return false;
  }
  size_t n = 0;
  for (size_t i = 0; i < list->v.arr.len && n < SCR_DNS_MAX_SERVERS; i++) {
    ScrDyn *it = list->v.arr.items[i];
    if (it->kind != SCR_DYN_STR) {
      char nm[40];
      snprintf(nm, sizeof nm, "servers[%zu]", i);
      scr_dns_throw_arg(nm, "of type string", it);
      return false;
    }
    if (!scr_dns_parse_server(it->v.str->data, &tmp[n])) {
      char msg[200];
      int ml = snprintf(msg, sizeof msg, "Invalid IP address: %s", it->v.str->data);
      scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)ml, "ERR_INVALID_IP_ADDRESS");
      return false;
    }
    n++;
  }
  *count = n;
  return true;
}

static ScrDyn *scr_dns_set_servers_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDnsServer tmp[SCR_DNS_MAX_SERVERS];
  size_t n = 0;
  if (!scr_dns_parse_server_list(argc > 0 ? args[0] : NULL, tmp, &n)) return NULL;
  ScrResolver *nr = (ScrResolver *)calloc(1, sizeof *nr);
  if (!nr) scr_dgram_oom();
  nr->tries = scr_dns_cur->tries;
  nr->timeout_ms = scr_dns_cur->timeout_ms;
  nr->max_timeout_ms = scr_dns_cur->max_timeout_ms;
  memcpy(nr->srv, tmp, n * sizeof tmp[0]);
  nr->nsrv = n;
  nr->inited = true;
  nr->next_alloc = scr_dns_allocated;
  scr_dns_allocated = nr;
  scr_dns_cur = nr; /* the DEFAULT resolver is replaced; functions bound to the old one keep it */
  return scr_dyn_undefined();
}

static ScrDyn *scr_dns_get_servers_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)args; (void)argc;
  ScrResolver *res = (ScrResolver *)scr_box_get_ref(clo->caps[0]);
  scr_dns_ensure_servers(res);
  ScrDyn *arr = scr_dyn_new_arr();
  for (size_t i = 0; i < res->nsrv; i++) {
    char buf[96];
    scr_dns_server_text(&res->srv[i], buf, sizeof buf);
    scr_dyn_arr_push(arr, scr_dns_dyn_str(buf, strlen(buf)));
  }
  return arr;
}

static ScrClosure scr_dns_set_servers_clo = {SIZE_MAX, (void *)scr_dns_set_servers_thunk, 0, NULL, NULL};

/* A function box bound to one resolver: its closure carries the resolver pointer. */
static ScrDyn *scr_dns_bound_fn(ScrResolver *r, ScrDynThunk thunk, uint32_t arity, const char *sig, const char *name) {
  ScrClosure *c = scr_closure_new((void *)thunk, 1);
  c->caps[0] = scr_box_new_obj(scr_dns_res_retain, scr_dns_res_release, NULL);
  scr_box_set_ref(c->caps[0], r);
  return scr_dyn_new_func(c, thunk, arity, sig, name);
}

ScrDyn *scr_dns_resolve_srv_dyn_value(void) {
  scr_dgram_install();
  ScrResolver *r = scr_dns_cur;
  if (r->fn_srv == NULL) r->fn_srv = scr_dns_bound_fn(r, scr_dns_resolve_srv_thunk, 2, "(name,callback)", "bound querySrv");
  return scr_dyn_retain(r->fn_srv);
}
ScrDyn *scr_dns_set_servers_dyn_value(void) {
  return scr_dyn_new_func(&scr_dns_set_servers_clo, scr_dns_set_servers_thunk, 1, "(servers)", "setServers");
}
ScrDyn *scr_dns_get_servers_dyn_value(void) {
  ScrResolver *r = scr_dns_cur;
  if (r->fn_get == NULL) r->fn_get = scr_dns_bound_fn(r, scr_dns_get_servers_thunk, 0, "()", "bound getServers");
  return scr_dyn_retain(r->fn_get);
}


/* ── new dns.Resolver(options) ───────────────────────────────────────────────────────────────────────────────────────
 * A constructible native function whose instances carry one resolver (`_handle`, Node's one own key) and whose prototype holds the methods:
 * resolveSrv / getServers / setServers / cancel. setServers here edits THIS resolver; the module-level dns.setServers replaces the default
 * one (above). Options: timeout (>= -1), tries (>= 1), maxTimeout (>= -1), validated with Node's messages. */
static ScrDyn *scr_dns_resolver_ctor_box = NULL;

static bool scr_dns_int_option(ScrDyn *opts, const char *key, double min, double *out, bool *present) {
  *present = false;
  ScrDyn *v = scr_dyn_obj_get(opts, key, strlen(key));
  if (v == NULL || v->kind == SCR_DYN_UNDEF) return true;
  char nm[48];
  snprintf(nm, sizeof nm, "options.%s", key);
  char msg[200];
  if (v->kind != SCR_DYN_NUM) {
    char recv[96];
    scr_dns_received(v, recv, sizeof recv);
    int n = snprintf(msg, sizeof msg, "The \"%s\" property must be of type number. Received %s", nm, recv);
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)n, "ERR_INVALID_ARG_TYPE");
    return false;
  }
  double d = v->v.num;
  if (d != (double)(long long)d) {
    int n = snprintf(msg, sizeof msg, "The value of \"%s\" is out of range. It must be an integer. Received %g", nm, d);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
    return false;
  }
  if (d < min || d > 2147483647.0) {
    int n = snprintf(msg, sizeof msg, "The value of \"%s\" is out of range. It must be >= %g && <= 2147483647. Received %g", nm, min, d);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
    return false;
  }
  *out = d;
  *present = true;
  return true;
}

static ScrResolver *scr_dns_resolver_this(void) {
  ScrDyn *self = scr_dyn_this_get();
  ScrResolver *r = NULL;
  if (self != NULL && self->kind == SCR_DYN_OBJ) {
    ScrDyn *h = scr_dyn_obj_get(self, "_handle", 7);
    if (h != NULL && h->kind == SCR_DYN_NUM) r = (ScrResolver *)(uintptr_t)(unsigned long long)h->v.num;
  }
  scr_dyn_release(self);
  if (r == NULL) {
    static const char msg[] = "Illegal invocation";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_INVALID_THIS");
  }
  return r;
}

static ScrDyn *scr_dns_resolver_ctor_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *self = scr_dyn_this_get();
  ScrDyn *opts = argc > 0 ? args[0] : NULL;
  if (opts != NULL && opts->kind != SCR_DYN_UNDEF && opts->kind != SCR_DYN_OBJ) {
    scr_dyn_release(self);
    scr_dns_throw_arg("options", "of type object", opts);
    return NULL;
  }
  ScrResolver *r = (ScrResolver *)calloc(1, sizeof *r);
  if (!r) scr_dgram_oom();
  r->tries = 4;
  if (opts != NULL && opts->kind == SCR_DYN_OBJ) {
    double d;
    bool has;
    if (!scr_dns_int_option(opts, "timeout", -1, &d, &has)) { free(r); scr_dyn_release(self); return NULL; }
    if (has) r->timeout_ms = d;
    if (!scr_dns_int_option(opts, "tries", 1, &d, &has)) { free(r); scr_dyn_release(self); return NULL; }
    if (has) r->tries = (int)d;
    if (!scr_dns_int_option(opts, "maxTimeout", -1, &d, &has)) { free(r); scr_dyn_release(self); return NULL; }
    if (has) r->max_timeout_ms = d;
  }
  r->next_alloc = scr_dns_allocated;
  scr_dns_allocated = r;
  if (self != NULL && self->kind == SCR_DYN_OBJ) scr_dyn_obj_set(self, "_handle", 7, scr_dyn_new_num((double)(unsigned long long)(uintptr_t)r));
  scr_dyn_release(self);
  return scr_dyn_undefined();
}

static ScrDyn *scr_dns_resolver_resolve_srv(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrResolver *r = scr_dns_resolver_this();
  if (r == NULL) return NULL;
  ScrDyn *name = argc > 0 ? args[0] : NULL;
  if (name == NULL || name->kind != SCR_DYN_STR) {
    scr_dns_throw_arg("name", "of type string", name);
    return NULL;
  }
  ScrDyn *cb = argc > 1 ? args[1] : NULL;
  if (cb == NULL || cb->kind != SCR_DYN_FUNC) {
    scr_dns_throw_arg("callback", "of type function", cb);
    return NULL;
  }
  scr_dns_query_srv(r, name->v.str->data, cb);
  return scr_dyn_undefined();
}

static ScrDyn *scr_dns_resolver_get_servers(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrResolver *r = scr_dns_resolver_this();
  if (r == NULL) return NULL;
  scr_dns_ensure_servers(r);
  ScrDyn *arr = scr_dyn_new_arr();
  for (size_t i = 0; i < r->nsrv; i++) {
    char buf[96];
    scr_dns_server_text(&r->srv[i], buf, sizeof buf);
    scr_dyn_arr_push(arr, scr_dns_dyn_str(buf, strlen(buf)));
  }
  return arr;
}

static ScrDyn *scr_dns_resolver_set_servers(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrResolver *r = scr_dns_resolver_this();
  if (r == NULL) return NULL;
  ScrDnsServer tmp[SCR_DNS_MAX_SERVERS];
  size_t n = 0;
  if (!scr_dns_parse_server_list(argc > 0 ? args[0] : NULL, tmp, &n)) return NULL;
  memcpy(r->srv, tmp, n * sizeof tmp[0]);
  r->nsrv = n;
  r->inited = true;
  return scr_dyn_undefined();
}

/* cancel(): every query of this resolver settles with ECANCELLED at the next dispatch turn (Node's callbacks never run inside the call). */
static ScrDyn *scr_dns_resolver_cancel(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo; (void)args; (void)argc;
  ScrResolver *r = scr_dns_resolver_this();
  if (r == NULL) return NULL;
  /* the registry is newest-first: arm the oldest query's timer first so the callbacks run in the order the queries were made */
  size_t cnt = 0;
  for (ScrDnsQuery *q = scr_dns_queries; q; q = q->next) cnt++;
  ScrDnsQuery **all = (ScrDnsQuery **)malloc((cnt + 1) * sizeof *all);
  if (!all) scr_dgram_oom();
  size_t k = 0;
  for (ScrDnsQuery *q = scr_dns_queries; q; q = q->next) all[k++] = q;
  for (size_t i = cnt; i > 0; i--) {
    ScrDnsQuery *q = all[i - 1];
    if (q->res != r || q->deferred_code != NULL) continue;
    scr_dns_close_sock(q); /* drops the socket, its watches and the attempt timer */
    q->deferred_code = "ECANCELLED";
    (void)scrp_timer_arm(scr_dgram_poller, q, 0, q);
  }
  free(all);
  return scr_dyn_undefined();
}

/* uv_inet_pton as Node's SetLocalAddress reads an address: dotted IPv4, else IPv6 with libuv's `%zone` suffix dropped. */
static int scr_dns_pton_local(const char *s, unsigned char out[16]) {
  if (inet_pton(AF_INET, s, out) == 1) return AF_INET;
  char tmp[64];
  const char *z = strchr(s, '%');
  if (z != NULL) {
    size_t n = (size_t)(z - s);
    if (n >= sizeof tmp) return 0;
    memcpy(tmp, s, n);
    tmp[n] = '\0';
    s = tmp;
  }
  if (inet_pton(AF_INET6, s, out) == 1) return AF_INET6;
  return 0;
}

static void scr_dns_throw_value(const char *msg) {
  scr_throw_error_msg_code(SCR_ERR_TYPE, msg, strlen(msg), "ERR_INVALID_ARG_VALUE");
}

/* setLocalAddress(ipv4[, ipv6]): Node's validation (JS strings, then the binding's address checks, in its order: the first address is applied
 * before the second is read) and c-ares' effect (every later UDP and TCP socket of this resolver binds the family's address before connect). */
static ScrDyn *scr_dns_resolver_set_local(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrResolver *r = scr_dns_resolver_this();
  if (r == NULL) return NULL;
  ScrDyn *a0 = argc > 0 ? args[0] : NULL;
  if (a0 == NULL || a0->kind != SCR_DYN_STR) {
    scr_dns_throw_arg("ipv4", "of type string", a0);
    return NULL;
  }
  ScrDyn *a1 = argc > 1 && args[1] != NULL && args[1]->kind != SCR_DYN_UNDEF ? args[1] : NULL;
  if (a1 != NULL && a1->kind != SCR_DYN_STR) {
    scr_dns_throw_arg("ipv6", "of type string", a1);
    return NULL;
  }
  unsigned char b0[16], b1[16];
  int f0 = scr_dns_pton_local(a0->v.str->data, b0);
  if (f0 == 0) {
    scr_dns_throw_value("Invalid IP address.");
    return NULL;
  }
  if (f0 == AF_INET) {
    memcpy(r->local4, b0, 4);
    r->local4_set = (b0[0] | b0[1] | b0[2] | b0[3]) != 0;
  } else {
    memcpy(r->local6, b0, 16);
    unsigned char any = 0;
    for (int i = 0; i < 16; i++) any |= b0[i];
    r->local6_set = any != 0;
  }
  if (a1 == NULL) { /* no second address: the other family goes back to any */
    if (f0 == AF_INET) {
      memset(r->local6, 0, 16);
      r->local6_set = false;
    } else {
      memset(r->local4, 0, 4);
      r->local4_set = false;
    }
    return scr_dyn_undefined();
  }
  int f1 = scr_dns_pton_local(a1->v.str->data, b1);
  if (f1 == 0) {
    scr_dns_throw_value("Invalid IP address.");
    return NULL;
  }
  if (f1 == f0) {
    scr_dns_throw_value(f1 == AF_INET ? "Cannot specify two IPv4 addresses." : "Cannot specify two IPv6 addresses.");
    return NULL;
  }
  if (f1 == AF_INET) {
    memcpy(r->local4, b1, 4);
    r->local4_set = (b1[0] | b1[1] | b1[2] | b1[3]) != 0;
  } else {
    memcpy(r->local6, b1, 16);
    unsigned char any = 0;
    for (int i = 0; i < 16; i++) any |= b1[i];
    r->local6_set = any != 0;
  }
  return scr_dyn_undefined();
}

static ScrClosure scr_dns_resolver_srv_clo = {SIZE_MAX, (void *)scr_dns_resolver_resolve_srv, 0, NULL, NULL};
static ScrClosure scr_dns_resolver_get_clo = {SIZE_MAX, (void *)scr_dns_resolver_get_servers, 0, NULL, NULL};
static ScrClosure scr_dns_resolver_set_clo = {SIZE_MAX, (void *)scr_dns_resolver_set_servers, 0, NULL, NULL};
static ScrClosure scr_dns_resolver_cancel_clo = {SIZE_MAX, (void *)scr_dns_resolver_cancel, 0, NULL, NULL};
static ScrClosure scr_dns_resolver_local_clo = {SIZE_MAX, (void *)scr_dns_resolver_set_local, 0, NULL, NULL};

static void scr_dns_resolver_teardown(void) {
  scr_dyn_release(scr_dns_resolver_ctor_box);
  scr_dns_resolver_ctor_box = NULL;
}

ScrDyn *scr_dns_resolver_ctor_dyn_value(void) {
  scr_dgram_install();
  if (scr_dns_resolver_ctor_box == NULL) {
    /* a HEAP closure: the function's minted prototype is owned by its closure (an immortal one would keep it past the exit audit) */
    ScrClosure *ctor_clo = scr_closure_new((void *)scr_dns_resolver_ctor_thunk, 0);
    ScrDyn *f = scr_dyn_new_func_src(ctor_clo, scr_dns_resolver_ctor_thunk, 1, "(options)", "Resolver",
                                     "class Resolver extends ResolverBase {}");
    ScrDyn *proto = scr_dyn_fn_prototype(f); /* +1 */
    scr_dyn_obj_set_present(proto, "resolveSrv", 10,
                            scr_dyn_new_func(&scr_dns_resolver_srv_clo, scr_dns_resolver_resolve_srv, 2, "(name,callback)", "querySrv"));
    scr_dyn_obj_set_present(proto, "getServers", 10,
                            scr_dyn_new_func(&scr_dns_resolver_get_clo, scr_dns_resolver_get_servers, 0, "()", "getServers"));
    scr_dyn_obj_set_present(proto, "setServers", 10,
                            scr_dyn_new_func(&scr_dns_resolver_set_clo, scr_dns_resolver_set_servers, 1, "(servers)", "setServers"));
    scr_dyn_obj_set_present(proto, "cancel", 6,
                            scr_dyn_new_func(&scr_dns_resolver_cancel_clo, scr_dns_resolver_cancel, 0, "()", "cancel"));
    scr_dyn_obj_set_present(proto, "setLocalAddress", 15,
                            scr_dyn_new_func(&scr_dns_resolver_local_clo, scr_dns_resolver_set_local, 2, "(ipv4,ipv6)", "setLocalAddress"));
    scr_dyn_release(proto);
    scr_dns_resolver_ctor_box = f;
    atexit(scr_dns_resolver_teardown);
  }
  return scr_dyn_retain(scr_dns_resolver_ctor_box);
}

/* ── dns.lookup as a value: the existing getaddrinfo entry, behind the runtime's function box ──────────────────────────────── */
static void scr_dns_dyn_lookup_fn(ScrClosure *clo, ScrStr *errmsg, ScrStr *addr, double family) {
  ScrDyn *cb = (ScrDyn *)scr_box_get_ref(clo->caps[0]); /* +1 */
  ScrDyn *args[3];
  size_t argc = 1;
  if (errmsg != NULL) {
    ScrError *e = scr_dns_error_new(errmsg);
    args[0] = scr_dyn_from_error(e);
    scr_error_release(e);
  } else {
    args[0] = scr_dyn_new_null();
  }
  if (family < 0) { /* `all`: "F:address" lines */
    ScrDyn *arr = scr_dyn_new_arr();
    if (addr != NULL) {
      const char *p = addr->data;
      while (*p != '\0') {
        const char *nl = strchr(p, '\n');
        size_t ll = nl != NULL ? (size_t)(nl - p) : strlen(p);
        if (ll > 2) {
          ScrDyn *o = scr_dyn_new_obj();
          scr_dyn_obj_set(o, "address", 7, scr_dns_dyn_str(p + 2, ll - 2));
          scr_dyn_obj_set(o, "family", 6, scr_dyn_new_num(p[0] == '6' ? 6 : 4));
          scr_dyn_arr_push(arr, o);
        }
        p += ll + (nl != NULL ? 1 : 0);
      }
    }
    args[1] = arr;
    argc = errmsg != NULL ? 1 : 2;
  } else if (errmsg != NULL) {
    argc = 1;
  } else {
    args[1] = addr != NULL ? scr_dyn_new_str(addr) : scr_dyn_new_null();
    args[2] = scr_dyn_new_num(family);
    argc = 3;
  }
  ScrDyn *r = scr_dyn_call(cb, args, argc, "the dns.lookup callback");
  scr_dyn_release(r);
  for (size_t i = 0; i < argc; i++) scr_dyn_release(args[i]);
  scr_dyn_release(cb);
}

static ScrDyn *scr_dns_lookup_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  ScrDyn *host = argc > 0 ? args[0] : NULL;
  ScrDyn *opt = argc > 1 ? args[1] : NULL;
  ScrDyn *cb = argc > 2 ? args[2] : NULL;
  if (opt != NULL && opt->kind == SCR_DYN_FUNC) { /* lookup(hostname, callback) */
    cb = opt;
    opt = NULL;
  }
  double family = 0;
  int flags = 0;
  bool all = false;
  int order = SCR_DNS_ORDER_VERBATIM;
  if (opt != NULL && opt->kind == SCR_DYN_NUM) {
    family = opt->v.num;
  } else if (opt != NULL && opt->kind == SCR_DYN_OBJ) {
    ScrDyn *f = scr_dyn_obj_get(opt, "family", 6);
    if (f != NULL && f->kind == SCR_DYN_NUM) family = f->v.num;
    else if (f != NULL && f->kind == SCR_DYN_STR) family = strcmp(f->v.str->data, "IPv6") == 0 ? 6 : strcmp(f->v.str->data, "IPv4") == 0 ? 4 : 0;
    ScrDyn *h = scr_dyn_obj_get(opt, "hints", 5);
    if (h != NULL && h->kind == SCR_DYN_NUM) flags = (int)h->v.num;
    ScrDyn *a = scr_dyn_obj_get(opt, "all", 3);
    if (a != NULL && a->kind == SCR_DYN_BOOL) all = a->v.b;
    /* lib/dns.js: `order` must be one of the three (null/undefined are absent), `verbatim` a boolean whenever present; `order` wins when
     * both are given, `verbatim: false` is ipv4first and `verbatim: true` verbatim. */
    ScrDyn *o = scr_dyn_obj_get(opt, "order", 5);
    bool has_order = o != NULL && o->kind != SCR_DYN_UNDEF && o->kind != SCR_DYN_NULL;
    if (has_order) {
      const char *os = o->kind == SCR_DYN_STR ? o->v.str->data : NULL;
      if (os != NULL && strcmp(os, "verbatim") == 0) order = SCR_DNS_ORDER_VERBATIM;
      else if (os != NULL && strcmp(os, "ipv4first") == 0) order = SCR_DNS_ORDER_IPV4FIRST;
      else if (os != NULL && strcmp(os, "ipv6first") == 0) order = SCR_DNS_ORDER_IPV6FIRST;
      else {
        char rbuf[256], msg[400];
        int n = snprintf(msg, sizeof msg, "The property 'options.order' must be one of: 'verbatim', 'ipv4first', 'ipv6first'. Received %s",
                         scr_dyn_inspect_lite(o, rbuf, sizeof rbuf));
        scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)n, "ERR_INVALID_ARG_VALUE");
        return NULL;
      }
    }
    ScrDyn *vb = scr_dyn_obj_get(opt, "verbatim", 8);
    if (vb != NULL && vb->kind != SCR_DYN_UNDEF && vb->kind != SCR_DYN_NULL) {
      if (vb->kind != SCR_DYN_BOOL) {
        scr_dyn_prop_type_fail("options.verbatim", "of type boolean", vb);
        return NULL;
      }
      if (!has_order) order = vb->v.b ? SCR_DNS_ORDER_VERBATIM : SCR_DNS_ORDER_IPV4FIRST;
    }
  }
  if (family != 0 && family != 4 && family != 6) {
    char msg[120];
    int n = snprintf(msg, sizeof msg, "The property 'options.family' must be one of: 0, 4, 6. Received %g", family);
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)n, "ERR_INVALID_ARG_VALUE");
    return NULL;
  }
  if (host != NULL && host->kind != SCR_DYN_STR && !(host->kind == SCR_DYN_UNDEF || host->kind == SCR_DYN_NULL)) {
    scr_dns_throw_arg("hostname", "of type string", host);
    return NULL;
  }
  if (cb == NULL || cb->kind != SCR_DYN_FUNC) {
    scr_dns_throw_arg("callback", "of type function", cb);
    return NULL;
  }
  ScrStr *hs = host != NULL && host->kind == SCR_DYN_STR ? scr_str_retain(host->v.str) : scr_str_new("", 0);
  ScrClosure *c = scr_closure_new((void *)scr_dns_dyn_lookup_fn, 1);
  c->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(c->caps[0], scr_dyn_retain(cb));
  scr_dns_lookup_flags = flags;
  scr_dns_lookup_all = all;
  scr_dns_lookup_order = order;
  scr_dns_lookup(hs, family, c, scr_dns_dyn_lookup_fn);
  scr_dns_lookup_flags = 0;
  scr_dns_lookup_all = false;
  scr_dns_lookup_order = SCR_DNS_ORDER_VERBATIM;
  scr_str_release(hs);
  return scr_dyn_undefined();
}
static ScrClosure scr_dns_lookup_clo = {SIZE_MAX, (void *)scr_dns_lookup_thunk, 0, NULL, NULL};
ScrDyn *scr_dns_lookup_dyn_value(void) {
  scr_dgram_install();
  return scr_dyn_new_func(&scr_dns_lookup_clo, scr_dns_lookup_thunk, 3, "(hostname,options,callback)", "lookup");
}

static bool scr_dgram_flags_pending(void) {
  if (scr_dns_pending) return true;
  for (ScrDgramSocket *s = scr_dgram_socks; s; s = s->next) {
    if (s->pending_err || s->emit_listening || s->emit_connect) return true;
    if (s->closing && !s->close_emitted) return true;
  }
  return false;
}

static void scr_dgram_sweep(void) {
  ScrDgramSocket *s = scr_dgram_socks;
  while (s) {
    ScrDgramSocket *next = s->next; /* may unregister below */
    scr_dgram_retain(s);           /* callbacks may drop every other ref */
    if (s->emit_listening) {
      s->emit_listening = false;
      scr_dgram_fire0(&s->listening_ls);
      if (scr_exc_pending()) {
        scr_dgram_release(s);
        return;
      }
    }
    if (s->emit_connect) {
      s->emit_connect = false;
      scr_dgram_fire0(&s->conn_ls);
      if (scr_exc_pending()) {
        scr_dgram_release(s);
        return;
      }
    }
    if (s->pending_err) {
      ScrStr *msg = s->pending_err;
      s->pending_err = NULL;
      scr_dgram_fire_err(&s->err_ls, msg);
      scr_str_release(msg);
      if (scr_exc_pending()) {
        scr_dgram_release(s);
        return;
      }
      /* A failed bind/connect/send on a never-opened socket leaves it
       * inert: if nothing keeps it live (not bound, not closing), settle
       * it off the registry so the loop can drain — pre-failure
       * listeners drop, the net failed-listen stance. */
      if (s->fd < 0 && !s->closing && !s->close_emitted) {
        s->close_emitted = true;
        scr_dgram_ls_drop(&s->msg_ls);
        scr_dgram_ls_drop(&s->err_ls);
        scr_dgram_ls_drop(&s->listening_ls);
        scr_dgram_ls_drop(&s->close_ls);
        scr_dgram_ls_drop(&s->conn_ls);
        scr_dgram_unregister(s);
        if (scr_exc_pending()) {
          scr_dgram_release(s);
          return;
        }
      }
    }
    if (s->closing && !s->close_emitted) {
      s->close_emitted = true;
      scr_dgram_fire0(&s->close_ls);
      /* settle: listeners drop (the cycle story), off the registry */
      scr_dgram_ls_drop(&s->msg_ls);
      scr_dgram_ls_drop(&s->err_ls);
      scr_dgram_ls_drop(&s->listening_ls);
      scr_dgram_ls_drop(&s->close_ls);
      scr_dgram_ls_drop(&s->conn_ls);
      scr_dgram_unregister(s);
      if (scr_exc_pending()) {
        scr_dgram_release(s);
        return;
      }
    }
    scr_dgram_release(s);
    s = next;
  }
  /* dns deliveries AFTER the socket emits: Node's numeric/nextTick-ish
   * bind emits land before a threadpool lookup's completion — the
   * observed interleave the differential fixtures pin. */
  while (scr_dns_pending) {
    ScrDnsPending *p = scr_dns_pending;
    scr_dns_pending = p->next;
    if (p->warn_empty) scr_dns_emit_empty_warning();
    if (!scr_exc_pending()) p->fn(p->cb, p->errmsg, p->addr, p->family);
    scr_closure_release(p->cb);
    scr_str_release(p->errmsg);
    scr_str_release(p->addr);
    free(p);
    if (scr_exc_pending()) return;
  }
}

/* ── the loop hooks (scr_async.c) ────────────────────────────────────── */

static bool scr_dgram_pending(void) {
  if (scr_dns_pending || scr_dns_queries) return true;
  for (ScrDgramSocket *s = scr_dgram_socks; s; s = s->next) {
    /* Undelivered emits hold the loop even on an unref'd socket (they
     * are due NOW); otherwise an open registered socket holds it unless
     * unref() waived that — Node's unref semantics. */
    if (s->pending_err || s->emit_listening || s->emit_connect ||
        (s->closing && !s->close_emitted)) {
      return true;
    }
    if (!s->unrefed) return true;
  }
  return false;
}

static int scr_dgram_pollfd(void) {
  return scr_dgram_poller != NULL ? scrp_poller_fd(scr_dgram_poller) : -1;
}

static void scr_dgram_dispatch(void) {
  if (!scr_dgram_socks && !scr_dns_pending && !scr_dns_queries) return;
  for (;;) {
    scr_dgram_sweep();
    if (scr_exc_pending()) return;
    if (scr_dgram_poller == NULL) return;
    ScrPollerEvent evs[64];
    int n = scrp_drain(scr_dgram_poller, evs, 64);
    for (int i = 0; i < n; i++) {
      /* one macrotask boundary per delivered datagram batch entry (Node's
       * MakeCallback scope close): the ticks and jobs before the next one */
      if (i > 0) {
        scr_loop_drain_callback();
        if (scr_loop_stopping()) return;
      }
      if (scr_dns_route(evs[i].udata, evs[i].events)) {
        if (scr_exc_pending()) return;
        continue;
      }
      ScrDgramSocket *s = (ScrDgramSocket *)evs[i].udata;
      if (!s || s->fd < 0) continue; /* closed earlier in this batch */
      scr_dgram_read(s);
      if (scr_exc_pending()) return;
    }
    if (n > 0) {
      scr_loop_drain_callback();
      if (scr_loop_stopping()) return;
    }
    if (!scr_dgram_flags_pending()) return;
    if (scr_loop_has_ready()) return; /* microtasks interleave first */
  }
}

/* Exit-time registry cleanup (the scr_net.c precedent): sockets a
 * program legitimately leaves live at exit release their listeners and
 * registry references so the RC audit sees a clean heap. */
static void scr_dgram_cleanup_atexit(void) {
  scr_dns_cleanup_atexit();
  while (scr_dgram_socks) {
    ScrDgramSocket *s = scr_dgram_socks;
    scr_dgram_ls_drop(&s->msg_ls);
    scr_dgram_ls_drop(&s->err_ls);
    scr_dgram_ls_drop(&s->listening_ls);
    scr_dgram_ls_drop(&s->close_ls);
    scr_dgram_ls_drop(&s->conn_ls);
    scr_dgram_unregister(s);
  }
  while (scr_dns_pending) {
    ScrDnsPending *p = scr_dns_pending;
    scr_dns_pending = p->next;
    scr_closure_release(p->cb);
    scr_str_release(p->errmsg);
    scr_str_release(p->addr);
    free(p);
  }
}

void scr_dgram_install(void) {
  static bool installed = false;
  if (installed) return;
  installed = true;
  atexit(scr_dgram_cleanup_atexit);
  scr_loop_set_dgram(&scr_dgram_pending, &scr_dgram_dispatch, &scr_dgram_pollfd);
}

/* ── the send argument-validation ladder (checked-dynamic lane) ─────────
 * Node's Socket.prototype.send signature shuffle and validation order
 * over dyn arguments, byte-for-byte: the connected/unconnected split
 * decides whether (a1, a2) are an offset/length slice or the port/address
 * pair; sliceBuffer validates the buffer's type and bounds
 * (ERR_BUFFER_OUT_OF_BOUNDS); list payloads validate per element with the
 * LIST as the Received tail; unconnected sends validate the port
 * (ERR_SOCKET_BAD_PORT, > 0 and < 65536 with the specific-type tail and
 * Node's trailing period) and the address's string contract; a send with
 * a port or address on a connected socket answers ERR_SOCKET_DGRAM_IS_
 * CONNECTED. A fully-validated unconnected single-payload send RUNS —
 * the callback form and the connected sends keep the compiler-rendered
 * fence. All dyn arguments borrowed. */

static bool scr_dgram_dyn_truthy(const ScrDyn *v) {
  switch (v->kind) {
  case SCR_DYN_UNDEF:
  case SCR_DYN_NULL: return false;
  case SCR_DYN_BOOL: return v->v.b;
  case SCR_DYN_NUM: return v->v.num == v->v.num && v->v.num != 0;
  case SCR_DYN_STR: return v->v.str->len > 0;
  default: return true;
  }
}

static uint32_t scr_dgram_to_u32(const ScrDyn *v) {
  if (v->kind != SCR_DYN_NUM) return 0; /* >>> 0 over the ladder's shapes */
  double t = v->v.num;
  if (t != t || isinf(t)) return 0;
  t = trunc(t);
  t = fmod(t, 4294967296.0);
  if (t < 0) t += 4294967296.0;
  return (uint32_t)t;
}

static const char SCR_DGRAM_BUF_EXPECTED[] =
    "of type string or an instance of Buffer, TypedArray, or DataView";

/* The completion callback of send(): Node calls it once the datagram left
 * (err null, the byte count), one loop turn after the call returns. */
static void scr_dgram_send_cb_fire(ScrClosure *self) {
  ScrDyn *cb = scr_box_get_ref(self->caps[0]);
  ScrDyn *n = scr_box_get_ref(self->caps[1]);
  ScrDyn *args[2] = {scr_dyn_new_null(), n};
  ScrDyn *r = scr_dyn_call(cb, args, 2, "the dgram send callback");
  if (r != NULL) scr_dyn_release(r);
  scr_dyn_release(args[0]);
  scr_dyn_release(cb);
  scr_dyn_release(n);
}

static void scr_dgram_schedule_send_cb(const ScrDyn *cb, size_t nbytes) {
  ScrClosure *clo = scr_closure_new((void *)scr_dgram_send_cb_fire, 2);
  clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[0], scr_dyn_retain((ScrDyn *)cb));
  clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[1], scr_dyn_new_num((double)nbytes));
  /* libuv queues the completion of a send that went out synchronously onto
   * its pending list, run at the head of the next loop pass: before that
   * pass polls (and reads the datagrams the send produced) and before any
   * timer. The tick queue is the slot of this loop that precedes all of
   * them; it differs from Node only against promise jobs queued in the same
   * turn (ticks run first here). */
  scr_next_tick(clo);
}

/* The bytes of one send(): a string's UTF-8, a view's window, or a LIST
 * concatenated element by element (Buffer.concat's order). Caller frees. */
static char *scr_dgram_gather(const ScrDyn *buffer, bool sliced, size_t off, size_t len, size_t *out_len) {
  if (buffer->kind == SCR_DYN_ARR) {
    size_t total = 0;
    for (size_t i = 0; i < buffer->v.arr.len; i++) {
      const ScrDyn *e = buffer->v.arr.items[i];
      total += e->kind == SCR_DYN_STR ? e->v.str->len : (size_t)scr_bytes_byte_len(e->v.bytes);
    }
    char *out = malloc(total ? total : 1);
    if (!out) scr_trap("scriptc: out of memory\n");
    size_t at = 0;
    for (size_t i = 0; i < buffer->v.arr.len; i++) {
      const ScrDyn *e = buffer->v.arr.items[i];
      size_t n = e->kind == SCR_DYN_STR ? e->v.str->len : (size_t)scr_bytes_byte_len(e->v.bytes);
      memcpy(out + at, e->kind == SCR_DYN_STR ? (const void *)e->v.str->data : (const void *)e->v.bytes->data, n);
      at += n;
    }
    *out_len = total;
    return out;
  }
  const char *data = buffer->kind == SCR_DYN_STR ? buffer->v.str->data : (const char *)buffer->v.bytes->data;
  size_t datalen = buffer->kind == SCR_DYN_STR ? buffer->v.str->len : (size_t)scr_bytes_byte_len(buffer->v.bytes);
  if (sliced) {
    data += off;
    datalen = len;
  }
  char *out = malloc(datalen ? datalen : 1);
  if (!out) scr_trap("scriptc: out of memory\n");
  memcpy(out, data, datalen);
  *out_len = datalen;
  return out;
}

void scr_dgram_send_dyn(ScrDgramSocket *s, const ScrDyn *buffer, const ScrDyn *a1,
                        const ScrDyn *a2, const ScrDyn *a3, const ScrDyn *a4, const ScrDyn *a5) {
  const ScrDyn *offset = a1, *length = a2, *port = a3, *address = a4;
  const ScrDyn *callback = a5;
  bool connected = s->connected;
  bool sliced = false;
  if (!connected) {
    if (scr_dgram_dyn_truthy(address) ||
        (scr_dgram_dyn_truthy(port) && port->kind != SCR_DYN_FUNC)) {
      sliced = true;
    } else {
      callback = port;
      port = offset;
      address = length;
    }
  } else {
    if (length->kind == SCR_DYN_NUM) {
      sliced = true;
      if (port->kind == SCR_DYN_FUNC) {
        callback = port;
        port = scr_dyn_undefined(); /* Node: `port = null` */
      }
    } else {
      callback = offset;
      port = a3;
      address = a4;
    }
  }
  size_t slice_off = 0, slice_len = 0;
  if (sliced) {
    double bytelen;
    if (buffer->kind == SCR_DYN_STR) bytelen = (double)buffer->v.str->len;
    else if (buffer->kind == SCR_DYN_BYTES) bytelen = scr_bytes_byte_len(buffer->v.bytes);
    else {
      scr_dyn_arg_type_fail("buffer", SCR_DGRAM_BUF_EXPECTED, buffer);
      return;
    }
    uint32_t off = scr_dgram_to_u32(offset);
    uint32_t len = scr_dgram_to_u32(length);
    if ((double)off > bytelen) {
      static const char msg[] = "\"offset\" is outside of buffer bounds";
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, sizeof msg - 1, "ERR_BUFFER_OUT_OF_BOUNDS");
      return;
    }
    if ((double)off + (double)len > bytelen) {
      static const char msg[] = "\"length\" is outside of buffer bounds";
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, sizeof msg - 1, "ERR_BUFFER_OUT_OF_BOUNDS");
      return;
    }
    slice_off = off;
    slice_len = len;
  } else if (buffer->kind == SCR_DYN_ARR) {
    for (size_t i = 0; i < buffer->v.arr.len; i++) {
      const ScrDyn *e = buffer->v.arr.items[i];
      if (e->kind != SCR_DYN_STR && e->kind != SCR_DYN_BYTES) {
        scr_dyn_arg_type_fail("buffer list arguments", SCR_DGRAM_BUF_EXPECTED, buffer);
        return;
      }
    }
  } else if (buffer->kind != SCR_DYN_STR && buffer->kind != SCR_DYN_BYTES) {
    scr_dyn_arg_type_fail("buffer", SCR_DGRAM_BUF_EXPECTED, buffer);
    return;
  }
  if (connected) {
    if (scr_dgram_dyn_truthy(port) || scr_dgram_dyn_truthy(address)) {
      scr_dgram_throw("Already connected");
      return;
    }
    size_t n;
    char *data = scr_dgram_gather(buffer, sliced, slice_off, slice_len, &n);
    scr_dgram_send_conn_raw(s, data, n);
    free(data);
    if (!scr_exc_pending() && callback->kind == SCR_DYN_FUNC) scr_dgram_schedule_send_cb(callback, n);
    return;
  }
  /* validatePort(port, 'Port', false): integers (or numeric strings)
   * strictly between 0 and 65536; everything else renders the specific
   * type with Node's trailing period. */
  double portnum = -1;
  {
    bool ok = false;
    if (port->kind == SCR_DYN_NUM && trunc(port->v.num) == port->v.num &&
        port->v.num > 0 && port->v.num < 65536) {
      ok = true;
      portnum = port->v.num;
    } else if (port->kind == SCR_DYN_STR && port->v.str->len > 0) {
      ScrStr *ps = scr_str_retain(port->v.str);
      double n = scr_string_to_number(ps);
      scr_str_release(ps);
      if (n == n && trunc(n) == n && n > 0 && n < 65536) {
        ok = true;
        portnum = n;
      }
    }
    if (!ok) {
      char detail[64], msg[160];
      const char *d = scr_dyn_specific_type(port, detail, sizeof detail);
      int len = snprintf(msg, sizeof msg, "Port should be > 0 and < 65536. Received %s.", d);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_SOCKET_BAD_PORT");
      return;
    }
  }
  if (address->kind == SCR_DYN_FUNC) {
    callback = address;
    address = scr_dyn_undefined();
  } else if (address->kind != SCR_DYN_UNDEF && address->kind != SCR_DYN_NULL &&
             address->kind != SCR_DYN_STR) {
    /* Node's gate is null/undefined-only: a falsy 0 still throws. */
    scr_dyn_arg_type_fail("address", "of type string", address);
    return;
  }
  size_t n;
  char *data = scr_dgram_gather(buffer, sliced, slice_off, slice_len, &n);
  ScrStr *host = address->kind == SCR_DYN_STR ? scr_str_retain(address->v.str)
                                              : scr_str_new("127.0.0.1", 9);
  scr_dgram_send_raw(s, data, n, portnum, host);
  scr_str_release(host);
  free(data);
  if (!scr_exc_pending() && callback->kind == SCR_DYN_FUNC) scr_dgram_schedule_send_cb(callback, n);
}
