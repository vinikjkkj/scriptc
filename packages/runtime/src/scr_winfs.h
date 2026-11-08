/* Windows file-system calls by UTF-8 path, over the wide (UTF-16) APIs.
 *
 * Node hands libuv a UTF-8 string and libuv converts it to UTF-16 for every file-system call (CreateFileW, FindFirstFileW, ...), and converts the
 * names it reads back from UTF-16 to UTF-8. The CRT's narrow calls (open, fopen, stat, mkdir, ... and mingw's <dirent.h>) go through the process's ANSI
 * code page instead, so a non-ASCII name (accents, CJK, an astral emoji) is mangled or not found. Every call below takes the UTF-8 the runtime keeps
 * its strings in and answers the same errno values the narrow call does.
 *
 * Conversion is WTF-8, as libuv's is: an unpaired surrogate (a legal NTFS name) round-trips as its own three-byte sequence instead of becoming U+FFFD.
 *
 * Header-only and `static inline`: a program that never touches the file system compiles none of it, so the hello binary is unchanged by a byte. */
#ifndef SCR_WINFS_H
#define SCR_WINFS_H
#ifdef _WIN32

#include <direct.h>
#include <errno.h>
#include <fcntl.h>
#include <io.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <wchar.h>
#include <windows.h>

/* UTF-8 (WTF-8) to a malloc'd, NUL-terminated UTF-16 string; NULL on out of memory (errno ENOMEM). An ill-formed byte becomes U+FFFD. */
static inline wchar_t *scr_u_wide(const char *s) {
  const size_t n = strlen(s);
  wchar_t *w = (wchar_t *)malloc((n + 1) * sizeof(wchar_t));
  if (w == NULL) {
    errno = ENOMEM;
    return NULL;
  }
  size_t o = 0;
  for (size_t i = 0; i < n; i++) {
    const unsigned c = (unsigned char)s[i];
    const unsigned c1 = i + 1 < n ? (unsigned char)s[i + 1] : 0, c2 = i + 2 < n ? (unsigned char)s[i + 2] : 0, c3 = i + 3 < n ? (unsigned char)s[i + 3] : 0;
    if (c < 0x80) {
      w[o++] = (wchar_t)c;
    } else if (c >= 0xC2 && c <= 0xDF && (c1 & 0xC0) == 0x80) {
      w[o++] = (wchar_t)(((c & 0x1F) << 6) | (c1 & 0x3F));
      i += 1;
    } else if ((c & 0xF0) == 0xE0 && (c1 & 0xC0) == 0x80 && (c2 & 0xC0) == 0x80) {
      const unsigned cp = ((c & 0x0F) << 12) | ((c1 & 0x3F) << 6) | (c2 & 0x3F);
      if (cp >= 0x800) { /* surrogate code points are kept: WTF-8 */
        w[o++] = (wchar_t)cp;
        i += 2;
      } else {
        w[o++] = 0xFFFD;
      }
    } else if (c >= 0xF0 && c <= 0xF4 && (c1 & 0xC0) == 0x80 && (c2 & 0xC0) == 0x80 && (c3 & 0xC0) == 0x80) {
      unsigned cp = ((c & 0x07) << 18) | ((c1 & 0x3F) << 12) | ((c2 & 0x3F) << 6) | (c3 & 0x3F);
      if (cp >= 0x10000 && cp <= 0x10FFFF) {
        cp -= 0x10000;
        w[o++] = (wchar_t)(0xD800 + (cp >> 10));
        w[o++] = (wchar_t)(0xDC00 + (cp & 0x3FF));
        i += 3;
      } else {
        w[o++] = 0xFFFD;
      }
    } else {
      w[o++] = 0xFFFD;
    }
  }
  w[o] = 0;
  return w;
}

/* UTF-16 to WTF-8 into dst (capacity cap, NUL included). Returns the byte length, or (size_t)-1 when it does not fit. */
static inline size_t scr_u_narrow(const wchar_t *w, char *dst, size_t cap) {
  size_t o = 0;
  for (size_t i = 0; w[i] != 0; i++) {
    unsigned cp = (unsigned)w[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && w[i + 1] >= 0xDC00 && w[i + 1] <= 0xDFFF) {
      cp = 0x10000 + ((cp - 0xD800) << 10) + ((unsigned)w[i + 1] - 0xDC00);
      i++;
    }
    const size_t need = cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
    if (o + need + 1 > cap) return (size_t)-1;
    if (need == 1) {
      dst[o++] = (char)cp;
    } else if (need == 2) {
      dst[o++] = (char)(0xC0 | (cp >> 6));
      dst[o++] = (char)(0x80 | (cp & 0x3F));
    } else if (need == 3) {
      dst[o++] = (char)(0xE0 | (cp >> 12));
      dst[o++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      dst[o++] = (char)(0x80 | (cp & 0x3F));
    } else {
      dst[o++] = (char)(0xF0 | (cp >> 18));
      dst[o++] = (char)(0x80 | ((cp >> 12) & 0x3F));
      dst[o++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      dst[o++] = (char)(0x80 | (cp & 0x3F));
    }
  }
  dst[o] = '\0';
  return o;
}

/* ── directory enumeration: FindFirstFileW / FindNextFileW ───────────────────
 * The OS order, nothing sorted; "." and ".." come back like any entry (the callers skip them). A NAME is at most 255 UTF-16 units, so at most 765
 * bytes of UTF-8. A failed open answers what Node's readdirSync reports: ENOTDIR for a path that exists and is not a directory, EACCES for access
 * denied, ENOENT otherwise. */
struct scr_u_dirent {
  char d_name[800];
};
typedef struct ScrUDir {
  HANDLE h;
  WIN32_FIND_DATAW fd;
  int fresh; /* fd holds an entry readdir has not returned yet */
  struct scr_u_dirent ent;
} ScrUDir;

static inline ScrUDir *scr_u_opendir(const char *path) {
  if (path[0] == '\0') {
    errno = ENOENT;
    return NULL;
  }
  wchar_t *wp = scr_u_wide(path);
  if (wp == NULL) return NULL;
  size_t n = wcslen(wp);
  wchar_t *pat = (wchar_t *)malloc((n + 3) * sizeof(wchar_t));
  ScrUDir *d = (ScrUDir *)malloc(sizeof *d);
  if (pat == NULL || d == NULL) {
    free(pat);
    free(d);
    free(wp);
    errno = ENOMEM;
    return NULL;
  }
  memcpy(pat, wp, n * sizeof(wchar_t));
  if (wp[n - 1] != L'/' && wp[n - 1] != L'\\') pat[n++] = L'\\';
  pat[n++] = L'*';
  pat[n] = 0;
  d->h = FindFirstFileW(pat, &d->fd);
  free(pat);
  if (d->h == INVALID_HANDLE_VALUE) {
    const DWORD e = GetLastError();
    struct _stat64i32 st;
    if (e == ERROR_ACCESS_DENIED) errno = EACCES;
    else if (_wstat64i32(wp, &st) == 0 && (st.st_mode & _S_IFMT) != _S_IFDIR) errno = ENOTDIR;
    else errno = ENOENT;
    free(wp);
    free(d);
    return NULL;
  }
  free(wp);
  d->fresh = 1;
  return d;
}

static inline struct scr_u_dirent *scr_u_readdir(ScrUDir *d) {
  for (;;) {
    if (d->fresh) {
      d->fresh = 0;
    } else if (!FindNextFileW(d->h, &d->fd)) {
      return NULL;
    }
    if (scr_u_narrow(d->fd.cFileName, d->ent.d_name, sizeof d->ent.d_name) != (size_t)-1) return &d->ent;
    /* a name that does not fit cannot happen (255 units); skip rather than hand back a truncated one */
  }
}

static inline int scr_u_closedir(ScrUDir *d) {
  FindClose(d->h);
  free(d);
  return 0;
}

#endif /* _WIN32 */
#endif /* SCR_WINFS_H */
