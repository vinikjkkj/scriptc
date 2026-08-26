// The ORDER negative control for poolish-cli.ts.
//
// Node prints:
//     Base.end<B>
//     Late.end<L>
// The compiled program must print neither: the override lives in a class
// EXPRESSION, which registers with its base only when its statement lowers,
// after the call that needed to know about it already compiled. It refuses
// by name at the class expression instead of quietly answering `Base.end<L>`
// at exit 0, which is what it did before the guard.
import late from "poolish/late.js";

console.log(late.first);
console.log(late.second);
