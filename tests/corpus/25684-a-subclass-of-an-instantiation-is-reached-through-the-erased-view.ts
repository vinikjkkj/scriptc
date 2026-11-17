// `class Audited extends Ring<string, Item>` overrides the view's slot and calls super: reached through `Ring<string, unknown>`.
interface Item { n: number }
class Ring<K, V> {
  readonly entries = new Map<K, V>();
  trail: string[] = [];
  touch(key: K): void { this.trail.push("ring:" + String(key)); }
  forget(key: K): void { this.entries.delete(key); this.trail.push("forget:" + String(key)); }
}
class Audited extends Ring<string, Item> {
  audits = 0;
  override touch(key: string): void { this.audits++; super.touch(key.toUpperCase()); }
}
class Plain extends Ring<string, string> {}
const audited = new Audited();
const plain = new Plain();
const direct = new Ring<string, Item>();
audited.entries.set("k", { n: 1 });
function route(i: number): Ring<string, unknown> { return i === 0 ? audited : i === 1 ? plain : direct; }
for (let i = 0; i < 3; i++) { route(i).touch("p" + i); route(i).forget("q" + i); }
console.log(audited.trail.join(","), audited.audits);
console.log(plain.trail.join(","), direct.trail.join(","));
console.log(route(0) === audited, route(1) instanceof Plain, route(0) instanceof Audited, route(2) instanceof Audited);
