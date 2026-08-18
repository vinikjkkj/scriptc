// The string conversions that must NOT answer, and the two folds that
// stopped answering wrongly.
//
// 1-2. `x + ''` is ToPrimitive with the DEFAULT hint -- valueOf FIRST --
//      while String(x) and `${x}` are the STRING hint. One lowering cannot
//      honor both, so a class declaring its own valueOf keeps the fence on
//      the `+` spelling. Measured on Node v25.9.0:
//        "" + {valueOf:()=>42, toString:()=>"TS"}  is "42"
//        String(the same object)                   is "TS"
//      corpus 4661 rows 17-18 are the String()/`${}` half, which answers.
class Both {
    valueOf(): number { return 42 }
    toString(): string { return "TS" }
}
const both = new Both()
console.log("plus   " + (both + ''))

// 3. a toString declared only BELOW the receiver's static class: there is
//    no declaration on the base chain, so there is no vtable slot to
//    dispatch through -- emitting the virtualCall anyway is SC9001, and
//    the CLASS-receiver spelling has always refused this. The RECORD
//    receiver used to fold "[object Object]" here, silently, where Node
//    prints "SubTs(1)".
class NoTs { low = 1 }
class SubTs extends NoTs { override toString(): string { return "SubTs(" + this.low + ")" } }
type Rec = { low: number }
const viaBase: NoTs = new SubTs()
const asRec: Rec = viaBase
console.log("subOnly " + asRec.toString())

// 4. a toString whose parameter is REQUIRED: a bare `string` slot has no
//    absent-argument value to mint, so the call has no zero-argument form
//    here. Node calls it with undefined and prints "Req[undefined]2"; the
//    fold used to answer "[object Object]" silently.
class ReqParam { low = 2; toString(sep: string): string { return "Req[" + sep + "]" + this.low } }
const req: Rec = new ReqParam()
console.log("reqParam " + req.toString())
