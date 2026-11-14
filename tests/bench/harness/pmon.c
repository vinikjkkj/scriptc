/* pmon.c -- Linux external instrument for the zapobench slice.
 *
 *   pmon [-o out.json] [-s sample_us] [-m marker_substring] -- cmd args...
 *
 * fork/exec the lane. The lane's stdout is a pipe that pmon echoes to its own
 * stdout BYTE FOR BYTE (stderr is inherited, untouched). On every stdout line
 * that contains the marker substring (default "[phase-"), pmon records the
 * lane's CPU (utime+stime of the LANE PROCESS ONLY, /proc/<pid>/stat) and
 * VmHWM at that instant, so per-phase CPU is the difference of two marks.
 *
 * What is measured, and how (every number is a floor unless stated):
 *   cpu_self_ms   utime+stime of the lane process alone, read from the ZOMBIE
 *                 after waitid(WNOWAIT): exact at exit, includes every thread.
 *   cpu_kids_ms   cutime+cstime from the same /proc/<pid>/stat read: CPU of
 *                 descendants the lane REAPED (the fake server it spawned, if
 *                 it waited for it). Reported separately, never summed in.
 *   rss_peak_kb   max over samples of VmHWM of the lane process alone (the
 *                 kernel's own high-water mark: a sample only has to land
 *                 anywhere AFTER the peak, so sampling rate matters only for
 *                 a spike in the last sample interval before exit; pmon also
 *                 samples on every marker line and on every pipe wakeup).
 *   rss_peak_ru_kb ru_maxrss from wait4: the max over the lane AND reaped
 *                 descendants. If it exceeds rss_peak_kb a descendant was
 *                 larger (or a spike was missed): both are printed, the
 *                 caller decides.
 *   kids_rss_peak_kb  max VmHWM of any live descendant seen by sampling.
 *   wall_ms       fork to exit.
 * The JSON goes to -o (or stderr if absent). Exit status = the lane's.
 */
#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/time.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#include <dirent.h>

static double now_ms(void) {
  struct timespec t; clock_gettime(CLOCK_MONOTONIC, &t);
  return t.tv_sec * 1e3 + t.tv_nsec / 1e6;
}

static long hz;

/* utime+stime (+ cutime+cstime) in ms from /proc/pid/stat. The comm field may
 * contain spaces and parens: parse after the LAST ')'. */
static int read_stat(pid_t pid, double *self_ms, double *kids_ms, pid_t *ppid) {
  char path[64], buf[1024];
  snprintf(path, sizeof path, "/proc/%d/stat", (int)pid);
  FILE *f = fopen(path, "r");
  if (!f) return -1;
  size_t n = fread(buf, 1, sizeof buf - 1, f);
  fclose(f);
  buf[n] = 0;
  char *p = strrchr(buf, ')');
  if (!p) return -1;
  p += 2; /* state */
  char state; long pp; unsigned long long utime, stime; long long cutime, cstime;
  /* fields after comm: state ppid pgrp session tty tpgid flags minflt cminflt majflt cmajflt utime stime cutime cstime */
  int got = sscanf(p, "%c %ld %*d %*d %*d %*d %*u %*u %*u %*u %*u %llu %llu %lld %lld",
                   &state, &pp, &utime, &stime, &cutime, &cstime);
  if (got != 6) return -1;
  if (self_ms) *self_ms = (double)(utime + stime) * 1000.0 / hz;
  if (kids_ms) *kids_ms = (double)(cutime + cstime) * 1000.0 / hz;
  if (ppid) *ppid = (pid_t)pp;
  return 0;
}

static long read_hwm_kb(pid_t pid) {
  char path[64], line[256];
  snprintf(path, sizeof path, "/proc/%d/status", (int)pid);
  FILE *f = fopen(path, "r");
  if (!f) return -1;
  long v = -1;
  while (fgets(line, sizeof line, f)) {
    if (strncmp(line, "VmHWM:", 6) == 0) { v = strtol(line + 6, NULL, 10); break; }
  }
  fclose(f);
  return v;
}

/* is `pid` a (transitive) descendant of root? walks ppid via /proc */
static int is_desc(pid_t pid, pid_t root) {
  for (int depth = 0; depth < 64 && pid > 1; depth++) {
    pid_t pp = 0;
    if (read_stat(pid, NULL, NULL, &pp) != 0) return 0;
    if (pp == root) return 1;
    pid = pp;
  }
  return 0;
}

static long scan_kids_hwm(pid_t root) {
  long best = 0;
  DIR *d = opendir("/proc");
  if (!d) return 0;
  struct dirent *e;
  while ((e = readdir(d))) {
    if (e->d_name[0] < '1' || e->d_name[0] > '9') continue;
    pid_t p = (pid_t)atoi(e->d_name);
    if (p == root || p == getpid()) continue;
    if (!is_desc(p, root)) continue;
    long h = read_hwm_kb(p);
    if (h > best) best = h;
  }
  closedir(d);
  return best;
}

typedef struct { double t_ms, cpu_ms; long hwm_kb; char *line; } Mark;
static Mark *marks; static int nmarks, capmarks;

int main(int argc, char **argv) {
  const char *out = NULL; long sample_us = 4000; const char *marker = "[phase-";
  int i = 1;
  for (; i < argc; i++) {
    if (!strcmp(argv[i], "--")) { i++; break; }
    else if (!strcmp(argv[i], "-o") && i + 1 < argc) out = argv[++i];
    else if (!strcmp(argv[i], "-s") && i + 1 < argc) sample_us = atol(argv[++i]);
    else if (!strcmp(argv[i], "-m") && i + 1 < argc) marker = argv[++i];
    else { fprintf(stderr, "pmon: bad arg %s\n", argv[i]); return 2; }
  }
  if (i >= argc) { fprintf(stderr, "usage: pmon [-o f] [-s us] [-m str] -- cmd...\n"); return 2; }
  hz = sysconf(_SC_CLK_TCK);
  int pfd[2];
  if (pipe(pfd)) { perror("pipe"); return 2; }
  double t0 = now_ms();
  pid_t pid = fork();
  if (pid < 0) { perror("fork"); return 2; }
  if (pid == 0) {
    dup2(pfd[1], 1); close(pfd[0]); close(pfd[1]);
    execvp(argv[i], argv + i);
    fprintf(stderr, "pmon: exec %s: %s\n", argv[i], strerror(errno));
    _exit(127);
  }
  close(pfd[1]);
  long hwm_max = 0, kids_hwm_max = 0; int pipe_open = 1;
  char linebuf[65536]; size_t ll = 0;
  char rb[65536];
  double last_kids_scan = 0;
  int exited = 0; siginfo_t si;
  memset(&si, 0, sizeof si);
  double cpu_self = 0, cpu_kids = 0;
  while (1) {
    struct pollfd pf = { pfd[0], POLLIN, 0 };
    int pr = pipe_open ? poll(&pf, 1, 0) : 0;
    if (pr > 0 && (pf.revents & (POLLIN | POLLHUP))) {
      ssize_t n = read(pfd[0], rb, sizeof rb);
      if (n > 0) {
        /* echo unchanged */
        size_t off = 0; while (off < (size_t)n) { ssize_t w = write(1, rb + off, n - off); if (w < 0) { if (errno == EINTR) continue; break; } off += w; }
        /* marker detection per line */
        for (ssize_t k = 0; k < n; k++) {
          char c = rb[k];
          if (c == '\n') {
            linebuf[ll] = 0;
            if (strstr(linebuf, marker)) {
              double s = 0; read_stat(pid, &s, NULL, NULL);
              long h = read_hwm_kb(pid); if (h > hwm_max) hwm_max = h;
              if (nmarks == capmarks) { capmarks = capmarks ? capmarks * 2 : 64; marks = realloc(marks, capmarks * sizeof(Mark)); }
              marks[nmarks].t_ms = now_ms() - t0; marks[nmarks].cpu_ms = s; marks[nmarks].hwm_kb = h; marks[nmarks].line = strdup(linebuf);
              nmarks++;
            }
            ll = 0;
          } else if (ll < sizeof linebuf - 1) linebuf[ll++] = c;
        }
      } else if (n == 0) pipe_open = 0;
    }
    long h = read_hwm_kb(pid); if (h > hwm_max) hwm_max = h;
    double tn = now_ms();
    if (tn - last_kids_scan > 250) { long kh = scan_kids_hwm(pid); if (kh > kids_hwm_max) kids_hwm_max = kh; last_kids_scan = tn; }
    /* has the lane exited? (WNOWAIT keeps the zombie, so /proc stat survives) */
    si.si_pid = 0;
    if (waitid(P_PID, pid, &si, WEXITED | WNOHANG | WNOWAIT) == 0 && si.si_pid == pid) { exited = 1; }
    if (exited) {
      read_stat(pid, &cpu_self, &cpu_kids, NULL);
      /* drain whatever is left in the pipe */
      while (pipe_open) {
        ssize_t n = read(pfd[0], rb, sizeof rb);
        if (n <= 0) { pipe_open = 0; break; }
        size_t off = 0; while (off < (size_t)n) { ssize_t w = write(1, rb + off, n - off); if (w < 0) { if (errno == EINTR) continue; break; } off += w; }
      }
      break;
    }
    if (!pipe_open || pr <= 0) usleep(sample_us);
  }
  int status; struct rusage ru;
  wait4(pid, &status, 0, &ru);
  double wall = now_ms() - t0;
  int code = WIFEXITED(status) ? WEXITSTATUS(status) : 128 + WTERMSIG(status);
  FILE *o = out ? fopen(out, "w") : stderr;
  if (!o) o = stderr;
  fprintf(o, "{\"exit\":%d,\"signaled\":%d,\"wall_ms\":%.1f,\"cpu_self_ms\":%.1f,\"cpu_kids_ms\":%.1f,"
             "\"cpu_ru_ms\":%.1f,\"rss_peak_kb\":%ld,\"rss_peak_ru_kb\":%ld,\"kids_rss_peak_kb\":%ld,\"hz\":%ld,\"marks\":[",
          code, WIFSIGNALED(status) ? 1 : 0, wall, cpu_self, cpu_kids,
          ru.ru_utime.tv_sec * 1e3 + ru.ru_utime.tv_usec / 1e3 + ru.ru_stime.tv_sec * 1e3 + ru.ru_stime.tv_usec / 1e3,
          hwm_max, ru.ru_maxrss, kids_hwm_max, hz);
  for (int m = 0; m < nmarks; m++) {
    fprintf(o, "%s{\"t_ms\":%.1f,\"cpu_ms\":%.1f,\"hwm_kb\":%ld,\"line\":\"", m ? "," : "", marks[m].t_ms, marks[m].cpu_ms, marks[m].hwm_kb);
    for (char *c = marks[m].line; *c; c++) { if (*c == '"' || *c == '\\') fputc('\\', o); if ((unsigned char)*c >= 32) fputc(*c, o); }
    fprintf(o, "\"}");
  }
  fprintf(o, "]}\n");
  if (o != stderr) fclose(o);
  return code;
}
