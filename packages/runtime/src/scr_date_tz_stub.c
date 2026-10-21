/* scr_date_tz_stub.c -- the stand-in for scr_date_tz.c in a program with a Date but no
 * local-time use (moduleUsesDateTz is false). Nothing calls it: every local-time entry
 * point sets the gate, and a wrong `false` is a loud trap here, never a wrong answer. */
#include "scr_runtime.h"

int scr_tz_host_tza(double t_ms, double *out_ms) {
  (void)t_ms;
  (void)out_ms;
  scr_trap("scriptc: internal error: a local-time Date operation was linked without the zone table\n");
  return 0;
}
