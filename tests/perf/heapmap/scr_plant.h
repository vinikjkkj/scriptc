/* scr_plant.h -- LAB ONLY. The allocation-site positive control for scr_prof.h: 1024 blocks of exactly 2000 bytes malloc'd from ONE source line of this file
 * (a 2016-byte chunk each in glibc), kept live to exit. Include it AFTER scr_prof.h (so its malloc is the interposed one): the PROFLIVE row for
 * "scr_plant.h:<line>" must read 1024 allocations and 2,048,000 bytes. scr_heapmap.h goes FIRST in that build (it includes <malloc.h>, which scr_prof.h's
 * malloc macros would break), and its own PLANT is then left off. */
#ifndef SCR_PLANT_H
#define SCR_PLANT_H
#include <stdlib.h>
#include <string.h>
__attribute__((weak)) void *scr_plant_blocks[1024];
__attribute__((weak)) int scr_plant_done; /* every TU carries the constructor: only the first one plants */
__attribute__((constructor)) static void scr_plant_install(void) {
  if (scr_plant_done++) return;
  for (int i = 0; i < 1024; i++) { scr_plant_blocks[i] = malloc(2000); memset(scr_plant_blocks[i], 0xA5, 2000); }
}
#endif
