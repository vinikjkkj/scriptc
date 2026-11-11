/* The link-time margin agreement's one DEFINITION (see scr_runtime.h).
 *
 * It lives in a translation unit of its own, and that is the whole design:
 * the symbol's NAME carries SCR_STACK_MARGIN_KIB, so whoever defines it
 * drags their own dependencies into every link that wants the margin
 * checked. It used to live in scr_error.c, and that cost eight mutually
 * required runtime units -- scr_array, scr_bytes, scr_cycle, scr_error,
 * scr_exception, scr_number, scr_object and scr_string, measured by
 * elimination, none of them droppable. Four hand-written C unit tests could
 * not pay it and so could not LINK AT ALL, and one of them (cipher)
 * documents "two translation units, no runtime, no libc shim" as the reason
 * it exists: a failure there can only mean AES is wrong, and that sentence
 * does not survive linking the object system into it.
 *
 * With the definition here the price is one TU with no dependencies, so
 * packages/runtime/test/cc.ts appends it to every C test on every platform
 * and all of them check the margin -- where before only the nineteen that
 * happened to link scr_error.c did, by accident rather than by design.
 *
 * THE CHECK IS UNCHANGED AND STILL UNCONDITIONAL. There is no #if here and
 * none in the header: the name is built from the value THIS unit
 * preprocessed, so a lane that resolved a different scr_runtime.h still
 * fails the link naming a symbol nobody defined. Verified in both
 * directions against two header copies at margins 32 and 64 -- the agreeing
 * pair links, the diverging pair fails with
 * "undefined symbol: scr_stack_margin_is_32kib". A control that only
 * passes is not a control: -DSCR_STACK_MARGIN_KIB=64 does NOT reproduce
 * this, because it moves the pin and the definition together and because
 * the header's own #define is unconditional and overrides it.
 *
 * Never read -- only the NAME carries information. */
#define _GNU_SOURCE 1
#include "scr_runtime.h"

const char SCR_STACK_MARGIN_SYM[1] = { 0 };

#if defined(__linux__) && defined(__x86_64__) && (defined(__GNUC__) || defined(__clang__))
/* The Linux stack floor the prologue test reads (SCR_STACK_LOW, scr_runtime.h).
 *
 * `scr_stack_limit_v` is the lowest address a frame may reach on the RUNNING stack: its floor plus SCR_STACK_MARGIN, precomputed so the prologue is one compare; the
 * scheduler rewrites it on every context switch (scr_switch, scr_async.c) so
 * it always belongs to the stack the code is executing on -- the same
 * property Win32 gives the TEB read for free. It is 0 until the main stack is
 * measured, and a 0 limit never compares low: no check rather than a check
 * against a guess.
 *
 * The main stack's floor is its own measured extent: pthread_getattr_np
 * reports the lowest address the kernel will grow the main stack to (the
 * RLIMIT_STACK reservation), so the floor is that address and not an
 * assumed size. An unlimited rlimit is capped at 1 GiB below the entry sp
 * rather than trusted as address-space-sized. Measured at startup by a
 * constructor, so it holds before the first emitted prologue runs and under
 * both backends, with nothing for either emitter to remember. */
#include <pthread.h>
#include <stdint.h>

uintptr_t scr_stack_limit_v = 0;
uintptr_t scr_stack_main_limit_v = 0;

__attribute__((constructor)) static void scr_stack_floor_init(void) {
  pthread_attr_t at;
  void *addr = NULL;
  size_t size = 0;
  if (pthread_getattr_np(pthread_self(), &at) != 0) return;
  if (pthread_attr_getstack(&at, &addr, &size) == 0 && addr != NULL) {
    uintptr_t lo = (uintptr_t)addr;
    uintptr_t hi = lo + size;
    const uintptr_t cap = (uintptr_t)1 << 30;
    if (size > cap) lo = hi - cap;
    scr_stack_main_limit_v = lo + SCR_STACK_MARGIN;
    scr_stack_limit_v = lo + SCR_STACK_MARGIN;
  }
  pthread_attr_destroy(&at);
}
#endif
