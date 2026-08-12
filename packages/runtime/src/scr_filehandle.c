/* fs/promises FileHandle — the handle fsPromises.open() resolves to.
 *
 * WHY THIS IS ITS OWN TRANSLATION UNIT. scr_lib.c and scr_async.c are in
 * cc.ts's unconditional RUNTIME_SOURCES, and the win32/linux links carry
 * no -ffunction-sections/--gc-sections, so every byte added to them lands
 * in EVERY binary. Measured: with this section inside scr_lib.c a
 * stream-free hello-world went 642 048 -> 644 096. Link-gated by
 * moduleUsesFileHandle, a program that never opens a file pays zero —
 * the same mistake, and the same fix, as the fs-stream block's shared
 * message builder.
 *
 * WHY THE HANDLE IS NOT THE FD. close(2) returns the descriptor NUMBER to
 * the OS free list, so the next open(2) hands the same number to a
 * different file. Under a bare-fd model a stale, already-closed handle
 * reads whatever file inherited the number and reports success: the right
 * byte count, no error, the wrong file's bytes, and nothing in any census
 * to show for it. Node keeps the closed state on the handle OBJECT and
 * answers `EBADF` / "file closed"; so does this. (Both behaviours are
 * measured in the block report's oracle, and pinned by corpus 3422.)
 *
 * FAILURES ARE PENDING, NOT THROWN. scr_fh_open_raw / scr_fh_read_into /
 * scr_fh_read_cur / scr_fh_close_raw leave the error in the exception
 * cell and return a dummy; they are deliberately OUTSIDE
 * MAY_THROW_LIB_FNS, so emitted code runs no pending check after them and
 * the settled-promise constructor converts the cell into the REJECTION.
 * That is the scr_fsp_* invariant; filehandle.read just spreads it over
 * two emitted statements, because its result is a RECORD whose layout
 * only the backend knows (the `promise.settled` intrinsic).
 */
#include "scr_runtime.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef _WIN32
#include <io.h>
#define SCR_FH_SEEK(fd, off, whence) _lseeki64((fd), (long long)(off), (whence))
typedef long long ScrFhOff;
#else
#include <unistd.h>
#define SCR_FH_SEEK(fd, off, whence) lseek((fd), (off_t)(off), (whence))
typedef off_t ScrFhOff;
#endif

struct ScrFileHandle {
  size_t rc;
  int fd;      /* -1 once closed */
  bool closed; /* distinct from fd < 0 so a failed open never looks closed */
};

ScrFileHandle *scr_fh_retain(ScrFileHandle *h) {
  if (h && h->rc != SIZE_MAX) h->rc++;
  return h;
}

void scr_fh_release(ScrFileHandle *h) {
  if (!h || h->rc == SIZE_MAX) return;
  if (--h->rc == 0) {
    /* An un-closed handle whose last reference dropped: close the fd
     * rather than leak it. DOCUMENTED DIVERGENCE: Node holds it until GC
     * and prints a warning; closing at the last reference is the
     * direction that does not exhaust the descriptor table. Same call
     * scr_stream_state_drop makes for an undestroyed fs stream. */
    if (!h->closed && h->fd >= 0) close(h->fd);
    free(h);
  }
}

void *scr_fh_retain_v(void *p) { return scr_fh_retain(p); }
void scr_fh_release_v(void *p) { scr_fh_release(p); }

double scr_fh_fd(ScrFileHandle *h) { return h->closed ? -1.0 : (double)h->fd; }

ScrFileHandle *scr_fh_open_raw(ScrStr *path, ScrStr *flags) {
  double fd = scr_fs_open(path, flags); /* Node's flag grammar + fs error */
  if (scr_exc_pending()) return NULL;
  ScrFileHandle *h = malloc(sizeof(ScrFileHandle));
  if (!h) {
    scr_trap("scriptc: out of memory\n");
  }
  h->rc = 1;
  h->fd = (int)fd;
  h->closed = false;
  return h;
}

/* Node's post-close rejection: code EBADF, message exactly "file closed"
 * — NOT the usual "EBADF: bad file descriptor, read" errno shape. */
static bool scr_fh_closed_throw(ScrFileHandle *h) {
  if (!h->closed) return false;
  scr_throw_error_msg_code(SCR_ERR_ERROR, "file closed", 11, "EBADF");
  return true;
}

static void scr_fh_seek_throw(void) {
  int e = errno;
  char namebuf[16];
  const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
  const char *text = scr_errno_text(e);
  char msg[160];
  int len = snprintf(msg, sizeof msg, "%s: %s, read", name, text);
  scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, name);
}

double scr_fh_read_into(ScrFileHandle *h, ScrBytes *buf, double offset, double length,
                        double position) {
  if (scr_fh_closed_throw(h)) return 0;
  /* Node's NUMERIC position reads from there and LEAVES THE FILE POSITION
   * UNCHANGED. Save/seek/read/restore rather than pread(2) so that the
   * offset/length validation and the read stay in ONE place —
   * scr_fs_read_sync, which is also what fs.readSync runs, so Node's
   * ERR_OUT_OF_RANGE texts have a single spelling. Single-threaded, so
   * the non-atomicity pread would avoid cannot be observed. */
  ScrFhOff saved = SCR_FH_SEEK(h->fd, 0, SEEK_CUR);
  if (saved < 0) {
    scr_fh_seek_throw();
    return 0;
  }
  if (SCR_FH_SEEK(h->fd, position, SEEK_SET) < 0) {
    scr_fh_seek_throw();
    return 0;
  }
  double n = scr_fs_read_sync((double)h->fd, buf, offset, length);
  int saved_errno = errno;
  SCR_FH_SEEK(h->fd, saved, SEEK_SET); /* restore even on the throw path */
  errno = saved_errno;
  return n;
}

double scr_fh_read_cur(ScrFileHandle *h, ScrBytes *buf, double offset, double length) {
  if (scr_fh_closed_throw(h)) return 0;
  /* position:null — read from, and advance, the file position. */
  return scr_fs_read_sync((double)h->fd, buf, offset, length);
}

void scr_fh_close_raw(ScrFileHandle *h) {
  if (h->closed) return; /* Node's second close() resolves */
  int fd = h->fd;
  h->closed = true;
  h->fd = -1;
  if (close(fd) != 0) {
    int e = errno;
    char namebuf[16];
    const char *name = scr_errno_name(e, namebuf, sizeof namebuf);
    const char *text = scr_errno_text(e);
    char msg[160];
    int len = snprintf(msg, sizeof msg, "%s: %s, close", name, text);
    scr_throw_error_msg_code(SCR_ERR_ERROR, msg, (size_t)len, name);
  }
}

/* The promise forms. filehandle.read has NO wrapper here: its result is a
 * record, so the lowering builds the record and hands it to the same
 * scr_promise_settled_ref through the `promise.settled` intrinsic. */
ScrPromise *scr_fsp_open(ScrStr *path, ScrStr *flags) {
  ScrFileHandle *h = scr_fh_open_raw(path, flags);
  return scr_promise_settled_ref(h, &scr_fh_retain_v, &scr_fh_release_v, NULL);
}

ScrPromise *scr_fh_close(ScrFileHandle *h) {
  scr_fh_close_raw(h); /* idempotent: Node's second close() resolves */
  return scr_promise_settled_void();
}
