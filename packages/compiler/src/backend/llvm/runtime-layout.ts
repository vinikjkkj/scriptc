/* The runtime struct offsets the LLVM backend addresses by RAW BYTE OFFSET.
 *
 * WHY THIS FILE EXISTS. The C backend cannot drift from the runtime's struct
 * layout: clang type-checks every field access against scr_runtime.h. A .ll
 * `getelementptr inbounds i8, ptr %p, i64 24` is taken on faith by the
 * linker, so the same access on this lane is a hand-copied constant that no
 * compiler checks. Until this file, nothing did: llvm-runtime-abi.test.ts
 * guards `declare` SIGNATURES (arity, widths, pointer-ness, variadic-ness)
 * and never looks at a field offset, and the one test that mentions a struct
 * body asserts the emitted text contains the string the emitter itself just
 * wrote — a tautology with respect to the header, which passes for any
 * layout including a wrong one.
 *
 * WHAT HOLDS THESE NUMBERS NOW. runtime-layout.test.ts generates a C
 * translation unit containing one `_Static_assert(offsetof(...) == N)` per
 * entry below and compiles it through the REAL driver with the REAL target
 * flags. The toolchain that builds the runtime is the thing that adjudicates,
 * so C's padding and alignment rules are never re-derived in TypeScript —
 * that would be a third copy of the very thing being guarded.
 *
 * SCOPE. These are the structs the backend reaches by raw offset and that
 * the bytes fast paths need. They are NOT the whole exposure: eighteen more
 * struct bodies are declared as LLVM types in emitter.ts and ScrDyn is
 * addressed by raw offset in fourteen places, none of them checked. See
 * the block finding for the sized follow-up; the durable fix for most of it
 * is to give ScrBytes and ScrDyn declared bodies so their accesses become
 * typed GEPs and cannot be wrong, rather than raw offsets that are merely
 * checked.
 *
 * LP64 ONLY. Every offset below assumes 8-byte size_t and pointers. The
 * emitted GEPs are `i64` for the same reason. POINTER_BITS is asserted
 * alongside the offsets so an ILP32 target fails LOUDLY in the test instead
 * of silently miscompiling: on such a target these numbers are wrong, not
 * merely unverified. */

/** The pointer/size_t width every offset in this file assumes. */
export const LAYOUT_POINTER_BITS = 64;

export interface RuntimeFieldOffset {
  /** The C struct, spelled as scr_runtime.h spells it. */
  struct: string;
  /** The C field, for `offsetof`. */
  field: string;
  /** The byte offset the emitter writes into a GEP. */
  offset: number;
}

/** ScrBytes { size_t rc; size_t len; ScrBytesElem elem; uint8_t flavor;
 *  uint8_t weakkey; uint8_t *data; struct ScrBytes *backing; }
 *  `flavor` and `weakkey` deliberately ride padding `elem` already carried,
 *  so neither moves `data`; that invariant is prose in the header and these
 *  asserts are what now keeps it true. ScrBytes has no declared LLVM body,
 *  so every access to it is one of these raw offsets. */
export const SCR_BYTES_LEN_OFFSET = 8;
export const SCR_BYTES_DATA_OFFSET = 24;

/** ScrStr { uint32_t rc; uint32_t len; uint32_t cap; char data[]; }
 *  `data` is a flexible array member, so its offset is sizeof of the header
 *  and the literal tables in scr_string.c depend on exactly this number. */
export const SCR_STR_LEN_OFFSET = 4;
export const SCR_STR_DATA_OFFSET = 12;

/** Every entry the layout test proves against the real toolchain. */
export const RUNTIME_FIELD_OFFSETS: readonly RuntimeFieldOffset[] = [
  { struct: "ScrBytes", field: "len", offset: SCR_BYTES_LEN_OFFSET },
  { struct: "ScrBytes", field: "data", offset: SCR_BYTES_DATA_OFFSET },
  { struct: "ScrStr", field: "len", offset: SCR_STR_LEN_OFFSET },
  { struct: "ScrStr", field: "data", offset: SCR_STR_DATA_OFFSET },
];
