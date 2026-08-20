// The control the encoding change had to carry with it, and the reason it is
// a fixture rather than a line in a report.
//
// deepStrictEqual over two dyn objects walks own ENUMERABLE members and
// compares [[Prototype]]s. Move `name` and `message` off that table — which is
// exactly what matching Node's enumeration surfaces means — and two errors
// become two same-prototype objects with two empty member tables, i.e. EQUAL.
// A silent PASS on an assertion that must FAIL is worse than the leak it came
// from, so the ERROR branch Node's own isDeepStrictEqual carries (compare
// `name` and `message` on top of the walk) moved with the members.
import assert from "node:assert";

function caught(f: () => void): unknown {
  try {
    f();
  } catch (x) {
    return x;
  }
  return undefined;
}

const a = caught(() => {
  throw new Error("a");
});
const b = caught(() => {
  throw new Error("b");
});
const a2 = caught(() => {
  throw new Error("a");
});
const ta = caught(() => {
  throw new TypeError("a");
});

function eq(x: unknown, y: unknown): string {
  try {
    assert.deepStrictEqual(x, y);
    return "eq";
  } catch (e) {
    return "ne";
  }
}

console.log("same-msg  " + eq(a, a2));
console.log("diff-msg  " + eq(a, b));
console.log("diff-kind " + eq(a, ta));
console.log("self      " + eq(a, a));
console.log("vs-plain  " + eq(a, { name: "Error", message: "a" }));
