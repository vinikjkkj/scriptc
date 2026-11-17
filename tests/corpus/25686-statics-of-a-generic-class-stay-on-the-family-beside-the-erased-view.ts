// A static field and a static method of the generic class are one location for every instantiation and for the view's users.
class Registry<K, V> {
  static created = 0;
  static label(): string { return "registry#" + Registry.created; }
  readonly map = new Map<K, V>();
  constructor() { Registry.created++; }
  poke(key: K): string { return Registry.label() + ":" + String(key); }
}
const r1 = new Registry<string, number>();
const r2 = new Registry<string, boolean>();
function viewOf(first: boolean): Registry<string, unknown> { return first ? r1 : r2; }
console.log(viewOf(true).poke("a"), viewOf(false).poke("b"), Registry.created, Registry.label());
Registry.created += 10;
const r3 = new Registry<string, string>();
console.log(viewOf(true).poke("c"), r3.poke("d"), Registry.created);
