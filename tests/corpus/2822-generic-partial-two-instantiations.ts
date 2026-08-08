// `Partial<T>` / `Readonly<T>` spelled INSIDE a generic body are resolved
// against the current instantiation's binding for T — so the answer depends
// on which instantiation is lowering, and mapType's memo (keyed by checker
// type identity) must not carry it across. `Partial<T>` is one ts.Type for
// the whole program: without the sensitivity bump, the FIRST instantiation's
// shape was handed to every later one, and a second instantiation over a
// different record silently produced `{}` — no fence, no diagnostic. Two
// instantiations of each generic, over disjoint field sets, is the shape
// that catches it; the third checks that a THIRD one does not reuse the
// second either.
type Config = { host: string; port: number };
type Point = { x: number; y: number };
type Tag = { label: string };

function stash<T>(v: Partial<T>): Partial<T> {
  const held: Partial<T> = v;
  return held;
}
console.log(JSON.stringify(stash<Config>({ host: "x" })));
console.log(JSON.stringify(stash<Point>({ y: 2 })));
console.log(JSON.stringify(stash<Tag>({ label: "t" })));

// Field READS through the second instantiation, not just serialization: a
// shape borrowed from the first would answer undefined here.
const p = stash<Point>({ x: 1, y: 2 });
console.log(p.x, p.y, p.x === undefined);

// A ternary over two Partial<T> parameters plus a Partial<T> local — the
// corpus-907 shape, where the local's declared type is the memo entry.
function pickOne<T>(useFirst: boolean, a: Partial<T>, b: Partial<T>): Partial<T> {
  const chosen: Partial<T> = useFirst ? a : b;
  return chosen;
}
console.log(JSON.stringify(pickOne<Config>(true, { host: "h" }, {})));
console.log(JSON.stringify(pickOne<Point>(false, { x: 1 }, { y: 2 })));

// Readonly<T> maps to the binding itself and rides the same memo entry.
function passRo<T>(v: Readonly<T>): Readonly<T> {
  const local: Readonly<T> = v;
  return local;
}
console.log(JSON.stringify(passRo<Config>({ host: "h", port: 2 })));
console.log(JSON.stringify(passRo<Point>({ x: 4, y: 5 })));

// Reference semantics survive the boundary on the LATER instantiation too.
const original: Partial<Point> = { x: 9 };
const round = stash<Point>(original);
console.log(round === original);
round.y = 8;
console.log(original.y);
