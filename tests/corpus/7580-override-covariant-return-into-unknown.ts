// An override may return a SUBTYPE of a slot whose declaration returns
// `unknown` — the shape every BSON value class uses: nine leaves each
// declaring `toExtendedJSON(): <its own shape>` over one
// `abstract toExtendedJSON(): unknown`.
//
// The vtable slot stays typed at the base (`() -> dyn`); the leaf's own
// function keeps its narrow return, and a synthesized thunk in the slot
// boxes the result. So a base-typed reader sees the same `unknown` Node
// hands it, while a direct call at the leaf keeps the narrow static type.
abstract class BsonValue {
  abstract toExtendedJSON(): unknown;
  abstract label(): string;
}

class Int32 extends BsonValue {
  value: number;
  constructor(value: number) {
    super();
    this.value = value;
  }
  override toExtendedJSON(): { $numberInt: string } {
    return { $numberInt: String(this.value) };
  }
  override label(): string {
    return 'int32';
  }
}

class Sym extends BsonValue {
  value: string;
  constructor(value: string) {
    super();
    this.value = value;
  }
  override toExtendedJSON(): { $symbol: string } {
    return { $symbol: this.value };
  }
  override label(): string {
    return 'symbol';
  }
}

// A leaf whose return needs no widening at all: the slot's own `unknown`.
// It shares the hierarchy with the two above, so its vtable entry is the
// method function itself while theirs are thunks — the mix is the point.
class Raw extends BsonValue {
  override toExtendedJSON(): unknown {
    return 'raw';
  }
  override label(): string {
    return 'raw';
  }
}

const vals: BsonValue[] = [new Int32(7), new Sym('s'), new Raw()];
for (const v of vals) {
  console.log(v.label(), JSON.stringify(v.toExtendedJSON()));
}

// The DIRECT calls keep the narrow type — the widened override is still
// spelled at its own signature for everything that is not the vtable.
const i = new Int32(-3);
const ext: { $numberInt: string } = i.toExtendedJSON();
console.log(ext.$numberInt, ext.$numberInt.length);

const s = new Sym('hello');
console.log(s.toExtendedJSON().$symbol.toUpperCase());

// A base-typed read of the boxed value: console.log of the dyn prints
// what Node prints for the object itself.
function show(v: BsonValue): void {
  console.log(v.toExtendedJSON());
}
show(i);
show(s);
show(new Raw());

// A concrete (non-abstract) root widens too, and its own body still runs
// for a root instance.
class Node0 {
  pick(): unknown {
    return 'root';
  }
}
class Leaf1 extends Node0 {
  override pick(): number {
    return 42;
  }
}
class Leaf2 extends Node0 {
  override pick(): string[] {
    return ['a', 'b'];
  }
}
const ns: Node0[] = [new Node0(), new Leaf1(), new Leaf2()];
for (const n of ns) console.log(n.pick());
console.log(new Leaf1().pick() + 1, new Leaf2().pick().length);
