// A covariant return through EventEmitter-rooted classes, the shape of mysql2 PoolConnection/PromisePoolConnection: a base-typed vtable call gets the subclass instance back, base and subclass members work, events emit on it, and instanceof and constructor.name see the leaf.
import { EventEmitter } from "node:events";
class BaseP extends EventEmitter {
  conn: Base;
  impl: number;
  constructor(conn: Base, impl: number) { super(); this.conn = conn; this.impl = impl; }
  kind(): string { return 'bp:' + this.impl; }
}
class SubP extends BaseP {
  tag: string;
  constructor(conn: Base, impl: number) { super(conn, impl); this.tag = 'sub'; }
  extra(): string { return 'sp:' + this.impl + ':' + this.conn.name; }
}
class Base extends EventEmitter {
  name: string;
  constructor(name: string) { super(); this.name = name; }
  promise(impl: number): BaseP { return new BaseP(this, impl); }
}
class Sub extends Base {
  promise(impl: number): SubP { return new SubP(this, impl); }
}
function viaBase(c: Base): string {
  const r = c.promise(7);
  r.on('ping', (v: number) => console.log('got ping', v, r.kind()));
  r.emit('ping', 42);
  return r.kind() + '|' + String(r instanceof SubP) + '|' + r.constructor.name + '|' + String(r.listenerCount('ping'));
}
console.log(viaBase(new Base('B')));
console.log(viaBase(new Sub('S')));
const s = new Sub('Q').promise(9);
s.on('ping', (v: number) => console.log('sub ping', v, s.extra()));
s.emit('ping', 5);
console.log(s.kind(), s.extra(), String(s instanceof BaseP), String(s instanceof SubP), s.constructor.name, s.tag);
