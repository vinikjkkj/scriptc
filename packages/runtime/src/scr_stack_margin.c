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
#include "scr_runtime.h"

const char SCR_STACK_MARGIN_SYM[1] = { 0 };
