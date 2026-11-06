// An own key holding undefined is a key: Node's for-in visits it, as Object.keys lists it. A record that crossed into an untyped slot
// publishes only the members it has, so a record whose optional members were omitted lists none of them.
interface Ctx { a?: number; b?: string; c?: boolean }
function keysIn(x: object): string {
  const out: string[] = [];
  for (const k in x) out.push(k);
  return out.join(",");
}
const empty: Ctx = {};
console.log("empty:", keysIn(empty));
const some: Ctx = { a: 1 };
console.log("some:", keysIn(some));
const expl: Ctx = { a: 1, b: undefined };
console.log("explicit:", keysIn(expl));

const d = JSON.parse('{"x":1}') as Record<string, unknown>;
d.u = undefined;
d.y = 2;
console.log("dyn:", keysIn(d), Object.keys(d).join(","));
delete d.u;
console.log("dyn deleted:", keysIn(d));
d.u = undefined;
d.v = null;
console.log("dyn again:", keysIn(d));

const lit = { p: undefined, q: 1 } as Record<string, unknown>;
console.log("literal:", keysIn(lit), Object.keys(lit).join(","));

// a key removed during the walk is not visited; one holding undefined is
const w = JSON.parse('{"a":1,"b":2,"c":3}') as Record<string, unknown>;
w.b = undefined;
const seen: string[] = [];
for (const k in w) {
  seen.push(k);
  if (k === "a") delete w.c;
}
console.log("walk:", seen.join(","));

// an array of holes and undefined values
const arr: unknown[] = [1, undefined, 3];
console.log("array:", keysIn(arr));
