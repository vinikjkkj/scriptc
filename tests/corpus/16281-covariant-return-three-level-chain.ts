// A covariant return chained through a middle override: the root slot is spelled at the base class, the middle and leaf overrides answer deeper subclasses, and a the base-typed receiver dispatches through the slot.
class PromiseConn {
  impl: number;
  constructor(impl: number) { this.impl = impl; }
  kind(): string { return 'pc:' + this.impl; }
}
class PromisePoolConn extends PromiseConn {
  extra(): string { return 'ppc:' + this.impl; }
}
class PromiseLeaf extends PromisePoolConn {
  leaf(): string { return 'leaf:' + this.impl; }
}
class Connection {
  promise(impl: number): PromiseConn { return new PromiseConn(impl); }
}
class PoolConnection extends Connection {
  promise(impl: number): PromisePoolConn { return new PromisePoolConn(impl); }
}
class LeafConnection extends PoolConnection {
  promise(impl: number): PromiseLeaf { return new PromiseLeaf(impl); }
}
function viaBase(c: Connection): string {
  const r = c.promise(5);
  return r.kind() + '|' + String(r instanceof PromiseConn) + '|' + r.constructor.name;
}
console.log(viaBase(new Connection()));
console.log(viaBase(new PoolConnection()));
console.log(viaBase(new LeafConnection()));
const leaf = new LeafConnection().promise(6);
console.log(leaf.kind(), leaf.extra(), leaf.leaf(), leaf instanceof PromisePoolConn);
