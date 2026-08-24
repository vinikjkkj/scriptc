/* selfcheck.c — does this census still COMPILE the way scr_json.c uses it?
 *
 * The census is `-include`d into a 126 MB translation unit that takes half
 * an hour to build, so a typo in the header costs half an hour to find. It
 * costs two seconds to find here. Build it exactly the way the runtime
 * does — the state header first (which is what `-include` means), then
 * scr_runtime.h, then the walk header:
 *
 *   zig cc -fsyntax-only -target x86_64-windows-gnu \
 *     -I <dyncensus> -I <runtime/src> -DSCR_DYNCEN_ARM=8 \
 *     -include <dyncensus>/scr_dyn_census.h  tests/perf/dyncensus/selfcheck.c
 *
 * Run it before every instrumented zapo build. One of mine did not, and a
 * `fprintf(f, "\n")` whose backslash the shell had eaten into a real
 * newline cost exactly one 31-minute build.
 */
#include "scr_runtime.h"

#ifdef SCR_DYNCEN_ON
#include "scr_dyn_census_walk.h"
#endif

/* Reference every hook scr_json.c calls, so an arity or type change here
 * is a compile error here rather than in the big unit. */
int main(void) {
#ifdef SCR_DYNCEN_ON
  ScrDyn *d = NULL;
  (void)d;
  scr_dyncen_key_note(&scr_dyncen_keyrun, "k", 1);
  scr_dyncen_note_korigin(SCR_DYNCEN_KO_SET);
  scr_dyncen_note_grow(1, 0, 4, (long long)sizeof(ScrDynEntry));
  scr_dyncen_note_grow(0, 0, 4, (long long)sizeof(ScrDyn *));
  (void)scr_dyncen_phys(24);
  (void)scr_dyncen_pool_bytes(5);
  (void)scr_dyncen_capclass(4);
  (void)scr_dyncen_bucket(4);
#endif
  return 0;
}
