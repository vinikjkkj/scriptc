// One value, two renderings, decided by whether it had crossed the boundary.
// util.inspect's dyn arm saw the checked-dynamic error encoding as an ordinary
// object and printed its members, so the SAME error in the SAME shape answered
//
//     { e: [Error: boom], n: 1 }                                      typed field
//     { e: { '%error': true, name: 'Error', message: 'boom' }, n: 1 }  unknown field
//
// The dyn arm now recognizes the encoding and delegates to the STATIC side's
// renderer, so the two agree. The program compares the two renderings to each
// other rather than printing them, because a compiled binary carries no stack
// frames and Node's do not byte-compare — that divergence is documented and is
// not what this pins. Node prints the identical text twice, so `true`; the
// encoding is what has to make the compiled answer `true` as well.
import { inspect } from "node:util";

const e = new Error("boom");
const typed: { e: Error; n: number } = { e: e, n: 1 };
const viaUnknown: unknown = e;
const dyn: { e: unknown; n: number } = { e: viaUnknown, n: 1 };
console.log("record    " + (inspect(typed) === inspect(dyn)));
console.log("bare      " + (inspect(e) === inspect(viaUnknown)));

let caught: unknown;
try {
  throw new TypeError("bad");
} catch (x) {
  caught = x;
}
const t = caught as Error;
console.log("caught    " + (inspect(t) === inspect(caught)));
console.log("nested    " + (inspect({ e: t, n: 1 }) === inspect({ e: caught, n: 1 })));
