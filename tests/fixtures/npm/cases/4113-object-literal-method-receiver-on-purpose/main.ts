// CLOSED (kept under its -on-purpose name): this program once did NOT match
// Node; it does now that an object literal whose methods read their own
// `this` builds as a checked-dynamic object.
//
// `o.m()` on an object literal with heterogeneous field types reports
// `this === undefined` inside `m`; Node binds `o`. Same on base fbabf176
// and on `block/varint`'s branch, on both backends -- so it is neither a
// regression of that change nor fixed by it. The `ctor` row is the control
// that says the checked-dynamic tier binds correctly.
//
//   Node    lit=self L     arrEl=self A0   ctor=self C
//   was     lit=undefined  arrEl=undefined ctor=self C
import { lit, arrEl, ctor } from "litrecv"
console.log("lit   = " + lit())
console.log("arrEl = " + arrEl())
console.log("ctor  = " + ctor())
