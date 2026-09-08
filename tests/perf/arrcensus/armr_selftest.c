/* Self-test for scr_arrcen_note_arm's reason classifier.
 *
 * Every count below is a distinct prime, so a category that steals another's
 * accesses cannot land on a plausible total. Predictions are written here
 * BEFORE the run; the checker compares the emitted report against them. */
#include <math.h>
#include "scr_arr_census.h"

#define GET SCR_ARRCEN_BYTESGET
#define SET SCR_ARRCEN_BYTESSET

/* ScrBytesElem ordinals, from scr_runtime.h */
#define U8 0
#define U32 1
#define F64 4

int main(void) {
  int k;
  const long long LEN = 16;

  /* --- HITS --- */
  for (k = 0; k < 11; k++) scr_arrcen_note_arm(GET, LEN, F64, (double)(k % 16), 0.0);
  for (k = 0; k < 13; k++) scr_arrcen_note_arm(GET, LEN, U8, (double)(k % 16), 0.0);
  /* u8 store with a value inside the int64 window: a hit */
  for (k = 0; k < 37; k++) scr_arrcen_note_arm(SET, LEN, U8, 3.0, 200.0);
  /* f64 store has NO value window -- NaN and inf must still be hits */
  scr_arrcen_note_arm(SET, LEN, F64, 1.0, NAN);
  scr_arrcen_note_arm(SET, LEN, F64, 2.0, INFINITY);
  scr_arrcen_note_arm(SET, LEN, F64, 3.0, -0.0);
  /* -0.0 index reads element 0 in the real arm, so it is a hit */
  scr_arrcen_note_arm(GET, LEN, F64, -0.0, 0.0);

  /* --- MISS: index window (negative, NaN, both infinities, >= 2^53) --- */
  for (k = 0; k < 7; k++) scr_arrcen_note_arm(GET, LEN, F64, -1.0, 0.0);
  for (k = 0; k < 5; k++) scr_arrcen_note_arm(GET, LEN, F64, NAN, 0.0);
  for (k = 0; k < 3; k++) scr_arrcen_note_arm(GET, LEN, F64, INFINITY, 0.0);
  scr_arrcen_note_arm(GET, LEN, F64, -INFINITY, 0.0);
  scr_arrcen_note_arm(GET, LEN, F64, 9007199254740992.0, 0.0);

  /* --- MISS: fractional --- */
  for (k = 0; k < 19; k++) scr_arrcen_note_arm(GET, LEN, F64, 0.5, 0.0);

  /* --- MISS: out of bounds (whole, in window, past the length) --- */
  for (k = 0; k < 23; k++) scr_arrcen_note_arm(GET, LEN, F64, 16.0, 0.0);

  /* --- MISS: kind (index fine, kind is neither u8 nor f64) --- */
  for (k = 0; k < 29; k++) scr_arrcen_note_arm(GET, LEN, U32, 0.0, 0.0);

  /* --- MISS: value window, u8 store only --- */
  for (k = 0; k < 31; k++) scr_arrcen_note_arm(SET, LEN, U8, 3.0, 1e300);

  /* A u8 store whose index is ALSO bad must be charged to the index, not the
   * value: the arm tests the index first. This is the ordering assertion. */
  for (k = 0; k < 41; k++) scr_arrcen_note_arm(SET, LEN, U8, -1.0, 1e300);
  return 0;
}
