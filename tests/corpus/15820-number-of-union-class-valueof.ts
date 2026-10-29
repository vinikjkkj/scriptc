// Number(v) over a union of number and a program class instance (ToNumber, ToPrimitive with the
// NUMBER hint): valueOf first when the class declares one, toString when valueOf answers an
// object or is absent; a Symbol.toPrimitive-free class. The bson Timestamp shape: a class whose
// valueOf is a number and whose toString takes an optional radix. Node is the oracle.
class Int32Like {
  readonly value: number;
  constructor(v: number) { this.value = v | 0; }
  valueOf(): number { return this.value; }
  toString(radix?: number): string { return this.value.toString(radix); }
}
class ToStringOnly { toString(): string { return "7"; } }
class Both { valueOf(): number { return 3; } toString(): string { return "9"; } }
class ValueOfText { valueOf(): string { return " 0x1F "; } }
class ValueOfFlag { valueOf(): boolean { return true; } }
class ValueOfNaN { valueOf(): number { return NaN; } }
class ValueOfNegZero { valueOf(): number { return -0; } }
class Derived extends Both { }
class NoMembers { x = 1; }
function fTs(t: number | Int32Like): number { return Number(t); }
function fToStr(v: number | ToStringOnly): number { return Number(v); }
function fBoth(v: number | Both): number { return Number(v); }
function fText(v: number | ValueOfText): number { return Number(v); }
function fFlag(v: number | ValueOfFlag): number { return Number(v); }
function fNaN(v: number | ValueOfNaN): number { return Number(v); }
function fNegZero(v: number | ValueOfNegZero): number { return Number(v); }
function fDerived(v: number | Derived): number { return Number(v); }
function fPlain(v: number | NoMembers): number { return Number(v); }
function fOne(v: Int32Like): number { return Number(v); }
console.log(fTs(12), fTs(new Int32Like(-7)), fTs(new Int32Like(2147483647)), fOne(new Int32Like(0)));
console.log(fToStr(5), fToStr(new ToStringOnly()), fBoth(new Both()), fBoth(0.5));
console.log(fText(new ValueOfText()), fFlag(new ValueOfFlag()), fNaN(new ValueOfNaN()), fNegZero(new ValueOfNegZero()));
console.log(fDerived(new Derived()), fPlain(new NoMembers()), fPlain(42));
