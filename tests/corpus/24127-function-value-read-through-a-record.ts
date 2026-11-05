// A function IS an object: `name` and `length` are readable through a record type (mysql2's ResultSetHeader declares
// `constructor: { name: 'ResultSetHeader' }`, and an instance's constructor is its class).
interface Named { name: string }
interface Sized { length: number }
interface Both { name: string; length: number }
interface Header { constructor: { name: string }; affectedRows: number }
class Packet { affectedRows = 2; }
class Pair { a: number; b: number; constructor(a: number, b: number) { this.a = a; this.b = b; } }
function anyFn(): any { return function twoArgs(a: number, b: number) { return a + b; }; }
function arrow(): any { return (x: number) => x; }
function cls(): any { return Pair; }
function inst(): any { return new Packet(); }
const f = anyFn() as Named;
const g = arrow() as Both;
const h = cls() as Both;
const s = anyFn() as Sized;
console.log(f.name, g.length, h.name, h.length, s.length);
const r = inst() as Header;
console.log(r.affectedRows, r.constructor.name);
