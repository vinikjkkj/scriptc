// Every bitwise operator over the whole ToInt32/ToUint32 minefield, against
// the Node oracle, value by value.
//
// WHY THIS PROGRAM EXISTS. The seven `scr_bit_*` helpers were moved from
// out-of-line functions in scr_lib.c to `static inline` twins in
// scr_runtime.h, because callgrind priced a single `&` at 30 instructions and
// 16 of them were the stack frame of a call that did nothing else. That is a
// pure-performance change over code whose SEMANTICS are the easiest in the
// language to get subtly wrong: JS `&` is ToInt32 on doubles, so it has to
// answer for negative zero, NaN, both infinities, everything past 2^31 and
// 2^32, non-integral doubles, the SIGN of the result, and the difference
// between `>>` and `>>>`. A refusal replaced by a wrong answer would be
// silent here, and the fast path (|d| < 2^32, one truncating conversion) and
// the cold path (trunc + fmod) split exactly on the boundary this table
// straddles.
//
// The operands are read out of an array rather than written as literals in
// the expression, so nothing here can be constant-folded by the frontend --
// the RUNTIME conversion is what gets exercised. A second, smaller block
// below uses literal operands on purpose, so the folder (if it ever grows
// one) has to agree with the runtime.
//
// -0 IS OBSERVED, not assumed away: `show` uses Object.is, so a result that
// came back as negative zero prints as "-0" and diverges from Node. No
// bitwise operator may ever produce -0 (Int32 and Uint32 both round-trip
// through +0), and this is the program that would say so.
//
// String and object operands are NOT here, and that is a fact about the
// language rather than a gap: TypeScript rejects `"5" & 3` outright
// (TS2362/TS2363), so the typed lane has no such program to compile.

const VALS: number[] = [
  0,
  -0,
  1,
  -1,
  0.5,
  -0.5,
  1.5,
  -1.5,
  -2.5,
  NaN,
  Infinity,
  -Infinity,
  7,
  31,
  32,
  33,
  1023,
  2147483647, // 2^31 - 1
  2147483648, // 2^31
  2147483648.5,
  -2147483648, // INT32_MIN
  -2147483649,
  4294967295, // 2^32 - 1
  4294967296, // 2^32, the exact fast-path boundary
  4294967297,
  -4294967296,
  9007199254740991, // 2^53 - 1
  -9007199254740991,
  1e21,
  -1e21,
  123456789.75,
  -3.9999999999,
]

// Object.is, so negative zero is visible rather than folded into "0".
function show(x: number): string {
  if (Object.is(x, -0)) return "-0"
  return String(x)
}

let lines = 0

function emit(text: string): void {
  console.log(text)
  lines += 1
}

// ── the cross product: every operator over every ordered pair ────────────
for (let i = 0; i < VALS.length; i++) {
  for (let j = 0; j < VALS.length; j++) {
    const a = VALS[i]
    const b = VALS[j]
    const sa = show(a)
    const sb = show(b)
    emit(sa + " & " + sb + " = " + show(a & b))
    emit(sa + " | " + sb + " = " + show(a | b))
    emit(sa + " ^ " + sb + " = " + show(a ^ b))
    emit(sa + " << " + sb + " = " + show(a << b))
    emit(sa + " >> " + sb + " = " + show(a >> b))
    emit(sa + " >>> " + sb + " = " + show(a >>> b))
  }
}

// ── unary complement over the same table ──────────────────────────────────
for (let i = 0; i < VALS.length; i++) {
  const a = VALS[i]
  emit("~" + show(a) + " = " + show(~a))
}

// ── `>>` and `>>>` disagree exactly on the sign bit ───────────────────────
// Spelled out as its own block because it is the one pair of operators whose
// results differ only for negative left operands, and only for a nonzero
// shift: `-1 >> 0` and `-1 >>> 0` are -1 and 4294967295.
for (let i = 0; i < VALS.length; i++) {
  const a = VALS[i]
  for (let s = 0; s <= 33; s++) {
    const arith = a >> s
    const logical = a >>> s
    emit(
      "shift " + show(a) + " by " + String(s) +
      "  >>=" + show(arith) + "  >>>=" + show(logical) +
      "  same=" + String(arith === logical),
    )
  }
}

// ── literal operands: the constant-folding lane must agree ────────────────
emit("lit -0 & -0 = " + show(-0 & -0))
emit("lit 0 & -0 = " + show(0 & -0))
emit("lit -1 >>> 0 = " + show(-1 >>> 0))
emit("lit -1 >> 0 = " + show(-1 >> 0))
emit("lit 2147483648 | 0 = " + show(2147483648 | 0))
emit("lit 4294967296 | 0 = " + show(4294967296 | 0))
emit("lit 4294967295 | 0 = " + show(4294967295 | 0))
emit("lit NaN | 0 = " + show(NaN | 0))
emit("lit Infinity | 0 = " + show(Infinity | 0))
emit("lit -Infinity | 0 = " + show(-Infinity | 0))
emit("lit 1 << 31 = " + show(1 << 31))
emit("lit 1 << 32 = " + show(1 << 32))
emit("lit ~0 = " + show(~0))
emit("lit ~-1 = " + show(~-1))
emit("lit ~2147483647 = " + show(~2147483647))

// ── compound assignment forms take the same path ──────────────────────────
let acc = -1
acc &= 0xff
emit("compound &= " + show(acc))
acc |= 0x100
emit("compound |= " + show(acc))
acc ^= 0xffff
emit("compound ^= " + show(acc))
acc <<= 3
emit("compound <<= " + show(acc))
acc >>= 2
emit("compound >>= " + show(acc))
acc >>>= 1
emit("compound >>>= " + show(acc))

console.log("LINES " + String(lines))
