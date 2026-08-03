// Number.prototype.toString(radix) for radix != 10 (ECMA-262 §21.1.3.6):
// the integer/fraction digit generation V8's DoubleToRadixCString does,
// ported into the runtime (scr_num_to_str_radix). Integers convert by
// repeated division; fractions by repeated multiplication with round-to-
// even and carry back-propagation bounded by the value's own ULP -- so
// exactly the digits the double's precision warrants, byte-exact with
// Node. A literal radix 10 folds to the effect-free toString node; a
// COMPUTED radix lowers too, with the runtime owning the 2..36 range
// check (an out-of-range radix is the JS RangeError). The hex-of-a-byte
// spelling ('0x' + n.toString(16)) is the protocol-decoder shape that
// motivated this.

const bytes = [0, 1, 15, 16, 127, 128, 255]
for (const b of bytes) {
    console.log(`0x${b.toString(16)}`, b.toString(2), b.toString(8), b.toString(36))
}

// Fractions and negatives.
console.log((3.14159).toString(2))
console.log((255.5).toString(16))
console.log((-1000000).toString(36))
console.log((0.1).toString(3))

// A computed radix rides the same runtime path (range-checked there).
let r = 15
function bump(): number {
    r += 1
    return r
}
console.log((255).toString(bump()), (255).toString(bump()))
