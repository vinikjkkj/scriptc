/* Replay the MEASURED join workload and time it.
 *
 * The census gives the exact shape, so this is a replay and not a guess:
 *   2,008 joins of ~500 string elements -> 14,999 bytes out, 8 growths each
 *   1,004 joins of 8 elements           -> 8 bytes out,      0 growths
 *   1,000 joins of 2 elements           -> 58 bytes out,     0 growths
 *   total 30,184,222 bytes, 16,064 growths, 2,024,321 append memcpys
 *
 * scr_join_append is VERBATIM from packages/runtime/src/scr_array.c. The tail
 * is scr_arr_join's own: scr_str_new copies the finished buffer into a fresh
 * allocation and the buffer is freed -- so every emitted byte is memcpy'd
 * twice, which is the point of measuring rather than reasoning.
 *
 * WHAT THIS IS NOT: the real program's cache state. An isolated replay touches
 * a working set this small with everything warm, so the number below is a
 * FLOOR on the real cost, not the real cost. It is reported as a floor. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <time.h>

static void scr_join_append(char **buf, size_t *len, size_t *cap,
                             const char *bytes, size_t n) {
  if (*len + n > *cap) {
    size_t cap2 = *cap;
    while (*len + n > cap2) {
      if (cap2 > ((size_t)-1) / 2) abort();
      cap2 *= 2;
    }
    char *grown = realloc(*buf, cap2);
    if (!grown) abort();
    *buf = grown;
    *cap = cap2;
  }
  memcpy(*buf + *len, bytes, n);
  *len += n;
}

static size_t g_bytes, g_grows_seen;

/* one scr_arr_join over nelem string elements of elen bytes, sep 1 byte */
static void one_join(const char *el, size_t elen, const char *sp, size_t slen,
                     int nelem) {
  size_t cap = 64, len = 0;
  char *buf = malloc(cap);
  for (int i = 0; i < nelem; i++) {
    if (i > 0) scr_join_append(&buf, &len, &cap, sp, slen);
    scr_join_append(&buf, &len, &cap, el, elen);
  }
  /* scr_str_new(buf, len): a fresh allocation and a full copy, then free */
  char *out = malloc(len + 1);
  memcpy(out, buf, len);
  out[len] = 0;
  g_bytes += len;
  free(buf);
  free(out);
}

int main(int argc, char **argv) {
  int reps = argc > 1 ? atoi(argv[1]) : 20;
  char el[64], sp[2];
  memset(el, 'x', sizeof el);
  sp[0] = ','; sp[1] = 0;

  /* warm */
  for (int i = 0; i < 200; i++) one_join(el, 29, sp, 1, 500);
  g_bytes = 0;

  struct timespec a, b;
  clock_gettime(CLOCK_MONOTONIC, &a);
  for (int r = 0; r < reps; r++) {
    for (int i = 0; i < 2008; i++) one_join(el, 29, sp, 1, 500);
    for (int i = 0; i < 1004; i++) one_join(el, 1, sp, 1, 8);
    for (int i = 0; i < 1000; i++) one_join(el, 19, sp, 1, 2);
  }
  clock_gettime(CLOCK_MONOTONIC, &b);
  double ms = (b.tv_sec - a.tv_sec) * 1e3 + (b.tv_nsec - a.tv_nsec) / 1e6;
  printf("reps=%d  bytes/rep=%zu  total_ms=%.2f  ms_per_rep=%.3f\n",
         reps, g_bytes / reps, ms, ms / reps);
  (void)g_grows_seen;
  return 0;
}
