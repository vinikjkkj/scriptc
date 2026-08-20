// The LOUD half, and the one already on the record (estado-kindgate.md 4.1,
// estado-gatemirror.md 9.2, estado-getterwalk.md 9): the index-signature
// capture iterates the dyn object's entries directly, so a captured Error
// handed it the reserved marker and its BOOLEAN value —
//
//     Uncaught TypeError: expected string at $.%error, got boolean
//
// where Node's answer is `{}`, because every own property of an Error is
// non-enumerable. Same encoding, same fix: `entries` is empty, so the capture
// captures nothing and answers Node's empty object.
let u: unknown;
try {
  throw new Error("boom");
} catch (x) {
  u = x;
}
console.log("cast      " + JSON.stringify(u as { [k: string]: string }));

const err = new Error("boom") as unknown;
console.log("direct    " + JSON.stringify(err as { [k: string]: string }));

// A nested one: the error rides an `unknown` field of a record that is itself
// captured. The value inside is the same value, and it answers the same way.
let n: unknown;
try {
  throw new RangeError("rng");
} catch (x) {
  const rec: { err: unknown; n: number } = { err: x, n: 1 };
  n = rec.err;
}
console.log("nested    " + JSON.stringify(n as { [k: string]: string }));
console.log("nested.m  " + (n as Error).message);
