/* fetch() for the STATIC lane — no embedded engine anywhere.
 *
 * scr_fetch.c is the same feature for the --dynamic island: its JS half
 * defines globalThis.fetch and its C half drives scr_http's client. This
 * unit is the OTHER delivery end of that same client: the fetch semantics
 * layer, delivering into a static ScrPromise and a static ScrResponse
 * handle rather than into engine values. The two units are independently
 * link-gated (a static binary never links QuickJS; a --dynamic binary
 * never needs this one), and neither names a symbol of the other.
 *
 * Why it is not a refactor of scr_fetch.c into a shared core: that unit's
 * hot path is written against JSValue at every delivery point, and the
 * island lane is the one lane in this repo with no static differential
 * harness. A shared core would have put the working lane at risk to save
 * duplication in a layer that is, in the end, a header table and a
 * redirect rule. The duplication is deliberate and is listed in the
 * matching comment at the head of scr_fetch.c's semantics section.
 *
 * What it inherits, and therefore does not reimplement:
 *   - the HTTP/1.1 client, its parser, chunked/content-length/read-to-EOF
 *     body framing and keep-alive: scr_http.c (scr_http_request_ex).
 *   - TLS with SNI and REAL certificate verification against the URL
 *     hostname: scr_tls.c (scr_tls_fetch_client_ctx/_wrap, the same pair
 *     the WebSocket dial and scr_fetch.c use, reject_unauthorized = true).
 *   - DNS, the family race, and the socket: scr_net.c
 *     (scr_net_connect_host, reached through the http client).
 *   - the event loop and the promise: scr_async.c. This unit registers NO
 *     loop hook: the net unit's poller already sleeps on socket readiness.
 *   - WHATWG URL parsing: scr_url.c.
 *
 * fetch SEMANTICS, matched to Node/undici and measured against Node
 * v25.9.0 (tests/harness/fetch-static.test.ts):
 *   - HTTP errors RESOLVE. Only a network failure rejects, with a
 *     TypeError whose message is exactly "fetch failed". A non-2xx is
 *     NEVER swallowed: it arrives as a resolved Response with .ok false
 *     and .status set.
 *   - redirects are followed here (20 hops, fetch's limit). 303 — and
 *     301/302 for POST — rewrite to GET and drop the body and its
 *     content-* headers. authorization/cookie are stripped on a
 *     cross-origin hop. response.url is the FINAL url without its
 *     fragment and .redirected is set. A redirect hop's own body never
 *     reaches the caller. A 3xx with no Location is a final response
 *     with its own body, which is what Node answers.
 *   - the request head carries undici's default header set in undici's
 *     order: host, connection, the user headers, accept,
 *     accept-language, sec-fetch-mode, user-agent, accept-encoding.
 *   - gzip/x-gzip/deflate response bodies arrive DECOMPRESSED (zlib's
 *     15+32 auto-detect). br and zstd are never offered, so they never
 *     arrive.
 *   - header names are case-INSENSITIVE on read and are stored
 *     lowercased; repeated headers join with ", " (set-cookie excepted —
 *     see scr_fetch_headers_get).
 *   - a TLS failure, a refused connection and an unresolvable name all
 *     REJECT. None of them can answer a Response.
 *
 * KNOWN DIVERGENCES, stated rather than hidden:
 *   - Node attaches the underlying network error to the TypeError as
 *     `cause`. ScrError has no cause slot (scr_abort_http.c records the
 *     same omission), so the classified detail rides the error's `code`
 *     instead and `cause` is absent. Loud, not silent: the rejection
 *     still happens, with Node's message.
 *   - Response.body (a ReadableStream) is not part of this slice; the
 *     body is consumed through text()/json()/arrayBuffer()/bytes(). The
 *     compiler refuses `.body` by name rather than answering null.
 *   - no connection pooling: one dialed connection per hop, which is
 *     scr_http.c's stance for every client in this runtime.
 *   - https-over-CONNECT proxying is out of the slice, as it is for
 *     scr_fetch.c.
 */
#include "scr_runtime.h"
#include "scr_url_internal.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <zlib.h>

static void fs_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

/* ── small helpers (ScrStr is not NUL-guaranteed: everything is
 * length-aware and ASCII-case-folded) ─────────────────────────────── */

static bool fs_eq_ci(const char *a, size_t alen, const char *b, size_t blen) {
  if (alen != blen) return false;
  for (size_t i = 0; i < alen; i++) {
    char c = a[i], d = b[i];
    if (c >= 'A' && c <= 'Z') c = (char)(c - 'A' + 'a');
    if (d >= 'A' && d <= 'Z') d = (char)(d - 'A' + 'a');
    if (c != d) return false;
  }
  return true;
}

static bool fs_lit_ci(const char *a, size_t alen, const char *lit) {
  return fs_eq_ci(a, alen, lit, strlen(lit));
}

static bool fs_str_is(const ScrStr *s, const char *lit) { return fs_lit_ci(s->data, s->len, lit); }

static ScrStr *fs_lower(const ScrStr *s) {
  char stackbuf[128];
  char *b = s->len <= sizeof stackbuf ? stackbuf : malloc(s->len);
  if (b == NULL) fs_oom();
  for (size_t i = 0; i < s->len; i++) {
    char c = s->data[i];
    b[i] = (c >= 'A' && c <= 'Z') ? (char)(c - 'A' + 'a') : c;
  }
  ScrStr *out = scr_str_new(b, s->len);
  if (b != stackbuf) free(b);
  return out;
}

static bool fs_pairs_have(ScrArr *pairs, const char *name) {
  size_t n = (size_t)scr_arr_len(pairs);
  bool found = false;
  for (size_t i = 0; i + 1 < n && !found; i += 2) {
    ScrStr *nm = (ScrStr *)scr_arr_get_ref(pairs, (double)i);
    found = fs_lit_ci(nm->data, nm->len, name);
    scr_str_release(nm);
  }
  return found;
}

static void fs_pairs_push(ScrArr *pairs, const char *name, const char *value, size_t vlen) {
  scr_arr_push_ref(pairs, scr_str_new(name, strlen(name)));
  scr_arr_push_ref(pairs, scr_str_new(value, vlen));
}

/* ── Headers ─────────────────────────────────────────────────────────
 * A flat [name, value, ...] array with LOWERCASED names, in arrival
 * order. No cycle header: every edge is an ScrStr, which cannot reach
 * back. */

struct ScrFetchHeaders {
  size_t rc;
  ScrArr *pairs; /* SCR_ELEM_STR, [lowercased name, value, ...] */
};

static ScrFetchHeaders *fs_headers_new_owned(ScrArr *pairs /*moves*/) {
  ScrFetchHeaders *h = malloc(sizeof *h);
  if (h == NULL) fs_oom();
  h->rc = 1;
  h->pairs = pairs;
  return h;
}

ScrFetchHeaders *scr_fetch_headers_retain(ScrFetchHeaders *h) {
  if (h != NULL && h->rc != SIZE_MAX) h->rc++;
  return h;
}

void scr_fetch_headers_release(ScrFetchHeaders *h) {
  if (h == NULL || h->rc == SIZE_MAX) return;
  if (--h->rc > 0) return;
  scr_arr_release(h->pairs);
  free(h);
}

void *scr_fetch_headers_retain_v(void *p) { return scr_fetch_headers_retain((ScrFetchHeaders *)p); }
void scr_fetch_headers_release_v(void *p) { scr_fetch_headers_release((ScrFetchHeaders *)p); }

/* headers.get(name): the JOINED value of every matching field, ", "
 * separated — the Headers spec's rule, and Node's answer. NULL (the null
 * arm) when the name is absent.
 *
 * set-cookie is the spec's single exception (getSetCookie exists because
 * joining cookies is lossy); this slice has no getSetCookie, and joining
 * would be a WRONG answer, so a set-cookie read answers only the FIRST
 * field and the omission is recorded here rather than silently joined.
 * Node's own `headers.get('set-cookie')` joins with ", " — we differ on
 * purpose and the test file pins the difference. */
ScrStr *scr_fetch_headers_get(ScrFetchHeaders *h, ScrStr *name /*borrowed*/) {
  size_t n = (size_t)scr_arr_len(h->pairs);
  bool cookie = fs_lit_ci(name->data, name->len, "set-cookie");
  ScrStr *acc = NULL;
  for (size_t i = 0; i + 1 < n; i += 2) {
    ScrStr *nm = (ScrStr *)scr_arr_get_ref(h->pairs, (double)i);
    bool hit = fs_eq_ci(nm->data, nm->len, name->data, name->len);
    scr_str_release(nm);
    if (!hit) continue;
    ScrStr *v = (ScrStr *)scr_arr_get_ref(h->pairs, (double)(i + 1));
    if (acc == NULL) {
      acc = v;
      if (cookie) break;
    } else {
      size_t len = acc->len + 2 + v->len;
      char *b = malloc(len);
      if (b == NULL) fs_oom();
      memcpy(b, acc->data, acc->len);
      b[acc->len] = ',';
      b[acc->len + 1] = ' ';
      memcpy(b + acc->len + 2, v->data, v->len);
      scr_str_release(acc);
      scr_str_release(v);
      acc = scr_str_new(b, len);
      free(b);
    }
  }
  return acc;
}

bool scr_fetch_headers_has(ScrFetchHeaders *h, ScrStr *name /*borrowed*/) {
  size_t n = (size_t)scr_arr_len(h->pairs);
  for (size_t i = 0; i + 1 < n; i += 2) {
    ScrStr *nm = (ScrStr *)scr_arr_get_ref(h->pairs, (double)i);
    bool hit = fs_eq_ci(nm->data, nm->len, name->data, name->len);
    scr_str_release(nm);
    if (hit) return true;
  }
  return false;
}

/* The flat [name, value, ...] snapshot, +1 — the surface Object.fromEntries
 * and the emitted for-of both read. Names are already lowercased. */
ScrArr *scr_fetch_headers_pairs(ScrFetchHeaders *h) { return scr_arr_retain(h->pairs); }

/* ── Response ────────────────────────────────────────────────────────
 * Holds one traced edge — the parked body-consumer promise — so a
 * program that awaits .text() and drops the response mid-flight is still
 * collectable. Every other edge is a string, a byte array or an error,
 * none of which can reach a Response back. */

enum { FS_BODY_TEXT = 0, FS_BODY_JSON = 1, FS_BODY_BUFFER = 2, FS_BODY_BYTES = 3 };

struct ScrResponse {
  size_t rc;
  int status;
  ScrStr *status_text; /* owned */
  ScrStr *url;         /* owned — the FINAL url, no fragment */
  bool redirected;
  ScrFetchHeaders *headers; /* owned */
  /* the body, accumulated as it arrives */
  ScrArr *chunks; /* SCR_ELEM_REF of ScrBytes, owned */
  bool ended;
  bool used;      /* bodyUsed */
  ScrError *err;  /* owned, or NULL — a mid-body failure */
  /* the parked consumer, if .text()/.json()/... ran before the body ended */
  ScrPromise *waiter; /* owned, or NULL */
  int waiter_kind;
};

static void fs_response_trace(void *obj, ScrTraceVisit visit, void *ctx) {
  ScrResponse *r = (ScrResponse *)obj;
  if (r->waiter != NULL) visit(r->waiter, ctx);
}

/* The collector's teardown: the complement of the trace. The waiter edge
 * was already accounted by markGray, so it is NOT released here; every
 * untraced edge is. */
static void fs_response_gcfree(void *obj) {
  ScrResponse *r = (ScrResponse *)obj;
  scr_str_release(r->status_text);
  scr_str_release(r->url);
  scr_fetch_headers_release(r->headers);
  scr_arr_release(r->chunks);
  if (r->err != NULL) scr_error_release(r->err);
  scr_cyc_free(r);
}

static ScrResponse *fs_response_new(void) {
  ScrResponse *r = scr_cyc_alloc(sizeof *r, &fs_response_trace, &fs_response_gcfree);
  r->rc = 1;
  r->status = 0;
  r->status_text = scr_str_new("", 0);
  r->url = scr_str_new("", 0);
  r->redirected = false;
  r->headers = NULL;
  r->chunks = scr_arr_new_ref(&scr_bytes_retain_v, &scr_bytes_release_v, NULL, 4);
  r->ended = false;
  r->used = false;
  r->err = NULL;
  r->waiter = NULL;
  r->waiter_kind = 0;
  return r;
}

ScrResponse *scr_response_retain(ScrResponse *r) {
  if (r != NULL && r->rc != SIZE_MAX) {
    r->rc++;
    scr_cyc_mark_live(r);
  }
  return r;
}

void scr_response_release(ScrResponse *r) {
  if (r == NULL || r->rc == SIZE_MAX) return;
  if (--r->rc == 0) {
    scr_cyc_on_dead(r);
    scr_str_release(r->status_text);
    scr_str_release(r->url);
    scr_fetch_headers_release(r->headers);
    scr_arr_release(r->chunks);
    if (r->err != NULL) scr_error_release(r->err);
    if (r->waiter != NULL) scr_promise_release(r->waiter);
    scr_cyc_free(r);
  } else {
    scr_cyc_on_release(r);
  }
}

void *scr_response_retain_v(void *p) { return scr_response_retain((ScrResponse *)p); }
void scr_response_release_v(void *p) { scr_response_release((ScrResponse *)p); }
void scr_response_trace_v(void *p, ScrTraceVisit visit, void *ctx) { fs_response_trace(p, visit, ctx); }

double scr_response_status(ScrResponse *r) { return (double)r->status; }
/* fetch's `ok`: 200-299 inclusive, and NOTHING else. A 3xx that reached
 * the caller (a redirect with no Location, or a hop limit) is not ok. */
bool scr_response_ok(ScrResponse *r) { return r->status >= 200 && r->status <= 299; }
ScrStr *scr_response_status_text(ScrResponse *r) { return scr_str_retain(r->status_text); }
ScrStr *scr_response_url(ScrResponse *r) { return scr_str_retain(r->url); }
bool scr_response_redirected(ScrResponse *r) { return r->redirected; }
bool scr_response_body_used(ScrResponse *r) { return r->used; }
ScrFetchHeaders *scr_response_headers(ScrResponse *r) { return scr_fetch_headers_retain(r->headers); }

/* ── body consumption ────────────────────────────────────────────── */

static ScrBytes *fs_body_bytes(ScrResponse *r) { return scr_bytes_concat(r->chunks); }

/* Turns the accumulated body into the requested payload and settles `p`.
 * A JSON parse failure rejects with the SyntaxError JSON.parse itself
 * raises — the same channel scr_stream.c's consumers use. */
static void fs_settle_body(ScrPromise *p, ScrResponse *r, int kind) {
  if (r->err != NULL) {
    scr_throw_obj(r->err, &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
    scr_promise_reject_pending(p);
    return;
  }
  ScrBytes *all = fs_body_bytes(r);
  if (kind == FS_BODY_BUFFER || kind == FS_BODY_BYTES) {
    scr_promise_fulfill_ref(p, all, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
    scr_bytes_release(all);
    return;
  }
  ScrStr *enc = scr_str_new("utf8", 4);
  ScrStr *text = scr_bytes_to_str(all, enc);
  scr_str_release(enc);
  scr_bytes_release(all);
  if (kind == FS_BODY_TEXT) {
    scr_promise_fulfill_str(p, text); /* moves */
    return;
  }
  ScrDyn *doc = scr_json_parse(text);
  scr_str_release(text);
  if (doc == NULL) {
    scr_promise_reject_pending(p);
    return;
  }
  scr_promise_fulfill_ref(p, doc, &scr_dyn_retain_v, &scr_dyn_release_v, &scr_dyn_trace_v);
  scr_dyn_release(doc);
}

/* The body-ended (or body-failed) edge: settle whatever is parked. */
static void fs_wake_waiter(ScrResponse *r) {
  if (r->waiter == NULL) return;
  ScrPromise *p = r->waiter;
  int kind = r->waiter_kind;
  r->waiter = NULL;
  fs_settle_body(p, r, kind);
  scr_promise_release(p);
}

/* The shared entry behind text()/json()/arrayBuffer()/bytes().
 *
 * Node's rule, and ours: a SECOND read of a body throws a TypeError
 * synchronously — "Body is unusable: Body has already been read". It is a
 * throw, not a rejection, because that is where Node puts it. */
static ScrPromise *fs_consume(ScrResponse *r, int kind) {
  if (r->used) {
    scr_throw_error_msg(SCR_ERR_TYPE, "Body is unusable: Body has already been read", 43);
    return NULL;
  }
  r->used = true;
  if (r->ended || r->err != NULL) {
    ScrPromise *p = scr_promise_new();
    fs_settle_body(p, r, kind);
    return p;
  }
  ScrPromise *p = scr_promise_new();
  r->waiter = scr_promise_retain(p);
  r->waiter_kind = kind;
  return p;
}

ScrPromise *scr_response_text(ScrResponse *r) { return fs_consume(r, FS_BODY_TEXT); }
ScrPromise *scr_response_json(ScrResponse *r) { return fs_consume(r, FS_BODY_JSON); }
ScrPromise *scr_response_array_buffer(ScrResponse *r) { return fs_consume(r, FS_BODY_BUFFER); }
ScrPromise *scr_response_bytes(ScrResponse *r) { return fs_consume(r, FS_BODY_BYTES); }

/* ── transfers ───────────────────────────────────────────────────────
 * One per fetch() call, living across every redirect hop. The live
 * registry holds +1 and every minted listener closure's box holds one,
 * exactly scr_fetch.c's ownership. */

typedef struct FsTransfer {
  size_t rc;
  ScrPromise *promise; /* owned until the head settles it, then NULL */
  ScrResponse *resp;   /* owned once the head arrived, else NULL */
  ScrStr *method;      /* owned */
  ScrArr *headers;     /* owned, flat [name, value, ...] user pairs */
  ScrBytes *body;      /* owned, or NULL */
  ScrUrl *url;         /* owned — the CURRENT hop */
  int hops;
  bool redirected;
  ScrHttpClientReq *client; /* +1, NULL between hops and after settle */
  void *signal;             /* an ScrAbortSignal, +1, or NULL — see the seam below */
  bool responded;
  bool done;
  bool inflating;
  z_stream zs;
  struct FsTransfer *next;
} FsTransfer;

static FsTransfer *fs_live = NULL;
static size_t fs_nlive = 0;

/* ── the abort SEAM ──────────────────────────────────────────────────
 * scr_abort.c and this unit are independently link-gated (a program can
 * fetch without an AbortSignal and hold a signal without fetching), so
 * neither may name the other's symbols. scr_fetch_abort.c is gated on
 * the conjunction and fills these in at startup — the scr_abort_http.c
 * pattern, one level up. Unset, a `signal` never reaches the wire and
 * the compiler refuses the option rather than dropping it. */
static void *(*fs_signal_retain)(void *) = NULL;
static void (*fs_signal_release)(void *) = NULL;
static void (*fs_signal_attach)(void *sig, ScrHttpClientReq *c) = NULL;
static bool (*fs_signal_aborted)(void *sig) = NULL;
static ScrError *(*fs_signal_error)(void *sig) = NULL;

void scr_fetch_abort_seam(void *(*retain)(void *), void (*release)(void *),
                          void (*attach)(void *, ScrHttpClientReq *),
                          bool (*aborted)(void *), ScrError *(*error)(void *)) {
  fs_signal_retain = retain;
  fs_signal_release = release;
  fs_signal_attach = attach;
  fs_signal_aborted = aborted;
  fs_signal_error = error;
}

static FsTransfer *fs_retain(FsTransfer *t) {
  t->rc++;
  return t;
}

static void fs_release(FsTransfer *t) {
  if (--t->rc > 0) return;
  scr_str_release(t->method);
  scr_arr_release(t->headers);
  if (t->body != NULL) scr_bytes_release(t->body);
  if (t->url != NULL) scr_url_release(t->url);
  if (t->client != NULL) scr_http_client_release(t->client);
  if (t->promise != NULL) scr_promise_release(t->promise);
  if (t->resp != NULL) scr_response_release(t->resp);
  if (t->signal != NULL && fs_signal_release != NULL) fs_signal_release(t->signal);
  if (t->inflating) inflateEnd(&t->zs);
  free(t);
}

static void *fs_retain_v(void *p) { return fs_retain((FsTransfer *)p); }
static void fs_release_v(void *p) { fs_release((FsTransfer *)p); }

/* The transfer is over. Idempotent; leaves the registry, which drops the
 * registry's +1 and with it (usually) the last reference. */
static void fs_settle(FsTransfer *t) {
  if (t->done) return;
  t->done = true;
  if (t->client != NULL) {
    scr_http_client_release(t->client);
    t->client = NULL;
  }
  for (FsTransfer **link = &fs_live; *link != NULL; link = &(*link)->next) {
    if (*link == t) {
      *link = t->next;
      fs_nlive--;
      fs_release(t);
      return;
    }
  }
}

static ScrClosure *fs_closure(FsTransfer *t, void *fn) {
  ScrClosure *cb = scr_closure_new(fn, 1);
  ScrBox *box = scr_box_new_obj(&fs_retain_v, &fs_release_v, NULL);
  scr_box_set_ref(box, fs_retain(t));
  cb->caps[0] = box;
  return cb;
}

static FsTransfer *fs_from(ScrClosure *cb) { return (FsTransfer *)scr_box_get_ref(cb->caps[0]); }

/* Node's network-failure shape: a TypeError whose message is exactly
 * "fetch failed". The classified detail rides `code` (Node puts it on
 * `cause`, which no ScrError slot can hold — the documented divergence at
 * the head of this file). */
static ScrError *fs_failure(const char *code) {
  ScrStr *m = scr_str_new("fetch failed", 12);
  ScrError *e = scr_error_new(SCR_ERR_TYPE, m);
  scr_str_release(m);
  if (code != NULL) {
    if (e->code != NULL) scr_str_release(e->code);
    e->code = scr_str_new(code, strlen(code));
  }
  return e;
}

/* A failure BEFORE the head: the fetch() promise rejects and no Response
 * is ever minted. A failure AFTER it: the body errors, and the rejection
 * lands on whatever consumer is parked (or on the next one to ask). */
static void fs_error(FsTransfer *t, const char *code) {
  if (t->done) return;
  /* An abort is not a network failure. Node rejects an aborted fetch with
   * the AbortError, never with "fetch failed", and the two are told apart
   * by asking the signal — the http client's teardown looks identical on
   * the wire either way. */
  bool aborted = t->signal != NULL && fs_signal_aborted != NULL && fs_signal_aborted(t->signal);
  if (!t->responded) {
    ScrPromise *p = t->promise;
    t->promise = NULL;
    if (p != NULL) {
      ScrError *e = aborted ? fs_signal_error(t->signal) : fs_failure(code);
      scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
      scr_error_release(e);
      scr_promise_reject_pending(p);
      scr_promise_release(p);
    }
  } else if (t->resp != NULL && t->resp->err == NULL && !t->resp->ended) {
    /* mid-body death: undici's shape is a TypeError "terminated"; an
     * abort mid-body carries the AbortError, as it does at the head. */
    if (aborted) {
      t->resp->err = fs_signal_error(t->signal);
    } else {
      ScrStr *m = scr_str_new("terminated", 10);
      t->resp->err = scr_error_new(SCR_ERR_TYPE, m);
      scr_str_release(m);
    }
    fs_wake_waiter(t->resp);
  }
  fs_settle(t);
}

/* ── URL helpers (the same rules as scr_fetch.c) ────────────────────── */

static ScrStr *fs_url_serialize(const ScrUrl *u) {
  size_t cap = u->scheme->len + u->userinfo->len + u->host->len + u->port->len +
               u->path->len + u->query->len + 8;
  char *b = malloc(cap);
  if (b == NULL) fs_oom();
  size_t n = 0;
  memcpy(b + n, u->scheme->data, u->scheme->len);
  n += u->scheme->len;
  b[n++] = ':';
  if (u->has_authority) {
    b[n++] = '/';
    b[n++] = '/';
    if (u->userinfo->len > 0) {
      memcpy(b + n, u->userinfo->data, u->userinfo->len);
      n += u->userinfo->len;
      b[n++] = '@';
    }
    memcpy(b + n, u->host->data, u->host->len);
    n += u->host->len;
    if (u->port->len > 0) {
      b[n++] = ':';
      memcpy(b + n, u->port->data, u->port->len);
      n += u->port->len;
    }
  }
  memcpy(b + n, u->path->data, u->path->len);
  n += u->path->len;
  memcpy(b + n, u->query->data, u->query->len);
  n += u->query->len;
  ScrStr *out = scr_str_new(b, n);
  free(b);
  return out;
}

/* Parses without throwing: NULL when the input is not a URL. */
static ScrUrl *fs_url_parse(ScrStr *s) {
  ScrUrl *u = scr_url_new(s);
  if (u == NULL) scr_exc_clear();
  return u;
}

/* Resolve a Location against the current hop. The absolute form parses
 * directly; the relative shapes real servers send (//authority, /rooted,
 * ?query, plain relative) are assembled and REPARSED through the WHATWG
 * parser so dot segments and encoding normalize the same way in both
 * arms. scr_url_new_rel is not used: it takes an ScrUrl base and would
 * re-serialize the same string this already holds. */
static ScrUrl *fs_resolve(const ScrUrl *base, const ScrStr *loc) {
  ScrStr *abs_try = scr_str_new(loc->data, loc->len);
  ScrUrl *u = fs_url_parse(abs_try);
  scr_str_release(abs_try);
  if (u != NULL) return u;
  size_t cap = base->scheme->len + base->userinfo->len + base->host->len + base->port->len +
               base->path->len + base->query->len + loc->len + 16;
  char *buf = malloc(cap);
  if (buf == NULL) fs_oom();
  size_t n = 0;
  memcpy(buf + n, base->scheme->data, base->scheme->len);
  n += base->scheme->len;
  buf[n++] = ':';
  if (loc->len >= 2 && loc->data[0] == '/' && loc->data[1] == '/') {
    memcpy(buf + n, loc->data, loc->len);
    n += loc->len;
  } else {
    buf[n++] = '/';
    buf[n++] = '/';
    if (base->userinfo->len > 0) {
      memcpy(buf + n, base->userinfo->data, base->userinfo->len);
      n += base->userinfo->len;
      buf[n++] = '@';
    }
    memcpy(buf + n, base->host->data, base->host->len);
    n += base->host->len;
    if (base->port->len > 0) {
      buf[n++] = ':';
      memcpy(buf + n, base->port->data, base->port->len);
      n += base->port->len;
    }
    if (loc->len > 0 && loc->data[0] == '/') {
      memcpy(buf + n, loc->data, loc->len);
      n += loc->len;
    } else if (loc->len > 0 && loc->data[0] == '?') {
      memcpy(buf + n, base->path->data, base->path->len);
      n += base->path->len;
      memcpy(buf + n, loc->data, loc->len);
      n += loc->len;
    } else {
      size_t keep = 0;
      for (size_t i = 0; i < base->path->len; i++) {
        if (base->path->data[i] == '/') keep = i + 1;
      }
      memcpy(buf + n, base->path->data, keep);
      n += keep;
      if (keep == 0) buf[n++] = '/';
      memcpy(buf + n, loc->data, loc->len);
      n += loc->len;
    }
  }
  ScrStr *s = scr_str_new(buf, n);
  free(buf);
  ScrUrl *out = fs_url_parse(s);
  scr_str_release(s);
  return out;
}

/* IPv6 literals arrive bracketed from the parser; the dial and the SNI
 * name both want them bare. */
static ScrStr *fs_bare_host(const ScrStr *host) {
  if (host->len >= 2 && host->data[0] == '[' && host->data[host->len - 1] == ']') {
    return scr_str_new(host->data + 1, host->len - 2);
  }
  return scr_str_retain((ScrStr *)host);
}

static int fs_url_port(const ScrUrl *u, int deflt) {
  if (u->port->len == 0) return deflt;
  int p = 0;
  for (size_t i = 0; i < u->port->len; i++) p = p * 10 + (u->port->data[i] - '0');
  return p;
}

/* ── the hop ─────────────────────────────────────────────────────── */

static void fs_on_response(ScrClosure *cb, ScrHttpReq *res /*+1*/);
static void fs_on_client_error(ScrClosure *cb, ScrStr *msg /*borrowed*/);

static void fs_start_hop(FsTransfer *t) {
  ScrUrl *u = t->url;
  bool https = fs_str_is(u->scheme, "https");
  int default_port = https ? 443 : 80;
  int port = fs_url_port(u, default_port);

  /* undici's request head, in undici's order. */
  size_t nuser = (size_t)scr_arr_len(t->headers);
  ScrArr *pairs = scr_arr_new(SCR_ELEM_STR, nuser + 16);
  if (!fs_pairs_have(t->headers, "host")) {
    char authority[300];
    int alen;
    if (port != default_port) {
      alen = snprintf(authority, sizeof authority, "%.*s:%d", (int)u->host->len, u->host->data, port);
    } else {
      alen = snprintf(authority, sizeof authority, "%.*s", (int)u->host->len, u->host->data);
    }
    if (alen < 0) alen = 0;
    fs_pairs_push(pairs, "host", authority, (size_t)alen);
  }
  if (!fs_pairs_have(t->headers, "connection")) fs_pairs_push(pairs, "connection", "keep-alive", 10);
  for (size_t i = 0; i + 1 < nuser; i += 2) {
    scr_arr_push_ref(pairs, scr_arr_get_ref(t->headers, (double)i));
    scr_arr_push_ref(pairs, scr_arr_get_ref(t->headers, (double)(i + 1)));
  }
  if (!fs_pairs_have(t->headers, "accept")) fs_pairs_push(pairs, "accept", "*/*", 3);
  if (!fs_pairs_have(t->headers, "accept-language")) fs_pairs_push(pairs, "accept-language", "*", 1);
  if (!fs_pairs_have(t->headers, "sec-fetch-mode")) fs_pairs_push(pairs, "sec-fetch-mode", "cors", 4);
  if (!fs_pairs_have(t->headers, "user-agent")) fs_pairs_push(pairs, "user-agent", "node", 4);
  if (!fs_pairs_have(t->headers, "accept-encoding")) {
    fs_pairs_push(pairs, "accept-encoding", "gzip, deflate", 13);
  }

  ScrStr *path;
  if (u->query->len > 0) {
    size_t plen = (u->path->len > 0 ? u->path->len : 1) + u->query->len;
    char *pb = malloc(plen);
    if (pb == NULL) fs_oom();
    size_t n = 0;
    if (u->path->len > 0) {
      memcpy(pb, u->path->data, u->path->len);
      n = u->path->len;
    } else {
      pb[n++] = '/';
    }
    memcpy(pb + n, u->query->data, u->query->len);
    n += u->query->len;
    path = scr_str_new(pb, n);
    free(pb);
  } else {
    path = u->path->len > 0 ? scr_str_retain(u->path) : scr_str_new("/", 1);
  }
  ScrStr *dial = fs_bare_host(u->host);

  ScrHttpClientReq *c;
  if (https) {
    void *cli = scr_tls_fetch_client_ctx(dial, true);
    c = scr_http_request_ex(dial, port, path, t->method, 0, pairs, false, NULL, NULL, 443,
                            &scr_tls_fetch_client_wrap, cli);
  } else {
    c = scr_http_request_ex(dial, port, path, t->method, 0, pairs, false, NULL, NULL, 80, NULL, NULL);
  }
  scr_str_release(dial);
  scr_str_release(path);
  scr_arr_release(pairs);

  t->client = c;
  if (t->signal != NULL && fs_signal_attach != NULL) fs_signal_attach(t->signal, c);
  scr_http_client_on_response(c, fs_closure(t, (void *)&fs_on_response), &fs_on_response, true);
  scr_http_client_on_error(c, fs_closure(t, (void *)&fs_on_client_error), &fs_on_client_error, false);
  if (t->body != NULL) scr_http_client_end_bytes(c, t->body);
  else scr_http_client_end(c);
}

/* ── redirects ───────────────────────────────────────────────────── */

static void fs_strip_header(ScrArr **headers, const char *name) {
  ScrArr *old = *headers;
  size_t n = (size_t)scr_arr_len(old);
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, n);
  for (size_t i = 0; i + 1 < n; i += 2) {
    ScrStr *nm = (ScrStr *)scr_arr_get_ref(old, (double)i);
    if (fs_lit_ci(nm->data, nm->len, name)) {
      scr_str_release(nm);
      continue;
    }
    scr_arr_push_ref(out, nm);
    scr_arr_push_ref(out, scr_arr_get_ref(old, (double)(i + 1)));
  }
  scr_arr_release(old);
  *headers = out;
}

static bool fs_redirect(FsTransfer *t, int status, const ScrStr *loc) {
  if (t->hops >= 20) {
    fs_error(t, "UND_ERR_REDIRECT");
    return false;
  }
  t->hops++;
  t->redirected = true;
  ScrUrl *next = fs_resolve(t->url, loc);
  if (next == NULL || !(fs_str_is(next->scheme, "http") || fs_str_is(next->scheme, "https"))) {
    if (next != NULL) scr_url_release(next);
    fs_error(t, "UND_ERR_REDIRECT");
    return false;
  }
  bool is_get = fs_str_is(t->method, "GET");
  bool is_head = fs_str_is(t->method, "HEAD");
  if ((status == 303 && !is_get && !is_head) ||
      ((status == 301 || status == 302) && fs_str_is(t->method, "POST"))) {
    scr_str_release(t->method);
    t->method = scr_str_new("GET", 3);
    if (t->body != NULL) {
      scr_bytes_release(t->body);
      t->body = NULL;
    }
    fs_strip_header(&t->headers, "content-type");
    fs_strip_header(&t->headers, "content-length");
    fs_strip_header(&t->headers, "content-encoding");
    fs_strip_header(&t->headers, "content-language");
    fs_strip_header(&t->headers, "content-location");
  }
  bool same_origin = t->url->host->len == next->host->len &&
                     memcmp(t->url->host->data, next->host->data, next->host->len) == 0 &&
                     fs_url_port(t->url, 0) == fs_url_port(next, 0) &&
                     t->url->scheme->len == next->scheme->len &&
                     memcmp(t->url->scheme->data, next->scheme->data, next->scheme->len) == 0;
  if (!same_origin) {
    fs_strip_header(&t->headers, "authorization");
    fs_strip_header(&t->headers, "proxy-authorization");
    fs_strip_header(&t->headers, "cookie");
  }
  scr_url_release(t->url);
  t->url = next;
  return true;
}

/* ── body delivery ───────────────────────────────────────────────── */

static void fs_push_chunk(FsTransfer *t, const uint8_t *data, size_t len) {
  if (len == 0 || t->resp == NULL) return;
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)len);
  memcpy(b->data, data, len);
  scr_arr_push_ref(t->resp->chunks, b);
}

static void fs_on_data(ScrClosure *cb, ScrBytes *chunk /*borrowed*/) {
  FsTransfer *t = fs_from(cb);
  if (t == NULL) return;
  if (t->done || !t->responded) {
    fs_release(t);
    return;
  }
  if (!t->inflating) {
    fs_push_chunk(t, chunk->data, chunk->len);
    fs_release(t);
    return;
  }
  t->zs.next_in = (Bytef *)chunk->data;
  t->zs.avail_in = (uInt)chunk->len;
  unsigned char out[16384];
  while (t->zs.avail_in > 0 && !t->done) {
    t->zs.next_out = out;
    t->zs.avail_out = sizeof out;
    int rc = inflate(&t->zs, Z_NO_FLUSH);
    size_t produced = sizeof out - t->zs.avail_out;
    if (produced > 0) fs_push_chunk(t, out, produced);
    if (rc == Z_STREAM_END) break;
    if (rc != Z_OK && rc != Z_BUF_ERROR) {
      /* a corrupt content-encoding is a TRUNCATED body if we delivered
       * what we had — the one silent failure this feature must not have.
       * It errors instead. */
      if (t->client != NULL) scr_http_client_destroy(t->client);
      fs_error(t, "UND_ERR_DECODE");
      break;
    }
    if (rc == Z_BUF_ERROR && produced == 0) break;
  }
  fs_release(t);
}

static void fs_on_end(ScrClosure *cb) {
  FsTransfer *t = fs_from(cb);
  if (t == NULL) return;
  if (t->done) {
    fs_release(t);
    return;
  }
  if (t->resp != NULL) {
    t->resp->ended = true;
    fs_wake_waiter(t->resp);
  }
  fs_settle(t);
  fs_release(t);
}

static void fs_on_res_error(ScrClosure *cb, ScrStr *msg /*borrowed*/) {
  (void)msg;
  FsTransfer *t = fs_from(cb);
  if (t == NULL) return;
  if (t->done) {
    fs_release(t);
    return;
  }
  fs_error(t, "UND_ERR_SOCKET");
  fs_release(t);
}

static void fs_on_response(ScrClosure *cb, ScrHttpReq *res /*+1*/) {
  FsTransfer *t = fs_from(cb);
  if (t == NULL) {
    scr_http_req_release(res);
    return;
  }
  if (t->done) {
    scr_http_req_release(res);
    fs_release(t);
    return;
  }
  int status = (int)scr_http_req_status(res);

  if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
    ScrStr *locname = scr_str_new("location", 8);
    ScrStr *loc = scr_http_req_header(res, locname);
    scr_str_release(locname);
    if (loc != NULL) {
      ScrHttpClientReq *old = t->client;
      t->client = NULL;
      bool go = fs_redirect(t, status, loc);
      scr_str_release(loc);
      if (old != NULL) {
        scr_http_client_destroy(old);
        scr_http_client_release(old);
      }
      if (go) fs_start_hop(t);
      scr_http_req_release(res);
      fs_release(t);
      return;
    }
    /* a 3xx with no Location is a FINAL response carrying its own body,
     * which is what Node answers. Fall through. */
  }

  t->responded = true;

  {
    ScrStr *cename = scr_str_new("content-encoding", 16);
    ScrStr *ce = scr_http_req_header(res, cename);
    scr_str_release(cename);
    if (ce != NULL) {
      if (fs_str_is(ce, "gzip") || fs_str_is(ce, "x-gzip") || fs_str_is(ce, "deflate")) {
        memset(&t->zs, 0, sizeof t->zs);
        if (inflateInit2(&t->zs, 15 + 32) == Z_OK) t->inflating = true;
      }
      scr_str_release(ce);
    }
  }

  ScrResponse *r = fs_response_new();
  r->status = status;
  {
    ScrStr *stext = scr_http_req_status_message(res);
    if (stext != NULL) {
      scr_str_release(r->status_text);
      r->status_text = stext;
    }
  }
  scr_str_release(r->url);
  r->url = fs_url_serialize(t->url);
  r->redirected = t->redirected;
  {
    /* Header names arrive in wire case; the Headers object stores them
     * lowercased so `.get('Content-Type')` and `.get('content-type')`
     * cannot disagree. */
    ScrArr *raw = scr_http_req_raw_headers(res);
    size_t nraw = (size_t)scr_arr_len(raw);
    ScrArr *pairs = scr_arr_new(SCR_ELEM_STR, nraw);
    for (size_t i = 0; i + 1 < nraw; i += 2) {
      ScrStr *nm = (ScrStr *)scr_arr_get_ref(raw, (double)i);
      ScrStr *lo = fs_lower(nm);
      scr_str_release(nm);
      scr_arr_push_ref(pairs, lo);
      scr_arr_push_ref(pairs, scr_arr_get_ref(raw, (double)(i + 1)));
    }
    scr_arr_release(raw);
    r->headers = fs_headers_new_owned(pairs);
  }

  t->resp = r; /* the constructor's +1 */
  ScrPromise *p = t->promise;
  t->promise = NULL;
  if (p != NULL) {
    scr_promise_fulfill_ref(p, r, &scr_response_retain_v, &scr_response_release_v, &scr_response_trace_v);
    scr_promise_release(p);
  }

  scr_http_req_on_data(res, fs_closure(t, (void *)&fs_on_data), &fs_on_data, false);
  scr_http_req_on_end(res, fs_closure(t, (void *)&fs_on_end), false);
  scr_http_req_on_error(res, fs_closure(t, (void *)&fs_on_res_error), &fs_on_res_error, false);

  scr_http_req_release(res);
  fs_release(t);
}

/* Pre-response failure: classify into Node's codes exactly as
 * scr_fetch.c does, then reject. */
static void fs_on_client_error(ScrClosure *cb, ScrStr *msg /*borrowed*/) {
  FsTransfer *t = fs_from(cb);
  if (t == NULL) return;
  if (t->done || t->responded) {
    fs_release(t);
    return;
  }
  const char *detail = msg->data;
  const char *code = NULL;
  char codebuf[32];
  if (msg->len > 8 && memcmp(detail, "connect E", 9) == 0) {
    const char *s = detail + 8;
    size_t n = 0;
    while (s[n] != '\0' && s[n] != ' ' && n < sizeof codebuf - 1) n++;
    memcpy(codebuf, s, n);
    codebuf[n] = '\0';
    code = codebuf;
  } else if (msg->len > 12 && memcmp(detail, "getaddrinfo E", 13) == 0) {
    const char *s = detail + 12;
    size_t n = 0;
    while (s[n] != '\0' && s[n] != ' ' && n < sizeof codebuf - 1) n++;
    memcpy(codebuf, s, n);
    codebuf[n] = '\0';
    code = codebuf;
  } else if (fs_lit_ci(detail, msg->len, "socket hang up")) {
    code = "UND_ERR_SOCKET";
  }
  fs_error(t, code);
  fs_release(t);
}

/* ── the entry point ─────────────────────────────────────────────────
 * url/method borrowed; header_pairs borrowed (a flat [name, value, ...]
 * string array, already lowercased by the caller); body borrowed or
 * NULL; signal borrowed or NULL.
 *
 * An unparsable URL, an unsupported scheme, and an ALREADY-ABORTED
 * signal all answer an already-REJECTED promise rather than throwing:
 * that is where Node puts every one of them (fetch never throws
 * synchronously). */
ScrPromise *scr_fetch_start(ScrStr *url /*borrowed*/, ScrStr *method /*borrowed*/,
                            ScrArr *header_pairs /*borrowed*/, ScrBytes *body /*borrowed, nullable*/,
                            void *signal /*borrowed, nullable*/) {
  ScrPromise *p = scr_promise_new();

  if (signal != NULL && fs_signal_aborted != NULL && fs_signal_aborted(signal)) {
    ScrError *e = fs_signal_error(signal);
    scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
    scr_error_release(e);
    scr_promise_reject_pending(p);
    return p;
  }

  ScrUrl *u = fs_url_parse(url);
  if (u == NULL || !(fs_str_is(u->scheme, "http") || fs_str_is(u->scheme, "https"))) {
    if (u != NULL) scr_url_release(u);
    ScrError *e = fs_failure(u == NULL ? "ERR_INVALID_URL" : "ERR_UNSUPPORTED_PROTOCOL");
    scr_throw_obj(e, &scr_error_retain_v, &scr_error_release_v, scr_error_trace_arg());
    scr_error_release(e);
    scr_promise_reject_pending(p);
    return p;
  }

  FsTransfer *t = calloc(1, sizeof *t);
  if (t == NULL) fs_oom();
  t->rc = 1; /* the registry's */
  t->promise = scr_promise_retain(p);
  t->method = method != NULL && method->len > 0 ? scr_str_retain(method) : scr_str_new("GET", 3);
  t->headers = scr_arr_retain(header_pairs);
  t->body = body != NULL ? scr_bytes_retain(body) : NULL;
  t->url = u;
  t->signal = signal != NULL && fs_signal_retain != NULL ? fs_signal_retain(signal) : NULL;
  t->next = fs_live;
  fs_live = t;
  fs_nlive++;

  fs_start_hop(t);
  return p;
}

/* Build the wire header list from a checked-dynamic record/object: every
 * own key, lowercased, with its value stringified. NULL is an empty list.
 * Non-object values are the caller's fence, not ours. */
ScrArr *scr_fetch_headers_from_dyn(const ScrDyn *d /*borrowed, nullable*/) {
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, 8);
  if (d == NULL) return out;
  ScrDyn *keys = scr_dyn_obj_keys(d);
  if (keys == NULL) return out;
  double n = scr_dyn_arr_len(keys);
  ScrStr *enc = scr_str_new("utf8", 4);
  for (double i = 0; i < n; i += 1) {
    ScrDyn *k = scr_dyn_arr_at(keys, i);
    if (k == NULL || k->kind != SCR_DYN_STR) continue;
    ScrDyn *v = scr_dyn_obj_get(d, k->v.str->data, k->v.str->len);
    if (v == NULL || v->kind == SCR_DYN_UNDEF || v->kind == SCR_DYN_NULL) continue;
    ScrStr *lo = fs_lower(k->v.str);
    ScrStr *vs = scr_dyn_to_string(v, enc);
    scr_arr_push_ref(out, lo);
    scr_arr_push_ref(out, vs);
  }
  scr_str_release(enc);
  scr_dyn_release(keys);
  return out;
}

/* Lowercases a caller-built flat pairs array in place of a copy (+1). The
 * object-literal lowering builds names as written; the wire and the
 * Headers view both want them folded. */
ScrArr *scr_fetch_headers_normalize(ScrArr *pairs /*borrowed*/) {
  size_t n = (size_t)scr_arr_len(pairs);
  ScrArr *out = scr_arr_new(SCR_ELEM_STR, n);
  for (size_t i = 0; i + 1 < n; i += 2) {
    ScrStr *nm = (ScrStr *)scr_arr_get_ref(pairs, (double)i);
    ScrStr *lo = fs_lower(nm);
    scr_str_release(nm);
    scr_arr_push_ref(out, lo);
    scr_arr_push_ref(out, scr_arr_get_ref(pairs, (double)(i + 1)));
  }
  return out;
}

size_t scr_fetch_live_count(void) { return fs_nlive; }
