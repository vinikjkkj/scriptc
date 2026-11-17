// `new Slot<string, unknown>(dynMap)` keeps its meaning (a monomorph over a dynamic map) while typed instantiations flow into the same
// declared type: the constructed one is reached through the view like the others, and its own typed surface still works at its own type.
class Slot<K, V> {
  readonly map: Map<K, V>;
  log: string[] = [];
  constructor(map: Map<K, V>) { this.map = map; }
  touch(key: K): void {
    const v = this.map.get(key);
    if (v !== undefined) { this.map.delete(key); this.map.set(key, v); }
    this.log.push("touch:" + String(key));
  }
  drop(key: K): boolean { this.log.push("drop:" + String(key)); return this.map.delete(key); }
  keys(): string { return [...this.map.keys()].join(","); }
  logText(): string { return this.log.join(" "); }
  count(): number { return this.map.size; }
  kind(key: K): string { return typeof this.map.get(key); }
}
const typed = new Slot<string, number>(new Map<string, number>([["a", 1], ["b", 2], ["c", 3]]));
const dynMap = new Map<string, unknown>([["x", { n: 1 }], ["y", "why"], ["z", 3]]);
const loose = new Slot<string, unknown>(dynMap);
const all: Slot<string, unknown>[] = [typed, loose];
for (const s of all) { s.touch("a"); s.touch("x"); }
console.log(typed.keys(), "|", loose.keys());
console.log(all[0].drop("b"), all[1].drop("y"), all[1].drop("nope"));
console.log(typed.keys(), "|", loose.keys(), "|", typed.logText(), "|", loose.logText());
console.log(loose.count(), loose.kind("z"), loose.kind("x"), loose.kind("y"), typed.count(), typed.kind("a"), all[0].kind("nope"));
