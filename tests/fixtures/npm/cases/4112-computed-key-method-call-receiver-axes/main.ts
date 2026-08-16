// The AXES of `o[k](...)`, one construct per row, each with the dot-form
// control beside it.
//
// 4111 pins the protobufjs consequence. This pins the RULE, and it is the
// fixture that tells the failure apart from the several things it looked
// like:
//
//   axTypeofMember  -- the member READ is fine; the prototype walk finds
//                      the method and `typeof` says "function". Nothing is
//                      missing.
//   axTwoStep       -- `var f = o[k]; f.call(o)` is correct. The function
//                      VALUE the keyed read produces is the right one.
//   axDotName       -- `o.m()` was always correct (scr_dyn_invoke).
//   the four keyed rows -- WRONG before the fix, and each in a different
//                      spelling of the key: a module-scope closure string
//                      (protobufjs's own), a local, a string literal in
//                      subscript position, and a receiver that is a call
//                      result. It was never about the key being dynamic.
//
//   axFromMethod vs axClosureKey -- the row that names the mechanism.
//                      The SAME source expression `b[KEY]()` reported
//                      `this === undefined` from a plain function and
//                      `this === <the caller's receiver>` from a method,
//                      because the callee ran under the ambient-receiver
//                      window that the ENCLOSING call had pushed. That is
//                      also why the same bug printed NaN in one place and
//                      0 in another: two different wrong receivers, two
//                      different arithmetic outcomes, no diagnostic.
import {
  axClosureKey, axLocalKey, axLiteralSubscript, axCallResult,
  axFromMethod, axDotName, axTwoStep, axTypeofMember, axOwnMember,
} from "pbkeyrecv"

console.log("closureKey      = " + axClosureKey())
console.log("localKey        = " + axLocalKey())
console.log("literalSubscript= " + axLiteralSubscript())
console.log("callResult      = " + axCallResult())
console.log("fromMethod      = " + axFromMethod())
console.log("dotName         = " + axDotName())
console.log("twoStep         = " + axTwoStep())
console.log("typeofMember    = " + axTypeofMember())
console.log("ownMember       = " + axOwnMember())
