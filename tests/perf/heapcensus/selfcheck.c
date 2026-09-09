/* selfcheck.c - does this census still COMPILE the way a real build uses it?
 *
 * scr_heap_census.h is force-included into every translation unit of a
 * program that takes tens of minutes to build, so a typo in it costs a
 * whole build to find. It costs two seconds to find here. This mirrors
 * tests/perf/dyncensus/selfcheck.c, which exists because a fprintf format
 * string whose backslash a shell had eaten cost exactly one 31-minute
 * build.
 *
 *   zig cc -c -target x86_64-windows-gnu \
 *     -include tests/perf/heapcensus/scr_heap_census.h \
 *     tests/perf/heapcensus/selfcheck.c -o <tmp>/hc-selfcheck.o
 *
 * The header's functions are static and attribute((unused)), so an empty
 * translation unit is enough to type-check every one of them; referencing
 * the free-side hooks below additionally pins their arity and types, so a
 * signature change is a compile error here rather than in the big unit.
 */
int main(void) {
  scr_hc_note(64, 16);
  scr_hc_fnote(64);
  scr_hc_run_close(0x1000, 0x3000);
  return (int)(scr_hc_pages + scr_hc_runs + scr_hc_frows + scr_hc_flost);
}
