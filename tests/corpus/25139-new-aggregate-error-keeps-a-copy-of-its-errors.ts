// `new AggregateError(errors, message?, options?)` and the `errors` it keeps (a copy of the iterable, non-enumerable); the constructor had no
// lowering. Its instances behave like any Error: message, name, instanceof, String(), throw/catch, rejection.
const e = new AggregateError([new Error("a"), "b", 3], "m");
console.log(e.errors.length, e.message, e.name, e instanceof AggregateError, e instanceof Error, String(e));
try {
  throw e;
} catch (x) {
  console.log(x instanceof AggregateError, String(x));
  if (x instanceof AggregateError) console.log(x.errors.map((v) => String(v)).join("|"));
}
const empty = new AggregateError([]);
console.log(empty.errors.length, JSON.stringify(empty.message), empty.name);
const called = AggregateError([1, 2], "called");
console.log(called.errors.length, called.message);
const source = ["x", "y"];
const copy = new AggregateError(source, "copy");
source.push("z");
console.log(copy.errors.length, source.length);
const withCause = new AggregateError([1], "with cause", { cause: "root" });
console.log(String(withCause.cause), withCause.errors.length);
Promise.reject(new AggregateError([new Error("inner")], "agg")).catch((r) => console.log(String(r), r instanceof AggregateError));
