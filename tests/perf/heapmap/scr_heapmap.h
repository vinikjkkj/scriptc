/* scr_heapmap.h -- LAB ONLY. The glibc malloc view of the process heap over time: how much of the brk heap the program HOLDS (uordblks) against how much malloc
 * holds FREE (fordblks: free lists, bins, the top chunk) against how much the heap is in total (arena) and how much of it the kernel could take back (keepcost).
 * Injected with -include through SCRIPTC_PROF_CFLAGS (every TU carries the static code; the data is `selectany`, ONE instance), like scr_prof.h.
 *
 *   TIMELINE   a sampler thread takes mallinfo2() every SCR_HEAPMAP_MS (default 50) milliseconds: "S t_ms arena ordblks smblks hblks hblkhd usmblks fsmblks uordblks fordblks keepcost rss_kb hwm_kb".
 *   HWM        SIGUSR2 (the signal tools/bench ramap.py sends at every rise of the kernel's VmHWM, RAMAP_SIGNAL=USR2) wakes the sampler at once, which takes a sample
 *              tagged "P" (peak instant; the LAST one is the final VmHWM) and, when the heap grew by >= 1 MB since the last dump, rewrites $SCR_HEAPMAP_OUT.peak.xml
 *              with malloc_info(): every bin's free chunk count and size.
 *   EXIT       one "E" sample and $SCR_HEAPMAP_OUT.exit.xml (also on _Exit, which process.exit lowers to).
 *   PLANT      -DSCR_HEAPMAP_PLANT=1: before the first sample, 1024 blocks of exactly 2000 bytes are malloc'd and touched (a 16-byte-rounded chunk of 2016 B each, below the
 *              mmap threshold, so they land in the brk heap): the "S" lines must step by 1024 * 2016 = 2,064,384 B in uordblks between sample 0 ("B", before) and sample 1 ("A", after).
 * The reader is a few lines of awk; nothing is aggregated in C. Sample cost: mallinfo2 walks the bins under the arena lock (a few hundred microseconds on a 12 MB heap). */
#ifndef SCR_HEAPMAP_H
#define SCR_HEAPMAP_H
#define SCR_HEAPMAP 1
#include <malloc.h>
#include <pthread.h>
#include <semaphore.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#include <unistd.h>
__attribute__((weak)) FILE *scr_hm_f;
__attribute__((weak)) sem_t scr_hm_sem;
__attribute__((weak)) volatile int scr_hm_started, scr_hm_done;
__attribute__((weak)) struct timespec scr_hm_t0;
__attribute__((weak)) size_t scr_hm_last_dump_arena;
__attribute__((weak)) void *scr_hm_plant[1024];
static long scr_hm_ms(void) { struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t); return (t.tv_sec - scr_hm_t0.tv_sec) * 1000 + (t.tv_nsec - scr_hm_t0.tv_nsec) / 1000000; }
static void scr_hm_status(long *rss, long *hwm) {
  *rss = *hwm = -1;
  FILE *f = fopen("/proc/self/status", "r");
  if (f == NULL) return;
  char l[256];
  while (fgets(l, sizeof l, f) != NULL) { if (strncmp(l, "VmRSS:", 6) == 0) *rss = atol(l + 6); else if (strncmp(l, "VmHWM:", 6) == 0) *hwm = atol(l + 6); }
  fclose(f);
}
static void scr_hm_dump_xml(const char *suffix) {
  const char *p = getenv("SCR_HEAPMAP_OUT");
  if (p == NULL) return;
  char path[1024];
  snprintf(path, sizeof path, "%s.%s", p, suffix);
  FILE *x = fopen(path, "w");
  if (x == NULL) return;
  malloc_info(0, x);
  fclose(x);
}
static void scr_hm_sample(const char *tag) {
  if (scr_hm_f == NULL) return;
  struct mallinfo2 m = mallinfo2();
  long rss, hwm;
  scr_hm_status(&rss, &hwm);
  fprintf(scr_hm_f, "%s %ld %zu %zu %zu %zu %zu %zu %zu %zu %zu %zu %ld %ld\n", tag, scr_hm_ms(), m.arena, m.ordblks, m.smblks, m.hblks, m.hblkhd, m.usmblks, m.fsmblks, m.uordblks, m.fordblks, m.keepcost, rss, hwm);
  fflush(scr_hm_f);
  if (tag[0] == 'P' && m.arena >= scr_hm_last_dump_arena + (1u << 20)) { scr_hm_last_dump_arena = m.arena; scr_hm_dump_xml("peak.xml"); }
}
static void scr_hm_usr2(int sig) { (void)sig; sem_post(&scr_hm_sem); }
static void *scr_hm_thread(void *arg) {
  (void)arg;
  const char *ms = getenv("SCR_HEAPMAP_MS");
  long period = ms != NULL ? atol(ms) : 50;
  if (period < 5) period = 5;
  for (;;) {
    struct timespec dl;
    clock_gettime(CLOCK_REALTIME, &dl);
    dl.tv_nsec += period * 1000000L;
    dl.tv_sec += dl.tv_nsec / 1000000000L;
    dl.tv_nsec %= 1000000000L;
    int woke = sem_timedwait(&scr_hm_sem, &dl) == 0;
    if (scr_hm_done) return NULL;
    scr_hm_sample(woke ? "P" : "S");
  }
}
static void scr_hm_report(void) {
  static int once = 0;
  if (once++) return;
  scr_hm_done = 1;
  sem_post(&scr_hm_sem);
  scr_hm_sample("E");
  scr_hm_dump_xml("exit.xml");
  if (scr_hm_f != NULL) fclose(scr_hm_f);
  scr_hm_f = NULL;
}
__attribute__((constructor)) static void scr_hm_install(void) {
  if (scr_hm_started) return;
  scr_hm_started = 1;
  clock_gettime(CLOCK_MONOTONIC, &scr_hm_t0);
  const char *p = getenv("SCR_HEAPMAP_OUT");
  scr_hm_f = p != NULL ? fopen(p, "w") : stderr;
  sem_init(&scr_hm_sem, 0, 0);
  scr_hm_sample("B");
#ifdef SCR_HEAPMAP_PLANT
  for (int i = 0; i < 1024; i++) { scr_hm_plant[i] = malloc(2000); memset(scr_hm_plant[i], 0xA5, 2000); }
#endif
  scr_hm_sample("A");
  struct sigaction sa;
  memset(&sa, 0, sizeof sa);
  sa.sa_handler = scr_hm_usr2;
  sigaction(SIGUSR2, &sa, NULL);
  pthread_t th;
  if (pthread_create(&th, NULL, scr_hm_thread, NULL) == 0) pthread_detach(th);
  atexit(scr_hm_report);
}
/* process.exit lowers to _Exit, which skips atexit. The census headers redefine _Exit as a macro that writes THEIR report; this header must not clobber it
 * (the first CI run did, and the census wrote nothing), so it only takes the name when no other header has. The sampler thread flushes every line, so the
 * timeline survives an _Exit; only the final "E" sample and exit.xml are lost on that path. */
#ifndef _Exit
#define _Exit(c) (scr_hm_report(), _Exit(c))
#endif
#endif
