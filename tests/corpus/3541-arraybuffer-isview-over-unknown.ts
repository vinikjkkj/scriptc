// `ArrayBuffer.isView(v)` over an `unknown` — the third line of the
// payload-normalising idiom whose first two lines already lowered.
//
// `u instanceof Uint8Array` and `u instanceof ArrayBuffer` over a dyn are
// two runtime kind compares (SCR_DYN_BYTES / SCR_DYN_ARRBUF). `isView` is
// the same question asked once more, and it is answerable EXACTLY rather
// than approximately for a reason worth pinning: the dyn tree carries
// exactly two byte flavors, so "is a view" is "is the u8 flavor" — there
// is no third typed-array kind a dyn can hold that would make the compare
// an under-approximation.
//
// The rows below therefore assert two different things at once:
//
//   1. the POSITIVE answers — a Uint8Array, a Buffer, a subarray and a
//      DataView all answer true, because every view maps to one `bytes`
//      representation here (types.ts maps DataView to bytesOf("u8"));
//   2. the NEGATIVE answers over every other dyn kind, including the
//      empty string / 0 / [] / {} falsy-looking ones a truthiness-shaped
//      implementation would get wrong.
//
// Row 1 is the one an `instanceof Uint8Array` chain cannot reach on its
// own: written as the third arm of the real idiom, the first arm answers
// first and the isView arm never runs. Asked on its own, it runs.

function onlyIsView(v: unknown): boolean {
    return ArrayBuffer.isView(v);
}

const u8 = new Uint8Array([1, 2, 3]);
const dv = new DataView(new ArrayBuffer(4));
const sub = u8.subarray(1);
const buf = Buffer.from([7, 8]);

// 1 — every view answers true, asked directly.
console.log('views', onlyIsView(u8), onlyIsView(dv), onlyIsView(sub), onlyIsView(buf));

// 2 — every other dyn kind answers false, falsy ones included.
console.log('scalars', onlyIsView('x'), onlyIsView(''), onlyIsView(1), onlyIsView(0));
console.log('unit   ', onlyIsView(null), onlyIsView(undefined), onlyIsView(true), onlyIsView(false));
console.log('shapes ', onlyIsView({ a: 1 }), onlyIsView({}), onlyIsView([1, 2]), onlyIsView([]));

// A dyn that came from JSON and never held bytes at all.
const parsed: unknown = JSON.parse('{"a":[1,2],"b":"s"}');
console.log('parsed ', onlyIsView(parsed));

// The real spelling: isView as the third arm of the normalising chain.
// Note where each answer comes from — the first two arms shadow the third
// for the Uint8Array flavor, which is exactly why row 1 above exists.
function normalize(data: unknown): string {
    if (data instanceof Uint8Array) {
        return 'u8:' + String(data.length);
    }
    if (data instanceof ArrayBuffer) {
        return 'ab:' + String(data.byteLength);
    }
    if (ArrayBuffer.isView(data)) {
        return 'view';
    }
    if (typeof data === 'string') {
        return 'str:' + data;
    }
    return 'other';
}

console.log(normalize(u8));
console.log(normalize(buf));
console.log(normalize('hi'));
console.log(normalize(42));
console.log(normalize(null));
console.log(normalize(undefined));
console.log(normalize({ a: 1 }));
console.log(normalize([1, 2]));

// The or-chain spelling (zapo's `asBytes` / `toChunkBytes`), where the
// three tests sit in one expression rather than three statements.
function asBytesLike(value: unknown): boolean {
    return value instanceof Uint8Array || value instanceof ArrayBuffer || ArrayBuffer.isView(value);
}

console.log('chain', asBytesLike(u8), asBytesLike(dv), asBytesLike('x'), asBytesLike(7), asBytesLike(null));

// Statically-typed operands fold, and the fold has to agree with the
// runtime answer above — a view is a view whether or not it went through
// a dyn on the way.
console.log('static', ArrayBuffer.isView(u8), ArrayBuffer.isView(dv), ArrayBuffer.isView(sub), ArrayBuffer.isView(buf));

// Condition position and negation, in case a later change routes the test
// through a truthiness path instead of the kind compare.
if (!ArrayBuffer.isView(u8)) {
    console.log('unreachable');
} else {
    console.log('cond ok');
}
console.log(ArrayBuffer.isView(u8) ? 'yes' : 'no', onlyIsView(1) ? 'yes' : 'no');

// The narrowing the test does NOT do: tsc types `v` as ArrayBufferView in
// the true branch, and reads off that narrowing keep their own fences —
// this fixture pins the boolean only, deliberately.
let views = 0;
const mixed: unknown[] = [u8, 'a', dv, 3, sub, null, buf, [1]];
for (const m of mixed) {
    if (ArrayBuffer.isView(m)) {
        views += 1;
    }
}
console.log('counted', views);
