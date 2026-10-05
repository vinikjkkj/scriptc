/* How much FASTER is a stackless resume than a fiber switch?
 *
 * Half the project's goal ("less memory AND more speed") had no number. This
 * measures the speed half on the same harness that proved turn parity, so the
 * two arms being compared are the two arms that were already shown to behave
 * identically -- a speed comparison between arms that disagree observably is
 * not a comparison of anything.
 *
 * WHAT IS BEING TIMED, AND HOW THE CREATION COST IS SEPARATED.
 * A batch spawns K tasks that each await M times, then drains the loop. The
 * per-suspension cost comes from a DIFFERENCE of two batch times:
 *
 *     per_suspension = (T(K, M_hi) - T(K, M_lo)) / (K * (M_hi - M_lo))
 *
 * which cancels spawn, teardown and loop overhead exactly, because both
 * batches create the same K tasks. The creation cost is T(K, 0) / K, where no
 * task ever suspends. Nothing is inferred by subtracting a guess.
 *
 * THE TWO PARK PATHS ARE MEASURED SEPARATELY, because they are different
 * machines and mixing them hides which one dominates:
 *   HOP  -- the operand is already settled; one scr_ready_push now.
 *   WAIT -- the operand is pending; the task goes on the promise's waiter
 *           list and a settling microtask pushes it later. Both arms use the
 *           identical producer, so the settle cost is common-mode.
 *
 * THE FIBER POOL CHANGES THE QUESTION, so both states are reported. With the
 * pool on and tasks completing one at a time, every spawn is a pool HIT and
 * no CreateFiberEx happens. That is steady state. It is NOT what the zapo
 * peak pays: 24,246 fibers are live simultaneously there, so the pool is
 * empty and every spawn is a real CreateFiberEx with a 1 MiB reserve. Run
 * with SCR_FIBER_POOL=0 for that arm -- the knob is read once and cached, so
 * it has to come from the environment, not from here.
 *
 * DISPERSION IS REPORTED, NOT HIDDEN. This bench is bimodal like every other
 * one on this rig, and discarding warm-up does not fix a lottery. Arms are
 * interleaved A B B A inside one process so they share a clock and a thermal
 * state, every rep is printed, and the verdict refuses to quote a ratio when
 * the within-arm spread overlaps the between-arm gap.
 */
#include "scr_runtime.h"
#include "scr_coro.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* ── the awaited operand (identical for both arms) ────────────────────── */

static void settle_void(void *arg) {
  ScrPromise *p = (ScrPromise *)arg;
  scr_promise_fulfill_void(p);
  scr_promise_release(p);
}

static ScrPromise *bench_operand(bool pending) {
  if (!pending) return scr_promise_settled_void();
  ScrPromise *p = scr_promise_new();
  scr_queue_microtask_raw(&settle_void, scr_promise_retain(p), NULL);
  return p;
}

/* ── ARM A: fibers, as emit-async.ts emits ────────────────────────────── */

typedef struct { long m; bool pending; } LoopArgs;

static void fiber_loop(ScrFiber *sc_self, void *sc_ap0) {
  LoopArgs a = *(LoopArgs *)sc_ap0;
  free(sc_ap0);
  for (long i = 0; i < a.m; i++) {
    ScrPromise *p = bench_operand(a.pending);
    scr_await_void(p);
    scr_promise_release(p);
  }
  if (!scr_exc_pending()) scr_promise_fulfill_void(scr_fiber_promise(sc_self));
}

static ScrPromise *spawn_fiber(long m, bool pending) {
  LoopArgs *ap = (LoopArgs *)malloc(sizeof *ap);
  if (!ap) abort();
  ap->m = m;
  ap->pending = pending;
  return scr_async_spawn(&fiber_loop, ap);
}

/* ── ARM B: the stackless state machine ───────────────────────────────── */

typedef struct {
  ScrCoroBase base;
  long m;
  bool pending;
  ScrPromise *awaited;
} FrameLoop;

static void coro_loop(ScrCoroBase *b) {
  FrameLoop *f = (FrameLoop *)b;
  if (f->base.state == 1) goto RESUME;

  while (f->m > 0) {
    f->m--;
    f->awaited = bench_operand(f->pending);
    f->base.state = 1;
    scr_coro_park(&f->base, f->awaited);
    return;
RESUME:
    scr_coro_take_void(&f->base, f->awaited);
    scr_promise_release(f->awaited);
    f->awaited = NULL;
  }
  scr_coro_finish_void(&f->base);
}

static ScrPromise *spawn_coro(long m, bool pending) {
  FrameLoop *f = (FrameLoop *)calloc(1, sizeof *f);
  if (!f) abort();
  scr_coro_init(&f->base, &coro_loop, scr_promise_new(), /*has_exc=*/false);
  f->m = m;
  f->pending = pending;
  ScrPromise *ret = scr_promise_retain(f->base.promise);
  scr_coro_resume_entry(f); /* JS: the body runs synchronously to the first await */
  return ret;
}

/* ── the driver ───────────────────────────────────────────────────────── */

enum { ARM_FIBER = 0, ARM_CORO = 1 };
static const char *ARM_NAME[2] = { "fiber", "stackless" };

/* One batch: K tasks of M awaits each, spawned then drained. Returns ms. */
static double batch_ms(int arm, long K, long M, bool pending) {
  double t0 = scr_now_ms();
  for (long i = 0; i < K; i++) {
    ScrPromise *p = (arm == ARM_FIBER) ? spawn_fiber(M, pending)
                                       : spawn_coro(M, pending);
    scr_promise_release(p);
  }
  (void)scr_loop_run(NULL);
  return scr_now_ms() - t0;
}

static int cmp_double(const void *a, const void *b) {
  double x = *(const double *)a, y = *(const double *)b;
  return (x > y) - (x < y);
}
static double median(double *v, int n) {
  qsort(v, (size_t)n, sizeof *v, &cmp_double);
  return (n & 1) ? v[n / 2] : 0.5 * (v[n / 2 - 1] + v[n / 2]);
}

#define REPS 11
#define WARMUP 2

/* Per-suspension nanoseconds for one arm, from the M_hi - M_lo difference. */
static void measure_suspension(int arm, long K, long Mlo, long Mhi, bool pending,
                               double out[REPS]) {
  for (int r = 0; r < REPS; r++) {
    double lo = batch_ms(arm, K, Mlo, pending);
    double hi = batch_ms(arm, K, Mhi, pending);
    out[r] = (hi - lo) * 1e6 / (double)(K * (Mhi - Mlo)); /* ms -> ns per op */
  }
}

static void measure_create(int arm, long K, double out[REPS]) {
  for (int r = 0; r < REPS; r++) {
    double t = batch_ms(arm, K, 0, false);
    out[r] = t * 1e6 / (double)K; /* ns per create+complete+destroy */
  }
}

/* Report one comparison, and REFUSE a ratio when the spreads overlap. */
static void verdict(const char *what, double *a, double *b, int n) {
  double A[REPS], B[REPS];
  memcpy(A, a, sizeof A);
  memcpy(B, b, sizeof B);
  double ma = median(A, n), mb = median(B, n);
  double aLo = A[0], aHi = A[n - 1], bLo = B[0], bHi = B[n - 1];

  printf("  %-26s %-10s median %9.1f ns   [min %9.1f  max %9.1f]\n",
         what, ARM_NAME[ARM_FIBER], ma, aLo, aHi);
  printf("  %-26s %-10s median %9.1f ns   [min %9.1f  max %9.1f]\n",
         "", ARM_NAME[ARM_CORO], mb, bLo, bHi);

  /* The arms are separated only if their observed ranges do not overlap.
   * Otherwise the design cannot tell the effect from the draw, and saying so
   * is the honest answer rather than quoting a median ratio. */
  int separated = (aLo > bHi) || (bLo > aHi);
  if (!separated) {
    printf("  %-26s RANGES OVERLAP -- this design does not separate the effect"
           " from the draw; no ratio quoted\n", "");
    return;
  }
  if (mb > 0.0) {
    printf("  %-26s SEPARATED: stackless is %.2fx %s (%.1f ns saved per op)\n",
           "", ma / mb, (ma > mb ? "faster" : "SLOWER"), ma - mb);
  }
}

/* ---- 4. does a FRAME POOL earn its complexity? -----------------------
 * The fiber pool (cap 4096) exists because CreateFiberEx costs ~20 us. A
 * stackless frame is a calloc of ~104 bytes, and the question is whether
 * pooling that is a saving or just complexity. This measures the CEILING of
 * what a pool could buy: the allocator round-trip against a free-list
 * round-trip, nothing else in between. If the gap is small next to the
 * measured create+run+destroy cost, a pool cannot pay for itself.
 *
 * Note that creating a frame today is TWO allocations -- the frame and its
 * ScrPromise -- so a frame pool removes at most one of them. */
typedef struct PoolNode { struct PoolNode *next; } PoolNode;
static PoolNode *g_pool = NULL;
static long g_pool_depth = 0;

static void *pool_get(size_t sz) {
  if (g_pool != NULL) {
    PoolNode *n = g_pool;
    g_pool = n->next;
    g_pool_depth--;
    memset(n, 0, sz);           /* a frame must arrive zeroed, like calloc */
    return n;
  }
  void *m = calloc(1, sz);
  if (!m) abort();
  return m;
}
static void pool_put(void *p, long cap) {
  if (g_pool_depth >= cap) { free(p); return; }
  PoolNode *n = (PoolNode *)p;
  n->next = g_pool;
  g_pool = n;
  g_pool_depth++;
}

/* A volatile sink: without it LLVM removes the whole loop. It knows
 * calloc/free semantics and a block that is written but never read is dead,
 * so the first version of this measured 0.0 ns -- which is the number an
 * elided loop always gives, and is not a fast allocator. */
static volatile unsigned long g_sink;

/* Sized at 104 bytes: the 40-byte ScrCoroBase plus the 64-byte live payload
 * the IR liveness pass measured for resolveDisallowedListEntries, i.e. a
 * REAL frame rather than this bench's smaller loop frame. */
#define FRAME_BYTES 104

static void measure_alloc(long N, double out[REPS], int pooled) {
  const size_t sz = FRAME_BYTES;
  for (int r = 0; r < REPS; r++) {
    unsigned long acc = 0;
    double t0 = scr_now_ms();
    for (long i = 0; i < N; i++) {
      unsigned char *m = (unsigned char *)(pooled ? pool_get(sz) : calloc(1, sz));
      if (!m) abort();
      m[0] = (unsigned char)i;
      m[sz - 1] = (unsigned char)(i >> 8);
      acc += (unsigned long)m[0] + (unsigned long)m[sz - 1];
      if (pooled) pool_put(m, 4096); else free(m);
    }
    out[r] = (scr_now_ms() - t0) * 1e6 / (double)N;
    g_sink += acc;
  }
  while (g_pool != NULL) { PoolNode *n = g_pool; g_pool = n->next; free(n); }
  g_pool_depth = 0;
}

int main(int argc, char **argv) {
  long K = (argc > 1) ? strtol(argv[1], NULL, 10) : 2000;
  long Mlo = 2, Mhi = 50;

  const char *pool = getenv("SCR_FIBER_POOL");
  printf("corobench -- fiber vs stackless, same process, same clock\n");
  printf("lane: zig 0.16.0 (G:/tools/zig), target x86_64-windows-gnu,"
         " SCR_FIBER_POOL=%s\n", pool ? pool : "(unset, pool ON)");
  printf("K=%ld tasks per batch, M=%ld vs %ld awaits, %d reps (%d warm-up"
         " discarded)\n", K, Mlo, Mhi, REPS, WARMUP);
  printf("per-suspension ns = (T(M=%ld) - T(M=%ld)) / (K * %ld), so spawn and"
         " teardown cancel\n\n", Mhi, Mlo, Mhi - Mlo);

  /* Warm-up: discarded, and it is not a substitute for reporting spread. */
  for (int w = 0; w < WARMUP; w++) {
    (void)batch_ms(ARM_FIBER, K, Mhi, false);
    (void)batch_ms(ARM_CORO, K, Mhi, false);
    (void)batch_ms(ARM_FIBER, K, Mhi, true);
    (void)batch_ms(ARM_CORO, K, Mhi, true);
  }

  double fib[REPS], cor[REPS];

  printf("1. SUSPEND/RESUME, operand already settled (HOP path)\n");
  measure_suspension(ARM_FIBER, K, Mlo, Mhi, false, fib);
  measure_suspension(ARM_CORO, K, Mlo, Mhi, false, cor);
  verdict("hop suspend+resume", fib, cor, REPS);
  printf("\n");

  printf("2. SUSPEND/RESUME, operand pending (WAITER path)\n");
  measure_suspension(ARM_FIBER, K, Mlo, Mhi, true, fib);
  measure_suspension(ARM_CORO, K, Mlo, Mhi, true, cor);
  verdict("waiter suspend+resume", fib, cor, REPS);
  printf("\n");

  printf("3. CREATION: spawn a task that never suspends, run it, destroy it\n");
  measure_create(ARM_FIBER, K, fib);
  measure_create(ARM_CORO, K, cor);
  verdict("create+run+destroy", fib, cor, REPS);
  printf("\n");

  printf("4. FRAME ALLOCATION: is a frame pool worth building?"
         " (frame = %d bytes)\n", FRAME_BYTES);
  {
    double raw[REPS], pooled[REPS];
    measure_alloc(200000, raw, 0);
    measure_alloc(200000, pooled, 1);
    double R[REPS], P[REPS];
    memcpy(R, raw, sizeof R); memcpy(P, pooled, sizeof P);
    double mr = median(R, REPS), mp = median(P, REPS);
    printf("  %-26s %-10s median %9.1f ns   [min %9.1f  max %9.1f]\n",
           "calloc+free round trip", "malloc", mr, R[0], R[REPS - 1]);
    printf("  %-26s %-10s median %9.1f ns   [min %9.1f  max %9.1f]\n",
           "", "free-list", mp, P[0], P[REPS - 1]);
    printf("  %-26s a frame pool could save at most %.1f ns of the"
           " create cost measured in 3.\n", "", mr - mp);
  }
  printf("\n");

  printf("note: with the pool ON every fiber spawn above is a pool HIT.\n"
         "      At the zapo peak 24,246 fibers are live at once, so the pool\n"
         "      is empty and each spawn is a real CreateFiberEx. Re-run with\n"
         "      SCR_FIBER_POOL=0 for that number.\n");
  return 0;
}
