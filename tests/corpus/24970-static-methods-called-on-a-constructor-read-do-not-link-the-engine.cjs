// protobufjs' Writer does `this.constructor.alloc(len)`: a STATIC method called on a constructor read off an instance. A constructor read that is
// only a receiver for such a call never runs text (the Function constructor has no `alloc`, `from` or `create`; the call throws the way Node does),
// so the program needs no embedded engine. The Function constructor reached through a prototype is also called with a static name below and must
// throw a TypeError exactly as Node does. Every answer is Node's.
class Writer {
  constructor() { this.len = 3 }
  static alloc(n) { return new Array(n).fill(7) }
  static create() { return new Writer() }
  finish() { return this.constructor.alloc(this.len) }
}
class BufferWriter extends Writer {
  static alloc(n) { return new Array(n).fill(9) }
}
console.log(new Writer().finish().join(','), new BufferWriter().finish().join(','), BufferWriter.create() instanceof Writer)
function make(x) { return x.constructor.create() }
console.log(make(new Writer()) instanceof Writer, make(new BufferWriter()) instanceof Writer)
function f() {}
const FnCtor = Object.getPrototypeOf(f).constructor
for (const name of ['alloc', 'create', 'from']) {
  try { FnCtor[name](1); console.log(name, 'no throw') } catch (e) { console.log(name, e instanceof TypeError, e.constructor.name) }
}
console.log(typeof FnCtor.toString(), FnCtor.hasOwnProperty('prototype'), FnCtor === Function, FnCtor.name, FnCtor.length)
