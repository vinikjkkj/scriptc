// `Cache<string, unknown>` over two instantiations is an erased view: it carries the methods whose signatures do not mention the erased
// type parameter (touch), and refuses, by name and at compile time, a method that reads the erased value type and a field. Nothing
// becomes a run-time throw.
class Cache<K, V> {
  readonly map = new Map<K, V>();
  touch(key: K): void { void key; }
  read(key: K): V | undefined { return this.map.get(key); }
}
const a = new Cache<string, number>();
const b = new Cache<string, boolean>();
function pick(first: boolean): Cache<string, unknown> { return first ? a : b; }
pick(true).touch("k");
console.log(pick(false).read("k"));
console.log(pick(true).map.size);
