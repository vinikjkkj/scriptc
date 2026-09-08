// Is "extending classes not declared in the program" caused by the ISLAND, or
// by the base class carrying a field whose TYPE has no representation? These
// differ in what would fix it, and no island appears below.
//
// bigint is refused by the compiler with no value type (SC2001), the same shape
// an islanded package's type has: a name the checker knows and the compiler
// cannot lay out.

// A: base with a fully representable field -- the control.
class BaseOk {
    protected readonly n: number = 1
}
class SubOk extends BaseOk {
    get v(): number { return this.n }
}
console.log('a=' + String(new SubOk().v))

// B: base with an UNREPRESENTABLE field type, no island anywhere.
class BaseBig {
    protected readonly b: bigint = BigInt(1)
}
class SubBig extends BaseBig {
    get v(): string { return String(this.b) }
}
console.log('b=' + new SubBig().v)
