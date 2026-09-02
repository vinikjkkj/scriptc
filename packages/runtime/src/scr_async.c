/* Async runtime: stackful fibers, promises, and a dependency-free event
 * loop (microtask queue + timer min-heap).
 *
 * Model (see docs/ir.md):
 * - An async function's body is ordinary compiled C, run on its own fiber
 *   (heap-allocated ucontext stack). Calling it runs the body EAGERLY until
 *   the first suspension (JS's synchronous-prefix rule), then control
 *   returns to the spawner with a +1 promise.
 * - `await` on a pending promise parks the fiber on the promise's waiter
 *   list and switches back to whoever resumed it. Fulfillment moves waiters
 *   to the microtask queue (microtasks run before timers, like Node).
 * - Each fiber carries its own exception cell (scr_exc_swap_cell) so a
 *   pending exception can't leak across concurrent execution contexts. A
 *   throw escaping an async body rejects its promise; awaiting a rejected
 *   promise re-throws into the awaiter.
 * - Loop exhaustion with still-suspended fibers exits normally (Node's
 *   behavior); those stacks are deliberately not unwound, and the RC audit
 *   downgrades to a note in that case.
 */
#define _XOPEN_SOURCE 700
#include "scr_runtime.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
/* Windows arm: fibers come from the Win32 Fibers API (CreateFiber /
 * SwitchToFiber — the direct ucontext analog: cooperatively scheduled,
 * same thread, own stack); the idle sleep is nanosleep (mingw-w64 ships
 * it, over Sleep). poll(2) has no Windows arm — see the sleep seam in
 * scr_loop_run: the poller-backed units (net/dgram/watch) are not built
 * for win32 targets (cc.ts gates them), so their fds never appear; the
 * events unit DOES cross-compile (scr_events.c's win32 arm) and is
 * served by a capped nanosleep — dispatch at the next turn's top, the
 * cap bounding signal/stdin latency instead of a pollable wake fd. */
#include <windows.h>
#else
#include <poll.h>
#include <signal.h>
#include <ucontext.h>
#include <unistd.h>
#endif

#if defined(__has_feature)
#if __has_feature(address_sanitizer)
#define SCR_ASAN_FIBERS 1
void __sanitizer_start_switch_fiber(void **fake_stack_save, const void *bottom, size_t size);
void __sanitizer_finish_switch_fiber(void *fake_stack_save, const void **bottom_old, size_t *size_old);
#endif
#endif

/* ASan inflates stack frames severalfold (unoptimized locals + redzones),
 * so the sanitized lane gets proportionally bigger fiber stacks — same
 * headroom DISCIPLINE, instrumented scale. Keep the island's stack budget
 * (scr_island.c) at half of whichever size is active. 8MB under ASan is
 * the measured need: an engine call costs 64–96KB there, and a real
 * embedded graph entered FROM A FIBER (a commander action awaiting
 * generateText — zod parses inside promise chains) nests dozens of engine
 * frames; the memory is malloc'd and committed lazily, so idle fibers pay
 * address space, not RSS. */
#ifdef SCR_ASAN_FIBERS
#define SCR_FIBER_STACK (8 * 1024 * 1024)
#else
#define SCR_FIBER_STACK (256 * 1024)
#endif

/* The INITIAL COMMITTED size of a win32 fiber stack, which is a different
 * thing from the reserve above and was the whole of this runtime's page-
 * fault bill. CreateFiber's dwStackSize parameter is the COMMIT, not a
 * reserve and not lazy: every async call committed 256 KiB of fresh
 * demand-zero stack and DeleteFiber handed it straight back.
 *
 * Measured standalone on this toolchain (dynimp-lab/arena/fiberfault.c),
 * 164,711 create/switch/delete cycles touching two stack pages each --
 * which is the fiber count of ONE phase of the zapo messaging bench:
 *
 *   commit    reserve            kernel   elapsed    faults
 *   262144    16 MiB (default)   2,594     2.733 s   329,445  <- was
 *    16384    16 MiB (default)   2,406     2.632 s   329,445  <- is
 *   262144     1 MiB             1,312     1.545 s   329,445
 *    16384     1 MiB             1,234     1.425 s   329,445
 *   262144    16 MiB (control)   2,484     2.694 s   329,445
 *
 * 329,445 against the 329,111 the bench itself measures for that phase,
 * so the fiber is the whole of that bill and not a piece of it.
 *
 * BUT THE RESERVE IS THE COST, NOT THE COMMIT, and the first version of
 * this note said the opposite. The reserve here is the executable's
 * 16 MiB SizeOfStackReserve, and reserving and releasing 16 MiB of
 * address space 164,711 times is what the kernel time is. Dropping the
 * commit at the same reserve is 7%, and shipping exactly that measured
 * NOTHING on the real bench (5 plain / 4 post reps, kernel medians 3,969
 * vs 3,992 ms, ranges fully overlapping) -- which is what 7% looks like.
 *
 * SO WHY KEEP IT: COMMIT CHARGE. 16 KiB instead of 256 KiB per LIVE
 * fiber is 16x less pagefile commit on a phase that keeps hundreds in
 * flight. That is unmeasured -- cpuphase reports working set, not
 * PagefileUsage -- and it is the honest reason this line reads as it
 * does. The reserve is left at the executable default exactly as
 * CreateFiber left it, because lowering it caps how deep an async body
 * may recurse and that is a semantic change, not a tuning one.
 *
 * THE FAULTS DO NOT MOVE IN ANY ARM ABOVE -- 329,445 in all six -- and
 * that is expected: they are the demand-zero first touches of a FRESH
 * stack, so only reusing stacks removes them. A
 * pool of 8 reusable fibers measures 34 faults and 0.025 s for the same
 * 164,711 switches (dynimp-lab/arena/fiberpool.c). That is the next
 * change and it is not this one.
 *
 * Left alone under SCR_ASAN_FIBERS: that arm wants 8 MiB actually
 * committed so ASan can poison the whole stack. */
#ifndef SCR_FIBER_COMMIT
#define SCR_FIBER_COMMIT (16 * 1024)
#endif

/* ── promises ─────────────────────────────────────────────────────────── */

enum { SCR_PROM_PENDING = 0, SCR_PROM_FULFILLED = 1, SCR_PROM_REJECTED = 2 };

typedef struct ScrFiber ScrFiber;

struct ScrPromise {
  size_t rc;
  int state;
  /* Payload (fulfillment value or rejection reason), ScrExcCell-style.
   * trace_fn is non-NULL iff the REF payload type carries a cycle header
   * (a promise settled with a cycle-capable value can be a cycle member —
   * e.g. a closure that captures a box holding this very promise). */
  ScrExcKind payload_kind; /* NONE = void fulfillment */
  double f64;
  bool b;
  void *payload;
  void *(*retain_fn)(void *);
  void (*release_fn)(void *);
  ScrTraceFn trace_fn;
  /* Fibers parked on this promise. */
  ScrFiber **waiters;
  size_t nwaiters, waiters_cap;
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
  } *cbs;
  size_t ncbs, cbs_cap;
  /* Payload-conversion memo (scr_runtime.h states the contract): the
   * adapted promises this one has already been converted into, keyed by
   * the lowerer's adapter id. NULL for every promise in a program that
   * never converts a payload -- one pointer, no allocation. Entries are
   * OWNED (+1) and traced. */
  struct ScrPromiseAdapt *adapts;
  /* Unhandled-rejection tracking: set when rejected, cleared on await. */
  bool rejection_observed;
  /* How many of the awaits still owed on this promise belong to a
   * PAYLOAD-CONVERSION ADAPTER rather than to the source program. One per
   * adapter filed in `adapts` (each adapter awaits its source exactly
   * once, by construction of promiseCoerceAdapter), decremented by the
   * first observation that arrives. See scr_prom_observe. */
  unsigned adapter_observes_pending;
  /* Set when the checkpoint report delivered THIS promise to
   * 'unhandledRejection' listeners — a handler attached after that is
   * Node's 'rejectionHandled' moment (scr_prom_observe below). */
  bool reported_unhandled;
};

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
      p->trace_fn) {
    visit(p->payload, ctx);
  }
  for (size_t i = 0; i < p->ncbs; i++) visit(p->cbs[i].dst, ctx);
  /* Memo entries are strong and cycle-headered, and the pair IS a
   * cycle while the adapter's fiber still holds the source, so the
   * collector has to be able to see this edge. */
  for (ScrPromiseAdapt *a = p->adapts; a; a = a->next) visit(a->adapted, ctx);
}

/* Teardown for the collector: release the payload only when the trace does
 * NOT visit it (the complement — see the contract in scr_runtime.h). The
 * cb destinations are always visited, so only the array frees here. */
static void scr_promise_gcfree(void *o) {
  ScrPromise *p = (ScrPromise *)o;
  if (p->payload_kind == SCR_EXC_STR) {
    scr_str_release((ScrStr *)p->payload);
  } else if ((p->payload_kind == SCR_EXC_REF || p->payload_kind == SCR_EXC_OBJ) &&
             p->payload && !p->trace_fn) {
    p->release_fn(p->payload);
  }
  /* Parked Promise.all states are NOT traced children (their values array
   * is reachable only through them) — release like the untraced payload
   * above; the cb destinations stay untouched (trace visits them). */
  for (size_t i = 0; i < p->ncbs; i++) {
    if (p->cbs[i].all) scr_promise_all_state_release(p->cbs[i].all);
  }
  /* Memo entries ARE visited by the trace, so only the spine frees
   * here -- the collector owns the adapted promises' releases. */
  scr_promise_adapts_free(p, false);
  free(p->waiters);
  free(p->cbs);
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
void (*scr_rjh_notify_fn)(ScrPromise *p) = NULL;

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
  if (p->adapter_observes_pending > 0) {
    p->adapter_observes_pending--;
    by_adapter = true;
  }
  p->rejection_observed = true;
  if (p->reported_unhandled) {
    p->reported_unhandled = false;
    if (scr_rjh_notify_fn != NULL) scr_rjh_notify_fn(p);
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
  for (ScrPromiseAdapt *a = p->adapts; a != NULL; a = a->next) {
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
           p->payload) p->release_fn(p->payload);
  p->payload_kind = SCR_EXC_NONE;
  p->payload = NULL;
}

void scr_promise_release(ScrPromise *p) {
  if (!p || p->rc == SIZE_MAX) return;
  if (--p->rc == 0) {
    scr_cyc_on_dead(p);
    scr_promise_release_payload(p);
    scr_promise_adapts_free(p, true);
    free(p->waiters);
    for (size_t i = 0; i < p->ncbs; i++) {
      scr_promise_release(p->cbs[i].dst);
      if (p->cbs[i].all) scr_promise_all_state_release(p->cbs[i].all);
    }
    free(p->cbs);
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
  ScrPromiseAdapt *a = p->adapts;
  p->adapts = NULL;
  p->adapter_observes_pending = 0;
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
  for (ScrPromiseAdapt *a = src->adapts; a; a = a->next) {
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
    a->next = src->adapts;
    a->id = id;
    a->adapted = scr_promise_retain(made);
    src->adapts = a;
    /* One await credit for the adapter just filed (scr_prom_observe). */
    src->adapter_observes_pending++;
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

/* One saved execution context. POSIX: a ucontext_t (swapcontext saves the
 * outgoing context INTO the `from` slot). Windows: the fiber HANDLE —
 * SwitchToFiber saves the outgoing state inside the fiber object itself,
 * so the slot only needs to name the destination; `from` is unused. */
#ifdef _WIN32
typedef void *ScrCtx;
#else
typedef ucontext_t ScrCtx;
#endif

/* One EXECUTION CONTEXT: a stack, plus the saved state naming where on it
 * to resume. Deliberately NOT part of ScrFiber, which is per-TASK: a
 * finished fiber's stack is empty but perfectly good, and the trampoline
 * loops so one stack serves task after task. See scr_stack_acquire. */
typedef struct ScrStack {
  ScrCtx ctx;
  char *mem;             /* POSIX only; Windows fibers own their stack */
  struct ScrStack *next; /* free-list link; meaningful only while pooled */
} ScrStack;

struct ScrFiber {
  ScrStack *st;      /* the context we run on; NULL on the stackless
                      * microtask envelopes at the bottom of this struct */
  ScrCtx *return_to; /* whoever resumed us last (spawner or the loop) */
  ScrPromise *promise; /* the promise this fiber settles (owned +1); NULL
                        * for generator fibers (gen non-NULL instead) */
  ScrGen *gen;         /* the generator this fiber runs (borrowed — the
                        * ScrGen owns the fiber, never the reverse) */
  ScrExcCell exc;
  /* AsyncLocalStorage context (owned; NULL = empty). Inherited from the
   * SPAWNER at spawn (Node's init-time capture), swapped active with the
   * fiber (the exc-cell pattern) so run()'s window rides awaits. */
  ScrAlsCtx *als;
  bool done;
  /* Trampoline args: the spawn wrapper stores a pointer to a stack-local
   * argpack; the trampoline copies it out before the spawner resumes. */
  void *argpack;
  void (*entry)(ScrFiber *self, void *argpack);
  /* queueMicrotask entries: a stackless pseudo-fiber — the READY queue's
   * FIFO IS the microtask queue, so a closure rides it as a fiber-shaped
   * envelope and scr_resume_fiber runs it on the main stack (a throw is
   * an UNCAUGHT exception, like Node's queueMicrotask, never a
   * rejection). Owned; NULL on real fibers. */
  ScrClosure *micro_cb;
  /* The runtime's OWN stackless envelope, on the same queue: a raw hook
   * plus one owned argument. The native async-generator sink rides it —
   * a settlement that must reach the main stack a microtask turn later
   * has no ScrDyn to box, and boxing one would put a cycle-collected
   * closure on a path the collector never needs to see. Owned: the
   * envelope releases `micro_arg` through `micro_arg_release`. */
  void (*micro_raw)(void *);
  void *micro_arg;
  void (*micro_arg_release)(void *);
#ifdef SCR_ASAN_FIBERS
  void *fake_stack;
#endif
};

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



static ScrCtx scr_loop_ctx; /* the main stack (scheduler home) */
static ScrFiber *scr_current = NULL;
static long scr_fibers_live = 0;
static long scr_fibers_abandoned = 0;

long scr_abandoned_fiber_count(void) { return scr_fibers_abandoned; }

/* True while executing on an async fiber (vs the main stack). The island
 * sizes its engine stack budget per stack: fibers are small and fixed,
 * the main stack is the process's megabytes (scr_island.c isl_entry). */
bool scr_on_fiber(void) { return scr_current != NULL; }
void *scr_fiber_self(void) { return scr_current; }

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

static void scr_timer_push(ScrTimer t) {
  if (scr_ntimers == scr_timers_cap) {
    scr_timers_cap = scr_timers_cap ? scr_timers_cap * 2 : 16;
    scr_timers = realloc(scr_timers, scr_timers_cap * sizeof *scr_timers);
    if (!scr_timers) scr_oom();
  }
  if (t.reffed) scr_reffed_timers++;
  size_t i = scr_ntimers++;
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
  ScrNtick *t = calloc(1, sizeof *t);
  if (!t) scr_oom();
  t->raw = fn;
  if (scr_nt_tail) scr_nt_tail->next = t;
  else scr_nt_head = t;
  scr_nt_tail = t;
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

/* ── context switching (ASan-annotated) ───────────────────────────────── */

#ifdef SCR_ASAN_FIBERS
static void *scr_main_fake_stack; /* fake-stack slot for the main context */
#endif

#ifdef _WIN32
/* The current context's handle, converting the main thread to a fiber on
 * first need (SwitchToFiber requires the caller BE a fiber; the runtime is
 * single-threaded, so one lazy conversion covers the process). Also the
 * loop-home keeper: whenever main is the caller this IS scr_loop_ctx's
 * value — assigned at the conversion so parked fibers can always switch
 * back to it. */
static void *scr_win_self(void) {
  static bool converted = false;
  if (!converted) {
    scr_loop_ctx = ConvertThreadToFiber(NULL);
    if (scr_loop_ctx == NULL) {
      fputs("scriptc: ConvertThreadToFiber failed\n", stderr);
      abort();
    }
    converted = true;
  }
  return GetCurrentFiber();
}
#endif

static void scr_switch(ScrCtx *from, ScrCtx *to, ScrFiber *to_fiber) {
#ifdef SCR_ASAN_FIBERS
  ScrFiber *from_fiber = scr_current;
#endif
  scr_current = to_fiber;
  scr_exc_swap_cell(to_fiber ? &to_fiber->exc : NULL);
  scr_als_active = to_fiber ? &to_fiber->als : &scr_als_main_slot;
#ifdef _WIN32
  /* SwitchToFiber snapshots the outgoing fiber's state inside its own
   * fiber object — `from` has nothing to record. */
  (void)from;
  SwitchToFiber(*to);
#elif defined(SCR_ASAN_FIBERS)
  void **save = from_fiber ? &from_fiber->fake_stack : &scr_main_fake_stack;
  const void *bottom = to_fiber ? to_fiber->st->mem : NULL;
  size_t size = to_fiber ? SCR_FIBER_STACK : 0;
  __sanitizer_start_switch_fiber(save, bottom, size);
  swapcontext(from, to);
  const void *old_bottom;
  size_t old_size;
  __sanitizer_finish_switch_fiber(
      scr_current ? scr_current->fake_stack : scr_main_fake_stack, &old_bottom, &old_size);
#else
  swapcontext(from, to);
#endif
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
    dst->f64 = src->f64;
    dst->b = src->b;
    dst->retain_fn = src->retain_fn;
    dst->release_fn = src->release_fn;
    dst->trace_fn = src->trace_fn;
    dst->payload = NULL;
    if (src->payload_kind == SCR_EXC_STR && src->payload) {
      dst->payload = scr_str_retain((ScrStr *)src->payload);
    } else if ((src->payload_kind == SCR_EXC_REF || src->payload_kind == SCR_EXC_OBJ) &&
               src->payload) {
      dst->payload = src->retain_fn(src->payload);
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
static void scr_promise_settle_wake(ScrPromise *p) {
  for (size_t i = 0; i < p->nwaiters; i++) scr_ready_push(p->waiters[i]);
  p->nwaiters = 0;
  for (size_t i = 0; i < p->ncbs; i++) {
    if (p->cbs[i].all) {
      scr_promise_all_settle(p->cbs[i].all, p->cbs[i].dst, p->cbs[i].all_idx, p);
      scr_promise_all_state_release(p->cbs[i].all);
    } else if (p->state == SCR_PROM_FULFILLED) {
      p->cbs[i].adapt(p->cbs[i].dst, p);
    } else {
      scr_promise_settle_from(p->cbs[i].dst, p);
    }
    scr_promise_release(p->cbs[i].dst);
  }
  p->ncbs = 0;
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
  if (in->ncbs == in->cbs_cap) {
    in->cbs_cap = in->cbs_cap ? in->cbs_cap * 2 : 4;
    in->cbs = realloc(in->cbs, in->cbs_cap * sizeof *in->cbs);
    if (!in->cbs) scr_oom();
  }
  in->cbs[in->ncbs].adapt = adapt;
  in->cbs[in->ncbs].dst = scr_promise_retain(race);
  in->cbs[in->ncbs].all = NULL;
  in->cbs[in->ncbs].all_idx = 0;
  in->ncbs++;
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
      if (in->ncbs == in->cbs_cap) {
        in->cbs_cap = in->cbs_cap ? in->cbs_cap * 2 : 4;
        in->cbs = realloc(in->cbs, in->cbs_cap * sizeof *in->cbs);
        if (!in->cbs) scr_oom();
      }
      in->cbs[in->ncbs].adapt = NULL;
      in->cbs[in->ncbs].dst = scr_promise_retain(result);
      in->cbs[in->ncbs].all = st;
      in->cbs[in->ncbs].all_idx = i;
      in->ncbs++;
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
double scr_promise_payload_f64(ScrPromise *p) { return p->f64; }
bool scr_promise_payload_bool(ScrPromise *p) { return p->b; }
ScrStr *scr_promise_payload_str(ScrPromise *p) {
  return scr_str_retain((ScrStr *)p->payload);
}
/* Thin views for the gated dyn-async TU (scr_async_dyn.c): the payload
 * KIND, whether a REF payload is a dyn value (the dyn adapters), and the
 * settled-await primitive (park/hop + rejection re-throw; true =
 * fulfilled). */
static bool scr_await_settled(ScrPromise *p); /* defined with the await family */
int scr_promise_payload_kind(const ScrPromise *p) { return (int)p->payload_kind; }
bool scr_promise_payload_is_dyn(const ScrPromise *p) { return p->retain_fn == scr_dyn_retain_v; }
double scr_promise_payload_num(const ScrPromise *p) { return p->f64; }
bool scr_promise_payload_flag(const ScrPromise *p) { return p->b; }
bool scr_promise_await_settled(ScrPromise *p) { return scr_await_settled(p); }
void scr_promise_payload_release(const ScrPromise *p, void *v) { p->release_fn(v); }

void *scr_promise_payload_ref(ScrPromise *p) {
  return p->payload ? p->retain_fn(p->payload) : NULL;
}

/* MOVES a pending exception out of `cell` into `p` as its rejection payload
 * (the cell resets to NONE). Shared by fiber completion and the new-Promise
 * executor runners; callers wake waiters themselves. */
static void scr_promise_reject_from_cell(ScrPromise *p, ScrExcCell *cell) {
  p->state = SCR_PROM_REJECTED;
  p->payload_kind = cell->kind;
  p->f64 = cell->f64;
  p->b = cell->b;
  p->payload = cell->payload;
  p->retain_fn = cell->retain_fn;
  p->release_fn = cell->release_fn;
  p->trace_fn = cell->trace_fn;
  cell->kind = SCR_EXC_NONE;
  cell->payload = NULL;
  cell->trace_fn = NULL;
}

static void scr_agen_finish_gen(ScrGen *g, ScrExcCell *cell);
/* Marks a generator handle DONE after its fiber finished on a LOOP resume
 * (async generators only — a sync generator's fiber is only ever resumed
 * from a consumer's stack). Defined with the generator section below,
 * where struct ScrGen is complete. */
static void scr_gen_fiber_completed(ScrGen *g);
/* True for a generator handle created by scr_agen_new (its settle thunk is
 * set) — the one bit that tells the two generator flavours apart on the
 * shared completion path. */
static bool scr_gen_is_async(ScrGen *g);
static void scr_fiber_finish(ScrFiber *self) {
  if (self->gen != NULL) {
    /* Generator completion: the emitted trampoline already stored the
     * completion value (or consumed the GENRET sentinel); a real body
     * exception stays pending in this fiber's cell — the consumer-side
     * resume moves it into the resumer's cell. No promise to settle.
     *
     * An ASYNC generator differs on exactly that last clause: its consumer
     * holds a promise, not a stack frame, so the completion (or the
     * escaping exception) has to settle `pending` HERE — the resumer may
     * be the event loop, which has no call site to propagate into. */
    if (scr_gen_is_async(self->gen)) scr_agen_finish_gen(self->gen, &self->exc);
    self->done = true;
    return;
  }
  ScrPromise *p = self->promise;
  if (scr_exc_pending()) {
    /* The body's exception escaped: the promise rejects with the payload
     * (moved from the fiber's cell into the promise). */
    scr_promise_reject_from_cell(p, &self->exc);
  }
  /* Fulfillment payload was stored by the trampoline before finishing. */
  scr_promise_settle_wake(p);
  self->done = true;
}

#ifdef _WIN32
static void CALLBACK scr_trampoline(void *param) {
  (void)param;
#else
static void scr_trampoline(void) {
#endif
#ifdef SCR_ASAN_FIBERS
  const void *ob;
  size_t os;
  __sanitizer_finish_switch_fiber(scr_current->fake_stack, &ob, &os);
#endif
  /* THE TASK LOOP. A fiber whose body RETURNS is finished and can never
   * be re-entered, which is why this used to be straight-line code and
   * why every async call used to cost a CreateFiber/DeleteFiber pair. A
   * fiber whose body YIELDS instead can be handed a new task forever, so
   * the stack outlives the task that ran on it and goes back in the pool.
   *
   * `self` is dangling the instant control leaves the switch below — the
   * call site frees the ScrFiber and returns the ScrStack to the pool —
   * so every iteration re-reads scr_current and nothing here touches a
   * value carried across the switch. The one thing that does survive is
   * `st`, which is the pooled object itself. */
  ScrStack *st = scr_current->st;
  for (;;) {
    ScrFiber *self = scr_current;
    self->entry(self, self->argpack);
    scr_fiber_finish(self);
    /* Dead TASK, live STACK: hop back to whoever resumed us. The call
     * site frees the fiber and decides whether this stack is pooled. */
    scr_switch(&st->ctx, self->return_to, NULL);
  }
  /* unreachable */
}

/* ── the stack pool ───────────────────────────────────────────────────
 * A free list of idle execution contexts. Every entry is in one of two
 * states and BOTH resume correctly into the task loop: PRISTINE (created
 * and never entered — resuming enters scr_trampoline at the top) or
 * PARKED (its last task finished and the loop yielded — resuming returns
 * from that scr_switch and falls round to the next iteration). Nothing
 * else can reach the pool: a SUSPENDED fiber is never destroyed (loop
 * exhaustion abandons it deliberately), and the stackless microtask
 * envelopes never own a stack at all.
 *
 * The stack is empty in both states, so there is nothing to unwind. The
 * runtime propagates a throw through an exception CELL and an early
 * return, never setjmp/longjmp (scr_runtime.h's `catch` note), so the
 * body's entry call returns normally however it ended and scr_fiber_finish
 * has already moved the payload into the promise.
 *
 * Why a cap: an idle entry keeps its TOUCHED pages resident, which is
 * exactly what removes the faults and exactly what costs RSS. The cap
 * bounds the IDLE set only — a burst that wants more contexts than the cap
 * still gets them, they are just not all kept afterwards.
 *
 * WHERE 64 COMES FROM. Measured on the real zapo messaging bench (the
 * preserved pre-regression TU relinked against this runtime, full default
 * workload, same binary in every arm — only this env knob changes), 2 reps,
 * medians; the A/A floor on that lane is 7.7% on cycles:
 *
 *   cap    send_1to1 Mcyc   recv_group Mcyc   faults      peak RSS
 *     0        63,320           13,597       1,585,510    176.1 MiB
 *     4        37,026            7,896         773,378    178.1 MiB
 *     8        30,505            6,690         617,279    180.0 MiB
 *    16        25,755            5,413         508,602    180.1 MiB
 *    64        21,821            4,178         403,628    182.9 MiB
 *   256        21,239            4,200         374,219    183.4 MiB
 *
 * 64 is the knee: quadrupling it again buys 2.7% more on send_1to1 and
 * nothing at all on recv_group, while every step up costs resident stack.
 * The +6.8 MiB from 0 to 64 is the honest price of the CPU column and it
 * is inside the bench lane's 6.76% RSS noise floor, so it is reported from
 * the monotone trend across six caps rather than from any one pair.
 * SCR_FIBER_POOL=0 turns the pool off entirely (the pre-change runtime,
 * and the A/B control arm). */
#ifndef SCR_FIBER_POOL
#define SCR_FIBER_POOL 64
#endif

static ScrStack *scr_stack_pool = NULL;
static size_t scr_stack_pool_n = 0;

static size_t scr_stack_pool_max(void) {
  static bool once = false;
  static size_t cached = SCR_FIBER_POOL;
  if (!once) {
    const char *env = getenv("SCR_FIBER_POOL");
    if (env != NULL) {
      long v = strtol(env, NULL, 10);
      if (v >= 0) cached = (size_t)v;
    }
    once = true;
  }
  return cached;
}

static void scr_stack_free(ScrStack *s) {
#ifdef _WIN32
  DeleteFiber(s->ctx);
#else
  free(s->mem);
#endif
  free(s);
}

/* A context to run a task on: a pooled one if there is one, otherwise a
 * fresh one. The fresh arm is the code that used to sit inline in
 * scr_async_spawn and scr_gen_new, unchanged. */
static ScrStack *scr_stack_acquire(void) {
  ScrStack *s = scr_stack_pool;
  if (s != NULL) {
    scr_stack_pool = s->next;
    scr_stack_pool_n--;
    s->next = NULL;
    return s;
  }
  s = calloc(1, sizeof *s);
  if (!s) scr_oom();
#ifdef _WIN32
  /* NOT lazy, and that mistake cost this runtime its whole page-fault
   * bill: dwStackSize is the initial COMMITTED size, so the old
   * CreateFiber(SCR_FIBER_STACK) committed 256 KiB of demand-zero stack
   * per async CALL. The reserve is unchanged -- 0 means the executable
   * default, which is what CreateFiber used. See SCR_FIBER_COMMIT. */
  s->ctx =
#ifdef SCR_ASAN_FIBERS
      CreateFiber(SCR_FIBER_STACK, scr_trampoline, NULL);
#else
      CreateFiberEx(SCR_FIBER_COMMIT, 0, 0, scr_trampoline, NULL);
#endif
  if (s->ctx == NULL) scr_oom();
#else
  s->mem = malloc(SCR_FIBER_STACK);
  if (!s->mem) scr_oom();
  getcontext(&s->ctx);
  s->ctx.uc_stack.ss_sp = s->mem;
  s->ctx.uc_stack.ss_size = SCR_FIBER_STACK;
  s->ctx.uc_link = NULL;
  makecontext(&s->ctx, scr_trampoline, 0);
#endif
  return s;
}

static void scr_stack_release(ScrStack *s) {
  if (s == NULL) return;
  if (scr_stack_pool_n < scr_stack_pool_max()) {
    s->next = scr_stack_pool;
    scr_stack_pool = s;
    scr_stack_pool_n++;
    return;
  }
  scr_stack_free(s);
}

/* Drops every idle context. Called from the loop's teardown so a run that
 * ends with a warm pool does not read as a leak to the sanitized lane;
 * fibers still in flight are untouched (they are abandoned by design). */
static void scr_fiber_pool_teardown(void) {
  while (scr_stack_pool != NULL) {
    ScrStack *s = scr_stack_pool;
    scr_stack_pool = s->next;
    scr_stack_free(s);
  }
  scr_stack_pool_n = 0;
}

/* Frees a finished fiber's execution resources (the promise release and
 * bookkeeping stay at the call sites). The STACK does not die with the
 * task — it goes back to the pool, which is the whole point; only the
 * overflow past the cap is actually torn down. Releasing a stack whose
 * trampoline is parked is exactly as legal as the DeleteFiber this used to
 * do: a finished fiber has switched away and can never be current. */
static void scr_fiber_destroy(ScrFiber *f) {
  scr_stack_release(f->st);
  scr_als_ctx_release(f->als);
  free(f);
}

/* Spawns and EAGERLY runs an async body until its first suspension (JS's
 * synchronous-prefix rule). Returns the fiber's promise, +1. */
ScrPromise *scr_async_spawn(void (*entry)(ScrFiber *, void *), void *argpack) {
  ScrFiber *f = calloc(1, sizeof *f);
  if (!f) scr_oom();
  f->promise = scr_promise_new();
  f->entry = entry;
  f->argpack = argpack;
  /* AsyncLocalStorage: the child runs in the SPAWNER's context (Node's
   * init-time capture); snapshots are immutable, so a retain suffices. */
  f->als = scr_als_ctx_retain(*scr_als_active);
  scr_fibers_live++;

  f->st = scr_stack_acquire();
#ifdef _WIN32
  ScrCtx here = scr_win_self();
#else
  ucontext_t here;
#endif
  f->return_to = &here;
  ScrFiber *spawner = scr_current;
  scr_switch(&here, &f->st->ctx, f);
  /* back: the fiber suspended or finished. The switch back targeted NULL
   * (the child doesn't know who spawned it), which pointed both the current
   * fiber AND the exception machinery at main — restore the spawner's cell
   * too, or a fiber that eagerly spawned another keeps throwing/catching
   * against main's cell and completes with its own cell empty (a phantom
   * `undefined` rejection while the real payload leaks). */
  scr_current = spawner;
  scr_exc_swap_cell(spawner ? &spawner->exc : NULL);
  scr_als_active = spawner ? &spawner->als : &scr_als_main_slot;
  ScrPromise *result = scr_promise_retain(f->promise);
  if (f->done) {
    scr_promise_release(f->promise);
    scr_fiber_destroy(f);
    scr_fibers_live--;
  }
  return result;
}

/* Parks the current fiber on `p` until it settles. Only fibers await. */
static void scr_await_park(ScrPromise *p) {
  ScrFiber *self = scr_current;
  if (!self) {
    fputs("scriptc: internal error: await outside an async function\n", stderr);
    abort();
  }
  if (p->nwaiters == p->waiters_cap) {
    p->waiters_cap = p->waiters_cap ? p->waiters_cap * 2 : 4;
    p->waiters = realloc(p->waiters, p->waiters_cap * sizeof *p->waiters);
    if (!p->waiters) scr_oom();
  }
  p->waiters[p->nwaiters++] = self;
  scr_switch(&self->st->ctx, self->return_to, NULL);
  /* Resumed by the loop: return_to must now point at the loop's context. */
}

/* One microtask hop: park the current fiber on the READY queue itself and
 * yield. JS's `await` ALWAYS suspends — even on an already-settled promise
 * the continuation runs as a microtask — so without this hop an awaiter of
 * a settled promise would continue synchronously inside the spawner,
 * observably earlier than Node (corpus 1428 pins the ordering). */
static void scr_await_yield(void) {
  ScrFiber *self = scr_current;
  if (!self) {
    fputs("scriptc: internal error: await outside an async function\n", stderr);
    abort();
  }
  scr_ready_push(self);
  scr_switch(&self->st->ctx, self->return_to, NULL);
}

/* The emitted promise-or-absent await's unit arm (`await u` where u holds
 * undefined/null): JS awaits non-thenables through exactly one microtask
 * turn — the same hop a settled promise takes. */
void scr_await_hop(void) { scr_await_yield(); }

/* Copies a rejection into the active execution context's exception cell.
 * The payload is RETAINED, not moved — a promise can be awaited more than
 * once, and the executable's top-level completion probe consumes the same
 * settlement from the main stack after the loop drains. */
static void scr_promise_rethrow(ScrPromise *p) {
  switch (p->payload_kind) {
  case SCR_EXC_F64: scr_throw_f64(p->f64); break;
  case SCR_EXC_BOOL: scr_throw_bool(p->b); break;
  case SCR_EXC_STR: scr_throw_str(scr_str_retain((ScrStr *)p->payload)); break;
  case SCR_EXC_REF: scr_throw_ref(p->retain_fn(p->payload), p->retain_fn, p->release_fn, p->trace_fn); break;
  case SCR_EXC_OBJ: scr_throw_obj(p->retain_fn(p->payload), p->retain_fn, p->release_fn, p->trace_fn); break;
  case SCR_EXC_NONE:
  case SCR_EXC_GENRET: /* unreachable: the sentinel never settles a promise */
    scr_throw_str(scr_str_new("undefined", 9));
    break;
  }
}

/* Await result extraction. Rejection re-throws into the awaiter. */
static bool scr_await_settled(ScrPromise *p) {
  if (p->state != SCR_PROM_PENDING) scr_await_yield();
  while (p->state == SCR_PROM_PENDING) scr_await_park(p);
  scr_prom_observe(p);
  if (p->state == SCR_PROM_REJECTED) {
    scr_promise_rethrow(p);
    return false;
  }
  return true;
}

double scr_await_f64(ScrPromise *p) {
  return scr_await_settled(p) ? p->f64 : 0;
}
bool scr_await_bool(ScrPromise *p) {
  return scr_await_settled(p) ? p->b : false;
}
void *scr_await_ref(ScrPromise *p) {
  return scr_await_settled(p) && p->payload ? p->retain_fn(p->payload) : NULL;
}
void scr_await_void(ScrPromise *p) { scr_await_settled(p); }

/* ECMAScript's INTERNAL module-dependency wait. Unlike a user-authored
 * await, an already-completed dependency does not introduce a promise-job
 * hop: the evaluator continues synchronously into the importer. A pending
 * dependency still parks this module fiber, and rejection propagates into
 * it exactly like an ordinary await. */
void scr_module_await(ScrPromise *p) {
  while (p->state == SCR_PROM_PENDING) scr_await_park(p);
  scr_prom_observe(p);
  if (p->state == SCR_PROM_REJECTED) scr_promise_rethrow(p);
}

int scr_promise_finish_top_level(ScrPromise *p) {
  if (p->state == SCR_PROM_PENDING) {
    /* ECMAScript module evaluation is still pending, but Node's ref'd
     * event-loop work is exhausted. Node exits with its dedicated
     * unsettled-top-level-await status. */
    scr_exit_code_note(13);
    return 13;
  }
  scr_prom_observe(p);
  return p->state == SCR_PROM_REJECTED ? 1 : 0;
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
void scr_promise_fulfill_ref(ScrPromise *p, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  if (p->state != SCR_PROM_PENDING) {
    if (release) release(v); /* value was +1 for us; drop it */
    return;
  }
  p->state = SCR_PROM_FULFILLED;
  p->payload_kind = v ? SCR_EXC_REF : SCR_EXC_NONE;
  p->payload = v;
  p->retain_fn = retain;
  p->release_fn = release;
  p->trace_fn = trace;
  scr_promise_settle_wake(p);
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
  p->retain_fn = (void *(*)(void *))scr_str_retain;
  p->release_fn = (void (*)(void *))scr_str_release;
  scr_promise_settle_wake(p);
}
ScrStr *scr_await_str(ScrPromise *p) {
  return scr_await_settled(p) && p->payload ? scr_str_retain((ScrStr *)p->payload) : NULL;
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

static ScrDyn *scr_imm_dyn_thunk(ScrClosure *clo, ScrDyn *const *args, size_t argc) {
  (void)clo;
  if (argc == 0 || args[0]->kind != SCR_DYN_FUNC) {
    static const char msg[] = "The \"callback\" argument must be of type function.";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, sizeof msg - 1, "ERR_INVALID_ARG_TYPE");
    return NULL;
  }
  ScrDyn *rest = scr_dyn_new_arr();
  for (size_t i = 1; i < argc; i++) scr_dyn_arr_push(rest, scr_dyn_retain(args[i]));
  ScrClosure *c = scr_closure_new((void *)scr_imm_dyn_fire, 2);
  c->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(c->caps[0], scr_dyn_retain(args[0]));
  c->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(c->caps[1], rest); /* moves */
  scr_set_immediate(c);
  return scr_dyn_retain(scr_dyn_undefined());
}

ScrDyn *scr_set_immediate_dyn_value(void) {
  return scr_dyn_new_func(scr_closure_new((void *)scr_imm_dyn_thunk, 0), scr_imm_dyn_thunk,
                          1, "(cb,...)", "setImmediate");
}

/* ── queueMicrotask ──────────────────────────────────────────────────
 * The READY queue's FIFO is the microtask queue (promise continuations
 * ride it as parked fibers), so a queueMicrotask callback enters the SAME
 * queue as a stackless envelope — one order across both producers, like
 * V8's single microtask queue. scr_resume_fiber runs the closure on the
 * main stack; a throw is an uncaught exception (Node's queueMicrotask),
 * never a rejection. */
void scr_queue_microtask(ScrClosure *cb) {
  ScrFiber *f = calloc(1, sizeof *f);
  if (!f) scr_oom();
  f->micro_cb = cb; /* ownership moves in */
  scr_ready_push(f);
}

/* The runtime-internal twin: `fn(arg)` on the next microtask turn, with
 * `arg`'s reference moving in (released after fn returns). */
void scr_queue_microtask_raw(void (*fn)(void *), void *arg,
                             void (*arg_release)(void *)) {
  ScrFiber *f = calloc(1, sizeof *f);
  if (!f) scr_oom();
  f->micro_raw = fn;
  f->micro_arg = arg;
  f->micro_arg_release = arg_release;
  scr_ready_push(f);
}

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
#ifdef _WIN32
  /* The loop runs on the main stack; make sure scr_loop_ctx names its
   * fiber handle (a no-op after the first conversion). */
  (void)scr_win_self();
#endif
  f->return_to = &scr_loop_ctx;
  ScrGen *g = f->gen; /* read BEFORE the switch: the finish path clears it */
  scr_switch(&scr_loop_ctx, &f->st->ctx, f);
  if (f->done) {
    if (g != NULL) {
      /* An ASYNC generator body that ran to completion on a LOOP resume
       * (it had parked on an await). The ScrGen owns the fiber, so the
       * async teardown below would free a fiber the handle still points
       * at; hand the handle its own teardown instead. scr_fiber_finish
       * already settled the pending promise. */
      scr_gen_fiber_completed(g);
      scr_fiber_destroy(f);
      scr_fibers_live--;
      return;
    }
    scr_promise_release(f->promise);
    scr_fiber_destroy(f);
    scr_fibers_live--;
  }
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

bool scr_loop_run(ScrPromise *top_level) {
  /* The FIRST checkpoint after the synchronous main body runs promise
   * jobs BEFORE the first tick drain: Node's main-module evaluation is
   * itself awaited (the runMain continuation is a microtask queued after
   * the body's own), so microtasks scheduled during the body beat ticks
   * scheduled during the body exactly once, at startup — differentially
   * pinned. Every later checkpoint drains ticks first. */
  bool first_checkpoint = true;
  bool rejection_failed = false;
  for (;;) {
    if (top_level != NULL && top_level->state == SCR_PROM_REJECTED) break;
    /* process.nextTick callbacks BEFORE promise jobs (Node's checkpoint
     * order): the tick queue to exhaustion, then the microtask queue to
     * exhaustion, and back while either has work — a microtask's
     * nextTick runs before the turn proceeds, but never preempts the
     * microtask queue mid-drain (V8 drains it fully). A tick's uncaught
     * throw ends the loop like any listener's (main reports it). */
    if (!first_checkpoint) {
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
    if (top_level != NULL && top_level->state == SCR_PROM_REJECTED) break;
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
     * collect any cycles the turn left behind. No-op on an empty buffer. */
    scr_collect_cycles();
    /* Stream tick dispatch (scr_stream.c, when linked): the deferred
     * next-tick emissions ('data' flow kicks, 'readable'/'end'/'finish'/
     * 'drain'/'error'/'close') fire now, FIRST — the nextTick station.
     * Listeners may enqueue microtasks or more ticks — restart the turn
     * so those drain first. */
    if (scr_stream_dispatch_fn != NULL) {
      scr_stream_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
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
      if (scr_ready_len > 0) continue;
    }
    /* Net dispatch (scr_net.c, when linked): accepts, arrived data,
     * connect completions, and the deferred listening/error/close emits
     * fire now (macrotasks, like the events hook). Callbacks may enqueue
     * microtasks — restart the turn so those drain first. */
    if (scr_net_dispatch_fn != NULL) {
      scr_net_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_ready_len > 0) continue;
    }
    /* Dgram dispatch (scr_dgram.c, when linked): arrived datagrams and
     * the deferred listening/connect/error/close emits (plus pending
     * dns.lookup callbacks) fire now — the net hook's exact station. */
    if (scr_dgram_dispatch_fn != NULL) {
      scr_dgram_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_ready_len > 0) continue;
    }
    /* WebRTC dispatch (scr_wrtc.c, when linked): one pump of the
     * ICE/DTLS/SCTP transport with the loop's clock, then the events that
     * pump produced - open, message, close, and the four on*statechange
     * handlers - fire now, the dgram hook's exact station. */
    if (scr_wrtc_dispatch_fn != NULL) {
      scr_wrtc_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
      if (scr_ready_len > 0) continue;
    }
    /* Watch dispatch (scr_watch.c, when linked): file events queued on
     * the unit's event backend fire their FSWatcher listeners now — the
     * net hook's exact station. */
    if (scr_watch_dispatch_fn != NULL) {
      scr_watch_dispatch_fn();
      if (scr_exc_pending()) return false; /* uncaught throw in a listener */
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
    double due = scr_ntimers > 0 ? scr_timers[0].deadline_ms : now + SCR_IO_POLL_MS;
    /* An armed island timer (AbortSignal.timeout) caps the sleep: it must
     * fire on time even while the poller waits on socket readiness. */
    if (scr_island_deadline_fn != NULL) {
      double isl_due = scr_island_deadline_fn();
      if (isl_due < due) due = isl_due;
    }
    /* Pending immediates are always-ready work: no sleep — run due timers
     * (Node's timers phase precedes check), then the check phase below. */
    if (scr_pending_immediates > 0) due = now;
    bool evw = scr_events_watching_fn != NULL && scr_events_watching_fn();
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
        scr_sleep_ms(due - now);
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
      if (scr_ready_len > 0) break; /* drain microtasks before more timers */
    }
    /* The check phase: immediates queued BEFORE this phase started run
     * now, FIFO; ones a callback queues wait for the next turn (the end
     * snapshot — Node's once-per-turn rule, so a setImmediate chain can't
     * starve the loop). Cleared slots (cb NULL) skip. Microtasks drain
     * between callbacks, like Node's inter-macrotask checkpoints; a woken
     * fiber restarts the turn first (the timer loop's break above), so the
     * phase only runs on a drained queue. */
    if (scr_ready_len == 0 && scr_pending_immediates > 0) {
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
        while (scr_ready_len > 0) {
          ScrFiber *f = scr_ready[scr_ready_head++];
          scr_ready_len--;
          scr_resume_fiber(f);
        }
        if (top_level != NULL && top_level->state == SCR_PROM_REJECTED) break;
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
  scr_fiber_pool_teardown();
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
  return (ScrPromise *)scr_box_get_ref(self->caps[0]);
}
static void scr_resolve_thunk_f64(ScrClosure *self, double v) {
  ScrPromise *p = scr_resolve_target(self);
  scr_promise_fulfill_f64(p, v);
  scr_promise_release(p);
}
static void scr_resolve_thunk_bool(ScrClosure *self, bool v) {
  ScrPromise *p = scr_resolve_target(self);
  scr_promise_fulfill_bool(p, v);
  scr_promise_release(p);
}
static void scr_resolve_thunk_str(ScrClosure *self, ScrStr *v) {
  ScrPromise *p = scr_resolve_target(self);
  scr_promise_fulfill_str(p, v); /* callee owns its params: moves in */
  scr_promise_release(p);
}
static void scr_resolve_thunk_void(ScrClosure *self) {
  ScrPromise *p = scr_resolve_target(self);
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
  ScrClosure *c = scr_closure_new(fns[kind], 1);
  ScrBox *b = scr_box_new_obj(scr_promise_retain_v, scr_promise_release_v,
                               scr_promise_trace_v);
  scr_box_set_ref(b, scr_promise_retain(p));
  c->caps[0] = b;
  return c;
}

/* Emitted ref-kind resolve thunks call this. */
void scr_resolve_ref_impl(ScrClosure *self, void *v, void *(*retain)(void *), void (*release)(void *), ScrTraceFn trace) {
  ScrPromise *p = scr_resolve_target(self);
  scr_promise_fulfill_ref(p, v, retain, release, trace);
  scr_promise_release(p);
}

/* ── emitter support ──────────────────────────────────────────────────── */

ScrPromise *scr_fiber_promise(ScrFiber *f) { return f->promise; }

/* Generalized resolve construction: `fn` is an emitted thunk with closure
 * calling convention (self, value) that forwards to scr_resolve_ref_impl
 * with the concrete RC helpers. */
ScrClosure *scr_make_resolve_fn(ScrPromise *p, void *fn) {
  ScrClosure *c = scr_closure_new(fn, 1);
  ScrBox *b = scr_box_new_obj(scr_promise_retain_v, scr_promise_release_v,
                               scr_promise_trace_v);
  scr_box_set_ref(b, scr_promise_retain(p));
  c->caps[0] = b;
  return c;
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
  if (p->state != SCR_PROM_PENDING) {
    scr_error_release(reason);
  } else {
    p->state = SCR_PROM_REJECTED;
    p->payload_kind = SCR_EXC_OBJ;
    p->payload = reason; /* ownership moves in */
    p->retain_fn = scr_error_retain_v;
    p->release_fn = scr_error_release_v;
    p->trace_fn = scr_error_trace_arg();
    scr_promise_settle_wake(p);
  }
  scr_promise_release(p);
}

ScrClosure *scr_make_reject(ScrPromise *p) {
  ScrClosure *c = scr_closure_new((void *)&scr_reject_thunk, 1);
  ScrBox *b = scr_box_new_obj(scr_promise_retain_v, scr_promise_release_v,
                               scr_promise_trace_v);
  scr_box_set_ref(b, scr_promise_retain(p));
  c->caps[0] = b;
  return c;
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

struct ScrGen {
  size_t rc;
  ScrFiber *fiber; /* NULL once torn down (done, or unstarted release) */
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

ScrGen *scr_gen_new(void (*entry)(ScrFiber *, void *), void *argpack,
                     void (*drop_args)(void *)) {
  ScrGen *g = calloc(1, sizeof *g);
  if (!g) scr_oom();
  g->rc = 1;
  g->state = SCR_GEN_UNSTARTED;
  g->drop_args = drop_args;
  scr_obj_alloc_note();

  ScrFiber *f = calloc(1, sizeof *f);
  if (!f) scr_oom();
  f->gen = g;
  f->entry = entry;
  f->argpack = argpack; /* owned by the fiber start; drop_args if never started */
  /* AsyncLocalStorage: generator bodies run in their CREATOR's context
   * (the spawn-inheritance stance; resumes swap it active like any
   * fiber switch). */
  f->als = scr_als_ctx_retain(*scr_als_active);
  scr_fibers_live++;
  f->st = scr_stack_acquire();
  g->fiber = f;
  return g;
}

ScrGen *scr_gen_retain(ScrGen *g) {
  if (g) g->rc++;
  return g;
}

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
  if (g->fiber != NULL) {
    if (g->state == SCR_GEN_UNSTARTED) {
      /* Never ran: nothing on the stack owns anything — clean teardown.
       * The packed arguments (+1 each) drop through the emitted helper. */
      if (g->drop_args != NULL) g->drop_args(g->fiber->argpack);
      else free(g->fiber->argpack);
      scr_fiber_destroy(g->fiber);
      scr_fibers_live--;
    } else {
      /* Suspended: the stack holds live locals — unwinding would run user
       * finally blocks Node's GC never runs, so the fiber is deliberately
       * ABANDONED (it stays in the live count; a program that drops a
       * suspended generator gets the abandoned-fiber audit note, the
       * loop-exhaustion story). The fiber's back-pointer clears so a
       * dangling resume can never reach the freed ScrGen. */
      g->fiber->gen = NULL;
    }
  }
  scr_obj_free_note();
  free(g);
}

void *scr_gen_retain_v(void *g) { return scr_gen_retain((ScrGen *)g); }
void scr_gen_release_v(void *g) { scr_gen_release((ScrGen *)g); }

bool scr_gen_done(ScrGen *g) { return g->state == SCR_GEN_DONE; }
ScrGen *scr_gen_of_fiber(ScrFiber *f) { return f->gen; }

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

/* The running fiber's generator — the body-side helpers' anchor. */
static ScrGen *scr_gen_self(void) {
  ScrGen *g = scr_current != NULL ? scr_current->gen : NULL;
  if (g == NULL) {
    fputs("scriptc: internal error: yield outside a generator\n", stderr);
    abort();
  }
  return g;
}

double scr_gen_take_in_f64(void) { return scr_gen_slot_take_f64(&scr_gen_self()->in); }
bool scr_gen_take_in_bool(void) { return scr_gen_slot_take_bool(&scr_gen_self()->in); }
void *scr_gen_take_in_ref(void) { return scr_gen_slot_take_ref(&scr_gen_self()->in); }

/* yield: park the value in OUT and hop back to the resumer. Control
 * returns here at the next resume — possibly with an injected .throw
 * payload or the GENRET sentinel pending (the emitted check handles it). */
static void scr_gen_yield_switch(void) {
  ScrFiber *self = scr_current;
  scr_switch(&self->st->ctx, self->return_to, NULL);
}
void scr_gen_yield_f64(double v) {
  scr_gen_slot_f64(&scr_gen_self()->out, v);
  scr_gen_yield_switch();
}
void scr_gen_yield_bool(bool v) {
  scr_gen_slot_bool(&scr_gen_self()->out, v);
  scr_gen_yield_switch();
}
void scr_gen_yield_ref(void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&scr_gen_self()->out, v, release);
  scr_gen_yield_switch();
}

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

static void scr_gen_fiber_completed(ScrGen *g) {
  g->state = SCR_GEN_DONE;
  g->fiber = NULL;
}

static bool scr_gen_is_async(ScrGen *g) { return g->settle != NULL; }

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

ScrGen *scr_agen_new(void (*entry)(ScrFiber *, void *), void *argpack,
                     void (*drop_args)(void *),
                     void (*settle)(ScrGen *, ScrPromise *)) {
  ScrGen *g = scr_gen_new(entry, argpack, drop_args);
  g->settle = settle;
  return g;
}

/* The consumer->fiber hop for an async generator. Unlike the synchronous
 * scr_gen_switch_in this never moves an exception into the resumer: an
 * async generator reports failure through its promise, never by throwing
 * at the .next() call site. */
static void scr_agen_switch_in(ScrGen *g) {
  ScrFiber *f = g->fiber;
  scr_gen_retain(g);
  g->state = SCR_GEN_RUNNING;
#ifdef _WIN32
  ScrCtx here = scr_win_self();
#else
  ucontext_t here;
#endif
  f->return_to = &here;
  ScrFiber *me = scr_current;
  scr_switch(&here, &f->st->ctx, f);
  scr_current = me;
  scr_exc_swap_cell(me != NULL ? &me->exc : NULL);
  if (f->done) {
    /* Completed synchronously inside this resume; scr_fiber_finish already
     * settled the promise. */
    scr_gen_fiber_completed(g);
    scr_fiber_destroy(f);
    scr_fibers_live--;
  } else {
    /* Either parked at a yield (promise already settled) or parked on an
     * await (promise still pending, fiber owned by the loop). Both read as
     * SUSPENDED to a later resume, and a later resume cannot happen before
     * the promise settles because the consumer awaits it. */
    g->state = SCR_GEN_SUSPENDED;
  }
  scr_gen_release(g);
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
  scr_agen_switch_in(g);
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
    if (g->drop_args != NULL) g->drop_args(g->fiber->argpack);
    else free(g->fiber->argpack);
    scr_fiber_destroy(g->fiber);
    g->fiber = NULL;
    scr_fibers_live--;
    g->state = SCR_GEN_DONE;
    scr_gen_ret_to_out(g);
    scr_agen_sink_schedule(g);
    return;
  default:
    if (g->fiber->exc.kind == SCR_EXC_NONE) g->fiber->exc.kind = SCR_EXC_GENRET;
    scr_agen_switch_in(g);
    return;
  }
}

void scr_agen_throw_native(ScrGen *g, ScrAgenSink sink, void *ctx) {
  ScrExcCell *mine = scr_exc_current_cell();
  scr_agen_native_arm(g, sink, ctx);
  if (g->state == SCR_GEN_DONE || g->state == SCR_GEN_UNSTARTED) {
    /* The body never sees it and the REQUEST fails with the payload —
     * exactly what scr_agen_throw does, minus the promise. */
    if (g->state == SCR_GEN_UNSTARTED) {
      if (g->drop_args != NULL) g->drop_args(g->fiber->argpack);
      else free(g->fiber->argpack);
      scr_fiber_destroy(g->fiber);
      g->fiber = NULL;
      scr_fibers_live--;
      g->state = SCR_GEN_DONE;
    }
    scr_exc_cell_move(&g->fail, mine);
    scr_agen_sink_schedule(g);
    return;
  }
  scr_exc_cell_move(&g->fiber->exc, mine);
  scr_agen_switch_in(g);
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
  scr_agen_switch_in(g);
  return p;
}

ScrPromise *scr_agen_return(ScrGen *g) {
  switch (g->state) {
  case SCR_GEN_DONE:
    scr_gen_ret_to_out(g);
    return scr_agen_settled_done(g);
  case SCR_GEN_UNSTARTED: {
    /* The body never runs: tear the fiber down cleanly (drop the packed
     * arguments) and complete with the parked value. */
    if (g->drop_args != NULL) g->drop_args(g->fiber->argpack);
    else free(g->fiber->argpack);
    scr_fiber_destroy(g->fiber);
    g->fiber = NULL;
    scr_fibers_live--;
    g->state = SCR_GEN_DONE;
    scr_gen_ret_to_out(g);
    return scr_agen_settled_done(g);
  }
  default: {
    ScrPromise *p = scr_agen_arm(g);
    if (g->fiber->exc.kind == SCR_EXC_NONE) g->fiber->exc.kind = SCR_EXC_GENRET;
    scr_agen_switch_in(g);
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
    if (g->state == SCR_GEN_UNSTARTED) {
      if (g->drop_args != NULL) g->drop_args(g->fiber->argpack);
      else free(g->fiber->argpack);
      scr_fiber_destroy(g->fiber);
      g->fiber = NULL;
      scr_fibers_live--;
      g->state = SCR_GEN_DONE;
    }
    ScrPromise *p = scr_promise_new();
    scr_promise_reject_from_cell(p, mine);
    scr_promise_settle_wake(p);
    return p;
  }
  default: {
    ScrPromise *p = scr_agen_arm(g);
    ScrExcCell *dst = &g->fiber->exc;
    dst->kind = mine->kind;
    dst->f64 = mine->f64;
    dst->b = mine->b;
    dst->payload = mine->payload;
    dst->retain_fn = mine->retain_fn;
    dst->release_fn = mine->release_fn;
    dst->trace_fn = mine->trace_fn;
    mine->kind = SCR_EXC_NONE;
    mine->payload = NULL;
    mine->trace_fn = NULL;
    scr_agen_switch_in(g);
    return p;
  }
  }
}

/* yield, body side. JS's AsyncGeneratorYield awaits its operand before
 * answering the request, which is one microtask turn even for a plain
 * value — that hop is why awaiting g.next() costs exactly one turn more
 * than awaiting a plain async call (measured against Node v25.9.0, not
 * assumed). Taking it here, BEFORE settling, is also what lets the
 * consumer's own await park first, so the settlement always wakes a
 * waiter rather than racing one. */
static void scr_agen_yield_settle(void) {
  ScrGen *g = scr_gen_self();
  scr_await_hop();
  if (g->sink != NULL) {
    /* A NATIVE consumer: the value stays in OUT and the envelope hands it
     * over on the NEXT microtask turn, on the main stack. Calling the sink
     * from here would run it on this fiber's stack, inside the yield —
     * and a stream sink pulls again, which would re-enter the very
     * generator that is suspended one frame below. */
    scr_agen_sink_schedule(g);
    scr_gen_yield_switch();
    return;
  }
  ScrPromise *p = g->pending;
  g->pending = NULL;
  if (p != NULL) {
    g->settle(g, p); /* { value: OUT, done: false } — state is not DONE */
    scr_promise_release(p);
  } else {
    scr_gen_slot_reset(&g->out);
  }
  scr_gen_yield_switch();
}

void scr_agen_yield_f64(double v) {
  scr_gen_slot_f64(&scr_gen_self()->out, v);
  scr_agen_yield_settle();
}
void scr_agen_yield_bool(bool v) {
  scr_gen_slot_bool(&scr_gen_self()->out, v);
  scr_agen_yield_settle();
}
void scr_agen_yield_ref(void *v, void (*release)(void *)) {
  scr_gen_slot_ref(&scr_gen_self()->out, v, release);
  scr_agen_yield_settle();
}

/* The consumer→fiber hop shared by every resume mode: switches in, and on
 * the way back moves a pending body exception into the RESUMER's cell
 * (synchronous propagation — the await-rethrow analog) and tears down a
 * finished fiber. The gen is retained across the hop so a body that
 * releases the consumer's last reference cannot free it mid-run. */
static void scr_gen_switch_in(ScrGen *g) {
  ScrFiber *f = g->fiber;
  scr_gen_retain(g);
  g->state = SCR_GEN_RUNNING;
#ifdef _WIN32
  ScrCtx here = scr_win_self();
#else
  ucontext_t here;
#endif
  f->return_to = &here;
  ScrFiber *me = scr_current;
  scr_switch(&here, &f->st->ctx, f);
  /* Back on the consumer: restore identity + the consumer's cell (the
   * yield/finish switch targeted NULL — main's cell). */
  scr_current = me;
  scr_exc_swap_cell(me != NULL ? &me->exc : NULL);
  if (f->done) {
    g->state = SCR_GEN_DONE;
    if (f->exc.kind != SCR_EXC_NONE) {
      /* The body's exception escaped: move it into the resumer's cell
       * (replace semantics match a throw at the resume site; the resumer's
       * cell is clean here — a pending exception cannot reach a resume). */
      ScrExcCell *mine = scr_exc_current_cell();
      *mine = f->exc;
      f->exc.kind = SCR_EXC_NONE;
      f->exc.payload = NULL;
      f->exc.trace_fn = NULL;
    }
    scr_fiber_destroy(f);
    g->fiber = NULL;
    scr_fibers_live--;
  } else {
    g->state = SCR_GEN_SUSPENDED;
  }
  scr_gen_release(g);
}

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
    scr_gen_switch_in(g);
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
    /* The body never runs: tear the fiber down cleanly (drop the packed
     * arguments) and complete with the parked value. */
    if (g->drop_args != NULL) g->drop_args(g->fiber->argpack);
    else free(g->fiber->argpack);
    scr_fiber_destroy(g->fiber);
    g->fiber = NULL;
    scr_fibers_live--;
    g->state = SCR_GEN_DONE;
    scr_gen_ret_to_out(g);
    return;
  default:
    /* Suspended at a yield: inject the sentinel (an earlier .return whose
     * unwind a finally-yield parked leaves it already set) and resume. */
    if (g->fiber->exc.kind == SCR_EXC_NONE) g->fiber->exc.kind = SCR_EXC_GENRET;
    scr_gen_switch_in(g);
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
    if (g->drop_args != NULL) g->drop_args(g->fiber->argpack);
    else free(g->fiber->argpack);
    scr_fiber_destroy(g->fiber);
    g->fiber = NULL;
    scr_fibers_live--;
    g->state = SCR_GEN_DONE;
    return;
  default: {
    /* Move the caller's pending payload into the fiber's cell (an
     * earlier sentinel parked by a finally-yield is replaced — the
     * injected throw wins, like a throw inside that finally). */
    ScrExcCell *mine = scr_exc_current_cell();
    ScrExcCell *dst = &g->fiber->exc;
    dst->kind = mine->kind;
    dst->f64 = mine->f64;
    dst->b = mine->b;
    dst->payload = mine->payload;
    dst->retain_fn = mine->retain_fn;
    dst->release_fn = mine->release_fn;
    dst->trace_fn = mine->trace_fn;
    mine->kind = SCR_EXC_NONE;
    mine->payload = NULL;
    mine->trace_fn = NULL;
    scr_gen_switch_in(g);
  }
  }
}
