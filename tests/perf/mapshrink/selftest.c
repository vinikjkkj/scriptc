/* Self-test for scr_map's idle table shrink.
 *
 * WHITE BOX ON PURPOSE. It #includes scr_map.c so the counters and the
 * worklist head -- both static -- can be asserted directly. The code under
 * test is therefore the shipped source, not a model of it: a model that
 * drifts from the runtime is the failure this avoids.
 *
 * It covers EVERY outcome class, not one. A harness that exercises a
 * single class passes while the rest are silently wrong, and a harness
 * that cannot report "nothing changed" cannot be trusted when it does:
 *
 *   1 shrinks           a sparse map gives its three tables back
 *   2 integrity         every survivor is still findable, with its value
 *   3 iteration         iter_depth blocks it, and it is retried after
 *   4 dense             a full map is not queued and nothing happens
 *   5 disabled          SCR_MAP_SHRINK=0 does nothing, loudly (own process)
 *   6 free-while-queued a queued map that dies must leave no dangling link
 *   7 regrow            a shrunk map still grows correctly afterwards
 *
 * Build (no rig, no scriptc compiler, no runtime link):
 *   zig cc -O1 -target x86_64-windows-gnu -I<runtime/src> selftest.c -o st.exe
 * Run it TWICE -- plain, and with SCR_MAP_SHRINK=0.
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#define SCR_MAP_SHRINK_STAT 1
#include "scr_map.c"

/* ---- stubs ----------------------------------------------------------
 * scr_map.c references twelve runtime symbols. NONE is reachable from an
 * f64-keyed, f64-valued map with no trace functions, which is every map
 * this test builds -- so each stub ABORTS rather than returning a
 * plausible value. A stub that quietly answers would let the test pass
 * through a path it was never meant to touch. */
/* scr_cycle.c owns this pointer; this test does not link scr_cycle.c, so it
 * supplies the definition and then ASSERTS that scr_map.c installs itself
 * into it. That edge is why five gate builds went red: a direct call from
 * the collector to the map is an undefined symbol in every TU that links
 * scr_cycle.c without scr_map.c. */
void (*scr_cyc_idle_hook)(void) = NULL;

static void stub_hit(const char *who) {
  printf("  FAIL  unexpected call into stub: %s\n", who);
  exit(2);
}
_Noreturn void scr_trap(const char *msg) { printf("  TRAP %s\n", msg); exit(3); }
void *scr_cyc_alloc(size_t size, ScrTraceFn trace, ScrCycFreeFn free_fn) {
  (void)size; (void)trace; (void)free_fn; stub_hit("scr_cyc_alloc"); return NULL;
}
void scr_cyc_free(void *obj) { (void)obj; stub_hit("scr_cyc_free"); }
void scr_cyc_on_release(void *obj) { (void)obj; stub_hit("scr_cyc_on_release"); }
void scr_cyc_on_dead(void *obj) { (void)obj; stub_hit("scr_cyc_on_dead"); }
void scr_str_release(ScrStr *s) { (void)s; stub_hit("scr_str_release"); }
bool scr_str_eq(ScrStr *a, ScrStr *b) {
  (void)a; (void)b; stub_hit("scr_str_eq"); return false;
}
ScrArr *scr_arr_new(ScrElemKind elem, size_t initial_cap) {
  (void)elem; (void)initial_cap; stub_hit("scr_arr_new"); return NULL;
}
double scr_arr_push_f64(ScrArr *a, double v) {
  (void)a; (void)v; stub_hit("scr_arr_push_f64"); return 0;
}
double scr_arr_push_ref(ScrArr *a, void *v) {
  (void)a; (void)v; stub_hit("scr_arr_push_ref"); return 0;
}
double scr_arr_get_f64(ScrArr *a, double i) {
  (void)a; (void)i; stub_hit("scr_arr_get_f64"); return 0;
}
void *scr_arr_get_ref(ScrArr *a, double i) {
  (void)a; (void)i; stub_hit("scr_arr_get_ref"); return NULL;
}

static int failures = 0;
static int checks = 0;

static void ok(int cond, const char *what) {
  checks++;
  if (!cond) { failures++; printf("  FAIL  %s\n", what); }
  else printf("  ok    %s\n", what);
}

/* Every arm starts from a known counter state; otherwise "it shrank" can
 * be the previous arm's shrink. */
static void reset_counters(void) { memset(&scr_map_sh, 0, sizeof scr_map_sh); }

static ScrMap *build(size_t n) {
  ScrMap *m = scr_map_new(SCR_MAP_KEY_F64, SCR_MAP_VAL_F64, NULL, NULL, NULL);
  for (size_t i = 0; i < n; i++) scr_map_set_f64_f64(m, (double)i, (double)(i * 7));
  return m;
}

int main(void) {
  size_t N = 4000, KEEP = 50;

  /* ---- 5: the knob, in its own process ---- */
  {
    const char *env = getenv("SCR_MAP_SHRINK");
    if (env != NULL && env[0] == '0' && env[1] == 0) {
      printf("[5] SCR_MAP_SHRINK=0 (separate process)\n");
      reset_counters();
      ScrMap *d = build(N);
      size_t ecapD = d->ecap, nbD = d->nbuckets;
      for (size_t i = KEEP; i < N; i++) scr_map_delete_f64(d, (double)i);
      ok(scr_map_sh.queued == 0, "disabled: nothing was queued");
      scr_map_idle_shrink();
      ok(scr_map_sh.passes == 0, "disabled: no pass ran");
      ok(scr_map_sh.shrunk == 0, "disabled: nothing shrank");
      ok(d->ecap == ecapD, "disabled: ecap untouched");
      ok(d->nbuckets == nbD, "disabled: nbuckets untouched");
      scr_map_shrink_report("arm 5 disabled");
      scr_map_release(d);
      printf("\n%d checks, %d failures\n", checks, failures);
      return failures == 0 ? 0 : 1;
    }
  }

  /* ---- 1 + 2: a sparse map shrinks, and the survivors survive ---- */
  printf("[1] sparse map shrinks\n");
  reset_counters();
  ok(scr_cyc_idle_hook == NULL, "hook is NULL before any map goes sparse");
  ScrMap *m = build(N);
  ok(scr_cyc_idle_hook == NULL, "building a dense map installs nothing");
  size_t ecap0 = m->ecap, nb0 = m->nbuckets;
  ok(ecap0 >= N, "built: ecap >= N");
  for (size_t i = KEEP; i < N; i++) scr_map_delete_f64(m, (double)i);
  ok(m->nlive == KEEP, "deleted down to KEEP live");
  ok(scr_map_sh.queued >= 1, "delete queued the map");
  ok(scr_cyc_idle_hook == scr_map_idle_shrink,
     "the collector hook was installed by the first queue");
  ok(m->sh_queued == 1, "map carries the queued flag");

  scr_map_idle_shrink();
  ok(scr_map_sh.passes == 1, "one pass ran");
  ok(scr_map_sh.visited == 1, "one map visited");
  ok(scr_map_sh.shrunk == 1, "one map shrank");
  ok(m->ecap < ecap0, "ecap fell");
  ok(m->nbuckets < nb0, "nbuckets fell");
  ok(scr_map_sh.ebytes + scr_map_sh.lbytes + scr_map_sh.bbytes > 0, "bytes reported");
  ok(scr_map_sh_head == NULL, "worklist drained");
  ok(m->sh_queued == 0, "queued flag cleared");
  scr_map_shrink_report("arm 1");

  printf("[2] integrity after the move\n");
  int intact = 1;
  for (size_t i = 0; i < KEEP; i++) {
    double v = 0;
    if (!scr_map_get_f64_f64(m, (double)i, &v) || v != (double)(i * 7)) intact = 0;
  }
  ok(intact, "every survivor findable with its value");
  ok((size_t)scr_map_size(m) == KEEP, "Map.size unchanged by the shrink");
  int gone = 1;
  for (size_t i = KEEP; i < N; i += 97) if (scr_map_has_f64(m, (double)i)) gone = 0;
  ok(gone, "deleted keys stay deleted");

  /* ---- 7: a shrunk map still grows ---- */
  printf("[7] regrow after shrink\n");
  for (size_t i = N; i < N + 500; i++) scr_map_set_f64_f64(m, (double)i, (double)i);
  int re = 1;
  for (size_t i = N; i < N + 500; i++) {
    double v = 0;
    if (!scr_map_get_f64_f64(m, (double)i, &v) || v != (double)i) re = 0;
  }
  ok(re, "500 keys added after the shrink all read back");
  ok((size_t)scr_map_size(m) == KEEP + 500, "size correct after regrow");
  scr_map_release(m);

  /* ---- 3: an iteration in flight blocks the shrink ---- */
  printf("[3] iter_depth blocks it, and it is retried\n");
  reset_counters();
  m = build(N);
  size_t ecapA = m->ecap;
  for (size_t i = KEEP; i < N; i++) scr_map_delete_f64(m, (double)i);
  scr_map_iter_enter(m);
  scr_map_idle_shrink();
  ok(scr_map_sh.skip_iter == 1, "skipped: iteration in flight");
  ok(scr_map_sh.shrunk == 0, "nothing shrank while iterating");
  ok(m->ecap == ecapA, "ecap untouched while iterating");
  ok(m->sh_queued == 1, "re-queued rather than dropped");
  scr_map_iter_exit(m);
  scr_map_idle_shrink();
  ok(scr_map_sh.shrunk == 1, "shrank on the pass after the iteration ended");
  ok(m->ecap < ecapA, "ecap fell after the iteration ended");
  scr_map_release(m);

  /* ---- 4: a dense map is never a candidate ---- */
  printf("[4] dense map: not queued, nothing happens\n");
  reset_counters();
  m = build(N);
  size_t ecapB = m->ecap;
  scr_map_sh_queue(m);
  ok(scr_map_sh.queued == 0, "a dense map is not queued by policy");
  scr_map_delete_f64(m, 0.0);
  ok(scr_map_sh.queued == 0, "one delete does not make it a candidate");
  scr_map_idle_shrink();
  ok(scr_map_sh.passes == 0, "no pass: the worklist was empty");
  ok(m->ecap == ecapB, "dense map keeps its capacity");
  scr_map_shrink_report("arm 4");
  scr_map_release(m);

  /* ---- 6: a queued map that dies leaves no dangling link ---- */
  printf("[6] free while queued\n");
  reset_counters();
  m = build(N);
  ScrMap *m2 = build(N);
  for (size_t i = KEEP; i < N; i++) {
    scr_map_delete_f64(m, (double)i);
    scr_map_delete_f64(m2, (double)i);
  }
  ok(scr_map_sh.queued == 2, "both queued");
  scr_map_release(m);
  ok(scr_map_sh.unlinked == 1, "the dying map unlinked itself");
  scr_map_idle_shrink();
  ok(scr_map_sh.visited == 1, "only the survivor was visited");
  ok(scr_map_sh.shrunk == 1, "the survivor still shrank");
  scr_map_release(m2);

  printf("\n%d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
