// A BARE redeclare — `override x: T;` with no initializer — is a RESET:
// Node [[Define]]s the own property to undefined when the subclass's field
// initializers run (after super() returned), so whatever the base
// constructor assigned is gone until the subclass's constructor writes.
//
// Where the inherited slot can HOLD undefined, the reset is written rather
// than reasoned about: the interned undefined arm into the inherited slot,
// at the member's own position among the initializers. Two spellings ride
// it — the redeclare that keeps the optional type, and the one that drops
// the undefined arm (`collection?: string` → `override collection: string`,
// mongodb's MongoDBCollectionNamespace idiom), whose reads through the
// subclass checked-extract the narrowed type while reads through the base
// keep seeing the union.
class Namespace {
  db: string;
  collection?: string;
  constructor(db: string, collection?: string) {
    this.db = db;
    this.collection = collection === "" ? undefined : collection;
  }
  toString(): string {
    return this.collection ? `${this.db}.${this.collection}` : this.db;
  }
}

class CollectionNamespace extends Namespace {
  override collection: string;
  constructor(db: string, collection: string) {
    super(db, collection);
    this.collection = collection;
  }
  upper(): string {
    return this.collection.toUpperCase();
  }
}

const coll = new CollectionNamespace("shop", "orders");
console.log(coll.toString(), coll.upper(), coll.collection.length);
// The base view of the very same object still reads the union.
const asBase: Namespace = coll;
console.log(asBase.toString(), asBase.collection);
console.log(new Namespace("shop").toString(), new Namespace("shop").collection);
console.log(new Namespace("shop", "").collection);

// The reset with the optional type KEPT: same union both sides.
class Box {
  v?: number;
  constructor(v?: number) {
    this.v = v;
  }
}
class Doubler extends Box {
  override v?: number;
  constructor(v: number) {
    super(v);
    this.v = v * 2;
  }
}
console.log(new Doubler(21).v, new Box(5).v, new Box().v);

// One intervening write to ANOTHER field, and the assignment reading the
// constructor's own parameter — mongodb's RunCommandOperation shape.
class Op {
  options?: string;
  constructor(o?: string) {
    this.options = o;
  }
}
class Named extends Op {
  override options: string;
  label: string;
  constructor(o: string, label: string) {
    super(o);
    this.label = label;
    this.options = o;
  }
}
const n = new Named("x", "L");
console.log(n.options, n.label, (n as Op).options);

// The narrowed read travels DOWN: a further subclass that redeclares
// nothing inherits both the slot and the checked-extract, while the base
// view of the same object still reads the union.
class Chain {
  v?: string;
  constructor(o?: string) {
    this.v = o;
  }
  show(): string {
    return this.v ?? "none";
  }
}
class Mid extends Chain {
  override v: string;
  constructor(o: string) {
    super(o);
    this.v = o;
  }
  len(): number {
    return this.v.length;
  }
}
class Leaf extends Mid {
  constructor(o: string) {
    super(o + "!");
  }
}
const leaf = new Leaf("ab");
console.log(leaf.v, leaf.len(), leaf.show(), (leaf as Chain).v, new Chain().show());

// Two independent subclasses redeclaring the SAME optional base slot, one
// dropping the arm and one keeping it: one slot, two views, neither
// disturbing the base.
class Cell {
  v?: number;
  constructor(o?: number) {
    this.v = o;
  }
}
class Pinned extends Cell {
  override v: number;
  constructor(o: number) {
    super(o);
    this.v = o;
  }
}
class Kept extends Cell {
  override v?: number;
  constructor(o: number) {
    super(o);
    this.v = o * 2;
  }
}
console.log(new Pinned(3).v, new Kept(3).v, new Cell().v);

// The reset is OBSERVABLE, and the written form answers it exactly: a
// field initializer declared AFTER the redeclare runs after it (Node's
// order is super() → this class's initializers, in declaration order →
// the constructor body), so it reads the undefined the reset wrote and
// not the value the base constructor assigned.
class Seed {
  v?: number;
  constructor(o?: number) {
    this.v = o;
  }
}
class Watcher extends Seed {
  override v?: number;
  seen: string = String(this.v);
  constructor(o: number) {
    super(o);
    this.v = o;
  }
}
const w = new Watcher(7);
console.log(w.v, w.seen);
