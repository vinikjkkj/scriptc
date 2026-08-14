// `TypedArray.prototype.sort(cmp?)` — the SC2020 group-A member behind
// zapo message/crypto/phash.ts:43, `ORDER.subarray(0, n).sort(cmp)` on a
// Uint32Array. Only `.toSorted()` on a Uint8Array lowered before this;
// `sort` at any width fenced, and every width other than u8 fenced for
// both.
//
// Four things separate `sort` from the `toSorted` it shares a body with,
// and each has a row here:
//
//   1. IT RETURNS THE RECEIVER. Not a copy — the same typed array, so
//      `a.sort(c) === a` and the caller's own binding is reordered.
//
//   2. A VIEW RECEIVER WRITES THROUGH. `buf.subarray(0, n).sort(c)` must
//      reorder the first n elements of `buf` and leave the tail exactly
//      as it was. That is zapo's spelling, and row 5 pins both halves.
//
//   3. THE COMPARATOR SEES A SNAPSHOT. The spec reads the elements into
//      a List, sorts the LIST, then writes back, so a comparator that
//      reads the array being sorted sees the ORIGINAL contents for the
//      whole sort — never a half-sorted state. Row 6 pins that, and it
//      is the reason `sort` sorts a copy and blits it back instead of
//      shuffling in place.
//
//   4. THE ORDER IS STABLE (ES2019 requires it of both), and the default
//      order is numeric ascending — NOT Array.prototype.sort's string
//      order, which would put 300 before 5.
//
// Float widths take a comparator here on purpose: the DEFAULT order has
// to place NaN last and -0 before +0, which the subtraction this lowers
// to cannot express, so that one form keeps its fence. Comparators that
// return NaN are only used on inputs small enough that any stable sort
// agrees (an inconsistent comparator makes the permutation an algorithm
// detail, not a contract).

// One printer per width: a union-typed parameter is a separate
// unsupported construct (SC1090), and this fixture is about sort.
function show(a: Uint32Array): string {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 1) out.push(String(a[i]));
    return out.join(',');
}
function show8(a: Uint8Array): string {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 1) out.push(String(a[i]));
    return out.join(',');
}
function showI32(a: Int32Array): string {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 1) out.push(String(a[i]));
    return out.join(',');
}
function showI8(a: Int8Array): string {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 1) out.push(String(a[i]));
    return out.join(',');
}
function showF64(a: Float64Array): string {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 1) out.push(String(a[i]));
    return out.join(',');
}
function showF32(a: Float32Array): string {
    const out: string[] = [];
    for (let i = 0; i < a.length; i += 1) out.push(String(a[i]));
    return out.join(',');
}

// 1 — the receiver comes back, and the binding is reordered.
const ident = new Uint32Array([3, 1, 2]);
console.log('identity', ident.sort((x, y) => x - y) === ident, show(ident));

// 2 — the default order is NUMERIC at every integer width.
console.log('def u32', show(new Uint32Array([300, 5, 4000000000, 0]).sort()));
console.log('def u8 ', show8(new Uint8Array([3, 1, 255, 0]).sort()));
console.log('def i32', showI32(new Int32Array([3, -1, 2, -5]).sort()));
console.log('def i8 ', showI8(new Int8Array([3, -1, 2, -128, 127]).sort()));

// 3 — the comparator form, at each width including the floats.
console.log('cmp u32', show(new Uint32Array([300, 5, 4000000000, 0]).sort((x, y) => x - y)));
console.log('cmp u32d', show(new Uint32Array([300, 5, 4000000000, 0]).sort((x, y) => y - x)));
console.log('cmp u8 ', show8(new Uint8Array([3, 1, 255, 0]).sort((x, y) => y - x)));
console.log('cmp i32', showI32(new Int32Array([3, -1, 2, -5]).sort((x, y) => x - y)));
console.log('cmp i8 ', showI8(new Int8Array([3, -1, 2, -128, 127]).sort((x, y) => y - x)));
console.log('cmp f64', showF64(new Float64Array([3.5, 0.5, 2.25, -1.5]).sort((x, y) => x - y)));
console.log('cmp f32', showF32(new Float32Array([3.5, 0.5, 2.25, -1.5]).sort((x, y) => x - y)));

// 4 — stability, and the comparators that order nothing.
const ties = new Uint32Array([10, 21, 30, 41, 50, 61]);
console.log('stable ', show(ties.sort((x, y) => (x % 10) - (y % 10))));
console.log('cmp 0  ', show(new Uint32Array([3, 1, 2]).sort(() => 0)));
console.log('cmp NaN', show(new Uint32Array([3, 1, 2]).sort(() => Number.NaN)));
console.log('empty  ', show(new Uint32Array(0).sort((x, y) => x - y)), '|', show(new Uint32Array(0).sort()));
console.log('single ', show(new Uint32Array([7]).sort((x, y) => x - y)));

// 5 — zapo's spelling: a SUBARRAY receiver reorders its window of the
// backing buffer and leaves the tail alone.
const backing = new Uint32Array(10);
for (let i = 0; i < 10; i += 1) backing[i] = 9 - i;
const window = backing.subarray(0, 5);
const ret = window.sort((x, y) => x - y);
console.log('view   ', show(backing));
console.log('view=me', ret === window);
console.log('viewbuf', show(window));

// 6 — the comparator sees the ORIGINAL contents for the whole sort.
const snap = new Uint32Array([5, 3, 1, 4, 2]);
const seen: string[] = [];
snap.sort((x, y) => {
    let s = '';
    for (let i = 0; i < snap.length; i += 1) s += String(snap[i]);
    if (seen.indexOf(s) < 0) seen.push(s);
    return x - y;
});
console.log('snapshot', seen.join('|'), '->', show(snap));

// 7 — zapo's phash comparator and sort, verbatim in shape: an index
// permutation ordered by the bytes each index points at.
const SCRATCH = new Uint8Array(4096);
const OFFSETS = new Uint32Array(129);
const ORDER = new Uint32Array(128);

function compareScratchSlice(scratch: Uint8Array, offsets: Uint32Array, a: number, b: number): number {
    const aStart = offsets[a];
    const aEnd = offsets[a + 1];
    const bStart = offsets[b];
    const bEnd = offsets[b + 1];
    const aLen = aEnd - aStart;
    const bLen = bEnd - bStart;
    const cmpLen = aLen < bLen ? aLen : bLen;
    for (let k = 0; k < cmpLen; k += 1) {
        const av = scratch[aStart + k];
        const bv = scratch[bStart + k];
        if (av !== bv) return av - bv;
    }
    return aLen - bLen;
}

function orderOf(items: readonly string[]): string {
    const n = items.length;
    let off = 0;
    for (let i = 0; i < n; i += 1) {
        OFFSETS[i] = off;
        const s = items[i];
        for (let k = 0; k < s.length; k += 1) {
            SCRATCH[off] = s.charCodeAt(k);
            off += 1;
        }
    }
    OFFSETS[n] = off;
    for (let i = 0; i < n; i += 1) ORDER[i] = i;
    ORDER.subarray(0, n).sort((a, b) => compareScratchSlice(SCRATCH, OFFSETS, a, b));
    const out: string[] = [];
    for (let i = 0; i < n; i += 1) out.push(String(ORDER[i]));
    return out.join(',');
}

console.log('phash 0 ', orderOf([]));
console.log('phash 1 ', orderOf(['5511@s.whatsapp.net']));
console.log('phash up', orderOf(['a@s.net', 'b@s.net', 'c@s.net']));
console.log('phash dn', orderOf(['c@s.net', 'b@s.net', 'a@s.net']));
console.log('phash eq', orderOf(['b@s.net', 'a@s.net', 'b@s.net', 'a@s.net']));
console.log('phash px', orderOf(['ab', 'a', 'abc', 'a']));
console.log('phash re', orderOf([
    '5511999999999@s.whatsapp.net',
    '5511888888888@s.whatsapp.net',
    '120363000000000000@g.us',
    '5511777777777:12@s.whatsapp.net',
    '5511999999999@s.whatsapp.net',
]));
const many: string[] = [];
for (let i = 0; i < 64; i += 1) many.push('55119' + String(1000000 + ((i * 37) % 64)) + '@s.whatsapp.net');
console.log('phash 64', orderOf(many));
