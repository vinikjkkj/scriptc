// `%TypedArray%.prototype.set(source[, offset])` over a CHECKED-DYNAMIC
// receiver — the only bulk write the typed-array surface has, and the one
// protobufjs's Writer cannot encode a bytes field without.
//
// The dyn typed-array dispatch implemented `at`, `slice` and `subarray` and
// refused every other name its prototype declares, loudly and by name
// ("'Uint8Array.prototype.set' on a dynamic value is not supported yet").
// That refusal is exactly what a generated codec reaches: protobufjs pushes
//
//     function writeBytes(val, buf, pos) { buf.set(val, pos); }
//
// onto its writer chain once per bytes field, and both `val` and `buf`
// arrive untyped, because a value crossing a generated CommonJS module's
// boundary has no static type to arrive with.
//
// ES 23.2.3.26 in the two source shapes that exist at this tier — a typed
// array and a dyn array — with one bounds rule for both, checked BEFORE any
// element moves so a short target is never left half-written. Overlap is
// the part that is easy to get silently wrong: `b.set(b.subarray(0, 3), 2)`
// has to read what was in the buffer, not what the copy has just written,
// so the same-element path is a memmove and the mixed-element path reads
// the whole source out first. Section 4 is that case, and a copy-forward
// loop prints `0102010103` there instead of Node's `0102010203`.
//
// DELIBERATE DIVERGENCES, none printed:
//   * A source that is neither a typed array nor an array — `undefined`,
//     `null`, a plain object with a `length`, a string. Node runs those
//     through ToObject and reads `length` off the result; answering that
//     from here would be a shape claim nothing has measured, so they keep
//     the loud refusal rather than a guess.
//   * An ArrayBuffer RECEIVER. Node's ArrayBuffer declares no `set` at all,
//     so it keeps the refusal too rather than silently gaining a method the
//     real prototype does not have.
//   * Element types OTHER than Uint8Array, on either side. Not a choice
//     made here: a non-u8 typed value cannot become `unknown` at all yet
//     ("converting typed values to 'unknown'", SC1101), so no program that
//     compiles today can hand this dispatch an Int32Array or a
//     Float64Array. The body converts per element for a mixed pair, and
//     reads the whole source out first so a mixed pair over ONE buffer
//     still sees the bytes that were there — written to the spec because
//     that is what the spec says, and reachable the day the SC1101 fence
//     lifts, not before. Everything below is the u8 surface, which is the
//     whole of what a generated codec uses.

"use strict";

// Hands back its argument at `any` — what every value arriving from a
// generated CommonJS twin is worth, and the receiver kind under test.
function opaque(v) {
  return v;
}

function hex(u) {
  var s = "";
  for (var i = 0; i < u.length; i++) s += u[i].toString(16).padStart(2, "0");
  return s;
}

// ── 1. protobufjs's writeBytes chunk, verbatim in shape ──────────────
function writeBytes(val, buf, pos) {
  buf.set(val, pos);
}
var target = new Uint8Array(10);
writeBytes(opaque(new Uint8Array([1, 2, 3])), opaque(target), 2);
writeBytes(opaque(new Uint8Array([0xaa, 0xbb])), opaque(target), 7);
console.log("writeBytes", hex(target));

// The whole-buffer write the Writer's `finish` does, and the omitted
// offset that defaults to 0.
var whole = new Uint8Array(4);
opaque(whole).set(opaque(new Uint8Array([9, 8, 7, 6])));
console.log("whole", hex(whole));
var head = new Uint8Array(5);
opaque(head).set(opaque(new Uint8Array([1, 2])));
console.log("head", hex(head));

// An empty source is a no-op at any offset that fits, the end included.
var empty = new Uint8Array(3);
opaque(empty).set(opaque(new Uint8Array(0)), 3);
console.log("empty", hex(empty), empty.length);

// ── 2. an ARRAY source takes ToNumber, then the element's own store ───
// `set(["1", null, undefined, 1.9])` is 1, 0, 0, 1 in a Uint8Array: each
// element converts, then wraps mod 2^8 with NaN going to zero.
var conv = new Uint8Array(8);
opaque(conv).set(opaque([255, 256, -1, 1.9, "7", null, undefined, NaN]));
console.log("convert", hex(conv));

var offsetArr = new Uint8Array(5);
opaque(offsetArr).set(opaque([1, 2]), 3);
console.log("arrayOffset", hex(offsetArr));

// ── 3. a Buffer is the same element type ────────────────────────────
// Buffer and Uint8Array share one representation, so a Buffer crossing
// into the dyn world is still SCR_BYTES_U8 and rides the byte-move path in
// both directions.
var fromBuf = new Uint8Array(5);
opaque(fromBuf).set(opaque(Buffer.from([1, 2, 3])), 1);
console.log("fromBuffer", hex(fromBuf));
var intoBuf = Buffer.alloc(5);
opaque(intoBuf).set(opaque(new Uint8Array([7, 8])), 2);
console.log("intoBuffer", hex(intoBuf));

// ── 4. OVERLAP inside one buffer ─────────────────────────────────────
// The source is a VIEW of the target, so a copy-forward loop would read
// bytes it had already overwritten. Both directions, plus the degenerate
// case where the source IS the target.
var fwd = new Uint8Array([1, 2, 3, 4, 5]);
opaque(fwd).set(opaque(fwd.subarray(0, 3)), 2);
console.log("forward", hex(fwd));

var back = new Uint8Array([1, 2, 3, 4, 5]);
opaque(back).set(opaque(back.subarray(2)), 0);
console.log("backward", hex(back));

var self = new Uint8Array([1, 2, 3, 4]);
opaque(self).set(opaque(self), 0);
console.log("itself", hex(self));

// ── 5. bounds are a RangeError, and nothing moves ────────────────────
// Node checks the offset and the fit together and reports both the same
// way, before the first element — so the target below is still all zeroes
// after the throw.
var guard = new Uint8Array(3);
try {
  opaque(guard).set(opaque(new Uint8Array([1, 2, 3, 4])));
} catch (e) {
  console.log("over", String(e), hex(guard));
}
try {
  opaque(guard).set(opaque(new Uint8Array([1])), 3);
} catch (e) {
  console.log("past the end", String(e), hex(guard));
}
try {
  opaque(guard).set(opaque(new Uint8Array([1])), -1);
} catch (e) {
  console.log("negative", String(e), hex(guard));
}
try {
  opaque(guard).set(opaque([1, 2, 3, 4]));
} catch (e) {
  console.log("array over", String(e), hex(guard));
}
console.log("untouched", hex(guard));

// ── 6. the answer is undefined, and it churns clean ──────────────────
console.log("returns", opaque(new Uint8Array(2)).set(opaque([1])));

var acc = new Uint8Array(64);
for (var k = 0; k < 300; k++) {
  var chunk = new Uint8Array([k & 0xff, (k >> 8) & 0xff]);
  opaque(acc).set(opaque(chunk), (k * 2) % 60);
}
console.log("loop", hex(acc.subarray(0, 12)), acc.length);

console.log("done");
