/* Self-test for the join growth accounting.
 *
 * scr_join_append below is a VERBATIM copy of packages/runtime/src/scr_array.c
 * (the counting lines are the ones this test exists to check). The join loop
 * mirrors scr_arr_join's SCR_ELEM_STR case: element, separator, element, ...
 *
 * The predictions are NOT computed here. join_model.py implements the same
 * growth policy independently, from its description rather than from this
 * code, and the checker compares the two. If my model of "64 bytes doubled"
 * is wrong, the two disagree and the report that rests on it is not written. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static long long g_grows, g_moved;

static void scr_join_append(char **buf, size_t *len, size_t *cap,
                             const char *bytes, size_t n) {
  if (*len + n > *cap) {
    g_grows++;
    g_moved += (long long)*len;
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

/* nelem elements of elen bytes, joined by a separator of slen bytes */
static void run(int nelem, int elen, int slen) {
  char *el = malloc(elen ? elen : 1), *sp = malloc(slen ? slen : 1);
  memset(el, 'x', elen); memset(sp, ',', slen);
  size_t cap = 64, len = 0;
  char *buf = malloc(cap);
  g_grows = 0; g_moved = 0;
  for (int i = 0; i < nelem; i++) {
    if (i > 0) scr_join_append(&buf, &len, &cap, sp, slen);
    scr_join_append(&buf, &len, &cap, el, elen);
  }
  printf("%d %d %d -> out=%zu grows=%lld moved=%lld cap=%zu\n",
         nelem, elen, slen, len, g_grows, g_moved, cap);
  free(buf); free(el); free(sp);
}

int main(void) {
  run(1, 10, 1);        /* fits in 64, must not grow at all */
  run(500, 10, 1);      /* the group fan-out shape */
  run(500, 30, 1);      /* the measured mean, ~7.5 KB out */
  run(256, 29, 1);      /* a 256-511 source, the top histogram row */
  run(1000, 2, 1);      /* many tiny elements */
  run(4, 5000, 2);      /* few huge elements: one append can jump many caps */
  run(0, 10, 1);        /* empty array */
  run(1, 100, 1);       /* single element larger than the initial cap */
  return 0;
}
