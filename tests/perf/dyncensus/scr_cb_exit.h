/* LAB (never in a shipped build): -include this next to -DSCR_CBIT_COUNT so the report also survives process.exit(), which lowers to _Exit and skips atexit. */
#ifndef SCR_CB_EXIT_H
#define SCR_CB_EXIT_H
#include <stdlib.h>
void scr_cb_dump(void) __attribute__((weak));
#ifdef _Exit
#undef _Exit
#endif
#define _Exit(c) ((scr_cb_dump ? scr_cb_dump() : (void)0), _Exit(c))
#endif
