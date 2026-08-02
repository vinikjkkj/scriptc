// `Record<K, V>` whose KEY is a type parameter. While K is abstract the
// checker publishes no index signature and no properties for it, so the
// ordinary record walk sees an empty object and refuses -- yet inside a
// monomorphized body the binding says what K is. Substitution lives in the
// checker and its API cannot perform it here, so the shape is read off the
// ALIAS instead.
//
// Both wrappers appear: bare, and under `Readonly<>` (erasure at the IR
// level, and the form the mapped type arrives in through an interface
// member).
type Backend = { name: string };

interface Opts<B extends string = string> {
  readonly backends?: Readonly<Record<B, Backend>>;
  readonly plain?: Record<B, number>;
  readonly tag?: string;
}

export function count<B extends string>(o: Opts<B>): number {
  let n = 0;
  if (o.backends !== undefined) {
    for (const k of Object.keys(o.backends)) n += k.length;
  }
  return o.tag !== undefined ? n + o.tag.length : n;
}

// A RESOLVED Record still walks its real members -- the alias hook must not
// displace an answer the checker was able to give on its own.
const resolved: Record<"a" | "b", number> = { a: 1, b: 2 };

console.log(count<string>({ backends: { sqlite: { name: "s" } }, tag: "abc" }));
console.log(count<string>({ tag: "hi" }));
console.log(count<string>({}));
console.log(resolved.a + resolved.b);
