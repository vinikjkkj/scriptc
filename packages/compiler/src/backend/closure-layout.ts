/** The layout of a closure (ScrClosure in scr_runtime.h), written once for the emitters. A closure is three words before its captures:
 * the refcount, the entry, and `meta` (odd = (ncaps << 1) | 1 with no ext; even = a pointer to the rare-members ext). The own-property
 * table and the minted implicit prototype are NOT fields any more, so a literal that spells the old five-word shape would be a
 * write past the object. test/closure-layout.test.ts parses the header's own _Static_assert and compares it with these. */

/** The C struct an interned (immortal) function-value closure literal is declared with. It MIRRORS ScrClosure's fields, and has to stay
 * exact: the runtime casts &sc_fc_* to ScrClosure * and writes through it. */
export const CLOSURE_C_STRUCT = "struct { size_t rc; void *fn; size_t meta; }";

/** `meta` of a closure with no captures and no ext: every emitted function-value literal starts as this. */
export const CLOSURE_STATIC_META = 1;

/** The C initialiser of an interned closure literal whose entry is `wrapper` (a C expression for the function address). */
export function closureStaticCInit(wrapper: string): string {
  return `{ SIZE_MAX, (void *)${wrapper}, ${CLOSURE_STATIC_META} }`;
}

/** The LLVM struct type of a closure, WITHOUT the captures: the caps[] tail is addressed as element 1 past one whole struct. */
export const CLOSURE_LLVM_TYPE = "{ i64, ptr, i64 }";

/** The LLVM initialiser of an interned closure literal whose entry is the function symbol `wrapperSym` (with its leading @). */
export function closureStaticLlvmInit(wrapperSym: string): string {
  return `{ i64 -1, ptr ${wrapperSym}, i64 ${CLOSURE_STATIC_META} }`;
}
