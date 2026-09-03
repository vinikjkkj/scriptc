/* The Windows backend of the platform readiness contract (scr_platform.h):
 * WSAPoll for socket readiness, deadline bookkeeping for the one-shot
 * timers (no timerfd analogue — scrp_drain expires due keys against the
 * loop's scr_now_ms clock). cc.ts links this TU alongside the kqueue and
 * epoll backends whenever a poller-using unit compiles; each is empty off
 * its platform.
 *
 * Design notes:
 * - Interest lives in the same linear fd -> (mask, udata) table the epoll
 *   backend keeps, but there is no kernel registration at all: every
 *   scrp_drain builds a WSAPOLLFD array from the table and polls it with
 *   a zero timeout. At the units' scale (dozens of sockets) the rebuild
 *   is noise, and it makes forget/close ordering unable to go stale by
 *   construction — an entry gone from the table is gone from the poll.
 * - There is NO pollable poller fd to hand the loop (WSAPoll has no
 *   waitable handle shape): scrp_poller_fd answers -1 and the loop's
 *   win32 idle sleep runs capped (scr_async.c), dispatching at the next
 *   turn's top — readiness latency is bounded by the cap instead of
 *   eliminated by a wake fd. When that cap ever shows up in a profile,
 *   the upgrade path is WSAEventSelect + WaitForMultipleObjects (or
 *   IOCP), which needs a loop-side seam, not a contract change.
 * - POLLHUP/POLLERR report as READABLE (plus WRITABLE when write interest
 *   is armed) exactly like the epoll backend: units learn the truth from
 *   recv()==0 / the socket error. A failed nonblocking connect() reports
 *   through POLLERR/POLLHUP here (WSAPoll delivers those on Win10 19041+;
 *   the box class this lane targets).
 * - fds are winsock SOCKETs narrowed through the units' int fd contract
 *   and widened back here; Windows socket handles fit (kernel handle
 *   space), the same narrowing scr_child.c's stdio plumbing relies on.
 * - WSAStartup: the owning unit (scr_net.c/scr_dgram.c) initializes
 *   winsock before it creates sockets; poller_new also calls it (ref-
 *   counted by the OS) so a poller created first still works. */
#ifdef _WIN32

#include "scr_platform.h"
#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>
#include <winsock2.h>

typedef struct {
  int fd;          /* watched SOCKET (narrowed), or -1 for a timer entry */
  unsigned mask;   /* SCRP_READABLE|SCRP_WRITABLE, or SCRP_TIMER */
  void *udata;     /* delivery tag; for timers: the arm-time udata */
  void *timer_key; /* timers only: the caller's key */
  double deadline; /* timers only: scr_now_ms deadline */
  /* scrp_wait_win32's cached WSAEventSelect handle for this socket, and
   * the SCRP_* mask it was last armed for. Created lazily on the first
   * wait that includes the fd, cancelled and closed when the entry
   * leaves the table (which scrp_forget guarantees happens BEFORE the
   * caller closes the socket). NULL when the wait has never needed it. */
  void *ev;
  unsigned ev_mask;
} ScrpEntry;

struct ScrPoller {
  ScrpEntry *entries;
  size_t n, cap;
  ScrPoller *live_next; /* scrp_live chain — see scrp_wait_win32 */
};

/* Every poller alive right now. The loop's idle wait is process-wide (it
 * sleeps once for the whole turn), so it has to see the net unit's
 * sockets and the dgram unit's together; the units register nothing for
 * it, they just exist. Single-threaded by the same contract the rest of
 * the loop assumes. */
static ScrPoller *scrp_live = NULL;

static ScrpEntry *scrp_find_fd(ScrPoller *p, int fd) {
  for (size_t i = 0; i < p->n; i++)
    if ((p->entries[i].mask & SCRP_TIMER) == 0 && p->entries[i].fd == fd) return &p->entries[i];
  return NULL;
}

static ScrpEntry *scrp_find_key(ScrPoller *p, void *key) {
  for (size_t i = 0; i < p->n; i++)
    if ((p->entries[i].mask & SCRP_TIMER) != 0 && p->entries[i].timer_key == key) return &p->entries[i];
  return NULL;
}

/* Cancel and close an entry's cached wait event. Called on every path
 * that drops an entry, so the association is gone before the owner
 * closes the socket — scrp_forget's existing "MUST precede close(2)"
 * obligation now covers this too. */
static void scrp_drop_event(ScrpEntry *e) {
  if (e->ev == NULL) return;
  if (e->fd >= 0) (void)WSAEventSelect((SOCKET)e->fd, NULL, 0);
  WSACloseEvent((WSAEVENT)e->ev);
  e->ev = NULL;
  e->ev_mask = 0;
}

static void scrp_remove(ScrPoller *p, ScrpEntry *e) {
  size_t i = (size_t)(e - p->entries);
  scrp_drop_event(e);
  p->entries[i] = p->entries[p->n - 1];
  p->n--;
}

static bool scrp_push(ScrPoller *p, ScrpEntry e) {
  if (p->n == p->cap) {
    size_t cap = p->cap == 0 ? 16 : p->cap * 2;
    ScrpEntry *grown = realloc(p->entries, cap * sizeof *grown);
    if (grown == NULL) return false;
    p->entries = grown;
    p->cap = cap;
  }
  p->entries[p->n++] = e;
  return true;
}

ScrPoller *scrp_poller_new(void) {
  WSADATA wsa;
  if (WSAStartup(MAKEWORD(2, 2), &wsa) != 0) return NULL;
  ScrPoller *p = calloc(1, sizeof *p);
  if (p == NULL) {
    WSACleanup();
    return NULL;
  }
  p->live_next = scrp_live;
  scrp_live = p;
  /* Hand the loop its readiness-driven idle wait. Done here rather than
   * from the units so it arrives for net, dgram and watch alike, and so
   * a program that links no poller-using unit never registers it at all
   * (this whole TU is only linked when one compiles). Idempotent. */
  scr_loop_set_netwait(&scrp_wait_win32);
  return p;
}

void scrp_poller_free(ScrPoller *p) {
  if (p == NULL) return;
  for (ScrPoller **q = &scrp_live; *q != NULL; q = &(*q)->live_next) {
    if (*q == p) {
      *q = p->live_next;
      break;
    }
  }
  for (size_t i = 0; i < p->n; i++) scrp_drop_event(&p->entries[i]);
  free(p->entries);
  free(p);
  WSACleanup();
}

int scrp_poller_fd(const ScrPoller *p) {
  (void)p;
  return -1; /* nothing waitable — the loop's capped win32 sleep serves us */
}

static bool scrp_watch(ScrPoller *p, int fd, void *udata, bool on, unsigned bit) {
  ScrpEntry *e = scrp_find_fd(p, fd);
  unsigned mask = e != NULL ? e->mask : 0u;
  unsigned next = on ? (mask | bit) : (mask & ~bit);
  if (e == NULL) {
    if (next == 0) return true; /* unwatch of an unwatched fd: no-op */
    return scrp_push(p, (ScrpEntry){fd, next, udata, NULL, 0, NULL, 0});
  }
  if (next == 0) {
    scrp_remove(p, e);
    return true;
  }
  e->mask = next;
  e->udata = udata; /* last registration wins, both directions */
  return true;
}

bool scrp_watch_read(ScrPoller *p, int fd, void *udata, bool on) {
  return scrp_watch(p, fd, udata, on, SCRP_READABLE);
}

bool scrp_watch_write(ScrPoller *p, int fd, void *udata, bool on) {
  return scrp_watch(p, fd, udata, on, SCRP_WRITABLE);
}

void scrp_forget(ScrPoller *p, int fd) {
  ScrpEntry *e = scrp_find_fd(p, fd);
  if (e != NULL) scrp_remove(p, e);
}

bool scrp_timer_arm(ScrPoller *p, void *key, double ms, void *udata) {
  if (!(ms >= 0)) ms = 0;
  double deadline = scr_now_ms() + ms;
  ScrpEntry *e = scrp_find_key(p, key);
  if (e != NULL) {
    e->deadline = deadline; /* re-arm replaces the deadline */
    e->udata = udata;
    return true;
  }
  return scrp_push(p, (ScrpEntry){-1, SCRP_TIMER, udata, key, deadline, NULL, 0});
}

void scrp_timer_cancel(ScrPoller *p, void *key) {
  ScrpEntry *e = scrp_find_key(p, key);
  if (e != NULL) scrp_remove(p, e); /* unarmed or already fired: no-op */
}

/* Set by scrp_drain whenever it actually delivered something. A skip that
 * follows real progress is a loop that is keeping up, not a loop that is
 * spinning, so it does not count against the ceiling. */
static bool scrp_drain_progress = false;

int scrp_drain(ScrPoller *p, ScrPollerEvent *out, int max) {
  if (max <= 0) return 0;
  int filled = 0;
  /* Due timers first (kqueue delivers EVFILT_TIMER through the same
   * drain); one-shot — the entry leaves the table at delivery. */
  double now = scr_now_ms();
  for (size_t i = 0; i < p->n && filled < max;) {
    ScrpEntry *e = &p->entries[i];
    if ((e->mask & SCRP_TIMER) != 0 && e->deadline <= now) {
      out[filled].udata = e->udata;
      out[filled++].events = SCRP_TIMER;
      scrp_remove(p, e); /* swaps the tail in — revisit index i */
      continue;
    }
    i++;
  }
  /* Socket readiness: poll the whole table with a zero timeout. */
  enum { SCRP_BATCH = 64 };
  WSAPOLLFD pfds[SCRP_BATCH];
  ScrpEntry *owners[SCRP_BATCH];
  ULONG npfds = 0;
  for (size_t i = 0; i < p->n && npfds < SCRP_BATCH; i++) {
    ScrpEntry *e = &p->entries[i];
    if ((e->mask & SCRP_TIMER) != 0) continue;
    pfds[npfds].fd = (SOCKET)e->fd;
    pfds[npfds].events = 0;
    if ((e->mask & SCRP_READABLE) != 0) pfds[npfds].events |= POLLRDNORM;
    if ((e->mask & SCRP_WRITABLE) != 0) pfds[npfds].events |= POLLWRNORM;
    pfds[npfds].revents = 0;
    owners[npfds++] = e;
  }
  if (npfds == 0 || filled >= max) {
    if (filled > 0) scrp_drain_progress = true;
    return filled;
  }
  int n = WSAPoll(pfds, npfds, 0);
  if (n <= 0) {
    if (filled > 0) scrp_drain_progress = true;
    return filled; /* none/failed: a spurious pass */
  }
  for (ULONG i = 0; i < npfds && filled < max; i++) {
    SHORT re = pfds[i].revents;
    if (re == 0) continue;
    ScrpEntry *e = owners[i];
    unsigned got = 0;
    if ((re & (POLLRDNORM | POLLHUP | POLLERR | POLLNVAL)) != 0) got |= SCRP_READABLE;
    if ((re & POLLWRNORM) != 0 || ((re & (POLLHUP | POLLERR | POLLNVAL)) != 0 && (e->mask & SCRP_WRITABLE) != 0))
      got |= SCRP_WRITABLE;
    got &= e->mask | SCRP_READABLE; /* EOF/err always reads; writes only if armed */
    if (got == 0) continue;
    out[filled].udata = e->udata;
    out[filled++].events = got;
  }
  if (filled > 0) scrp_drain_progress = true;
  return filled;
}

/* ── the loop's idle wait ─────────────────────────────────────────────
 *
 * Contract and the measurements behind it are in scr_platform.h.
 *
 * Shape, and why each piece is there:
 *
 * - WSAEventSelect gives a socket a waitable handle. It is EDGE-ish: once
 *   FD_READ is recorded the event stays signalled until it is reset, and
 *   it is re-recorded on arrival and on a recv() that leaves data behind.
 *   Waiting on an un-reset event would therefore return instantly forever
 *   after the first byte a socket ever sees — a 100% CPU spin. So the
 *   events are reset before every wait.
 *
 * - Resetting opens a lost-wakeup window: data that was already sitting
 *   readable had its edge thrown away. A zero-timeout WSAPoll over the
 *   same set closes it — anything present is seen there, anything that
 *   arrives after it records a fresh edge. Nothing can fall between.
 *
 * - When that guard poll finds readiness the turn takes no sleep at all,
 *   which is where the "reply landed while we were computing" case is
 *   won. It is bounded: a socket that is readable and that nobody drains
 *   (or one with write interest armed on an idle send buffer) would spin
 *   the loop, so after SCRP_WAIT_SKIP_MAX consecutive skips the wait is
 *   taken anyway. That ceiling makes the worst case exactly the old
 *   behaviour plus a few turns, never a busy loop.
 *
 * - WaitForMultipleObjects tops out at 64 handles and one is the timer,
 *   so at most 63 sockets get the fast path. Past that the rest still
 *   wake at the caller's cap, which is the latency bound they had before
 *   — no socket is made worse, some are simply not made better.
 *
 * - The deadline arm is a high-resolution waitable timer for the same
 *   reason scr_async.c's sleep uses one: nanosleep ignores the timer
 *   resolution entirely and a WSAPoll timeout rounds up to a 15.4 ms
 *   scheduler tick. Measured, both. */
#define SCRP_WAIT_SKIP_MAX 4

static HANDLE scrp_wait_timer = NULL;
static int scrp_wait_timer_tried = 0;
static int scrp_wait_enabled = -1; /* -1 unread, 0 off, 1 on */
static int scrp_wait_skips = 0;

static long scrp_wait_events_for(unsigned mask) {
  long ev = 0;
  if ((mask & SCRP_READABLE) != 0) ev |= FD_READ | FD_ACCEPT | FD_OOB | FD_CLOSE;
  if ((mask & SCRP_WRITABLE) != 0) ev |= FD_WRITE | FD_CONNECT | FD_CLOSE;
  return ev;
}

bool scrp_wait_win32(double ms) {
  if (scrp_wait_enabled < 0) {
    const char *v = getenv("SCRIPTC_NET_WAIT");
    scrp_wait_enabled = (v != NULL && v[0] == '0' && v[1] == '\0') ? 0 : 1;
  }
  if (scrp_wait_enabled == 0) return false;

  enum { SCRP_WAIT_MAX = MAXIMUM_WAIT_OBJECTS - 1 }; /* the timer takes one */
  HANDLE handles[MAXIMUM_WAIT_OBJECTS];
  WSAPOLLFD pfds[SCRP_WAIT_MAX];
  ULONG n = 0;

  for (ScrPoller *p = scrp_live; p != NULL && n < SCRP_WAIT_MAX; p = p->live_next) {
    for (size_t i = 0; i < p->n && n < SCRP_WAIT_MAX; i++) {
      ScrpEntry *e = &p->entries[i];
      if ((e->mask & SCRP_TIMER) != 0) continue;
      if ((e->mask & (SCRP_READABLE | SCRP_WRITABLE)) == 0) continue;
      if (e->fd < 0) continue;
      if (e->ev == NULL || e->ev_mask != e->mask) {
        if (e->ev == NULL) {
          WSAEVENT h = WSACreateEvent();
          if (h == WSA_INVALID_EVENT) continue;
          e->ev = (void *)h;
        }
        if (WSAEventSelect((SOCKET)e->fd, (WSAEVENT)e->ev,
                           scrp_wait_events_for(e->mask)) != 0) {
          WSACloseEvent((WSAEVENT)e->ev);
          e->ev = NULL;
          e->ev_mask = 0;
          continue;
        }
        e->ev_mask = e->mask;
      }
      WSAResetEvent((WSAEVENT)e->ev);
      handles[n] = (HANDLE)e->ev;
      pfds[n].fd = (SOCKET)e->fd;
      pfds[n].events = 0;
      if ((e->mask & SCRP_READABLE) != 0) pfds[n].events |= POLLRDNORM;
      if ((e->mask & SCRP_WRITABLE) != 0) pfds[n].events |= POLLWRNORM;
      pfds[n].revents = 0;
      n++;
    }
  }
  if (n == 0) return false; /* nothing waitable: the caller sleeps as before */

  /* The reset race guard, and the "it arrived while we computed" win. */
  if (scrp_drain_progress) {
    scrp_drain_progress = false;
    scrp_wait_skips = 0;
  }
  if (WSAPoll(pfds, n, 0) > 0) {
    if (++scrp_wait_skips <= SCRP_WAIT_SKIP_MAX) return true;
  } else {
    scrp_wait_skips = 0;
  }

  if (!scrp_wait_timer_tried) {
    scrp_wait_timer_tried = 1;
    scrp_wait_timer = CreateWaitableTimerExW(NULL, NULL,
                                             CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
                                             TIMER_ALL_ACCESS);
  }
  if (scrp_wait_timer == NULL) return false; /* pre-1803: the old sleep */
  if (!(ms > 0.0)) ms = 0.0;
  double units = ms * 10000.0;
  if (units > 9.0e18) units = 9.0e18;
  LARGE_INTEGER due;
  due.QuadPart = -(LONGLONG)units;
  if (due.QuadPart == 0) due.QuadPart = -1;
  if (!SetWaitableTimer(scrp_wait_timer, &due, 0, NULL, NULL, FALSE)) return false;
  handles[n] = scrp_wait_timer;
  /* Bounded rather than INFINITE for the same reason scr_sleep_ms is: the
   * timer always signals, so the cap only fires if something is wrong and
   * it cannot hang the loop. */
  DWORD cap = (DWORD)(ms + 100.0);
  (void)WaitForMultipleObjects(n + 1, handles, FALSE, cap);
  return true;
}

#else /* !_WIN32 */

/* Empty TU off-Windows: the kqueue and epoll backends carry the POSIX
 * platforms; linking all three everywhere is harmless. */
typedef int scr_loop_wsapoll_unused;

#endif
