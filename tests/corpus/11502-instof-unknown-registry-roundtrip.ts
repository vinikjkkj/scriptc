// Values that cross an untyped registry (a Map<string, any> and an any[]) and come
// back as unknown: the class identity must survive the round trip, so instanceof on
// the way out answers for the real class (subclass included), not for a copy.
class Base {
  n = 1;
}
class Leaf extends Base {
  m = 2;
}
class Other {
  n = 3;
}
const registry = new Map<string, unknown>();
registry.set("base", new Base());
registry.set("leaf", new Leaf());
registry.set("other", new Other());
registry.set("plain", { n: 1, m: 2 });
const list: unknown[] = [registry.get("leaf"), registry.get("base")];
function lookup(key: string): unknown {
  return registry.get(key);
}
for (const k of ["base", "leaf", "other", "plain", "missing"]) {
  const v = lookup(k);
  console.log(k, v instanceof Base, v instanceof Leaf, v instanceof Other);
}
for (let i = 0; i < list.length; i++) {
  const u: unknown = list[i];
  console.log("list", i, u instanceof Base, u instanceof Leaf);
}
