/* The worker pool: ONE generic work queue for every async API Node runs on
 * libuv's threadpool (crypto callbacks, zlib async, fs async, dns.lookup).
 *
 * The contract is at the declaration (scr_runtime.h, "the worker pool"):
 * workers touch raw bytes only, the main thread owns every refcount and
 * every JS-visible effect, completions come back through the loop's poll
 * station. This file is the mechanism:
 *
 * - WORKERS are spawned lazily, one per submit while no worker is idle and
 *   fewer than UV_THREADPOOL_SIZE exist (libuv's parse: unset 4, 0 -> 1,
 *   capped at 1024; a negative value is read as 1). A program that never
 *   submits owns no thread, and a light user owns one.
 * - ONE mutex guards both queues. The work queue is FIFO (libuv's wq); the
 *   done queue is in worker COMPLETION order, which is what libuv delivers
 *   (a slow job submitted first does not hold back a fast one behind it).
 * - THE WAKE. A worker signals only on the done queue's empty -> non-empty
 *   edge, and the main drain clears the wake BEFORE it swaps the queue out.
 *   The reverse order loses a wake: a job pushed between the swap and the
 *   clear would find the queue empty (it signals), the clear would eat that
 *   signal, and the job would sit undelivered with nothing to wake the loop.
 *   Linux uses an eventfd, macOS a pipe (both nonblocking, close-on-exec),
 *   Windows a manual-reset Event that the Windows loop waits on.
 * - DELIVERY happens in the loop's poll station: the whole done queue is
 *   taken once (libuv's uv__work_done), each job's `done` runs on the main
 *   thread with the nextTick queue and promise jobs drained between jobs
 *   (Node's MakeCallback scope per completion). Jobs finishing meanwhile
 *   wait for the next poll.
 * - LIVENESS. An undelivered job keeps the loop alive (a libuv request is a
 *   ref'd handle), so exhaustion cannot happen with work outstanding.
 * - EXIT. Teardown mirrors libuv's atexit shutdown: running jobs finish
 *   (bounded), queued-unstarted jobs are dropped, and every undelivered job
 *   gets done(w, false) so its buffers are released and nothing JS-visible
 *   ever runs.
 * - SIGNALS are blocked in workers, so every handler runs on the main thread.
 * - If a thread cannot be created and none exists, the job runs inline on
 *   the main thread and is delivered through the same queue, so the order
 *   and the station never change.
 *
 * Windows uses kernel32 threads, a CRITICAL_SECTION and a CONDITION_VARIABLE
 * (no winpthreads link); everything else uses pthreads (glibc >= 2.34 and
 * macOS carry them in libc, so no -pthread joins the link line). */
#include "scr_runtime.h"

#include <errno.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#if defined(_WIN32)
#include <windows.h>
typedef CRITICAL_SECTION scr_pl_mutex;
typedef CONDITION_VARIABLE scr_pl_cond;
typedef HANDLE scr_pl_thread;
#define SCR_PL_LOCK(m) EnterCriticalSection(m)
#define SCR_PL_UNLOCK(m) LeaveCriticalSection(m)
#else
#include <pthread.h>
#include <signal.h>
#include <unistd.h>
#include <fcntl.h>
#if defined(__linux__)
#include <sys/eventfd.h>
#endif
typedef pthread_mutex_t scr_pl_mutex;
typedef pthread_cond_t scr_pl_cond;
typedef pthread_t scr_pl_thread;
#define SCR_PL_LOCK(m) pthread_mutex_lock(m)
#define SCR_PL_UNLOCK(m) pthread_mutex_unlock(m)
#endif

#define SCR_WORKERS_MAX 1024
#define SCR_WORKER_STACK (1024u * 1024u)

static struct {
  bool inited;
  scr_pl_mutex m;
  scr_pl_cond cv;
  /* guarded by m */
  ScrWork *wq_head, *wq_tail; /* submitted, not started */
  size_t wq_len;
  ScrWork *dq_head, *dq_tail; /* finished, not taken */
  unsigned nthreads;          /* spawned (guarded: spawn is reserved under m) */
  unsigned idle;              /* workers parked in cond_wait */
  bool stop;
  /* main thread only */
  unsigned max;
  double inline_us;
  scr_pl_thread *threads;
  unsigned nspawned;          /* entries valid in threads[] */
  size_t outstanding;         /* submitted - delivered */
  ScrWork *batch_head, *batch_tail; /* taken from dq, `done` not yet run */
#if defined(_WIN32)
  HANDLE ev;
#else
  int wake_r, wake_w; /* eventfd uses wake_r == wake_w */
#endif
} P;

/* ── wake ────────────────────────────────────────────────────────────── */

static void scr_pl_wake(void) {
#if defined(_WIN32)
  SetEvent(P.ev);
#elif defined(__linux__)
  uint64_t one = 1;
  ssize_t r;
  do r = write(P.wake_w, &one, sizeof one);
  while (r < 0 && errno == EINTR);
#else
  char c = 1;
  ssize_t r;
  do r = write(P.wake_w, &c, 1);
  while (r < 0 && errno == EINTR);
#endif
}

static void scr_pl_wake_clear(void) {
#if defined(_WIN32)
  ResetEvent(P.ev);
#else
  char buf[64];
  for (;;) {
    ssize_t r = read(P.wake_r, buf, sizeof buf);
    if (r < 0 && errno == EINTR) continue;
    if (r <= 0 || (size_t)r < sizeof buf) break; /* eventfd answers 8 bytes and is then empty */
  }
#endif
}

/* ── workers ─────────────────────────────────────────────────────────── */

static void scr_pl_push_done_locked(ScrWork *w, bool *was_empty) {
  w->next = NULL;
  *was_empty = P.dq_head == NULL;
  if (P.dq_tail != NULL) P.dq_tail->next = w;
  else P.dq_head = w;
  P.dq_tail = w;
}

#if defined(_WIN32)
static DWORD WINAPI scr_pl_worker(LPVOID arg)
#else
static void *scr_pl_worker(void *arg)
#endif
{
  (void)arg;
  SCR_PL_LOCK(&P.m);
  for (;;) {
    while (P.wq_head == NULL && !P.stop) {
      P.idle++;
#if defined(_WIN32)
      SleepConditionVariableCS(&P.cv, &P.m, INFINITE);
#else
      pthread_cond_wait(&P.cv, &P.m);
#endif
      P.idle--;
    }
    if (P.stop) break; /* queued-unstarted jobs stay for teardown to drop */
    ScrWork *w = P.wq_head;
    P.wq_head = w->next;
    if (P.wq_head == NULL) P.wq_tail = NULL;
    P.wq_len--;
    SCR_PL_UNLOCK(&P.m);
    w->run(w);
    bool was_empty;
    SCR_PL_LOCK(&P.m);
    scr_pl_push_done_locked(w, &was_empty);
    if (was_empty) scr_pl_wake();
  }
  SCR_PL_UNLOCK(&P.m);
  return 0;
}

static bool scr_pl_spawn(void) {
#if defined(_WIN32)
  HANDLE h = CreateThread(NULL, SCR_WORKER_STACK, scr_pl_worker, NULL, STACK_SIZE_PARAM_IS_A_RESERVATION, NULL);
  if (h == NULL) return false;
  P.threads[P.nspawned++] = h;
  return true;
#else
  pthread_attr_t attr;
  if (pthread_attr_init(&attr) != 0) return false;
  pthread_attr_setstacksize(&attr, SCR_WORKER_STACK);
  sigset_t all, old;
  sigfillset(&all);
  pthread_sigmask(SIG_BLOCK, &all, &old); /* the child inherits the blocked mask */
  pthread_t t;
  int rc = pthread_create(&t, &attr, scr_pl_worker, NULL);
  pthread_sigmask(SIG_SETMASK, &old, NULL);
  pthread_attr_destroy(&attr);
  if (rc != 0) return false;
  P.threads[P.nspawned++] = t;
  return true;
#endif
}

/* ── loop hooks (main thread) ────────────────────────────────────────── */

static bool scr_pl_pending(void) { return P.outstanding > 0; }

static int scr_pl_pollfd(void) {
#if defined(_WIN32)
  return -1;
#else
  return P.wake_r;
#endif
}

#if defined(_WIN32)
/* The Windows bounded sleep: the wake Event ends it early. Returns true
 * when it slept (the loop then does not also scr_sleep_ms). */
static bool scr_pl_wait(double ms) {
  if (!(ms > 0)) return true;
  DWORD t = ms >= 4294967294.0 ? INFINITE - 1 : (DWORD)(ms + 0.999);
  WaitForSingleObject(P.ev, t);
  return true;
}
#endif

static void scr_pl_batch_append(ScrWork *head) {
  if (head == NULL) return;
  ScrWork *tail = head;
  while (tail->next != NULL) tail = tail->next;
  if (P.batch_tail != NULL) P.batch_tail->next = head;
  else P.batch_head = head;
  P.batch_tail = tail;
}

static void scr_pl_dispatch(void) {
  if (P.outstanding == 0) return;
  scr_pl_wake_clear(); /* BEFORE the swap: see the header */
  SCR_PL_LOCK(&P.m);
  ScrWork *taken = P.dq_head;
  P.dq_head = P.dq_tail = NULL;
  SCR_PL_UNLOCK(&P.m);
  /* libuv takes the list once: only what was done BEFORE this swap is
   * delivered in this poll, whatever finishes while callbacks run. A
   * remainder left by a throwing callback sits in `batch` ahead of it. */
  scr_pl_batch_append(taken);
  bool first = true;
  while (P.batch_head != NULL) {
    if (!first) {
      scr_loop_drain_callback(); /* ticks, then promise jobs, per completion */
      if (scr_loop_stopping()) return;
    }
    first = false;
    ScrWork *w = P.batch_head;
    P.batch_head = w->next;
    if (P.batch_head == NULL) P.batch_tail = NULL;
    w->next = NULL;
    P.outstanding--;
    w->done(w, true);
    if (scr_exc_pending()) return;
  }
}

static void scr_pl_teardown(void) {
  if (!P.inited) return;
  SCR_PL_LOCK(&P.m);
  P.stop = true;
#if defined(_WIN32)
  WakeAllConditionVariable(&P.cv);
#else
  pthread_cond_broadcast(&P.cv);
#endif
  SCR_PL_UNLOCK(&P.m);
  for (unsigned i = 0; i < P.nspawned; i++) {
#if defined(_WIN32)
    WaitForSingleObject(P.threads[i], INFINITE);
    CloseHandle(P.threads[i]);
#else
    pthread_join(P.threads[i], NULL);
#endif
  }
  P.nspawned = 0;
  P.nthreads = 0;
  P.idle = 0;
  /* Everything undelivered is dropped: queued-unstarted, finished, and the
   * remainder of a batch a throwing callback abandoned. */
  SCR_PL_LOCK(&P.m);
  ScrWork *wq = P.wq_head, *dq = P.dq_head;
  P.wq_head = P.wq_tail = NULL;
  P.dq_head = P.dq_tail = NULL;
  P.wq_len = 0;
  SCR_PL_UNLOCK(&P.m);
  ScrWork *b = P.batch_head;
  P.batch_head = P.batch_tail = NULL;
  ScrWork *lists[3] = {b, dq, wq};
  for (int i = 0; i < 3; i++) {
    for (ScrWork *w = lists[i]; w != NULL;) {
      ScrWork *n = w->next;
      w->done(w, false);
      w = n;
    }
  }
  P.outstanding = 0;
  P.stop = false; /* a later loop (resumed run) may submit again */
}

/* ── submit ──────────────────────────────────────────────────────────── */

static unsigned scr_pl_size(void) {
  const char *v = getenv("UV_THREADPOOL_SIZE");
  long n = 4;
  if (v != NULL) n = atol(v);
  if (n < 1) n = 1;
  if (n > SCR_WORKERS_MAX) n = SCR_WORKERS_MAX;
  return (unsigned)n;
}

static void scr_pl_init(void) {
  P.max = scr_pl_size();
  {
    const char *iv = getenv("SCR_WORK_INLINE_US");
    P.inline_us = iv != NULL ? atof(iv) : 20.0;
  }
  P.threads = calloc(P.max, sizeof *P.threads);
  if (P.threads == NULL) scr_bytes_io_oom();
#if defined(_WIN32)
  InitializeCriticalSection(&P.m);
  InitializeConditionVariable(&P.cv);
  P.ev = CreateEventA(NULL, TRUE, FALSE, NULL);
  if (P.ev == NULL) scr_bytes_io_oom();
#else
  pthread_mutex_init(&P.m, NULL);
  pthread_cond_init(&P.cv, NULL);
#if defined(__linux__)
  int fd = eventfd(0, EFD_NONBLOCK | EFD_CLOEXEC);
  if (fd < 0) scr_bytes_io_oom();
  P.wake_r = P.wake_w = fd;
#else
  int fds[2];
  if (pipe(fds) != 0) scr_bytes_io_oom();
  for (int i = 0; i < 2; i++) {
    fcntl(fds[i], F_SETFD, FD_CLOEXEC);
    fcntl(fds[i], F_SETFL, fcntl(fds[i], F_GETFL) | O_NONBLOCK);
  }
  P.wake_r = fds[0];
  P.wake_w = fds[1];
#endif
#endif
  P.inited = true;
#if defined(_WIN32)
  scr_loop_set_pool(scr_pl_pending, scr_pl_dispatch, scr_pl_pollfd, scr_pl_wait, scr_pl_teardown);
#else
  scr_loop_set_pool(scr_pl_pending, scr_pl_dispatch, scr_pl_pollfd, NULL, scr_pl_teardown);
#endif
}

void scr_work_submit(ScrWork *w) { scr_work_submit_cost(w, 1e18); }

/* Small jobs do not pay a thread hand-off. A futex wake plus the eventfd
 * round trip costs the main thread more than a 16-byte draw does, so a job
 * whose estimated cost is under SCR_WORK_INLINE_US (default 20) runs INLINE
 * at submit, WHEN a worker would have taken it at once anyway (nothing
 * queued ahead of it and a free or spawnable worker: a saturated pool
 * queues it, as Node's does). Nothing observable moves: the job still
 * completes through the done queue and is delivered by the poll station,
 * after the checkpoint that follows the call. SCR_WORK_INLINE_US=0 sends
 * every job to a worker (the tests that pin worker behavior use it). */
void scr_work_submit_cost(ScrWork *w, double est_us) {
  if (!P.inited) scr_pl_init();
  w->next = NULL;
  P.outstanding++;
  SCR_PL_LOCK(&P.m);
  if (est_us < P.inline_us && P.wq_head == NULL && (P.idle > 0 || P.nthreads < P.max)) {
    SCR_PL_UNLOCK(&P.m);
    w->run(w);
    bool was_empty;
    SCR_PL_LOCK(&P.m);
    scr_pl_push_done_locked(w, &was_empty);
    if (was_empty) scr_pl_wake();
    SCR_PL_UNLOCK(&P.m);
    return;
  }
  if (P.wq_tail != NULL) P.wq_tail->next = w;
  else P.wq_head = w;
  P.wq_tail = w;
  P.wq_len++;
  bool spawn = P.wq_len > P.idle && P.nthreads < P.max;
  if (spawn) P.nthreads++;
#if defined(_WIN32)
  WakeConditionVariable(&P.cv);
#else
  pthread_cond_signal(&P.cv);
#endif
  SCR_PL_UNLOCK(&P.m);
  if (!spawn) return;
  if (scr_pl_spawn()) return;
  /* No thread: undo the reservation. With no worker at all the job runs
   * inline and still comes back through the done queue. */
  SCR_PL_LOCK(&P.m);
  P.nthreads--;
  if (P.nthreads > 0) {
    SCR_PL_UNLOCK(&P.m);
    return; /* an existing worker will reach it */
  }
  ScrWork *job = P.wq_head;
  if (job != NULL) {
    P.wq_head = job->next;
    if (P.wq_head == NULL) P.wq_tail = NULL;
    P.wq_len--;
  }
  SCR_PL_UNLOCK(&P.m);
  if (job == NULL) return;
  job->run(job);
  bool was_empty;
  SCR_PL_LOCK(&P.m);
  scr_pl_push_done_locked(job, &was_empty);
  if (was_empty) scr_pl_wake();
  SCR_PL_UNLOCK(&P.m);
}
