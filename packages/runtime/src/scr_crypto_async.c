/* The promisified node:crypto forms (randomBytes, randomInt, pbkdf2) on the
 * worker pool (scr_pool.c). Node runs every one of these on libuv's
 * threadpool and resolves the promise in the poll phase, so the promise is
 * PENDING when the call returns and settles from the loop's poll station.
 *
 * Node's synchronous argument ladders stay synchronous (they REJECT the
 * returned promise, since the promisified form turns a throw into a
 * rejection); only an admissible call reaches the pool. The worker sees raw
 * memory alone: the main thread allocates the output buffer, retains the
 * promise, copies the inputs Node copies (pbkdf2's password and salt), and
 * settles the promise and releases everything in `done`. */
#include "scr_runtime.h"

#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/* A rejection raised by a check: the pending exception becomes the
 * returned promise's rejection (the settled-promise bridge). */
static ScrPromise *scr_ca_rejected(void) {
  return scr_promise_settled_ref(NULL, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
}

/* ── randomBytes ─────────────────────────────────────────────────────── */

typedef struct {
  ScrWork w;
  ScrBytes *out; /* owned (+1), filled by the worker */
  ScrPromise *p; /* retained by the main thread */
} ScrRbJob;

static void scr_rb_run(ScrWork *w) {
  ScrRbJob *j = (ScrRbJob *)w;
  if (j->out->len > 0) arc4random_buf(j->out->data, j->out->len);
}

static void scr_rb_done(ScrWork *w, bool ran) {
  ScrRbJob *j = (ScrRbJob *)w;
  ScrPromise *p = j->p;
  ScrBytes *out = j->out;
  free(j);
  if (ran) scr_promise_fulfill_ref(p, out, &scr_bytes_retain_v, &scr_bytes_release_v, NULL); /* moves out in */
  else scr_bytes_release(out);
  scr_promise_release(p);
}

ScrPromise *scr_crypto_random_bytes_async(double n) {
  if (!(n >= 0 && n <= 2147483647)) {
    ScrBytes *none = scr_crypto_random_bytes(n); /* throws Node's RangeError */
    (void)none;
    return scr_ca_rejected();
  }
  ScrRbJob *j = malloc(sizeof *j);
  if (j == NULL) scr_bytes_io_oom();
  j->w.run = scr_rb_run;
  j->w.done = scr_rb_done;
  j->out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, n));
  ScrPromise *p = scr_promise_new(); /* +1: ours, returned */
  j->p = scr_promise_retain(p);
  scr_work_submit_cost(&j->w, n / 1000.0); /* arc4random: ~1 byte/ns */
  return p;
}

/* ── randomInt ───────────────────────────────────────────────────────── */

typedef struct {
  ScrWork w;
  double min;
  uint64_t range;
  double value;
  ScrPromise *p;
} ScrRiJob;

static void scr_ri_run(ScrWork *w) {
  ScrRiJob *j = (ScrRiJob *)w;
  j->value = scr_crypto_random_int_draw(j->min, j->range);
}

static void scr_ri_done(ScrWork *w, bool ran) {
  ScrRiJob *j = (ScrRiJob *)w;
  ScrPromise *p = j->p;
  double v = j->value;
  free(j);
  if (ran) scr_promise_fulfill_f64(p, v);
  scr_promise_release(p);
}

ScrPromise *scr_crypto_random_int_async(double min, double max) {
  uint64_t r;
  if (!scr_crypto_random_int_check(min, max, &r)) return scr_ca_rejected();
  ScrRiJob *j = malloc(sizeof *j);
  if (j == NULL) scr_bytes_io_oom();
  j->w.run = scr_ri_run;
  j->w.done = scr_ri_done;
  j->min = min;
  j->range = r;
  j->value = 0;
  ScrPromise *p = scr_promise_new();
  j->p = scr_promise_retain(p);
  scr_work_submit_cost(&j->w, 0.5);
  return p;
}

/* ── pbkdf2 ──────────────────────────────────────────────────────────── */

typedef struct {
  ScrWork w;
  uint8_t *in; /* password || salt, copied: Node copies both for the async job */
  size_t pwlen, saltlen;
  unsigned long iters;
  ScrBytes *out; /* owned (+1) */
  bool ok;
  ScrPromise *p;
} ScrPbJob;

static void scr_pb_run(ScrWork *w) {
  ScrPbJob *j = (ScrPbJob *)w;
  j->ok = scr_crypto_pbkdf2_sha256_fill(j->in, j->pwlen, j->in + j->pwlen, j->saltlen, j->iters, j->out->data,
                                        j->out->len);
}

static void scr_pb_done(ScrWork *w, bool ran) {
  ScrPbJob *j = (ScrPbJob *)w;
  ScrPromise *p = j->p;
  ScrBytes *out = j->out;
  bool ok = j->ok;
  free(j->in);
  free(j);
  if (ran) {
    if (!ok) scr_bytes_io_oom();
    scr_promise_fulfill_ref(p, out, &scr_bytes_retain_v, &scr_bytes_release_v, NULL);
  } else {
    scr_bytes_release(out);
  }
  scr_promise_release(p);
}

ScrPromise *scr_crypto_pbkdf2_sha256_async(const ScrBytes *password, const ScrBytes *salt, double iterations,
                                           double keylen) {
  if (!scr_crypto_pbkdf2_sha256_check(iterations, keylen)) return scr_ca_rejected();
  ScrPbJob *j = malloc(sizeof *j);
  if (j == NULL) scr_bytes_io_oom();
  j->w.run = scr_pb_run;
  j->w.done = scr_pb_done;
  j->pwlen = password->len;
  j->saltlen = salt->len;
  j->in = malloc(j->pwlen + j->saltlen + 1);
  if (j->in == NULL) scr_bytes_io_oom();
  memcpy(j->in, password->data, j->pwlen);
  memcpy(j->in + j->pwlen, salt->data, j->saltlen);
  j->iters = (unsigned long)iterations;
  j->out = scr_bytes_stamp_buffer(scr_bytes_new(SCR_BYTES_U8, keylen));
  j->ok = false;
  ScrPromise *p = scr_promise_new();
  j->p = scr_promise_retain(p);
  /* ~1.2 us per HMAC-SHA256 round, `iterations` rounds per 32-byte block */
  scr_work_submit_cost(&j->w, 1.2 * (double)j->iters * ((keylen + 31.0) / 32.0));
  return p;
}
