/* Unit tests for per-evaluation vtable copies (scr_vtheap.c): identity per
 * evaluation, the identity walk over heap parents, static parents, env and
 * statics released exactly once at rc 0, and the RC audit count returning
 * to zero. Built with -DSCR_RC_AUDIT. -DVTHEAP_CONTROL_LEAK skips one final
 * release on purpose: the audit must then report a nonzero live count (the
 * lifetime control; the test binary exits nonzero). */
#include "../src/scr_runtime.h"

#include <stdio.h>

extern long scr_vtheap_live_count(void);

typedef struct { ScrVt head; void *slot; } VtShape; /* one slot, like an emitted hierarchy */

static int failures = 0;
#define CHECK(cond)                                                    \
  do {                                                                 \
    if (!(cond)) {                                                     \
      failures++;                                                      \
      fprintf(stderr, "FAIL %s:%d: %s\n", __FILE__, __LINE__, #cond);  \
    }                                                                  \
  } while (0)

static int env_releases = 0, statics_releases = 0;
static void env_rel(void *e) { (void)e; env_releases++; }
static void statics_rel(void *s) { (void)s; statics_releases++; }

int main(void) {
  /* Static base B (preorder 0..3) and the class proto D (preorder 2..2). */
  static VtShape base_proto = {{0, 3, NULL, NULL, 0, NULL}, NULL};
  static VtShape derived_proto = {{2, 2, NULL, NULL, 0, NULL}, NULL};
  const ScrVt *B = &base_proto.head;
  CHECK(B->heap == 0);

  /* Two evaluations of the same class expression: distinct identities. */
  int env_a = 1, env_b = 2, st_a = 3, st_b = 4;
  ScrVt *E1 = scr_vtheap_new(&derived_proto.head, sizeof(VtShape), B, &env_a, env_rel, &st_a, statics_rel);
  ScrVt *E2 = scr_vtheap_new(&derived_proto.head, sizeof(VtShape), B, &env_b, env_rel, &st_b, statics_rel);
  CHECK(E1 != E2);
  CHECK(E1->heap != 0 && E2->heap != 0 && E1->heap != E2->heap);
  CHECK(E1->pre == 2 && E1->post == 2); /* static interval inherited from the proto */
  CHECK(scr_vtheap_instanceof(E1, E1));
  CHECK(!scr_vtheap_instanceof(E1, E2)); /* the two evaluations never alias */
  CHECK(!scr_vtheap_instanceof(E2, E1));
  CHECK(scr_vtheap_instanceof(E1, B));   /* static ancestor: parent walk reaches B */
  CHECK(!scr_vtheap_instanceof(B, E1));  /* a static base is not an expression subclass */

  /* A subclass evaluated inside an evaluation: parent is the heap copy E1. */
  ScrVt *E3 = scr_vtheap_new(&derived_proto.head, sizeof(VtShape), E1, NULL, NULL, NULL, NULL);
  CHECK(scr_vtheap_instanceof(E3, E1));
  CHECK(scr_vtheap_instanceof(E3, B));
  CHECK(!scr_vtheap_instanceof(E3, E2));
  CHECK(!scr_vtheap_instanceof(E1, E3));

  /* E3 holds E1 alive: releasing our handle on E1 leaves its env live. */
  scr_vtheap_release(E1);
  CHECK(env_releases == 0 && statics_releases == 0);
  scr_vtheap_release(E3); /* frees E3, which releases its parent E1 */
  CHECK(env_releases == 1 && statics_releases == 1);

  /* retain/release pair on E2: no callbacks until the last release. */
  scr_vtheap_retain(E2);
  scr_vtheap_release(E2);
  CHECK(env_releases == 1 && statics_releases == 1);
#ifndef VTHEAP_CONTROL_LEAK
  scr_vtheap_release(E2);
  CHECK(env_releases == 2 && statics_releases == 2);
#endif

#ifdef SCR_RC_AUDIT
  CHECK(scr_vtheap_live_count() == 0);
#endif
  if (failures) {
    fprintf(stderr, "test_vtheap: %d failure(s)\n", failures);
    return 1;
  }
  printf("test_vtheap: ok\n");
  return 0;
}
