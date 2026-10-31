// assert.throws with an ERROR INSTANCE as the expected value (the
// assert.expectsErrDyn row): Node compares name, message and own enumerable
// keys of the expected error. A matching throw passes; a mismatched message
// fails with the deep-equal AssertionError, which is caught and printed.
import * as assert from "node:assert";

assert.throws(() => { throw new Error("boom"); }, new Error("boom"));
console.log("matching instance passes");

try {
  assert.throws(() => { throw new Error("other"); }, new Error("boom"));
  console.log("mismatch passed (wrong)");
} catch (e) {
  console.log("mismatch caught", (e as Error).name);
}
