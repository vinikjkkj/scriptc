/* The two string cuts of strfit1 (scr_string.c), each with a positive control.
 *
 *  S1  A one-ASCII-byte string is the shared immortal static, from every creator that reaches scr_str_new or the binary concat, and it is never
 *      mutated, grown or freed: concat onto it copies.
 *  S2  A spare block far bigger than a string is not reused for it (the 32 KiB block a JSON builder hands back used to become an 11 KB SQL
 *      string's capacity). Compiled WITHOUT -DSCR_RC_AUDIT: the spare slot does not exist in the audit lane. */
#include "../src/scr_runtime.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#ifdef SCR_RC_AUDIT
extern long scr_str_live_count(void);   /* drains the intern table first */
extern long scr_str_live_objects(void); /* does not */
#endif

static int failures = 0;
#define CHECK(cond)                                                            \
  do {                                                                         \
    if (!(cond)) {                                                             \
      failures++;                                                              \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);          \
    }                                                                          \
  } while (0)

static void t_one_byte(void) {
  ScrStr *q = scr_str_new("?", 1);
  ScrStr *q2 = scr_str_new("?", 1);
  ScrStr *e = scr_str_new("", 0);
  ScrStr *c1 = scr_str_concat(e, q);
  ScrStr *c2 = scr_str_concat(q, e);
  ScrStr *a = scr_str_new("a", 1);
  ScrStr *ca = scr_str_concat(e, a);
  int i;
  CHECK(q == q2);
  CHECK(q->rc == SCR_STR_IMMORTAL);
  CHECK(c1 == q && c2 == q);
  CHECK(ca != q && ca->rc == SCR_STR_IMMORTAL && ca->data[0] == 'a');
  /* 10,000 creations: one object, and the live count does not move (the positive control: the same loop through a two-byte string allocates). */
  {
#ifdef SCR_RC_AUDIT
    long before = scr_str_live_objects();
#endif
    ScrStr *keep[16];
    for (i = 0; i < 10000; i++) {
      ScrStr *x = scr_str_concat(e, q);
      CHECK(x == q);
      scr_str_release(x);
    }
#ifdef SCR_RC_AUDIT
    CHECK(scr_str_live_objects() == before);
#endif
    for (i = 0; i < 16; i++) keep[i] = scr_str_new("??", 2);
#ifdef SCR_RC_AUDIT
    CHECK(scr_str_live_objects() == before + 16);
#endif
    for (i = 0; i < 16; i++) scr_str_release(keep[i]);
  }
  /* A multi-byte code point is NOT a one-byte string: a 2-byte sequence stays a fresh string. */
  {
    ScrStr *u = scr_str_new("\xC3\xA9", 2);
    CHECK(u->rc == 1 && u->len == 2);
    scr_str_release(u);
  }
  /* Never mutated: appending to the shared string copies, whatever its capacity says. */
  {
    ScrStr *z = scr_str_new("z", 1);
    ScrStr *y = scr_str_concat(q, z);
    CHECK(y != q && y->len == 2 && memcmp(y->data, "?z", 2) == 0);
    CHECK(q->len == 1 && q->data[0] == '?' && q->data[1] == '\0' && q->rc == SCR_STR_IMMORTAL);
    scr_str_release(y);
    scr_str_release(z);
  }
  scr_str_release(c1);
  scr_str_release(c2);
  scr_str_release(ca);
  scr_str_release(q);
  scr_str_release(q2);
  scr_str_release(a);
  scr_str_release(e);
}

#ifndef SCR_RC_AUDIT
static void t_spare(void) {
  /* PLANT a 32 KiB block in the spare slot: a builder-sized string, filled and released. */
  ScrStr *big = scr_str_alloc_raw(0, 32768);
  ScrStr *a, *b, *r;
  char *buf = (char *)malloc(6000);
  memset(big->data, 'x', 30000);
  big->len = 30000;
  big->data[30000] = '\0';
  scr_str_release(big);
  memset(buf, 'a', 6000);
  a = scr_str_new(buf, 6000);
  b = scr_str_new(buf, 5000);
  r = scr_str_concat(a, b); /* 11,000 bytes: the old rule took the 32 KiB block (32768 / 4 <= 11000) */
  CHECK(r->len == 11000);
  CHECK(r->cap < 20000);
  fprintf(stderr, "spare: len=%u cap=%u\n", r->len, r->cap);
  scr_str_release(r);
  scr_str_release(a);
  scr_str_release(b);
  free(buf);
  /* The reuse that is still wanted: an append loop's blocks of nearly the same size ping-pong. */
  {
    ScrStr *acc = scr_str_new("", 0), *piece = scr_str_new("0123456789abcdef", 16);
    int i;
    for (i = 0; i < 2000; i++) {
      ScrStr *n = scr_str_concat(acc, piece);
      scr_str_release(acc);
      acc = n;
    }
    CHECK(acc->len == 2000u * 16u);
    CHECK(acc->cap < 2u * acc->len + 64u);
    scr_str_release(acc);
    scr_str_release(piece);
  }
}
#endif

int main(void) {
  t_one_byte();
#ifndef SCR_RC_AUDIT
  t_spare();
#endif
#ifdef SCR_RC_AUDIT
  CHECK(scr_str_live_count() == 0);
#endif
  fprintf(stderr, "%s\n", failures ? "FAILED" : "all strfit tests passed");
  return failures ? 1 : 0;
}
