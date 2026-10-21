// The definite-assignment fences, deferral-era. A field whose type ADMITS
// undefined starts as JS's undefined and compiles (corpus 1584-1587); a
// `!`-asserted field assigned past the constructor's top level now DEFERS
// instead of fencing — the slot rides `T | undefined` and reads extract
// the declared type (corpus 2429; SEMANTICS.md 372) — so `Lazy` compiles.
// A UNION-typed `!` field now defers too (corpus 7815): the slot is the
// declared union plus an undefined arm, and a read re-tags back to the
// declared union at its consumer. A MAP-typed one (map arms cannot join a
// union) keeps the fence.

class Lazy {
  path!: string; // compiles: deferred init — reads checked-extract
  init(): void {
    this.path = "/tmp/lazy";
  }
}

class Eager {
  root!: string; // compiles: the constructor's top level assigns it
  constructor() {
    this.root = "/";
  }
}

class UnionLazy {
  mode!: string | null; // compiles: the slot is `string | null | undefined`
  init(): void {
    this.mode = null;
  }
}

class MapLazy {
  cache!: Map<string, number>; // fenced: map arms cannot join the deferral union
  init(): void {
    this.cache = new Map();
  }
}

// Reached: collection defers its diagnostics until a reference makes
// them relevant.
new Lazy().init();
new Eager();
new UnionLazy();
new MapLazy();
