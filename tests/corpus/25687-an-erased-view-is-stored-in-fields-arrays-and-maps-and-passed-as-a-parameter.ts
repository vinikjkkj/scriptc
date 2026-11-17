// The `<string, unknown>` view as a stored and passed type: a field, an array, a Map value, a parameter, a closure capture, with K-typed
// and optional parameters and returns on the view's slots.
class Tracker<K, V> {
  private readonly keys: K[] = [];
  readonly values = new Map<K, V>();
  add(key: K, weight = 1): number { for (let i = 0; i < weight; i++) this.keys.push(key); return this.keys.length; }
  has(key: K): boolean { return this.keys.indexOf(key) >= 0; }
  echo(key: K, suffix?: string): K { void suffix; return key; }
  count(): number { return this.keys.length; }
  put(key: K, value: V): void { this.values.set(key, value); }
}
interface Msg { text: string }
class Holder {
  current: Tracker<string, unknown>;
  all: Tracker<string, unknown>[] = [];
  byName = new Map<string, Tracker<string, unknown>>();
  constructor(first: Tracker<string, unknown>) { this.current = first; }
}
const msgs = new Tracker<string, Msg>();
const sizes = new Tracker<string, number>();
const tags = new Tracker<string, string[]>();
function bump(t: Tracker<string, unknown>, key: string): number { return t.add(key, 2); }
const holder = new Holder(msgs);
holder.all.push(sizes, tags);
holder.byName.set("msgs", msgs);
holder.byName.set("tags", tags);
console.log(bump(holder.current, "a"), bump(holder.all[0], "b"), bump(holder.all[1], "c"), holder.byName.get("msgs")!.add("d"));
holder.current = sizes;
console.log(holder.current.has("b"), holder.current.has("a"), holder.all[1].echo("zz"), holder.all[1].echo("yy", "!"), holder.byName.get("tags")!.count());
const later = (t: Tracker<string, unknown>) => () => t.add("late");
const addLate = later(tags);
console.log(addLate(), addLate(), tags.count(), msgs.count(), sizes.count());
msgs.put("m", { text: "hi" });
sizes.put("s", 4);
console.log(msgs.values.get("m")!.text, sizes.values.get("s")! + 1);
