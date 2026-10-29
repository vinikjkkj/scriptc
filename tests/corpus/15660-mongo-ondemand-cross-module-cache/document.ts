// Real mongodb shape: a base class declared in another module (imported through a relative .ts path)
// whose field is a Record over an object type with an any-typed member (the on_demand cache).
// A subclass chain extends it; the instances read and write the cache and call toObject.
type BSONElementLike = { type: number; name: string };
type CachedBSONElement = { element: BSONElementLike; value: any | undefined };

export class OnDemandDocument {
  private readonly cache: Record<string, CachedBSONElement | false | undefined> = Object.create(null);
  private readonly indexFound: Record<number, boolean> = Object.create(null);
  protected readonly bson: Uint8Array;
  private readonly offset: number;
  constructor(bson: Uint8Array, offset = 0) {
    this.bson = bson;
    this.offset = offset;
  }
  get size(): number {
    return this.bson.length - this.offset;
  }
  get(name: string): unknown {
    const hit = this.cache[name];
    if (hit === false) return undefined;
    if (hit !== undefined) return hit.value;
    if (name === "a") {
      this.cache[name] = { element: { type: 16, name }, value: this.bson[0] };
      return this.cache[name]!.value;
    }
    this.cache[name] = false;
    return undefined;
  }
  cachedKeys(): number {
    return Object.keys(this.cache).length + Object.keys(this.indexFound).length;
  }
  toObject(): Record<string, unknown> {
    return { a: this.get("a"), size: this.size };
  }
}
