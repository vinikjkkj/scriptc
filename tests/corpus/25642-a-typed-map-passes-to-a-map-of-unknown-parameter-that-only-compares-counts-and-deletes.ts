// A Map<K, unknown> parameter whose every use is value-free receives typed maps: identity, size, has, delete, pass-through.
interface Rec { id: string; n: number }
class Hooked {
  protected readonly recs: Map<string, Rec> = new Map();
  protected readonly names: Map<string, string> = new Map();
  protected readonly counts: Map<string, number> = new Map();
  public readonly log: string[] = [];
  put(k: string, r: Rec): void { this.recs.set(k, r); this.touched(this.recs, k); }
  putName(k: string, v: string): void { this.names.set(k, v); this.touched(this.names, k); }
  putCount(k: string, v: number): void { this.counts.set(k, v); this.touched(this.counts, k); }
  drop(k: string): void { this.removed(this.recs, k); this.removed(this.names, k); this.removed(this.counts, k); }
  has(k: string): string { return [this.recs.has(k), this.names.has(k), this.counts.has(k)].join("/"); }
  sizes(): string { return [this.recs.size, this.names.size, this.counts.size].join("/"); }
  protected touched(entries: Map<string, unknown>, key: string): void {}
  protected removed(entries: Map<string, unknown>, key: string): void {}
}
class Logging extends Hooked {
  private which(entries: Map<string, unknown>): string {
    return entries === this.recs ? "recs" : entries === this.names ? "names" : entries === this.counts ? "counts" : "other";
  }
  protected override touched(entries: Map<string, unknown>, key: string): void {
    this.log.push("touch " + this.which(entries) + ":" + key + " size=" + entries.size + " has=" + entries.has(key));
  }
  protected override removed(entries: Map<string, unknown>, key: string): void {
    // a mutation through the erased view, visible through the typed one
    const had = entries.has(key);
    const ok = entries.delete(key);
    this.log.push("remove " + this.which(entries) + ":" + key + " had=" + had + " deleted=" + ok + " size=" + entries.size);
  }
  wipe(): void { this.clearBoth(this.recs); this.clearBoth(this.names); }
  private clearBoth(entries: Map<string, unknown>): void { entries.clear(); this.log.push("cleared " + this.which(entries)); }
}
const h = new Logging();
h.put("a", { id: "a", n: 1 });
h.putName("a", "alpha");
h.putCount("a", 10);
h.put("b", { id: "b", n: 2 });
console.log(h.sizes(), h.has("a"), h.has("b"));
h.drop("a");
console.log(h.sizes(), h.has("a"), h.has("b"));
h.wipe();
console.log(h.sizes(), h.has("b"));
console.log(h.log.join("\n"));
// the base class alone (empty hooks) and an unrelated map that is not any of the three
const base = new Hooked();
base.put("z", { id: "z", n: 9 });
console.log(base.sizes());
const other = new Map<string, Rec>();
const viaOther = new Logging();
console.log(viaOther.has("q"), other.size);
