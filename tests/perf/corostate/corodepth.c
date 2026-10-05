/* LEAK-4: what the stackless port does to stack-overflow behaviour.
 *
 * THE WORRY was that under stackless there is no stack to overflow, so a
 * recursion node kills with RangeError would run until the heap died. The
 * code says otherwise and this measures it.
 *
 * SCR_STACK_LOW() (scr_runtime.h) compares rsp against the TEB's
 * DeallocationStack, GS:[0x1478], READ PER CHECK. 1656267b2 chose it that way
 * deliberately: "Win32 swaps the TEB's stack fields on SwitchToFiber, so the
 * floor is always the running stack's own, while a cached top belongs to
 * whichever stack recorded it." The predicate is therefore not fiber-specific
 * -- it bounds whichever stack is executing. A stackless body runs on the
 * MAIN stack, so the check still fires there; the question is not whether,
 * but AT WHAT DEPTH.
 *
 * So this program measures one recursion, with the emitted prologue's exact
 * predicate, from three places:
 *
 *   1. the main stack directly          -- the baseline the compiler already
 *                                          ships for non-async code
 *   2. inside a FIBER async body        -- today's async behaviour, bounded
 *                                          by SCR_FIBER_RESERVE (1 MiB)
 *   3. inside a STACKLESS frame's body  -- tomorrow's, bounded by the main
 *                                          stack
 *
 * If 3 lands on 1 rather than running away, the port does not remove the
 * RangeError; it moves the async depth from the fiber's bound to the main
 * stack's. That is a divergence in DEPTH, against a baseline that already
 * diverges from node, rather than a new class of divergence.
 */
#include "scr_runtime.h"
#include "scr_coro.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* The emitted prologue, by hand. Codegen puts exactly this predicate at the
 * top of every function computeMayThrow marks, with scr_stack_exhausted() and
 * the function's own unwind in the cold arm. */
static long g_reached;

static long recurse(long d) {
  volatile char frame[16]; /* a real frame, so -O2 cannot turn this into a loop */
  frame[0] = (char)d;
  if (SCR_STACK_LOW()) {
    scr_stack_exhausted(); /* sets the cell and RETURNS -- this runtime's throw */
    g_reached = d;
    return d;
  }
  if (scr_exc_pending()) return d; /* unwinding */
  long r = recurse(d + 1);
  if (frame[0] == (char)0x7f) return r + 1; /* keeps `frame` live */
  return r;
}

static unsigned long long stack_floor_now(void) { return scr_stack_floor(); }
static unsigned long long stack_sp_now(void) { return scr_stack_sp(); }

typedef struct {
  const char *where;
  long depth;
  unsigned long long span; /* sp - floor at entry: the stack actually available */
  bool range_error;
} Shot;

static Shot take(const char *where) {
  unsigned long long sp = stack_sp_now(), fl = stack_floor_now();
  g_reached = -1;
  (void)recurse(0);
  Shot s;
  s.where = where;
  s.depth = g_reached;
  s.span = sp - fl;
  s.range_error = scr_exc_pending();
  scr_exc_clear(); /* so the next shot starts clean */
  return s;
}

static Shot g_main_shot, g_fiber_shot, g_coro_shot;

/* ── the OTHER shape: async recursion, `return await f(n-1)` ───────────
 * node bounds this at ~9,635 and throws RangeError, because calling an async
 * function runs its body synchronously up to the first await, so the chain is
 * real stack recursion.
 *
 * The two scriptc arms do NOT agree about that, and the difference is
 * structural rather than tuned:
 *   - a FIBER spawn SWITCHES to a fresh 1 MiB stack, so the chain is N stacks
 *     of one frame each and no single stack is ever near its floor;
 *   - a STACKLESS spawn runs the callee's prefix on the CALLER's stack, so the
 *     chain is ordinary C recursion and the same SCR_STACK_LOW() check bounds
 *     it.
 * Capped, because the fiber arm has no bound of its own to find. */
#define SPAWN_CAP 150000
static long g_spawn_depth;
static bool g_spawn_capped;

static ScrPromise *spawn_fiber_rec(void);
static ScrPromise *spawn_coro_rec(void);

static void fiber_rec_body(ScrFiber *self, void *ap) {
  (void)ap;
  if (SCR_STACK_LOW()) { scr_stack_exhausted(); return; } /* emitted prologue */
  if (scr_exc_pending()) { return; }
  if (++g_spawn_depth >= SPAWN_CAP) {
    g_spawn_capped = true;
  } else {
    ScrPromise *c = spawn_fiber_rec();
    scr_await_void(c);
    scr_promise_release(c);
  }
  if (!scr_exc_pending()) scr_promise_fulfill_void(scr_fiber_promise(self));
}
static ScrPromise *spawn_fiber_rec(void) {
  return scr_async_spawn(&fiber_rec_body, NULL);
}

typedef struct { ScrCoroBase base; ScrPromise *child; } FrameRec;

static void coro_rec_body(ScrCoroBase *b) {
  FrameRec *f = (FrameRec *)b;
  if (f->base.state == 1) goto RESUME;
  if (SCR_STACK_LOW()) { scr_stack_exhausted(); scr_coro_finish_throw(b); return; }
  if (scr_exc_pending()) { scr_coro_finish_throw(b); return; }
  if (++g_spawn_depth >= SPAWN_CAP) { g_spawn_capped = true; scr_coro_finish_void(b); return; }
  f->child = spawn_coro_rec();
  if (scr_exc_pending()) { scr_promise_release(f->child); f->child = NULL; scr_coro_finish_throw(b); return; }
  f->base.state = 1;
  scr_coro_park(b, f->child);
  return;
RESUME:
  scr_coro_take_void(b, f->child);
  scr_promise_release(f->child);
  f->child = NULL;
  if (scr_exc_pending()) { scr_coro_finish_throw(b); return; }
  scr_coro_finish_void(b);
}
static ScrPromise *spawn_coro_rec(void) {
  FrameRec *f = (FrameRec *)scr_coro_alloc(sizeof *f, &coro_rec_body, false);
  return scr_coro_spawn(&f->base);
}

static void spawn_shot(const char *where, ScrPromise *(*mk)(void)) {
  g_spawn_depth = 0;
  g_spawn_capped = false;
  ScrPromise *p = mk();
  (void)scr_loop_run(p);
  bool range = scr_exc_pending() || scr_coro_promise_rejected(p);
  printf("  %-30s depth %8ld   %s\n", where, g_spawn_depth,
         g_spawn_capped ? "hit the cap -- bound NOT reached, not proven unbounded"
                        : (range ? "RangeError" : "stopped, no RangeError"));
  scr_promise_mark_handled(p);
  scr_promise_release(p);
  scr_exc_clear();
}

/* ── arm 2: inside a fiber async body ─────────────────────────────────── */
static void fiber_body(ScrFiber *self, void *ap) {
  (void)ap;
  g_fiber_shot = take("inside a FIBER async body");
  if (!scr_exc_pending()) scr_promise_fulfill_void(scr_fiber_promise(self));
}

/* ── arm 3: inside a stackless frame's body ───────────────────────────── */
typedef struct { ScrCoroBase base; } FrameDepth;

static void coro_body(ScrCoroBase *b) {
  g_coro_shot = take("inside a STACKLESS frame body");
  scr_coro_finish_void(b);
}

static void report(Shot s) {
  printf("  %-30s depth %8ld   stack span %6.2f MiB   RangeError %s\n",
         s.where, s.depth, (double)s.span / (1024.0 * 1024.0),
         s.range_error ? "YES" : "no");
}

int main(int argc, char **argv) {
  /* UNBUFFERED, and not for tidiness: an arm that dies takes a block-buffered
   * stdout with it, so the whole run looks like it printed nothing. That is
   * exactly what happened at a cap this program could not survive -- the
   * banner was in the buffer, not on the terminal. */
  setvbuf(stdout, NULL, _IONBF, 0);
  const char *only = (argc > 1) ? argv[1] : "all";
  printf("corodepth -- does the stack-overflow RangeError survive the port?\n");
  printf("predicate: SCR_STACK_LOW(), margin %u KiB, TEB GS:[0x1478] read per"
         " check\n\n", (unsigned)(SCR_STACK_MARGIN / 1024u));

  if (strcmp(only, "all") == 0 || strcmp(only, "sync") == 0) {
  printf("1. sync recursion, from three places -- node v25.9.0 bounds this at"
         " ~12,478 everywhere\n");
  g_main_shot = take("on the MAIN stack");

  ScrPromise *p = scr_async_spawn(&fiber_body, NULL);
  (void)scr_loop_run(p);
  scr_promise_release(p);

  FrameDepth *f = (FrameDepth *)scr_coro_alloc(sizeof *f, &coro_body, false);
  ScrPromise *q = scr_coro_spawn(&f->base);
  (void)scr_loop_run(q);
  scr_promise_release(q);

  report(g_main_shot);
  report(g_fiber_shot);
  report(g_coro_shot);
  }

  if (strcmp(only, "fiberrec") == 0 || strcmp(only, "cororec") == 0)
  printf("\n2. async recursion, `return await f(n-1)` -- node v25.9.0 bounds"
         " this at ~9,635\n");

  if (strcmp(only, "fiberrec") == 0) {
    spawn_shot("FIBER spawn recursion", &spawn_fiber_rec);
    return 0;
  }
  if (strcmp(only, "cororec") == 0) {
    spawn_shot("STACKLESS spawn recursion", &spawn_coro_rec);
    return 0;
  }

  printf("\n");
  if (!g_fiber_shot.range_error || !g_coro_shot.range_error) {
    printf("FINDING: a RangeError did NOT fire somewhere -- the port would\n"
           "         turn a bounded recursion into a runaway.\n");
    return 1;
  }
  printf("FINDING: the RangeError fires in BOTH async arms. The port does not\n"
         "         remove it; it moves the async bound from the fiber stack to\n"
         "         the main stack.\n");
  if (g_fiber_shot.depth > 0 && g_coro_shot.depth > 0) {
    printf("         async depth moves %ld -> %ld, a factor of %.1fx\n",
           g_fiber_shot.depth, g_coro_shot.depth,
           (double)g_coro_shot.depth / (double)g_fiber_shot.depth);
  }
  if (g_main_shot.depth > 0 && g_coro_shot.depth > 0) {
    printf("         and the stackless arm lands within %.1f%% of the plain\n"
           "         main-stack depth, which is the baseline non-async code\n"
           "         already ships.\n",
           100.0 * (double)(g_coro_shot.depth - g_main_shot.depth) /
               (double)g_main_shot.depth);
  }
  return 0;
}
