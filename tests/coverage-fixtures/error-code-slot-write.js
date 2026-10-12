"use strict";
// ScrError's THIRD SLOT, written through the base `Error` view.
//
// A PAIR on purpose. The slot exists in %Error's layout (`%code`, NULL =
// absent) and the runtime stamps it at every fs/exec throw site, so a
// STRING written through it lands where `error.code` reads back. What the
// slot cannot represent is anything else: a number (Node keeps the value a
// number), or a property with no slot at all. Both halves are asserted, so
// a later widening of the general property-write case fails this test
// instead of quietly passing it.
const e1 = new Error("x");
e1.code = "OK1"; //                LOWERS: base %Error view, string literal
const e2 = new TypeError("y"); //
e2.code = "OK2"; //                LOWERS: a RUNTIME_ERROR_CLASSES subclass
const s = "dyn" + String(1); //
e1.code = s; //                    LOWERS: a string-TYPED, non-literal RHS
const e3 = new Error("z"); //
e3.name = "Boom"; //               LOWERS already: `name` is in the fields map
e3.code = 42; //                   FENCES: Node stores a number; the slot is a ScrStr*
e3.fatal = true; //                FENCES: no slot of any kind
console.log(e1.message, e2.message, e3.name);
