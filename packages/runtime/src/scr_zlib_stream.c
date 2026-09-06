/* node:zlib's STREAMING decompressors — createUnzip / createGunzip /
 * createInflate / createInflateRaw.
 *
 * Every other zlib entry point in this tree is one-shot: hand it a
 * complete buffer, get a complete buffer back. That is the wrong shape
 * for a multi-megabyte payload, because the caller has to hold the whole
 * compressed member AND the whole inflated result at once. The streaming
 * form owns a z_stream that SURVIVES between writes, so a deflate block
 * split across a chunk boundary resumes on the next chunk and the peak
 * tracks one output block instead of one message.
 *
 * The Transform machinery is scr_stream.c's, unmodified: this unit only
 * supplies the three native option callbacks (transform / flush /
 * destroy) and hangs its state on the generic `ext` backing slot. That
 * is why it is its OWN translation unit rather than more of scr_zlib.c —
 * a program whose only zlib is gunzipSync must not owe the linker the
 * whole stream engine, and scr_stream.c must not name a zlib symbol. The
 * scr_http_body.c / scr_http_pipe.c split, applied to zlib. */
#include "scr_runtime.h"

#include <stdlib.h>
#include <string.h>
#include <zlib.h>

/* One output block per inflate() call. 16 KiB is Node's own zlib chunk
 * size (Z_DEFAULT_CHUNK), and it is the peak this whole unit exists to
 * bound: a 200 MB history-sync member inflates through 16 KiB at a time,
 * each block pushed to the readable half and owned by the consumer
 * before the next one is asked for. */
#define SCR_ZLIB_STREAM_BLOCK 16384

/* The gzip magic Node's Unzip sniffs for when deciding gunzip vs inflate.
 * Used here only for the CONCATENATED-member test — the framing choice
 * itself is zlib's, through windowBits 15+32. */
#define SCR_ZLIB_GZIP_ID1 0x1f

typedef struct ScrZlibInflater {
  z_stream zs;
  int mode;        /* scr_zlib_inflate_mode's: 0 zlib, 1 raw, 2 gzip, 3 auto */
  bool started;    /* inflateInit2 ran (and so inflateEnd is owed) */
  bool member_end; /* the current member ended cleanly (Z_STREAM_END) */
  bool failed;     /* a data error already errored the stream — stay quiet */
} ScrZlibInflater;

/* windowBits per mode, mirroring scr_zlib_window_bits in scr_zlib.c. Kept
 * local rather than exported because the two units are gated separately:
 * duplicating four integers costs less than a cross-unit call that would
 * make the gate story a conjunction. */
static int scr_zlib_stream_window_bits(int mode) {
  switch (mode) {
  case 1: return -15;     /* raw DEFLATE, no header    */
  case 2: return 15 + 16; /* gzip header only          */
  case 3: return 15 + 32; /* auto-detect zlib vs gzip  */
  default: return 15;     /* zlib header               */
  }
}

/* Node's message for each zlib return code, so a corrupt chunk reads the
 * same on a compiled binary as it does under node. */
static const char *scr_zlib_stream_msg(const ScrZlibInflater *inf, int rc) {
  if (inf->zs.msg != NULL) return inf->zs.msg;
  switch (rc) {
  case Z_DATA_ERROR: return "incorrect data check";
  case Z_NEED_DICT: return "need dictionary";
  case Z_MEM_ERROR: return "not enough memory";
  case Z_BUF_ERROR: return "unexpected end of file";
  default: return "zlib stream error";
  }
}

static const char *scr_zlib_stream_code(int rc) {
  switch (rc) {
  case Z_DATA_ERROR: return "Z_DATA_ERROR";
  case Z_NEED_DICT: return "Z_NEED_DICT";
  case Z_MEM_ERROR: return "Z_MEM_ERROR";
  case Z_BUF_ERROR: return "Z_BUF_ERROR";
  default: return "Z_STREAM_ERROR";
  }
}

static ScrError *scr_zlib_stream_err(const char *code, const char *msg) {
  ScrStr *m = scr_str_new(msg, strlen(msg));
  ScrError *e = scr_error_new(SCR_ERR_ERROR, m);
  scr_str_release(m);
  scr_error_set_code(e, code);
  return e;
}

/* The ext-backing destructor: runs on both stream teardown paths, so the
 * z_stream's window is released whether the program dropped the last
 * reference or the cycle collector did. */
static void scr_zlib_inflater_drop(void *p) {
  ScrZlibInflater *inf = (ScrZlibInflater *)p;
  if (inf == NULL) return;
  if (inf->started) {
    inflateEnd(&inf->zs);
    inf->started = false;
  }
  free(inf);
}

/* Push one 16 KiB-or-smaller output block onto the readable half. Borrows
 * nothing the caller must free: the ScrBytes is minted here and released
 * here (scr_stream_push retains its own). */
static void scr_zlib_stream_push_block(ScrStream *s, const unsigned char *data, size_t len) {
  ScrBytes *b = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)len));
  memcpy(b->data, data, len);
  scr_stream_push(s, b);
  scr_bytes_release(b);
}

/* The shared inflate pump, run by both the transform and the flush arm.
 * Consumes everything currently in `inf->zs.next_in`, pushing each output
 * block as it is produced. Returns NULL on success, or a +1 ScrError the
 * caller hands to transform_done/flush_done.
 *
 * `finishing` is true only from the flush arm, where running out of input
 * mid-member is Node's truncated-input error rather than "ask for the
 * next chunk". */
static ScrError *scr_zlib_stream_pump(ScrStream *s, ScrZlibInflater *inf, bool finishing) {
  unsigned char out[SCR_ZLIB_STREAM_BLOCK];
  for (;;) {
    /* A member that already ended: anything after it is either the next
     * concatenated gzip member (Node's gunzip and unzip both inflate a
     * sequence of them) or trailing garbage, which Node ignores. */
    if (inf->member_end) {
      if (inf->zs.avail_in == 0) return NULL;
      bool gzipish = inf->mode == 2 || inf->mode == 3;
      if (!gzipish || inf->zs.next_in[0] != SCR_ZLIB_GZIP_ID1) return NULL;
      if (inflateReset(&inf->zs) != Z_OK) {
        return scr_zlib_stream_err("Z_STREAM_ERROR", "zlib stream error");
      }
      inf->member_end = false;
    }
    if (inf->zs.avail_in == 0 && !finishing) return NULL;

    inf->zs.next_out = out;
    inf->zs.avail_out = (uInt)sizeof out;
    int rc = inflate(&inf->zs, finishing ? Z_FINISH : Z_NO_FLUSH);
    size_t produced = sizeof out - inf->zs.avail_out;
    if (produced > 0) scr_zlib_stream_push_block(s, out, produced);

    if (rc == Z_STREAM_END) {
      inf->member_end = true;
      continue; /* the loop head decides: next member, or done */
    }
    if (rc == Z_OK) {
      /* Z_OK with no output and no input consumed would spin; the
       * avail_in test at the loop head stops the non-finishing arm, and
       * the finishing arm falls out through Z_BUF_ERROR below. */
      if (produced == 0 && inf->zs.avail_in == 0) return NULL;
      continue;
    }
    if (rc == Z_BUF_ERROR) {
      /* No progress possible. Mid-stream that just means "more input,
       * please"; at flush it is Node's truncated-input error. */
      if (!finishing) return NULL;
      if (produced > 0) continue;
      return scr_zlib_stream_err("Z_BUF_ERROR", "unexpected end of file");
    }
    inf->failed = true;
    return scr_zlib_stream_err(scr_zlib_stream_code(rc), scr_zlib_stream_msg(inf, rc));
  }
}

/* ── the three native option callbacks ────────────────────────────────── */

/* Their ScrClosure is a bare marker with no captures — the inflater hangs
 * off the stream's ext slot, and the engine only reads "a _transform
 * exists" from the callback slot. scr_fs_stream_marker's shape. */
static void scr_zlib_stream_noop_clo(ScrClosure *c) { (void)c; }

static ScrClosure *scr_zlib_stream_marker(void) {
  return scr_closure_new((void *)&scr_zlib_stream_noop_clo, 0);
}

static void scr_zlib_stream_transform_inv(ScrClosure *cb, ScrStream *s, ScrBytes *chunk) {
  (void)cb;
  ScrZlibInflater *inf = (ScrZlibInflater *)scr_stream_ext(s);
  if (inf == NULL || inf->failed) {
    scr_stream_transform_done(s, NULL, NULL, NULL);
    return;
  }
  size_t len = (size_t)chunk->len;
  /* next_in points INTO the caller's chunk, which the engine holds alive
   * for the duration of this call. The pump consumes it entirely before
   * returning, so nothing survives the borrow. */
  inf->zs.next_in = (Bytef *)(uintptr_t)chunk->data;
  inf->zs.avail_in = (uInt)len;
  ScrError *err = scr_zlib_stream_pump(s, inf, false);
  inf->zs.next_in = NULL;
  inf->zs.avail_in = 0;
  scr_stream_transform_done(s, err, NULL, NULL);
}

static void scr_zlib_stream_flush_inv(ScrClosure *cb, ScrStream *s) {
  (void)cb;
  ScrZlibInflater *inf = (ScrZlibInflater *)scr_stream_ext(s);
  if (inf == NULL || inf->failed) {
    scr_stream_flush_done(s, NULL, NULL, NULL);
    return;
  }
  ScrError *err = NULL;
  if (inf->member_end) {
    /* The last member ended cleanly; trailing bytes after it were already
     * decided by the pump (next gzip member, or ignored garbage). */
    err = NULL;
  } else {
    /* No completed member — including the ZERO-BYTE stream, which Node
     * also errors on rather than ending empty (measured: node v22.18.0
     * and v25.9.0 both raise Z_BUF_ERROR "unexpected end of file" from a
     * createUnzip that is ended without a byte written). */
    inf->zs.next_in = NULL;
    inf->zs.avail_in = 0;
    err = scr_zlib_stream_pump(s, inf, true);
  }
  /* The window is dead weight from here: the readable half may still be
   * draining, but no further byte will be inflated. */
  if (inf->started) {
    inflateEnd(&inf->zs);
    inf->started = false;
  }
  scr_stream_flush_done(s, err, NULL, NULL);
}

static void scr_zlib_stream_destroy_inv(ScrClosure *cb, ScrStream *s, ScrError *err /*borrowed*/) {
  (void)cb;
  ScrZlibInflater *inf = (ScrZlibInflater *)scr_stream_ext(s);
  /* The inv receives `err` BORROWED (scr_stream_do_destroy keeps its own
   * reference) while scr_stream_destroy_done MOVES it — so the hand-off
   * owes a retain. Without it the error is released once too often and
   * the failure is a heap corruption in whatever allocates next, nowhere
   * near this file. scr_fs_stream_destroy_inv does the same retain. */
  ScrError *out = err != NULL ? scr_error_retain(err) : NULL;
  /* A destroy mid-member (the consumer tore the pipeline down) must not
   * leave the window allocated until the collector runs — that is the
   * memory this surface exists to bound. The ext drop stays the backstop
   * for the paths that never reach here. */
  if (inf != NULL && inf->started) {
    inflateEnd(&inf->zs);
    inf->started = false;
  }
  scr_stream_destroy_done(s, out); /* moves */
}

/* ── the constructor ──────────────────────────────────────────────────── */

ScrStream *scr_zlib_new_inflate_stream(double mode) {
  int m = (int)mode;
  ScrZlibInflater *inf = calloc(1, sizeof *inf);
  if (inf == NULL) scr_trap("scriptc: out of memory\n");
  inf->mode = m;
  if (inflateInit2(&inf->zs, scr_zlib_stream_window_bits(m)) != Z_OK) {
    free(inf);
    /* Z_MEM_ERROR is the only reachable code, like scr_zlib.c */
    scr_trap("scriptc: out of memory\n");
  }
  inf->started = true;

  /* Node's zlib streams take the default 16 KiB highWaterMark on both
   * halves, not the 64 KiB stream default — the readable side is a queue
   * of these same blocks, so matching the block size keeps one write's
   * output from parking several buffers past the mark. */
  ScrStream *s = scr_stream_new_transform(
      (double)SCR_ZLIB_STREAM_BLOCK, (double)SCR_ZLIB_STREAM_BLOCK,
      /*auto_destroy*/ true, /*emit_close*/ true, /*allow_half_open*/ true,
      /*readable_side*/ true, /*writable_side*/ true,
      scr_zlib_stream_marker(), &scr_zlib_stream_transform_inv,
      scr_zlib_stream_marker(), &scr_zlib_stream_flush_inv,
      scr_zlib_stream_marker(), &scr_zlib_stream_destroy_inv);
  scr_stream_set_ext(s, inf, &scr_zlib_inflater_drop);
  scr_stream_set_cls(s, m == 1   ? "InflateRaw"
                        : m == 2 ? "Gunzip"
                        : m == 3 ? "Unzip"
                                 : "Inflate");
  return s;
}

/* The four public entry points. One symbol each taking no arguments —
 * the scr_zlib_gunzip/scr_zlib_unzip shape, and for the same reason: both
 * backends map a lib fn to ONE symbol over the IR's own arguments, so a
 * mode that is a constant of the call site belongs on this side of the
 * boundary rather than as a lib-call argument. */
ScrStream *scr_zlib_create_inflate(void) { return scr_zlib_new_inflate_stream(0); }
ScrStream *scr_zlib_create_inflate_raw(void) { return scr_zlib_new_inflate_stream(1); }
ScrStream *scr_zlib_create_gunzip(void) { return scr_zlib_new_inflate_stream(2); }
ScrStream *scr_zlib_create_unzip(void) { return scr_zlib_new_inflate_stream(3); }
