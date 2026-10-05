/* Stackless coroutine frames: the runtime half of replacing fibers with
 * state machines.
 *
 * WHY THIS EXISTS. Today every suspended async function owns a real OS
 * stack (scr_async.c, CreateFiberEx). At the documented zapo-rest peak that
 * is 24,246 stacks and 89% of peak private commit, and 12 KiB of every
 * 18 KiB is PAGE_GUARD the process can never use and Windows will not let
 * it lower. A measurement over the typed IR says the live state at a
 * suspension point is 24-208 bytes (p50 32), so the stack is three orders
 * of magnitude larger than the thing it holds. This header is the shape
 * that replaces it.
 *
 * WHAT DOES NOT CHANGE, AND WHY THAT IS THE WHOLE POINT. The scheduler is
 * already representation-agnostic. scr_resume_fiber is a THREE-way dispatch
 * -- raw C envelope, closure envelope, real fiber -- and ScrFiber's own
 * comment says "NULL on the stackless microtask envelopes". The ready
 * queue's FIFO *is* the microtask queue. A coroutine frame is the fourth
 * kind of thing on that queue, and it rides the queue through
 * scr_queue_microtask_raw and the promise waiter list, both of which exist.
 * No scheduler change, no new queue, no second ordering domain.
 *
 * THE INVARIANT THIS FILE IS BUILT TO MAKE PROVABLE BY READING IT:
 *
 *     EXACTLY ONE scr_ready_push PER AWAIT. Never zero, never two.
 *
 * In the fiber runtime that falls out of scr_await_settled (scr_async.c):
 *
 *     if (p->state != PENDING) scr_await_yield();    // settled: one push NOW
 *     while (p->state == PENDING) scr_await_park(p); // pending: zero pushes;
 *                                                    // settle_wake pushes once
 *
 * scr_coro_park below is the same two arms with the same arithmetic, which
 * is why it returns WHICH arm it took: a test can assert the push count
 * against the arm instead of trusting a comment.
 *
 * A NOTE ON THE OBVIOUS-LOOKING SHORTCUT, BECAUSE IT IS WRONG TWICE.
 * ScrPromise carries `ScrPromiseCbWaiter *cbs`, function pointers run at
 * settle, and it looks like the natural place to hang a coroutine resume.
 * It is not. scr_promise_settle_wake runs cbs callbacks SYNCHRONOUSLY,
 * inside the settle, so a resume attached there would consume ZERO microtask
 * turns and run one turn early -- it breaks the one-push invariant by
 * construction. And its dispatch splits on the settlement kind:
 *
 *     else if (p->state == SCR_PROM_FULFILLED) p->cbs[i].adapt(dst, p);
 *     else                                     scr_promise_settle_from(dst, p);
 *
 * the `adapt` hook is not called at all on the rejecting arm, so a rejected
 * await would never resume. The `waiters` list is the correct mechanism: it
 * pushes unconditionally, for both settlement kinds, which is exactly what
 * await means. scr_coro_promise_park (scr_async.c) attaches to THAT, and
 * reuses the existing push site verbatim rather than adding a second one.
 */
#ifndef SCR_CORO_H
#define SCR_CORO_H

#include "scr_runtime.h"

typedef struct ScrCoroBase ScrCoroBase;

/** Re-enter a suspended frame. The generated state machine switches on
 * `self->state` and runs to the next suspension or to completion. */
typedef void (*ScrCoroResume)(ScrCoroBase *self);

/* flags */
enum {
  /** The body ran to completion; `promise` is settled. */
  SCR_CORO_DONE = 1u << 0,
  /** This frame is a ScrCoroExc -- it carries its own ScrExcCell directly
   * after the base. The FLAG is the runtime enumeration of that union. A
   * variant discriminated only by convention is a shape this codebase has
   * already been bitten by, so the discriminant is STORED, never inferred,
   * and scr_coro_exc() is the only legal way to reach the cell. */
  SCR_CORO_HAS_EXC = 1u << 1,
  /** Currently executing: a resume while this is set is a re-entrancy bug. */
  SCR_CORO_RUNNING = 1u << 2,
  /** The last resume returned because it PARKED, not because it finished.
   * scr_coro_park sets it; scr_coro_resume_entry clears it before each
   * re-entry and reads it afterwards to tell "suspended" from "fell out of
   * the body", which are the two ways a resume function can return and which
   * need opposite handling. */
  SCR_CORO_SUSPENDED = 1u << 3,
};

/* The LEAN frame: 40 bytes on x86_64, and it is what D1-D3 suspension
 * points get -- 95.1% of the 2,260 points measured in zapo-rest.
 *
 * There is deliberately NO ScrExcCell here, and the reason is a property
 * rather than a saving. The cell holds an exception IN FLIGHT. A frame needs
 * its own cell only if it can be suspended WHILE one is pending, and that is
 * exactly the D4 condition (a suspension reachable from a finally, or from a
 * try whose finally must still run). A D1-D3 frame runs on the main stack
 * when resumed and borrows the ambient cell for that window, so carrying 56
 * bytes of cell in every frame would pay the worst case on 95% of frames to
 * serve 5%. ScrCoroExc pays it where it is owed.
 *
 * ALS IS NOT PART OF THAT SPLIT, and merging the two would be a silent bug.
 * AsyncLocalStorage context must survive EVERY suspension, D1 included,
 * because scr_switch carried it for free (scr_async.c repoints
 * scr_als_active on every fiber switch). Exceptions and ALS are separable
 * concerns that the fiber mechanism happened to carry together; only one of
 * them is conditional. So `als` lives in the base. */
struct ScrCoroBase {
  ScrCoroResume resume;  /* where to re-enter                          8 */
  ScrPromise   *promise; /* the promise THIS frame settles (owned +1)  8 */
  ScrAlsCtx    *als;     /* INV-5: the frame's ALS context (owned)     8 */
  uint32_t      state;   /* which suspension point to resume at        4 */
  uint32_t      flags;   /* SCR_CORO_*                                 4 */
  size_t        rc;      /* refcount                                   8 */
};                       /*                                      total 40 */

/** The FAT frame (D4): base plus its own exception cell. 40 + 56 = 96.
 * Allocate this only for a function whose census class says a suspension is
 * reachable with an exception pending. */
typedef struct ScrCoroExc {
  ScrCoroBase base;
  ScrExcCell  exc;
} ScrCoroExc;

/** The frame's own cell, or NULL for a lean frame. Reads the stored
 * discriminant; never infers it from a pointer value. */
ScrExcCell *scr_coro_exc(ScrCoroBase *base);

/** Initialise an already-allocated frame. The frame takes ownership of the
 * caller's +1 on `promise` (pass scr_promise_new()). `has_exc` must be true
 * iff `base` is the first member of a ScrCoroExc. Captures the CURRENT ALS
 * context, which is Node's init-time capture and what scr_async_spawn does
 * for a fiber. */
void scr_coro_init(ScrCoroBase *base, ScrCoroResume resume, ScrPromise *promise,
                   bool has_exc);

ScrCoroBase *scr_coro_retain(ScrCoroBase *base);
void         scr_coro_release(ScrCoroBase *base);

/** Which arm scr_coro_park took. Both mean "you are suspended; return to the
 * scheduler now" -- JS's await always yields, even on a settled operand. The
 * distinction is the push accounting, returned so a test can assert it
 * rather than infer it. */
typedef enum {
  /** The operand was already settled: exactly one scr_ready_push happened
   * INSIDE this call (the mandatory one-turn hop). */
  SCR_CORO_PARK_HOP = 0,
  /** The operand was pending: ZERO pushes now; the frame sits on the
   * promise's waiter list and its settle will push exactly once. */
  SCR_CORO_PARK_PENDING = 1,
} ScrCoroParkKind;

/* ---- spawn: what a generated spawn wrapper calls ----------------------
 * The emitted shape mirrors emit-async.ts's fiber path one for one, so the
 * CALL SITE cannot tell the two apart:
 *
 *     ScrPromise *scr_async_f(double a, ScrStr *b) {     // same signature
 *       Frame_f *f = scr_coro_alloc(sizeof *f, &resume_f, false);
 *       f->a = a; f->b = b;                              // the argpack fields
 *       return scr_coro_spawn(&f->base);
 *     }
 *
 * That identity is what makes the hybrid work: a stackless function can call
 * a fiber one and vice versa, because both answer a ScrPromise * and neither
 * caller knows which it got. */

/** Allocate and initialise a frame of `size` bytes (must be at least
 * sizeof(ScrCoroBase), with ScrCoroBase as its FIRST member). The block is
 * zeroed, so generated code only assigns the fields it actually uses. Mints
 * the promise the frame will settle. Returns the frame. */
void *scr_coro_alloc(size_t size, ScrCoroResume resume, bool has_exc);

/** Start a frame and hand back its promise.
 *
 * INV-2: the body runs SYNCHRONOUSLY on the CALLER's stack up to its first
 * suspension, exactly as scr_async_spawn switches into the fiber before
 * returning. An async function that completes without awaiting has already
 * settled its promise by the time this returns, and one that throws before
 * its first await has already REJECTED it -- JS never lets that throw escape
 * to the caller.
 *
 * The returned reference is the caller's to release. */
ScrPromise *scr_coro_spawn(ScrCoroBase *base);

/** Suspend `base` on `p`.
 *
 * Takes a reference on `base` for the duration of the suspension (released
 * on the resume path), so a frame cannot be freed while the queue or a
 * promise still names it. Saves the frame's ALS context and, for a fat
 * frame, its exception cell -- INV-5.
 *
 * ONE scr_ready_push is charged per call, on exactly one of the two arms.
 * The caller MUST return to the scheduler immediately after this returns. */
ScrCoroParkKind scr_coro_park(ScrCoroBase *base, ScrPromise *p);

/** Re-enter the frame: restores ALS and the exception cell (INV-5), clears
 * the suspension's reference, and calls `resume`. This is what the ready
 * queue runs; generated code never calls it. */
void scr_coro_resume_entry(void *base_as_void);

/** Settle this frame's promise and mark it done. Generated code calls one of
 * these on the completion path. */
void scr_coro_finish_void(ScrCoroBase *base);
void scr_coro_finish_f64(ScrCoroBase *base, double v);
void scr_coro_finish_ref(ScrCoroBase *base, void *v, void *(*retain)(void *),
                         void (*release)(void *), ScrTraceFn trace);
/** Completion by rejection, taking the pending exception out of the ACTIVE
 * cell (the frame's own cell for a fat frame, the ambient one otherwise). */
void scr_coro_finish_throw(ScrCoroBase *base);

/** Await result extraction for a RESUMED frame, mirroring scr_await_f64 and
 * friends minus the parking: by the time these run the promise is settled.
 * A rejected promise re-throws into the active cell and returns a zero
 * value, exactly as the fiber forms do. */
double scr_coro_take_f64(ScrCoroBase *base, ScrPromise *p);
bool   scr_coro_take_bool(ScrCoroBase *base, ScrPromise *p);
void  *scr_coro_take_ref(ScrCoroBase *base, ScrPromise *p);  /* +1, NULL on throw */
void   scr_coro_take_void(ScrCoroBase *base, ScrPromise *p);

/* ---- the window onto ScrPromise (implemented in scr_async.c) ----------
 * ScrPromise is opaque outside scr_async.c; these are the only internals a
 * coroutine needs. Declared here rather than in scr_runtime.h so the whole
 * stackless surface is one file to read and one file to revert. */
bool   scr_coro_promise_settled(const ScrPromise *p);
bool   scr_coro_promise_rejected(const ScrPromise *p);
bool   scr_coro_promise_park(ScrPromise *p, void (*fn)(void *), void *arg,
                             void (*arg_release)(void *));
void   scr_coro_promise_observe(ScrPromise *p);
void   scr_coro_promise_rethrow(ScrPromise *p);
double scr_coro_promise_f64(const ScrPromise *p);
bool   scr_coro_promise_bool(const ScrPromise *p);
void  *scr_coro_promise_ref(const ScrPromise *p);

#endif /* SCR_CORO_H */
