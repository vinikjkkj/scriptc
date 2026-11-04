// A fresh `new Map()` / `new Set()` whose only typing context is the unbound type parameter of a generic callee
// (the checker leaves it Map<any, any>) takes the type its destination declares: the collection is empty, so the
// retyping changes no value. Record literals, union-like returns, an async callback of a generic `withTransaction`,
// and a nested `.map` callback all reach the declared member.
interface State {
  readonly initialized: boolean;
  readonly version: number;
  readonly byKey: ReadonlyMap<string, Uint8Array>;
  readonly tags: ReadonlySet<string>;
}
class Store {
  protected async withTransaction<T>(run: (conn: number) => Promise<T>): Promise<T> {
    return run(7);
  }
  async one(key: string): Promise<State> {
    return this.withTransaction(async (conn) => {
      const known = new Map<string, number>([["a", conn]]);
      const v = known.get(key);
      if (!v) {
        return { initialized: false, version: 0, byKey: new Map(), tags: new Set() };
      }
      return { initialized: true, version: v, byKey: new Map<string, Uint8Array>([[key, new Uint8Array(v)]]), tags: new Set<string>([key]) };
    });
  }
  async many(keys: readonly string[]): Promise<readonly State[]> {
    if (keys.length === 0) return [];
    return this.withTransaction(async (conn) => {
      const known = new Map<string, number>([["a", conn]]);
      const maps = new Map<string, Map<string, Uint8Array>>([["a", new Map<string, Uint8Array>([["a", new Uint8Array(3)]])]]);
      return keys.map((k) => {
        const v = known.get(k);
        if (!v) return { initialized: false, version: 0, byKey: new Map(), tags: new Set() };
        return { initialized: true, version: v, byKey: maps.get(k) ?? new Map(), tags: new Set<string>([k]) };
      });
    });
  }
}
function show(s: State): string {
  return [s.initialized, s.version, s.byKey.size, [...s.byKey.keys()].join("+"), s.tags.size, s.byKey.has("a"), s.tags.has("a")].join(",");
}
async function main(): Promise<void> {
  const st = new Store();
  console.log(show(await st.one("a")));
  console.log(show(await st.one("zz")));
  console.log((await st.many(["a", "b", "a"])).map(show));
  console.log((await st.many([])).length);
}
void main();
