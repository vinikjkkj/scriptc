/* The two string cuts of strfit1 (scr_string.c), each with a positive control.
 *
 *  S1  A one-ASCII-byte string is the shared immortal static, from every creator that reaches scr_str_new or the binary concat, and it is never
 *      mutated, grown or freed: concat onto it copies.
 */
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

int main(void) {
  t_one_byte();
#ifdef SCR_RC_AUDIT
  CHECK(scr_str_live_count() == 0);
#endif
  fprintf(stderr, "%s\n", failures ? "FAILED" : "all strfit tests passed");
  return failures ? 1 : 0;
}
