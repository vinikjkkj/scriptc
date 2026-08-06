// `new Uint8Array(x.buffer, ...)` is the VIEW the bytes<buf> flavor exists
// for: the same construction Buffer.from(x.buffer, ...) and new
// DataView(x.buffer, ...) already build. Node is the oracle.
//
// Divergence NOT exercised here, deliberately: an out-of-bounds offset or
// length throws Node's DataView-shaped RangeError rather than the typed
// array's, because the construction rides the same intrinsic those two do.
//
// `x.constructor === Uint8Array` is covered by 2747, not here. It was
// fenced when this fixture was written, for the reason the note used to
// give: Buffer and Uint8Array are ONE representation, so a Buffer at a
// Uint8Array-typed slot could not be told from a plain view. That reason
// was right about the CHECKER and wrong about the only remaining fix —
// the flavor now rides the VALUE, so the predicate answers at runtime.

const u = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

// The whole-buffer view, an offset view, and an offset+length view.
console.log("whole", new Uint8Array(u.buffer).join(","));
console.log("from-6", new Uint8Array(u.buffer, 6).join(","));
const mid = new Uint8Array(u.buffer, 2, 4);
console.log("mid", mid.join(","), mid.length, mid.byteLength);

// A view ALIASES: writes through it are visible on the owner and back.
mid[0] = 99;
console.log("alias-out", u[2]);
u[5] = 77;
console.log("alias-in", mid[3]);

// A view of a view stays buffer-relative (the owner is the one buffer).
const inner = new Uint8Array(mid.buffer, 1, 2);
console.log("inner", inner.join(","));

// The one-argument COPY constructor is untouched: same-kind sources copy.
const copy = new Uint8Array(u);
copy[0] = 42;
console.log("copy-independent", u[0], copy[0]);

// An ArrayBuffer VALUE (the narrowed union arm) takes the whole-buffer view.
function view(x: Uint8Array | ArrayBuffer): Uint8Array {
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  return x;
}
console.log("value-arm", view(u).join(","));

// The two branches of the real toBytesView funnel that DO compile: the
// ArrayBuffer arm and the ArrayBufferView arm's three-argument view.
function toBytesView(value: Uint8Array | ArrayBuffer | ArrayBufferView): Uint8Array {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
}
console.log("toBytesView", toBytesView(u).join(","));

// RC stress: 200k views over owners that die immediately after.
let acc = 0;
for (let i = 0; i < 200000; i++) {
  const owner = new Uint8Array([1, 2, 3, 4]);
  const v = new Uint8Array(owner.buffer, 1, 2);
  acc += v[0]! + v[1]! + toBytesView(owner)[3]!;
}
console.log("stress", acc);
