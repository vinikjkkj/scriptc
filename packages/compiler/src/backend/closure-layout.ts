/** The layout of a closure (ScrClosure in scr_runtime.h), written once for the emitters. A closure is four words before its captures and is
 * itself a dyn FUNC value: the refcount, the dyn kind with the isdyn/ncaps8 bytes, the entry, and `w` (0 / the cached ScrFnDesc / the rare-members ext
 * tagged with bit 0). test/closure-layout.test.ts parses the header's own _Static_assert and compares it with these. */

/** The C struct an interned (immortal) function-value closure literal is declared with. It MIRRORS ScrClosure's fields, and has to stay
 * exact: the runtime casts &sc_fc_* to ScrClosure * and writes through it. */
export const CLOSURE_C_STRUCT = "struct { size_t rc; uint32_t kind; uint8_t isdyn; uint8_t ncaps8; uint8_t pad[2]; void *fn; uintptr_t w; }";

/** The dyn kind code of SCR_DYN_FUNC (the LLVM lane hardcodes the kind numbers; the C lane spells the enum). */
export const CLOSURE_DYN_FUNC_KIND = 8;

/** `w` of a closure with no cached descriptor and no ext: every emitted function-value literal starts as this. */
export const CLOSURE_STATIC_W = 0;

/** The C initialiser of an interned closure literal whose entry is `wrapper` (a C expression for the function address). */
export function closureStaticCInit(wrapper: string): string {
  return `{ SIZE_MAX, (uint32_t)SCR_DYN_FUNC, 1, 0, {0, 0}, (void *)${wrapper}, ${CLOSURE_STATIC_W} }`;
}

/** The LLVM struct type of a closure, WITHOUT the captures: the caps[] tail is addressed as element 1 past one whole struct. */
export const CLOSURE_LLVM_TYPE = "{ i64, i32, i8, i8, i8, i8, ptr, i64 }";

/** The LLVM initialiser of an interned closure literal whose entry is the function symbol `wrapperSym` (with its leading @). */
export function closureStaticLlvmInit(wrapperSym: string): string {
  return `{ i64 -1, i32 ${CLOSURE_DYN_FUNC_KIND}, i8 1, i8 0, i8 0, i8 0, ptr ${wrapperSym}, i64 ${CLOSURE_STATIC_W} }`;
}
