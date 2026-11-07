// A member an interface keys by a module-level `unique symbol` const (the shape of mongodb's
// `Disposable { [kDispose](): void }`): reading it, calling it, and calling it through `?.[k]()` on a
// `T | undefined` receiver (absent receiver short-circuits, the call arguments are not evaluated).
const kDispose: unique symbol = Symbol("dispose");
const kTally: unique symbol = Symbol("tally");

interface Disposable {
  [kDispose](): void;
}
interface Counter {
  [kTally](by: number): number;
  label: string;
}

let disposed = 0;
function listen(on: boolean): Disposable | undefined {
  if (!on) return undefined;
  return { [kDispose]: () => { disposed += 1; } };
}
function counter(start: number): Counter | undefined {
  let n = start;
  return { label: "c" + start, [kTally]: (by: number) => (n += by) };
}

const live = listen(true);
const none = listen(false);
live?.[kDispose]();
live?.[kDispose]();
none?.[kDispose]();
console.log(disposed, none === undefined);

let evaluated = 0;
const c = counter(10);
console.log(c?.[kTally]((evaluated += 1, 5)), c?.[kTally](1), c?.label);
const nothing: Counter | undefined = undefined as Counter | undefined;
console.log(nothing?.[kTally]((evaluated += 100, 5)), evaluated);

const fn = live?.[kDispose];
console.log(typeof fn);
if (c !== undefined) console.log(c[kTally](0));
