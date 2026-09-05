// `map.get(k) ?? new Map()` — a nullish default whose OWN checker type has
// no representation, over a left arm that does. store-sqlite's app-state
// reader is the program:
//
//   indexValueMap: indexValueMaps.get(collection) ?? new Map()
//
// A bare `new Map()` types Map<any, any>: the contextual type pins the type
// arguments when the expression is a plain field initializer, but it does
// not reach through `??` into the constructor's inference, and the union
// `Map<string, Uint8Array> | Map<any, any>` reduces to the `any` one — a
// key kind that does not compile. The program is not asking for an
// any-keyed Map; every value that can come out is the left arm's, which is
// what the destination declares. So the destination's type is used, and the
// default is built at it.
//
// What this file pins is the VALUES, on both branches: the present key must
// answer the stored map, the absent key must answer a fresh EMPTY one, and
// the two must not be the same object.

interface State {
  readonly name: string;
  readonly rows: ReadonlyMap<string, number>;
}

const stored = new Map<string, Map<string, number>>();
const a = new Map<string, number>();
a.set("x", 1);
a.set("y", 2);
stored.set("a", a);
const b = new Map<string, number>();
b.set("z", 3);
stored.set("b", b);

const names = ["a", "b", "missing"];
const states: State[] = [];
for (const n of names) {
  states.push({ name: n, rows: stored.get(n) ?? new Map() });
}

for (const s of states) {
  const keys: string[] = [];
  for (const k of s.rows.keys()) keys.push(k);
  console.log(`${s.name} size=${s.rows.size} keys=${keys.join("|")}`);
}

// The present arm really is the stored map's content.
console.log(states[0]!.rows.get("x"), states[0]!.rows.get("y"));
console.log(states[1]!.rows.get("z"));

// The absent arm is a fresh EMPTY map, and it is not shared with the others.
console.log(states[2]!.rows.size, states[2]!.rows.get("x") === undefined);

// A second miss makes a SECOND empty map, not the same one.
const one: ReadonlyMap<string, number> = stored.get("nope") ?? new Map();
const two: ReadonlyMap<string, number> = stored.get("nope") ?? new Map();
console.log(one.size, two.size, one === two);

// The same shape at a local binding rather than a field, and through a
// function's declared return type.
function rowsOf(name: string): ReadonlyMap<string, number> {
  return stored.get(name) ?? new Map();
}
console.log(rowsOf("a").size, rowsOf("b").size, rowsOf("zzz").size);

// The Set twin of the same shape.
const sets = new Map<string, Set<string>>();
const s1 = new Set<string>();
s1.add("p");
sets.set("s", s1);
function tagsOf(name: string): ReadonlySet<string> {
  return sets.get(name) ?? new Set();
}
console.log(tagsOf("s").size, tagsOf("nope").size, tagsOf("s").has("p"));

// An array default at the same shape, which already worked and must keep
// working — the fallback must not have changed it.
const lists = new Map<string, string[]>();
lists.set("l", ["q", "r"]);
function listOf(name: string): readonly string[] {
  return lists.get(name) ?? [];
}
console.log(listOf("l").join(","), listOf("nope").length);

// And a scalar default, the ordinary case: the checker's own type maps and
// nothing about it changes.
const nums = new Map<string, number>();
nums.set("n", 7);
console.log(nums.get("n") ?? -1, nums.get("m") ?? -1);
