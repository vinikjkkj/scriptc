/* LAB (never in a shipped build): -include this next to -DSCR_FIELDREAD_COUNT so the field-read report also survives process.exit(), which lowers to _Exit and skips atexit. */
#ifndef SCR_FR_EXIT_H
#define SCR_FR_EXIT_H
#include <stdlib.h>
void scr_fr_dump(void) __attribute__((weak));
#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) ((scr_fr_dump ? scr_fr_dump() : (void)0), _Exit(c))
#endif
