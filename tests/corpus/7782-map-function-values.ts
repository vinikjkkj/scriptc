// `Map<K, () => V>` -- the handler/provider registry, which is how
// mongodb's `MongoClientAuthProviders` keeps one factory per auth
// mechanism and how its OIDC machinery keeps one workflow per environment.
//
// The index-signature overflow store of a record IS a string-keyed ScrMap
// and has carried func values since it existed, through the same
// scr_map_new call, the same `_v` adapters (scr_closure_retain_v /
// scr_closure_release_v) and the same trace argument. So a user Map holding
// a closure is the identical storage under a different spelling -- the
// argument the nested-container and `unknown` cases already make.
//
// Closures are cycle-headered and traced unconditionally
// (scr_closure_trace_v), so a map whose values are functions inherits the
// collector header through the map trace rule, and a handler that captures
// the very registry holding it collects. The last block pins that.

const registry = new Map<string, (n: number) => string>();

registry.set("double", (n) => `d${n * 2}`);
registry.set("square", (n) => `s${n * n}`);

// Reading a value out INTO A BINDING and calling it: a func local has a
// static representation, unlike the dyn of `Map<string, unknown>`.
const dbl = registry.get("double");
console.log(dbl ? dbl(21) : "none");

console.log(registry.size, registry.has("square"), registry.has("cube"));

// Calling straight off the read, through the undefined arm.
console.log(registry.get("square")?.(7));
console.log(registry.get("cube")?.(7));

// Overwriting a key replaces the closure and does not grow the map.
registry.set("double", (n) => `D${n + n}`);
console.log(registry.size, registry.get("double")!(21));

// Insertion order, and both halves of an entry destructure.
for (const [k, v] of registry) console.log(k, v(3));
console.log([...registry.keys()].join(","));

let calls = 0;
registry.forEach((fn) => {
  calls += fn(1).length;
});
console.log("forEach", calls);

// delete answers whether the key was there, and the closure goes with it.
console.log(registry.delete("double"), registry.delete("double"));
console.log(registry.size, registry.get("double") === undefined);

// The SEEDED constructor, with a zero-arity value type.
const seeded = new Map<string, () => number>([
  ["a", () => 1],
  ["b", () => 2],
  ["c", () => 3],
]);
let total = 0;
for (const g of seeded.values()) total += g();
console.log("total", total, seeded.size);

// Function identity is pointer identity, exactly as `===` already is.
const shared = (): number => 99;
const byIdent = new Map<string, () => number>();
byIdent.set("x", shared);
byIdent.set("y", shared);
console.log(byIdent.get("x") === byIdent.get("y"), byIdent.get("x") === shared);
console.log(byIdent.get("x") === (() => 99));

// A NUMBER key, the map's other honest key kind.
const byCode = new Map<number, (s: string) => string>();
byCode.set(1, (s) => s.toUpperCase());
byCode.set(2, (s) => `[${s}]`);
console.log(byCode.get(1)!("hi"), byCode.get(2)!("hi"), byCode.size);

// A func-valued map INSIDE another container: the nested-container
// storage this leans on, one level up.
const outer = new Map<string, Map<string, () => number>>();
outer.set("inner", seeded);
console.log(outer.size, outer.get("inner")?.size);

const listOfRegistries: Map<string, () => number>[] = [seeded, byIdent];
console.log(listOfRegistries.length, listOfRegistries[1]!.get("y")!());

// A record holding one.
interface Holder {
  readonly label: string;
  readonly table: Map<string, () => number>;
}
const held: Holder = { label: "held", table: seeded };
console.log(held.label, held.table.get("b")!());

// The CYCLE: a handler that captures the very registry that holds it.
// map -> closure -> map is a real ring; the collector sees it because the
// map allocates with a header (its value type traces) and the closure
// traces its captures.
const selfish = new Map<string, () => number>();
selfish.set("count", () => selfish.size);
selfish.set("other", () => 7);
console.log("selfish", selfish.get("count")!(), selfish.get("other")!());

// Rebuilding the ring in a loop: every iteration drops the previous one.
for (let i = 0; i < 3; i++) {
  const ring = new Map<string, () => number>();
  ring.set("self", () => ring.size + i);
  console.log("ring", ring.get("self")!());
}

seeded.clear();
console.log(seeded.size, outer.get("inner")?.size, total);
