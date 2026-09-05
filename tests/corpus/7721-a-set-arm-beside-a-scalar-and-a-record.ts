// The set-arm union rule stated over element types other than `symbol`, and
// over siblings `typeof` cannot split.
//
// `string | Set<string>` splits with `typeof` alone. `{ n: number } | Set<
// string>` does NOT — both answer "object" — and `instanceof Set` is the
// only test there is. That is the case the rule is really about: a set arm
// is admitted because its tag test is exact against EVERY sibling kind, not
// because `typeof` happened to be enough.

type Names = string | Set<string>;
type Counts = number | Set<number>;

function n1(x: Names): string {
  if (x instanceof Set) return "set:" + x.size;
  return "str:" + x;
}
function n2(x: Counts): string {
  if (x instanceof Set) return "set:" + x.size;
  return "num:" + x;
}
console.log(n1("q"), n1(new Set<string>(["a", "b"])));
console.log(n2(3), n2(new Set<number>([1, 2, 3])));

// `typeof` over the same unions: the scalar arm splits, and the set arm is
// what is left.
function n1t(x: Names): string {
  return typeof x === "string" ? "S" : "O";
}
console.log(n1t("q"), n1t(new Set<string>(["a"])));

// A RECORD sibling: `typeof` answers "object" for both arms, so only the
// tag test separates them.
type Bag = { n: number } | Set<string>;
function bag(x: Bag): string {
  if (x instanceof Set) return "set:" + x.size;
  return "rec:" + x.n;
}
console.log(bag({ n: 7 }), bag(new Set<string>(["x", "y"])));

// An ARRAY sibling of the same element type: the two containers that look
// alike, at string width.
type Either = string[] | Set<string>;
function either(x: Either): string {
  if (x instanceof Set) return "set:" + x.size;
  return "arr:" + x.length;
}
const sameA: Either = ["a", "b"];
const sameS: Either = new Set<string>(["a", "b"]);
console.log(either(sameA), either(sameS));

// The unit sibling still works beside a data one — a three-arm union with
// the set arm, a scalar and `undefined`.
type Maybe = string | Set<string> | undefined;
function maybe(x: Maybe): string {
  if (x === undefined) return "none";
  if (x instanceof Set) return "set:" + x.size;
  return "str:" + x;
}
console.log(maybe(undefined), maybe("z"), maybe(new Set<string>(["p"])));

// Equality through the union: the set arm compares by reference, and two
// arms with different tags are never equal.
const one = new Set<string>(["a"]);
const alsoOne: Names = one;
const copyOne: Names = new Set<string>(["a"]);
const asStr: Names = "a";
console.log(alsoOne === one, alsoOne === copyOne, asStr === "a");

// Reassignment across arms in a loop, so the tag really changes at run time.
let cur: Names = "start";
const log: string[] = [];
for (let i = 0; i < 4; i++) {
  cur = i % 2 === 0 ? new Set<string>(["k" + i]) : "s" + i;
  log.push(n1(cur));
}
console.log(log.join("|"));
