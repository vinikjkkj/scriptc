// A Map<K, unknown> parameter accepts a typed map only when no use of it can read or write a value (compares by identity,
// size, has, delete, clear, pass-through to another such parameter). A write of a foreign value through the erased view, or a
// read of a value, keeps the compile-time refusal: it is never compiled into a run-time throw.
interface Rec { id: string }
class Store {
  protected readonly recs: Map<string, Rec> = new Map();
  writes(): void { this.writeForeign(this.recs, "k"); }
  reads(): void { this.readValue(this.recs, "k"); }
  protected writeForeign(entries: Map<string, unknown>, key: string): void { entries.set(key, 42); }
  protected readValue(entries: Map<string, unknown>, key: string): void { console.log(entries.get(key)); }
}
new Store().writes();
new Store().reads();
