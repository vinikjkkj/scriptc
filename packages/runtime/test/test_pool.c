/* The worker pool (scr_pool.c) on its own: it needs five runtime symbols
 * beyond libc, all supplied below, so a failure here can only mean the pool
 * is wrong. Built plain, with -fsanitize=address, and with
 * -fsanitize=thread (pool.test.ts runs whichever the toolchain links).
 *
 * What it pins:
 *   1. every submitted job runs exactly once and is delivered exactly once,
 *      on the MAIN thread, with the bytes the worker wrote visible;
 *   2. no delivery before the dispatch hook runs, and the wake fd is
 *      readable while completions wait (so the loop's poll(2) sleep ends);
 *   3. a slow job submitted first does not delay a fast one behind it
 *      (completion order, as libuv delivers);
 *   4. jobs finishing while a batch is being delivered wait for the NEXT
 *      dispatch (libuv takes the list once);
 *   5. UV_THREADPOOL_SIZE bounds the concurrency, and a size of 1 runs the
 *      jobs one at a time in submission order;
 *   6. teardown with jobs queued, running and finished-undelivered drops
 *      every undelivered one with ran=false exactly once and never calls
 *      a delivery;
 *   7. cheap jobs run inline (no thread is ever created) yet still arrive
 *      through the done queue, after submit returns.
 * Worker-side state is plain memory: ThreadSanitizer flags any publication
 * the pool's mutex does not order. */
#define _GNU_SOURCE
#include "../src/scr_runtime.h"

#include <poll.h>
#include <sys/wait.h>
#include <pthread.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static int failures;
static const char *g_argv0;
#define CHECK(c)                                                         \
  do {                                                                   \
    if (!(c)) {                                                          \
      failures++;                                                        \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #c);       \
    }                                                                    \
  } while (0)

/* ── the loop-side seam the pool registers into ──────────────────────── */
static bool (*hook_pending)(void);
static void (*hook_dispatch)(void);
static int (*hook_pollfd)(void);
static void (*hook_teardown)(void);
static int hooks_set;
static pthread_t main_thread;
static int callbacks_drained;

void scr_loop_set_pool(bool (*pending)(void), void (*dispatch)(void), int (*pollfd)(void),
                       bool (*wait)(double ms), void (*teardown)(void)) {
  (void)wait;
  hook_pending = pending;
  hook_dispatch = dispatch;
  hook_pollfd = pollfd;
  hook_teardown = teardown;
  hooks_set++;
}
void scr_loop_drain_callback(void) { callbacks_drained++; }
bool scr_loop_stopping(void) { return false; }
static ScrExcCell test_cell; /* kind 0 = none */
ScrExcCell *scr_exc_cur_cell = &test_cell;
void scr_bytes_io_oom(void) { abort(); }

/* promise stand-ins for scr_promise_settle_later: an object that only
 * counts what the pool does to it. */
struct ScrPromise {
  int retains, releases, handled, copied_from_src;
  struct ScrPromise *copy_src;
};
ScrPromise *scr_promise_new(void) { return calloc(1, sizeof(ScrPromise)); }
ScrPromise *scr_promise_retain(ScrPromise *p) { p->retains++; return p; }
void scr_promise_release(ScrPromise *p) { p->releases++; }
void scr_promise_mark_handled(ScrPromise *p) { p->handled++; }
void scr_promise_adapt_copy(ScrPromise *dst, ScrPromise *src) { dst->copy_src = src; src->copied_from_src++; }

/* ── jobs ────────────────────────────────────────────────────────────── */
typedef struct Job {
  ScrWork w;
  int id;
  int sleep_ms;
  int payload; /* written by the worker */
  int ran_count;
  int done_count;
  int dropped_count;
  int done_on_main;
  int seq; /* delivery sequence number */
} Job;

static int delivered_seq;
static int running_now, running_max;
static pthread_mutex_t rm = PTHREAD_MUTEX_INITIALIZER;
static int order_log[4096];
static int order_len;

static void job_run(ScrWork *w) {
  Job *j = (Job *)w;
  pthread_mutex_lock(&rm);
  running_now++;
  if (running_now > running_max) running_max = running_now;
  pthread_mutex_unlock(&rm);
  if (j->sleep_ms > 0) {
    struct timespec ts = {j->sleep_ms / 1000, (long)(j->sleep_ms % 1000) * 1000000L};
    nanosleep(&ts, NULL);
  }
  j->payload = j->id * 7 + 1;
  j->ran_count++;
  pthread_mutex_lock(&rm);
  running_now--;
  pthread_mutex_unlock(&rm);
}

static void job_done(ScrWork *w, bool ran) {
  Job *j = (Job *)w;
  if (ran) {
    j->done_count++;
    j->done_on_main = pthread_equal(pthread_self(), main_thread) ? 1 : 0;
    j->seq = ++delivered_seq;
    if (order_len < 4096) order_log[order_len++] = j->id;
    CHECK(j->payload == j->id * 7 + 1); /* the worker's write is visible */
  } else {
    j->dropped_count++;
  }
}

static Job *mk(int id, int sleep_ms) {
  Job *j = calloc(1, sizeof *j);
  j->w.run = job_run;
  j->w.done = job_done;
  j->id = id;
  j->sleep_ms = sleep_ms;
  return j;
}

static void wait_ready(int ms) {
  struct pollfd p = {hook_pollfd(), POLLIN, 0};
  poll(&p, 1, ms);
}

static void drain_all(size_t want_total_delivered, int timeout_ms) {
  struct timespec t0, t;
  clock_gettime(CLOCK_MONOTONIC, &t0);
  while (hook_pending()) {
    wait_ready(50);
    hook_dispatch();
    clock_gettime(CLOCK_MONOTONIC, &t);
    if ((t.tv_sec - t0.tv_sec) * 1000 + (t.tv_nsec - t0.tv_nsec) / 1000000 > timeout_ms) {
      CHECK(!"drain_all timed out");
      break;
    }
  }
  (void)want_total_delivered;
}

/* 5b, in a fresh process (the size is read at the first submit): a pool of
 * ONE runs jobs one at a time, in submission order. */
static int single_mode(void) {
  setenv("UV_THREADPOOL_SIZE", "1", 1);
  setenv("SCR_WORK_INLINE_US", "0", 1);
  enum { N = 8 };
  Job *js[N];
  for (int i = 0; i < N; i++) {
    js[i] = mk(i, 3);
    scr_work_submit_cost(&js[i]->w, 0.5); /* cheap, but INLINE_US=0 sends it to the worker */
  }
  drain_all(N, 20000);
  CHECK(running_max == 1);
  CHECK(order_len == N);
  for (int i = 0; i < N && i < order_len; i++) CHECK(order_log[i] == i);
  hook_teardown();
  for (int i = 0; i < N; i++) free(js[i]);
  return failures != 0;
}

int main(int argc, char **argv) {
  main_thread = pthread_self();
  g_argv0 = argv[0];
  if (argc > 1 && strcmp(argv[1], "single") == 0) {
    int rc = single_mode();
    if (rc) fprintf(stderr, "single-mode failure(s)\n");
    return rc;
  }
  setenv("UV_THREADPOOL_SIZE", "4", 1);
  setenv("SCR_WORK_INLINE_US", "20", 1);

  /* 7. cheap jobs: inline, no thread, delivered later through the queue. */
  {
    Job *j = mk(1, 0);
    scr_work_submit_cost(&j->w, 0.5);
    CHECK(hooks_set == 1);
    CHECK(j->ran_count == 1); /* ran at submit */
    CHECK(j->done_count == 0); /* delivery waits for the poll station */
    CHECK(hook_pending());
    wait_ready(1000); /* the wake fd is readable: the loop's sleep would end */
    hook_dispatch();
    CHECK(j->done_count == 1 && j->done_on_main == 1);
    CHECK(!hook_pending());
    free(j);
  }

  /* 1+2. 300 threaded jobs from the main thread. */
  {
    enum { N = 300 };
    Job *js[N];
    for (int i = 0; i < N; i++) {
      js[i] = mk(100 + i, 0);
      scr_work_submit(&js[i]->w);
    }
    drain_all(N, 20000);
    for (int i = 0; i < N; i++) {
      CHECK(js[i]->ran_count == 1 && js[i]->done_count == 1 && js[i]->done_on_main == 1);
      free(js[i]);
    }
  }

  /* 5. the pool never runs more than UV_THREADPOOL_SIZE jobs at once. */
  {
    enum { N = 24 };
    Job *js[N];
    running_max = 0;
    for (int i = 0; i < N; i++) {
      js[i] = mk(500 + i, 5);
      scr_work_submit(&js[i]->w);
    }
    drain_all(N, 20000);
    CHECK(running_max >= 2 && running_max <= 4);
    for (int i = 0; i < N; i++) {
      CHECK(js[i]->done_count == 1);
      free(js[i]);
    }
  }

  /* 3. completion order: a slow job first, a fast one behind it. */
  {
    Job *slow = mk(900, 200), *fast = mk(901, 0);
    order_len = 0;
    scr_work_submit(&slow->w);
    scr_work_submit(&fast->w);
    drain_all(2, 20000);
    CHECK(order_len == 2 && order_log[0] == 901 && order_log[1] == 900);
    free(slow);
    free(fast);
  }

  /* 4. a batch is taken once: a job that finishes during delivery waits. */
  {
    Job *a = mk(950, 0), *b = mk(951, 0);
    scr_work_submit(&a->w);
    wait_ready(1000);
    hook_dispatch();
    CHECK(a->done_count == 1 && b->done_count == 0);
    scr_work_submit(&b->w);
    drain_all(1, 20000);
    CHECK(b->done_count == 1 && b->seq > a->seq);
    free(a);
    free(b);
  }

  /* 6. teardown with queued + running + finished-undelivered jobs. */
  {
    enum { N = 12 };
    Job *js[N];
    for (int i = 0; i < N; i++) {
      js[i] = mk(2000 + i, i < 4 ? 60 : 0);
      scr_work_submit(&js[i]->w);
    }
    struct timespec ts = {0, 20 * 1000000L};
    nanosleep(&ts, NULL); /* the four slow ones are running, the rest queued behind them */
    hook_teardown();
    int ran = 0, delivered = 0, dropped = 0;
    for (int i = 0; i < N; i++) {
      CHECK(js[i]->done_count == 0); /* teardown never delivers */
      CHECK(js[i]->dropped_count == 1); /* and drops each exactly once */
      ran += js[i]->ran_count;
      delivered += js[i]->done_count;
      dropped += js[i]->dropped_count;
      free(js[i]);
    }
    CHECK(delivered == 0 && dropped == N);
    CHECK(ran >= 4 && ran <= N); /* running jobs finished; queued ones may or may not have started */
    CHECK(!hook_pending());
  }

  /* 8. no lost wake: with a flood of tiny jobs the sleeping loop must always
   * be woken. The sleep here is poll(2) with a LONG timeout, as the loop's is
   * when it has no timer; a wake lost to the clear-after-swap ordering shows
   * up as a poll that times out while jobs are still outstanding. */
  {
    enum { ROUNDS = 400, BURST = 40 };
    static Job pool_jobs[ROUNDS * BURST];
    int idx = 0;
    int lost = 0;
    for (int r = 0; r < ROUNDS; r++) {
      for (int k = 0; k < BURST; k++) {
        Job *j = &pool_jobs[idx];
        memset(j, 0, sizeof *j);
        j->w.run = job_run;
        j->w.done = job_done;
        j->id = idx++;
        scr_work_submit(&j->w);
      }
      while (hook_pending()) {
        struct pollfd p = {hook_pollfd(), POLLIN, 0};
        int n = poll(&p, 1, 1500);
        if (n == 0) {
          lost++;
          hook_dispatch(); /* recover so the run ends */
          break;
        }
        hook_dispatch();
      }
    }
    CHECK(lost == 0);
    for (int i = 0; i < idx; i++) CHECK(pool_jobs[i].done_count == 1);
  }

  /* 9. settle-later: the pending promise takes the settled one's outcome from
   * the poll station only, the carrier is marked handled at once, and a
   * teardown drops it without copying. */
  {
    ScrPromise *carrier = calloc(1, sizeof *carrier);
    carrier->retains = 1; /* the caller's +1, consumed by settle_later */
    ScrPromise *dst = scr_promise_settle_later(carrier);
    CHECK(carrier->handled == 1);
    CHECK(dst->copy_src == NULL); /* nothing delivered before the poll station */
    CHECK(hook_pending());
    wait_ready(1000);
    hook_dispatch();
    CHECK(dst->copy_src == carrier && carrier->copied_from_src == 1);
    CHECK(carrier->releases == 1 && dst->releases == 1); /* the job's own references */
    CHECK(!hook_pending());
    free(carrier);
    free(dst);
    ScrPromise *c2 = calloc(1, sizeof *c2);
    ScrPromise *d2 = scr_promise_settle_later(c2);
    hook_teardown();
    CHECK(d2->copy_src == NULL && c2->releases == 1 && d2->releases == 1);
    free(c2);
    free(d2);
  }

  /* the pool is reusable after a teardown (a resumed loop). */
  {
    Job *j = mk(3000, 0);
    scr_work_submit(&j->w);
    drain_all(1, 20000);
    CHECK(j->done_count == 1);
    free(j);
  }

  hook_teardown();
  {
    pid_t pid = fork();
    if (pid == 0) {
      execl(g_argv0, g_argv0, "single", (char *)NULL);
      _exit(3);
    }
    int st = 0;
    waitpid(pid, &st, 0);
    CHECK(WIFEXITED(st) && WEXITSTATUS(st) == 0);
  }

  if (failures != 0) {
    fprintf(stderr, "%d failure(s)\n", failures);
    return 1;
  }
  fprintf(stderr, "all pool tests passed\n");
  return 0;
}
