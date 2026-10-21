/* win32 libc shims — the POSIX/BSD functions the runtime calls that
 * mingw-w64's CRT does not provide (declared in scr_runtime.h's _WIN32
 * block). Compiled into win32-target builds only (cc.ts adds this TU and
 * -ladvapi32 for windows triples); an empty TU anywhere else, so POSIX
 * builds cannot change by a byte. */
#ifdef _WIN32

#include "scr_runtime.h"

#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include <windows.h>

/* POSIX.1-2008 stpcpy: strcpy returning the END of the copy — scr_number.c
 * (untouchable by project rule; ryu-adjacent) builds "e+"/"e-" exponent
 * tails with it. */
char *stpcpy(char *dst, const char *src) {
  size_t n = strlen(src);
  memcpy(dst, src, n + 1);
  return dst + n;
}

/* arc4random_buf over RtlGenRandom (advapi32's SystemFunction036) — the
 * kernel CSPRNG behind rand_s and BCryptGenRandom, available everywhere
 * without a bcrypt link. Failure aborts: like the BSD/glibc original, the
 * callers (Math.random, crypto.randomUUID/randomBytes) have no error arm
 * and returning predictable bytes is never acceptable. */
BOOLEAN NTAPI SystemFunction036(PVOID buffer, ULONG length);

void arc4random_buf(void *buf, size_t n) {
  unsigned char *p = buf;
  while (n > 0) {
    ULONG step = n > 0x7fffffffUL ? 0x7fffffffUL : (ULONG)n;
    if (!SystemFunction036(p, step)) {
      fputs("scriptc: RtlGenRandom failed\n", stderr);
      abort();
    }
    p += step;
    n -= step;
  }
}

/* POSIX gmtime_r: the win32 CRT's gmtime already answers from per-thread
 * storage, so the reentrant spelling is a copy-out (scr_http.c's Date
 * header formatter is the caller). */
struct tm *gmtime_r(const time_t *t, struct tm *out) {
  struct tm *g = gmtime(t);
  if (g == NULL) return NULL;
  *out = *g;
  return out;
}

/* GNU/BSD strcasestr — scr_http.c's Connection-token scan. Naive
 * quadratic scan like the musl original; header values are tiny. */
char *strcasestr(const char *hay, const char *needle) {
  size_t n = strlen(needle);
  if (n == 0) return (char *)hay;
  for (; *hay != '\0'; hay++) {
    size_t i = 0;
    while (i < n && hay[i] != '\0' &&
           tolower((unsigned char)hay[i]) == tolower((unsigned char)needle[i]))
      i++;
    if (i == n) return (char *)hay;
  }
  return NULL;
}

#ifdef _MSC_VER
/* ── MSVC-ABI-only: the three POSIX surfaces the UCRT lacks ─────────────
 * Declared in scr_runtime.h's _MSC_VER block. mingw-w64 provides these
 * itself, so none of this exists there (no duplicate symbol against
 * libmingwex / winpthreads). */

#include <errno.h>
#include <sys/stat.h>

/* CLOCK_REALTIME is the precise system time (100 ns FILETIME ticks since
 * 1601, rebased to the Unix epoch); CLOCK_MONOTONIC is the performance
 * counter, which is what mingw-w64's own clock_gettime reads. Both are
 * split into whole seconds and a remainder so the 64-bit math cannot
 * overflow. */
int clock_gettime(clockid_t id, struct timespec *ts) {
  if (id == CLOCK_REALTIME) {
    FILETIME ft;
    GetSystemTimePreciseAsFileTime(&ft);
    unsigned long long t = ((unsigned long long)ft.dwHighDateTime << 32) | ft.dwLowDateTime;
    t -= 116444736000000000ULL;
    ts->tv_sec = (time_t)(t / 10000000ULL);
    ts->tv_nsec = (long)((t % 10000000ULL) * 100ULL);
    return 0;
  }
  if (id == CLOCK_MONOTONIC) {
    LARGE_INTEGER f, c;
    QueryPerformanceFrequency(&f);
    QueryPerformanceCounter(&c);
    unsigned long long q = (unsigned long long)c.QuadPart;
    unsigned long long hz = (unsigned long long)f.QuadPart;
    ts->tv_sec = (time_t)(q / hz);
    ts->tv_nsec = (long)((q % hz) * 1000000000ULL / hz);
    return 0;
  }
  errno = EINVAL;
  return -1;
}

/* Sleeps at least the requested span (rounded UP to a millisecond, so a
 * sub-millisecond request still yields the CPU instead of returning at
 * once). A Win32 Sleep is never interrupted by a signal, so the
 * remainder is always zero and EINTR never happens. */
int nanosleep(const struct timespec *req, struct timespec *rem) {
  if (req->tv_sec < 0 || req->tv_nsec < 0 || req->tv_nsec >= 1000000000L) {
    errno = EINVAL;
    return -1;
  }
  unsigned long long ms = (unsigned long long)req->tv_sec * 1000ULL +
                          ((unsigned long long)req->tv_nsec + 999999ULL) / 1000000ULL;
  while (ms > 0) {
    DWORD step = ms > 0x7ffffffeULL ? 0x7ffffffeUL : (DWORD)ms;
    Sleep(step);
    ms -= step;
  }
  if (rem != NULL) {
    rem->tv_sec = 0;
    rem->tv_nsec = 0;
  }
  return 0;
}

/* opendir/readdir/closedir over FindFirstFileA/FindNextFileA, the same
 * ANSI enumeration mingw-w64's own <dirent.h> does. A failed opendir
 * answers what Node's readdirSync reports: ENOTDIR for a path that
 * exists and is not a directory, EACCES for access denied, ENOENT
 * otherwise. */
struct ScrMsvcDir {
  HANDLE h;
  WIN32_FIND_DATAA fd;
  int fresh; /* fd holds an entry readdir has not returned yet */
  struct dirent ent;
};

DIR *opendir(const char *path) {
  size_t n = strlen(path);
  if (n == 0) {
    errno = ENOENT;
    return NULL;
  }
  char *pat = (char *)malloc(n + 3);
  if (pat == NULL) {
    errno = ENOMEM;
    return NULL;
  }
  memcpy(pat, path, n);
  if (path[n - 1] != '/' && path[n - 1] != '\\') pat[n++] = '\\';
  pat[n++] = '*';
  pat[n] = '\0';
  DIR *d = (DIR *)malloc(sizeof *d);
  if (d == NULL) {
    free(pat);
    errno = ENOMEM;
    return NULL;
  }
  d->h = FindFirstFileA(pat, &d->fd);
  free(pat);
  if (d->h == INVALID_HANDLE_VALUE) {
    DWORD e = GetLastError();
    struct _stat64i32 st;
    if (e == ERROR_ACCESS_DENIED) errno = EACCES;
    else if (_stat64i32(path, &st) == 0 && (st.st_mode & _S_IFMT) != _S_IFDIR) errno = ENOTDIR;
    else errno = ENOENT;
    free(d);
    return NULL;
  }
  d->fresh = 1;
  return d;
}

struct dirent *readdir(DIR *d) {
  if (d->fresh) {
    d->fresh = 0;
  } else if (!FindNextFileA(d->h, &d->fd)) {
    return NULL;
  }
  strncpy(d->ent.d_name, d->fd.cFileName, sizeof d->ent.d_name - 1);
  d->ent.d_name[sizeof d->ent.d_name - 1] = '\0';
  return &d->ent;
}

int closedir(DIR *d) {
  FindClose(d->h);
  free(d);
  return 0;
}
#endif /* _MSC_VER */

#else /* !_WIN32 */

/* Empty TU off-Windows: cc.ts only compiles this file for windows triples,
 * but an accidental link elsewhere must stay harmless. */
typedef int scr_win_unused;

#endif /* _WIN32 */
