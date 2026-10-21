// A function whose RESULT is wider than the slot's: a record with extra
// members into a slot that names fewer, and a derived class into its base.
// tsc admits both (result covariance); each lowers exactly through the same
// conversions a direct return would take (width copy, upcast) -- the slot
// call used to throw 'no exact lowering'.
interface Ab {
  a: number;
}
interface Maker {
  make(): Ab;
}
const m: Maker = {
  make() {
    return { a: 1, b: 2 };
  },
};
console.log(m.make().a);
function mk() {
  return { a: 5, b: 6 };
}
const f: () => Ab = mk;
console.log(f().a);

class Base {
  v = 1;
}
class Derived extends Base {
  w = 2;
}
const mkD = (): Derived => new Derived();
const g: () => Base = mkD;
console.log(g().v);
const table: { [k: string]: () => Base } = { d: mkD, b: () => new Base() };
console.log(table["d"]!().v, table["b"]!().v);
