/* Async runtime: promises, the microtask queue and a dependency-free event
 * loop (microtask queue + timer min-heap).
 *
 * Model (see docs/ir.md):
 * - An async function's body is a state machine over a heap frame (scr_coro.c). Calling it runs the body EAGERLY until the first
 *   suspension (JS's synchronous-prefix rule), then control returns to the caller with a +1 promise. There are no fibers and no
 *   separate stacks: everything runs on the process stack.
 * - `await` on a pending promise parks the frame on the promise's waiter list. Fulfillment moves waiters to the microtask queue
 *   (microtasks run before timers, like Node).
 * - A throw escaping an async body rejects its promise; awaiting a rejected promise re-throws into the awaiter.
 * - Loop exhaustion with still-suspended frames exits normally (Node's behavior); those frames are deliberately not unwound, and the
 *   RC audit downgrades to a note in that case.
 */
#define _XOPEN_SOURCE 700
#ifndef _DEFAULT_SOURCE
#define _DEFAULT_SOURCE 1 /* madvise and MADV_* under glibc, which _XOPEN_SOURCE alone hides */
#endif
#include "scr_runtime.h"
#include "scr_coro.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
/* Windows arm: the idle sleep is nanosleep (mingw-w64 ships
 * it, over Sleep). poll(2) has no Windows arm — see the sleep seam in
 * scr_loop_run: the poller-backed units (net/dgram/watch) are not built
 * for win32 targets (cc.ts gates them), so their fds never appear; the
 * events unit DOES cross-compile (scr_events.c's win32 arm) and is
 * served by a capped nanosleep — dispatch at the next turn's top, the
 * cap bounding signal/stdin latency instead of a pollable wake fd. */
#include <windows.h>
/* _get_heap_handle (the CRT heap the runtime's malloc actually reaches)
 * and GetProcessMemoryInfo, both for the idle-seam heap trim below.
 * GetProcessMemoryInfo resolves to K32GetProcessMemoryInfo in
 * kernel32.dll under psapi.h's default PSAPI_VERSION 2, so this adds no
 * library to the link line. */
#include <malloc.h>
#include <psapi.h>
#else
#include <poll.h>
#include <signal.h>
#ifdef __GLIBC__
#include <malloc.h> /* malloc_trim, the posix arm of the idle-seam trim */
#endif
#include <sys/mman.h>
#ifndef MAP_NORESERVE
#define MAP_NORESERVE 0
#endif
#include <unistd.h>
#endif


/* ── promises ─────────────────────────────────────────────────────────── */

enum { SCR_PROM_PENDING = 0, SCR_PROM_FULFILLED = 1, SCR_PROM_REJECTED = 2 };

typedef struct ScrFiber ScrFiber;

struct ScrPromise {
  size_t rc;
  int state;
  /* Payload (fulfillment value or rejection reason), ScrExcCell-style.
   * The payload's trace function is non-NULL iff the REF payload type carries a cycle header
   * (a promise settled with a cycle-capable value can be a cycle member —
   * e.g. a closure that captures a box holding this very promise). */
  ScrExcKind payload_kind; /* NONE = void fulfillment */
  /* A scalar payload is EITHER an f64 or a bool, by payload_kind, never both:
   * one word. Writers set the member the kind names; readers read by kind. */
  union {
    double f64;
    bool b;
  };
  void *payload;
  /* Fibers parked on this promise, in registration order. Nearly every awaited
   * promise has exactly ONE waiter, so the first lives INLINE in this word: with
   * nwaiters == 1 `w1` is the waiter, with nwaiters >= 2 `wv` is a malloc'd
   * vector of waiters_cap entries holding all of them, with 0 there is neither
   * (settle frees the vector). Same offset and size as the old pointer, so a
   * promise nobody awaits pays nothing and a single-awaiter one skips the
   * 4-entry array malloc. Reach it only through scr_prom_wadd/wat/wdrain. */
  union {
    ScrFiber *w1;
    ScrFiber **wv;
  };
  /* retain/release/trace of a REF payload, as one interned triple (ScrPromVt)
   * named by a 32-bit index; 0 = none. These are per-TYPE facts, so they were 24
   * bytes of per-instance pointers. */
  uint32_t vt;
  uint32_t nwaiters, waiters_cap;
  /* Unhandled-rejection tracking: set when rejected, cleared on await. */
  bool rejection_observed;
  /* Set when the checkpoint report delivered THIS promise to
   * 'unhandledRejection' listeners — a handler attached after that is
   * Node's 'rejectionHandled' moment (scr_prom_observe below). */
  bool reported_unhandled;
  /* Rare members behind ONE lazy pointer (see ScrPromiseExt below): nearly every
   * promise has none of a pending claim alias, combinator callbacks or conversion
   * memos, so inline they cost 56 bytes on each. NULL until first needed; freed with
   * the promise. */
  struct ScrPromiseExt *ext;
};

_Static_assert(sizeof(struct ScrPromise) == 64, "ScrPromise layout");

/* The rare members of a promise. */
struct ScrPromiseExt {
  /* A pending declaration-claimed promise parks its reactions on its SOURCE's
   * lists (scr_promise_claim): Node keeps one reaction list, in registration
   * order. Owned (+1, traced: the pair is a cycle while the source is pending),
   * only followed while this promise is pending, dropped when the claim settles. */
  ScrPromise *alias;
  /* Combinator callbacks (Promise.race / Promise.all): at settle,
   * fulfilled promises run adapt(dst, this) — an emitted adapter
   * converting the payload into the destination's inner type — and
   * rejections copy raw (reasons are dynamically tagged). Each entry owns
   * a reference on its dst. Promise.all entries carry the shared
   * countdown state (`all` non-NULL, `all_idx` the entry's INPUT index);
   * race entries leave both zeroed and keep the adapt dispatch. */
  struct ScrPromiseCbWaiter {
    void (*adapt)(ScrPromise *dst, ScrPromise *src);
    ScrPromise *dst;
    struct ScrAllState *all;
    size_t all_idx;
    /* A payload-CLAIM waiter (scr_promise_claim): non-NULL runs the
     * conversion closure on the fulfilled source INSIDE its settle. */
    ScrClosure *conv;
    /* How many direct waiters were already parked when this callback registered:
     * the settle replays both lists in registration order (Node keeps ONE
     * reaction list per promise). */
    size_t wpos;
    /* Non-NULL when this callback sits on ANOTHER promise's list on behalf of
     * `via` (a pending claim aliases its source's reaction list): it consumes
     * `via`, not the list's owner. +1. */
    struct ScrPromise *via;
  } *cbs;
  uint32_t ncbs, cbs_cap;
  /* Payload-conversion memo (scr_runtime.h states the contract): the
   * adapted promises this one has already been converted into, keyed by
   * the lowerer's adapter id. NULL for every promise in a program that
   * never converts a payload -- one pointer, no allocation. Entries are
   * OWNED (+1) and traced. */
  struct ScrPromiseAdapt *adapts;
  /* How many of the awaits still owed on this promise belong to a
   * PAYLOAD-CONVERSION ADAPTER rather than to the source program. One per
   * adapter filed in `adapts` (each adapter awaits its source exactly
   * once, by construction of promiseCoerceAdapter), decremented by the
   * first observation that arrives. See scr_prom_observe. */
  unsigned adapter_observes_pending;
};

static void scr_oom(void);


/* Append waiter `f` to `p`. */
static inline void scr_prom_wadd(ScrPromise *p, ScrFiber *f) {
  uint32_t n = p->nwaiters;
  if (n == 0) {
    p->w1 = f;
  } else if (n == 1) {
    ScrFiber **v = (ScrFiber **)malloc(4 * sizeof *v);
    if (!v) scr_oom();
    v[0] = p->w1;
    v[1] = f;
    p->wv = v;
    p->waiters_cap = 4;
  } else {
    if (n == p->waiters_cap) {
      p->waiters_cap *= 2;
      p->wv = (ScrFiber **)realloc(p->wv, p->waiters_cap * sizeof *p->wv);
      if (!p->wv) scr_oom();
    }
    p->wv[n] = f;
  }
  p->nwaiters = n + 1;
}

/* Waiter `i` of a list of `n` held as (w1|wv). */
static inline ScrFiber *scr_prom_wat(ScrFiber *w1, ScrFiber **wv, size_t n, size_t i) {
  return n == 1 ? w1 : wv[i];
}

/* Free the vector a promise being torn down still owns. */
static inline void scr_prom_wfree(ScrPromise *p) {
  if (p->nwaiters >= 2) free(p->wv);
}

static inline struct ScrPromiseExt *scr_prom_xmk(ScrPromise *p) {
  if (p->ext == NULL) {
    p->ext = (struct ScrPromiseExt *)calloc(1, sizeof *p->ext);
    if (!p->ext) scr_oom();
  }
  return p->ext;
}

/* Interned (retain, release, trace) triples of REF payloads. A program has a few
 * dozen distinct payload types, so the table is tiny and the lookup is a
 * direct-mapped cache in front of a linear scan. Index 0 is the empty triple. */
typedef struct ScrPromVt {
  void *(*retain)(void *);
  void (*release)(void *);
  ScrTraceFn trace;
} ScrPromVt;
static ScrPromVt *scr_prom_vt_tab;
static uint32_t scr_prom_vt_n = 1, scr_prom_vt_cap = 0;
static struct { void *(*r)(void *); void (*l)(void *); ScrTraceFn t; uint32_t vt; } scr_prom_vt_cache[32];
static ScrPromVt scr_prom_vt_zero;
#define PV(p) (scr_prom_vt_tab ? &scr_prom_vt_tab[(p)->vt] : &scr_prom_vt_zero)
/* The scalar payload is ONE word shared by the f64 and bool members, so a reader that does not match the settle kind
 * reads the wrong member. Every reader below is reached with the matching kind (the emitter picks the accessor from the
 * promise's static type, the dyn adapters switch on the kind); the audit lane (--sanitize) checks it. A settled-void
 * promise (NONE) reads as zero, as it always did. */
#ifdef SCR_RC_AUDIT
#define SCR_PROM_SCALAR_KIND(p, want)                                                                \
  do {                                                                                                \
    if ((p)->payload_kind != (want) && (p)->payload_kind != SCR_EXC_NONE)                             \
      scr_trap("scriptc: internal error: promise scalar payload read as the wrong kind\n");          \
  } while (0)
#else
#define SCR_PROM_SCALAR_KIND(p, want) ((void)0)
#endif
static uint32_t scr_prom_vt_intern(void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  if (retain == NULL && release == NULL && trace == NULL) return 0;
  size_t h = (((uintptr_t)release >> 4) ^ ((uintptr_t)retain >> 3)) & 31u;
  if (scr_prom_vt_cache[h].r == retain && scr_prom_vt_cache[h].l == release && scr_prom_vt_cache[h].t == trace &&
      scr_prom_vt_cache[h].vt)
    return scr_prom_vt_cache[h].vt;
  uint32_t i;
  for (i = 1; i < scr_prom_vt_n; i++) {
    if (scr_prom_vt_tab[i].retain == retain && scr_prom_vt_tab[i].release == release && scr_prom_vt_tab[i].trace == trace) break;
  }
  if (i == scr_prom_vt_n) {
    if (scr_prom_vt_n >= scr_prom_vt_cap) {
      scr_prom_vt_cap = scr_prom_vt_cap ? scr_prom_vt_cap * 2 : 64;
      scr_prom_vt_tab = (ScrPromVt *)realloc(scr_prom_vt_tab, (size_t)scr_prom_vt_cap * sizeof *scr_prom_vt_tab);
      if (!scr_prom_vt_tab) scr_oom();
      memset(&scr_prom_vt_tab[0], 0, sizeof scr_prom_vt_tab[0]);
    }
    scr_prom_vt_tab[i].retain = retain;
    scr_prom_vt_tab[i].release = release;
    scr_prom_vt_tab[i].trace = trace;
    scr_prom_vt_n++;
  }
  scr_prom_vt_cache[h].r = retain; scr_prom_vt_cache[h].l = release; scr_prom_vt_cache[h].t = trace; scr_prom_vt_cache[h].vt = i;
  return i;
}

/* One payload-conversion memo entry: see the contract on
 * scr_promise_adapt_has in scr_runtime.h. */
typedef struct ScrPromiseAdapt {
  struct ScrPromiseAdapt *next;
  double id;
  ScrPromise *adapted; /* owned +1 */
} ScrPromiseAdapt;

static void scr_promise_adapts_free(ScrPromise *p, bool release);

#ifdef SCR_RC_AUDIT
static long scr_live_promises = 0;
long scr_promise_live_count(void) { return scr_live_promises; }
#endif

/* ── Promise.all shared state ─────────────────────────────────────────
 * One per Promise.all call: the values array filled per INPUT index as
 * entries fulfill, the countdown of fulfillments still missing, and the
 * per-element-kind store helper. The state holds +1 on `values` (NULL for
 * void-element all) and is itself refcounted by the entries that still
 * point at it (parked cb waiters plus the builder while it subscribes);
 * the RESULT promise is NOT held here — each parked entry's cb.dst is the
 * retained result, so promise teardown paths need no all-specific
 * destination handling. */
typedef struct ScrAllState {
  size_t rc;
  size_t remaining;
  ScrArr *values;
  void (*store)(ScrArr *a, double i, ScrPromise *src);
} ScrAllState;

static void scr_promise_all_state_release(ScrAllState *st) {
  if (--st->rc == 0) {
    if (st->values) scr_arr_release(st->values);
    free(st);
  }
}

static void scr_oom(void) {
  fputs("scriptc: out of memory\n", stderr);
  abort();
}

static void scr_promise_trace(void *o, ScrTraceVisit visit, void *ctx) {
  ScrPromise *p = (ScrPromise *)o;
  /* Waiters are fibers (not refcounted objects) — the settled payload and
   * the combinator destinations are the strong references this promise
   * owns (destination promises are cycle-headered). */
  if ((p->payload_kind == SCR_EXC_REF || p->payload_kind == SCR_EXC_OBJ) &&
      PV(p)->trace) {
    visit(p->payload, ctx);
  }
  struct ScrPromiseExt *x = p->ext;
  if (x == NULL) return;
  if (x->alias) visit(x->alias, ctx);
  for (size_t i = 0; i < x->ncbs; i++) {
    visit(x->cbs[i].dst, ctx);
    if (x->cbs[i].via) visit(x->cbs[i].via, ctx);
  }
  /* Memo entries are strong and cycle-headered, and the pair IS a
   * cycle while the adapter's fiber still holds the source, so the
   * collector has to be able to see this edge. */
  for (ScrPromiseAdapt *a = x->adapts; a; a = a->next) visit(a->adapted, ctx);
}

/* Teardown for the collector: release the payload only when the trace does
 * NOT visit it (the complement — see the contract in scr_runtime.h). The
 * cb destinations are always visited, so only the array frees here. */
static void scr_promise_gcfree(void *o) {
  ScrPromise *p = (ScrPromise *)o;
  if (p->payload_kind == SCR_EXC_STR) {
    scr_str_release((ScrStr *)p->payload);
  } else if ((p->payload_kind == SCR_EXC_REF || p->payload_kind == SCR_EXC_OBJ) &&
             p->payload && !PV(p)->trace) {
    PV(p)->release(p->payload);
  }
  /* Parked Promise.all states are NOT traced children (their values array
   * is reachable only through them) — release like the untraced payload
   * above; the cb destinations stay untouched (trace visits them). */
  if (p->ext != NULL) {
    for (size_t i = 0; i < p->ext->ncbs; i++) {
      if (p->ext->cbs[i].all) scr_promise_all_state_release(p->ext->cbs[i].all);
      if (p->ext->cbs[i].conv) scr_closure_release(p->ext->cbs[i].conv);
    }
    /* Memo entries ARE visited by the trace, so only the spine frees
     * here -- the collector owns the adapted promises' releases. */
    scr_promise_adapts_free(p, false);
    free(p->ext->cbs);
    free(p->ext);
    p->ext = NULL;
  }
  scr_prom_wfree(p);
#ifdef SCR_RC_AUDIT
  scr_live_promises--;
#endif
  scr_cyc_free(p);
}

ScrPromise *scr_promise_new(void) {
  ScrPromise *p = scr_cyc_alloc(sizeof *p, &scr_promise_trace, &scr_promise_gcfree);
  p->rc = 1;
#ifdef SCR_RC_AUDIT
  scr_live_promises++;
#endif
  return p;
}

/* The 'rejectionHandled' hook (scr_async_dyn.c installs it at listener
 * registration — the scr_urj_deliver_fn pattern, so listener-free
 * binaries keep their size class): called when a promise the checkpoint
 * report already delivered as unhandled gains a handler. */
bool (*scr_rjh_notify_fn)(ScrPromise *p) = NULL;

/* Node's asyncHandledRejections: promises the checkpoint report already
 * delivered as unhandled, which a handler attached after (scr_prom_observe).
 * The 'rejectionHandled' event waits here (entries +1) for the checkpoint:
 * Node emits it from processPromiseRejections, after the tick and microtask
 * queues drained, so the handler's own reaction (queued by the attach) runs
 * first. */
static ScrPromise **scr_rjh_queue = NULL;
static size_t scr_rjh_nqueue = 0, scr_rjh_qcap = 0;

static void scr_rjh_enqueue(ScrPromise *p) {
  if (scr_rjh_nqueue == scr_rjh_qcap) {
    scr_rjh_qcap = scr_rjh_qcap ? scr_rjh_qcap * 2 : 8;
    scr_rjh_queue = realloc(scr_rjh_queue, scr_rjh_qcap * sizeof *scr_rjh_queue);
    if (!scr_rjh_queue) scr_oom();
  }
  scr_rjh_queue[scr_rjh_nqueue++] = scr_promise_retain(p);
}

/* processPromiseRejections' rejectionHandled half, FIFO. Entries are taken
 * by index: a listener may attach another late handler, which appends (and
 * may move the array). false = a listener threw (the uncaught crash path);
 * the entries after it are kept, the process is ending. */
static bool scr_rjh_flush(void) {
  size_t i = 0;
  bool ok = true;
  while (i < scr_rjh_nqueue && ok) {
    ScrPromise *p = scr_rjh_queue[i++];
    if (scr_rjh_notify_fn != NULL) ok = scr_rjh_notify_fn(p);
    scr_promise_release(p);
  }
  size_t remaining = scr_rjh_nqueue - i;
  if (remaining > 0) memmove(scr_rjh_queue, scr_rjh_queue + i, remaining * sizeof *scr_rjh_queue);
  scr_rjh_nqueue = remaining;
  return ok;
}

/* Every handler attach funnels here: mark the rejection observed, and
 * fire Node's 'rejectionHandled' when the attach arrived AFTER the
 * report delivered this promise to 'unhandledRejection' listeners (the
 * model's one late-handling window — earlier handling keeps the promise
 * out of the report entirely). The flag clears on the first attach, so
 * one report fires at most one 'rejectionHandled' — Node's pairing. */
static void scr_prom_observe(ScrPromise *p) {
  /* Is THIS the await a conversion adapter owes its source? An adapter is
   * not a handler the source program wrote, so it must not make the
   * source's rejection look handled to the program — but it does have to
   * keep the source out of the report, which setting the flag below
   * already does. Counting is what separates the two, and it is exact
   * rather than heuristic: promiseCoerceAdapter's body awaits its source
   * exactly once (the settle-or-value variant's second await is on the
   * awaited VALUE, not on the source), so one credit per filed adapter
   * accounts for every await an adapter will ever perform. Whichever
   * observation arrives first spends the credit — the two are woken from
   * the same settle and their order is not fixed — and any observation
   * beyond the credits is one the program itself wrote. */
  bool by_adapter = false;
  if (p->ext != NULL && p->ext->adapter_observes_pending > 0) {
    p->ext->adapter_observes_pending--;
    by_adapter = true;
  }
  p->rejection_observed = true;
  if (p->reported_unhandled) {
    p->reported_unhandled = false;
    scr_rjh_enqueue(p);
  }
  /* A PAYLOAD-CONVERSION ADAPTER IS THE SAME PROMISE IN THE SOURCE
   * PROGRAM. `const u: Promise<unknown> = a` is an assignment in JS —
   * one object, one rejection, one place to handle it. Here the payload
   * representations differ (`promise<f64>` vs `promise<dyn>`), so the
   * lowerer mints an adapter promise and memoizes it on the source so
   * repeated conversions keep `===`. That adapter is a SECOND promise
   * this runtime tracks, and handling the one the program can name left
   * the other rejected with nobody attached: a spurious
   * "Unhandled promise rejection" and exit 1 where Node exits 0.
   *
   * zapo `infra/perf/PromiseDedup.ts` is the site — `inFlight` is a
   * `Map<string, Promise<unknown>>`, so filing the in-flight promise
   * converts it — and it killed the client at window open on the
   * `requestHistorySync` failure path, where the driver step had already
   * caught the very same error.
   *
   * Propagation is deliberately ONE WAY, source -> adapters, because the
   * other two cases were already right and must not move — both were
   * MEASURED against Node v25.9.0 before this changed, and the first
   * attempt at this fix broke the first of them:
   *   - neither handled (lab/y1): Node reports and exits 1, and so does
   *     this runtime. The source's only observation is the adapter's, it
   *     spends the credit above, nothing propagates, and the adapter is
   *     still there to be reported.
   *   - only the ADAPTER handled (lab/y2): both exit 0.
   * Only "the source was handled, the adapter was not" (lab/x3) was
   * wrong. Recursion terminates on the already-observed flag; an adapter
   * of an adapter is reached through its own list.
   *
   * NOT short-circuited on "already observed": the adapter's await and
   * the program's await are woken from the SAME settlement, so the
   * adapter's frequently lands first and sets the flag. Returning early
   * on it threw the program's own observation away and left every case
   * reporting again — measured, on the first attempt at this. The
   * per-adapter `rejection_observed` test below is what bounds the walk. */
  if (by_adapter) return;
  for (ScrPromiseAdapt *a = p->ext ? p->ext->adapts : NULL; a != NULL; a = a->next) {
    if (a->adapted != NULL && !a->adapted->rejection_observed) {
      scr_prom_observe(a->adapted);
    }
  }
}

/* The attach-time handled mark (scr_async_dyn.c's dyn then/catch with a
 * rejection handler, plus the module loader's ownership of every module
 * evaluation promise): Node marks a promise handled at ATTACH, including
 * while it is still pending, not when a later reaction runs. The pending
 * mark is essential for a module dependency whose importer aborts while
 * evaluating a later sibling — the loader still owns that dependency's
 * eventual rejection, so it must never surface as an unrelated unhandled
 * rejection. */
void scr_promise_mark_handled(ScrPromise *p) {
  scr_prom_observe(p);
}

ScrPromise *scr_promise_retain(ScrPromise *p) {
  if (p && p->rc != SIZE_MAX) {
    p->rc++;
    scr_cyc_mark_live(p);
  }
  return p;
}

static void scr_promise_release_payload(ScrPromise *p) {
  if (p->payload_kind == SCR_EXC_STR) scr_str_release((ScrStr *)p->payload);
  else if ((p->payload_kind == SCR_EXC_REF || p->payload_kind == SCR_EXC_OBJ) &&
           p->payload) PV(p)->release(p->payload);
  p->payload_kind = SCR_EXC_NONE;
  p->payload = NULL;
}

void scr_promise_release(ScrPromise *p) {
  if (!p || p->rc == SIZE_MAX) return;
  if (--p->rc == 0) {
    scr_cyc_on_dead(p);
    scr_promise_release_payload(p);
    scr_prom_wfree(p);
    if (p->ext != NULL) {
      scr_promise_adapts_free(p, true);
      if (p->ext->alias) scr_promise_release(p->ext->alias);
      for (size_t i = 0; i < p->ext->ncbs; i++) {
        scr_promise_release(p->ext->cbs[i].dst);
        if (p->ext->cbs[i].all) scr_promise_all_state_release(p->ext->cbs[i].all);
        if (p->ext->cbs[i].conv) scr_closure_release(p->ext->cbs[i].conv);
        if (p->ext->cbs[i].via) scr_promise_release(p->ext->cbs[i].via);
      }
      free(p->ext->cbs);
      free(p->ext);
      p->ext = NULL;
    }
#ifdef SCR_RC_AUDIT
    scr_live_promises--;
#endif
    scr_cyc_free(p);
  } else {
    scr_cyc_on_release(p); /* possible cycle root; may collect — p is done */
  }
}

/* Drop the memo list. `release` distinguishes the two teardown paths:
 * the refcount path owns the entries' references, the collector path
 * does not (scr_promise_trace visits them -- the complement rule). */
static void scr_promise_adapts_free(ScrPromise *p, bool release) {
  if (p->ext == NULL) return;
  ScrPromiseAdapt *a = p->ext->adapts;
  p->ext->adapts = NULL;
  p->ext->adapter_observes_pending = 0;
  while (a) {
    ScrPromiseAdapt *next = a->next;
    if (release) scr_promise_release(a->adapted);
    free(a);
    a = next;
  }
}

/* The id is the lowerer's per-CONVERSION adapter number, so the key is
 * the (source, adapter) PAIR: two adapters over one source stay two
 * distinct promises, which is what their differing payload
 * representations require. The list is short by construction (one
 * entry per conversion the program actually performs on this value).
 * NaN would never match itself, so an id is never NaN -- the lowerer
 * emits a small non-negative integer. */
static ScrPromiseAdapt *scr_promise_adapt_find(ScrPromise *src, double id) {
  if (!src) return NULL;
  for (ScrPromiseAdapt *a = src->ext ? src->ext->adapts : NULL; a; a = a->next) {
    if (a->id == id) return a;
  }
  return NULL;
}

bool scr_promise_adapt_has(ScrPromise *src, double id) {
  return scr_promise_adapt_find(src, id) != NULL;
}

ScrPromise *scr_promise_adapt_get(ScrPromise *src, double id) {
  ScrPromiseAdapt *a = scr_promise_adapt_find(src, id);
  return a ? scr_promise_retain(a->adapted) : NULL;
}

ScrPromise *scr_promise_adapt_put(ScrPromise *src, double id, ScrPromise *made) {
  /* Filed unconditionally, including on a hypothetical immortal source
   * (nothing mints a promise at rc == SIZE_MAX today). Skipping one would
   * trade a bounded leak for a silent wrong `===`, and the entry count
   * per promise is bounded by the number of conversions the PROGRAM
   * contains, so the unguarded failure mode is a loud audit line. */
  if (src && !scr_promise_adapt_find(src, id)) {
    ScrPromiseAdapt *a = (ScrPromiseAdapt *)malloc(sizeof *a);
    if (!a) scr_oom();
    struct ScrPromiseExt *sx = scr_prom_xmk(src);
    a->next = sx->adapts;
    a->id = id;
    a->adapted = scr_promise_retain(made);
    sx->adapts = a;
    /* One await credit for the adapter just filed (scr_prom_observe). */
    sx->adapter_observes_pending++;
  }
  /* The other order of the same fact: a conversion written AFTER the
   * source was already handled inherits the handling, because in the
   * source program there is only ever the one promise and it is handled.
   * scr_prom_observe cannot see this case — by then the source has no
   * further observation coming, so nothing would propagate. Applied on a
   * memo HIT too: the hit hands back an adapter minted earlier, and the
   * source may have been handled in between. */
  if (src != NULL && src->rejection_observed && made != NULL) {
    made->rejection_observed = true;
  }
  return scr_promise_retain(made);
}

void *scr_promise_retain_v(void *p) { return scr_promise_retain((ScrPromise *)p); }
void scr_promise_release_v(void *p) { scr_promise_release((ScrPromise *)p); }
void scr_promise_trace_v(void *p, ScrTraceVisit visit, void *ctx) {
  scr_promise_trace(p, visit, ctx);
}

/* ── fibers and the scheduler ─────────────────────────────────────────── */

/* THE MICROTASK RECORD. Everything on the ready queue is a stackless envelope: a queueMicrotask closure, a raw hook plus one owned argument
 * (scr_coro_park's resume entry, the async-generator sink), or a parked await's continuation. There are no fibers and no stacks: every
 * async function and generator is a state machine over a heap frame (scr_coro.c), so the queue holds exactly these four words. */
struct ScrFiber {
  /* queueMicrotask entries: the READY queue's FIFO IS the microtask queue, so a closure rides it as an envelope and scr_resume_fiber runs
   * it on the main stack (a throw is an UNCAUGHT exception, like Node's queueMicrotask, never a rejection). Owned. */
  ScrClosure *micro_cb;
  /* The runtime's OWN envelope: a raw hook plus one owned argument. Owned: the envelope releases `micro_arg` through `micro_arg_release`. */
  void (*micro_raw)(void *);
  void *micro_arg;
  void (*micro_arg_release)(void *);
};

/* A zeroed envelope. */
static ScrFiber *scr_envelope_new(void) {
  ScrFiber *f = calloc(1, sizeof *f);
  if (!f) scr_oom();
  return f;
}

/* ── AsyncLocalStorage (node:async_hooks) ─────────────────────────────
 * Stores are process-lived ids; the CONTEXT is an immutable refcounted
 * snapshot of (store id → dyn value) entries. One ACTIVE SLOT pointer
 * (the exc-cell pattern): main owns a static slot, every fiber owns its
 * own field, scr_switch repoints the active slot — so run()'s window
 * rides the fiber across awaits, and a spawned fiber INHERITS the
 * spawner's snapshot (Node's init-time capture through AsyncResource).
 * Snapshots are immutable: enter builds a fresh one (entries retained),
 * restore swaps the previous back — timer capture retains pointers. */

/* The ScrAlsCtx layout and the API over it live in scr_runtime.h /
 * scr_async_dyn.c (gated — the size-class stance); this always-linked
 * core keeps only what the fiber machinery itself touches: the active
 * slot, the snapshot RC pair, and the switch/spawn/destroy wiring. */
static ScrAlsCtx *scr_als_main_slot = NULL;
ScrAlsCtx **scr_als_active = &scr_als_main_slot;

ScrAlsCtx *scr_als_ctx_retain(ScrAlsCtx *c) {
  if (c) c->rc++;
  return c;
}

void scr_als_ctx_release(ScrAlsCtx *c) {
  if (!c || --c->rc != 0) return;
  for (size_t i = 0; i < c->len; i++) scr_dyn_release(c->entries[i].value);
  free(c);
}



static long scr_fibers_live = 0;
static long scr_fibers_abandoned = 0;

long scr_abandoned_fiber_count(void) { return scr_fibers_abandoned; }


/* Microtask queue: ready fibers, FIFO. */
static ScrFiber **scr_ready = NULL;
static size_t scr_ready_head = 0, scr_ready_len = 0, scr_ready_cap = 0;

static void scr_ready_push(ScrFiber *f) {
  if (scr_ready_head + scr_ready_len == scr_ready_cap) {
    memmove(scr_ready, scr_ready + scr_ready_head, scr_ready_len * sizeof *scr_ready);
    scr_ready_head = 0;
    if (scr_ready_len == scr_ready_cap) {
      scr_ready_cap = scr_ready_cap ? scr_ready_cap * 2 : 16;
      scr_ready = realloc(scr_ready, scr_ready_cap * sizeof *scr_ready);
      if (!scr_ready) scr_oom();
    }
  }
  scr_ready[scr_ready_head + scr_ready_len++] = f;
}

/* Timer min-heap, FIFO tiebreak via sequence numbers. `id` is nonzero only
 * for setInterval entries (the clearInterval handle; setTimeout has no
 * clear surface, so plain timeouts never need one) and `repeat_ms` is the
 * interval's period — a fired interval re-enters the heap with a fresh
 * deadline and seq, so ties against later timers stay FIFO like Node's. */
typedef struct {
  double deadline_ms;
  unsigned long seq;
  ScrClosure *cb; /* owned */
  double repeat_ms;
  unsigned long id;
  bool reffed;     /* keeps the loop alive; unref() clears it (Node semantics) */
  double delay_ms; /* the original delay — refresh() re-arms to now + this */
} ScrTimer;

static ScrTimer *scr_timers = NULL;
static size_t scr_ntimers = 0, scr_timers_cap = 0;
/* Pending timer entries are mirrored into scr_object.c after every change of
 * the heap size: the RC audit reads the count at exit from an always-linked
 * unit, so a link that omits this file still resolves it (see scr_timers_live_set). */
#ifdef SCR_RC_AUDIT
#define SCR_TIMERS_MIRROR() scr_timers_live_set((long)scr_ntimers)
#else
#define SCR_TIMERS_MIRROR() ((void)0)
#endif
static unsigned long scr_timer_seq = 0;
/* REF'd armed timers — the loop's timer-liveness count (an unref'd timer
 * sits in the heap and still FIRES if the loop runs for other reasons, but
 * does not by itself keep the loop alive). Kept in sync by push/pop/remove
 * and by ref/unref. */
static size_t scr_reffed_timers = 0;

/* Exported: the island's timer machinery (scr_web.c) shares this clock so
 * its deadlines are comparable with the loop's. */
double scr_now_ms(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6;
}

static bool scr_timer_before(const ScrTimer *a, const ScrTimer *b) {
  if (a->deadline_ms != b->deadline_ms) return a->deadline_ms < b->deadline_ms;
  return a->seq < b->seq;
}

/* ── fatal-exit handle accounting (RC audit builds only) ─────────────
 * A fatal exit (an uncaught throw from top-level code or from a loop
 * callback, a fatal module root) ends the process with whatever the loop
 * still queues: Node drops its timers, immediates and ticks and exits
 * with the failure status. Loop exhaustion releases them; the fatal
 * returns skip that release, so the audit read every abandoned timer,
 * immediate, tick and fs.stat callback (a zero-delay timer) as a leak and
 * replaced the program's status with 99. This hook releases them at exit,
 * and only when the exit status is non-zero: a drained loop already
 * released everything, so a normal exit is audited exactly as before.
 * Shipping builds are untouched.
 *
 * Registered on the first arm, not at init: atexit is LIFO, so a hook
 * registered after scr_init's audit runs before it. Init cannot name this
 * unit, because the audit's own unit is link-gated in test subsets. */
#ifdef SCR_RC_AUDIT
static bool scr_abandon_registered = false;
static void scr_abandon_at_exit(void) {
  if (scr_exit_code_hint_get() == 0) return;
  scr_timers_teardown();
  scr_children_teardown();
}
void scr_abandon_arm(void) {
  if (scr_abandon_registered) return;
  scr_abandon_registered = true;
  atexit(scr_abandon_at_exit);
}
#endif

static void scr_timer_push(ScrTimer t) {
  scr_abandon_arm();
  if (scr_ntimers == scr_timers_cap) {
    scr_timers_cap = scr_timers_cap ? scr_timers_cap * 2 : 16;
    scr_timers = realloc(scr_timers, scr_timers_cap * sizeof *scr_timers);
    if (!scr_timers) scr_oom();
  }
  if (t.reffed) scr_reffed_timers++;
  size_t i = scr_ntimers++;
  SCR_TIMERS_MIRROR();
  scr_timers[i] = t;
  while (i > 0) {
    size_t parent = (i - 1) / 2;
    if (!scr_timer_before(&scr_timers[i], &scr_timers[parent])) break;
    ScrTimer tmp = scr_timers[i];
    scr_timers[i] = scr_timers[parent];
    scr_timers[parent] = tmp;
    i = parent;
  }
}

static ScrTimer scr_timer_pop(void) {
  ScrTimer top = scr_timers[0];
  if (top.reffed && scr_reffed_timers > 0) scr_reffed_timers--;
  scr_timers[0] = scr_timers[--scr_ntimers];
  SCR_TIMERS_MIRROR();
  size_t i = 0;
  for (;;) {
    size_t l = 2 * i + 1, r = 2 * i + 2, min = i;
    if (l < scr_ntimers && scr_timer_before(&scr_timers[l], &scr_timers[min])) min = l;
    if (r < scr_ntimers && scr_timer_before(&scr_timers[r], &scr_timers[min])) min = r;
    if (min == i) break;
    ScrTimer tmp = scr_timers[i];
    scr_timers[i] = scr_timers[min];
    scr_timers[min] = tmp;
    i = min;
  }
  return top;
}

/* ── process warnings: the default stderr report ──────────────────────
 * Always linked: the timer core raises Node's delay warnings from every
 * setTimeout/setInterval entry point. The report is Node's onWarning line
 * ("(node:pid) [CODE] Name: message", the detail line, and the one-time
 * trace hint). The 'warning' listeners live in scr_async_dyn.c and register
 * a hook here when the first one is added, so a program with no listener
 * never links the dyn core for a timer warning. */
#ifdef _WIN32
#include <process.h>
#define SCR_WARN_PID() ((long)_getpid())
#else
#define SCR_WARN_PID() ((long)getpid())
#endif

static void (*scr_warn_listener_hook)(const char *name, const char *msg) = NULL;

void scr_warn_set_listener_hook(void (*hook)(const char *name, const char *msg)) {
  scr_warn_listener_hook = hook;
}

void scr_warn_report(const char *name, const char *code, const char *msg, const char *detail) {
  fflush(stdout);
  fprintf(stderr, "(node:%ld) ", SCR_WARN_PID());
  if (code) fprintf(stderr, "[%s] ", code);
  fprintf(stderr, "%s: %s", name, msg);
  if (detail) fprintf(stderr, "\n%s", detail);
  fputc('\n', stderr);
  /* process.traceDeprecation: Node prints `warning.stack` (the header line, then the frames) and no hint. A compiled binary
   * keeps no call stacks, so only the header line exists here (the frames are an OPEN difference). */
  if (strcmp(name, "DeprecationWarning") == 0 && scr_process_dep_flag_truthy(2)) return;
  /* Node's one-time trace hint, after the first report. Node names the flag
   * by the FIRST report's kind and prints it once. */
  static bool hinted = false;
  if (!hinted) {
    hinted = true;
    fputs(strcmp(name, "DeprecationWarning") == 0
              ? "(Use `node --trace-deprecation ...` to show where the warning was created)\n"
              : "(Use `node --trace-warnings ...` to show where the warning was created)\n",
          stderr);
  }
}

/* ── timer delay warnings (Node's Timeout constructor) ────────────────
 * lib/internal/timers.js validates the delay of every Timeout it builds
 * (global and node:timers setTimeout/setInterval, node:timers/promises,
 * scheduler.wait, the checked-dynamic values):
 *   delay > 2^31-1  -> TimeoutOverflowWarning   (every call)
 *   delay < 0       -> TimeoutNegativeWarning   (ONCE per process)
 *   delay is NaN    -> TimeoutNaNWarning        (ONCE per process)
 * The two once flags are module-level in Node and shared by every entry
 * point. The warning is process.emitWarning, which defers its dispatch
 * with nextTick AT THE CALL, so it rides the user tick queue in call
 * order. undefined never reaches here (Node: 1, silent); 0 and fractions
 * below 1 coerce silently. The clamp to 1 is scr_timer_coerce_ms's. */
static bool scr_timer_warned_negative = false;
static bool scr_timer_warned_nan = false;

/* A queued delay warning: the name is a static string, the message owned. */
typedef struct ScrTimerWarn {
  size_t rc;
  const char *name;
  ScrStr *msg;
} ScrTimerWarn;

static void scr_timer_warn_release(ScrTimerWarn *w) {
  if (--w->rc != 0) return;
  scr_str_release(w->msg);
  free(w);
}

static void *scr_timer_warn_retain_v(void *p) {
  ((ScrTimerWarn *)p)->rc++;
  return p;
}

static void scr_timer_warn_release_v(void *p) { scr_timer_warn_release((ScrTimerWarn *)p); }

/* The queued tick: the default report, then the 'warning' listeners (the
 * hook). The box's get is a +1 released here. */
static void scr_timer_warn_fire(ScrClosure *self) {
  ScrTimerWarn *w = (ScrTimerWarn *)scr_box_get_ref(self->caps[0]);
  scr_warn_report(w->name, NULL, w->msg->data, NULL);
  if (scr_warn_listener_hook != NULL) scr_warn_listener_hook(w->name, w->msg->data);
  scr_timer_warn_release(w);
}

static void scr_timer_delay_warn(double after) {
  const char *name;
  char buf[160];
  char num[32];
  if (after > 2147483647.0) {
    name = "TimeoutOverflowWarning";
    scr_f64_to_str(after, num);
    snprintf(buf, sizeof buf, "%s does not fit into a 32-bit signed integer.\nTimeout duration was set to 1.", num);
  } else if (after < 0) {
    if (scr_timer_warned_negative) return;
    scr_timer_warned_negative = true;
    name = "TimeoutNegativeWarning";
    scr_f64_to_str(after, num);
    snprintf(buf, sizeof buf, "%s is a negative number.\nTimeout duration was set to 1.", num);
  } else if (after != after) {
    if (scr_timer_warned_nan) return;
    scr_timer_warned_nan = true;
    name = "TimeoutNaNWarning";
    snprintf(buf, sizeof buf, "NaN is not a number.\nTimeout duration was set to 1.");
  } else {
    return;
  }
  ScrTimerWarn *w = calloc(1, sizeof *w);
  if (!w) scr_trap("scriptc: out of memory\n");
  w->rc = 1;
  w->name = name;
  w->msg = scr_str_new(buf, strlen(buf));
  ScrClosure *clo = scr_closure_new((void *)scr_timer_warn_fire, 1);
  clo->caps[0] = scr_box_new_obj(scr_timer_warn_retain_v, scr_timer_warn_release_v, NULL);
  scr_box_set_ref(clo->caps[0], w);
  scr_next_tick(clo);
}

/* Node's delay coercion (lib/internal/timers.js): NaN/negative/sub-ms
 * clamp to 1, the delay TRUNCATES to integer milliseconds (setTimeout(cb,
 * 1.8) and setTimeout(cb, 1.1) both land in the 1ms bucket, so a batch of
 * fractional delays fires in REGISTRATION order — test-timers-non-integer-
 * delay's contract), and anything past TIMEOUT_MAX (2^31-1) becomes 1. */
static double scr_timer_coerce_ms(double ms) {
  if (!(ms >= 1)) return 1;
  if (ms > 2147483647.0) return 1; /* past TIMEOUT_MAX (also +Infinity) */
  return (double)(unsigned long long)ms; /* trunc: positive, finite, in range */
}

void scr_set_timeout(ScrClosure *cb, double ms) {
  scr_timer_delay_warn(ms);
  ms = scr_timer_coerce_ms(ms);
  ScrTimer t = {scr_now_ms() + ms, scr_timer_seq++, cb /* ownership moves in */, 0, 0, true, ms};
  scr_timer_push(t);
}

/* ── setInterval / clearInterval ─────────────────────────────────────
 * Intervals ride the same heap: the entry carries its period and a
 * nonzero id (the compiled handle — Node's Timeout object reduced to the
 * number the fallback declarations promise). A live interval keeps the
 * loop alive exactly because it sits in the heap; clearInterval removes
 * the entry EAGERLY (a lazily-cancelled entry would hold the loop open
 * until its deadline — an interval cleared at t=0 with a one-hour period
 * must let the program exit NOW, like Node). Clearing the interval whose
 * callback is currently running (the self-clearing spinner pattern) is
 * handled by the firing pair below: the entry is out of the heap while
 * its callback runs, so the run loop re-pushes it only if the callback
 * did not clear it. */

static unsigned long scr_interval_next_id = 1;
static unsigned long scr_firing_id = 0; /* interval currently running */
static bool scr_firing_cleared = false;
static bool scr_firing_reffed = true;  /* the running interval's ref state */
static bool scr_firing_refresh = false; /* refresh() called mid-callback */

/* Removes heap entry i (swap-with-last, then sift whichever way the moved
 * entry needs). */
static void scr_timer_remove_at(size_t i) {
  if (scr_timers[i].reffed && scr_reffed_timers > 0) scr_reffed_timers--;
  scr_timers[i] = scr_timers[--scr_ntimers];
  SCR_TIMERS_MIRROR();
  if (i >= scr_ntimers) return;
  /* Sift up if the moved entry beats its parent, else sift down. */
  while (i > 0) {
    size_t parent = (i - 1) / 2;
    if (!scr_timer_before(&scr_timers[i], &scr_timers[parent])) break;
    ScrTimer tmp = scr_timers[i];
    scr_timers[i] = scr_timers[parent];
    scr_timers[parent] = tmp;
    i = parent;
  }
  for (;;) {
    size_t l = 2 * i + 1, r = 2 * i + 2, min = i;
    if (l < scr_ntimers && scr_timer_before(&scr_timers[l], &scr_timers[min])) min = l;
    if (r < scr_ntimers && scr_timer_before(&scr_timers[r], &scr_timers[min])) min = r;
    if (min == i) break;
    ScrTimer tmp = scr_timers[i];
    scr_timers[i] = scr_timers[min];
    scr_timers[min] = tmp;
    i = min;
  }
}

double scr_set_interval(ScrClosure *cb, double ms) {
  scr_timer_delay_warn(ms);
  ms = scr_timer_coerce_ms(ms); /* Node's clamp-and-trunc, like setTimeout */
  unsigned long id = scr_interval_next_id++;
  ScrTimer t = {scr_now_ms() + ms, scr_timer_seq++, cb /* ownership moves in */, ms, id, true, ms};
  scr_timer_push(t);
  return (double)id;
}

/* A one-shot timer WITH a clear handle — the island's setTimeout (its
 * clearTimeout must cancel, unlike the static surface's clear-less
 * setTimeout). Rides the interval id space so scr_clear_interval serves
 * both; repeat_ms 0 keeps it one-shot at the firing site. */
double scr_set_timeout_handle(ScrClosure *cb, double ms) {
  scr_timer_delay_warn(ms);
  ms = scr_timer_coerce_ms(ms);
  unsigned long id = scr_interval_next_id++;
  ScrTimer t = {scr_now_ms() + ms, scr_timer_seq++, cb /* ownership moves in */, 0, id, true, ms};
  scr_timer_push(t);
  return (double)id;
}

/* process.env-style timer ref bookkeeping: unref() drops a timer from the
 * loop's liveness count (it still fires if the loop runs on), ref() puts
 * it back. Node-exact for the static timer surface; NaN/0/absent handles
 * are tolerated (never a handle). The one-shot setTimeout with NO clear
 * handle (id 0) cannot be unref'd by id — the compiler routes .unref()
 * only over handle-returning timers, so id 0 never reaches here. */
static ScrTimer *scr_timer_find(unsigned long id) {
  for (size_t i = 0; i < scr_ntimers; i++) {
    if (scr_timers[i].id == id) return &scr_timers[i];
  }
  return NULL;
}

void scr_timer_unref(double handle) {
  if (!(handle >= 1)) return;
  unsigned long id = (unsigned long)handle;
  if (id == scr_firing_id) {
    /* Firing interval unref'ing itself: the re-arm carries the flag. */
    scr_firing_reffed = false;
    return;
  }
  ScrTimer *t = scr_timer_find(id);
  if (t && t->reffed) {
    t->reffed = false;
    if (scr_reffed_timers > 0) scr_reffed_timers--;
  }
}

void scr_timer_ref(double handle) {
  if (!(handle >= 1)) return;
  unsigned long id = (unsigned long)handle;
  if (id == scr_firing_id) {
    scr_firing_reffed = true;
    return;
  }
  ScrTimer *t = scr_timer_find(id);
  if (t && !t->reffed) {
    t->reffed = true;
    scr_reffed_timers++;
  }
}

/* refresh(): re-arm to now + the original delay — Node's Timeout.refresh.
 * A HEAP entry (armed timeout or interval between ticks) re-enters the
 * heap with a fresh deadline and seq (FIFO against later same-deadline
 * timers, like a brand-new timer); the timer whose callback is RUNNING
 * sets the firing flag and the loop re-arms the one-shot after the
 * callback returns (the interval re-arm already does). A one-shot that
 * fired on an earlier turn is gone — its closure released — so refresh
 * of a dead handle is a tolerated no-op (SEMANTICS: Node re-activates
 * even a fired Timeout; the compiled handle cannot). */
void scr_timer_refresh(double handle) {
  if (!(handle >= 1)) return;
  unsigned long id = (unsigned long)handle;
  if (id == scr_firing_id) {
    scr_firing_refresh = true;
    return;
  }
  for (size_t i = 0; i < scr_ntimers; i++) {
    if (scr_timers[i].id == id) {
      ScrTimer t = scr_timers[i];
      scr_timer_remove_at(i);
      t.deadline_ms = scr_now_ms() + t.delay_ms;
      t.seq = scr_timer_seq++;
      scr_timer_push(t);
      return;
    }
  }
}

/* hasRef(): true iff the handle names a live, still-reffed timer. */
bool scr_timer_has_ref(double handle) {
  if (!(handle >= 1)) return false;
  unsigned long id = (unsigned long)handle;
  if (id == scr_firing_id) return scr_firing_reffed;
  ScrTimer *t = scr_timer_find(id);
  return t != NULL && t->reffed;
}

/* ── process.getActiveResourcesInfo (the loop's own bookkeeping) ──────
 * 'Timeout' per armed heap timer — plus the firing, uncleared one (Node
 * counts a Timeout as active while its callback runs, until clearTimeout
 * drops it) — and 'Immediate' per queued, unfired immediate (a FIRED
 * immediate no longer counts, Node's current answer inside the
 * callback). Resource kinds this runtime does not model as loop handles
 * (TCP wraps, FS requests, ...) are absent — SEMANTICS.md names the
 * divergence. Result +1. */
static size_t scr_pending_immediates; /* defined below with the queue */
ScrArr *scr_active_resources(void) {
  ScrArr *arr = scr_arr_new(SCR_ELEM_STR, 8);
  size_t timeouts = scr_ntimers + ((scr_firing_id != 0 && !scr_firing_cleared) ? 1 : 0);
  for (size_t i = 0; i < timeouts; i++) scr_arr_push_ref(arr, scr_str_new("Timeout", 7));
  for (size_t i = 0; i < scr_pending_immediates; i++) scr_arr_push_ref(arr, scr_str_new("Immediate", 9));
  return arr;
}

/* ── process.nextTick (the user tick queue) ───────────────────────────
 * A FIFO of user callbacks drained BEFORE promise jobs at every loop
 * checkpoint, to joint exhaustion with them — Node's tick-then-microtask
 * order. Pending ticks are always-ready work: the loop neither sleeps
 * nor exits while any exist. Ticks scheduled from 'exit' listeners (or
 * left queued on the uncaught paths) never run — the teardown releases
 * them, like Node dropping the queue at exit. */
typedef struct ScrNtick {
  ScrClosure *cb;    /* owned; NULL for a raw C-hook entry */
  void (*raw)(void); /* the hook when cb == NULL (stream tick markers) */
  struct ScrNtick *next;
} ScrNtick;

static ScrNtick *scr_nt_head = NULL;
static ScrNtick *scr_nt_tail = NULL;

/* Public: releases every queued tick without running it — the loop-exit
 * teardown below AND the exit-listener runner (scr_events.c) both call
 * it, because 'exit' listeners run AFTER the loop's teardown and may
 * enqueue ticks that must never run (Node) yet must not leak. */

void scr_next_tick(ScrClosure *cb /*moves*/) {
  scr_abandon_arm();
  ScrNtick *t = calloc(1, sizeof *t);
  if (!t) scr_oom();
  t->cb = cb;
  if (scr_nt_tail) scr_nt_tail->next = t;
  else scr_nt_head = t;
  scr_nt_tail = t;
}

/* A RAW C-hook tick: the stream unit enqueues one marker per deferred
 * stream emission so those emissions interleave with user nextTicks in
 * true FIFO order — in Node they ARE nextTicks (resume_, emitReadable_,
 * endReadableNT, ...). The hook dispatches exactly one stream tick;
 * teardown just drops markers (the stream queue owns its entries). */
void scr_next_tick_raw(void (*fn)(void)) {
  scr_abandon_arm();
  ScrNtick *t = calloc(1, sizeof *t);
  if (!t) scr_oom();
  t->raw = fn;
  if (scr_nt_tail) scr_nt_tail->next = t;
  else scr_nt_head = t;
  scr_nt_tail = t;
}

/* ── process warnings raised by the always-linked core ───────────────
 * Node's process.emitWarning defers its dispatch with nextTick AT THE CALL,
 * so the warning rides the user tick queue in call order. The dispatch is
 * the dyn channel's scr_emit_warning (listeners, then the report) when main
 * installs it, which happens only in dyn-async programs; otherwise the one
 * printer, scr_warn_report, emits the report alone. */

static void (*scr_proc_warn_hook)(const char *name, const char *code, ScrStr *message) = NULL;

void scr_proc_warn_set_hook(void (*fn)(const char *name, const char *code, ScrStr *message)) {
  scr_proc_warn_hook = fn;
}

/* A queued warning: the name is a static string, the message owned. */
typedef struct ScrProcWarn {
  size_t rc;
  const char *name;
  ScrStr *msg;
} ScrProcWarn;

static void scr_proc_warn_release(ScrProcWarn *w) {
  if (--w->rc != 0) return;
  scr_str_release(w->msg);
  free(w);
}

static void *scr_proc_warn_retain_v(void *p) {
  ((ScrProcWarn *)p)->rc++;
  return p;
}

static void scr_proc_warn_release_v(void *p) { scr_proc_warn_release((ScrProcWarn *)p); }

/* The queued tick. The box's get is a +1 released here. */
static void scr_proc_warn_fire(ScrClosure *self) {
  ScrProcWarn *w = (ScrProcWarn *)scr_box_get_ref(self->caps[0]);
  if (scr_proc_warn_hook != NULL) scr_proc_warn_hook(w->name, NULL, w->msg);
  else scr_warn_report(w->name, NULL, w->msg->data, NULL); /* the one printer */
  scr_proc_warn_release(w);
}

/* Defers one process warning to the next tick. name is a static string;
 * msg (len bytes) is copied. */
void scr_proc_warn_defer(const char *name, const char *msg, size_t len) {
  ScrProcWarn *w = calloc(1, sizeof *w);
  if (!w) scr_oom();
  w->rc = 1;
  w->name = name;
  w->msg = scr_str_new(msg, len);
  ScrClosure *clo = scr_closure_new((void *)scr_proc_warn_fire, 1);
  clo->caps[0] = scr_box_new_obj(scr_proc_warn_retain_v, scr_proc_warn_release_v, NULL);
  scr_box_set_ref(clo->caps[0], w);
  scr_next_tick(clo);
}

void scr_nticks_teardown(void) {
  while (scr_nt_head != NULL) {
    ScrNtick *t = scr_nt_head;
    scr_nt_head = t->next;
    if (t->cb) scr_closure_release(t->cb);
    free(t);
  }
  scr_nt_tail = NULL;
}

/* Releases every armed timer — the island teardown calls this before the
 * engine dies so closures holding engine callbacks free first and the
 * counting allocator's zero-live audit holds (the loop only exits with
 * entries still armed on the uncaught/unhandled paths). */
static void scr_immediates_teardown(void);
void scr_timers_teardown(void) {
  for (size_t i = 0; i < scr_ntimers; i++) scr_closure_release(scr_timers[i].cb);
  scr_ntimers = 0;
  SCR_TIMERS_MIRROR();
  scr_reffed_timers = 0;
  scr_immediates_teardown();
  scr_nticks_teardown();
}

void scr_clear_interval(double handle) {
  if (!(handle >= 1)) return; /* NaN/0/negative: never a handle; Node tolerates */
  unsigned long id = (unsigned long)handle;
  if (id == scr_firing_id) {
    scr_firing_cleared = true; /* the run loop drops the callback */
    return;
  }
  for (size_t i = 0; i < scr_ntimers; i++) {
    if (scr_timers[i].id == id) {
      scr_closure_release(scr_timers[i].cb);
      scr_timer_remove_at(i);
      return;
    }
  }
}

/* ── immediates (Node's check phase) ──────────────────────────────────
 * setImmediate callbacks run once per loop turn, AFTER due timers, in
 * FIFO order — and immediates queued while the phase runs wait for the
 * NEXT turn (the phase snapshots its end index). The queue is an
 * append-only array with a head cursor; clearImmediate NULLs the slot in
 * place (order and indices stay stable mid-phase). Ids ride their own
 * space — clearTimeout of an Immediate is a no-op, like Node. */
typedef struct {
  unsigned long id;
  ScrClosure *cb; /* owned; NULL once fired or cleared */
  bool reffed;    /* keeps the loop alive; unref() clears it (Node semantics) */
} ScrImmediate;

static ScrImmediate *scr_immediates = NULL;
static size_t scr_nimmediates = 0, scr_immediates_head = 0, scr_immediates_cap = 0;
static unsigned long scr_immediate_seq = 0;
/* Pending (queued, uncleared) immediates and the reffed subset — the
 * loop's no-sleep signal and liveness count respectively. */
static size_t scr_pending_immediates = 0;
static size_t scr_reffed_immediates = 0;

double scr_set_immediate(ScrClosure *cb) {
  scr_abandon_arm();
  if (scr_nimmediates == scr_immediates_cap) {
    scr_immediates_cap = scr_immediates_cap ? scr_immediates_cap * 2 : 16;
    scr_immediates = realloc(scr_immediates, scr_immediates_cap * sizeof *scr_immediates);
    if (!scr_immediates) scr_oom();
  }
  unsigned long id = ++scr_immediate_seq;
  scr_immediates[scr_nimmediates].id = id;
  scr_immediates[scr_nimmediates].cb = cb; /* ownership moves in */
  scr_immediates[scr_nimmediates].reffed = true;
  scr_nimmediates++;
  scr_pending_immediates++;
  scr_reffed_immediates++;
  return (double)id;
}

static ScrImmediate *scr_immediate_find(unsigned long id) {
  for (size_t i = scr_immediates_head; i < scr_nimmediates; i++) {
    if (scr_immediates[i].id == id && scr_immediates[i].cb != NULL) return &scr_immediates[i];
  }
  return NULL;
}

void scr_clear_immediate(double handle) {
  if (!(handle >= 1)) return; /* NaN/0/negative: never a handle; Node tolerates */
  ScrImmediate *im = scr_immediate_find((unsigned long)handle);
  if (im == NULL) return; /* already fired/cleared: no-op, like Node */
  scr_closure_release(im->cb);
  im->cb = NULL;
  if (scr_pending_immediates > 0) scr_pending_immediates--;
  if (im->reffed) {
    im->reffed = false;
    if (scr_reffed_immediates > 0) scr_reffed_immediates--;
  }
}

/* Immediate.unref()/ref()/hasRef(): the Timeout trio's exact story over
 * the immediate queue. A fired or cleared handle is a tolerated no-op
 * (Node's Immediate methods on a dead handle do nothing). */
void scr_immediate_unref(double handle) {
  if (!(handle >= 1)) return;
  ScrImmediate *im = scr_immediate_find((unsigned long)handle);
  if (im && im->reffed) {
    im->reffed = false;
    if (scr_reffed_immediates > 0) scr_reffed_immediates--;
  }
}

void scr_immediate_ref(double handle) {
  if (!(handle >= 1)) return;
  ScrImmediate *im = scr_immediate_find((unsigned long)handle);
  if (im && !im->reffed) {
    im->reffed = true;
    scr_reffed_immediates++;
  }
}

bool scr_immediate_has_ref(double handle) {
  if (!(handle >= 1)) return false;
  ScrImmediate *im = scr_immediate_find((unsigned long)handle);
  return im != NULL && im->reffed;
}

/* The teardown sweep's immediate arm (called from scr_timers_teardown):
 * unref'd immediates left queued at normal loop exit never fire (Node),
 * so their closures release here or the RC audit counts them as leaks. */
static void scr_immediates_teardown(void) {
  for (size_t i = scr_immediates_head; i < scr_nimmediates; i++) {
    if (scr_immediates[i].cb != NULL) scr_closure_release(scr_immediates[i].cb);
  }
  scr_nimmediates = 0;
  scr_immediates_head = 0;
  scr_pending_immediates = 0;
  scr_reffed_immediates = 0;
}

/* Unhandled rejections: rejected promises retained here until observed. */
static ScrPromise **scr_maybe_unhandled = NULL;
static size_t scr_nunhandled = 0, scr_unhandled_cap = 0;

static void scr_track_rejection(ScrPromise *p) {
  if (scr_nunhandled == scr_unhandled_cap) {
    scr_unhandled_cap = scr_unhandled_cap ? scr_unhandled_cap * 2 : 8;
    scr_maybe_unhandled = realloc(scr_maybe_unhandled, scr_unhandled_cap * sizeof *scr_maybe_unhandled);
    if (!scr_maybe_unhandled) scr_oom();
  }
  scr_maybe_unhandled[scr_nunhandled++] = scr_promise_retain(p);
}

static void scr_promise_settle_wake(ScrPromise *p);

/* Copies src's settlement into a still-pending dst (payload RETAINED —
 * src can settle other destinations and still be awaited) and wakes dst's
 * waiters. A rejection consumed this way counts as HANDLED on src (a
 * combinator attached a handler, like Node's race). The Promise.race
 * same-inner-type adapter and the rejection path both land here. */
static void scr_promise_settle_from(ScrPromise *dst, ScrPromise *src) {
  if (dst->state == SCR_PROM_PENDING) {
    dst->state = src->state;
    dst->payload_kind = src->payload_kind;
    dst->f64 = src->f64; /* the scalar word: an f64 or a bool by kind */
    dst->vt = src->vt;
    dst->payload = NULL;
    if (src->payload_kind == SCR_EXC_STR && src->payload) {
      dst->payload = scr_str_retain((ScrStr *)src->payload);
    } else if ((src->payload_kind == SCR_EXC_REF || src->payload_kind == SCR_EXC_OBJ) &&
               src->payload) {
      dst->payload = PV(src)->retain(src->payload);
    }
    scr_promise_settle_wake(dst);
  }
  if (src->state == SCR_PROM_REJECTED) scr_prom_observe(src);
}

/* The emitted same-type Promise.race adapter (see raceAdapterFor). */
void scr_promise_adapt_copy(ScrPromise *dst, ScrPromise *src) {
  scr_promise_settle_from(dst, src);
}

/* One Promise.all entry settling: a fulfillment stores its payload into
 * the values array at the entry's INPUT index (input order regardless of
 * settlement order) and the LAST missing fulfillment fulfills the result
 * with the array (void-element all fulfills void); a rejection copies raw
 * into the result — the first one in SETTLEMENT order wins through the
 * destination's own pending check, and later ones still count as HANDLED
 * on their entries (settle_from marks them observed), exactly Node's
 * subscribe-to-everything behavior. */
static void scr_promise_all_settle(ScrAllState *st, ScrPromise *result, size_t idx,
                                    ScrPromise *src) {
  if (src->state == SCR_PROM_FULFILLED) {
    if (st->store) st->store(st->values, (double)idx, src);
    if (--st->remaining == 0 && result->state == SCR_PROM_PENDING) {
      if (st->values) {
        scr_promise_fulfill_ref(result, scr_arr_retain(st->values), scr_arr_retain_v,
                                 scr_arr_release_v,
                                 st->values->elem_trace ? scr_arr_trace_v : NULL);
      } else {
        scr_promise_fulfill_void(result);
      }
    }
  } else {
    scr_promise_settle_from(result, src);
  }
}

/* Settle helpers wake waiters into the microtask queue and run the
 * combinator callbacks: adapters for fulfillments (they convert the
 * payload to the destination's inner type), the raw copy for rejections
 * (reasons are dynamically tagged). first-settle-wins rides the
 * destination's own pending check. Promise.all entries dispatch through
 * their shared countdown state instead of the adapt pair. */
/* Where a reaction on `p` is parked: a pending claim shares its source's lists. */
static ScrPromise *scr_prom_reg_target(ScrPromise *p) {
  while (p->state == SCR_PROM_PENDING && p->ext && p->ext->alias) p = p->ext->alias;
  return p;
}

/* A fresh callback entry (zeroed) on `in`'s reaction list, stamped with the
 * waiters already parked there so the settle replays both in order. */
static struct ScrPromiseCbWaiter *scr_prom_cb_add(ScrPromise *in) {
  ScrPromise *t = scr_prom_reg_target(in);
  struct ScrPromiseExt *tx = scr_prom_xmk(t);
  if (tx->ncbs == tx->cbs_cap) {
    tx->cbs_cap = tx->cbs_cap ? tx->cbs_cap * 2 : 4;
    tx->cbs = realloc(tx->cbs, tx->cbs_cap * sizeof *tx->cbs);
    if (!tx->cbs) scr_oom();
  }
  struct ScrPromiseCbWaiter *cb = &tx->cbs[tx->ncbs++];
  memset(cb, 0, sizeof *cb);
  cb->wpos = t->nwaiters;
  cb->via = t != in ? scr_promise_retain(in) : NULL;
  return cb;
}

static void scr_promise_claim_run(ScrPromise *dst, ScrPromise *src, ScrClosure *conv);
static void scr_promise_settle_wake(ScrPromise *p) {
  size_t nw = p->nwaiters, w = 0;
  /* Take the waiter list: p ends with none (a settled promise parks nothing
   * more), and the vector is freed here once the wakes are queued. */
  ScrFiber *w1 = nw == 1 ? p->w1 : NULL;
  ScrFiber **wv = nw >= 2 ? p->wv : NULL;
  p->nwaiters = 0;
  p->waiters_cap = 0;
  p->wv = NULL;
  /* Detach the callback list BEFORE running it. Each entry's dst/via/conv
   * references are dropped as it is processed, and a release inside the loop
   * (or inside the adapter a claim runs) can start a cycle collection; the
   * trace visits p->cbs[0..ncbs), so a still-attached list would show the
   * collector edges already released (counts it does not hold) and it would
   * free a payload another holder still counts. The detached list is held by
   * this frame only (untraced = external counts = conservative), and p ends
   * with no callbacks exactly as before. */
  struct ScrPromiseCbWaiter *cbs = p->ext ? p->ext->cbs : NULL;
  size_t ncbs = p->ext ? p->ext->ncbs : 0;
  if (p->ext != NULL) {
    p->ext->cbs = NULL;
    p->ext->ncbs = 0;
    p->ext->cbs_cap = 0;
  }
  for (size_t i = 0; i < ncbs; i++) {
    for (; w < nw && w < cbs[i].wpos; w++) scr_ready_push(scr_prom_wat(w1, wv, nw, w));
    /* A callback parked here for a claim consumes the CLAIM (already settled: its
     * own callback sits earlier on this list), everything else consumes p. */
    ScrPromise *s = cbs[i].via ? cbs[i].via : p;
    if (cbs[i].all) {
      scr_promise_all_settle(cbs[i].all, cbs[i].dst, cbs[i].all_idx, s);
      scr_promise_all_state_release(cbs[i].all);
    } else if (s->state == SCR_PROM_FULFILLED) {
      if (cbs[i].conv) {
        scr_promise_claim_run(cbs[i].dst, s, cbs[i].conv);
        scr_closure_release(cbs[i].conv);
      } else {
        cbs[i].adapt(cbs[i].dst, s);
      }
    } else {
      scr_promise_settle_from(cbs[i].dst, s);
      if (cbs[i].conv) scr_closure_release(cbs[i].conv);
    }
    if (cbs[i].via) scr_promise_release(cbs[i].via);
    if (cbs[i].conv && cbs[i].dst->ext && cbs[i].dst->ext->alias) {
      /* The claim is settled now: it stops sharing this list. */
      scr_promise_release(cbs[i].dst->ext->alias);
      cbs[i].dst->ext->alias = NULL;
    }
    scr_promise_release(cbs[i].dst);
  }
  for (; w < nw; w++) scr_ready_push(scr_prom_wat(w1, wv, nw, w));
  free(wv);
  free(cbs);
  if (p->state == SCR_PROM_REJECTED) scr_track_rejection(p);
}

/* ── Promise.race ─────────────────────────────────────────────────────
 * The compiler emits: a fresh result promise, then one race_add per
 * entry. A settled entry settles the result immediately (first add
 * wins); pending entries park a callback waiter that fires inside the
 * entry's settle. Fibers awaiting the result still wake through the
 * microtask queue. Losing entries keep their own settlements (payloads
 * are retained, not moved). */

void scr_promise_race_add(ScrPromise *race, ScrPromise *in,
                           void (*adapt)(ScrPromise *dst, ScrPromise *src)) {
  if (in->state != SCR_PROM_PENDING) {
    if (in->state == SCR_PROM_FULFILLED) adapt(race, in);
    else scr_promise_settle_from(race, in);
    return;
  }
  struct ScrPromiseCbWaiter *cb = scr_prom_cb_add(in);
  cb->adapt = adapt;
  cb->dst = scr_promise_retain(race);
}

/* ── Declaration-claimed promises ─────────────────────────────────────
 * `Promise<T>` claimed over a promise whose payload representation is
 * another type (untyped JS returning a promise a .d.ts types). In JS this
 * is the SAME object, so its awaiters wake one microtask after the
 * source settles and nothing else runs. The payload slot cannot be
 * reinterpreted, so a derived promise D carries the converted payload --
 * and it must settle INSIDE the source's settle (a callback waiter), not
 * one job later (an awaiting helper), or every observer of D runs a turn
 * after Node's. `conv` is the lowerer's async helper `(src) => coerce(
 * payload(src))`: its body has no await, so the call returns an already
 * settled promise H (a failed payload check rejects H with the throw),
 * and D copies H on the spot. Rejection of the source copies across
 * unchanged. Memoised per (source, id) for `===`, as the old wrapper was.
 * Returns D +1. */
static void scr_promise_claim_run(ScrPromise *dst, ScrPromise *src, ScrClosure *conv) {
  ScrPromise *h = ((ScrPromise *(*)(ScrClosure *, ScrPromise *))conv->fn)(conv, scr_promise_retain(src));
  scr_promise_race_add(dst, h, scr_promise_adapt_copy);
  scr_promise_release(h);
}

ScrPromise *scr_promise_claim(ScrPromise *src, double id, ScrClosure *conv) {
  ScrPromiseAdapt *hit = scr_promise_adapt_find(src, id);
  if (hit) return scr_promise_retain(hit->adapted);
  ScrPromise *dst = scr_promise_new();
  /* File first: the credit (adapter_observes_pending) must exist before a
   * rejected source is copied, whose observe spends it. */
  scr_promise_release(scr_promise_adapt_put(src, id, dst));
  if (src->state == SCR_PROM_PENDING) {
    struct ScrPromiseCbWaiter *cb = scr_prom_cb_add(src);
    cb->dst = scr_promise_retain(dst);
    cb->conv = scr_closure_retain(conv);
    scr_prom_xmk(dst)->alias = scr_promise_retain(src);
  } else if (src->state == SCR_PROM_FULFILLED) {
    scr_promise_claim_run(dst, src, conv);
  } else {
    scr_promise_settle_from(dst, src);
  }
  return dst;
}

/* ── Promise.all ──────────────────────────────────────────────────────
 * BORROWS the entries array `ps` and the pre-capacity values array
 * `values` (NULL for void elements), retains what it keeps, and returns
 * the result promise +1. `values` arrives EMPTY with cap >= ps->len (the
 * emitted construction passes the length) and is pre-sized here: every
 * slot's zero bits are the per-kind placeholder (0.0 / false / NULL),
 * legal to overwrite through the store helpers and to release. Entries
 * already settled settle inline (a rejection settles the result NOW —
 * first rejection in settlement order — and later rejected entries are
 * still marked handled); pending entries park a countdown waiter. The
 * empty array fulfills immediately (awaiters take the settled-await
 * microtask hop, like Node's one-tick resolve). */
ScrPromise *scr_promise_all(ScrArr *ps, ScrArr *values,
                             void (*store)(ScrArr *a, double i, ScrPromise *src)) {
  size_t n = ps->len;
  ScrPromise *result = scr_promise_new();
  if (values && n > 0) {
    memset(values->data, 0, n * sizeof *values->data);
    values->len = n;
  }
  ScrAllState *st = malloc(sizeof *st);
  if (!st) scr_oom();
  st->rc = 1; /* the builder's reference, dropped at the end */
  st->remaining = n;
  st->values = values ? scr_arr_retain(values) : NULL;
  st->store = store;
  for (size_t i = 0; i < n; i++) {
    ScrPromise *in = (ScrPromise *)scr_arr_get_ref(ps, (double)i); /* +1 */
    if (in->state != SCR_PROM_PENDING) {
      scr_promise_all_settle(st, result, i, in);
    } else {
      struct ScrPromiseCbWaiter *cb = scr_prom_cb_add(in);
      cb->dst = scr_promise_retain(result);
      cb->all = st;
      cb->all_idx = i;
      st->rc++;
    }
    scr_promise_release(in);
  }
  /* n == 0, or every entry was already fulfilled inline. */
  if (st->remaining == 0 && result->state == SCR_PROM_PENDING) {
    if (st->values) {
      scr_promise_fulfill_ref(result, scr_arr_retain(st->values), scr_arr_retain_v,
                               scr_arr_release_v,
                               st->values->elem_trace ? scr_arr_trace_v : NULL);
    } else {
      scr_promise_fulfill_void(result);
    }
  }
  scr_promise_all_state_release(st);
  return result;
}

/* Per-element-kind store helpers for the emitted Promise.all: write the
 * entry's fulfillment payload into the values array at its input index.
 * The payload accessors return retained/by-value (losing a reference is
 * impossible: set_* takes ownership and releases the zero placeholder). */
void scr_promise_all_store_f64(ScrArr *a, double i, ScrPromise *src) {
  scr_arr_set_f64(a, i, scr_promise_payload_f64(src));
}
void scr_promise_all_store_bool(ScrArr *a, double i, ScrPromise *src) {
  scr_arr_set_bool(a, i, scr_promise_payload_bool(src));
}
void scr_promise_all_store_str(ScrArr *a, double i, ScrPromise *src) {
  scr_arr_set_ref(a, i, scr_promise_payload_str(src));
}
void scr_promise_all_store_ref(ScrArr *a, double i, ScrPromise *src) {
  scr_arr_set_ref(a, i, scr_promise_payload_ref(src));
}

/* Fulfillment payload accessors for the emitted race adapters — all
 * retained/by-value (the source keeps its settlement). */
double scr_promise_payload_f64(ScrPromise *p) { SCR_PROM_SCALAR_KIND(p, SCR_EXC_F64); return p->f64; }
bool scr_promise_payload_bool(ScrPromise *p) { SCR_PROM_SCALAR_KIND(p, SCR_EXC_BOOL); return p->b; }
ScrStr *scr_promise_payload_str(ScrPromise *p) {
  return scr_str_retain((ScrStr *)p->payload);
}
/* Thin views for the gated dyn-async TU (scr_async_dyn.c): the payload
 * KIND, whether a REF payload is a dyn value (the dyn adapters), and the
 * settled-await primitive (park/hop + rejection re-throw; true =
 * fulfilled). */
int scr_promise_payload_kind(const ScrPromise *p) { return (int)p->payload_kind; }
bool scr_promise_payload_is_dyn(const ScrPromise *p) { return PV(p)->retain == scr_dyn_retain_v; }
double scr_promise_payload_num(const ScrPromise *p) { SCR_PROM_SCALAR_KIND(p, SCR_EXC_F64); return p->f64; }
bool scr_promise_payload_flag(const ScrPromise *p) { SCR_PROM_SCALAR_KIND(p, SCR_EXC_BOOL); return p->b; }
void scr_promise_payload_release(const ScrPromise *p, void *v) { PV(p)->release(v); }

void *scr_promise_payload_ref(ScrPromise *p) {
  return p->payload ? PV(p)->retain(p->payload) : NULL;
}

/* MOVES a pending exception out of `cell` into `p` as its rejection payload
 * (the cell resets to NONE). Shared by fiber completion and the new-Promise
 * executor runners; callers wake waiters themselves. */
static void scr_promise_reject_from_cell(ScrPromise *p, ScrExcCell *cell) {
  p->state = SCR_PROM_REJECTED;
  p->payload_kind = cell->kind;
  if (cell->kind == SCR_EXC_BOOL) p->b = cell->b; else p->f64 = cell->f64;
  p->payload = cell->payload;
  p->vt = scr_prom_vt_intern(cell->retain_fn, cell->release_fn, cell->trace_fn);
  cell->kind = SCR_EXC_NONE;
  cell->payload = NULL;
  cell->trace_fn = NULL;
}

static void scr_agen_finish_gen(ScrGen *g, ScrExcCell *cell);
/* Unsigned to decimal into a caller buffer of at least 24 bytes. Exists so
 * the stat line below needs no printf; see the note at its call site.
 * NOT gated: scr_heap_trim_line still calls it in every build. */
static const char *scr_utoa(size_t v, char *buf) {
  char *p = buf + 23;
  *p = '\0';
  do { *--p = (char)('0' + (v % 10u)); v /= 10u; } while (v != 0);
  return p;
}

/* -- returning free heap pages to the OS at the idle seam -------------
 *
 * A compiled service that survives one history sync never gives the
 * memory back: measured with packages/fake-server/memrig.ts driving the
 * shipped zapo-rest binary, 8 chunks x 400 conversations, kernel-side
 * WorkingSet64 sampled every 270 ms -- presync 32.25 MiB, peak 267.15,
 * settled 133.54, and STILL 133.54 after sixty seconds of idle. Three
 * identical rounds in one process add +78.11, +25.71, -1.69 MiB: three
 * times the data, one time the retention, so nothing is leaking. The
 * bytes are free and reused; they are simply resident.
 *
 * THIS SEAM, not a timer thread: scr_loop_run has already decided it has
 * no runnable work and is about to block, which is the one point where a
 * heap-wide walk cannot land between two allocations of the same turn.
 * It is the seam scr_fiber_pool_decay uses, for the same reason.
 *
 * WHAT THE WIN32 HEAP ACTUALLY DOES, measured on this toolchain (zig
 * 0.16.0, x86_64-windows-gnu, ucrtbase): malloc reaches the process heap
 * -- _get_heap_handle() == GetProcessHeap() -- and that heap ALREADY
 * DECOMMITS ON free(). 400,000 x 320 B taken to 136.43 MiB of private
 * commit and then fully freed falls to 4.52 MiB with no trim call at all.
 * The retention is therefore never "the runtime forgot to return it".
 *
 *   arm                          after free   +HeapCompact  +Optimize
 *   320 B x400k, 1-in-20 live      136.44       136.44       134.55
 *   320 B x400k, all freed           4.52         4.40         3.87
 *   4 KiB x40k,  1-in-20 live      165.09       165.09       162.81
 *
 * So: HeapCompact -- which is exactly what _heapmin() calls -- releases
 * 0.00 MiB on every fragmented arm. HeapSetInformation with
 * HeapOptimizeResources releases 1.9-3.0 MiB of 136-165, i.e. ~1.5-1.8%,
 * in 0.04-0.08 ms. What holds the other 98% is LIVE BLOCKS SCATTERED
 * THROUGH THE SEGMENTS: one surviving allocation in twenty pins its whole
 * LFH subsegment, and no trim on any OS can move a live block.
 *
 * Both calls are made, not just the one that pays. The point of a knob
 * called "trim the heap" is that a null result is a statement about the
 * platform rather than about which API its author guessed at, so it does
 * everything Win32 offers: HeapCompact to coalesce, HeapOptimizeResources
 * to decommit what coalescing exposed. Compact costs 0.25 ms at worst and
 * only when there is genuinely free space to walk.
 *
 * DEFAULT OFF, and the reason is the size of the prize, not fear. A
 * feature that returns 1.5% of the retained bytes does not earn a change
 * in the default behaviour of every compiled binary -- least of all in
 * this file, whose other idle-seam feature (SCR_FIBER_POOL_DECAY_MS)
 * shipped on, was implicated in a service that could not pair, and is now
 * off and unshipped. The knob stays available, armed, and measured.
 *
 * SCR_HEAP_TRIM_MS=0 is the negative control and the default: the seam
 * costs one integer compare and the pre-trim runtime is restored exactly.
 * SCR_HEAP_TRIM_STAT=1 prints one line per window INCLUDING the windows
 * that release nothing, so "the trim found nothing" and "the trim never
 * ran" are distinguishable readings -- the property that let the fiber
 * pool's diagnostic be trusted. SCR_HEAP_TRIM_CENSUS=1 adds a HeapWalk
 * per window: busy bytes are the floor no trim can go below, and free
 * bytes are the most any trim could ever return.
 *
 * THE SECOND HALF OF THAT SENTENCE IS RETRACTED (2026-10-11), kept
 * verbatim above: free bytes are NOT the most a trim could return, they
 * OVERSTATE it, because the NT heap decommits inside a free run without
 * emitting PROCESS_HEAP_UNCOMMITTED_RANGE. The census is also Win32-only
 * -- its body sits inside `#ifdef _WIN32` and no other target keeps
 * allocator accounting -- which this sentence did not say. See the
 * retraction at the census body itself for the measurement and its
 * negative control. */
#ifndef SCR_HEAP_TRIM_MS
/* glibc keeps the free memory a burst leaves behind in its arenas: MEASURED on the zapo mysql arm (callgrind-free runs, idle box, 3 runs per arm)
 * a one-second window gives back 7-10 MiB of RssAnon at the end of the run (end 78.9 -> 70.9 MiB median), never touches the peak, and the CPU is
 * unchanged (11.1 s base against 11.2 s at 1000 ms; a 250 ms window cost 6% in the median, so the default is the coarser one). Other targets keep
 * the old default: the Windows heap returns about 1.5% (see above). SCR_HEAP_TRIM_MS=0 restores the pre-trim runtime exactly. */
#if defined(__GLIBC__)
#define SCR_HEAP_TRIM_MS 1000
#else
#define SCR_HEAP_TRIM_MS 0
#endif
#endif

/* -- handing SQLite's idle page cache back at the same seam -----------
 *
 * The compiled binary's settled floor is dominated by SQLite's page cache.
 * Measured on a paired history sync: 12.68 MB of a ~44 MiB floor sat at
 * sqlite3.c's allocator, and a release returned 11.73 MiB by the allocation
 * census and 12.66 MiB of private commit by an out-of-process VM walk, net of
 * a control arm that showed the idle process shedding 2.1-3.0 MiB on its own.
 * That is the user's standing complaint -- a compiled service that never
 * gives memory back after a peak -- and it is the largest single term on the
 * idle floor.
 *
 * WHY NOT SIMPLY LOWER THE CEILING. SQLITE_DEFAULT_CACHE_SIZE=-16000 is set
 * in backend/cc.ts to match better-sqlite3's own build, read from the
 * installed package's deps/defines.gypi. Lowering it reaches the same floor
 * but taxes EVERY query, and once the working set exceeds the cache the two
 * stop being substitutes: on a 129.6 MB database, four runs per arm, the
 * lowered ceiling cost +6.65 ms per request (+74.1%, ranges non-overlapping)
 * while a release cost +8.18 ms ONCE and nothing after (its steady-state
 * range overlaps the control's). Break-even is 1.23 requests per idle window.
 *
 * THIS SEAM, not a timer: scr_loop_run has already decided it has no runnable
 * work and is about to block. It is the seam scr_fiber_pool_decay and
 * scr_heap_trim already use, and it reuses the 'now' they were handed, so it
 * costs no clock read, no timer and no thread.
 *
 * BUT THE SEAM IS NOT IDLENESS, and conflating the two was this feature's
 * first shape and its defect. "No runnable work this turn" is reached between
 * any two requests, so on a server answering ten requests a second the seam is
 * reached ten times a second. A window measured HERE would fire under full
 * load, throw away a hot cache, and charge the next request the refill --
 * repeatedly. The break-even that justifies the feature assumes the window
 * only opens when nothing is being asked for.
 *
 * So the loop supplies the OPPORTUNITY and scr_sqlite.c supplies the
 * JUDGEMENT: it stamps a per-connection last-use time on the path that
 * already executes statements, and the hook releases only connections
 * untouched for the whole window. That also makes idleness per connection
 * rather than per process, so a service holding ten databases returns the
 * cache of the nine sitting still and keeps the one in use. Measured with two
 * handles on one file: in 26 windows one was kept and the other released in
 * the SAME sweep, and the two populations do not overlap the window -- kept
 * connections had been idle 6-737 ms, released ones 1012-70035 ms.
 *
 * THE WINDOW VERSUS THE REQUEST CADENCE IS A DESIGNED TRADE, not an open
 * question. A service whose requests are further apart than the window is
 * idle by this definition for a whole window, so it SHOULD release; the next
 * request then pays the refill, measured at +8.18 ms once, which the
 * break-even of 1.23 requests per idle window already covers. Choosing the
 * window is choosing how long a lull must be before the cache is worth giving
 * up, and that is the operator's call, not the runtime's.
 *
 * IT DOES NOT SHORTEN THE SLEEP, and that is a decision rather than an
 * inheritance from the neighbour above. scr_heap_trim_due caps 'due' so its
 * window cannot be slept past; the identical clamp shape on the fiber pool
 * shortened the I/O poll deadline, reordered socket reads against timers, and
 * produced a service that could not pair. A cache release has no deadline to
 * miss -- nothing waits on it and nothing is wrong if it is late -- so when
 * the window passes while the loop sleeps it simply runs on the next turn.
 * There is deliberately no scr_sqlite_idle_due().
 *
 * DEFAULT ON since 2026-10-10, at the 1000 ms window every measurement in
 * this feature's history was taken at. The paragraph this replaces said the
 * default does not ship with a feature's debut, it ships afterwards with use
 * behind it -- so this is that paragraph's own condition being met, not a
 * reversal of it. The debut was 2026-10-03 (merge 040d22982, gated 6/6):
 * -17.19 MiB private commit and -17.91 MiB working set on a 129.6 MB
 * database, ranges non-overlapping, with the armed arm's median 0.33 ms
 * BELOW the control -- no sustained cost to pay for it.
 *
 * WHAT FLIPPING THIS COSTS, stated because it is not nothing. Off, no binary
 * diverged from Node unless someone set the variable. On, EVERY binary
 * holding a SQLite handle diverges on process memory -- Node running
 * better-sqlite3 never releases page cache on an idle loop. It remains a
 * MEMORY divergence only: sqlite3_db_release_memory frees unpinned pages and
 * changes no query result, no error, no row order, no value and no pragma
 * readback. docs/SEMANTICS.md carries the entry and now says ON.
 *
 * SCR_SQLITE_IDLE_RELEASE_MS=0 REMAINS THE NEGATIVE CONTROL -- the env read
 * below clamps any value <= 0 to 0, so setting it to 0 restores the old
 * default exactly and the seam costs one integer compare again. Every A/B in
 * this feature's history still runs unchanged; only which arm you have to
 * ask for has swapped.
 *
 * SCR_SQLITE_IDLE_STAT=1 prints one line per window INCLUDING windows that
 * released nothing, so "ran and found no open connection" stays
 * distinguishable from "never ran" -- the property that made the fiber pool's
 * and the page return's zeros readable rather than ambiguous. */
#ifndef SCR_SQLITE_IDLE_RELEASE_MS
#define SCR_SQLITE_IDLE_RELEASE_MS 1000
#endif

/* Set by scr_sqlite.c on the first open, and NULL in every binary that holds
 * no SQLite handle -- which is why the dependency points that way: this unit
 * is always linked and that one is gated on the program using SQLite. */
static int (*scr_sqlite_idle_release_fn)(double, double, int *) = NULL;
void scr_loop_set_sqlite_idle_release(int (*fn)(double, double, int *)) {
  scr_sqlite_idle_release_fn = fn;
}

static double scr_sqlite_idle_next_ms = 0;
#if SCR_ASYNC_STAT
/* INSIDE THE GATE WITH THEIR ONLY READER, and that pairing is the point.
 * Gating the stat line left these three incremented and never read, and a
 * static that is written and never read is dead code a compiler may legally
 * delete -- SILENTLY. The symptom is a counter reading zero in a shipping
 * binary while the source plainly shows it incrementing, which this project
 * has already had happen to six of them at once. The two honest shapes are an
 * always-built reader or no always-built writer; this takes the second,
 * because reproducing anything these count already requires
 * -DSCR_ASYNC_STAT=1, so an accessor outside the gate would have nothing to
 * report. */
static unsigned long long scr_sqlite_idle_windows = 0;
static unsigned long long scr_sqlite_idle_conns = 0;
static unsigned long long scr_sqlite_idle_inuse = 0;
#endif /* SCR_ASYNC_STAT */

static size_t scr_sqlite_idle_ms(void) {
  static size_t cached = SCR_SQLITE_IDLE_RELEASE_MS;
  static int looked = 0;
  if (!looked) {
    const char *env = getenv("SCR_SQLITE_IDLE_RELEASE_MS");
    looked = 1;
    if (env != NULL) {
      long v = strtol(env, NULL, 10);
      cached = v > 0 ? (size_t)v : 0;
    }
  }
  return cached;
}

static void scr_sqlite_idle_release(double now) {
  size_t win = scr_sqlite_idle_ms();
  int n, inuse;
  if (win == 0) return;                           /* opted out: one compare */
  if (scr_sqlite_idle_release_fn == NULL) return; /* no SQLite in this binary */
  if (scr_sqlite_idle_next_ms == 0) {
    scr_sqlite_idle_next_ms = now + (double)win;
    return;
  }
  if (now < scr_sqlite_idle_next_ms) return;
  scr_sqlite_idle_next_ms = now + (double)win;
  inuse = 0;
  n = scr_sqlite_idle_release_fn(now, (double)win, &inuse);
#if SCR_ASYNC_STAT
  scr_sqlite_idle_windows++;
  scr_sqlite_idle_conns += (unsigned long long)n;
  scr_sqlite_idle_inuse += (unsigned long long)inuse;
  /* BEHIND THE SAME COMPILE-TIME GATE AS EVERY OTHER DIAGNOSTIC IN THIS TU,
   * and for the reason the gate was created. Converting this line from
   * fprintf to fputs recovered 27,136 of 28,672 bytes, but the labels and the
   * fputs calls still cost a static hello-world .text +1,024 and .rdata +512
   * -- and the compact class has 512 bytes of headroom over its recorded
   * figure, so "small" is still too big. Gated, a default binary pays nothing
   * for a line it never prints, which is the same bargain SCR_ASYNC_STAT
   * already struck for the loop's other reports. Build with
   * -DSCR_ASYNC_STAT=1 and SCR_SQLITE_IDLE_STAT behaves as documented. */
  if (getenv("SCR_SQLITE_IDLE_STAT") != NULL) {
    /* THREE outcomes, not two, and the middle one is the load-bearing one.
     * released=0 inUse=0 means the window found no open connection at all;
     * released=0 inUse=N means it saw N and declined them because they had
     * been used inside the window -- which is the only evidence that the
     * execution-path stamp is being read. If inUse never appears under load,
     * the stamp is not working and the release is firing on hot caches.
     *
     * fputs AND scr_utoa, NOT fprintf, and this line cost 28,672 bytes
     * before it was written that way. A single printf in the always-linked
     * runtime drags in libc's whole formatting path: measured on a static
     * hello-world, .text +25,088, .rdata +3,072, .pdata +512, for a line no
     * default build ever prints. This TU already learned that once -- see
     * the identical note at the fiber pool's stat line, which priced two
     * fprintf calls at 33,280 bytes -- and the lesson is a property of the
     * FILE, not of that call site: anything always linked that formats pays
     * it. */
    char nb[24];
    fputs("[sqlidle] window=", stderr);
    fputs(scr_utoa((size_t)scr_sqlite_idle_windows, nb), stderr);
    fputs(" released=", stderr);
    fputs(scr_utoa((size_t)(n < 0 ? 0 : n), nb), stderr);
    fputs(" inUse=", stderr);
    fputs(scr_utoa((size_t)(inuse < 0 ? 0 : inuse), nb), stderr);
    fputs(" totalReleased=", stderr);
    fputs(scr_utoa((size_t)scr_sqlite_idle_conns, nb), stderr);
    fputs(" totalInUse=", stderr);
    fputs(scr_utoa((size_t)scr_sqlite_idle_inuse, nb), stderr);
    fputs("\n", stderr);
  }
#else
  /* The release still RAN; only its bookkeeping is gated out. */
  (void)n;
  (void)inuse;
#endif /* SCR_ASYNC_STAT */
}

/* -- pouring the string pool back so a chunk can empty ------------------
 *
 * The string arena carves forward and never frees a chunk. The reason is not
 * placement: its free list was measured receiving ZERO blocks across a full
 * history sync, because scr_str_release offers every dead block to a pool
 * which always accepts. The pool is small -- 614,880 B high-water, 3.67% of
 * its bound -- but it owns the ROUTE, so no chunk ever learns it emptied.
 *
 * At this seam the pool is poured back into the arena and chunks that reach
 * zero are swept. Same tenant shape as the SQLite release beside it, same
 * rule: it does NOT shorten 'due'. A drain has no deadline to miss, and that
 * clamp shape is what reordered socket reads against timers and broke
 * pairing. Off by default; SCR_STR_IDLE_DRAIN_MS=0 costs one integer compare.
 *
 * The idleness test lives in scr_string.c, as a monotonic op counter rather
 * than a timestamp: a clock read on the allocation path would cost more than
 * the drain saves, and "no string allocation in the whole window" is a
 * stronger statement than "the last one was a while ago". */
#ifndef SCR_STR_IDLE_DRAIN_MS
#define SCR_STR_IDLE_DRAIN_MS 0
#endif

/* No function pointer and no setter: scr_str_idle_drain is called directly.
 * See scr_runtime.h's note on the declaration for why. */

static double scr_str_idle_next_ms = 0;
#if SCR_ASYNC_STAT
static unsigned long long scr_str_idle_windows = 0;
static unsigned long long scr_str_idle_freed = 0;
static unsigned long long scr_str_idle_skipped = 0;
#endif

static size_t scr_str_idle_ms(void) {
  static size_t cached = SCR_STR_IDLE_DRAIN_MS;
  static int looked = 0;
  if (!looked) {
    const char *env = getenv("SCR_STR_IDLE_DRAIN_MS");
    looked = 1;
    if (env != NULL) { long v = strtol(env, NULL, 10); cached = v > 0 ? (size_t)v : 0; }
  }
  return cached;
}

static void scr_str_idle_drain_tick(double now) {
  size_t win = scr_str_idle_ms();
  int drained = 0, freed;
  if (win == 0) return;
  /* `win == 0` above is what keeps a default binary free, so no NULL hook
   * check is needed here: the drain is never entered when the knob is off. */
  if (scr_str_idle_next_ms == 0) { scr_str_idle_next_ms = now + (double)win; return; }
  if (now < scr_str_idle_next_ms) return;
  scr_str_idle_next_ms = now + (double)win;
  freed = scr_str_idle_drain(&drained);
#if SCR_ASYNC_STAT
  scr_str_idle_windows++;
  if (freed < 0) scr_str_idle_skipped++;
  else scr_str_idle_freed += (unsigned long long)freed;
  if (getenv("SCR_STR_IDLE_STAT") != NULL) {
    char nb[24];
    fputs("[stridle] window=", stderr);
    fputs(scr_utoa((size_t)scr_str_idle_windows, nb), stderr);
    if (freed < 0) {
      fputs(" SKIPPED (allocation inside the window)", stderr);
    } else {
      fputs(" drained=", stderr);
      fputs(scr_utoa((size_t)drained, nb), stderr);
      fputs(" chunksFreed=", stderr);
      fputs(scr_utoa((size_t)freed, nb), stderr);
    }
    fputs(" totalFreed=", stderr);
    fputs(scr_utoa((size_t)scr_str_idle_freed, nb), stderr);
    fputs(" totalSkipped=", stderr);
    fputs(scr_utoa((size_t)scr_str_idle_skipped, nb), stderr);
    fputs("\n", stderr);
  }
#else
  (void)drained; (void)freed;
#endif
}

static double scr_heap_trim_next_ms = 0;
/* Windows this trim actually ran, so the stat line can say "ran and found
 * nothing" rather than leaving the reader to guess. Static, deliberately:
 * an exported symbol in the always-linked runtime cannot be dead-stripped
 * and this file is measured to the page by tests/harness/island.test.ts. */
static unsigned long long scr_heap_trims = 0;

static size_t scr_heap_trim_ms(void) {
  static bool once = false;
  static size_t cached = SCR_HEAP_TRIM_MS;
  if (!once) {
    const char *env = getenv("SCR_HEAP_TRIM_MS");
    if (env != NULL) {
      long v = strtol(env, NULL, 10);
      if (v >= 0) cached = (size_t)v;
    }
    once = true;
  }
  return cached;
}

static bool __attribute__((unused)) scr_heap_trim_census_on(void) {
  static bool once = false;
  static bool cached = false;
  if (!once) { cached = getenv("SCR_HEAP_TRIM_CENSUS") != NULL; once = true; }
  return cached;
}

static bool scr_heap_trim_stat(void) {
  static bool once = false;
  static bool cached = false;
  if (!once) { cached = getenv("SCR_HEAP_TRIM_STAT") != NULL; once = true; }
  return cached;
}


/* How long the loop may sleep before the next trim window is due, or a
 * negative number when the knob is off and the sleep runs to its natural
 * deadline.
 *
 * THE CAP IS LOAD-BEARING and scr_stack_pool_decay_due learned it the hard
 * way: a process whose only pending work is one long timer takes the whole
 * timer in a single turn, so a trim that ticks once per turn never runs,
 * and the measurement comes back looking like a fix that does not work.
 * Unlike the fiber pool's, this cap has no "nothing left to free" exit --
 * the heap is always eligible -- so it costs exactly one wakeup per window
 * for the life of the process. At the 5000 ms this is meant to be used
 * with, that is one wakeup per five seconds against a trim measured at
 * 0.04-0.25 ms. */
static double scr_heap_trim_due(double now) {
  size_t win = scr_heap_trim_ms();
  if (win == 0) return -1.0;
  if (scr_heap_trim_next_ms == 0) return now + (double)win;
  return scr_heap_trim_next_ms;
}

#ifdef _WIN32
/* HeapOptimizeResources is guarded on NTDDI_VERSION in mingw's winnt.h, so
 * the two things it needs are declared here rather than left to whichever
 * target macro the compiler driver picks. Windows 8.1+; older kernels fail
 * the call and the trim degrades to HeapCompact alone. */
typedef struct { DWORD Version; DWORD Flags; } ScrHeapOptimizeInfo;

/* Private commit -- PagefileUsage, the number that actually falls when the
 * heap decommits, as opposed to WorkingSetSize which also falls when the
 * OS merely pages something out. Reported in KiB so scr_utoa can print it
 * without a printf. */
static size_t scr_heap_commit_kib(void) {
  PROCESS_MEMORY_COUNTERS c;
  c.cb = (DWORD)sizeof c;
  if (!GetProcessMemoryInfo(GetCurrentProcess(), &c, (DWORD)sizeof c)) return 0;
  return (size_t)(c.PagefileUsage / 1024u);
}
#elif defined(__GLIBC__)
/* Private resident memory, in KiB: statm's resident minus shared pages. The
 * glibc analogue of the Win32 reading above, and the right one for the same
 * reason: malloc_trim hands pages back with madvise(MADV_DONTNEED), which
 * drops them from RESIDENT and leaves the address space (VmSize) alone, so
 * only a resident-set reading can fall across a trim. open/read/close and a
 * hand-parse, NOT stdio/sscanf: this TU is always linked and measured to
 * the page. Returns 0 only when /proc is unreadable, which is the "failed
 * syscall" the test's before>0 assertion exists to tell apart. */
static size_t scr_heap_commit_kib(void) {
  char buf[128];
  unsigned long long f[3] = {0, 0, 0};
  size_t i = 0, k = 0;
  ssize_t n;
  int fd = open("/proc/self/statm", O_RDONLY);
  if (fd < 0) return 0;
  n = read(fd, buf, sizeof buf - 1);
  close(fd);
  if (n <= 0) return 0;
  buf[n] = '\0';
  while (k < 3 && i < (size_t)n) {
    while (i < (size_t)n && (buf[i] < '0' || buf[i] > '9')) i++;
    while (i < (size_t)n && buf[i] >= '0' && buf[i] <= '9')
      f[k] = f[k] * 10u + (unsigned)(buf[i++] - '0');
    k++;
  }
  if (k < 3 || f[1] < f[2]) return 0;
  {
    long pg = sysconf(_SC_PAGESIZE);
    if (pg <= 0) return 0;
    return (size_t)((f[1] - f[2]) * (unsigned long long)pg / 1024u);
  }
}
#endif

/* Prints `<label><decimal>` for each pair and a newline, to stderr.
 * Table-driven because the alternative is twenty-two fputs call sites in
 * an always-linked TU: the same two lines cost 3,584 bytes of static
 * hello-world written out longhand and 2,560 written like this. Still no
 * printf -- see the note at the window line for what one %zu cost. */
static void scr_heap_trim_line(const char *const *labels, const size_t *vals,
                               size_t n) {
  char nb[24];
  size_t i;
  for (i = 0; i < n; i++) {
    fputs(labels[i], stderr);
    fputs(scr_utoa(vals[i], nb), stderr);
  }
  fputc('\n', stderr);
}

/* One trim window. Called from the sleep seam in scr_loop_run with the
 * loop's own scr_now_ms(), passed in rather than re-read so the window
 * boundary lines up with the turn the caller is timing. */
#if defined(__linux__) && defined(__GLIBC__)
/* -- Executable-text drop at the first idle seam (Linux) ------------------------------------------------------
 * The program's own text is mapped file-backed and read-only, and the kernel maps it in 64 KiB fault-around runs,
 * so a process that runs a small fraction of its code (a measured zapo redis bench executes 35% of its 32 MiB of
 * function text, and only about 1 MiB in steady state) still holds most of the text resident: 28.7 MiB at the
 * peak. Once startup is behind us the hot set is a few MiB, so drop the mappings ONCE with MADV_DONTNEED and let
 * the kernel fault back in only what the program keeps using.
 *
 * WHAT THIS DOES AND DOES NOT BUY. The pages stay in the page cache and come back on use: this lowers the
 * PROCESS's resident set (RSS), it does not free system memory, and it is not a saving for anyone measuring the
 * machine. Measured on the redis bench: peak RSS 116.7 -> 104.8 MiB, text at the peak 28.7 -> 15.8 MiB, minor
 * faults unchanged (68.9k vs 68.2k), no measurable CPU change.
 *
 * Only the executable's own r-xp mappings are touched (shared libraries are left alone), and only once, and only
 * after SCR_TEXT_DROP_AFTER_MS of loop time, so a short program that reaches an idle seam within that time pays
 * nothing and one that exits before any seam never gets here. SCR_TEXT_DROP=0 is the negative control.
 * SCR_TEXT_DROP_STAT=1 prints one line with the text residency before and after (from /proc/self/smaps).
 * A binary with text relocations would lose them under DONTNEED, so the drop is refused when the dynamic section
 * says DT_TEXTREL; PIE text is not relocated, which is what every build of this compiler produces. */
#ifndef SCR_TEXT_DROP
#define SCR_TEXT_DROP 1
#endif
#ifndef SCR_TEXT_DROP_AFTER_MS
#define SCR_TEXT_DROP_AFTER_MS 200
#endif
#ifndef SCR_TEXT_DROP_EVERY_MS
#define SCR_TEXT_DROP_EVERY_MS 500 /* repeat at most this often; 0 = the first drop only. MEASURED on the zapo REST app (peak RSS, two runs each): 2000 ms gave 52.3 / 52.0 MB, 1000 ms 52.1 / 49.4, 500 ms 47.7 / 45.2, 250 ms 48.6 / 47.8 -- the drop only fires at an idle seam, so a shorter interval than 500 buys nothing more; minor faults rose 9.1k -> 9.1-9.3k at 500 (10.2k at 250) and CPU stayed inside run-to-run noise. */
#endif

static bool scr_text_drop_env(const char *name, bool dflt) {
  const char *e = getenv(name);
  if (e == NULL || e[0] == '\0') return dflt; /* an empty value is "unset", not "on" */
  return e[0] != '0';
}

/* Walk /proc/self/maps (drop) or /proc/self/smaps (measure) once. Returns the resident KiB of the executable's r-xp
 * mappings (measure mode) or the number of mappings dropped (drop mode). Hand-rolled line parsing, no stdio/printf. */
static size_t scr_text_scan(bool drop) {
  char exe[1024];
  ssize_t en = readlink("/proc/self/exe", exe, sizeof exe - 1);
  if (en <= 0) return 0;
  exe[en] = '\0';
  int fd = open(drop ? "/proc/self/maps" : "/proc/self/smaps", O_RDONLY | O_CLOEXEC);
  if (fd < 0) return 0;
  char buf[8192];
  size_t have = 0, result = 0;
  bool in_text = false, eof = false;
  while (!eof) {
    ssize_t n = read(fd, buf + have, sizeof buf - 1 - have);
    if (n <= 0) eof = true; else have += (size_t)n;
    buf[have] = '\0';
    char *line = buf;
    for (;;) {
      char *nl = memchr(line, '\n', have - (size_t)(line - buf));
      if (nl == NULL) break;
      *nl = '\0';
      if (line[0] != '\0') {
        /* a header: "start-end perms offset dev inode  path"; smaps adds "Key: value kB" lines under it */
        const char *q = line;
        unsigned long long a = 0, b = 0;
        int ok = 0;
        while ((*q >= '0' && *q <= '9') || (*q >= 'a' && *q <= 'f')) { a = a * 16 + (unsigned)(*q <= '9' ? *q - '0' : *q - 'a' + 10); q++; ok++; }
        if (ok > 0 && *q == '-') {
          q++;
          while ((*q >= '0' && *q <= '9') || (*q >= 'a' && *q <= 'f')) { b = b * 16 + (unsigned)(*q <= '9' ? *q - '0' : *q - 'a' + 10); q++; }
          in_text = false;
          if (q[0] == ' ' && q[1] == 'r' && q[2] == '-' && q[3] == 'x') {
            const char *path = strchr(line, '/');
            size_t pl = strlen(exe);
            size_t ll = strlen(line);
            if (path != NULL && ll >= pl && strcmp(line + ll - pl, exe) == 0) {
              in_text = true;
              if (drop && madvise((void *)(uintptr_t)a, (size_t)(b - a), MADV_DONTNEED) == 0) result++;
            }
          }
        } else if (!drop && in_text && line[0] == 'R' && line[1] == 's' && line[2] == 's' && line[3] == ':') {
          const char *r = line + 4;
          while (*r == ' ') r++;
          size_t v = 0;
          while (*r >= '0' && *r <= '9') v = v * 10 + (size_t)(*r++ - '0');
          result += v;
        }
      }
      line = nl + 1;
    }
    size_t rest = have - (size_t)(line - buf);
    memmove(buf, line, rest);
    have = rest;
    if (have == sizeof buf - 1) have = 0; /* an over-long line: drop it */
  }
  close(fd);
  return result;
}

#include <link.h>
#include <sys/resource.h>

static bool scr_has_textrel(void) {
  if (_DYNAMIC == NULL) return false; /* declared by <link.h>; weak so a static link without a dynamic section answers false */
  for (const ElfW(Dyn) *d = _DYNAMIC; d->d_tag != DT_NULL; d++) {
    if (d->d_tag == DT_TEXTREL) return true;
    if (d->d_tag == DT_FLAGS && (d->d_un.d_val & DF_TEXTREL) != 0) return true;
  }
  return false;
}

static bool scr_text_drop_first_done = false;
static double scr_text_drop_first_ms = 0, scr_text_drop_last_ms = 0;
static size_t scr_text_drop_n = 0;

static size_t scr_text_env_num(const char *name, size_t dflt) {
  const char *e = getenv(name);
  if (e == NULL) return dflt;
  long v = strtol(e, NULL, 10);
  return v >= 0 ? (size_t)v : dflt;
}

/* The knobs are read ONCE, at the first seam, into statics. The seam runs on every turn that is about to block, and the
 * environment lookup it used to do each time (getenv scans the whole environment) was most of a turn's own cost: on a
 * 20k-turn timer loop the lookup was about half of all user instructions. State 2 is final "off" (disabled, text
 * relocations, or a one-shot drop that has been done), so a program that will never drop again pays one predictable
 * branch per turn.
 *
 * While live, the per-turn work is ONE compare of the loop's own clock against scr_td_next_ms, the earlier of the next
 * thing that could make a drop due: the timer interval and the next fault check.
 *
 * Fault-triggered repeat (SCR_TEXT_DROP_FAULTS=N, default 256, 0 = off): a timer cannot react inside a burst of first-use
 * code, but the kernel counts the faults that map it. At most every SCR_TEXT_DROP_FAULT_CHECK_MS of loop time (default 8)
 * the process's minor-fault count is read (getrusage); once N faults have accrued since the last drop the drop runs at
 * once and the timer's interval does not apply. Every fault counts, heap growth included; a text fault maps up to 16
 * pages. MEASURED on the zapo REST app (one binary, env only, 2 runs each): peak RSS in the request phase 48.9 / 47.3 MB
 * with the 500 ms timer alone against 43.4 / 43.8 MB with the timer plus N=256 at equal CPU; N=128 alone costs ~10% CPU,
 * N >= 512 changes nothing. */
#ifndef SCR_TEXT_DROP_FAULTS
#define SCR_TEXT_DROP_FAULTS 256
#endif
static int scr_td_state = 0; /* 0 unresolved, 1 live, 2 off */
static size_t scr_td_every = 0, scr_td_faults = 0;
static double scr_td_check_ms = 8, scr_td_next_check_ms = 0, scr_td_next_ms = 0;
static bool scr_td_stat = false;
static long scr_td_last_flt = 0;

static long scr_text_minflt(void) {
  struct rusage ru;
  if (getrusage(RUSAGE_SELF, &ru) != 0) return 0;
  return ru.ru_minflt;
}

static void scr_td_resolve(void) {
  scr_td_state = 1;
  scr_td_every = scr_text_env_num("SCR_TEXT_DROP_EVERY_MS", SCR_TEXT_DROP_EVERY_MS);
  scr_td_faults = scr_text_env_num("SCR_TEXT_DROP_FAULTS", SCR_TEXT_DROP_FAULTS);
  if (scr_td_every == 0) scr_td_faults = 0; /* EVERY_MS=0 is "the first drop only", faults included */
  size_t chk = scr_text_env_num("SCR_TEXT_DROP_FAULT_CHECK_MS", 8);
  scr_td_check_ms = (double)(chk == 0 ? 1 : chk);
  scr_td_stat = scr_text_drop_env("SCR_TEXT_DROP_STAT", false);
  if (!scr_text_drop_env("SCR_TEXT_DROP", SCR_TEXT_DROP != 0) || scr_has_textrel()) scr_td_state = 2;
}

/* The earlier of the timer's next due time and the next fault check (never, if neither is armed). */
static void scr_td_set_next(void) {
  double t = 1e300;
  if (scr_td_every != 0) t = scr_text_drop_last_ms + (double)scr_td_every;
  if (scr_td_faults != 0 && scr_td_next_check_ms < t) t = scr_td_next_check_ms;
  scr_td_next_ms = t;
}

static void scr_text_drop_tick(double now) {
  if (__builtin_expect(scr_td_state != 1, 0)) {
    if (scr_td_state == 2) return;
    scr_td_resolve();
    if (scr_td_state == 2) return;
  }
  if (now < scr_td_next_ms) return; /* the whole per-turn cost while live */
  long flt = 0;
  if (!scr_text_drop_first_done) {
    if (scr_text_drop_first_ms == 0) { scr_text_drop_first_ms = now; scr_td_next_ms = now + (double)SCR_TEXT_DROP_AFTER_MS; return; }
    if (now - scr_text_drop_first_ms < (double)SCR_TEXT_DROP_AFTER_MS) { scr_td_next_ms = scr_text_drop_first_ms + (double)SCR_TEXT_DROP_AFTER_MS; return; }
    scr_text_drop_first_done = true;
  } else {
    bool trigger = false;
    if (scr_td_faults != 0 && now >= scr_td_next_check_ms) {
      scr_td_next_check_ms = now + scr_td_check_ms;
      flt = scr_text_minflt();
      trigger = (size_t)(flt - scr_td_last_flt) >= scr_td_faults;
    }
    /* A repeat: at most once per interval, unless the fault budget is spent. */
    if (!trigger && (scr_td_every == 0 || now - scr_text_drop_last_ms < (double)scr_td_every)) { scr_td_set_next(); return; }
  }
  bool stat = scr_td_stat;
  size_t before = stat ? scr_text_scan(false) : 0;
  size_t maps = scr_text_scan(true);
  scr_text_drop_last_ms = now;
  scr_text_drop_n++;
  if (scr_td_faults != 0) { scr_td_last_flt = flt != 0 ? flt : scr_text_minflt(); scr_td_next_check_ms = now + scr_td_check_ms; }
  if (scr_td_every == 0 && scr_td_faults == 0) scr_td_state = 2; /* the one-shot is done */
  else scr_td_set_next();
  if (stat) {
    size_t after = scr_text_scan(false);
    char nb[24];
    fputs("[textdrop] drop #", stderr);
    fputs(scr_utoa(scr_text_drop_n, nb), stderr);
    fputs(" mappings=", stderr);
    fputs(scr_utoa(maps, nb), stderr);
    fputs(" exeTextKiB ", stderr);
    fputs(scr_utoa(before, nb), stderr);
    fputs("->", stderr);
    fputs(scr_utoa(after, nb), stderr);
    fputs("\n", stderr);
  }
}
#endif /* __linux__ && __GLIBC__ */

static void scr_heap_trim(double now) {
  size_t win = scr_heap_trim_ms();
  if (win == 0) return; /* trim off: the pre-trim runtime, exactly */
  if (scr_heap_trim_next_ms == 0) {
    scr_heap_trim_next_ms = now + (double)win;
    return;
  }
  if (now < scr_heap_trim_next_ms) return;
  scr_heap_trim_next_ms = now + (double)win;
  scr_heap_trims++;

  bool stat = scr_heap_trim_stat();
  size_t before = 0, after = 0, largest = 0, us = 0;

#ifdef _WIN32
  LARGE_INTEGER qf, q0, q1;
  HANDLE h = (HANDLE)(intptr_t)_get_heap_handle();
  qf.QuadPart = 0;
  q0.QuadPart = 0;
  q1.QuadPart = 0;
  if (stat) {
    before = scr_heap_commit_kib();
    QueryPerformanceFrequency(&qf);
    QueryPerformanceCounter(&q0);
  }
  /* Coalesce, then decommit what coalescing exposed. The return value is
   * the largest committed FREE block left, which is the ceiling on what a
   * further trim could possibly hand back. */
  largest = (size_t)HeapCompact(h, 0);
  {
    ScrHeapOptimizeInfo oi;
    oi.Version = 1;
    oi.Flags = 0;
    HeapSetInformation(h, (HEAP_INFORMATION_CLASS)3, &oi, sizeof oi);
  }
  if (stat) {
    QueryPerformanceCounter(&q1);
    if (qf.QuadPart > 0)
      us = (size_t)(((q1.QuadPart - q0.QuadPart) * 1000000LL) / qf.QuadPart);
    after = scr_heap_commit_kib();
  }
#elif defined(__GLIBC__)
  {
    struct timespec t0, t1;
    if (stat) {
      before = scr_heap_commit_kib();
      clock_gettime(CLOCK_MONOTONIC, &t0);
    }
    malloc_trim(0);
    if (stat) {
      clock_gettime(CLOCK_MONOTONIC, &t1);
      after = scr_heap_commit_kib();
      us = (size_t)((t1.tv_sec - t0.tv_sec) * 1000000L +
                    (t1.tv_nsec - t0.tv_nsec) / 1000L);
    }
  }
#endif

  /* ARMING. Every window prints, including the ones that release nothing,
   * so SCR_HEAP_TRIM_MS=0 (zero lines) is distinguishable from a live trim
   * that has nothing left to give (a line reading releasedKiB=0). fputs
   * and a hand-rolled decimal, NOT fprintf: a single %zu here would be the
   * only printf in the always-linked runtime and this file has already
   * paid 33,280 bytes of static hello-world for that mistake once. */
  if (stat) {
    static const char *const labels[6] = {
        "[heaptrim] window commitKiB=", "->", " releasedKiB=",
        " largestFreeKiB=", " us=", " trims="};
    size_t vals[6];
    vals[0] = before;
    vals[1] = after;
    vals[2] = before > after ? before - after : 0;
    vals[3] = largest / 1024u;
    vals[4] = us;
    vals[5] = (size_t)scr_heap_trims;
    scr_heap_trim_line(labels, vals, 6);
  }

#ifdef _WIN32
  /* THE FLOOR, not the delta. busy is what is genuinely allocated and
   * therefore the number no trim can go below; free is the whole of what
   * any trim could ever return.
   *
   * "free is the whole of what any trim could ever return" IS RETRACTED
   * (2026-10-11), and is kept verbatim above as the record of the claim.
   * free OVERSTATES the trim ceiling: the NT heap decommits pages INSIDE
   * a free run WITHOUT reporting them as PROCESS_HEAP_UNCOMMITTED_RANGE,
   * so bytes this census counts as free have in fact already gone back to
   * the OS and no trim can return them twice. MEASURED with a negative
   * control: in the arm that frees nothing, the large free blocks are 100%
   * MEM_COMMIT; in the three arms that do free, 74.6 / 93.7 / 92.7% of
   * them are MEM_RESERVE. This is the same error `busy+free` made about
   * commit, for the same reason -- a HeapWalk flag set is being read as a
   * statement about PAGE STATE, which it is not.
   *
   * SCOPE: this holds for the Win32 census path, which is all this
   * `#ifdef _WIN32` block is; outside it the product keeps no allocator
   * accounting at all, so there is no other lane for the claim to be
   * right on. The counters below are still the right instrument -- only
   * the reading that freeKiB BOUNDS the trim was wrong.
   * A retained working set that is nearly all
   * busy is not a trim problem at all -- it is a peak problem. Off by
   * default because HeapWalk is O(blocks) and a 100 MiB heap has upwards
   * of a million of them. */
  if (scr_heap_trim_census_on()) {
    PROCESS_HEAP_ENTRY e;
    size_t busy = 0, freeb = 0, nbusy = 0, nfree = 0, nregion = 0;
    size_t uncommitted = 0;
    LARGE_INTEGER cf, c0, c1;
    cf.QuadPart = 0;
    QueryPerformanceFrequency(&cf);
    QueryPerformanceCounter(&c0);
    memset(&e, 0, sizeof e);
    HeapLock(h);
    while (HeapWalk(h, &e)) {
      if (e.wFlags & PROCESS_HEAP_ENTRY_BUSY) {
        busy += (size_t)e.cbData + e.cbOverhead;
        nbusy++;
      } else if (e.wFlags & PROCESS_HEAP_UNCOMMITTED_RANGE) {
        uncommitted += (size_t)e.cbData;
      } else if (e.wFlags & PROCESS_HEAP_REGION) {
        nregion++;
      } else {
        freeb += (size_t)e.cbData + e.cbOverhead;
        nfree++;
      }
    }
    HeapUnlock(h);
    QueryPerformanceCounter(&c1);
    {
      static const char *const labels[7] = {
          "[heaptrim] census busyKiB=", " freeKiB=", " uncommittedKiB=",
          " busyBlocks=", " freeBlocks=", " regions=", " walk_us="};
      size_t vals[7];
      vals[0] = busy / 1024u;
      vals[1] = freeb / 1024u;
      vals[2] = uncommitted / 1024u;
      vals[3] = nbusy;
      vals[4] = nfree;
      vals[5] = nregion;
      vals[6] = cf.QuadPart > 0
                    ? (size_t)(((c1.QuadPart - c0.QuadPart) * 1000000LL) /
                               cf.QuadPart)
                    : 0;
      scr_heap_trim_line(labels, vals, 7);
    }
  }
#endif
}

/* Copies a rejection into the active execution context's exception cell.
 * The payload is RETAINED, not moved — a promise can be awaited more than
 * once, and the executable's top-level completion probe consumes the same
 * settlement from the main stack after the loop drains. */
static void scr_promise_rethrow(ScrPromise *p) {
  switch (p->payload_kind) {
  case SCR_EXC_F64: scr_throw_f64(p->f64); break;
  case SCR_EXC_BOOL: scr_throw_bool(p->b); break;
  case SCR_EXC_STR: scr_throw_str(scr_str_retain((ScrStr *)p->payload)); break;
  case SCR_EXC_REF: scr_throw_ref(PV(p)->retain(p->payload), PV(p)->retain, PV(p)->release, PV(p)->trace); break;
  case SCR_EXC_OBJ: scr_throw_obj(PV(p)->retain(p->payload), PV(p)->retain, PV(p)->release, PV(p)->trace); break;
  case SCR_EXC_NONE:
  case SCR_EXC_GENRET: /* unreachable: the sentinel never settles a promise */
    scr_throw_str(scr_str_new("undefined", 9));
    break;
  }
}

/* THE ORACLE SELF-TEST: SCR_TICK_POISON adds ONE microtask turn to every
 * already-settled await, which is the pre-ES2019 await cost -- the exact
 * mistake a stackless re-lowering of async/await is most likely to make.
 *
 * It exists because the differential corpus CANNOT be trusted to catch a
 * one-turn scheduling change on its own. Measured 2026-10-05 over the 313
 * corpus programs that touch a promise or a timer: with this knob set, 10 of
 * them change their bytes and 276 do not. A uniform one-turn shift is only
 * observable where TWO independent job chains interleave, and almost no
 * corpus program has two -- 1428-settled-await-order.ts, which the comment
 * on scr_await_yield below names as the pin for this very hop, passes
 * POISONED.
 *
 * tests/harness/microtask-turns.test.ts is the net that does catch it, and
 * it asserts BOTH directions: the clean table matches Node turn for turn,
 * and the poisoned table differs from it. If the poison ever stops going
 * red, the net has died without saying so.
 *
 * Deliberately NOT on the scr_await_hop path (await of a non-thenable), so
 * that test's primary clock stays immune to it and reads true turn counts;
 * its secondary clock, built out of .then, does ride this path on purpose.
 *
 * Off unless the variable is set to something other than empty or 0, so a
 * shipped binary is behaviourally identical and pays one cached load. */
static bool scr_tick_poison(void) {
  static int on = -1;
  if (on < 0) {
    const char *e = getenv("SCR_TICK_POISON");
    on = (e != NULL && e[0] != 0 && e[0] != '0') ? 1 : 0;
  }
  return on != 0;
}

/* ECMAScript's INTERNAL module-dependency wait, on a SETTLED dependency: an already-completed dependency does not introduce a promise-job hop,
 * so the evaluator observes it in this turn and a rejection propagates like an ordinary await. A pending dependency is awaited by the
 * initialiser's own state machine (lower-modules: `module.pending` guards the await), never here. */
void scr_module_await(ScrPromise *p) {
  if (p->state == SCR_PROM_PENDING) {
    fputs("scriptc: internal error: module dependency wait on a pending promise\n", stderr);
    abort();
  }
  scr_prom_observe(p);
  if (p->state == SCR_PROM_REJECTED) scr_promise_rethrow(p);
}

/* A rejected module root that an 'uncaughtException' listener consumed (Node
 * reports the evaluation rejection to the listeners and the process goes on):
 * the loop runs on, and the root is no longer fatal. */
static bool scr_root_consumed = false;

int scr_promise_finish_top_level(ScrPromise *p) {
  if (p->state == SCR_PROM_PENDING) {
    /* ECMAScript module evaluation is still pending, but Node's ref'd
     * event-loop work is exhausted. Node exits with its dedicated
     * unsettled-top-level-await status. */
    scr_exit_code_note(13);
    return 13;
  }
  scr_prom_observe(p);
  return p->state == SCR_PROM_REJECTED && !scr_root_consumed ? 1 : 0;
}

void scr_promise_rethrow_top_level(ScrPromise *p) {
  if (p->state == SCR_PROM_REJECTED) scr_promise_rethrow(p);
}





/* Fulfillment storers, called by the compiled trampolines / resolve thunks. */
void scr_promise_fulfill_f64(ScrPromise *p, double v) {
  if (p->state != SCR_PROM_PENDING) return; /* first settle wins */
  p->state = SCR_PROM_FULFILLED;
  p->payload_kind = SCR_EXC_F64;
  p->f64 = v;
  scr_promise_settle_wake(p);
}
void scr_promise_fulfill_bool(ScrPromise *p, bool v) {
  if (p->state != SCR_PROM_PENDING) return;
  p->state = SCR_PROM_FULFILLED;
  p->payload_kind = SCR_EXC_BOOL;
  p->b = v;
  scr_promise_settle_wake(p);
}
/* The checked-dynamic unit (scr_async_dyn.c) installs this when it is linked: a promise whose payload is a DYNAMIC value is
 * RESOLVED with it (a promise or a thenable is adopted, anything else fulfills), because a promise is never fulfilled with
 * a thenable. NULL when no dynamic value can be a promise, which is the only case the plain fulfill below is right. */
bool (*scr_promise_dyn_resolve_hook)(ScrPromise *p, void *v, void (*release)(void *)) = NULL;

void scr_promise_fulfill_ref(ScrPromise *p, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  if (scr_promise_dyn_resolve_hook != NULL && p->state == SCR_PROM_PENDING && v != NULL &&
      scr_promise_dyn_resolve_hook(p, v, release)) {
    return;
  }
  scr_promise_fulfill_ref_raw(p, v, retain, release, trace);
}

void scr_promise_fulfill_ref_raw(ScrPromise *p, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  if (p->state != SCR_PROM_PENDING) {
    if (release) release(v); /* value was +1 for us; drop it */
    return;
  }
  p->state = SCR_PROM_FULFILLED;
  p->payload_kind = v ? SCR_EXC_REF : SCR_EXC_NONE;
  p->payload = v;
  p->vt = scr_prom_vt_intern(retain, release, trace);
  scr_promise_settle_wake(p);
}
bool scr_promise_is_pending(const ScrPromise *p) {
  return p->state == SCR_PROM_PENDING;
}
void scr_promise_fulfill_void(ScrPromise *p) {
  if (p->state != SCR_PROM_PENDING) return;
  p->state = SCR_PROM_FULFILLED;
  p->payload_kind = SCR_EXC_NONE;
  scr_promise_settle_wake(p);
}

/* String payloads ride the STR kind so awaits type them precisely. */
void scr_promise_fulfill_str(ScrPromise *p, ScrStr *v) {
  if (p->state != SCR_PROM_PENDING) {
    scr_str_release(v);
    return;
  }
  p->state = SCR_PROM_FULFILLED;
  p->payload_kind = SCR_EXC_STR;
  p->payload = v; /* ownership moves in */
  p->vt = scr_prom_vt_intern((void *(*)(void *))scr_str_retain, (void (*)(void *))scr_str_release, NULL);
  scr_promise_settle_wake(p);
}

/* REJECTS `p` with the exception pending in the ACTIVE cell (moved out —
 * the cell resets, so the caller returns to the engine/loop with a clean
 * cell) and wakes waiters; the rejection enters the unhandled ledger like
 * any other. The island → static promise bridge's rejection half: its
 * settle callback converts the engine reason into a pending exception
 * (the exception bridge's one conversion), then lands it here. A no-op
 * with nothing pending; an already-settled `p` just clears the cell
 * (first settle wins, like resolve-then-throw). */
void scr_promise_reject_pending(ScrPromise *p) {
  if (!scr_exc_pending()) return;
  if (p->state == SCR_PROM_PENDING) {
    scr_promise_reject_from_cell(p, scr_exc_current_cell());
    scr_promise_settle_wake(p);
  } else {
    scr_exc_clear();
  }
}

/* ── settled-promise minting (the fs/promises bridge) ─────────────────
 * The promise-returning stdlib functions run their syscall SYNCHRONOUSLY
 * (the documented non-interleaving divergence, SEMANTICS.md) and wrap the
 * outcome here: a pending exception in the active cell becomes the
 * promise's REJECTION (moved out of the cell — the caller's pending check
 * then sees a clean cell, exactly like Node where fs/promises failures
 * reject instead of throwing), anything else fulfills with the payload.
 * The rejected case still enters the unhandled-rejection ledger, so a
 * never-awaited failure reports at exit like any other rejection. */

static ScrPromise *scr_promise_settled_common(void) {
  if (!scr_exc_pending()) return NULL;
  ScrPromise *p = scr_promise_new();
  scr_promise_reject_from_cell(p, scr_exc_current_cell());
  scr_promise_settle_wake(p); /* no waiters yet; enters the ledger */
  return p;
}

ScrPromise *scr_promise_settled_str(ScrStr *v) {
  ScrPromise *rejected = scr_promise_settled_common();
  if (rejected) {
    scr_str_release(v); /* NULL-tolerant; the op returned a dummy */
    return rejected;
  }
  ScrPromise *p = scr_promise_new();
  scr_promise_fulfill_str(p, v); /* moves in */
  return p;
}

ScrPromise *scr_promise_settled_f64(double v) {
  ScrPromise *rejected = scr_promise_settled_common();
  if (rejected) return rejected; /* the op threw; the payload is moot */
  ScrPromise *p = scr_promise_new();
  scr_promise_fulfill_f64(p, v);
  return p;
}
/* The bool twin (promisified verify): the settled tier has one slot per
 * payload kind and bool had no caller until now. */
ScrPromise *scr_promise_settled_bool(bool v) {
  ScrPromise *rejected = scr_promise_settled_common();
  if (rejected) return rejected;
  ScrPromise *p = scr_promise_new();
  scr_promise_fulfill_bool(p, v);
  return p;
}

ScrPromise *scr_promise_settled_void(void) {
  ScrPromise *rejected = scr_promise_settled_common();
  if (rejected) return rejected;
  ScrPromise *p = scr_promise_new();
  scr_promise_fulfill_void(p);
  return p;
}

ScrPromise *scr_promise_settled_ref(void *v, void *(*retain)(void *), void (*release)(void *),
                                     ScrTraceFn trace) {
  ScrPromise *rejected = scr_promise_settled_common();
  if (rejected) {
    if (v && release) release(v);
    return rejected;
  }
  ScrPromise *p = scr_promise_new();
  scr_promise_fulfill_ref(p, v, retain, release, trace); /* moves in */
  return p;
}

/* ── fs/promises ─────────────────────────────────────────────────────
 * The promise forms run the SAME sync operations and mint an already-
 * settled promise (scr_promise_settled_*): success fulfills, a pending
 * exception moves in as the rejection — catchable at the await, like
 * Node. DOCUMENTED DIVERGENCE (SEMANTICS.md): the syscall blocks the
 * event loop, so I/O never interleaves with timers or other fibers —
 * observable only in concurrent code, not in the sequential await
 * chains CLIs are made of. */

ScrPromise *scr_fsp_read_file(ScrStr *path) {
  return scr_promise_settled_str(scr_fs_read_file(path));
}

ScrPromise *scr_fsp_write_file(ScrStr *path, ScrStr *data) {
  scr_fs_write_file(path, data);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_mkdir(ScrStr *path) {
  scr_fs_mkdir(path);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_mkdir_mode(ScrStr *path, double mode) {
  scr_fs_mkdir_mode(path, mode);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_mkdir_recursive(ScrStr *path) {
  scr_fs_mkdir_recursive(path);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_mkdir_recursive_mode(ScrStr *path, double mode) {
  scr_fs_mkdir_recursive_mode(path, mode);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_unlink(ScrStr *path) {
  scr_fs_unlink(path);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_rename(ScrStr *oldpath, ScrStr *newpath) {
  scr_fs_rename(oldpath, newpath);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_chmod(ScrStr *path, double mode) {
  scr_fs_chmod(path, mode);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_readdir(ScrStr *path) {
  ScrArr *names = scr_fs_readdir(path);
  return scr_promise_settled_ref(names, &scr_arr_retain_v, &scr_arr_release_v, NULL);
}

ScrPromise *scr_fsp_rm(ScrStr *path) {
  scr_fs_rm(path);
  return scr_promise_settled_void();
}

ScrPromise *scr_fsp_stat(ScrStr *path) {
  ScrStats *st = scr_fs_stat(path);
  return scr_promise_settled_ref(st, &scr_stats_retain_v, &scr_stats_release_v, NULL);
}

/* ── fs.stat(path, cb) ───────────────────────────────────────────────
 * The stat runs at the call (fsp.stat's shape); the callback fires on the
 * next loop turn with (err, stats). On failure Node calls cb(err) with no
 * stats; the typed closure's stats parameter is NULL then (the same
 * stance dns.lookup takes for its address on failure). The pending record
 * is refcounted: the timer's closure holds it through a box, the fire
 * drops its own reference after the call, and the last release frees the
 * callback, the error and the stats. */
typedef struct {
  size_t rc;
  ScrClosure *cb;
  ScrFsStatFn fn;
  ScrError *err;
  ScrStats *st;
} ScrFsStatPending;

static void scr_fs_stat_pending_release(ScrFsStatPending *p) {
  if (--p->rc != 0) return;
  scr_closure_release(p->cb);
  if (p->err) scr_error_release_v(p->err);
  if (p->st) scr_stats_release_v(p->st);
  free(p);
}

static void *scr_fs_stat_pending_retain_v(void *p) {
  ((ScrFsStatPending *)p)->rc++;
  return p;
}

static void scr_fs_stat_pending_release_v(void *p) { scr_fs_stat_pending_release((ScrFsStatPending *)p); }

#ifndef SCR_LIB
static void scr_fs_stat_fire(ScrClosure *self) {
  ScrFsStatPending *p = scr_box_get_ref(self->caps[0]);
  p->fn(p->cb, p->err, p->st);
  scr_fs_stat_pending_release(p);
}
#endif

void scr_fs_stat_cb(ScrStr *path, ScrClosure *cb, ScrFsStatFn fn) {
#ifdef SCR_LIB
  scr_closure_release(cb);
  scr_trap("scriptc: internal error: fs.stat callback reached in a library build — please report this");
#else
  ScrFsStatPending *p = calloc(1, sizeof *p);
  if (!p) scr_trap("scriptc: out of memory\n");
  p->rc = 1;
  p->cb = cb; /* moves */
  p->fn = fn;
  p->st = scr_fs_stat_try(path, &p->err);
  ScrClosure *clo = scr_closure_new((void *)scr_fs_stat_fire, 1);
  clo->caps[0] = scr_box_new_obj(scr_fs_stat_pending_retain_v, scr_fs_stat_pending_release_v, NULL);
  scr_box_set_ref(clo->caps[0], p); /* the box owns the record's one reference */
  scr_set_timeout(clo, 0);
#endif
}

/* ── node:timers/promises ────────────────────────────────────────────
 * The promisified pair: a PENDING void promise a one-shot heap timer
 * (setTimeout) or the immediate queue (setImmediate) fulfills — the
 * resolve closure is scr_make_resolve's void thunk, so settlement wakes
 * awaiting fibers exactly like every other promise, and the armed
 * timer/immediate keeps the loop alive until it fires (Node: an awaited
 * timers/promises sleep holds the process open). Neither throws; the
 * delay rides scr_set_timeout's own Node-exact coercion (clamp to 1,
 * truncate). */

ScrPromise *scr_tp_set_timeout(double ms) {
  ScrPromise *p = scr_promise_new();
  scr_set_timeout(scr_make_resolve(p, 3 /* void */), ms);
  return p;
}

ScrPromise *scr_tp_set_immediate(void) {
  ScrPromise *p = scr_promise_new();
  scr_set_immediate(scr_make_resolve(p, 3 /* void */));
  return p;
}

/* ── setImmediate as a first-class dyn value ─────────────────────────
 * The global passed AS A FUNCTION VALUE into untyped code (the Node-suite
 * traceCallback shape: `channel.traceCallback(setImmediate, 0, ctx, null,
 * cb)`). The minted dyn callable schedules its own immediate that calls
 * args[0] with the remaining arguments (Node's setImmediate(cb, ...args)
 * contract) and answers undefined (the Immediate handle object has no dyn
 * story — clearImmediate over this value is not modeled). A non-function
 * first argument throws Node's ERR_INVALID_ARG_TYPE synchronously. */

static void scr_imm_dyn_fire(ScrClosure *c) {
  ScrDyn *fn = (ScrDyn *)scr_box_get_ref(c->caps[0]);
  ScrDyn *args = (ScrDyn *)scr_box_get_ref(c->caps[1]);
  ScrDyn *r = scr_dyn_call(fn, args->v.arr.items, args->v.arr.len, "immediate callback");
  if (r != NULL) scr_dyn_release(r);
  scr_dyn_release(fn);
  scr_dyn_release(args);
}

/* Node's ERR_INVALID_ARG_TYPE for a timer callback that is not a function,
 * with the "Received ..." tail (determineSpecificType, the dyn kinds). */
static void scr_timer_bad_cb(const ScrDyn *cb) {
  const char *received = "an instance of Object";
  char detail[96];
  if (cb == NULL) {
    received = "undefined";
  } else {
    switch (cb->kind) {
    case SCR_DYN_NULL: received = "null"; break;
    case SCR_DYN_UNDEF: received = "undefined"; break;
    case SCR_DYN_ARR: received = "an instance of Array"; break;
    case SCR_DYN_BOOL:
      snprintf(detail, sizeof detail, "type boolean (%s)", cb->v.b ? "true" : "false");
      received = detail;
      break;
    case SCR_DYN_NUM: {
      char num[32];
      size_t n = scr_f64_to_str(cb->v.num, num);
      snprintf(detail, sizeof detail, "type number (%.*s)", (int)n, num);
      received = detail;
      break;
    }
    case SCR_DYN_STR:
      snprintf(detail, sizeof detail, "type string ('%.*s')",
               (int)(cb->v.str->len < 28 ? cb->v.str->len : 28), cb->v.str->data);
      received = detail;
      break;
    default: break;
    }
  }
  char buf[192];
  int n = snprintf(buf, sizeof buf, "The \"callback\" argument must be of type function. Received %s", received);
  scr_throw_error_msg_code(SCR_ERR_TYPE, buf, (size_t)n, "ERR_INVALID_ARG_TYPE");
}

/* The zero-argument closure of a deferred dyn call: captures the callback
 * box and the packed trailing arguments (args[first..argc)). */
static ScrClosure *scr_timer_dyn_closure(ScrDyn *const *args, size_t argc, size_t first) {
  ScrDyn *rest = scr_dyn_new_arr();
  for (size_t i = first; i < argc; i++) scr_dyn_arr_push(rest, scr_dyn_retain(args[i]));
  ScrClosure *c = scr_closure_new((void *)scr_imm_dyn_fire, 2);
  c->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(c->caps[0], scr_dyn_retain(args[0]));
  c->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(c->caps[1], rest); /* moves */
  return c;
}

static ScrDyn *scr_imm_dyn_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc == 0 || args[0]->kind != SCR_DYN_FUNC) {
    scr_timer_bad_cb(argc == 0 ? NULL : args[0]);
    return NULL;
  }
  return scr_dyn_new_num(scr_set_immediate(scr_timer_dyn_closure(args, argc, 1)));
}

/* setTimeout(cb, ms, ...args) / setInterval(cb, ms, ...args) as values: the
 * delay is ToNumber'd (an absent or NaN delay is Node's 1ms), the trailing
 * arguments ride to every call, and the answer is the clearable handle the
 * static surface hands out. */
static ScrDyn *scr_timeout_dyn_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc == 0 || args[0]->kind != SCR_DYN_FUNC) {
    scr_timer_bad_cb(argc == 0 ? NULL : args[0]);
    return NULL;
  }
  /* An undefined delay is Node's 1ms with no warning (never NaN). */
  double ms = argc > 1 && args[1]->kind != SCR_DYN_UNDEF ? scr_dyn_to_number(args[1]) : 1;
  if (scr_exc_pending()) return NULL;
  return scr_dyn_new_num(scr_set_timeout_handle(scr_timer_dyn_closure(args, argc, 2), ms));
}

static ScrDyn *scr_interval_dyn_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc == 0 || args[0]->kind != SCR_DYN_FUNC) {
    scr_timer_bad_cb(argc == 0 ? NULL : args[0]);
    return NULL;
  }
  /* An undefined delay is Node's 1ms with no warning (never NaN). */
  double ms = argc > 1 && args[1]->kind != SCR_DYN_UNDEF ? scr_dyn_to_number(args[1]) : 1;
  if (scr_exc_pending()) return NULL;
  return scr_dyn_new_num(scr_set_interval(scr_timer_dyn_closure(args, argc, 2), ms));
}

/* One immortal closure per function (rc SIZE_MAX, like an interned top-level
 * function): every evaluation of the global boxes the SAME closure, and a
 * function box compares by its closure, so `setTimeout === setTimeout`. */
static ScrClosure scr_imm_dyn_clo = {SIZE_MAX, (void *)scr_imm_dyn_thunk, 0, NULL, NULL};
static ScrClosure scr_timeout_dyn_clo = {SIZE_MAX, (void *)scr_timeout_dyn_thunk, 0, NULL, NULL};
static ScrClosure scr_interval_dyn_clo = {SIZE_MAX, (void *)scr_interval_dyn_thunk, 0, NULL, NULL};

ScrDyn *scr_set_immediate_dyn_value(void) {
  return scr_dyn_new_func(&scr_imm_dyn_clo, scr_imm_dyn_thunk, 1, "(callback,...args)", "setImmediate");
}

ScrDyn *scr_set_timeout_dyn_value(void) {
  return scr_dyn_new_func(&scr_timeout_dyn_clo, scr_timeout_dyn_thunk, 2, "(callback,delay,...args)", "setTimeout");
}

ScrDyn *scr_set_interval_dyn_value(void) {
  return scr_dyn_new_func(&scr_interval_dyn_clo, scr_interval_dyn_thunk, 2, "(callback,delay,...args)", "setInterval");
}

/* ── queueMicrotask ──────────────────────────────────────────────────
 * The READY queue's FIFO is the microtask queue (promise continuations
 * ride it as parked fibers), so a queueMicrotask callback enters the SAME
 * queue as a stackless envelope — one order across both producers, like
 * V8's single microtask queue. scr_resume_fiber runs the closure on the
 * main stack; a throw is an uncaught exception (Node's queueMicrotask),
 * never a rejection. */
void scr_queue_microtask(ScrClosure *cb) {
  ScrFiber *f = scr_envelope_new();
  f->micro_cb = cb; /* ownership moves in */
  scr_ready_push(f);
}

/* The runtime-internal twin: `fn(arg)` on the next microtask turn, with
 * `arg`'s reference moving in (released after fn returns). */
void scr_queue_microtask_raw(void (*fn)(void *), void *arg,
                             void (*arg_release)(void *)) {
  ScrFiber *f = scr_envelope_new();
  f->micro_raw = fn;
  f->micro_arg = arg;
  f->micro_arg_release = arg_release;
  scr_ready_push(f);
}

/* -- Stackless reactions on a promise (always linked) ---------------------
 * scr_dyn_promise_then (scr_async_dyn.c) used to spawn a FIBER per .then /
 * .catch / .finally registration just to wait for the source and run the
 * callback; a pipelined ioredis command registers two of them, so a burst of
 * commands held thousands of parked fibers (a stack each). The reaction needs
 * no stack of its own: it is a continuation that runs from the ready queue on
 * the main stack, exactly like a queueMicrotask envelope.
 *
 * scr_promise_wait_raw is scr_await_settled's two arms for a continuation
 * instead of a fiber, with the same push accounting (one scr_ready_push per
 * wait):
 *   settled operand: one microtask hop now (two under SCR_TICK_POISON, like
 *                    the fiber arm);
 *   pending operand: the envelope joins the promise's waiter list and the
 *                    settle's existing push wakes it once.
 * `fn(arg)` runs on the main stack when the turn comes; it owns `arg`. */
static void scr_promise_park_envelope(ScrPromise *p, void (*fn)(void *), void *arg,
                                      void (*arg_release)(void *)) {
  ScrFiber *f = scr_envelope_new();
  f->micro_raw = fn;
  f->micro_arg = arg;
  f->micro_arg_release = arg_release;
  p = scr_prom_reg_target(p);
  scr_prom_wadd(p, f);
}

typedef struct {
  void (*fn)(void *);
  void *arg;
} ScrWaitHop2;

static void scr_wait_hop2_run(void *hp) {
  ScrWaitHop2 *h = (ScrWaitHop2 *)hp;
  void (*fn)(void *) = h->fn;
  void *arg = h->arg;
  free(h);
  scr_queue_microtask_raw(fn, arg, NULL);
}

void scr_promise_wait_raw(ScrPromise *p, void (*fn)(void *), void *arg) {
  if (p->state != SCR_PROM_PENDING) {
    if (scr_tick_poison()) {
      ScrWaitHop2 *h = malloc(sizeof *h);
      if (!h) scr_oom();
      h->fn = fn;
      h->arg = arg;
      scr_queue_microtask_raw(scr_wait_hop2_run, h, NULL);
    } else {
      scr_queue_microtask_raw(fn, arg, NULL);
    }
    return;
  }
  scr_promise_park_envelope(p, fn, arg, NULL);
}

/* The part of scr_await_settled after the wait: mark the settlement observed
 * and, for a rejection, copy the reason into the ACTIVE exception cell. True
 * for a fulfillment. The promise must already be settled. */
bool scr_promise_settled_take(ScrPromise *p) {
  scr_prom_observe(p);
  if (p->state == SCR_PROM_REJECTED) {
    scr_promise_rethrow(p);
    return false;
  }
  return true;
}

/* The settled payload of a FULFILLED promise, as the awaits read it (+1 for a reference), for a reaction running as a continuation
 * (scr_promise_wait_raw) after scr_promise_settled_take answered true. */
double scr_promise_value_f64(const ScrPromise *p) { return p->f64; }
bool scr_promise_value_bool(const ScrPromise *p) { return p->b; }
void *scr_promise_value_ref(const ScrPromise *p) { return p->payload ? PV(p)->retain(p->payload) : NULL; }

/* The part of scr_await_settled after the wait, fused with the "is it settled yet" test so the caller pays ONE call
 * for both: -1 while the promise is still pending (nothing consumed: the caller waits again, which is the
 * `while (pending) park` of the fiber this replaced), otherwise the settlement is marked observed and a rejection's
 * reason is copied into the ACTIVE exception cell: 0 for a rejection, 1 for a fulfillment. */
int scr_promise_settled_try_take(ScrPromise *p) {
  if (p->state == SCR_PROM_PENDING) return -1;
  scr_prom_observe(p);
  if (p->state == SCR_PROM_REJECTED) {
    scr_promise_rethrow(p);
    return 0;
  }
  return 1;
}

#ifdef SCR_CORO_LANE
/* GATED ON THE LINK, not on a knob. cc.ts defines SCR_CORO_LANE exactly when
 * scr_coro.c is in this link -- derived from the source list itself, so the
 * two cannot disagree -- and scr_coro.c is the only consumer of everything
 * below.
 *
 * Ungated this is ALWAYS-LINKED code, because scr_async.c ships in every
 * binary whether or not the stackless lane does. It cost a knob-off
 * hello-world 400 bytes of .text, measured +400 on two unrelated programs --
 * the always-linked signature. The file-size anchor saw +512 and passed it;
 * the .text anchor caught it. */
/* ââ stackless coroutine support ââââââââââââââââââââââââââââââ
 * ScrPromise is opaque outside this file, so scr_coro.c cannot reach its
 * state or its waiter list. These are the only primitives it needs, and
 * they are deliberately thin: the policy lives in scr_coro.c, this is just
 * the window onto the struct.
 *
 * scr_coro_promise_park is the load-bearing one. It attaches a RAW ENVELOPE
 * to the promise's existing `waiters` list, so the wake rides the push site
 * that is already there:
 *
 *     for (i) scr_ready_push(p->waiters[i]);   // scr_promise_settle_wake
 *
 * That matters for two reasons. It adds no second push site, so "exactly one
 * scr_ready_push per await" stays checkable by counting the four that exist.
 * And it pushes for BOTH settlement kinds -- the `cbs` list does not: its
 * dispatch calls `adapt` only on the fulfilled arm and runs synchronously
 * inside the settle, so a resume hung there would skip a turn and would
 * never fire on a rejection. waiters is the mechanism await already uses;
 * a coroutine is just an awaiter that is not a fiber. */

/** SCR_TICK_POISON, for the stackless lane.
 *
 * An ACCESSOR over scr_tick_poison's cached static, deliberately not a
 * second getenv: two independent reads of one variable can disagree (a
 * setenv between them, a differently-spelled default) and then the poison
 * lies on one lane while telling the truth on the other -- which is the
 * exact failure this net exists to prevent.
 *
 * The poison was written to catch "the exact mistake a stackless
 * re-lowering of async/await is most likely to make", and until this
 * existed it could not reach that lowering at all: scr_tick_poison is
 * static here and scr_coro.c never consulted it, so a poisoned run left
 * every stackless turn count unmoved and the table stayed green. A green
 * table from a net that cannot see the lane it guards is necessary, not
 * sufficient. */
bool scr_coro_tick_poison(void) { return scr_tick_poison(); }

/** True once the promise has settled either way. */
bool scr_coro_promise_settled(const ScrPromise *p) {
  return p->state != SCR_PROM_PENDING;
}

/** True for a rejected settlement (only meaningful once settled). */
bool scr_coro_promise_rejected(const ScrPromise *p) {
  return p->state == SCR_PROM_REJECTED;
}

/** Park a raw continuation on a PENDING promise: when `p` settles, the
 * existing waiter wake pushes this envelope exactly once and
 * scr_resume_fiber runs `fn(arg)` on the main stack.
 *
 * Returns false and attaches nothing when `p` is already settled -- the
 * caller owes the one-turn hop itself, which is the other arm of
 * scr_await_settled's `if`. */
bool scr_coro_promise_park(ScrPromise *p, void (*fn)(void *), void *arg,
                           void (*arg_release)(void *)) {
  if (p->state != SCR_PROM_PENDING) return false;
  scr_promise_park_envelope(p, fn, arg, arg_release);
  return true;
}

/** Mark a settlement observed (the unhandled-rejection ledger). */
void scr_coro_promise_observe(ScrPromise *p) { scr_prom_observe(p); }

/** Copy a rejected promise's reason into the ACTIVE exception cell, the
 * same call the fiber await path makes. */
void scr_coro_promise_rethrow(ScrPromise *p) { scr_promise_rethrow(p); }

/* Settled payload readers. No parking, no observation -- the caller has
 * already established that the promise is settled and fulfilled. */
double scr_coro_promise_f64(const ScrPromise *p) { SCR_PROM_SCALAR_KIND(p, SCR_EXC_F64); return p->f64; }
bool   scr_coro_promise_bool(const ScrPromise *p) { SCR_PROM_SCALAR_KIND(p, SCR_EXC_BOOL); return p->b; }
void  *scr_coro_promise_ref(const ScrPromise *p) {
  return p->payload ? PV(p)->retain(p->payload) : NULL;
}
#endif /* SCR_CORO_LANE */

/* The checked-dynamic argument form (JS files — common.mustCall wrappers
 * and the suite's invalid-input probes): a non-function throws Node's
 * ERR_INVALID_ARG_TYPE synchronously; a function value is called with
 * zero arguments (Node passes none — extra queueMicrotask arguments are
 * ignored). */
static void scr_micro_dyn_fire(ScrClosure *c) {
  ScrDyn *fn = (ScrDyn *)scr_box_get_ref(c->caps[0]);
  ScrDyn *r = scr_dyn_call(fn, NULL, 0, "queueMicrotask callback");
  if (r != NULL) scr_dyn_release(r);
  scr_dyn_release(fn);
}

void scr_queue_microtask_dyn(const ScrDyn *cb) {
  if (cb->kind != SCR_DYN_FUNC) {
    static const char msg[] = "The \"callback\" argument must be of type function.";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_INVALID_ARG_TYPE");
    return;
  }
  ScrClosure *c = scr_closure_new((void *)scr_micro_dyn_fire, 1);
  c->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(c->caps[0], scr_dyn_retain((ScrDyn *)cb));
  scr_queue_microtask(c);
}

/* ── the event hooks (scr_events.c) ──────────────────────────────────
 * Process signal/exit events and the piped-stdin surface live in
 * scr_events.c, which links ONLY into binaries whose IR uses those
 * surfaces (the io-hook precedent, gated like scr_regex/scr_fetch):
 * scr_events_install() fills these slots before %main. Event-free
 * builds keep every slot NULL and the loop is byte-identical in
 * behavior. The scr_lib.c hooks live in scr_lib.c and the abnormal-exit
 * code hint in scr_exception.c, so each unit stays self-contained (the
 * runtime C tests link them separately). */

static bool (*scr_events_pending_fn)(void) = NULL;  /* keeps the loop alive */
static bool (*scr_events_watching_fn)(void) = NULL; /* wants the poll sleep */
static void (*scr_events_dispatch_fn)(void) = NULL; /* fire due listeners */
static int (*scr_events_pollfds_fn)(int out[2]) = NULL;

void scr_loop_set_events(bool (*pending)(void), bool (*watching)(void),
                          void (*dispatch)(void), int (*pollfds)(int out[2])) {
  scr_events_pending_fn = pending;
  scr_events_watching_fn = watching;
  scr_events_dispatch_fn = dispatch;
  scr_events_pollfds_fn = pollfds;
}

/* ── the event loop ───────────────────────────────────────────────────── */

static void scr_resume_fiber(ScrFiber *f) {
  /* The runtime's raw envelope (scr_queue_microtask_raw). Same contract as
   * the queueMicrotask one below: the main stack, no context switch, and a
   * throw stays pending for the drain site's uncaught report. */
  if (f->micro_raw != NULL) {
    void (*fn)(void *) = f->micro_raw;
    void *arg = f->micro_arg;
    void (*rel)(void *) = f->micro_arg_release;
    free(f);
    fn(arg);
    if (rel != NULL) rel(arg);
    return;
  }
  /* A queueMicrotask envelope: run the closure on the main stack, no
   * context switch. A throw leaves the exception cell pending — every
   * drain site returns to main's uncaught report, Node's queueMicrotask
   * semantics (uncaughtException, never an unhandled rejection). */
  if (f->micro_cb != NULL) {
    ScrClosure *cb = f->micro_cb;
    free(f);
    ((void (*)(ScrClosure *))cb->fn)(cb);
    scr_closure_release(cb);
    return;
  }
  /* An empty envelope cannot be queued: every producer fills micro_raw or micro_cb. */
  free(f);
  abort();
}

/* Reap granularity while children are pending on the POLLING fallback:
 * the loop polls waitpid(WNOHANG) at least this often instead of sleeping
 * to the next timer deadline. The primary path has no cap — the sleep
 * waits on the child watch (scr_children_wait — kqueue NOTE_EXIT on BSD,
 * pidfd epoll on Linux, the timer deadline riding the wait timeout) and a
 * child's exit wakes it immediately. The fallback covers platforms with
 * neither backend, children whose exit watch could not be armed, and
 * turns where the io poll takes the sleep (curl's fds can't join it). */
#define SCR_CHILD_POLL_MS 1.0

/* Sleep cap while only external io is pending (no timer models its
 * wakeup): the io poll sleeps on REAL fds inside this window (a fetch
 * transfer's sockets wake it early), so a generous cap costs nothing. */
#define SCR_IO_POLL_MS 1000.0

/* Sleep cap while signal handlers or stdin consumers are pending AND the
 * io poll owns the sleep (curl's fd wait retries on EINTR and can't watch
 * the wake pipe): bounded signal/stdin latency during a fetch at 20
 * wakeups/second. The dedicated poll(2) sleep needs no cap — it waits on
 * the wake pipe and fd 0 directly. */
#define SCR_SIGNAL_POLL_MS 50.0



/* The loop's idle sleep.
 *
 * On win32 this is NOT nanosleep, and the reason is measured. mingw-w64's
 * nanosleep cannot express a sub-tick wait: a 1 ms request costs a full
 * 15.6 ms scheduler tick, and it is the one primitive of the four below
 * that does not respond to timeBeginPeriod, so raising the timer
 * resolution system-wide does nothing for it. On x86_64-windows-gnu
 * (tests/perf/looplatency/sleep-primitives.c):
 *
 *     primitive                                default   timeBeginPeriod(1)
 *     nanosleep(1ms)                           15.611 ms      15.584 ms
 *     Sleep(1)                                 15.531 ms       1.186 ms
 *     WaitForSingleObject(ev, 1)               15.480 ms       1.126 ms
 *     CreateWaitableTimerExW HIGH_RESOLUTION    1.124 ms       1.207 ms
 *
 * The high-resolution waitable timer is the only one that gets there with
 * no process-wide side effect (timeBeginPeriod raises the global tick rate
 * and its power cost for every process on the box).
 *
 * Why it matters: the socket arm caps this sleep at SCR_CHILD_POLL_MS = 1
 * ms and readiness is only noticed at the next turn's zero-timeout
 * WSAPoll, so a reply arriving mid-sleep waited half a tick. Measured on a
 * loopback echo, 2000 sequential round trips: 8.26-10.58 ms per round trip
 * against node's 0.106-0.129 ms, and on the real zapo messaging bench it
 * was worth 11.5x on the worst phase and 4.4x on the next
 * (tests/perf/looplatency/README.md).
 *
 * This is NOT the missing-wake-fd upgrade scr_loop_wsapoll.c's header
 * predicts (WSAEventSelect/IOCP). That would be better still — zero
 * latency instead of 1 ms — but it is a loop-side redesign, and the
 * granularity of the sleep is what stood between this workload and node.
 *
 * Falls back to nanosleep if the timer cannot be created (pre-1803
 * Windows), so behavior degrades to exactly what it was. */
#ifdef _WIN32
static HANDLE scr_idle_timer = NULL;
static int scr_idle_timer_tried = 0;
#endif

static void scr_sleep_ms(double ms) {
  if (ms <= 0.0) return;
#ifdef _WIN32
  if (!scr_idle_timer_tried) {
    scr_idle_timer_tried = 1;
    scr_idle_timer = CreateWaitableTimerExW(NULL, NULL,
                                            CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                                            TIMER_ALL_ACCESS);
  }
  if (scr_idle_timer != NULL) {
    /* Negative == relative, in 100 ns units. */
    double units = ms * 10000.0;
    LARGE_INTEGER due;
    if (units > 9.0e18) units = 9.0e18;
    due.QuadPart = -(LONGLONG)units;
    if (due.QuadPart == 0) due.QuadPart = -1;
    if (SetWaitableTimer(scr_idle_timer, &due, 0, NULL, NULL, FALSE)) {
      /* Bounded rather than INFINITE: the timer always signals, so the
       * cap only ever fires if something is wrong, and it cannot hang
       * the loop. It does not coarsen the normal path — the wait
       * returns when the timer signals, not when the cap expires. */
      DWORD cap = (DWORD)(ms + 100.0);
      WaitForSingleObject(scr_idle_timer, cap);
      return;
    }
  }
#endif
  {
    time_t secs = (time_t)(ms / 1000.0);
    struct timespec ts = {secs, (long)((ms - (double)secs * 1000.0) * 1e6)};
    nanosleep(&ts, NULL);
  }
}

/* The external io hook (scr_runtime.h): the dynamic island registers
 * engine-job draining + fetch transfer polling here. Static builds never
 * set it — both slots stay NULL and the loop is byte-identical in
 * behavior. */
static bool (*scr_io_pending_fn)(void) = NULL;
static void (*scr_io_poll_fn)(double max_wait_ms) = NULL;

void scr_loop_set_io(bool (*pending)(void), void (*poll)(double)) {
  scr_io_pending_fn = pending;
  scr_io_poll_fn = poll;
}

/* The island's earliest armed timer deadline (HUGE_VAL when none): caps
 * the sleep below so an armed AbortSignal.timeout fires on time while
 * the loop waits on socket readiness — without keeping the loop alive by
 * itself (the liveness test never consults it, Node's unref'd timer). */
static double (*scr_island_deadline_fn)(void) = NULL;

void scr_loop_set_island_deadline(double (*fn)(void)) { scr_island_deadline_fn = fn; }

/* The net hook (scr_net.c, when linked — the events-hook shape):
 * `pending` keeps the loop alive while servers/sockets are live,
 * `dispatch` fires at every turn top, and `pollfd` is the unit's poller
 * fd for the idle poll(2) sleep (readable while events are pending —
 * kqueue and epoll fds both behave this way).
 * Net-free builds keep every slot NULL and the loop is byte-identical. */
static bool (*scr_net_pending_fn)(void) = NULL;
static void (*scr_net_dispatch_fn)(void) = NULL;
static int (*scr_net_pollfd_fn)(void) = NULL;

/* The win32 readiness-driven idle wait (scr_loop_wsapoll.c's
 * scrp_wait_win32; see scr_platform.h for the contract and the numbers).
 * The poller backend registers itself the first time any unit creates a
 * poller, so this stays NULL in a program that links none and the loop's
 * behaviour is byte-identical to what it was. Off-win32 nothing ever
 * registers it. */
static bool (*scr_netwait_fn)(double) = NULL;

void scr_loop_set_netwait(bool (*fn)(double)) { scr_netwait_fn = fn; }

static double (*scr_http_due_fn)(void) = NULL;
static void (*scr_http_sweep_fn)(void) = NULL;

void scr_loop_set_http_timeouts(double (*due)(void), void (*sweep)(void)) {
  scr_http_due_fn = due;
  scr_http_sweep_fn = sweep;
}

void scr_loop_set_net(bool (*pending)(void), void (*dispatch)(void), int (*pollfd)(void)) {
  scr_net_pending_fn = pending;
  scr_net_dispatch_fn = dispatch;
  scr_net_pollfd_fn = pollfd;
}

/* The dgram hook (scr_dgram.c, when linked) — the net hook's exact shape:
 * one more set of nullable slots, byte-identical loop behavior when
 * unset. */
static bool (*scr_dgram_pending_fn)(void) = NULL;
static void (*scr_dgram_dispatch_fn)(void) = NULL;
static int (*scr_dgram_pollfd_fn)(void) = NULL;

void scr_loop_set_dgram(bool (*pending)(void), void (*dispatch)(void), int (*pollfd)(void)) {
  scr_dgram_pending_fn = pending;
  scr_dgram_dispatch_fn = dispatch;
  scr_dgram_pollfd_fn = pollfd;
}

/* The WebRTC hook (scr_wrtc.c, when linked) - the dgram hook's exact
 * shape. The transport under it (scr_wrtc_conn.c) is SANS-IO by
 * construction, so what this station does per turn is hand it the loop's
 * clock and drain whatever came back: `dispatch` is a pump, not a driver.
 * Byte-identical loop behavior when unset, which is every program that
 * holds no peer connection. */
static bool (*scr_wrtc_pending_fn)(void) = NULL;
static void (*scr_wrtc_dispatch_fn)(void) = NULL;

/* No pollfd slot, and that is a decision rather than an omission: the
 * transport owns its own UDP socket and reads it INSIDE the pump, so
 * there is no readiness fd for the loop to wait on. It therefore takes
 * the same coarse cap an fd-less dgram unit takes below. */
void scr_loop_set_wrtc(bool (*pending)(void), void (*dispatch)(void)) {
  scr_wrtc_pending_fn = pending;
  scr_wrtc_dispatch_fn = dispatch;
}

/* The fs.watch hook (scr_watch.c, when linked) — the net hook's exact
 * shape: one more set of nullable slots, byte-identical loop behavior
 * when unset. */
static bool (*scr_watch_pending_fn)(void) = NULL;
static void (*scr_watch_dispatch_fn)(void) = NULL;
static int (*scr_watch_pollfd_fn)(void) = NULL;

void scr_loop_set_watch(bool (*pending)(void), void (*dispatch)(void), int (*pollfd)(void)) {
  scr_watch_pending_fn = pending;
  scr_watch_dispatch_fn = dispatch;
  scr_watch_pollfd_fn = pollfd;
}

/* The stream hook (scr_stream.c, when linked): `pending` keeps the loop
 * alive while deferred stream ticks exist, `dispatch` drains them at the
 * TOP of every turn — before the events/net stations, the closest
 * placement to Node's process.nextTick (whose stream emissions these
 * are). No poller fd: ticks are pure CPU work, always ready. */
static bool (*scr_stream_pending_fn)(void) = NULL;
static void (*scr_stream_dispatch_fn)(void) = NULL;

void scr_loop_set_stream(bool (*pending)(void), void (*dispatch)(void)) {
  scr_stream_pending_fn = pending;
  scr_stream_dispatch_fn = dispatch;
}

/* Dispatch hooks yield between event batches when fibers are already
 * queued, so promise jobs interleave with event delivery (Node's
 * microtask checkpoints between macrotasks). */
bool scr_loop_has_ready(void) { return scr_ready_len > 0; }

/* One macrotask boundary: Node's InternalCallbackScope::Close after a native
 * callback (processTicksAndRejections). The user tick queue drains to
 * exhaustion, then the promise jobs, and back while either has work (a tick
 * queued by a job runs before the next job, and a job queued by a tick runs
 * before the next tick). Once both are empty the unhandled rejections are
 * decided, as Node does at the end of each complete checkpoint: a fatal one
 * sets scr_loop_reject_stop, and every station and the loop then stop. Each
 * station calls this between the callbacks it delivers, so a tick queued by
 * one callback runs before the next callback of its batch, where Node runs
 * it. An uncaught throw leaves its exception pending for the caller. */
static bool scr_loop_reject_stop = false;
/* The module root of the current loop (scr_loop_run_inner's top_level). Once
 * it has rejected, the loop ends at that rejection: Node reports the root
 * through the module's uncaught path and never decides the other pending
 * rejections of that checkpoint (process 'unhandledRejection' listeners do not
 * see them), so no boundary may report one. */
static ScrPromise *scr_loop_root = NULL;
static bool scr_loop_root_rejected(void) {
  return scr_loop_root != NULL && scr_loop_root->state == SCR_PROM_REJECTED && !scr_root_consumed;
}

/* The module root rejected and an 'uncaughtException' listener is armed. Node
 * runs the promise jobs queued so far, then hands the evaluation's rejection
 * to the listeners (origin "unhandledRejection"), then goes on with ticks and
 * the rest of the loop. The root is then handled: no fatal verdict, and no
 * unhandled-rejection report for it. */
static void scr_root_consume(void) {
  while (scr_ready_len > 0) {
    ScrFiber *f = scr_ready[scr_ready_head++];
    scr_ready_len--;
    scr_resume_fiber(f);
  }
  if (!scr_loop_root_rejected()) return;
  scr_root_consumed = true;
  scr_loop_root->rejection_observed = true;
  scr_promise_rethrow(scr_loop_root);
  scr_uncaught_dispatch_rejection();
}

bool scr_loop_stopping(void) { return scr_loop_reject_stop || scr_loop_root_rejected() || scr_exc_pending(); }

void scr_loop_drain_callback(void) {
  for (;;) {
    if (scr_loop_reject_stop || scr_loop_root_rejected()) return;
    while (scr_nt_head != NULL) {
      ScrNtick *t = scr_nt_head;
      scr_nt_head = t->next;
      if (scr_nt_head == NULL) scr_nt_tail = NULL;
      ScrClosure *cb = t->cb;
      void (*raw)(void) = t->raw;
      free(t);
      if (cb) {
        ((void (*)(ScrClosure *))cb->fn)(cb);
        scr_closure_release(cb);
      } else {
        raw();
      }
      if (scr_exc_pending()) return;
    }
    while (scr_ready_len > 0) {
      ScrFiber *f = scr_ready[scr_ready_head++];
      scr_ready_len--;
      scr_resume_fiber(f);
      if (scr_exc_pending()) return;
    }
    if (scr_loop_root_rejected()) return; /* the root's rejection is the report */
    if (scr_nt_head != NULL || scr_ready_len > 0) continue;
    if (scr_nunhandled == 0 && scr_rjh_nqueue == 0) return;
    bool failed = scr_report_unhandled_rejections();
    if (scr_exc_pending()) return;
    if (failed) {
      scr_loop_reject_stop = true;
      return;
    }
    if (scr_nt_head == NULL && scr_ready_len == 0) return;
  }
}

#ifdef SCR_LOOP_WHY
/* The registry of unit describers (see scr_runtime.h). Eight is more slots
 * than there are units with a pending predicate. */
#define SCR_LOOP_WHY_SLOTS 8
static const char *scr_why_names[SCR_LOOP_WHY_SLOTS];
static size_t (*scr_why_fns[SCR_LOOP_WHY_SLOTS])(char *buf, size_t cap);
static size_t scr_why_n = 0;
void scr_loop_why_register(const char *name, size_t (*describe)(char *buf, size_t cap)) {
  if (scr_why_n >= SCR_LOOP_WHY_SLOTS) return;
  scr_why_names[scr_why_n] = name;
  scr_why_fns[scr_why_n] = describe;
  scr_why_n++;
}
/* One line every SCR_LOOP_WHY_MS while the loop is alive and idle. The
 * first report is immediate so a program that hangs at once still says so. */
#define SCR_LOOP_WHY_MS 2000.0
static double scr_why_last = -1e18;
static void scr_loop_why_report(bool kids, bool io, bool events, bool net, bool dgram, bool watch) {
  double now = scr_now_ms();
  if (now - scr_why_last < SCR_LOOP_WHY_MS) return;
  scr_why_last = now;
  fprintf(stderr, "[LOOPWHY] timers=%zu immediates=%zu kids=%d io=%d events=%d net=%d dgram=%d watch=%d",
          scr_reffed_timers, scr_reffed_immediates, kids ? 1 : 0, io ? 1 : 0,
          events ? 1 : 0, net ? 1 : 0, dgram ? 1 : 0, watch ? 1 : 0);
  for (size_t i = 0; i < scr_why_n; i++) {
    char buf[512];
    size_t n = scr_why_fns[i](buf, sizeof buf - 1);
    if (n >= sizeof buf) n = sizeof buf - 1;
    buf[n] = 0;
    fprintf(stderr, " | %s: %s", scr_why_names[i], buf);
  }
  fputc('\n', stderr);
  fflush(stderr);
}
#endif

/* Kept out of line: inlined into the wrapper's loop the optimizer clones the
 * whole loop body (1.5x its size), which a hello-world binary would pay. */
#if defined(__GNUC__) || defined(__clang__)
#define SCR_LOOP_NOINLINE __attribute__((noinline))
#else
#define SCR_LOOP_NOINLINE
#endif
SCR_LOOP_NOINLINE static bool scr_loop_run_inner(ScrPromise *top_level, bool resumed, bool cjs_entry);

/* An ES-module entry (not CommonJS) that throws synchronously at top level.
 * Node evaluates such an entry inside a promise job, so the promise jobs
 * queued before the throw run BEFORE its report: the 'uncaughtException'
 * listener (or the fatal print) comes after them, and nextTicks after the
 * listener. main calls this before its uncaught dispatch, with the entry's
 * throw still pending. The throw is held aside while the jobs run (a job
 * must not see a pending exception), then put back for the report.
 * scr_entry_threw makes the loop's first checkpoint run ticks, since the
 * listener has already run by then. */
static bool scr_entry_threw = false;
void scr_entry_throw_jobs(void) {
  if (!scr_exc_pending()) return;
  ScrCaught *c = scr_exc_take();
  while (scr_ready_len > 0) {
    ScrFiber *f = scr_ready[scr_ready_head++];
    scr_ready_len--;
    scr_resume_fiber(f);
  }
  scr_rethrow(c);
  scr_caught_release(c);
  scr_entry_threw = true;
  /* Node's origin for an ES-module entry's throw is "unhandledRejection" (the
   * evaluation promise's rejection), measured on v24.15.0. No listener: no-op,
   * and the pending throw is the fatal report. */
  scr_uncaught_dispatch_rejection();
}

/* The loop, resumed after every escaped throw an 'uncaughtException'
 * listener consumed (Node calls the listener and keeps going); with no
 * listener the exception stays pending and main reports it. A resumed pass
 * is past the first checkpoint: the later checkpoints drain ticks first.
 * cjs_entry: the entry file is CommonJS (scr_loop_run_cjs), see the first
 * checkpoint below. */
static bool scr_loop_run_mode(ScrPromise *top_level, bool cjs_entry) {
  bool resumed = scr_entry_threw; /* the entry's listener already ran (main) */
  for (;;) {
    bool r = scr_loop_run_inner(top_level, resumed, cjs_entry);
    if (scr_uncaught_listener_fn != NULL && scr_exc_pending()) {
      scr_uncaught_dispatch();
      resumed = true;
      continue;
    }
    return r;
  }
}

bool scr_loop_run(ScrPromise *top_level) {
  return scr_loop_run_mode(top_level, false);
}

bool scr_loop_run_cjs(ScrPromise *top_level) {
  return scr_loop_run_mode(top_level, true);
}

static bool scr_loop_run_inner(ScrPromise *top_level, bool resumed, bool cjs_entry) {
  scr_loop_root = top_level;
  /* The FIRST checkpoint after the synchronous main body. An ES-module entry
   * runs inside a promise job (Node awaits its evaluation: the runMain
   * continuation is a microtask queued after the body's own), so promise
   * jobs scheduled during the body run BEFORE its ticks, exactly once, at
   * startup — differentially pinned. A CommonJS entry runs synchronously
   * with no job around it, so its ticks drain first, like every later
   * checkpoint (Node's processTicksAndRejections). */
  bool first_checkpoint = !resumed;
  bool rejection_failed = false;
  for (;;) {
    if (scr_loop_reject_stop) {
      rejection_failed = true; /* a callback boundary decided a fatal rejection */
      break;
    }
    if (scr_loop_root_rejected()) {
      if (scr_uncaught_listener_fn == NULL) break;
      scr_root_consume();
      first_checkpoint = false;
      continue;
    }
    /* process.nextTick callbacks BEFORE promise jobs (Node's checkpoint
     * order): the tick queue to exhaustion, then the microtask queue to
     * exhaustion, and back while either has work — a microtask's
     * nextTick runs before the turn proceeds, but never preempts the
     * microtask queue mid-drain (V8 drains it fully). A tick's uncaught
     * throw ends the loop like any listener's (main reports it). */
    if (!first_checkpoint || cjs_entry) {
      while (scr_nt_head != NULL) {
        ScrNtick *t = scr_nt_head;
        scr_nt_head = t->next;
        if (scr_nt_head == NULL) scr_nt_tail = NULL;
        ScrClosure *cb = t->cb;
        void (*raw)(void) = t->raw;
        free(t);
        if (cb) {
          ((void (*)(ScrClosure *))cb->fn)(cb);
          scr_closure_release(cb);
        } else {
          raw(); /* one stream tick, FIFO with the user ticks around it */
        }
        if (scr_exc_pending()) return false;
      }
    }
    /* Microtasks to exhaustion (Node: promise jobs before timers). */
    while (scr_ready_len > 0) {
      ScrFiber *f = scr_ready[scr_ready_head++];
      scr_ready_len--;
      scr_resume_fiber(f);
    }
    first_checkpoint = false;
    /* The ESM loader observes a rejected entry evaluation at a promise-job
     * checkpoint and terminates before later ref'd timers or I/O can run.
     * Wait until this checkpoint's ready queue is drained — the root's
     * rejection handler is itself promise-job ordered — then leave through
     * the normal teardown below. A fulfilled root deliberately does not
     * stop the loop. */
    if (scr_loop_root_rejected()) {
      if (scr_uncaught_listener_fn == NULL) break;
      scr_root_consume();
      first_checkpoint = false;
      continue;
    }
    if (scr_nt_head != NULL) continue;
    /* Node decides unhandled rejections at the END of each complete
     * nextTick/microtask checkpoint, before advancing to timers or I/O.
     * A rejected executable module root wins over OTHER rejections from
     * this same checkpoint (the root check above); rejections from an
     * earlier checkpoint have already delivered here. Handled listeners
     * may enqueue more jobs or ref'd work, so return to the checkpoint
     * head instead of declaring the loop exhausted underneath them. */
    if (scr_report_unhandled_rejections()) {
      rejection_failed = true;
      break;
    }
    if (scr_ready_len > 0 || scr_nt_head != NULL || scr_nunhandled > 0) continue;
    /* Quiescent between turns (microtasks drained, nothing running):
     * collect any cycles the turn left behind. No-op on an empty buffer,
     * and PACED above a large live set — see scr_collect_cycles_idle. */
    scr_collect_cycles_idle();
    /* Stream tick dispatch (scr_stream.c, when linked): the deferred
     * next-tick emissions ('data' flow kicks, 'readable'/'end'/'finish'/
     * 'drain'/'error'/'close') fire now, FIRST — the nextTick station.
     * Listeners may enqueue microtasks or more ticks — restart the turn
     * so those drain first. */
    if (scr_stream_dispatch_fn != NULL) {
      scr_stream_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_loop_stopping()) {
        rejection_failed = scr_loop_reject_stop;
        break;
      }
      if (scr_ready_len > 0) continue;
      if (scr_stream_pending_fn != NULL && scr_stream_pending_fn()) continue;
    }
    /* Event dispatch (scr_events.c, when linked): watched signals
     * delivered since the last turn fire their listeners now (macrotasks,
     * like timers), then stdin — while a consumer exists, probe fd 0 and
     * deliver one arrived chunk / the EOF events. Both may enqueue
     * microtasks — restart the turn so those drain first. */
    if (scr_events_dispatch_fn != NULL) {
      scr_events_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_loop_stopping()) {
        rejection_failed = scr_loop_reject_stop;
        break;
      }
      if (scr_ready_len > 0) continue;
    }
    /* The HTTP connections checker: an expired request is answered 408 and
     * destroyed before this turn's socket events, at its grid tick. */
    if (scr_http_sweep_fn != NULL && scr_http_due_fn() <= scr_now_ms()) {
      scr_http_sweep_fn();
      if (scr_exc_pending()) return false;
    }
    /* Net dispatch (scr_net.c, when linked): accepts, arrived data,
     * connect completions, and the deferred listening/error/close emits
     * fire now (macrotasks, like the events hook). Callbacks may enqueue
     * microtasks — restart the turn so those drain first. */
    if (scr_net_dispatch_fn != NULL) {
      scr_net_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_loop_stopping()) {
        rejection_failed = scr_loop_reject_stop;
        break;
      }
      if (scr_ready_len > 0) continue;
    }
    /* Dgram dispatch (scr_dgram.c, when linked): arrived datagrams and
     * the deferred listening/connect/error/close emits (plus pending
     * dns.lookup callbacks) fire now — the net hook's exact station. */
    if (scr_dgram_dispatch_fn != NULL) {
      scr_dgram_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_loop_stopping()) {
        rejection_failed = scr_loop_reject_stop;
        break;
      }
      if (scr_ready_len > 0) continue;
    }
    /* WebRTC dispatch (scr_wrtc.c, when linked): one pump of the
     * ICE/DTLS/SCTP transport with the loop's clock, then the events that
     * pump produced - open, message, close, and the four on*statechange
     * handlers - fire now, the dgram hook's exact station. */
    if (scr_wrtc_dispatch_fn != NULL) {
      scr_wrtc_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_loop_stopping()) {
        rejection_failed = scr_loop_reject_stop;
        break;
      }
      if (scr_ready_len > 0) continue;
    }
    /* Watch dispatch (scr_watch.c, when linked): file events queued on
     * the unit's event backend fire their FSWatcher listeners now — the
     * net hook's exact station. */
    if (scr_watch_dispatch_fn != NULL) {
      scr_watch_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_loop_stopping()) {
        rejection_failed = scr_loop_reject_stop;
        break;
      }
      if (scr_ready_len > 0) continue;
    }
    /* Reap spawned children and fire their listeners (before timers,
     * like Node's nextTick-ish spawn-failure "error"). A callback may
     * enqueue microtasks or spawn again — restart the turn if so.
     * EXCEPT when ONLY unref'd children remain: Node's liveness check
     * precedes any further poll/reap, so once nothing reffed holds the
     * loop their pending exits are DROPPED at loop exit — never
     * delivered. Without this gate the kill-then-exit shape (a timer's
     * last act kills an unref'd child) would race machine timing: a
     * death landing before this sweep fired its 'exit' where Node
     * deterministically never does. The teardown below releases the
     * undelivered listeners, so the RC audit stays clean. */
    if (scr_children_pending()) {
      bool held =
          scr_reffed_timers > 0 || scr_reffed_immediates > 0 || scr_children_reffed_pending() ||
          /* spawn failures settle regardless: their 'error' is a
           * next-tick event, delivered even on an unref'd child */
          scr_children_failed_pending() ||
          (scr_io_pending_fn != NULL && scr_io_pending_fn()) ||
          (scr_events_pending_fn != NULL && scr_events_pending_fn()) ||
          (scr_net_pending_fn != NULL && scr_net_pending_fn()) ||
          (scr_dgram_pending_fn != NULL && scr_dgram_pending_fn()) ||
          (scr_wrtc_pending_fn != NULL && scr_wrtc_pending_fn()) ||
          (scr_watch_pending_fn != NULL && scr_watch_pending_fn());
      if (held) {
        scr_children_poll();
        if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_loop_stopping()) {
        rejection_failed = scr_loop_reject_stop;
        break;
      }
        if (scr_ready_len > 0) continue;
      }
    }
    /* Deferred stream ticks are always-ready work: never sleep or exit
     * while any exist (the dispatch above drains them, so reaching here
     * with ticks pending means a dispatch station enqueued more). User
     * nextTicks enqueued by a station listener are the same story. */
    if (scr_stream_pending_fn != NULL && scr_stream_pending_fn()) continue;
    if (scr_nt_head != NULL) continue;
    bool kids = scr_children_pending();
    bool io = scr_io_pending_fn != NULL && scr_io_pending_fn();
    bool events = scr_events_pending_fn != NULL && scr_events_pending_fn();
    bool net = scr_net_pending_fn != NULL && scr_net_pending_fn();
    bool dgram = scr_dgram_pending_fn != NULL && scr_dgram_pending_fn();
    bool watch = scr_watch_pending_fn != NULL && scr_watch_pending_fn();
    /* A peer connection with an answer applied is UNSETTLED work: the DTLS
     * handshake is in flight, or the channel is open and a message may
     * arrive, and either way the program is not finished. Folded into
     * `dgram` for the sleep caps below rather than given a fourth slot,
     * because the cap it wants is the same one - socket readiness at reap
     * granularity, since scr_wrtc_pollfd answers -1 (the transport polls
     * its own socket inside the pump). */
    if (scr_wrtc_pending_fn != NULL && scr_wrtc_pending_fn()) dgram = true;
    /* Timer liveness counts only REF'd timers: an unref'd timer stays in
     * the heap (and fires if the loop runs on for other reasons) but does
     * not by itself keep the process alive — Node's unref semantics.
     * Children follow the same rule: an unref'd child is still REAPED
     * while the loop runs (kids drives the sweeps and sleeps above) but
     * only reffed ones keep the process alive. */
    if (scr_reffed_timers == 0 && scr_reffed_immediates == 0 && !scr_children_reffed_pending() && !io && !events && !net && !dgram && !watch) break;
#ifdef SCR_LOOP_WHY
    scr_loop_why_report(kids, io, events, net, dgram, watch);
#endif
    /* Sleep to the earliest deadline, then run every due timer (each may
     * enqueue microtasks, which the next iteration drains first). Who
     * sleeps depends on what is pending:
     * - external io: the io POLL takes the sleep — it waits on real fds
     *   up to the deadline (socket readiness wakes it early) and makes
     *   progress (engine jobs, arrived response data) before timers run.
     *   A child's exit can't wake curl's fds, so children re-impose the
     *   reap-granularity cap on this path.
     * - signals watched or stdin consumed: poll(2) takes the sleep — the
     *   wake pipe, fd 0, and the child watch's fd together, so any of
     *   them ends it immediately (details at the branch).
     * - children only: the sleep waits on the child watch — the exit
     *   wakeup and the timer deadline together via the wait timeout — so a
     *   child's exit ends the sleep immediately and the next turn's reap
     *   pass fires its listeners. scr_children_wait declines when it
     *   can't wake for every pending child; the ~1ms polling cap is the
     *   fallback.
     * - timers only: plain nanosleep to the deadline. */
    double now = scr_now_ms();
    /* Hoisted above the decay-due block: the floor that block applies has to
     * know every predicate that will later cap the sleep. */
    bool evw = scr_events_watching_fn != NULL && scr_events_watching_fn();
    /* And the same seam for the heap itself: the loop is about to
     * block, so a heap-wide walk cannot land between two allocations
     * of one turn. Off unless SCR_HEAP_TRIM_MS says otherwise. */
    scr_heap_trim(now);
#if defined(__linux__) && defined(__GLIBC__)
    scr_text_drop_tick(now);
#endif
    /* And SQLite's page cache, at the same seam. Unlike the two above, this
     * one never caps 'due' -- see its comment: a cache release has no
     * deadline to miss, and that clamp shape is what broke pairing. */
    scr_sqlite_idle_release(now);
    /* And the string pool, same seam, same no-clamp rule. */
    scr_str_idle_drain_tick(now);
    double due = scr_ntimers > 0 ? scr_timers[0].deadline_ms : now + SCR_IO_POLL_MS;
    /* Likewise the heap trim: a turn that sleeps past its window is a
     * window that never ran (see scr_heap_trim_due). */
    {
      double trim_due = scr_heap_trim_due(now);
      if (trim_due >= 0 && trim_due < due) due = trim_due;
    }
    /* An armed island timer (AbortSignal.timeout) caps the sleep: it must
     * fire on time even while the poller waits on socket readiness. */
    if (scr_island_deadline_fn != NULL) {
      double isl_due = scr_island_deadline_fn();
      if (isl_due < due) due = isl_due;
    }
    /* The HTTP checker's next grid tick (a sleep cap; never liveness). */
    if (scr_http_due_fn != NULL) {
      double http_due = scr_http_due_fn();
      if (http_due < due) due = http_due;
    }
    /* Pending immediates are always-ready work: no sleep — run due timers
     * (Node's timers phase precedes check), then the check phase below. */
    if (scr_pending_immediates > 0) due = now;
    if (io) {
      if (kids && due > now + SCR_CHILD_POLL_MS) due = now + SCR_CHILD_POLL_MS;
      /* Signals/stdin/net can't wake curl's fd wait (and its poll retries
       * on EINTR), so they re-impose a coarser cap — bounded Ctrl-C and
       * socket latency during a fetch, without the reap-granularity
       * cost. */
      else if ((evw || net || dgram || watch) && due > now + SCR_SIGNAL_POLL_MS) due = now + SCR_SIGNAL_POLL_MS;
      scr_io_poll_fn(due > now ? due - now : 0);
      now = scr_now_ms();
      if (scr_ready_len > 0) continue; /* io callbacks woke fibers */
    } else if (evw || net || dgram || watch) {
#ifdef _WIN32
      /* The win32 arm: no poll(2), so the sleep is a capped nanosleep and
       * the next turn's dispatch does the work — signal flags (set by the
       * CRT handler on msvcrt's console-ctrl thread) and the stdin probe
       * at SCR_SIGNAL_POLL_MS granularity (scr_events.c), socket/dgram
       * readiness at the child-reap cap (scr_loop_wsapoll.c's zero-timeout
       * WSAPoll drains at dispatch; ~1ms keeps loopback exchanges inside
       * the granularity Node's IOCP-woken loop delivers, where 50ms could
       * reorder a socket emit past a short timer). When the caps ever
       * show up in a profile, the upgrade is a real waitable arm —
       * WaitForMultipleObjects over WSAEVENTs, or IOCP. */
      if (evw && due > now + SCR_SIGNAL_POLL_MS) due = now + SCR_SIGNAL_POLL_MS;
      if ((net || dgram || watch) && due > now + SCR_CHILD_POLL_MS) due = now + SCR_CHILD_POLL_MS;
      if (kids && due > now + SCR_CHILD_POLL_MS) due = now + SCR_CHILD_POLL_MS;
      if (due > now) {
        /* Readiness-driven when the poller backend can be: the wait ends
         * when a socket becomes ready instead of at the cap, so a
         * sequential request/response round trip stops paying a full
         * turn for every reply. The caps above are UNCHANGED — they
         * still bound the wait, they just stop being the only thing that
         * ends it. Declines (no watched sockets, no high-resolution
         * timer, SCRIPTC_NET_WAIT=0) fall through to the plain sleep. */
        if (scr_netwait_fn == NULL || !scr_netwait_fn(due - now)) {
          scr_sleep_ms(due - now);
        }
      }
      now = scr_now_ms();
#else
      /* poll(2) takes the sleep: the events unit's fds — the signal wake
       * pipe (a signal delivered BEFORE the poll entered still has its
       * byte in the pipe — no lost-wakeup race) and fd 0 while stdin has
       * a consumer — plus the child watch's fd when it can represent
       * every pending child (kqueue and epoll fds poll readable when
       * events are pending); unrepresentable children keep the ~1ms reap cap
       * instead. Dispatch happens at the next turn's top — the poll only
       * decides how long to sleep. */
      struct pollfd fds[6];
      int nfds = 0;
      int evfds[2];
      int nev = evw && scr_events_pollfds_fn != NULL ? scr_events_pollfds_fn(evfds) : 0;
      for (int i = 0; i < nev; i++) {
        fds[nfds].fd = evfds[i];
        fds[nfds].events = POLLIN;
        fds[nfds++].revents = 0;
      }
      if (net) {
        /* The net unit's poller fd: readable while socket events are
         * pending, so arrived data/accepts end the sleep immediately.
         * Dispatch (which also DRAINS the poller) happens at the next
         * turn's top — the poll only decides how long to sleep. */
        int nfd = scr_net_pollfd_fn != NULL ? scr_net_pollfd_fn() : -1;
        if (nfd >= 0) {
          fds[nfds].fd = nfd;
          fds[nfds].events = POLLIN;
          fds[nfds++].revents = 0;
        } else if (due > now + SCR_SIGNAL_POLL_MS) {
          due = now + SCR_SIGNAL_POLL_MS;
        }
      }
      if (dgram) {
        /* The dgram unit's poller fd — the net slot's exact story. */
        int dfd = scr_dgram_pollfd_fn != NULL ? scr_dgram_pollfd_fn() : -1;
        if (dfd >= 0) {
          fds[nfds].fd = dfd;
          fds[nfds].events = POLLIN;
          fds[nfds++].revents = 0;
        } else if (due > now + SCR_SIGNAL_POLL_MS) {
          due = now + SCR_SIGNAL_POLL_MS;
        }
      }
      if (watch) {
        /* The watch unit's event fd — the net slot's exact story. */
        int wfd = scr_watch_pollfd_fn != NULL ? scr_watch_pollfd_fn() : -1;
        if (wfd >= 0) {
          fds[nfds].fd = wfd;
          fds[nfds].events = POLLIN;
          fds[nfds++].revents = 0;
        } else if (due > now + SCR_SIGNAL_POLL_MS) {
          due = now + SCR_SIGNAL_POLL_MS;
        }
      }
      if (kids) {
        int cfd = scr_children_wake_fd();
        if (cfd >= 0) {
          fds[nfds].fd = cfd;
          fds[nfds].events = POLLIN;
          fds[nfds++].revents = 0;
        } else if (due > now + SCR_CHILD_POLL_MS) {
          due = now + SCR_CHILD_POLL_MS;
        }
      }
      double wait = due > now ? due - now : 0;
      if (wait > 1e9) wait = 1e9; /* poll takes int ms */
      (void)poll(fds, (nfds_t)nfds, (int)(wait + 0.999));
      /* Consume queued child-exit events NOW (zero-timeout drain) — an
       * unconsumed event keeps the kqueue fd readable and would turn the
       * next poll into a busy spin while other children still run. The
       * WNOHANG sweep at the next turn's top stays the reaper. */
      if (kids) (void)scr_children_wait(0);
      now = scr_now_ms();
#endif /* !_WIN32 */
    } else if (kids && scr_children_wait(due > now ? due - now : 0)) {
      now = scr_now_ms(); /* woke early on an exit, or hit the deadline */
    } else {
      if (kids && due > now + SCR_CHILD_POLL_MS) due = now + SCR_CHILD_POLL_MS;
      if (due > now) {
        scr_sleep_ms(due - now);
        now = due;
      }
    }
    while (scr_ntimers > 0 && scr_timers[0].deadline_ms <= now) {
      ScrTimer t = scr_timer_pop();
      /* Timer callbacks are plain sync closures, run on the main stack.
       * An interval entry is OUT of the heap while its callback runs;
       * clearInterval(its own id) from inside sets the firing flag and
       * the re-arm below drops it instead. A throw kills the interval
       * with the program (Node: the uncaught exception ends the process
       * before any rescheduled tick could run). */
      if (t.id != 0) {
        scr_firing_id = t.id;
        scr_firing_cleared = false;
        scr_firing_reffed = t.reffed; /* unref/ref during the callback lands here */
        scr_firing_refresh = false;
      }
      ((void (*)(ScrClosure *))t.cb->fn)(t.cb);
      if (t.id != 0 && t.repeat_ms > 0 && !scr_firing_cleared && !scr_exc_pending()) {
        /* Re-arm relative to the post-callback clock (libuv's uv_timer
         * repeat behavior: no catch-up bursts after a slow callback). The
         * ref state carries across ticks (a self-unref'd interval stays
         * unref'd). */
        ScrTimer again = {scr_now_ms() + t.repeat_ms, scr_timer_seq++, t.cb, t.repeat_ms, t.id, scr_firing_reffed, t.delay_ms};
        scr_timer_push(again);
      } else if (t.id != 0 && scr_firing_refresh && !scr_firing_cleared && !scr_exc_pending()) {
        /* refresh() from inside the one-shot's own callback: re-arm to
         * now + the original delay, ref state carried (Node's
         * Timeout.refresh — the timer fires again). */
        ScrTimer again = {scr_now_ms() + t.delay_ms, scr_timer_seq++, t.cb, 0, t.id, scr_firing_reffed, t.delay_ms};
        scr_timer_push(again);
      } else {
        scr_closure_release(t.cb);
      }
      scr_firing_id = 0;
      if (scr_exc_pending()) return false; /* uncaught throw in a callback: main handles it */
      /* Node's processTimers drains the tick queue and the promise jobs after
       * EACH timer callback (runNextTicks), before the next expired timer.
       * An unhandled rejection is decided at that checkpoint too, so a
       * pending one leaves the phase here and the checkpoint head reports. */
      scr_loop_drain_callback();
      if (scr_exc_pending()) return false;
      if (scr_loop_stopping()) break;
      if (scr_loop_root_rejected()) break;
    }
    /* The check phase: immediates queued BEFORE this phase started run
     * now, FIFO; ones a callback queues wait for the next turn (the end
     * snapshot — Node's once-per-turn rule, so a setImmediate chain can't
     * starve the loop). Cleared slots (cb NULL) skip. Microtasks drain
     * between callbacks, like Node's inter-macrotask checkpoints; a woken
     * fiber restarts the turn first (the timer loop's break above), so the
     * phase only runs on a drained queue. */
    if (scr_ready_len == 0 && scr_pending_immediates > 0 && !scr_loop_stopping()) {
      size_t end = scr_nimmediates;
      while (scr_immediates_head < end) {
        size_t i = scr_immediates_head++;
        ScrClosure *cb = scr_immediates[i].cb;
        if (cb == NULL) continue; /* cleared */
        scr_immediates[i].cb = NULL; /* fired: clear/ref/unref on this id no-op now */
        if (scr_pending_immediates > 0) scr_pending_immediates--;
        if (scr_immediates[i].reffed) {
          scr_immediates[i].reffed = false;
          if (scr_reffed_immediates > 0) scr_reffed_immediates--;
        }
        ((void (*)(ScrClosure *))cb->fn)(cb);
        scr_closure_release(cb);
        if (scr_exc_pending()) return false; /* uncaught throw: main handles it */
        /* One checkpoint per immediate, ticks before promise jobs (Node's
         * CheckImmediate runs each MakeCallback's scope close). */
        scr_loop_drain_callback();
        if (scr_exc_pending()) return false;
        if (scr_loop_stopping()) break;
        if (scr_loop_root_rejected()) break;
      }
      /* Fully drained: reset the cursor so the array reuses its slots. */
      if (scr_immediates_head == scr_nimmediates) {
        scr_immediates_head = 0;
        scr_nimmediates = 0;
      }
    }
  }
  /* Exit can now leave UNREF'd timers armed in the heap (ordinary
   * exhaustion, a fatal module root, or an unhandled rejection). They
   * never fire, so release their closures here or the RC audit counts
   * them as leaks. Uncaught callback throws still return above for main
   * to report through the existing exceptional teardown path. */
  scr_timers_teardown();
  /* Same story for unref'd children the loop never reaped: release the
   * registry's references (their listeners never fire — the process is
   * exiting, Node's behavior; the OS reparents the children). */
  scr_children_teardown();
  scr_fibers_abandoned = scr_fibers_live;
  scr_note_abandoned_fibers(scr_fibers_abandoned);
  return rejection_failed;
}

/* The island's half of the unhandled-rejection report (scr_island.c
 * registers it at engine boot): called with print=true when the static
 * ledger below reported nothing — one report, one voice, like Node's
 * first-unhandled-rejection death. Returns whether the island had any.
 * Static builds never set it. */
static bool (*scr_island_rejections_fn)(bool print) = NULL;
static int (*scr_island_jobs_drain_fn)(void) = NULL;

void scr_loop_set_island_rejections(bool (*fn)(bool print),
                                    int (*drain_jobs)(void)) {
  scr_island_rejections_fn = fn;
  scr_island_jobs_drain_fn = drain_jobs;
}

/* ── process.on('unhandledRejection') ─────────────────────────────────
 * Dyn listeners are called per never-observed rejection at the completed
 * nextTick/microtask checkpoint. A registered listener suppresses the
 * default report and exit 1, exactly Node's handled-event contract. */

/* The unhandled-rejection LISTENER hook (scr_async_dyn.c installs it at
 * registration — the loop-hook pattern, so listener-free binaries keep
 * their size class): called per never-observed rejection; false = a
 * listener threw (the uncaught crash path). */
bool (*scr_urj_deliver_fn)(ScrPromise *p) = NULL;

/* Unhandled rejections at a completed nextTick/microtask checkpoint:
 * Node prints an error and exits 1 when no listener handles the event.
 * Snapshot the ledger: a listener can reject another promise, but that
 * new rejection belongs to the NEXT checkpoint rather than this report. */
bool scr_report_unhandled_rejections(void) {
  /* Static fibers drain before engine jobs in this runtime's documented
   * island ordering. Complete BOTH halves of that microtask checkpoint
   * before deciding either rejection ledger; engine reactions can attach
   * a handler to a rejection that would otherwise look unhandled here.
   * A host callback can wake a static fiber/tick, in which case the loop
   * must drain that work before reporting too. */
  if (scr_island_jobs_drain_fn != NULL) {
    scr_island_jobs_drain_fn();
    if (scr_ready_len > 0 || scr_nt_head != NULL) return false;
  }
  /* processPromiseRejections order (measured against Node: a late handler and
   * a new rejection in one checkpoint print RH before UR): the rejectionHandled
   * queue first, then the unhandled ledger below. */
  if (scr_rjh_nqueue > 0 && !scr_rjh_flush()) {
    scr_exc_print_uncaught();
    scr_exit_code_note(1);
    return true;
  }
  bool any = false;
  bool crashed = false;
  size_t report_count = scr_nunhandled;
  for (size_t i = 0; i < report_count; i++) {
    ScrPromise *p = scr_maybe_unhandled[i];
    if (p->state == SCR_PROM_REJECTED && !p->rejection_observed && !crashed) {
      if (scr_urj_deliver_fn != NULL) {
        /* Listener dispatch (scr_async_dyn.c installed the hook at
         * registration): the event handles it, like Node — per entry,
         * no report, exit 0. A listener throw is the uncaught crash.
         * reported_unhandled arms the 'rejectionHandled' window: a
         * handler the listener itself attaches fires the sibling event
         * (scr_prom_observe). */
        p->rejection_observed = true;
        p->reported_unhandled = true;
        if (!scr_urj_deliver_fn(p)) crashed = true;
      } else if (scr_uncaught_listener_fn != NULL) {
        /* No 'unhandledRejection' listener, but an 'uncaughtException' one:
         * Node's triggerUncaughtException(reason, fromPromise): the reason
         * goes to the uncaught listeners with origin "unhandledRejection",
         * and the process continues (exit 0 unless something else fails). */
        p->rejection_observed = true;
        p->reported_unhandled = true;
        scr_promise_rethrow(p);
        scr_uncaught_dispatch_rejection();
      } else if (!any) {
        any = true;
        fflush(stdout);
        fputs("Unhandled promise rejection: ", stderr);
        switch (p->payload_kind) {
        case SCR_EXC_F64: {
          char buf[32];
          scr_f64_to_str(p->f64, buf);
          fputs(buf, stderr);
          break;
        }
        case SCR_EXC_BOOL: fputs(p->b ? "true" : "false", stderr); break;
        case SCR_EXC_STR: fputs(((ScrStr *)p->payload)->data, stderr); break;
        case SCR_EXC_OBJ:
          /* Error rejections render "name: message", like the uncaught path. */
          if (scr_error_is(p->payload)) {
            ScrStr *s = scr_error_to_string((ScrError *)p->payload);
            fwrite(s->data, 1, s->len, stderr);
            scr_str_release(s);
            break;
          }
          /* fall through */
        default: fputs("[object]", stderr); break;
        }
        fputc('\n', stderr);
      }
    }
    scr_promise_release(p);
  }
  size_t remaining = scr_nunhandled - report_count;
  if (remaining > 0) {
    memmove(scr_maybe_unhandled, scr_maybe_unhandled + report_count,
            remaining * sizeof *scr_maybe_unhandled);
  }
  scr_nunhandled = remaining;
  if (crashed) {
    scr_exc_print_uncaught();
    scr_exit_code_note(1);
    return true;
  }
  if (scr_island_rejections_fn != NULL) {
    bool island = scr_island_rejections_fn(!any);
    any = any || island;
  }
  /* main returns 1 on a reported rejection — the 'exit' listeners (atexit)
   * must see that code, like Node's. */
  if (any) scr_exit_code_note(1);
  return any;
}

/* A fatal executable-module rejection suppresses unrelated rejections
 * created in the SAME checkpoint. Drop their retained ledger references
 * without delivering process events or a competing default report. */
void scr_discard_unhandled_rejections(void) {
  for (size_t i = 0; i < scr_nunhandled; i++) {
    scr_promise_release(scr_maybe_unhandled[i]);
  }
  scr_nunhandled = 0;
}

/* ── new Promise(executor) ────────────────────────────────────────────── */

/* resolve closures: caps[0] is a box whose slot holds the promise (+1). */
static ScrPromise *scr_resolve_target(ScrClosure *self) {
  /* The slot holds the promise itself, tagged: no cell between the closure and the promise it settles. A resolving function is
   * single-shot (the first settle wins and every later call does nothing), so the call TAKES the closure's reference out of the slot:
   * the caller owns the +1 it gets and drops it when done, a second call finds NULL and does nothing, and a closure that is kept long
   * after its call no longer holds, or makes the collector trace, a promise it can never settle again. */
  ScrPromise *p = (ScrPromise *)scr_cap_raw_ptr(self->caps[0]);
  self->caps[0] = SCR_CAP_RAW(NULL);
  return p;
}
/* The closure of a resolving function: ONE capture, the promise, owned by the closure (+1). Resolve and reject share their
 * "already settled" state through the promise itself (state != PENDING), so nothing else needs a cell. */
static ScrClosure *scr_make_settler(void *fn, ScrPromise *p) {
  ScrClosure *c = scr_closure_new(fn, 1);
  scr_cap_raw_release = scr_promise_release_v;
  c->caps[0] = SCR_CAP_RAW(scr_promise_retain(p));
  return c;
}
static void scr_resolve_thunk_f64(ScrClosure *self, double v) {
  ScrPromise *p = scr_resolve_target(self);
  if (p == NULL) return;
  scr_promise_fulfill_f64(p, v);
  scr_promise_release(p);
}
static void scr_resolve_thunk_bool(ScrClosure *self, bool v) {
  ScrPromise *p = scr_resolve_target(self);
  if (p == NULL) return;
  scr_promise_fulfill_bool(p, v);
  scr_promise_release(p);
}
static void scr_resolve_thunk_str(ScrClosure *self, ScrStr *v) {
  ScrPromise *p = scr_resolve_target(self);
  if (p == NULL) { scr_str_release(v); return; }
  scr_promise_fulfill_str(p, v); /* callee owns its params: moves in */
  scr_promise_release(p);
}
static void scr_resolve_thunk_void(ScrClosure *self) {
  ScrPromise *p = scr_resolve_target(self);
  if (p == NULL) return;
  scr_promise_fulfill_void(p);
  scr_promise_release(p);
}
/* Ref payloads: emitted code passes the concrete retain/release via a
 * second box slot? Keep simple: ref resolve thunks are monomorphized by the
 * EMITTER (it knows the arm type) — it emits a tiny static thunk calling
 * scr_promise_fulfill_ref with the concrete helpers, wrapped over caps[0].
 * The runtime provides only the scalar/str/void thunks. */

ScrClosure *scr_make_resolve(ScrPromise *p, int kind /*0 f64,1 bool,2 str,3 void*/) {
  void *fns[4] = {(void *)&scr_resolve_thunk_f64, (void *)&scr_resolve_thunk_bool,
                  (void *)&scr_resolve_thunk_str, (void *)&scr_resolve_thunk_void};
  return scr_make_settler(fns[kind], p);
}

/* Emitted ref-kind resolve thunks call this. */
void scr_resolve_ref_impl(ScrClosure *self, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  ScrPromise *p = scr_resolve_target(self);
  if (p == NULL) {
    if (release != NULL) release(v);
    return;
  }
  scr_promise_fulfill_ref(p, v, retain, release, trace);
  scr_promise_release(p);
}

/* ── emitter support ──────────────────────────────────────────────────── */

/* Generalized resolve construction: `fn` is an emitted thunk with closure
 * calling convention (self, value) that forwards to scr_resolve_ref_impl
 * with the concrete RC helpers. */
ScrClosure *scr_make_resolve_fn(ScrPromise *p, void *fn) {
  return scr_make_settler(fn, p);
}

/* ── reject closures (new Promise((resolve, reject) => ...)) ──────────
 * Mirror of the resolve closures: caps[0] is a box whose slot holds the
 * promise (+1). The reason is always an Error-hierarchy instance (the
 * frontend pins the reject parameter to `(reason: Error) => void`), and it
 * stores as SCR_EXC_OBJ — exactly the thrown-Error representation — so an
 * await rethrows it, catch-side instanceof answers, and the uncaught
 * printer prints "name: message". First settle wins, exactly JS: reject
 * after any settle (resolve-then-reject, double reject) releases the
 * reason and does nothing. The closure calling convention makes the thunk
 * own its param, like every compiled callee. */
static void scr_reject_thunk(ScrClosure *self, ScrError *reason) {
  ScrPromise *p = scr_resolve_target(self);
  if (p == NULL) {
    scr_error_release(reason);
    return;
  }
  if (p->state != SCR_PROM_PENDING) {
    scr_error_release(reason);
  } else {
    p->state = SCR_PROM_REJECTED;
    p->payload_kind = SCR_EXC_OBJ;
    p->payload = reason; /* ownership moves in */
    p->vt = scr_prom_vt_intern(scr_error_retain_v, scr_error_release_v, scr_error_trace_arg());
    scr_promise_settle_wake(p);
  }
  scr_promise_release(p);
}

ScrClosure *scr_make_reject(ScrPromise *p) {
  return scr_make_settler((void *)&scr_reject_thunk, p);
}

/* The executor's reject for ANY reason (the (reason: unknown) => void shape):
 * the reason is thrown into the active exception cell (scr_throw_dyn unwraps
 * it to the arm it came from: a boxed Error to OBJ, a string to STR, anything
 * else to REF) and the promise rejects with that cell, exactly like a throw
 * that escapes an async body. First settle wins; a settled promise releases
 * the reason and does nothing. The payload is the rejection, so an await
 * rethrows the same value and catch sees the same identity. */
static void scr_reject_dyn_thunk(ScrClosure *self, ScrDyn *reason) {
  ScrPromise *p = scr_resolve_target(self);
  if (p == NULL) {
    scr_dyn_release(reason);
    return;
  }
  if (p->state != SCR_PROM_PENDING) {
    scr_dyn_release(reason);
  } else {
    scr_throw_dyn(reason); /* takes ownership */
    scr_promise_reject_pending(p);
  }
  scr_promise_release(p);
}

ScrClosure *scr_make_reject_dyn(ScrPromise *p) {
  return scr_make_settler((void *)&scr_reject_dyn_thunk, p);
}

/* Shared executor epilogue: an escaping throw rejects a still-pending
 * promise (payload moved out of the active exception cell); a throw after
 * the promise settled is swallowed, like resolve-then-throw in JS. */
static void scr_executor_check_throw(ScrPromise *p) {
  if (!scr_exc_pending()) return;
  if (p->state == SCR_PROM_PENDING) {
    scr_promise_reject_from_cell(p, scr_exc_current_cell());
    scr_promise_settle_wake(p);
  } else {
    scr_exc_clear();
  }
}

/* Runs a `new Promise(executor)` executor synchronously; an escaping throw
 * rejects the promise (JS-exact). Borrows `p` and `exec`; `resolve`
 * ownership moves INTO the executor call (compiled callees own and finally
 * release their params). */
void scr_promise_run_executor(ScrPromise *p, ScrClosure *exec, ScrClosure *resolve) {
  ((void (*)(ScrClosure *, ScrClosure *))exec->fn)(exec, resolve);
  scr_executor_check_throw(p);
}

/* Zero-param executor (`new Promise(() => {})`): nothing can ever resolve —
 * a deliberately-forever-pending promise. Borrows both. */
void scr_promise_run_executor0(ScrPromise *p, ScrClosure *exec) {
  ((void (*)(ScrClosure *))exec->fn)(exec);
  scr_executor_check_throw(p);
}

/* Two-param executor (`new Promise((resolve, reject) => ...)`): same as
 * scr_promise_run_executor with the reject closure's +1 also moving into
 * the call. */
void scr_promise_run_executor2(ScrPromise *p, ScrClosure *exec, ScrClosure *resolve,
                                ScrClosure *reject) {
  ((void (*)(ScrClosure *, ScrClosure *, ScrClosure *))exec->fn)(exec, resolve, reject);
  scr_executor_check_throw(p);
}

/* ── sync generators (function*) ──────────────────────────────────────
 * Contract in scr_runtime.h. The fiber machinery above is the engine:
 * scr_switch is a synchronous coroutine hop, so generators need no event
 * loop — .next() from the main stack (or any fiber) blocks until the
 * yield. */

enum { SCR_GEN_UNSTARTED = 0, SCR_GEN_SUSPENDED, SCR_GEN_RUNNING, SCR_GEN_DONE };

/* One type-erased value slot: the exception cell's payload technique,
 * with only the release entry point (takes MOVE — nothing here retains). */
typedef struct {
  ScrExcKind kind; /* NONE / F64 / BOOL / REF (strings ride REF) */
  double f64;
  bool b;
  void *payload;
  void (*release_fn)(void *);
} ScrGenSlot;

static void scr_gen_slot_reset(ScrGenSlot *s) {
  if (s->kind == SCR_EXC_REF && s->payload != NULL) s->release_fn(s->payload);
  s->kind = SCR_EXC_NONE;
  s->payload = NULL;
  s->release_fn = NULL;
}

/* WHAT BACKS THIS GENERATOR. Stored, never inferred from `fiber` being
 * NULL -- `fiber` is ALSO NULL on a torn-down fibre generator, so a test on
 * the pointer would read a finished fibre as a frame. The codebase already
 * names this shape: SCR_CORO_HAS_EXC is stored for exactly the same reason.
 *
 * 21 of the 31 ScrGen entry points never read this, because they touch only
 * the slots and the state below. That is what made one discriminated handle
 * cheaper than two handle types, and it is why this field is the whole cost
 * of decision 1 on the handle side. */
typedef enum { SCR_GEN_BACKED_FIBER = 0, SCR_GEN_BACKED_FRAME = 1 } ScrGenBacking;

struct ScrGen {
  size_t rc;
  ScrFiber *fiber; /* NULL once torn down (done, or unstarted release) */
  ScrGenBacking backing;
  ScrCoroBase *frame; /* non-NULL iff backing == SCR_GEN_BACKED_FRAME */
  int state;
  ScrGenSlot out; /* yielded value / completion value */
  ScrGenSlot in;  /* the .next(v) argument */
  ScrGenSlot ret; /* a parked .return(v) value */
  /* The never-started teardown: drops the packed (already-retained)
   * arguments the spawn wrapper built. Emitted per generator function. */
  void (*drop_args)(void *);
  /* ── async generators only (scr_agen_new sets settle non-NULL) ──────
   * `settle` is the emitted per-generator-type result builder: it reads
   * OUT + scr_gen_done(g) and FULFILLS p with the IteratorResult record.
   * `pending` is the in-flight .next()/.return()/.throw() promise (+1) —
   * the body's yield (or the completion epilogue) settles it. A NULL
   * settle means an ordinary synchronous generator, and every scr_agen_*
   * entry point is then unreachable by construction. */
  void (*settle)(ScrGen *, ScrPromise *);
  ScrPromise *pending;
  /* ── the NATIVE consumer (scr_agen_*_native; see scr_runtime.h) ─────
   * `sink` is non-NULL exactly while a native request is in flight, and
   * IS that request — there is no promise. `sink_ctx` is BORROWED and
   * deliberately untraced (a counted edge from here into a cycle-
   * collected consumer would hide that consumer's ring from trial
   * deletion); a consumer being torn down clears both through
   * scr_agen_sink_detach. `fail` parks a body exception between the
   * fiber's death and the sink's microtask turn. */
  ScrAgenSink sink;
  void *sink_ctx;
  ScrExcCell fail;
};

/* Moves a cell's contents (payload ownership included) into another. */
static void scr_exc_cell_move(ScrExcCell *dst, ScrExcCell *src) {
  dst->kind = src->kind;
  dst->f64 = src->f64;
  dst->b = src->b;
  dst->payload = src->payload;
  dst->retain_fn = src->retain_fn;
  dst->release_fn = src->release_fn;
  dst->trace_fn = src->trace_fn;
  src->kind = SCR_EXC_NONE;
  src->payload = NULL;
  src->trace_fn = NULL;
}

/* Drops a parked cell's payload (a settlement nobody is left to receive). */
static void scr_exc_cell_drop(ScrExcCell *c) {
  if (c->payload != NULL && c->release_fn != NULL) c->release_fn(c->payload);
  c->kind = SCR_EXC_NONE;
  c->payload = NULL;
  c->trace_fn = NULL;
}

ScrGen *scr_gen_retain(ScrGen *g) {
  if (g) g->rc++;
  return g;
}

#ifdef SCR_CORO_LANE
/* A frame-backed generator's frame teardown. Deliberately not a plain
 * free(): scr_coro_init RETAINED the spawner's AsyncLocalStorage context
 * into base->als (Node's init-time capture), and on the async lane
 * scr_coro_release is what drops it. This lane never goes through
 * scr_coro_release -- it holds no suspension reference and settles no
 * promise -- so the drop has to happen at every site that frees a frame,
 * and all of them called free() directly. One context and every dyn value
 * in it leaked per generator, with no crash and no diagnostic, and ZERO in
 * any program that never uses AsyncLocalStorage because the retain is
 * NULL-safe: a leak that a corpus cannot show you.
 *
 * The SUSPENDED arm of scr_gen_release does not call this, on purpose: that
 * frame is abandoned whole, exactly as the fibre lane abandons a stack. */
static void scr_gen_coro_frame_free(ScrCoroBase *base) {
  scr_als_ctx_release(base->als);
#ifdef SCR_RC_AUDIT
  /* The other half of the census. Paired with scr_gen_coro_alloc's note,
   * so a frame that is freed is silent and only an ABANDONED one is
   * counted -- which is the whole point of the line. */
  scr_note_coro_free();
#endif
  free(base);
}
#endif /* SCR_CORO_LANE */

#ifdef SCR_CORO_LANE
/* A frame abandoned at a yield is deliberately never freed (see scr_gen_release), so nothing points at it any more. It is recorded in a
 * registry the process keeps, which makes it REACHABLE: a leak checker then reports a frame the runtime chose to keep as kept, not as lost. */
static ScrCoroBase **scr_abandoned_frames;
static size_t scr_abandoned_frames_n, scr_abandoned_frames_cap;
static void scr_gen_frame_abandoned(ScrCoroBase *base) {
  if (scr_abandoned_frames_n == scr_abandoned_frames_cap) {
    size_t ncap = scr_abandoned_frames_cap ? scr_abandoned_frames_cap * 2 : 16;
    ScrCoroBase **nf = (ScrCoroBase **)realloc(scr_abandoned_frames, ncap * sizeof *nf);
    if (nf == NULL) return;
    scr_abandoned_frames = nf;
    scr_abandoned_frames_cap = ncap;
  }
  scr_abandoned_frames[scr_abandoned_frames_n++] = base;
}
#endif

void scr_gen_release(ScrGen *g) {
  if (!g || --g->rc != 0) return;
  /* g->pending is NOT released here, and that is an INVARIANT rather than
   * an omission: an async generator's only consumer is the compiler's own
   * for-await desugar, which awaits each request promise before it can do
   * anything else -- so the handle cannot reach a refcount of zero while a
   * request is in flight, and pending is always NULL by here. The frontend
   * refusal on the direct .next()/.return()/.throw() surface is what holds
   * that invariant up (tests/harness/async-generator-boundary.test.ts pins
   * it). Opening that surface means building the request QUEUE first, and
   * the queue's teardown belongs here. */
  scr_gen_slot_reset(&g->out);
  scr_gen_slot_reset(&g->in);
  scr_gen_slot_reset(&g->ret);
  scr_exc_cell_drop(&g->fail); /* a native settlement nobody received */
#ifdef SCR_CORO_LANE
  if (g->backing == SCR_GEN_BACKED_FRAME) {
    if (g->frame != NULL) {
      if (g->state == SCR_GEN_UNSTARTED) {
        /* Never ran: nothing inside it is live. */
        if (g->drop_args != NULL) g->drop_args(g->frame);
        scr_gen_coro_frame_free(g->frame);
      } else if (g->state == SCR_GEN_DONE) {
        /* RAN TO COMPLETION: the body released its own locals on the way
         * out and the finish released the closure environment, so nothing
         * inside is live and the frame is ordinary memory. Freeing it is
         * the COMMON path -- a generator that is simply consumed to
         * exhaustion ends here -- and leaving it in the abandoned arm
         * below would leak every frame of every completed generator
         * without a crash or a diagnostic. */
        scr_gen_coro_frame_free(g->frame);
      }
      /* SUSPENDED: deliberately ABANDONED, exactly as the fibre lane
       * abandons a suspended stack. Unwinding would run user finally
       * blocks Node's GC never runs, and freeing the frame would drop
       * its live locals' references without releasing them. The frame
       * leaks, by the same decision and for the same reason the fibre
       * does -- and it is precisely the accounting gap the
       * abandoned-frame counter on the knob-on lane exists to measure.
       *
       * THAT LAST CLAUSE WAS FALSE UNTIL scr_gen_coro_alloc STARTED
       * NOTING THE FRAME. The counter could not see a generator frame at
       * all, so this arm abandoned in silence while the sentence above
       * said it was measured. Fixed at the allocation, not here, because
       * the gap was a missing +1, not a missing -1. */
      else {
        if ((g->frame->flags & SCR_CORO_AGEN) != 0u) g->frame->promise = NULL; /* a parked body must not answer a freed handle */
        scr_gen_frame_abandoned(g->frame);
      }
      g->frame = NULL;
    }
  }
#endif /* SCR_CORO_LANE */
  scr_obj_free_note();
  free(g);
}

void *scr_gen_retain_v(void *g) { return scr_gen_retain((ScrGen *)g); }
void scr_gen_release_v(void *g) { scr_gen_release((ScrGen *)g); }

bool scr_gen_done(ScrGen *g) { return g->state == SCR_GEN_DONE; }

/* Slot setters (release the previous occupant; payloads MOVE in). */
static void scr_gen_slot_f64(ScrGenSlot *s, double v) {
  scr_gen_slot_reset(s);
  s->kind = SCR_EXC_F64;
  s->f64 = v;
}
static void scr_gen_slot_bool(ScrGenSlot *s, bool v) {
  scr_gen_slot_reset(s);
  s->kind = SCR_EXC_BOOL;
  s->b = v;
}
static void scr_gen_slot_ref(ScrGenSlot *s, void *v, void (*release)(void *)) {
  scr_gen_slot_reset(s);
  s->kind = SCR_EXC_REF;
  s->payload = v;
  s->release_fn = release;
}

void scr_gen_in_f64(ScrGen *g, double v) { scr_gen_slot_f64(&g->in, v); }
void scr_gen_in_bool(ScrGen *g, bool v) { scr_gen_slot_bool(&g->in, v); }
void scr_gen_in_ref(ScrGen *g, void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&g->in, v, release);
}
void scr_gen_in_none(ScrGen *g) { scr_gen_slot_reset(&g->in); }

void scr_gen_ret_f64(ScrGen *g, double v) { scr_gen_slot_f64(&g->ret, v); }
void scr_gen_ret_bool(ScrGen *g, bool v) { scr_gen_slot_bool(&g->ret, v); }
void scr_gen_ret_ref(ScrGen *g, void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&g->ret, v, release);
}
void scr_gen_ret_none(ScrGen *g) { scr_gen_slot_reset(&g->ret); }

void scr_gen_out_f64(ScrGen *g, double v) { scr_gen_slot_f64(&g->out, v); }
void scr_gen_out_bool(ScrGen *g, bool v) { scr_gen_slot_bool(&g->out, v); }
void scr_gen_out_ref(ScrGen *g, void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&g->out, v, release);
}

/* Takes MOVE the slot's value out (the slot resets — a done generator's
 * later resumes answer NONE, JS's undefined). */
static double scr_gen_slot_take_f64(ScrGenSlot *s) {
  double v = s->kind == SCR_EXC_F64 ? s->f64 : 0;
  s->kind = SCR_EXC_NONE;
  return v;
}
static bool scr_gen_slot_take_bool(ScrGenSlot *s) {
  bool v = s->kind == SCR_EXC_BOOL ? s->b : false;
  s->kind = SCR_EXC_NONE;
  return v;
}
static void *scr_gen_slot_take_ref(ScrGenSlot *s) {
  void *v = s->kind == SCR_EXC_REF ? s->payload : NULL;
  s->kind = SCR_EXC_NONE;
  s->payload = NULL;
  s->release_fn = NULL;
  return v;
}

bool scr_gen_out_has(ScrGen *g) { return g->out.kind != SCR_EXC_NONE; }
double scr_gen_take_out_f64(ScrGen *g) { return scr_gen_slot_take_f64(&g->out); }
bool scr_gen_take_out_bool(ScrGen *g) { return scr_gen_slot_take_bool(&g->out); }
void *scr_gen_take_out_ref(ScrGen *g) { return scr_gen_slot_take_ref(&g->out); }

bool scr_exc_genret_pending(void) {
  return scr_exc_current_cell()->kind == SCR_EXC_GENRET;
}

void scr_gen_ret_to_out(ScrGen *g) {
  scr_gen_slot_reset(&g->out);
  g->out = g->ret;
  g->ret.kind = SCR_EXC_NONE;
  g->ret.payload = NULL;
  g->ret.release_fn = NULL;
}

/* ── async generators (async function*) ───────────────────────────────
 * Contract in scr_runtime.h. An async generator is the SAME ScrGen handle
 * over the SAME suspended fiber as a synchronous one — the whole
 * difference is who the consumer is and what a resume answers:
 *
 *   sync   .next()  -> switch in, run to the yield, return the record.
 *   async  .next()  -> switch in and return a PROMISE; the body settles it
 *                      when it reaches a yield (or completes), which may
 *                      be several event-loop turns later because the body
 *                      is allowed to await in between.
 *
 * The body awaiting is the entire reason this is not a thin wrapper.
 * scr_await_park switches to fiber->return_to, which during a resume is
 * the CONSUMER's stack — so the consumer comes back out of the switch
 * with the fiber neither yielded nor done, and must simply hand back the
 * still-pending promise. The fiber is on the promise's waiter list by
 * then, so the loop owns the rest of its life: it resumes it (return_to
 * becomes the loop), the body reaches its yield, settles the pending
 * promise from THERE, and parks again.
 *
 * The settle step is an EMITTED thunk (g->settle) because the
 * IteratorResult record is a typed C struct, one shape per channel pair —
 * the runtime cannot build it. It is the same thunk shape the synchronous
 * lane already interns, with a promise to fulfill instead of a value to
 * return.
 *
 * SEQUENTIAL CONSUMERS ONLY. JS async generators keep a QUEUE of pending
 * requests, so two .next() calls without an await in between are legal and
 * answer in order. Nothing here implements that queue: the frontend
 * refuses a direct .next()/.return()/.throw() on an async generator, so
 * the only consumers that reach these entry points are the compiler's own
 * for-await and Readable.from desugars, both strictly one at a time. If a
 * direct-call surface is ever opened, the queue has to be built FIRST — a
 * second request arriving while one is in flight would otherwise
 * overwrite `pending` and drop a settlement on the floor. The abort in
 * scr_agen_arm turns that mistake into a loud failure rather than a lost
 * promise.
 */


/* The completion epilogue, called from scr_fiber_finish while still ON the
 * dying fiber. The emitted trampoline has already stored the completion
 * value in OUT (or promoted a parked .return through the GENRET path), so
 * the record the settle thunk builds is the { value, done: true } JS
 * answers. An escaping exception rejects instead — moved out of the
 * fiber's cell exactly like an async function body's. */
/* Queues the in-flight NATIVE request's delivery for the next microtask
 * turn. Defined with the other native entry points below; declared here
 * because both settle paths reach it. */
static void scr_agen_sink_schedule(ScrGen *g);

static void scr_agen_finish_gen(ScrGen *g, ScrExcCell *cell) {
  if (g->sink != NULL) {
    /* A NATIVE consumer: OUT already holds the completion value and the
     * sink reads `done` off the state, so nothing is built here. The
     * exception (if any) parks until the sink's turn — it must not stay
     * in the dying fiber's cell, which is about to be destroyed.
     *
     * No await hop, deliberately: JS's AsyncGeneratorCompleteStep resolves
     * the request WITHOUT awaiting on the completion path (only a `yield`
     * awaits its operand), so a completion reaches the consumer one turn
     * sooner than a yield does. */
    g->state = SCR_GEN_DONE;
    if (cell->kind != SCR_EXC_NONE) scr_exc_cell_move(&g->fail, cell);
    scr_agen_sink_schedule(g);
    return;
  }
  ScrPromise *p = g->pending;
  g->pending = NULL;
  /* done must read true BEFORE the thunk runs: it answers the record's
   * done field from this very flag. The handle's own teardown (in the
   * resumer) sets it again, harmlessly. */
  g->state = SCR_GEN_DONE;
  if (p == NULL) {
    /* No request in flight — the body ran to completion off a resume that
     * had already been answered. The value has nowhere to go; drop it
     * rather than leak it. */
    scr_gen_slot_reset(&g->out);
    return;
  }
  if (cell->kind != SCR_EXC_NONE) {
    scr_promise_reject_from_cell(p, cell);
    scr_promise_settle_wake(p);
  } else {
    g->settle(g, p); /* fulfills */
  }
  scr_promise_release(p);
}

#ifdef SCR_CORO_LANE
static void scr_agen_coro_step(ScrGen *g, int inject);
#endif

/* An UNSTARTED async generator that will never run (return()/throw() before the first next()): its backing is torn down and the packed
 * arguments drop, for a fiber-backed handle (the argpack) and a frame-backed one (the frame IS the pack). */
static void scr_agen_drop_unstarted(ScrGen *g) {
#ifdef SCR_CORO_LANE
  if (g->backing == SCR_GEN_BACKED_FRAME) {
    if (g->drop_args != NULL) g->drop_args(g->frame);
    scr_gen_coro_frame_free(g->frame);
    g->frame = NULL;
    g->state = SCR_GEN_DONE;
    return;
  }
#endif
  g->state = SCR_GEN_DONE;
}

/* The consumer->body hop for an async generator: always the frame's step. `inject`: 0 = a plain next(), 1 = return(), 2 = throw(). */
static void scr_agen_enter(ScrGen *g, int inject) {
#ifdef SCR_CORO_LANE
  scr_agen_coro_step(g, inject);
#else
  (void)g; (void)inject;
  abort(); /* an async generator is a frame, and a frame links scr_coro.c (SCR_CORO_LANE) */
#endif
}

/* Arms a fresh request promise. Aborts rather than overwrite one already
 * in flight — see the SEQUENTIAL CONSUMERS note above. */
static ScrPromise *scr_agen_arm(ScrGen *g) {
  if (g->pending != NULL) {
    fputs("scriptc: internal error: overlapping async generator requests\n", stderr);
    abort();
  }
  ScrPromise *p = scr_promise_new();
  g->pending = scr_promise_retain(p);
  return p;
}

/* A request against an already-DONE generator: { value: undefined, done:
 * true }, built by the same thunk (OUT is NONE, done reads true) so the
 * record shape can never disagree with the live path's. */
static ScrPromise *scr_agen_settled_done(ScrGen *g) {
  ScrPromise *p = scr_promise_new();
  g->settle(g, p);
  return p;
}

/* ── the native consumer ───────────────────────────────────────────────
 * The same three resume modes, answering a callback instead of a promise.
 * The contract is in scr_runtime.h; what lives here is the ownership.
 */

/* Runs one settled native request on the main stack. The sink slot is
 * cleared FIRST so the sink may arm the next request from inside it (the
 * stream pump's read loop does exactly that). */
static void scr_agen_sink_deliver(void *arg) {
  ScrGen *g = (ScrGen *)arg;
  ScrAgenSink sink = g->sink;
  void *ctx = g->sink_ctx;
  g->sink = NULL;
  g->sink_ctx = NULL;
  if (sink == NULL) {
    /* The consumer detached while this request was in flight: the value
     * (or the failure) has nowhere to go. Dropping it is the whole point
     * of detaching — the alternative is a dangling ctx. */
    scr_gen_slot_reset(&g->out);
    scr_exc_cell_drop(&g->fail);
  } else if (g->fail.kind != SCR_EXC_NONE) {
    scr_exc_cell_move(scr_exc_current_cell(), &g->fail);
    sink(ctx, g, true);
  } else {
    sink(ctx, g, false);
  }
  /* the +1 the request took in scr_agen_native_arm */
  scr_gen_release(g);
}

static void scr_agen_sink_schedule(ScrGen *g) {
  scr_queue_microtask_raw(&scr_agen_sink_deliver, g, NULL);
}

/* Arms a native request. Aborts on an overlap for the same reason
 * scr_agen_arm does — there is no request queue, in either direction. */
static void scr_agen_native_arm(ScrGen *g, ScrAgenSink sink, void *ctx) {
  if (g->sink != NULL || g->pending != NULL) {
    fputs("scriptc: internal error: overlapping async generator requests\n", stderr);
    abort();
  }
  g->sink = sink;
  g->sink_ctx = ctx;
  /* The request owns a reference for its whole flight, so a consumer may
   * drop the handle while the body is parked on an await: without this the
   * ScrGen could reach zero mid-await, and the loop would then resume a
   * fiber whose back-pointer had just been cleared. */
  scr_gen_retain(g);
}

void scr_agen_next_native(ScrGen *g, ScrAgenSink sink, void *ctx) {
  scr_agen_native_arm(g, sink, ctx);
  if (g->state == SCR_GEN_DONE) {
    /* { value: undefined, done: true }, one turn out — the same shape the
     * settled-promise path answers, minus the record. */
    scr_gen_slot_reset(&g->out);
    scr_agen_sink_schedule(g);
    return;
  }
  scr_agen_enter(g, 0);
}

void scr_agen_return_native(ScrGen *g, ScrAgenSink sink, void *ctx) {
  scr_agen_native_arm(g, sink, ctx);
  switch (g->state) {
  case SCR_GEN_DONE:
    scr_gen_ret_to_out(g);
    scr_agen_sink_schedule(g);
    return;
  case SCR_GEN_UNSTARTED:
    /* The body never runs; the packed arguments drop through the emitted
     * helper, exactly as in scr_agen_return. */
    scr_agen_drop_unstarted(g);
    scr_gen_ret_to_out(g);
    scr_agen_sink_schedule(g);
    return;
  default:
    scr_agen_enter(g, 1);
    return;
  }
}

void scr_agen_throw_native(ScrGen *g, ScrAgenSink sink, void *ctx) {
  ScrExcCell *mine = scr_exc_current_cell();
  scr_agen_native_arm(g, sink, ctx);
  if (g->state == SCR_GEN_DONE || g->state == SCR_GEN_UNSTARTED) {
    /* The body never sees it and the REQUEST fails with the payload —
     * exactly what scr_agen_throw does, minus the promise. */
    if (g->state == SCR_GEN_UNSTARTED) scr_agen_drop_unstarted(g);
    scr_exc_cell_move(&g->fail, mine);
    scr_agen_sink_schedule(g);
    return;
  }
  scr_agen_enter(g, 2);
}

void scr_agen_sink_detach(ScrGen *g) {
  if (g == NULL) return;
  g->sink = NULL;
  g->sink_ctx = NULL;
}

void scr_gen_out_drop(ScrGen *g) { scr_gen_slot_reset(&g->out); }

ScrPromise *scr_agen_next(ScrGen *g) {
  if (g->state == SCR_GEN_DONE) return scr_agen_settled_done(g);
  ScrPromise *p = scr_agen_arm(g);
  scr_agen_enter(g, 0);
  return p;
}

ScrPromise *scr_agen_return(ScrGen *g) {
  switch (g->state) {
  case SCR_GEN_DONE:
    scr_gen_ret_to_out(g);
    return scr_agen_settled_done(g);
  case SCR_GEN_UNSTARTED: {
    /* The body never runs: tear the backing down cleanly (drop the packed
     * arguments) and complete with the parked value. */
    scr_agen_drop_unstarted(g);
    scr_gen_ret_to_out(g);
    return scr_agen_settled_done(g);
  }
  default: {
    ScrPromise *p = scr_agen_arm(g);
    scr_agen_enter(g, 1);
    return p;
  }
  }
}

ScrPromise *scr_agen_throw(ScrGen *g) {
  ScrExcCell *mine = scr_exc_current_cell();
  switch (g->state) {
  case SCR_GEN_DONE:
  case SCR_GEN_UNSTARTED: {
    /* The body never sees it; the generator becomes done and the REQUEST
     * rejects with the payload (an async generator never throws at the
     * call site — Node answers a rejected promise). */
    if (g->state == SCR_GEN_UNSTARTED) scr_agen_drop_unstarted(g);
    ScrPromise *p = scr_promise_new();
    scr_promise_reject_from_cell(p, mine);
    scr_promise_settle_wake(p);
    return p;
  }
  default: {
    ScrPromise *p = scr_agen_arm(g);
    scr_agen_enter(g, 2);
    return p;
  }
  }
}

#ifdef SCR_CORO_LANE
/* ── SYNCHRONOUS GENERATORS BACKED BY A FRAME ─────────────────────────
 *
 * GUARDED, and the guard is not decoration. scr_coro.c leaves the link
 * whenever the module emitted no coroutine (cc.ts drops it on the same
 * predicate the emitter uses), so an UNGUARDED call to scr_coro_state_in
 * from this always-linked unit would be an undefined symbol in every
 * binary that never suspends. SCR_CORO_LANE is the macro cc.ts already
 * derives FROM THE SOURCE LIST rather than from a second read of the knob,
 * so the guard and the link line cannot disagree.
 *
 * Everything below is the frame half of the four entry points that branch.
 * The other 21 ScrGen entry points are untouched because they read only
 * the slots and the state, which live on the handle for both backings. */

void *scr_gen_coro_alloc(size_t size, ScrCoroResume resume, bool has_exc) {
  /* Deliberately not scr_coro_alloc: that one mints the promise the frame
   * will settle, and a synchronous generator settles nothing. One base,
   * two lifecycles -- decision 3. */
  void *mem = calloc(1, size);
  if (mem == NULL) {
    fputs("scriptc: out of memory allocating a generator frame\n", stderr);
    abort();
  }
#ifdef SCR_RC_AUDIT
  /* THE FRAME CENSUS, which scr_coro_alloc makes and this did not.
   *
   * Not copied for symmetry: without it the abandoned-coroutine line
   * CANNOT SEE a generator frame, and the comment in scr_gen_release that
   * calls the suspended arm "precisely the accounting gap the
   * abandoned-frame counter exists to measure" was false as written.
   *
   * The three lanes that deliberately abandon a suspension were not
   * symmetric. An async frame prints "N coroutine(s) abandoned"; a fibre
   * generator prints "RC audit skipped: N fiber(s) never resumed" and even
   * suppresses the leak check. A frame-backed generator printed NOTHING --
   * and the leak check still ran, so its deliberately retained values came
   * out as RC AUDIT FAILED with no line anywhere naming the cause. Silence
   * plus an unexplained failure is worse than either alone. */
  scr_note_coro_alloc();
#endif
  scr_coro_init((ScrCoroBase *)mem, resume, NULL, has_exc);
  return mem;
}

ScrGen *scr_gen_of_coro(ScrCoroBase *base, void (*drop)(void *)) {
  ScrGen *g = calloc(1, sizeof *g);
  if (g == NULL) {
    fputs("scriptc: out of memory allocating a generator handle\n", stderr);
    abort();
  }
  g->rc = 1;
  g->fiber = NULL;
  g->backing = SCR_GEN_BACKED_FRAME;
  g->frame = base;
  /* THE ALLOCATION NOTE, which the fibre twin makes and this did not.
   *
   * scr_gen_new calls scr_obj_alloc_note() and scr_gen_release calls
   * scr_obj_free_note() for BOTH backings -- so every frame-backed
   * generator decremented a counter it had never incremented, and the RC
   * audit printed "-1 object(s) live at exit" and exited 99. A NEGATIVE
   * count, which is not a leak and does not read like one: the next person
   * to see it would have gone looking for an over-release.
   *
   * Audit-only in its effect -- a shipping build compiles both notes to
   * nothing -- but it poisons the audit lane for every program containing a
   * converted generator, which is the lane that proves the OTHER teardown
   * defects are fixed. Found by the parity guard's als arm on its first
   * real run, one fix after the leak that arm was written for: a gap
   * found contains another, for the third time in this slice. */
  scr_obj_alloc_note();
  /* The SAME field the fibre path uses, on a different argument: an
   * UNSTARTED generator must still release the +1 its parameters arrived
   * with, and the body never runs to do it. The fibre path hands
   * drop_args the argpack; here it is the frame, because the frame IS
   * the argpack. */
  g->drop_args = drop;
  g->state = SCR_GEN_UNSTARTED;
  return g;
}

/* The yield arms. Each parks the value in OUT and marks the frame YIELDED;
 * the generated code then simply returns. The flag is set HERE and not by
 * the emitted body because a forgotten one does not crash -- it reports a
 * yield as a completion and silently truncates the sequence. */
/* A generator frame suspended at a yield is PARKED for the RC audit, like a fiber that is never resumed: a consumer that drops the generator
 * (or a loop that ends) leaves it, and every value it owns, by design (JS collects it). The step un-parks it on the next resume. */
#ifdef SCR_RC_AUDIT
#define SCR_GEN_NOTE_YIELD() scr_note_coro_park()
#else
#define SCR_GEN_NOTE_YIELD() ((void)0)
#endif
void scr_gen_coro_yield_f64(ScrGen *g, double v) {
  scr_gen_slot_f64(&g->out, v);
  g->frame->flags |= SCR_CORO_YIELDED;
  SCR_GEN_NOTE_YIELD();
}
void scr_gen_coro_yield_bool(ScrGen *g, bool v) {
  scr_gen_slot_bool(&g->out, v);
  g->frame->flags |= SCR_CORO_YIELDED;
  SCR_GEN_NOTE_YIELD();
}
void scr_gen_coro_yield_ref(ScrGen *g, void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&g->out, v, release);
  g->frame->flags |= SCR_CORO_YIELDED;
  SCR_GEN_NOTE_YIELD();
}

void scr_gen_coro_finish_void(ScrGen *g) { g->frame->flags |= SCR_CORO_DONE; }
void scr_gen_coro_finish_f64(ScrGen *g, double v) {
  scr_gen_slot_f64(&g->out, v);
  g->frame->flags |= SCR_CORO_DONE;
}
void scr_gen_coro_finish_bool(ScrGen *g, bool v) {
  scr_gen_slot_bool(&g->out, v);
  g->frame->flags |= SCR_CORO_DONE;
}
void scr_gen_coro_finish_ref(ScrGen *g, void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&g->out, v, release);
  g->frame->flags |= SCR_CORO_DONE;
}

/* The unwind completion. Contract in scr_coro.h.
 *
 * NO PROMISE IS SETTLED, and that is the whole reason this exists: the
 * emitted unwind used to call scr_coro_finish_throw, which rejects
 * base->promise -- NULL on every generator frame -- on the single most
 * ordinary exceptional path a generator has.
 *
 * The GENRET half is the fibre trampoline's epilogue
 *     if (scr_exc_genret_pending()) { scr_exc_clear(); scr_gen_ret_to_out(g); }
 * at the one point the frame lane reaches the same state. A REAL exception
 * is left pending in the active cell: scr_gen_coro_step then sees a body
 * that neither yielded nor finished, marks the handle DONE, and the
 * consumer-side resume rethrows it. */
void scr_gen_coro_finish_throw(ScrGen *g) {
  if (scr_exc_genret_pending()) {
    scr_exc_clear();
    scr_gen_ret_to_out(g);
  }
  g->frame->flags |= SCR_CORO_DONE;
}

/* The IN slot THROUGH THE HANDLE -- see scr_coro.h for why the fibre twins
 * cannot serve this lane. Same three slot takers underneath, so a .next(v)
 * value behaves identically whichever backing produced the generator. */
double scr_gen_coro_take_in_f64(ScrGen *g) { return scr_gen_slot_take_f64(&g->in); }
bool scr_gen_coro_take_in_bool(ScrGen *g) { return scr_gen_slot_take_bool(&g->in); }
void *scr_gen_coro_take_in_ref(ScrGen *g) { return scr_gen_slot_take_ref(&g->in); }

/* What to put in the ACTIVE cell before the body runs. It has to happen
 * INSIDE the INV-5 window: a fat frame installs its own cell, so a sentinel
 * written before scr_coro_state_in would land in the consumer's cell and
 * the body would never see it. The fibre path has the same ordering and
 * gets it from scr_switch for free. */
typedef enum { SCR_GEN_INJECT_NONE = 0, SCR_GEN_INJECT_RET, SCR_GEN_INJECT_THROW } ScrGenInject;

/* One consumer-driven step of a frame-backed generator. The counterpart of
 * scr_gen_switch_in, and deliberately NOT scr_coro_resume_entry: that one
 * is the ready-queue entry, settles a promise on fall-out and releases the
 * suspension's reference, and this path has no promise and no suspension
 * reference. What the two share is INV-5, and they share it as code. */
static void scr_gen_coro_step(ScrGen *g, ScrGenInject inject, bool async) {
  ScrCoroBase *base = g->frame;
  ScrCoroTaskState st;
  scr_gen_retain(g);
#ifdef SCR_RC_AUDIT
  if (g->state == SCR_GEN_SUSPENDED) scr_note_coro_unpark(); /* it was parked at a yield */
#endif
  g->state = SCR_GEN_RUNNING;
  scr_coro_state_in(base, &st);
  /* THE SENTINEL GOES IN ONLY OVER AN EMPTY CELL, which is what all three
   * fibre twins do and this did not:
   *
   *     if (g->fiber->exc.kind == SCR_EXC_NONE) g->fiber->exc.kind = ...
   *
   * Unguarded, a cell that already held a payload would have its kind
   * overwritten with the sentinel -- the payload neither released nor
   * delivered, so a lost exception and a leak in one statement.
   *
   * IT CANNOT HAPPEN TODAY, and the reason is a fence somewhere else: the
   * cell can only be dirty here if an earlier unwind parked mid-flight,
   * which needs a `finally` that yields, and `finally` is a point-level
   * admission blocker so no converted generator has one. That is exactly
   * the shape this front keeps paying for -- a fence argument held in
   * another file, which the next widening voids without visiting this
   * line. The guard costs one comparison and removes the dependence.
   *
   * THAT IMPOSSIBILITY ARGUMENT IS NOW VOID, AND THE WIDENING IT
   * PREDICTED IS THE ONE THAT ARRIVED (2026-10-11). `finally` is NOT a
   * point-level admission blocker any more: ir/liveness.ts records under
   * D4 that `finallyBodyDepth` is GONE from admission and calls it "the
   * last point blocker retiring", so a suspension inside a finally body
   * converts and a converted generator CAN hold a yielding finally. The
   * sentence above that reads "so no converted generator has one" is
   * false as of that change; it is kept verbatim because it is the
   * record of what the fence once bought.
   *
   * NO DEFECT FOLLOWS, and that is the whole point of the paragraph
   * above: the guard below was written NOT to depend on the fence, so
   * the revocation costs nothing and the code needs no edit. What was
   * wrong is the PROSE asserting an impossibility, not the guard. This
   * note therefore no longer claims the dirty cell is unreachable -- only
   * that the one comparison below makes the question moot. */
  if (inject == SCR_GEN_INJECT_RET) {
    ScrExcCell *sc_cell = scr_exc_current_cell();
    if (sc_cell->kind == SCR_EXC_NONE) sc_cell->kind = SCR_EXC_GENRET;
  }
  /* SCR_GEN_INJECT_THROW on a FAT frame: scr_coro_state_in (above) already
   * swapped the active cell to the frame's own (st.mine), so the payload
   * scr_gen_resume_throw parked in the then-ambient cell is now sitting in
   * st.prev_cell, where the body never looks -- the body reads the active
   * cell, which is st.mine. The fibre twin moves the same payload across
   * explicitly (scr_exc_cell_move(&g->fiber->exc, mine)), and the lean
   * equivalent a few lines below in scr_gen_resume_throw does the identical
   * move inline, unconditionally -- "an earlier sentinel parked by a
   * finally-yield is replaced, the injected throw wins". This is that same
   * move for the FAT case, which was unreachable (and therefore unwritten,
   * on purpose -- see the superseded fix-it-later note this replaces)
   * before emitGenCoroSpawn started passing the real has_exc instead of a
   * hardcoded false.
   *
   * Unconditional, matching the fiber path exactly: no `kind == NONE`
   * guard, because the throw must win over a parked finally-yield sentinel
   * here too, not merely when the cell happens to be empty. */
  if (inject == SCR_GEN_INJECT_THROW && st.mine != NULL) {
    scr_exc_cell_move(st.mine, st.prev_cell);
  }
  base->flags &= ~(uint32_t)SCR_CORO_YIELDED;
  base->flags |= SCR_CORO_RUNNING;
  base->resume(base);
  base->flags &= ~(uint32_t)SCR_CORO_RUNNING;
  if (async) {
    /* An async body has FOUR outcomes (yielded, parked on an await, done, threw) and answers through the request promise or the sink, never by
     * throwing at the consumer: scr_agen_coro_resumed reads them. The state window is still installed, which the exception arm needs. */
    scr_agen_coro_resumed(base);
    scr_coro_state_out(&st);
    scr_gen_release(g);
    return;
  }
  /* THREE OUTCOMES, read from the stored flags and never inferred:
   *   YIELDED -- a value is in OUT, the generator stays suspended;
   *   DONE    -- the body completed, OUT holds the return value;
   *   neither -- an exception escaped. The fibre path moves it into the
   *              resumer's cell; for a LEAN frame the active cell already
   *              IS the resumer's, so only a fat frame has anything to
   *              move, and state_out below does the restoring. */
  if ((base->flags & SCR_CORO_YIELDED) != 0u) {
    g->state = SCR_GEN_SUSPENDED;
  } else {
    g->state = SCR_GEN_DONE;
    if (st.mine != NULL && st.mine->kind != SCR_EXC_NONE) {
      scr_exc_cell_move(&g->fail, st.mine);
    }
  }
  scr_coro_state_out(&st);
  if (g->state == SCR_GEN_DONE && g->fail.kind != SCR_EXC_NONE) {
    scr_exc_cell_move(scr_exc_current_cell(), &g->fail);
  }
  scr_gen_release(g);
}

/* ── ASYNC GENERATORS ON A FRAME ──────────────────────────────────────────
 * The handle is the same ScrGen (backing FRAME) with `settle` set; the frame carries SCR_CORO_AGEN and keeps the handle in the `promise` slot it
 * does not otherwise use (not owned). Four things the synchronous protocol lacks, each answered here:
 *   1. the settle thunk rides the handle (scr_agen_coro_of);
 *   2. every consumer entry point reaches the body through scr_agen_enter -> scr_agen_coro_step (no fiber to switch to);
 *   3. a resume answers FOUR outcomes, not three: yielded, parked on an await, done, threw (scr_agen_coro_resumed). A body that parks between
 *      yields returns with neither flag set, which the synchronous step would read as "completed";
 *   4. the yield arm settles the in-flight request (or schedules the native sink) before it suspends. The operand-await hop JS takes before that
 *      is an explicit async.hop the lowering emits ahead of the yield, so it is an ordinary suspension point here. */
ScrGen *scr_agen_coro_of(ScrCoroBase *base, void (*drop)(void *), void (*settle)(ScrGen *, ScrPromise *)) {
  ScrGen *g = scr_gen_of_coro(base, drop);
  g->settle = settle;
  base->flags |= SCR_CORO_AGEN;
  base->promise = (ScrPromise *)(void *)g; /* the handle, not a promise; never released as one */
  return g;
}

static void scr_agen_coro_yield_settle(ScrGen *g) {
  if (g->sink != NULL) {
    /* A native consumer: the value stays in OUT and the sink gets it on the next microtask turn, on the loop's stack. */
    scr_agen_sink_schedule(g);
  } else {
    ScrPromise *p = g->pending;
    g->pending = NULL;
    if (p != NULL) {
      g->settle(g, p); /* { value: OUT, done: false } -- the state is not DONE */
      scr_promise_release(p);
    } else {
      scr_gen_slot_reset(&g->out);
    }
  }
  g->frame->flags |= SCR_CORO_YIELDED;
  SCR_GEN_NOTE_YIELD();
}
void scr_agen_coro_yield_f64(ScrGen *g, double v) {
  scr_gen_slot_f64(&g->out, v);
  scr_agen_coro_yield_settle(g);
}
void scr_agen_coro_yield_bool(ScrGen *g, bool v) {
  scr_gen_slot_bool(&g->out, v);
  scr_agen_coro_yield_settle(g);
}
void scr_agen_coro_yield_ref(ScrGen *g, void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&g->out, v, release);
  scr_agen_coro_yield_settle(g);
}

/* Reads the outcome of one run of an async generator's frame, inside the INV-5 window. Reached from the consumer's step and from the loop's
 * resume of a frame that was parked on an await or a hop. */
void scr_agen_coro_resumed(ScrCoroBase *base) {
  ScrGen *g = (ScrGen *)(void *)base->promise;
  uint32_t fl = base->flags;
  if (g == NULL) {
    /* The handle was dropped while the body was parked: nobody is waiting for an answer. A finished body drops what it holds. */
    if ((fl & SCR_CORO_DONE) != 0u && scr_exc_pending()) scr_exc_clear();
    base->flags &= ~(uint32_t)SCR_CORO_YIELDED;
    return;
  }
  if ((fl & SCR_CORO_YIELDED) != 0u) {
    base->flags &= ~(uint32_t)SCR_CORO_YIELDED;
    g->state = SCR_GEN_SUSPENDED;
  } else if ((fl & SCR_CORO_DONE) != 0u) {
    ScrExcCell *cell = scr_exc_current_cell();
    g->state = SCR_GEN_DONE;
    scr_agen_finish_gen(g, cell);
    if (cell->kind != SCR_EXC_NONE) scr_exc_cell_drop(cell); /* no request was waiting for it */
  } else if ((fl & SCR_CORO_SUSPENDED) != 0u) {
    g->state = SCR_GEN_SUSPENDED; /* parked on an await or the yield's hop: the loop resumes it */
  } else {
    fputs("scriptc: internal error: an async generator resume returned without yielding, suspending, finishing, or throwing\n", stderr);
    abort();
  }
}

static void scr_agen_coro_step(ScrGen *g, int inject) {
  scr_gen_coro_step(g, (ScrGenInject)inject, true);
}
#endif /* SCR_CORO_LANE */

void scr_gen_resume(ScrGen *g) {
  switch (g->state) {
  case SCR_GEN_RUNNING: {
    static const char sc_m[] = "Generator is already running";
    scr_throw_error_msg(SCR_ERR_TYPE, sc_m, sizeof sc_m - 1);
    return;
  }
  case SCR_GEN_DONE:
    /* next() on a done generator: { value: undefined, done: true } —
     * OUT is NONE (the completing resume took it). */
    return;
  default:
#ifdef SCR_CORO_LANE
    scr_gen_coro_step(g, SCR_GEN_INJECT_NONE, false);
#endif
  }
}

void scr_gen_resume_return(ScrGen *g) {
  switch (g->state) {
  case SCR_GEN_RUNNING: {
    static const char sc_m[] = "Generator is already running";
    scr_throw_error_msg(SCR_ERR_TYPE, sc_m, sizeof sc_m - 1);
    return;
  }
  case SCR_GEN_DONE:
    scr_gen_ret_to_out(g);
    return;
  case SCR_GEN_UNSTARTED:
    /* The body never runs: tear the backing down cleanly (drop the
     * arguments) and complete with the parked value. */
#ifdef SCR_CORO_LANE
    if (g->backing == SCR_GEN_BACKED_FRAME) {
      if (g->drop_args != NULL) g->drop_args(g->frame);
      scr_gen_coro_frame_free(g->frame);
      g->frame = NULL;
      g->state = SCR_GEN_DONE;
      scr_gen_ret_to_out(g);
      return;
    }
#endif
    return;
  default:
    /* Suspended at a yield: inject the sentinel (an earlier .return whose
     * unwind a finally-yield parked leaves it already set) and resume. */
#ifdef SCR_CORO_LANE
    if (g->backing == SCR_GEN_BACKED_FRAME) {
      /* The sentinel goes in INSIDE the INV-5 window, not here: a fat
       * frame installs its own cell, so writing it now would land it in
       * the CONSUMER's and the body would never see it. */
      scr_gen_coro_step(g, SCR_GEN_INJECT_RET, false);
      return;
    }
#endif
  }
}

void scr_gen_resume_throw(ScrGen *g) {
  switch (g->state) {
  case SCR_GEN_RUNNING: {
    /* Replace the parked payload with Node's reentrancy TypeError. */
    static const char sc_m[] = "Generator is already running";
    scr_throw_error_msg(SCR_ERR_TYPE, sc_m, sizeof sc_m - 1);
    return;
  }
  case SCR_GEN_DONE:
    /* .throw on a done generator: it stays done; the payload stays
     * pending in the caller — the call site's check rethrows it. */
    return;
  case SCR_GEN_UNSTARTED:
    /* The body never runs; the generator becomes done and the payload
     * stays pending in the caller (probed Node behavior). */
#ifdef SCR_CORO_LANE
    if (g->backing == SCR_GEN_BACKED_FRAME) {
      if (g->drop_args != NULL) g->drop_args(g->frame);
      scr_gen_coro_frame_free(g->frame);
      g->frame = NULL;
      g->state = SCR_GEN_DONE;
      return;
    }
#endif
    return;
  default: {
    /* Move the caller's pending payload into the fiber's cell (an
     * earlier sentinel parked by a finally-yield is replaced — the
     * injected throw wins, like a throw inside that finally). */
#ifdef SCR_CORO_LANE
    if (g->backing == SCR_GEN_BACKED_FRAME) {
      /* The payload is already pending in the ACTIVE cell, where a lean
       * frame's body reads it; a fat frame's own cell is installed by
       * state_in, so the step moves it across inside the window. */
      scr_gen_coro_step(g, SCR_GEN_INJECT_THROW, false);
      return;
    }
#endif
  }
  }
}

/* One Node callback-scope close, for the signal dispatcher: user ticks to
 * exhaustion, then promise jobs, and back while either has work. Its loop
 * body is the checkpoint's own (scr_loop_run_inner), without the stream,
 * unhandled-rejection and loop-exit steps, which belong to the loop's turn.
 * False when an uncaught throw is pending: the caller stops, as the loop does. */
bool scr_loop_drain_ticks_jobs(void) {
  for (;;) {
    if (scr_exc_pending()) return false;
    if (scr_nt_head == NULL && scr_ready_len == 0) return true;
    while (scr_nt_head != NULL) {
      ScrNtick *t = scr_nt_head;
      scr_nt_head = t->next;
      if (scr_nt_head == NULL) scr_nt_tail = NULL;
      ScrClosure *cb = t->cb;
      void (*raw)(void) = t->raw;
      free(t);
      if (cb) {
        ((void (*)(ScrClosure *))cb->fn)(cb);
        scr_closure_release(cb);
      } else {
        raw();
      }
      if (scr_exc_pending()) return false;
    }
    while (scr_ready_len > 0) {
      ScrFiber *f = scr_ready[scr_ready_head++];
      scr_ready_len--;
      scr_resume_fiber(f);
    }
  }
}
