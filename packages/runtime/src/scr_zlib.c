/* node:zlib, the lowered slice: deflateSync/inflateSync over u8 bytes with
 * Node's DEFAULT options (zlib format, Z_DEFAULT_COMPRESSION, windowBits
 * 15). Compiled ONLY when the program uses zlib (cc.ts gates it exactly
 * like scr_regex.c/libregexp), so zlib-free binaries keep their
 * historical link line. Host builds link the system -lz; cross targets
 * link the vendored zlib built per target (ensureZlibObjects in cc.ts).
 *
 * Compressed OUTPUT bytes are zlib-version-dependent — the differential
 * corpus tests round-trips and fixed-blob inflation, never raw deflate
 * output. deflate of valid input cannot fail (OOM aborts); inflate of
 * corrupt input THROWS Node's catchable Error (zlib's own msg text:
 * "incorrect header check", ...). */
#include "scr_runtime.h"

#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <zlib.h>

static void scr_zlib_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

ScrBytes *scr_zlib_deflate(const ScrBytes *data) {
  uLong srcLen = (uLong)data->len;
  uLong cap = compressBound(srcLen);
  uint8_t *buf = malloc(cap ? cap : 1);
  if (!buf) scr_zlib_oom();
  uLongf outLen = cap;
  int rc = compress2(buf, &outLen, data->data, srcLen, Z_DEFAULT_COMPRESSION);
  if (rc != Z_OK) scr_zlib_oom(); /* Z_MEM_ERROR is the only reachable code */
  ScrBytes *out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)outLen));
  memcpy(out->data, buf, outLen);
  free(buf);
  return out;
}

ScrBytes *scr_zlib_inflate(const ScrBytes *data);
/* ── the island's mode variants (scr_zlib_island.c bridges these into
 * the embedded engine's node:zlib shim) ───────────────────────────────
 * mode: 0 zlib (windowBits 15), 1 raw (-15), 2 gzip (15+16); inflate
 * additionally takes 3 = auto-detect zlib/gzip (15+32, Node's unzip). */

static int scr_zlib_window_bits(int mode, bool inflating) {
  switch (mode) {
  case 1: return -15;
  case 2: return 15 + 16;
  case 3: return inflating ? 15 + 32 : 15;
  default: return 15;
  }
}

ScrBytes *scr_zlib_deflate_mode(const ScrBytes *data, double mode, double level) {
  z_stream zs;
  memset(&zs, 0, sizeof zs);
  int lvl = (int)level;
  if (lvl < -1 || lvl > 9) lvl = Z_DEFAULT_COMPRESSION;
  if (deflateInit2(&zs, lvl, Z_DEFLATED, scr_zlib_window_bits((int)mode, false), 8,
                   Z_DEFAULT_STRATEGY) != Z_OK) {
    scr_zlib_oom();
  }
  uLong cap = deflateBound(&zs, (uLong)data->len);
  uint8_t *buf = malloc(cap ? cap : 1);
  if (!buf) scr_zlib_oom();
  zs.next_in = data->data;
  zs.avail_in = (uInt)data->len;
  zs.next_out = buf;
  zs.avail_out = (uInt)cap;
  int rc = deflate(&zs, Z_FINISH);
  if (rc != Z_STREAM_END) scr_zlib_oom(); /* bound guarantees completion */
  size_t len = cap - zs.avail_out;
  deflateEnd(&zs);
  ScrBytes *out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)len));
  memcpy(out->data, buf, len);
  free(buf);
  return out;
}

ScrBytes *scr_zlib_inflate_mode(const ScrBytes *data, double mode) {
  z_stream zs;
  memset(&zs, 0, sizeof zs);
  if (inflateInit2(&zs, scr_zlib_window_bits((int)mode, true)) != Z_OK) scr_zlib_oom();
  size_t cap = data->len > 64 ? data->len * 4 : 256;
  uint8_t *buf = malloc(cap);
  if (!buf) scr_zlib_oom();
  zs.next_in = data->data;
  zs.avail_in = (uInt)data->len;
  size_t len = 0;
  for (;;) {
    zs.next_out = buf + len;
    zs.avail_out = (uInt)(cap - len);
    int rc = inflate(&zs, Z_NO_FLUSH);
    len = cap - zs.avail_out;
    if (rc == Z_STREAM_END) break;
    if (rc == Z_OK || rc == Z_BUF_ERROR) {
      if (rc == Z_BUF_ERROR && zs.avail_in == 0 && zs.avail_out > 0) {
        inflateEnd(&zs);
        free(buf);
        static const char msg[] = "unexpected end of file";
        scr_throw_errno_error_raw(-5, "Z_BUF_ERROR", msg, sizeof msg - 1);
        return NULL;
      }
      if (cap - len < 64) {
        cap *= 2;
        uint8_t *grown = realloc(buf, cap);
        if (!grown) scr_zlib_oom();
        buf = grown;
      }
      continue;
    }
    const char *msg = zs.msg ? zs.msg : (rc == Z_NEED_DICT ? "Missing dictionary" : "zlib error");
    size_t mlen = strlen(msg);
    /* Node stamps the zlib return code's name (err.code) */
    const char *code = rc == Z_DATA_ERROR ? "Z_DATA_ERROR"
                       : rc == Z_NEED_DICT ? "Z_NEED_DICT"
                       : rc == Z_MEM_ERROR ? "Z_MEM_ERROR"
                                           : "Z_STREAM_ERROR";
    inflateEnd(&zs);
    free(buf);
    scr_throw_errno_error_raw((double)rc, code, msg, mlen);
    return NULL;
  }
  inflateEnd(&zs);
  ScrBytes *out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)len));
  memcpy(out->data, buf, len);
  free(buf);
  return out;
}

/* inflateSync over a Buffer with the default options: the zlib container, with
 * the code and errno Node stamps on a failure (scr_zlib_inflate_mode). */
ScrBytes *scr_zlib_inflate(const ScrBytes *data) {
  return scr_zlib_inflate_mode(data, 0);
}

/* One-shot raw-DEFLATE inflate into a caller-sized buffer: the island's
 * compressed embedded module text (the emitter stores big npm sources
 * deflated and their exact inflated length in the table row — the emitted
 * main installs this through scr_island_set_inflate). True only when the
 * stream ends exactly at dst_len; any mismatch is a build/runtime bug the
 * caller surfaces, never a silent truncation. */
bool scr_zlib_inflate_exact(const unsigned char *src, size_t src_len,
                            unsigned char *dst, size_t dst_len) {
  z_stream zs;
  memset(&zs, 0, sizeof zs);
  if (inflateInit2(&zs, -15) != Z_OK) return false; /* raw DEFLATE */
  zs.next_in = (Bytef *)(uintptr_t)src;
  zs.avail_in = (uInt)src_len;
  zs.next_out = dst;
  zs.avail_out = (uInt)dst_len;
  int rc = inflate(&zs, Z_FINISH);
  bool ok = rc == Z_STREAM_END && zs.total_out == dst_len;
  inflateEnd(&zs);
  return ok;
}

/* ── the gzip-container twins (node:zlib's gzipSync/gunzipSync/unzipSync)
 * The codec is the same one deflate/inflate already run; only the header
 * differs, which is exactly what the mode argument selects. Thin wrappers
 * rather than mode arguments on the lib-call itself: both backends map a
 * lib fn to ONE symbol taking the IR's own arguments, so a constant mode
 * belongs on this side of the boundary. Node's unzip auto-detects zlib vs
 * gzip framing (mode 3); gunzip demands the gzip header (mode 2) and
 * throws catchably on anything else, like inflate. */
ScrBytes *scr_zlib_gzip(const ScrBytes *data) {
  return scr_zlib_deflate_mode(data, 2, -1);
}

ScrBytes *scr_zlib_gunzip(const ScrBytes *data) {
  return scr_zlib_inflate_mode(data, 2);
}

ScrBytes *scr_zlib_unzip(const ScrBytes *data) {
  return scr_zlib_inflate_mode(data, 3);
}

/* ── the promisified twins (util.promisify(deflate) / (unzip)) ──────────
 * Node runs these on the threadpool; a compiled binary has none, so the
 * codec runs synchronously and the result comes back as an ALREADY
 * SETTLED promise -- the fs/promises stance (SEMANTICS.md divergence 23).
 * The await still yields to the microtask queue, so ordering against
 * other promise work is unchanged; only the parallelism is absent, and
 * there was never any to observe in a single-threaded loop. A throw from
 * the codec propagates out of the call rather than rejecting the promise
 * -- the same shape the sync forms already have, and what the settled-
 * promise helper's callers rely on. */
ScrPromise *scr_zlib_deflate_async(const ScrBytes *data) {
  ScrBytes *b = scr_zlib_deflate(data);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

/* util.promisify(deflate) WITH an options object carrying a level. Node's
 * callback deflate takes { level }, and the level changes the OUTPUT BYTES
 * (it is a size/CPU tradeoff over a stream that inflates identically), so
 * the level has to reach the codec rather than being dropped. Mode 0 is the
 * zlib container, which is what the option-less form produces too. */
ScrPromise *scr_zlib_deflate_async_level(const ScrBytes *data, double level) {
  ScrBytes *b = scr_zlib_deflate_mode(data, 0, level);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

ScrPromise *scr_zlib_unzip_async(const ScrBytes *data) {
  ScrBytes *b = scr_zlib_unzip(data);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

/* ── the RAW twins (node:zlib's deflateRaw/inflateRaw) ───────────────────
 * Headerless DEFLATE (mode 1, windowBits -15): the same codec with no
 * zlib or gzip wrapper, which is what a framing layer that carries its
 * own length and checksum uses. inflateRaw throws catchably on input the
 * stream rejects, like every other decompressor here. */
ScrBytes *scr_zlib_deflate_raw(const ScrBytes *data) {
  return scr_zlib_deflate_mode(data, 1, -1);
}

ScrBytes *scr_zlib_inflate_raw(const ScrBytes *data) {
  return scr_zlib_inflate_mode(data, 1);
}

ScrPromise *scr_zlib_deflate_raw_async(const ScrBytes *data) {
  ScrBytes *b = scr_zlib_deflate_raw(data);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

ScrPromise *scr_zlib_inflate_raw_async(const ScrBytes *data) {
  ScrBytes *b = scr_zlib_inflate_raw(data);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

/* ── zlib over UNTYPED operands, with Node's options bag ───────────────────
 * `zlib.inflateSync(body, { maxOutputLength })`, `zlib.deflate(buf, cb)`,
 * `zlib.inflate(body, opts, cb)`: the data arrives as a dyn value (string,
 * Buffer, any TypedArray, DataView, ArrayBuffer — Node's accepted set, with
 * ERR_INVALID_ARG_TYPE for the rest) and the options as a dyn object. The
 * recognised options are the ones that change the result or its failure:
 * level, windowBits, memLevel, strategy, dictionary, maxOutputLength
 * (RangeError ERR_BUFFER_TOO_LARGE when the output would exceed it) and
 * chunkSize (validated; the output never depends on it). Each is
 * range-checked with Node's own messages. `info`, `flush` and `finishFlush`
 * change the shape of the answer or the stream's end handling and are not
 * modeled: a program that sets one gets a loud error naming it.
 *
 * ops: 0 deflate, 1 inflate, 2 gzip, 3 gunzip, 4 unzip, 5 deflateRaw,
 * 6 inflateRaw. The callback forms run the codec when their immediate
 * fires (Node runs it on the threadpool and delivers in a later loop
 * phase), then call back with (null, buffer) or (error). */
typedef struct {
  int level, window_bits, mem_level, strategy;
  double max_out;
  ScrBytes *dict; /* +1 or NULL */
} ScrZlOpts;

static void zl_out_of_range(const char *name, const char *range, const ScrDyn *v) {
  char detail[48];
  const char *shown = detail;
  if (v->kind == SCR_DYN_NUM) {
    size_t n = scr_f64_to_str(v->v.num, detail);
    detail[n] = '\0';
  } else {
    shown = "?";
  }
  char msg[200];
  int len = snprintf(msg, sizeof msg, "The value of \"%s\" is out of range. It must be %s. Received %s", name, range, shown);
  scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
}

/* checkRangesOrGetDefault: absent -> default; a non-finite or non-number
 * value is a TypeError (a string is "must be of type number"); out of range
 * a RangeError; a fraction is accepted and truncated by the C side, as in
 * Node. integer_only is validateInteger's stricter rule (maxOutputLength).
 * false with a throw pending. */
static bool zl_int_opt(const ScrDyn *opts, const char *key, double lo, double hi, double dflt, bool integer_only,
                       double *out) {
  *out = dflt;
  if (opts == NULL || opts->kind != SCR_DYN_OBJ) return true;
  ScrDyn *v = scr_dyn_obj_get(opts, key, strlen(key));
  if (v == NULL || v->kind == SCR_DYN_UNDEF) return true;
  char name[48];
  snprintf(name, sizeof name, "options.%s", key);
  if (v->kind != SCR_DYN_NUM || (!integer_only && !isfinite(v->v.num))) {
    scr_dyn_prop_type_fail(name, "of type number", v);
    return false;
  }
  double n = v->v.num;
  if (integer_only && (!isfinite(n) || n != floor(n))) {
    zl_out_of_range(name, "an integer", v);
    return false;
  }
  if (n < lo || n > hi) {
    char range[96];
    if (isinf(hi)) snprintf(range, sizeof range, ">= %.0f", lo);
    else snprintf(range, sizeof range, ">= %.0f and <= %.0f", lo, hi);
    zl_out_of_range(name, range, v);
    return false;
  }
  *out = n;
  return true;
}

static ScrBytes *zl_input_bytes(const ScrDyn *d, bool callback_form);

static void zl_opts_free(ScrZlOpts *o) {
  if (o->dict) scr_bytes_release(o->dict);
  o->dict = NULL;
}

static bool zl_parse_opts(const ScrDyn *opts, ScrZlOpts *o) {
  memset(o, 0, sizeof *o);
  o->level = Z_DEFAULT_COMPRESSION;
  o->window_bits = 15;
  o->mem_level = 8;
  o->strategy = Z_DEFAULT_STRATEGY;
  o->max_out = INFINITY;
  if (opts == NULL || opts->kind == SCR_DYN_UNDEF || opts->kind == SCR_DYN_NULL) return true;
  if (opts->kind != SCR_DYN_OBJ) {
    scr_dyn_arg_type_fail("options", "of type object", opts);
    return false;
  }
  static const char *const unmodeled[] = {"info", "flush", "finishFlush"};
  for (size_t i = 0; i < sizeof unmodeled / sizeof *unmodeled; i++) {
    ScrDyn *v = scr_dyn_obj_get(opts, unmodeled[i], strlen(unmodeled[i]));
    if (v != NULL && v->kind != SCR_DYN_UNDEF) {
      char msg[160];
      int n = snprintf(msg, sizeof msg,
                       "zlib option '%s' is not supported yet (it changes the shape of the result or the stream end)",
                       unmodeled[i]);
      scr_throw_error_msg(SCR_ERR_ERROR, msg, (size_t)n);
      return false;
    }
  }
  double v;
  if (!zl_int_opt(opts, "windowBits", 8, 15, 15, false, &v)) return false;
  o->window_bits = (int)v;
  if (!zl_int_opt(opts, "level", -1, 9, -1, false, &v)) return false;
  o->level = (int)v;
  if (!zl_int_opt(opts, "memLevel", 1, 9, 8, false, &v)) return false;
  o->mem_level = (int)v;
  if (!zl_int_opt(opts, "strategy", 0, 4, 0, false, &v)) return false;
  o->strategy = (int)v;
  {
    /* chunkSize: a non-finite value is the default, a small one is an error. */
    ScrDyn *cs = scr_dyn_obj_get(opts, "chunkSize", 9);
    if (cs != NULL && cs->kind == SCR_DYN_NUM && isfinite(cs->v.num) && cs->v.num < 64) {
      zl_out_of_range("options.chunkSize", ">= 64", cs);
      return false;
    }
  }
  if (!zl_int_opt(opts, "maxOutputLength", 1, 9007199254740991.0, INFINITY, true, &o->max_out)) return false;
  ScrDyn *dict = scr_dyn_obj_get(opts, "dictionary", 10);
  if (dict != NULL && dict->kind != SCR_DYN_UNDEF) {
    o->dict = zl_input_bytes(dict, false);
    if (o->dict == NULL) return false;
  }
  return true;
}

/* ToBytes over Node's accepted set (string utf8, Buffer/TypedArray/DataView
 * raw bytes, ArrayBuffer). +1, or NULL with the throw pending. */
static ScrBytes *zl_input_bytes(const ScrDyn *d, bool callback_form) {
  if (d->kind == SCR_DYN_STR) {
    ScrStr *enc = scr_str_new("utf8", 4);
    ScrBytes *b = scr_bytes_from_str(d->v.str, enc);
    scr_str_release(enc);
    return b;
  }
  if (d->kind == SCR_DYN_BYTES || d->kind == SCR_DYN_ARRBUF) {
    const ScrBytes *src = d->v.bytes;
    size_t n = src->len * scr_bytes_elem_size(src->elem);
    ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)n);
    if (n > 0) memcpy(b->data, src->data, n);
    return b;
  }
  /* The callback forms hand the data to the engine's end(), whose own check
   * names `chunk` and does not list ArrayBuffer (zlibBuffer converts a real
   * ArrayBuffer first, which is the arm above). */
  if (callback_form) {
    scr_dyn_arg_type_fail("chunk", "of type string or an instance of Buffer, TypedArray, or DataView", d);
  } else {
    scr_dyn_arg_type_fail("buffer", "of type string or an instance of Buffer, TypedArray, DataView, or ArrayBuffer", d);
  }
  return NULL;
}

static void zl_too_large(double max) {
  char msg[96];
  int n = snprintf(msg, sizeof msg, "Cannot create a Buffer larger than %.0f bytes", max);
  scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_BUFFER_TOO_LARGE");
}

static ScrBytes *zl_finish(uint8_t *buf, size_t len) {
  ScrBytes *out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)len));
  memcpy(out->data, buf, len);
  free(buf);
  return out;
}

static ScrBytes *zl_deflate_opts(const ScrBytes *data, int mode, const ScrZlOpts *o) {
  z_stream zs;
  memset(&zs, 0, sizeof zs);
  int wbits = o->window_bits;
  if (mode == 1) wbits = wbits == 8 ? -9 : -wbits; /* raw; zlib refuses 8 */
  else if (mode == 2) wbits += 16;
  else if (wbits == 8) wbits = 9;
  if (deflateInit2(&zs, o->level, Z_DEFLATED, wbits, o->mem_level, o->strategy) != Z_OK) scr_zlib_oom();
  if (o->dict && mode != 2) deflateSetDictionary(&zs, o->dict->data, (uInt)o->dict->len);
  uLong cap = deflateBound(&zs, (uLong)data->len);
  uint8_t *buf = malloc(cap ? cap : 1);
  if (!buf) scr_zlib_oom();
  zs.next_in = data->data;
  zs.avail_in = (uInt)data->len;
  zs.next_out = buf;
  zs.avail_out = (uInt)cap;
  int rc = deflate(&zs, Z_FINISH);
  if (rc != Z_STREAM_END) scr_zlib_oom();
  size_t len = cap - zs.avail_out;
  deflateEnd(&zs);
  if ((double)len > o->max_out) {
    free(buf);
    zl_too_large(o->max_out);
    return NULL;
  }
  return zl_finish(buf, len);
}

static ScrBytes *zl_inflate_opts(const ScrBytes *data, int mode, const ScrZlOpts *o) {
  z_stream zs;
  memset(&zs, 0, sizeof zs);
  int wbits = o->window_bits;
  if (mode == 1) wbits = -wbits;
  else if (mode == 2) wbits += 16;
  else if (mode == 3) wbits += 32;
  if (inflateInit2(&zs, wbits) != Z_OK) scr_zlib_oom();
  if (o->dict && mode == 1) inflateSetDictionary(&zs, o->dict->data, (uInt)o->dict->len);
  size_t cap = data->len > 64 ? data->len * 4 : 256;
  uint8_t *buf = malloc(cap);
  if (!buf) scr_zlib_oom();
  zs.next_in = data->data;
  zs.avail_in = (uInt)data->len;
  size_t len = 0;
  for (;;) {
    zs.next_out = buf + len;
    zs.avail_out = (uInt)(cap - len);
    int rc = inflate(&zs, Z_NO_FLUSH);
    if (rc == Z_NEED_DICT && o->dict) {
      if (inflateSetDictionary(&zs, o->dict->data, (uInt)o->dict->len) == Z_OK) continue;
    }
    len = cap - zs.avail_out;
    if ((double)len > o->max_out) {
      inflateEnd(&zs);
      free(buf);
      zl_too_large(o->max_out);
      return NULL;
    }
    if (rc == Z_STREAM_END) break;
    if (rc == Z_OK || rc == Z_BUF_ERROR) {
      if (rc == Z_BUF_ERROR && zs.avail_in == 0 && zs.avail_out > 0) {
        inflateEnd(&zs);
        free(buf);
        static const char msg[] = "unexpected end of file";
        scr_throw_errno_error_raw(-5, "Z_BUF_ERROR", msg, sizeof msg - 1);
        return NULL;
      }
      if (cap - len < 64) {
        size_t want = cap * 2;
        if (isfinite(o->max_out) && want > (size_t)o->max_out + 64) want = (size_t)o->max_out + 64;
        if (want <= cap) want = cap + 64;
        cap = want;
        uint8_t *grown = realloc(buf, cap);
        if (!grown) scr_zlib_oom();
        buf = grown;
      }
      continue;
    }
    const char *msg = zs.msg ? zs.msg : (rc == Z_NEED_DICT ? "Missing dictionary" : "zlib error");
    size_t mlen = strlen(msg);
    const char *code = rc == Z_DATA_ERROR ? "Z_DATA_ERROR"
                       : rc == Z_NEED_DICT ? "Z_NEED_DICT"
                       : rc == Z_MEM_ERROR ? "Z_MEM_ERROR"
                                           : "Z_STREAM_ERROR";
    inflateEnd(&zs);
    free(buf);
    scr_throw_errno_error_raw((double)rc, code, msg, mlen);
    return NULL;
  }
  inflateEnd(&zs);
  return zl_finish(buf, len);
}

static ScrBytes *zl_run(int op, const ScrDyn *data, const ScrDyn *opts, bool callback_form) {
  ScrBytes *in = zl_input_bytes(data, callback_form);
  if (in == NULL) return NULL;
  ScrZlOpts o;
  if (!zl_parse_opts(opts, &o)) {
    scr_bytes_release(in);
    return NULL;
  }
  static const int mode_of[7] = {0, 0, 2, 2, 3, 1, 1};
  ScrBytes *out = (op == 0 || op == 2 || op == 5) ? zl_deflate_opts(in, mode_of[op], &o)
                                                    : zl_inflate_opts(in, mode_of[op], &o);
  zl_opts_free(&o);
  scr_bytes_release(in);
  return out;
}

/* zlib.<op>Sync(data[, options]) over untyped operands. +1 Buffer or NULL
 * with the throw pending. Borrows. */
ScrBytes *scr_zlib_sync_dyn(double op, const ScrDyn *data, const ScrDyn *opts) {
  return zl_run((int)op, data, opts, false);
}

static void zl_cb_fire(ScrClosure *c) {
  ScrDyn *cb = (ScrDyn *)scr_box_get_ref(c->caps[0]);
  ScrDyn *data = (ScrDyn *)scr_box_get_ref(c->caps[1]);
  ScrDyn *opts = (ScrDyn *)scr_box_get_ref(c->caps[2]);
  ScrDyn *opn = (ScrDyn *)scr_box_get_ref(c->caps[3]);
  ScrBytes *out = zl_run((int)opn->v.num, data, opts, true);
  ScrDyn *args[2];
  if (out != NULL) {
    args[0] = scr_dyn_new_null();
    args[1] = scr_dyn_new_bytes_ref(out);
    scr_bytes_release(out);
  } else {
    ScrCaught *caught = scr_exc_take();
    /* A zlib failure is a ScrError, whose dyn encoding is in the always-linked
     * scr_json.c (scr_caught_to_dyn lives in the gated async unit, which a zlib
     * program does not link). */
    args[0] = (caught->kind == SCR_EXC_OBJ && caught->payload != NULL && scr_error_is(caught->payload))
                  ? scr_dyn_from_error((const ScrError *)caught->payload)
                  : scr_dyn_retain(scr_dyn_undefined());
    scr_caught_release(caught);
    args[1] = scr_dyn_retain(scr_dyn_undefined());
  }
  ScrDyn *r = scr_dyn_call(cb, args, 2, "zlib callback");
  if (r != NULL) scr_dyn_release(r);
  scr_dyn_release(args[0]);
  scr_dyn_release(args[1]);
  scr_dyn_release(cb);
  scr_dyn_release(data);
  scr_dyn_release(opts);
  scr_dyn_release(opn);
}

static ScrBox *zl_box(ScrDyn *v /* +1 moves */) {
  ScrBox *b = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(b, v);
  return b;
}

/* zlib.<op>(data[, options], callback): the callback is validated now
 * (ERR_INVALID_ARG_TYPE, like Node's callback check), the data and options
 * are captured, and the codec runs and the callback fires from an immediate.
 * An argument error is delivered the same way Node delivers it: thrown
 * synchronously for the buffer and options, never through the callback. */
void scr_zlib_cb_dyn(double op, const ScrDyn *data, const ScrDyn *a1, const ScrDyn *a2) {
  const ScrDyn *opts = a1;
  const ScrDyn *cb = a2;
  if (a2 == NULL || a2->kind == SCR_DYN_UNDEF) {
    opts = NULL;
    cb = a1;
  }
  if (cb == NULL || cb->kind != SCR_DYN_FUNC) {
    scr_dyn_arg_type_fail("callback", "of type function", cb == NULL ? scr_dyn_undefined() : cb);
    return;
  }
  /* Node validates the buffer and options before scheduling anything. */
  ScrBytes *probe = zl_input_bytes(data, true);
  if (probe == NULL) return;
  scr_bytes_release(probe);
  ScrZlOpts o;
  if (!zl_parse_opts(opts, &o)) return;
  zl_opts_free(&o);
  ScrClosure *c = scr_closure_new((void *)zl_cb_fire, 4);
  c->caps[0] = zl_box(scr_dyn_retain((ScrDyn *)cb));
  c->caps[1] = zl_box(scr_dyn_retain((ScrDyn *)data));
  c->caps[2] = zl_box(opts == NULL ? scr_dyn_retain(scr_dyn_undefined()) : scr_dyn_retain((ScrDyn *)opts));
  c->caps[3] = zl_box(scr_dyn_new_num(op));
  scr_set_immediate(c);
}
