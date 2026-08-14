// `crypto.timingSafeEqual(a, b)` — the SC2020 group-A member with no
// dispatcher at all until now (zapo util/bytes.ts:284, inside
// `uint8TimingSafeEqual`). `timingSafeEqual` had ZERO occurrences in
// packages/compiler/src before the commit that added it.
//
// Two of its properties are contracts, and they are the whole reason the
// member exists:
//
//   1. A LENGTH MISMATCH THROWS —
//      `RangeError [ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH]: Input buffers
//      must have the same byte length`. It must NOT answer `false`.
//      Answering would put back exactly the data-dependent result this
//      function exists to remove, and it would silently change the
//      meaning of every caller that relies on the throw. Rows 3 and 4
//      pin the throw and its message; row 5 pins that a caller which
//      wants a boolean has to do its own length check first, which is
//      what zapo does.
//
//   2. THE COMPARE DOES NOT SHORT-CIRCUIT. That is a property of the
//      emitted code rather than of any value, so no program can observe
//      it directly; what CAN be pinned is that the answer does not
//      depend on WHERE the difference is. Rows 2 and 6 compare buffers
//      differing in the first byte, the last byte, and the middle, and a
//      32-byte MAC-shaped pair differing in one bit.
//
// Row 7 is Node's byte-length contract: the comparison is over BYTES,
// not elements, so a Uint32Array of 2 and a Uint8Array of 8 are a legal
// comparison rather than an error.

import { timingSafeEqual } from 'node:crypto';

const u = (...x: number[]) => new Uint8Array(x);

function raw(a: Uint8Array, b: Uint8Array): string {
    try {
        return 'ok ' + timingSafeEqual(a, b);
    } catch (e) {
        return (e instanceof RangeError ? 'RangeError' : 'Other') + ': ' + (e as Error).message;
    }
}

// 1 — equality, including the empty pair (equal lengths, so no throw).
console.log('eq3    ', raw(u(1, 2, 3), u(1, 2, 3)));
console.log('eq1    ', raw(u(0), u(0)));
console.log('empty  ', raw(u(), u()));

// 2 — inequality does not depend on where the difference is.
console.log('ne-last ', raw(u(1, 2, 3), u(1, 2, 4)));
console.log('ne-first', raw(u(9, 2, 3), u(1, 2, 3)));
console.log('ne-mid  ', raw(u(1, 9, 3), u(1, 2, 3)));
console.log('ne-all  ', raw(u(1, 2, 3), u(4, 5, 6)));

// 3 — the throw, in both orders and at the zero edge.
console.log('2v3    ', raw(u(1, 2), u(1, 2, 3)));
console.log('3v2    ', raw(u(1, 2, 3), u(1, 2)));
console.log('0v1    ', raw(u(), u(1)));
console.log('1v0    ', raw(u(1), u()));

// 4 — the error carries Node's code, and it is a RangeError.
try {
    timingSafeEqual(u(1), u(1, 2));
    console.log('code   ', 'NO THROW');
} catch (e) {
    const errno = e as NodeJS.ErrnoException;
    console.log('code   ', errno.code, '|', e instanceof RangeError, '|', (e as Error).message);
}

// 5 — zapo's own shape (util/bytes.ts:280-286, verbatim): the guard is
// what turns the throw into a boolean, and it has to stay a guard.
function uint8TimingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
    if (left.byteLength !== right.byteLength) {
        return false;
    }
    return timingSafeEqual(left, right);
}
console.log('zapo eq    ', uint8TimingSafeEqual(u(1, 2, 3), u(1, 2, 3)));
console.log('zapo ne    ', uint8TimingSafeEqual(u(1, 2, 3), u(1, 2, 4)));
console.log('zapo empty ', uint8TimingSafeEqual(u(), u()));
console.log('zapo short ', uint8TimingSafeEqual(u(1, 2), u(1, 2, 3)));
console.log('zapo long  ', uint8TimingSafeEqual(u(1, 2, 3), u(1, 2)));

// 6 — the real use: a 32-byte MAC compare, equal and one-bit-off.
const macA = new Uint8Array(32);
const macB = new Uint8Array(32);
for (let i = 0; i < 32; i += 1) {
    macA[i] = (i * 7) & 0xff;
    macB[i] = (i * 7) & 0xff;
}
console.log('mac eq ', raw(macA, macB));
macB[31] = macB[31] ^ 1;
console.log('mac lo ', raw(macA, macB));
macB[31] = macB[31] ^ 1;
macB[0] = macB[0] ^ 0x80;
console.log('mac hi ', raw(macA, macB));

// 7 — Buffers, views, and the BYTE-length contract across widths.
const buf1 = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
const buf2 = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
const buf3 = Buffer.from([0xde, 0xad, 0xbe, 0xee]);
console.log('buffers', raw(buf1, buf2), raw(buf1, buf3));
console.log('buf/u8 ', raw(buf1, u(0xde, 0xad, 0xbe, 0xef)));
const base = u(0, 1, 2, 3, 4, 5);
console.log('views  ', raw(base.subarray(1, 4), u(1, 2, 3)), raw(base.subarray(0, 3), u(1, 2, 3)));
