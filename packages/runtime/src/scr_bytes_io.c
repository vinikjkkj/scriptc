/* The OS-facing half of the typed-array/Buffer runtime: fs Buffer reads/
 * writes (scr_lib.c's throw formatting), the fs/promises bytes form
 * (scr_async.c's settled-promise minting), crypto.randomBytes, and the
 * process stream Buffer writes. Split from scr_bytes.c so the pure bytes
 * core links without the lib/async runtimes (the runtime unit tests link
 * exact source lists). */
#include "scr_runtime.h"

#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>
#ifdef _WIN32
#include <io.h>
#else
#include <unistd.h>
#endif
#ifdef __APPLE__
#include <sys/stat.h> /* lchmod(2) — the fs.lchmodSync ladder's real tail */
#endif

static void scr_bytes_io_oom(void) {
  scr_trap("scriptc: out of memory\n");
}

/* ── fs (the Buffer forms of scr_lib.c's utf8 pair) ────────────────────── */

ScrBytes *scr_fs_read_file_bytes(ScrStr *path) {
  FILE *f = fopen(path->data, "rb");
  if (!f) {
    scr_fs_throw(errno, "open", path);
    return NULL;
  }
  size_t cap = 4096, len = 0;
  uint8_t *buf = malloc(cap);
  if (!buf) scr_bytes_io_oom();
  for (;;) {
    if (cap - len < 2048) {
      cap *= 2;
      uint8_t *grown = realloc(buf, cap);
      if (!grown) scr_bytes_io_oom();
      buf = grown;
    }
    size_t n = fread(buf + len, 1, cap - len, f);
    len += n;
    if (n == 0) break;
  }
  if (ferror(f)) {
    int e = errno;
    fclose(f);
    free(buf);
    scr_fs_throw_nopath(e, "read"); /* a failed read(2) names no path in Node */
    return NULL;
  }
  fclose(f);
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)len);
  memcpy(b->data, buf, len);
  free(buf);
  return scr_bytes_stamp_buffer(b); /* Node: readFileSync without an encoding answers a Buffer */
}

/* Canonical lower-case spelling of a Buffer encoding name (Node's alias
 * set, case-insensitive), or NULL when it names none. */
static const char *scr_fs_enc_canon(const ScrStr *e) {
  char lo[16];
  if (e->len == 0 || e->len >= sizeof lo) return NULL;
  for (size_t i = 0; i < e->len; i++) {
    char c = e->data[i];
    lo[i] = (c >= 'A' && c <= 'Z') ? (char)(c + 32) : c;
  }
  lo[e->len] = 0;
  if (!strcmp(lo, "utf8") || !strcmp(lo, "utf-8")) return "utf8";
  if (!strcmp(lo, "ucs2") || !strcmp(lo, "ucs-2") || !strcmp(lo, "utf16le") || !strcmp(lo, "utf-16le")) return "utf16le";
  if (!strcmp(lo, "latin1") || !strcmp(lo, "binary")) return "latin1";
  if (!strcmp(lo, "ascii")) return "ascii";
  if (!strcmp(lo, "hex")) return "hex";
  if (!strcmp(lo, "base64")) return "base64";
  if (!strcmp(lo, "base64url")) return "base64url";
  return NULL;
}

/* readFileSync's runtime-encoding form (a JS helper's untyped `enc`
 * parameter — test/common fixtures.js): undefined/null answer a Buffer,
 * utf8 answers a string, Node's other real encodings meet the loud
 * not-supported ladder, unknown names throw ERR_UNKNOWN_ENCODING, and an
 * options object dispatches on its `encoding` member (Node's form). +1
 * dyn value, or NULL with the exception pending. */
ScrDyn *scr_fs_read_file_sync_dyn(ScrStr *path, const ScrDyn *enc) {
  if (enc->kind == SCR_DYN_OBJ) {
    ScrDyn *ev = scr_dyn_obj_get((ScrDyn *)enc, "encoding", 8); /* borrowed */
    return scr_fs_read_file_sync_dyn(path, ev ? ev : scr_dyn_undefined());
  }
  if (enc->kind == SCR_DYN_UNDEF || enc->kind == SCR_DYN_NULL) {
    ScrBytes *b = scr_fs_read_file_bytes(path);
    if (!b) return NULL;
    ScrDyn *d = scr_dyn_new_buffer_copy(b);
    scr_bytes_release(b);
    return d;
  }
  if (enc->kind == SCR_DYN_STR) {
    const ScrStr *e = enc->v.str;
    if ((e->len == 4 && memcmp(e->data, "utf8", 4) == 0) ||
        (e->len == 5 && memcmp(e->data, "utf-8", 5) == 0)) {
      ScrStr *text = scr_fs_read_file(path);
      if (!text) return NULL;
      ScrDyn *d = scr_dyn_new_str(text);
      scr_str_release(text);
      return d;
    }
    const char *canon = scr_fs_enc_canon(e);
    if (canon != NULL) {
      /* Node decodes the file's bytes with buffer.toString(encoding). */
      ScrBytes *b = scr_fs_read_file_bytes(path);
      if (!b) return NULL;
      ScrStr *name = scr_str_new(canon, strlen(canon));
      ScrStr *text = scr_bytes_to_str(b, name);
      scr_str_release(name);
      scr_bytes_release(b);
      ScrDyn *d = scr_dyn_new_str(text);
      scr_str_release(text);
      return d;
    }
    char msg[128];
    int n = snprintf(msg, sizeof msg, "Unknown encoding: %.*s",
                     (int)(e->len < 64 ? e->len : 64), e->data);
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, (size_t)n, "ERR_UNKNOWN_ENCODING");
    return NULL;
  }
  {
    /* Kind rendering stays local: scr_dyn_specific_type lives in the
     * net/emitter-gated handle unit and this one links with bare fs. */
    const char *msg = "The \"options\" argument must be of type string or an instance of Object";
    scr_throw_error_msg_code(SCR_ERR_TYPE, msg, strlen(msg), "ERR_INVALID_ARG_TYPE");
    return NULL;
  }
}

void scr_fs_write_file_bytes(ScrStr *path, const ScrBytes *data) {
  FILE *f = fopen(path->data, "wb");
  if (!f) {
    scr_fs_throw(errno, "open", path);
    return;
  }
  size_t n = data->len * scr_bytes_elem_size(data->elem);
  if (n > 0 && fwrite(data->data, 1, n, f) != n) {
    int e = errno;
    fclose(f);
    scr_fs_throw(e, "write", path);
    return;
  }
  if (fclose(f) != 0) scr_fs_throw(errno, "close", path);
}

ScrPromise *scr_fsp_read_file_bytes(ScrStr *path) {
  ScrBytes *b = scr_fs_read_file_bytes(path);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

/* ── crypto.randomBytes → a real Buffer ────────────────────────────────── */

ScrBytes *scr_crypto_random_bytes(double n) {
  if (!(n >= 0 && n <= 2147483647)) {
    char num[32];
    size_t numlen = scr_f64_to_str(n, num);
    char msg[128];
    int mlen = snprintf(
        msg, sizeof msg,
        "The value of \"size\" is out of range. It must be >= 0 && <= 2147483647. Received %.*s",
        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return NULL;
  }
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, n);
  if (b->len > 0) arc4random_buf(b->data, b->len);
  return scr_bytes_stamp_buffer(b); /* Node: randomBytes answers a Buffer */
}

/* ── process.stdout/stderr.write(buf) ──────────────────────────────────── */

bool scr_process_stdout_write_bytes(const ScrBytes *b) {
  scr_stdio_write(1, b->data, b->len * scr_bytes_elem_size(b->elem));
  return true;
}

bool scr_process_stderr_write_bytes(const ScrBytes *b) {
  scr_stdio_write(2, b->data, b->len * scr_bytes_elem_size(b->elem));
  return true;
}

/* ── the checked-dynamic Buffer compare/equals validators ──────────────
 * Node's argument ladders for buf.equals / buf.compare / Buffer.compare
 * over dyn-boxed arguments (the invalid-input probes: string needles,
 * '0' offsets, null/object range args). A well-typed dyn still computes
 * the real answer — validation, not a constant fence. */

/* A bytes payload or the API's own ERR_INVALID_ARG_TYPE (borrowed). */
static ScrBytes *scr_bytes_chk_u8(const ScrDyn *d, const char *argname) {
  if (d->kind != SCR_DYN_BYTES) {
    scr_dyn_arg_type_fail(argname, "an instance of Buffer or Uint8Array", d);
    return NULL;
  }
  return d->v.bytes;
}

double scr_buffer_compare_chk(const ScrDyn *a, const ScrDyn *b) {
  ScrBytes *b1 = scr_bytes_chk_u8(a, "buf1");
  if (!b1) return 0;
  ScrBytes *b2 = scr_bytes_chk_u8(b, "buf2");
  if (!b2) return 0;
  return scr_bytes_compare(b1, b2, 0, 0, 0, 0, 0);
}

/* Buffer.concat over a checked-dynamic list (an untyped `chunks` array of
 * Buffers): Node's validateArray / per-element ERR_INVALID_ARG_TYPE ladder,
 * then the same concatenation (and, with a total, the same truncate or
 * zero-pad) the static form runs. */
static ScrBytes *scr_buffer_concat_dyn_impl(const ScrDyn *list, const ScrDyn *total_arg) {
  if (list == NULL || list->kind != SCR_DYN_ARR) {
    scr_dyn_arg_type_fail("list", "an instance of Array", list);
    return NULL;
  }
  size_t n = (size_t)scr_dyn_arr_len(list);
  if (n == 0) return scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, 0));
  bool has_total = total_arg != NULL && total_arg->kind != SCR_DYN_UNDEF;
  double total = 0;
  if (has_total) {
    if (total_arg->kind != SCR_DYN_NUM) {
      scr_dyn_arg_type_fail("length", "of type number", total_arg);
      return NULL;
    }
    total = total_arg->v.num;
    if (!scr_bytes_validate_off("length", total, 9007199254740991.0)) return NULL;
  }
  size_t sum = 0;
  for (size_t i = 0; i < n; i++) {
    ScrDyn *e = scr_dyn_arr_at(list, (double)i);
    if (!has_total && (e->kind == SCR_DYN_NULL || e->kind == SCR_DYN_UNDEF)) {
      char msg[96];
      int ml = snprintf(msg, sizeof msg, "Cannot read properties of %s (reading 'length')",
                        e->kind == SCR_DYN_NULL ? "null" : "undefined");
      scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)ml);
      scr_dyn_release(e);
      return NULL;
    }
    if (e->kind == SCR_DYN_BYTES && e->v.bytes != NULL) sum += e->v.bytes->len;
    scr_dyn_release(e);
  }
  for (size_t i = 0; i < n; i++) {
    ScrDyn *e = scr_dyn_arr_at(list, (double)i);
    bool ok = e->kind == SCR_DYN_BYTES && e->v.bytes != NULL && e->v.bytes->elem == SCR_BYTES_U8 &&
              e->v.bytes->flavor != SCR_BF_DATAVIEW;
    if (!ok) {
      char name[40];
      snprintf(name, sizeof name, "list[%zu]", i);
      scr_dyn_arg_type_fail(name, "an instance of Buffer or Uint8Array", e);
      scr_dyn_release(e);
      return NULL;
    }
    scr_dyn_release(e);
  }
  size_t cap = has_total ? (size_t)total : sum;
  ScrBytes *out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, (double)cap));
  size_t o = 0;
  for (size_t i = 0; i < n && o < cap; i++) {
    ScrDyn *e = scr_dyn_arr_at(list, (double)i);
    const ScrBytes *part = e->v.bytes;
    size_t take = part->len < cap - o ? part->len : cap - o;
    memcpy(out->data + o, part->data, take);
    o += take;
    scr_dyn_release(e);
  }
  return out;
}

ScrBytes *scr_buffer_concat_dyn(const ScrDyn *list) { return scr_buffer_concat_dyn_impl(list, NULL); }
/* `total` is whatever the program passed: undefined means "no total" (JS
 * treats a missing and an undefined argument alike). */
ScrBytes *scr_buffer_concat_dyn_len(const ScrDyn *list, const ScrDyn *total) {
  return scr_buffer_concat_dyn_impl(list, total);
}

bool scr_bytes_equals_chk(const ScrBytes *recv, const ScrDyn *other) {
  ScrBytes *o = scr_bytes_chk_u8(other, "otherBuffer");
  if (!o) return false;
  return scr_bytes_equals(recv, o);
}

/* One offset slot: undefined takes the Node default, non-numbers throw
 * ERR_INVALID_ARG_TYPE "of type number", numbers run validateOffset. */
static bool scr_bytes_chk_off(const ScrDyn *d, const char *name, double max,
                              double dflt, double *out) {
  if (d->kind == SCR_DYN_UNDEF) {
    *out = dflt;
    return true;
  }
  if (d->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail(name, "of type number", d);
    return false;
  }
  *out = d->v.num;
  return scr_bytes_validate_off(name, *out, max);
}

double scr_bytes_compare_chk(const ScrBytes *src, const ScrDyn *target,
                             const ScrDyn *ts, const ScrDyn *te,
                             const ScrDyn *ss, const ScrDyn *se) {
  ScrBytes *t = scr_bytes_chk_u8(target, "target");
  if (!t) return 0;
  double tsv, tev, ssv, sev;
  if (!scr_bytes_chk_off(ts, "targetStart", 9007199254740991.0, 0, &tsv)) return 0;
  if (!scr_bytes_chk_off(te, "targetEnd", (double)t->len, (double)t->len, &tev)) return 0;
  if (!scr_bytes_chk_off(ss, "sourceStart", 9007199254740991.0, 0, &ssv)) return 0;
  if (!scr_bytes_chk_off(se, "sourceEnd", (double)src->len, (double)src->len, &sev)) return 0;
  /* Every slot validated or defaulted above; nargs 4 revalidates the
   * now-known-good numbers (a no-op) and keeps one comparison core. */
  return scr_bytes_compare(src, t, 4, tsv, tev, ssv, sev);
}

/* new Buffer(number, encoding) — the deprecated ctor's string arm with a
 * non-string first argument: Node's exact ERR_INVALID_ARG_TYPE (the
 * throwing path never fires DEP0005, so compiled silence matches). */
ScrBytes *scr_buffer_new_string_fail(const ScrDyn *got) {
  scr_dyn_arg_type_fail("string", "of type string", got);
  return NULL;
}

/* fs._toUnixTimestamp — the seconds coercion the utimes family runs on
 * its time arguments (fs.js's toUnixTimestamp, underscore-exported):
 * numeric STRINGS pass ToNumber's loose-equality gate (+time == time —
 * whitespace-only strings answer 0), finite numbers pass (negatives
 * answer now/1000, Node's "past times" shape), everything else throws
 * Node's exact ERR_INVALID_ARG_TYPE. Borrowed; the throw is pending on
 * the dummy 0 return. */
double scr_fs_to_unix_timestamp(const ScrDyn *t) {
  if (t->kind == SCR_DYN_STR) {
    double n = scr_string_to_number(t->v.str);
    /* +time == time: NaN fails; every parsed number loosely equals its
     * own source string by construction of ToNumber. */
    if (n == n) return n;
  }
  if (t->kind == SCR_DYN_NUM && isfinite(t->v.num)) {
    if (t->v.num < 0) {
      struct timespec ts;
      clock_gettime(CLOCK_REALTIME, &ts);
      return ((double)ts.tv_sec * 1000.0 + (double)ts.tv_nsec / 1e6) / 1000.0;
    }
    return t->v.num;
  }
  scr_dyn_arg_type_fail("time", "an instance of Date or an Time in seconds", t);
  return 0;
}

/* ── the fs argument-validation ladders (checked-dynamic lane) ─────────
 * Each fs.*Chk libCall replicates its API's Node-order validation over
 * dyn values and throws Node's exact typed errors; when every validation
 * passes, the honest tail runs — the real operation where one exists
 * (mkdtempSync, lchmodSync on macOS), the compiler-rendered SC2020 fence
 * otherwise (scr_throw_lowering_fence). All arguments borrowed. */

static bool scr_fs_dyn_absent(const ScrDyn *v) {
  return v->kind == SCR_DYN_UNDEF || v->kind == SCR_DYN_NULL;
}

static bool scr_fs_str_is(const ScrStr *s, const char *lit) {
  size_t n = strlen(lit);
  return s->len == n && memcmp(s->data, lit, n) == 0;
}

/* Node's maybeCallback/validateFunction over a callback slot. */
static bool scr_fs_cb_chk(const ScrDyn *cb, const char *name) {
  if (cb->kind == SCR_DYN_FUNC) return true;
  scr_dyn_arg_type_fail(name, "of type function", cb);
  return false;
}

/* getValidatedPath: strings and Buffers pass (URL instances never reach
 * these ladders — the checked-dynamic tree has no URL kind here, and Node would accept
 * only file: URLs anyway). */
static bool scr_fs_path_chk(const ScrDyn *p, const char *name) {
  if (p->kind == SCR_DYN_STR || p->kind == SCR_DYN_BYTES) return true;
  scr_dyn_arg_type_fail(name, "of type string or an instance of Buffer or URL", p);
  return false;
}

/* assertEncoding over an options slot (a bare encoding string or an
 * options record's `encoding` member): Node throws ERR_INVALID_ARG_VALUE
 * for any truthy value Buffer.isEncoding rejects. */
static bool scr_fs_encoding_chk(const ScrDyn *opts) {
  const ScrDyn *enc = opts;
  if (opts->kind == SCR_DYN_OBJ) {
    enc = scr_dyn_obj_get(opts, "encoding", 8);
    if (enc == NULL) return true;
  }
  if (scr_fs_dyn_absent(enc)) return true;
  if (enc->kind == SCR_DYN_STR) {
    if (enc->v.str->len == 0) return true; /* falsy: assertEncoding's `encoding &&` gate */
    if (scr_fs_str_is(enc->v.str, "buffer")) return true; /* getOptions skips assertEncoding for 'buffer' */
    if (scr_bytes_is_encoding(enc->v.str)) return true;
  }
  if (enc->kind == SCR_DYN_BOOL && !enc->v.b) return true;
  if (enc->kind == SCR_DYN_NUM && enc->v.num == 0) return true;
  scr_dyn_arg_value_fail("encoding", "is invalid encoding", enc);
  return false;
}

/* parseFileMode: integers 0..2^32-1 pass, octal strings parse, and the
 * rest throw Node's exact ladder (validateUint32's wording). */
static bool scr_fs_mode_chk(const ScrDyn *m, const char *name) {
  if (m->kind == SCR_DYN_STR) {
    const ScrStr *s = m->v.str;
    bool octal = s->len > 0;
    for (size_t i = 0; octal && i < s->len; i++) {
      if (s->data[i] < '0' || s->data[i] > '7') octal = false;
    }
    if (octal) return true;
    scr_dyn_arg_value_fail(name, "must be a 32-bit unsigned integer or an octal string", m);
    return false;
  }
  if (m->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail(name, "of type number", m);
    return false;
  }
  double v = m->v.num;
  if (!(isfinite(v) && trunc(v) == v)) {
    char recv[48], msg[160];
    scr_num_received(v, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be an integer. Received %s",
                       name, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  if (v < 0 || v > 4294967295.0) {
    char recv[48], msg[160];
    scr_num_received(v, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be >= 0 && <= 4294967295. Received %s",
                       name, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  return true;
}

/* fs.exists(path, cb) — the REAL deprecated-API shape: the callback
 * validates synchronously (Node's one throwing arm), and the answer
 * arrives asynchronously through it — string/Buffer paths run the
 * existsSync probe at fire time, every other path kind answers `false`
 * (Node swallows getValidatedPath failures there). The loop-held timer
 * matches Node's I/O-completion timing closely enough for the
 * sequential CLI corpus. */
#ifndef SCR_LIB
static void scr_fs_exists_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]); /* +1 */
  ScrDyn *cb = scr_box_get_ref(self->caps[1]);   /* +1 */
  bool ans = false;
  if (path->kind == SCR_DYN_STR) {
    ScrStr *p = scr_str_retain(path->v.str);
    ans = scr_fs_exists(p);
    scr_str_release(p);
  } else if (path->kind == SCR_DYN_BYTES) {
    ScrStr *p = scr_str_new((const char *)path->v.bytes->data, path->v.bytes->len);
    ans = scr_fs_exists(p);
    scr_str_release(p);
  }
  ScrDyn *arg = scr_dyn_new_bool(ans);
  ScrDyn *r = scr_dyn_call(cb, &arg, 1, "the fs.exists callback");
  scr_dyn_release(arg);
  scr_dyn_release(r);
  scr_dyn_release(path);
  scr_dyn_release(cb);
}
#endif

ScrDyn *scr_fs_exists_async(const ScrDyn *path, const ScrDyn *cb) {
  if (!scr_fs_cb_chk(cb, "cb")) return NULL;
  if (path->kind != SCR_DYN_STR && path->kind != SCR_DYN_BYTES) {
    /* Node's wart, kept exactly: a path getValidatedPath rejects answers
     * false through the callback SYNCHRONOUSLY (`return callback(false)`
     * in lib/fs.js exists). */
    ScrDyn *arg = scr_dyn_new_bool(false);
    ScrDyn *r = scr_dyn_call(cb, &arg, 1, "the fs.exists callback");
    scr_dyn_release(arg);
    scr_dyn_release(r);
    if (scr_exc_pending()) return NULL;
    return scr_dyn_retain(scr_dyn_undefined());
  }
#ifdef SCR_LIB
  /* Library links exclude the event-loop unit, and the compile-time scan
   * refuses the fs.exists surface (SC4005's family) — this arm exists
   * only so the TU links without scr_async. Unreachable by construction. */
  scr_trap("scriptc: internal error: fs.exists async fire reached in a library build — please report this");
  return NULL;
#else
  ScrClosure *clo = scr_closure_new((void *)scr_fs_exists_fire, 2);
  clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[0], scr_dyn_retain((ScrDyn *)path));
  clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
  scr_box_set_ref(clo->caps[1], scr_dyn_retain((ScrDyn *)cb));
  scr_set_timeout(clo, 0);
  return scr_dyn_retain(scr_dyn_undefined());
#endif
}


/* ── the callback fs forms and mkdtempSync's option forms ──────────────
 * Each follows lib/fs.js's argument order exactly (read from the source of
 * Node v24.15.0): the callback check, getOptions' type and encoding checks,
 * then the path or buffer contract; every failure past that point rides the
 * callback, one loop turn later. The operation itself runs at fire time
 * through the same sync functions the *Sync forms use. */

static bool scr_fs_int_range_chk(const ScrDyn *v, const char *name, double min, double max, const char *range);
static bool scr_fs_lchmod_defined(const char *api);

static const char *scr_fs_opt_encoding(const ScrDyn *opts, bool *is_buffer) {
  *is_buffer = false;
  const ScrDyn *enc = opts;
  if (opts->kind == SCR_DYN_OBJ) enc = scr_dyn_obj_get(opts, "encoding", 8);
  if (enc == NULL || enc->kind != SCR_DYN_STR || enc->v.str->len == 0) return "";
  if (scr_fs_str_is(enc->v.str, "buffer")) {
    *is_buffer = true;
    return "";
  }
  const char *c = scr_fs_enc_canon(enc->v.str);
  return c != NULL ? c : "";
}

/* getOptions' type gate: nullish and functions are the defaults; strings
 * and objects pass to assertEncoding; anything else is a type error. */
static bool scr_fs_get_options(const ScrDyn *opts) {
  if (scr_fs_dyn_absent(opts) || opts->kind == SCR_DYN_FUNC) return true;
  if (opts->kind != SCR_DYN_STR && opts->kind != SCR_DYN_OBJ) {
    scr_dyn_arg_type_fail("options", "one of type string or object", opts);
    return false;
  }
  return scr_fs_encoding_chk(opts);
}

static ScrStr *scr_fs_path_str(const ScrDyn *p) {
  if (p->kind == SCR_DYN_STR) return scr_str_retain(p->v.str);
  return scr_str_new((const char *)p->v.bytes->data, p->v.bytes->len);
}

#ifndef SCR_LIB
/* The pending exception as a dyn value. Every fs failure is a ScrError, whose
 * dyn encoding lives in the always-linked scr_json.c (scr_caught_to_dyn is in
 * the gated async unit, which a plain fs program does not link). */
static ScrDyn *scr_fs_take_error_dyn(void) {
  ScrCaught *c = scr_exc_take();
  ScrDyn *e = (c->kind == SCR_EXC_OBJ && c->payload != NULL && scr_error_is(c->payload))
                  ? scr_dyn_from_error((const ScrError *)c->payload)
                  : scr_dyn_retain(scr_dyn_undefined());
  scr_caught_release(c);
  return e;
}

/* cb(err) / cb(null, ...results): the loop turn's call into user code; a
 * throw in the callback stays pending (an uncaught exception, like Node's). */
static void scr_fs_cb_finish(ScrDyn *cb, ScrDyn *const *vals, size_t nvals, const char *what) {
  ScrDyn *r;
  if (scr_exc_pending()) {
    ScrDyn *err = scr_fs_take_error_dyn();
    r = scr_dyn_call(cb, &err, 1, what);
    scr_dyn_release(err);
  } else {
    ScrDyn *args[4];
    args[0] = scr_dyn_new_null();
    for (size_t i = 0; i < nvals && i < 3; i++) args[i + 1] = vals[i];
    r = scr_dyn_call(cb, args, nvals + 1, what);
    scr_dyn_release(args[0]);
  }
  if (r != NULL) scr_dyn_release(r);
}

static ScrClosure *scr_fs_cb_closure(void (*fire)(ScrClosure *), size_t n, const ScrDyn *const *vals) {
  ScrClosure *clo = scr_closure_new((void *)fire, n);
  for (size_t i = 0; i < n; i++) {
    clo->caps[i] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
    scr_box_set_ref(clo->caps[i], scr_dyn_retain((ScrDyn *)vals[i]));
  }
  return clo;
}
#endif

#ifndef SCR_LIB
/* The bytes of everything readable from `fd` from its current position. */
static ScrBytes *scr_fs_read_fd_all(int fd) {
  size_t cap = 4096, len = 0;
  uint8_t *buf = malloc(cap);
  if (!buf) scr_bytes_io_oom();
  for (;;) {
    if (cap - len < 2048) {
      cap *= 2;
      uint8_t *grown = realloc(buf, cap);
      if (!grown) scr_bytes_io_oom();
      buf = grown;
    }
    ssize_t n = read(fd, buf + len, cap - len);
    if (n < 0) {
      int e = errno;
      free(buf);
      ScrStr *none = scr_str_new("", 0);
      scr_fs_throw(e, "read", none);
      scr_str_release(none);
      return NULL;
    }
    if (n == 0) break;
    len += (size_t)n;
  }
  ScrBytes *b = scr_bytes_new(SCR_BYTES_U8, (double)len);
  memcpy(b->data, buf, len);
  free(buf);
  return scr_bytes_stamp_buffer(b);
}
#endif

/* The encoded form of a finished read: Buffer for none, the decoded
 * string for a named encoding. +1 dyn. */
static ScrDyn *scr_fs_bytes_result(ScrBytes *b, const char *canon) {
  if (canon[0] == 0) {
    ScrDyn *d = scr_dyn_new_buffer_copy(b);
    return d;
  }
  ScrStr *name = scr_str_new(canon, strlen(canon));
  ScrStr *text = scr_bytes_to_str(b, name);
  scr_str_release(name);
  ScrDyn *d = scr_dyn_new_str(text);
  scr_str_release(text);
  return d;
}

#ifndef SCR_LIB
static void scr_fs_read_file_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *opts = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrDyn *out = NULL;
  if (path->kind == SCR_DYN_NUM) {
    ScrBytes *b = scr_fs_read_fd_all((int)path->v.num);
    if (b != NULL) {
      bool isbuf;
      const char *canon = scr_fs_opt_encoding(opts, &isbuf);
      out = scr_fs_bytes_result(b, canon);
      scr_bytes_release(b);
    }
  } else {
    ScrStr *p = scr_fs_path_str(path);
    out = scr_fs_read_file_sync_dyn(p, opts->kind == SCR_DYN_FUNC ? scr_dyn_undefined() : opts);
    scr_str_release(p);
  }
  scr_fs_cb_finish(cb, &out, out != NULL ? 1 : 0, "the fs.readFile callback");
  if (out != NULL) scr_dyn_release(out);
  scr_dyn_release(path);
  scr_dyn_release(opts);
  scr_dyn_release(cb);
}
#endif

/* fs.readFile(path, options?, cb) — `callback ||= options`, then Node's
 * order: cb, getOptions (type, assertEncoding), the path (an fd is a
 * non-negative integer; anything else must be a string or Buffer). */
ScrDyn *scr_fs_read_file_cb(const ScrDyn *path, const ScrDyn *opts, const ScrDyn *cb) {
  const ScrDyn *callback = scr_dyn_truthy(cb) ? cb : opts;
  if (!scr_fs_cb_chk(callback, "cb")) return NULL;
  if (!scr_fs_get_options(opts)) return NULL;
  bool is_fd = path->kind == SCR_DYN_NUM && path->v.num >= 0 && path->v.num <= 4294967295.0 &&
               trunc(path->v.num) == path->v.num;
  if (!is_fd && !scr_fs_path_chk(path, "path")) return NULL;
#ifdef SCR_LIB
  scr_trap("scriptc: internal error: fs.readFile callback reached in a library build — please report this");
  return NULL;
#else
  const ScrDyn *vals[3] = {path, opts, callback};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_read_file_fire, 3, vals), 0);
  return scr_dyn_retain(scr_dyn_undefined());
#endif
}

/* The path mkdtemp answers, in the requested encoding: the utf8 string, a
 * Buffer for 'buffer', or the path's bytes decoded as the named encoding. */
static ScrDyn *scr_fs_mkdtemp_result(ScrStr *made, const ScrDyn *opts) {
  bool isbuf;
  const char *canon = scr_fs_opt_encoding(opts, &isbuf);
  if (!isbuf && (canon[0] == 0 || strcmp(canon, "utf8") == 0)) return scr_dyn_new_str(made);
  ScrStr *u8 = scr_str_new("utf8", 4);
  ScrBytes *b = scr_bytes_from_str(made, u8);
  scr_str_release(u8);
  ScrDyn *d = scr_fs_bytes_result(b, isbuf ? "" : canon);
  scr_bytes_release(b);
  return d;
}

#ifndef SCR_LIB
static void scr_fs_mkdtemp_fire(ScrClosure *self) {
  ScrDyn *prefix = scr_box_get_ref(self->caps[0]);
  ScrDyn *opts = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrStr *p = scr_fs_path_str(prefix);
  ScrStr *made = scr_fs_mkdtemp(p);
  scr_str_release(p);
  ScrDyn *out = NULL;
  if (made != NULL) {
    out = scr_fs_mkdtemp_result(made, opts);
    scr_str_release(made);
  }
  scr_fs_cb_finish(cb, &out, out != NULL ? 1 : 0, "the fs.mkdtemp callback");
  if (out != NULL) scr_dyn_release(out);
  scr_dyn_release(prefix);
  scr_dyn_release(opts);
  scr_dyn_release(cb);
}
#endif

/* fs.mkdtemp(prefix, options?, cb): the callback is `options` when that is
 * a function; then getOptions, then getValidatedPath(prefix, 'prefix'). */
ScrDyn *scr_fs_mkdtemp_cb(const ScrDyn *prefix, const ScrDyn *opts, const ScrDyn *cb) {
  const ScrDyn *callback = opts->kind == SCR_DYN_FUNC ? opts : cb;
  if (!scr_fs_cb_chk(callback, "cb")) return NULL;
  if (!scr_fs_get_options(opts)) return NULL;
  if (!scr_fs_path_chk(prefix, "prefix")) return NULL;
#ifdef SCR_LIB
  scr_trap("scriptc: internal error: fs.mkdtemp callback reached in a library build — please report this");
  return NULL;
#else
  const ScrDyn *vals[3] = {prefix, opts, callback};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_mkdtemp_fire, 3, vals), 0);
  return scr_dyn_retain(scr_dyn_undefined());
#endif
}

/* fs.mkdtempSync(prefix, options?): the prefix, then getOptions, then the
 * real mkdtemp(3) with the result in the requested encoding. +1 dyn or
 * NULL with the exception pending. */
ScrDyn *scr_fs_mkdtemp_sync_opts(const ScrDyn *prefix, const ScrDyn *opts) {
  if (!scr_fs_path_chk(prefix, "prefix")) return NULL;
  if (!scr_fs_get_options(opts)) return NULL;
  ScrStr *p = scr_fs_path_str(prefix);
  ScrStr *made = scr_fs_mkdtemp(p);
  scr_str_release(p);
  if (made == NULL) return NULL;
  ScrDyn *out = scr_fs_mkdtemp_result(made, opts);
  scr_str_release(made);
  return out;
}

/* fs.read — lib/fs.js's ladder over (fd, buffer, offsetOrOptions, length,
 * position, callback), argc being the count the caller wrote. */
static bool scr_fs_read_validate_integer(const ScrDyn *v, const char *name, double min, const char *range) {
  return scr_fs_int_range_chk(v, name, min, 9007199254740991.0, range);
}

#ifndef SCR_LIB
static void scr_fs_read_fire(ScrClosure *self) {
  ScrDyn *fd = scr_box_get_ref(self->caps[0]);
  ScrDyn *buf = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  ScrDyn *nums = scr_box_get_ref(self->caps[3]); /* [offset, length, position] */
  double off = nums->v.arr.items[0]->v.num;
  double len = nums->v.arr.items[1]->v.num;
  double pos = nums->v.arr.items[2]->v.num;
  double n = scr_fs_read_at(fd->v.num, buf->v.bytes, off, len, pos);
  ScrDyn *vals[2] = {NULL, buf};
  if (!scr_exc_pending()) {
    vals[0] = scr_dyn_new_num(n);
    scr_fs_cb_finish(cb, vals, 2, "the fs.read callback");
    scr_dyn_release(vals[0]);
  } else {
    scr_fs_cb_finish(cb, vals, 0, "the fs.read callback");
  }
  scr_dyn_release(fd);
  scr_dyn_release(buf);
  scr_dyn_release(cb);
  scr_dyn_release(nums);
}

static void scr_fs_read_zero_tick(ScrClosure *self) {
  ScrDyn *buf = scr_box_get_ref(self->caps[0]);
  ScrDyn *cb = scr_box_get_ref(self->caps[1]);
  ScrDyn *vals[2] = {scr_dyn_new_num(0), buf};
  scr_fs_cb_finish(cb, vals, 2, "the fs.read callback");
  scr_dyn_release(vals[0]);
  scr_dyn_release(buf);
  scr_dyn_release(cb);
}
#endif

static double scr_fs_toint32(double v) {
  if (!isfinite(v)) return 0;
  double m = fmod(trunc(v), 4294967296.0);
  if (m < 0) m += 4294967296.0;
  return (double)(int32_t)(uint32_t)m;
}

static ScrDyn *scr_fs_default_read_buffer(void) {
  ScrBytes *z = scr_bytes_new(SCR_BYTES_U8, 16384.0);
  memset(z->data, 0, 16384);
  ScrDyn *d = scr_dyn_new_buffer_copy(scr_bytes_stamp_buffer(z));
  scr_bytes_release(z);
  return d;
}

ScrDyn *scr_fs_read_cb(const ScrDyn *fd, const ScrDyn *buffer, const ScrDyn *a2, const ScrDyn *a3,
                       const ScrDyn *a4, const ScrDyn *a5, double argc) {
  /* getValidatedFd */
  if (fd->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail("fd", "of type number", fd);
    return NULL;
  }
  const ScrDyn *undef = scr_dyn_undefined();
  const ScrDyn *buf = buffer, *callback = a5;
  const ScrDyn *offv = a2, *lenv = a3, *posv = a4;
  bool lenFromBuffer = false; /* options omit `length`: byteLength - offset */
  ScrDyn *alloc = NULL;       /* the default 16384-byte buffer, owned here */
  ScrDyn *result = NULL;
  if (argc <= 4) {
    const ScrDyn *params = NULL;
    if (argc == 4) {
      /* fs.read(fd, buffer, options, callback) */
      if (a2->kind != SCR_DYN_OBJ && a2->kind != SCR_DYN_NULL) {
        scr_dyn_arg_type_fail("options", "of type object", a2);
        return NULL;
      }
      callback = a3;
      params = a2->kind == SCR_DYN_OBJ ? a2 : NULL;
    } else if (argc == 3) {
      /* fs.read(fd, bufferOrParams, callback) */
      callback = a2;
      if (buffer->kind != SCR_DYN_BYTES) {
        if (buffer->kind != SCR_DYN_OBJ && buffer->kind != SCR_DYN_NULL && buffer->kind != SCR_DYN_UNDEF) {
          scr_dyn_arg_type_fail("options", "of type object", buffer);
          return NULL;
        }
        params = buffer->kind == SCR_DYN_OBJ ? buffer : NULL;
        const ScrDyn *pb = params ? scr_dyn_obj_get((ScrDyn *)params, "buffer", 6) : NULL;
        if (pb != NULL && pb->kind != SCR_DYN_UNDEF) {
          buf = pb;
        } else {
          alloc = scr_fs_default_read_buffer();
          buf = alloc;
        }
      }
    } else {
      /* fs.read(fd, callback) */
      callback = buffer;
      alloc = scr_fs_default_read_buffer();
      buf = alloc;
    }
    offv = undef;
    lenv = undef;
    posv = undef;
    if (params != NULL) {
      const ScrDyn *o = scr_dyn_obj_get((ScrDyn *)params, "offset", 6);
      const ScrDyn *l = scr_dyn_obj_get((ScrDyn *)params, "length", 6);
      const ScrDyn *p = scr_dyn_obj_get((ScrDyn *)params, "position", 8);
      if (o != NULL) offv = o;
      if (l != NULL) lenv = l;
      if (p != NULL) posv = p;
    }
    lenFromBuffer = lenv->kind == SCR_DYN_UNDEF;
  }
  do {
    /* validateBuffer, then validateFunction(callback, 'cb') */
    if (buf->kind != SCR_DYN_BYTES) {
      scr_dyn_arg_type_fail("buffer", "an instance of Buffer, TypedArray, or DataView", buf);
      break;
    }
    if (!scr_fs_cb_chk(callback, "cb")) break;
    double buflen = scr_bytes_byte_len(buf->v.bytes);
    double offset = 0;
    if (!scr_fs_dyn_absent(offv)) {
      if (!scr_fs_read_validate_integer(offv, "offset", 0, ">= 0 && <= 9007199254740991")) break;
      offset = offv->v.num;
    }
    double lraw;
    if (lenFromBuffer) {
      lraw = buflen - offset;
    } else if (scr_fs_dyn_absent(lenv)) {
      lraw = 0;
    } else {
      lraw = scr_dyn_to_number(lenv);
      if (scr_exc_pending()) break;
    }
    const double length = scr_fs_toint32(lraw);
    if (length == 0) {
#ifdef SCR_LIB
      scr_trap("scriptc: internal error: fs.read callback reached in a library build — please report this");
#else
      ScrClosure *clo = scr_closure_new((void *)scr_fs_read_zero_tick, 2);
      clo->caps[0] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
      scr_box_set_ref(clo->caps[0], scr_dyn_retain((ScrDyn *)buf));
      clo->caps[1] = scr_box_new_obj(scr_dyn_retain_v, scr_dyn_release_v, NULL);
      scr_box_set_ref(clo->caps[1], scr_dyn_retain((ScrDyn *)callback));
      scr_next_tick(clo);
      result = scr_dyn_retain(scr_dyn_undefined());
#endif
      break;
    }
    if (buflen == 0) {
      scr_dyn_arg_value_fail("buffer", "is empty and cannot be written", buf);
      break;
    }
    /* validateOffsetLengthRead */
    char recv[48], msg[192];
    if (length < 0) {
      scr_num_received(length, recv);
      int n = snprintf(msg, sizeof msg, "The value of \"length\" is out of range. It must be >= 0. Received %s", recv);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
      break;
    }
    if (offset + length > buflen) {
      scr_num_received(length, recv);
      int n = snprintf(msg, sizeof msg, "The value of \"length\" is out of range. It must be <= %.0f. Received %s",
                       buflen - offset, recv);
      scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)n, "ERR_OUT_OF_RANGE");
      break;
    }
    double position = -1;
    if (!scr_fs_dyn_absent(posv)) {
      if (posv->kind != SCR_DYN_NUM) {
        scr_dyn_arg_type_fail("position", "of type bigint or integer", posv);
        break;
      }
      if (!scr_fs_int_range_chk(posv, "position", -1, 9007199254740991.0, ">= -1 && <= 9007199254740991")) break;
      position = posv->v.num;
    }
#ifdef SCR_LIB
    (void)position;
    scr_trap("scriptc: internal error: fs.read callback reached in a library build — please report this");
#else
    ScrDyn *nums = scr_dyn_new_arr();
    scr_dyn_arr_push(nums, scr_dyn_new_num(offset));
    scr_dyn_arr_push(nums, scr_dyn_new_num(length));
    scr_dyn_arr_push(nums, scr_dyn_new_num(position));
    const ScrDyn *vals[4] = {fd, buf, callback, nums};
    scr_set_timeout(scr_fs_cb_closure(scr_fs_read_fire, 4, vals), 0);
    scr_dyn_release(nums);
    result = scr_dyn_retain(scr_dyn_undefined());
#endif
  } while (0);
  if (alloc != NULL) scr_dyn_release(alloc);
  return result;
}

/* fs.lchmod(path, mode, cb) — macOS only (the callback form is not even
 * exported elsewhere, so the other platforms answer Node's not-a-function
 * TypeError before any argument is looked at). */
#if defined(__APPLE__) && !defined(SCR_LIB)
static void scr_fs_lchmod_fire(ScrClosure *self);
#endif
ScrDyn *scr_fs_lchmod_cb(const ScrDyn *path, const ScrDyn *mode, const ScrDyn *cb) {
  if (!scr_fs_lchmod_defined("fs.lchmod")) return NULL;
  if (!scr_fs_cb_chk(cb, "cb")) return NULL;
  if (!scr_fs_path_chk(path, "path")) return NULL;
  if (!scr_fs_mode_chk(mode, "mode")) return NULL;
#if defined(__APPLE__) && !defined(SCR_LIB)
  const ScrDyn *vals[3] = {path, mode, cb};
  scr_set_timeout(scr_fs_cb_closure(scr_fs_lchmod_fire, 3, vals), 0);
#endif
  return scr_dyn_retain(scr_dyn_undefined());
}

/* fs.opendirSync(path, options?): getValidatedPath, then getOptions'
 * assertEncoding; the Dir machinery fences. */
void scr_fs_opendir_chk(const ScrDyn *path, const ScrDyn *opts, const ScrStr *fence) {
  if (!scr_fs_path_chk(path, "path")) return;
  if (!scr_fs_encoding_chk(opts)) return;
  scr_throw_lowering_fence(fence);
}

/* fs.watchFile(path, options?, listener): the path first, the listener's
 * function check second (Node's watchFile order); real watching fences. */
void scr_fs_watch_file_chk(const ScrDyn *path, const ScrDyn *listener, const ScrStr *fence) {
  if (!scr_fs_path_chk(path, "path")) return;
  if (listener->kind != SCR_DYN_FUNC) {
    scr_dyn_arg_type_fail("listener", "of type function", listener);
    return;
  }
  scr_throw_lowering_fence(fence);
}

/* fs.lchmod / lchmodSync / fs.promises.lchmod — macOS-only in Node (the
 * callback/sync pair is not even exported elsewhere, so non-APPLE builds
 * answer the not-a-function TypeError; the promise form rejects
 * ERR_METHOD_NOT_IMPLEMENTED, Node's own linux shape). On macOS the
 * validation ladder runs in Node's order and the real lchmod(2) applies
 * where an operation survives it. */
static bool scr_fs_lchmod_defined(const char *api) {
#ifdef __APPLE__
  (void)api;
  return true;
#else
  char msg[64];
  int len = snprintf(msg, sizeof msg, "%s is not a function", api);
  scr_throw_error_msg(SCR_ERR_TYPE, msg, (size_t)len);
  return false;
#endif
}

#ifdef __APPLE__
static void scr_fs_lchmod_apply(const ScrDyn *path, const ScrDyn *mode) {
  ScrStr *p = path->kind == SCR_DYN_STR ? scr_str_retain(path->v.str)
                                        : scr_str_new((const char *)path->v.bytes->data, path->v.bytes->len);
  double m = mode->kind == SCR_DYN_NUM ? mode->v.num : (double)strtol(mode->v.str->data, NULL, 8);
  if (lchmod(p->data, (mode_t)m) != 0) scr_fs_throw(errno, "lchmod", p);
  scr_str_release(p);
}
#endif

#if defined(__APPLE__) && !defined(SCR_LIB)
static void scr_fs_lchmod_fire(ScrClosure *self) {
  ScrDyn *path = scr_box_get_ref(self->caps[0]);
  ScrDyn *mode = scr_box_get_ref(self->caps[1]);
  ScrDyn *cb = scr_box_get_ref(self->caps[2]);
  scr_fs_lchmod_apply(path, mode);
  scr_fs_cb_finish(cb, NULL, 0, "the fs.lchmod callback");
  scr_dyn_release(path);
  scr_dyn_release(mode);
  scr_dyn_release(cb);
}
#endif

/* Answers the dyn undefined (+1) on success — lchmodSync's JS value, so
 * return-position uses lower; NULL with the exception pending. */
ScrDyn *scr_fs_lchmod_sync_chk(const ScrDyn *path, const ScrDyn *mode) {
  if (!scr_fs_lchmod_defined("fs.lchmodSync")) return NULL;
  if (!scr_fs_path_chk(path, "path")) return NULL;
  if (!scr_fs_mode_chk(mode, "mode")) return NULL;
#ifdef __APPLE__
  scr_fs_lchmod_apply(path, mode);
  if (scr_exc_pending()) return NULL;
#endif
  return scr_dyn_retain(scr_dyn_undefined());
}

ScrPromise *scr_fsp_lchmod_chk(const ScrDyn *path, const ScrDyn *mode) {
#ifndef __APPLE__
  (void)path;
  (void)mode;
  static const char ni[] = "The lchmod() method is not implemented";
  scr_throw_error_msg_code(SCR_ERR_ERROR, ni, sizeof ni - 1, "ERR_METHOD_NOT_IMPLEMENTED");
  return scr_promise_settled_void();
#else
  if (scr_fs_path_chk(path, "path") && scr_fs_mode_chk(mode, "mode")) {
    scr_fs_lchmod_apply(path, mode);
  }
  return scr_promise_settled_void();
#endif
}

/* fs.read(fd, buffer, offset, length, position, cb) — the full argument
 * ladder in Node's order (buffer, fd, offset, length, position); the
 * async read fences. Bounds follow lib/fs.js read(): offset within the
 * buffer, length within buffer - offset. */
static bool scr_fs_int_range_chk(const ScrDyn *v, const char *name, double min, double max,
                                 const char *range) {
  if (v->kind != SCR_DYN_NUM) {
    scr_dyn_arg_type_fail(name, "of type number", v);
    return false;
  }
  double n = v->v.num;
  char recv[48], msg[192];
  if (!(isfinite(n) && trunc(n) == n)) {
    scr_num_received(n, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be an integer. Received %s",
                       name, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  if (n < min || n > max) {
    scr_num_received(n, recv);
    int len = snprintf(msg, sizeof msg,
                       "The value of \"%s\" is out of range. It must be %s. Received %s",
                       name, range, recv);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)len, "ERR_OUT_OF_RANGE");
    return false;
  }
  return true;
}

/* createReadStream/createWriteStream(path, options?): getOptions'
 * assertEncoding, the fd member's FileHandle-or-integer contract when
 * present, the path contract otherwise; the stream machinery fences. */
void scr_fs_stream_opts_chk(const ScrDyn *path, const ScrDyn *opts, const ScrStr *fence) {
  if (!scr_fs_encoding_chk(opts)) return;
  const ScrDyn *fd = opts->kind == SCR_DYN_OBJ ? scr_dyn_obj_get(opts, "fd", 2) : NULL;
  if (fd != NULL && !scr_fs_dyn_absent(fd)) {
    if (fd->kind != SCR_DYN_NUM) {
      scr_dyn_prop_type_fail("options.fd", "of type number or an instance of FileHandle", fd);
      return;
    }
    if (!scr_fs_int_range_chk(fd, "fd", 0, 2147483647.0, ">= 0 && <= 2147483647")) return;
  } else if (!scr_fs_path_chk(path, "path")) {
    return;
  }
  scr_throw_lowering_fence(fence);
}

/* ── crypto.randomInt(min, max) ───────────────────────────────────────────
 * A uniform integer in [min, max). Node's contract: both bounds must be
 * safe integers, max must exceed min, and the RANGE is capped at 2^48 --
 * the errors below carry its exact messages and codes.
 *
 * Uniformity comes from REJECTION SAMPLING, not modulo: `random % range`
 * over-weights the low residues whenever range does not divide the draw
 * space. Six bytes (the 2^48 cap) are drawn per attempt and the draw is
 * discarded when it lands past the largest exact multiple of range,
 * which leaves every value equally likely. Expected attempts stay under
 * two for any admissible range. */
double scr_crypto_random_int(double min, double max) {
  const double SAFE = 9007199254740991.0; /* 2^53 - 1 */
  char num[32];
  char msg[192];
  if (!(min >= -SAFE && min <= SAFE && min == (double)(long long)min)) {
    size_t numlen = scr_f64_to_str(min, num);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"min\" is out of range. It must be a safe integer. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return 0;
  }
  if (!(max >= -SAFE && max <= SAFE && max == (double)(long long)max)) {
    size_t numlen = scr_f64_to_str(max, num);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"max\" is out of range. It must be a safe integer. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return 0;
  }
  if (!(max > min)) {
    size_t numlen = scr_f64_to_str(max, num);
    char minbuf[32];
    size_t minlen = scr_f64_to_str(min, minbuf);
    int mlen = snprintf(
        msg, sizeof msg,
        "The value of \"max\" is out of range. It must be greater than the value of \"min\" (%.*s). Received %.*s",
        (int)minlen, minbuf, (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return 0;
  }
  double range = max - min;
  if (range > 281474976710655.0) { /* 2^48 - 1, Node's cap on max - min */
    size_t numlen = scr_f64_to_str(range, num);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"max - min\" is out of range. It must be <= 281474976710655. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return 0;
  }
  uint64_t r = (uint64_t)range;
  /* The largest multiple of r that fits in 2^48; draws at or past it are
   * discarded so no residue is favored. */
  const uint64_t SPACE = (uint64_t)1 << 48;
  uint64_t limit = SPACE - (SPACE % r);
  for (;;) {
    uint8_t buf[6];
    arc4random_buf(buf, sizeof buf);
    uint64_t draw = 0;
    for (size_t i = 0; i < sizeof buf; i++) draw = (draw << 8) | buf[i];
    if (draw < limit) return min + (double)(draw % r);
  }
}

/* util.promisify(randomInt): the same draw behind an already-settled
 * promise (the fs/promises stance -- Node runs it on the threadpool, a
 * compiled binary has none). A range error rejects rather than throwing
 * out of the call: scr_promise_settled_f64 moves the pending exception
 * into the promise, which is what `await` then observes. */
ScrPromise *scr_crypto_random_int_async(double min, double max) {
  double v = scr_crypto_random_int(min, max);
  return scr_promise_settled_f64(v);
}

/* ── crypto.pbkdf2 (HMAC-SHA256 only) ─────────────────────────────────────
 * PBKDF2 per RFC 8018 over the one-shot HMAC the island bridge already
 * provides:
 *
 *   DK   = T(1) || T(2) || ... , truncated to keylen
 *   T(i) = U(1) ^ U(2) ^ ... ^ U(c)
 *   U(1) = HMAC(password, salt || INT32BE(i))
 *   U(j) = HMAC(password, U(j-1))
 *
 * The block counter is one-based and big-endian, which is what makes a
 * derivation reproducible across implementations -- get either wrong and
 * the output is still random-looking, so the differential test against
 * Node is the real check here.
 *
 * sha256 only: it is the digest zapo-shaped callers ask for, and the
 * frontend fences every other name rather than silently deriving with
 * the wrong PRF. Node's argument errors (negative or over-large keylen,
 * non-positive iterations) throw catchably. */
ScrBytes *scr_crypto_pbkdf2_sha256(const ScrBytes *password, const ScrBytes *salt,
                                   double iterations, double keylen) {
  char num[32];
  char msg[160];
  if (!(iterations >= 1) || iterations > 2147483647.0 || iterations != (double)(long long)iterations) {
    size_t numlen = scr_f64_to_str(iterations, num);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"iterations\" is out of range. It must be >= 1 && <= 2147483647. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return NULL;
  }
  /* Node (OpenSSL) refuses a ZERO key length outright -- not a range
   * error but a bare "Deriving bits failed" -- so the empty-derivation
   * case throws rather than answering an empty buffer. */
  if (keylen == 0) {
    static const char zmsg[] = "Deriving bits failed";
    scr_throw_error_msg(SCR_ERR_ERROR, zmsg, sizeof zmsg - 1);
    return NULL;
  }
  if (!(keylen >= 0) || keylen > 2147483647.0 || keylen != (double)(long long)keylen) {
    size_t numlen = scr_f64_to_str(keylen, num);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"keylen\" is out of range. It must be >= 0 && <= 2147483647. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return NULL;
  }
  const size_t HLEN = 32;
  size_t want = (size_t)keylen;
  unsigned long iters = (unsigned long)iterations;
  ScrBytes *out = scr_bytes_new(SCR_BYTES_U8, keylen);
  /* salt || INT32BE(block) — reused across blocks, the counter rewritten. */
  size_t saltlen = salt->len;
  unsigned char *block = malloc(saltlen + 4);
  if (!block) scr_bytes_io_oom();
  memcpy(block, salt->data, saltlen);
  unsigned char u[32];
  unsigned char t[32];
  size_t done = 0;
  for (uint32_t i = 1; done < want; i++) {
    block[saltlen] = (unsigned char)(i >> 24);
    block[saltlen + 1] = (unsigned char)(i >> 16);
    block[saltlen + 2] = (unsigned char)(i >> 8);
    block[saltlen + 3] = (unsigned char)i;
    scr_crypto_hmac_raw("sha256", password->data, password->len, block, saltlen + 4, u);
    memcpy(t, u, HLEN);
    for (unsigned long j = 1; j < iters; j++) {
      scr_crypto_hmac_raw("sha256", password->data, password->len, u, HLEN, u);
      for (size_t k = 0; k < HLEN; k++) t[k] ^= u[k];
    }
    size_t take = want - done < HLEN ? want - done : HLEN;
    memcpy(out->data + done, t, take);
    done += take;
  }
  free(block);
  return scr_bytes_stamp_buffer(out); /* Node: pbkdf2Sync answers a Buffer */
}

/* ── crypto.hkdfSync (HMAC-SHA256 only) ───────────────────────────────────
 * HKDF per RFC 5869, over the same one-shot HMAC pbkdf2 above uses:
 *
 *   PRK  = HMAC(salt, IKM)                        extract -- salt is the KEY
 *   T(0) = <empty>
 *   T(i) = HMAC(PRK, T(i-1) || info || byte(i))   expand -- i is ONE-based
 *   OKM  = T(1) || T(2) || ... truncated to keylen
 *
 * The salt-is-the-key inversion in extract is the step that answers
 * plausible garbage rather than an error when it is wrong, so RFC 5869's
 * A.1 vector rides in the corpus beside the Node differential.
 *
 * The result is the OPAQUE bytes flavor, because Node answers an
 * ArrayBuffer -- a value whose one use here is the view a Uint8Array
 * constructor takes over it.
 *
 * sha256 only, for pbkdf2's reason: the frontend fences every other digest
 * rather than deriving with the wrong PRF, and the one-shot HMAC's 64-byte
 * block is right for exactly the digests scr_crypto_digest_raw names.
 * Node's four refusals are reproduced in ITS order -- a non-integer length
 * (NaN and the infinities among them), an out-of-bounds one, a ZERO length
 * (OpenSSL's bare "Deriving bits failed", not a range error), and more than
 * 255*32 bytes. */
ScrBytes *scr_crypto_hkdf_sha256(const ScrBytes *ikm, const ScrBytes *salt,
                                 const ScrBytes *info, double keylen) {
  const size_t HLEN = 32;
  char num[32];
  char msg[160];
  if (!isfinite(keylen) || keylen != trunc(keylen)) {
    size_t numlen = scr_f64_to_str(keylen, num);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"length\" is out of range. It must be an integer. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return NULL;
  }
  if (keylen < 0 || keylen > 9007199254740991.0) {
    size_t numlen = scr_f64_to_str(keylen, num);
    int mlen = snprintf(msg, sizeof msg,
                        "The value of \"length\" is out of range. It must be >= 0 && <= 9007199254740991. Received %.*s",
                        (int)numlen, num);
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, (size_t)mlen, "ERR_OUT_OF_RANGE");
    return NULL;
  }
  if (keylen == 0) {
    static const char zmsg[] = "Deriving bits failed";
    scr_throw_error_msg(SCR_ERR_ERROR, zmsg, sizeof zmsg - 1);
    return NULL;
  }
  if (keylen > 255.0 * 32.0) {
    static const char kmsg[] = "Invalid key length";
    scr_throw_error_msg_code(SCR_ERR_RANGE, kmsg, sizeof kmsg - 1, "ERR_CRYPTO_INVALID_KEYLEN");
    return NULL;
  }
  unsigned char prk[32];
  if (scr_crypto_hmac_raw("sha256", salt->data, salt->len, ikm->data, ikm->len, prk) == 0) {
    return NULL;
  }
  size_t want = (size_t)keylen;
  ScrBytes *out = scr_bytes_new(SCR_BYTES_BUF, keylen);
  unsigned char t[32];
  size_t tlen = 0;
  size_t done = 0;
  unsigned char *feed = malloc(HLEN + info->len + 1);
  if (!feed) scr_bytes_io_oom();
  for (unsigned i = 1; done < want; i++) {
    size_t n = tlen;
    if (tlen) memcpy(feed, t, tlen);
    if (info->len) memcpy(feed + n, info->data, info->len);
    n += info->len;
    feed[n++] = (unsigned char)i;
    scr_crypto_hmac_raw("sha256", prk, HLEN, feed, n, t);
    tlen = HLEN;
    size_t take = want - done < HLEN ? want - done : HLEN;
    memcpy(out->data + done, t, take);
    done += take;
  }
  free(feed);
  return out;
}

/* crypto.timingSafeEqual(a, b) — constant-time byte equality. Two of its
 * properties are CONTRACTS rather than conveniences, and both are the
 * reason the function exists at all:
 *
 *  - A LENGTH MISMATCH THROWS. Node raises
 *    `RangeError [ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH]: Input buffers
 *    must have the same byte length`. Answering `false` instead would be
 *    the very leak this function is meant to prevent — a caller could
 *    learn a secret's length by timing or by result — so the mismatch is
 *    an error and not a data-dependent branch. Callers that want a
 *    boolean (zapo's uint8TimingSafeEqual) compare lengths themselves
 *    BEFORE calling, precisely because this one throws.
 *  - THE COMPARE DOES NOT SHORT-CIRCUIT. The accumulator visits every
 *    byte whatever it finds; `diff` is volatile so the loop cannot be
 *    recognised and turned back into an early-exit memcmp.
 *
 * Node compares BYTE length rather than element count (a Uint32Array of
 * 2 and a Uint8Array of 8 are comparable, and answer over the same
 * bytes), so the widths are folded here through scr_bytes_elem_size
 * instead of being restricted at the call site. Borrowed args; plain
 * bool; throws only for the mismatch. */
bool scr_crypto_timing_safe_equal(const ScrBytes *a, const ScrBytes *b) {
  size_t alen = a->len * scr_bytes_elem_size(a->elem);
  size_t blen = b->len * scr_bytes_elem_size(b->elem);
  if (alen != blen) {
    static const char msg[] = "Input buffers must have the same byte length";
    scr_throw_error_msg_code(SCR_ERR_RANGE, msg, sizeof msg - 1,
                             "ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH");
    return false;
  }
  volatile unsigned char diff = 0;
  for (size_t i = 0; i < alen; i++) {
    diff = (unsigned char)(diff | (unsigned char)(a->data[i] ^ b->data[i]));
  }
  return diff == 0;
}

/* util.promisify(pbkdf2): the derivation behind an already-settled
 * promise (the fs/promises stance). A range error rejects. */
ScrPromise *scr_crypto_pbkdf2_sha256_async(const ScrBytes *password, const ScrBytes *salt,
                                           double iterations, double keylen) {
  ScrBytes *b = scr_crypto_pbkdf2_sha256(password, salt, iterations, keylen);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

/* util.promisify(randomBytes): the same draw behind an already-settled
 * promise. A size range error rejects. */
ScrPromise *scr_crypto_random_bytes_async(double n) {
  ScrBytes *b = scr_crypto_random_bytes(n);
  return scr_promise_settled_ref(b, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}
