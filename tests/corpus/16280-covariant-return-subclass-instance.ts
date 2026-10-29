// A subclass override answers an instance of a subclass of the base method's declared return class: the base-typed call gets the subclass instance back through the vtable, uses base and subclass members, and instanceof/constructor.name see the leaf.
class PromiseConn {
  c: Connection;
  impl: number;
  constructor(c: Connection, impl: number) { this.c = c; this.impl = impl; }
  kind(): string { return 'pc:' + this.impl; }
}
class PromisePoolConn extends PromiseConn {
  extra(): string { return 'ppc:' + this.impl + ':' + this.c.tag; }
}
class Connection {
  tag: string;
  constructor(tag: string) { this.tag = tag; }
  promise(impl: number): PromiseConn { return new PromiseConn(this, impl); }
}
class PoolConnection extends Connection {
  promise(impl: number): PromisePoolConn { return new PromisePoolConn(this, impl); }
}
function viaBase(c: Connection): string {
  const r = c.promise(7);
  const leaf = r instanceof PromisePoolConn ? r.extra() : 'base';
  return r.kind() + '|' + leaf + '|' + String(r instanceof PromisePoolConn) + '|' + r.constructor.name;
}
console.log(viaBase(new Connection('C')));
console.log(viaBase(new PoolConnection('P')));
const pool = new PoolConnection('Q');
const sub = pool.promise(9);
console.log(sub.kind(), sub.extra(), sub instanceof PromiseConn, sub instanceof PromisePoolConn, sub.constructor.name);
