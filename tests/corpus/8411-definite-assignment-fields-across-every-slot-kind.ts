// The definite-assignment shapes that used to be fenced or segfault: a
// `!`-asserted field assigned past the constructor's top level reads
// undefined until its first assignment, whatever its type, a Map included.
class Lazy {
  path!: string;
  init(): void {
    this.path = "/tmp/lazy";
  }
}

class Eager {
  root!: string;
  constructor() {
    this.root = "/";
  }
}

class UnionLazy {
  mode!: string | null;
  init(): void {
    this.mode = null;
  }
}

class MapLazy {
  cache!: Map<string, number>;
  init(): void {
    this.cache = new Map();
    this.cache.set("k", 1);
  }
}

const lazy = new Lazy();
const eager = new Eager();
const union = new UnionLazy();
const map = new MapLazy();
console.log(eager.root);
console.log(lazy.path === undefined, union.mode === undefined, map.cache === undefined);
try { console.log(lazy.path.length); } catch (e) { console.log((e as Error).message); }
try { console.log(map.cache.size); } catch (e) { console.log((e as Error).message); }
lazy.init();
union.init();
map.init();
console.log(lazy.path, union.mode, map.cache.get("k"), map.cache.size);
