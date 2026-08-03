/* A cycle that closes through a Set's ELEMENT.
 *
 * A Set stores its elements as map KEYS. scr_map_trace visits values only
 * -- and says so: its teardown twin releases "the complement", the keys,
 * precisely because the trace never reached them. That is right for a Map,
 * whose keys are strings or numbers in the cases that predate ref keys.
 * It is wrong for a Set of refcounted elements, where the element can hold
 * the set right back: the collector cannot see the edge, so the pair
 * survives every collection.
 *
 * The shape here is the smallest one that closes such a cycle: a Set whose
 * element is an array, and that array holds the Set. Nothing else refers
 * to either once main drops its handles, so a collector that sees the edge
 * frees both and scr_map_live_count answers 0.
 *
 * Built with -DSCR_RC_AUDIT, whose live counters are what make this
 * assertable without a sanitizer. Drives scr_collect_cycles directly --
 * the library wrapper wants symbols only generated code supplies.
 */
#include <stdio.h>

#include "scr_runtime.h"

int main(void) {
#ifndef SCR_RC_AUDIT
  fprintf(stderr, "needs -DSCR_RC_AUDIT\n");
  return 2;
#else
  const long maps_before = scr_map_live_count();

  /* A Set of ARRAY elements: arrays are a cycle-capable ref kind. */
  ScrMap *set = scr_set_new_ref_traced(&scr_arr_retain_v, &scr_arr_release_v, &scr_arr_trace_v);
  /* An array of MAP elements, so it can hold the set back. */
  ScrArr *arr = scr_arr_new_ref(&scr_map_retain_v, &scr_map_release_v, &scr_map_trace_v, 1);

  /* arr -> set */
  scr_arr_push_ref(arr, scr_map_retain_v(set));
  /* set -> arr, as the set's KEY. The cycle is closed. */
  scr_map_set_ref_bool(set, arr, true); /* the set retains the key itself */

  if (scr_map_size(set) != 1) {
    fprintf(stderr, "FAIL: set did not take the element\n");
    return 1;
  }

  /* Drop the only outside references. Refcounts cannot reach zero now --
   * each side is held by the other -- so this is the collector's job. */
  scr_arr_release(arr);
  scr_map_release(set);

  scr_collect_cycles();

  const long leaked = scr_map_live_count() - maps_before;
  if (leaked != 0) {
    fprintf(stderr, "FAIL: %ld map(s) still live after collect\n", leaked);
    return 1;
  }
  fprintf(stderr, "set key cycle collected\n");
  return 0;
#endif
}
