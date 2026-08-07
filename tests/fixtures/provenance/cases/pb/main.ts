import { describe, describeTable, describeWire, GEN_VERSION, GEN_LIMITS } from "pbgen";

console.log(await describe(new Uint8Array([1, 2, 3, 4])));
console.log(describeTable());
// The re-export-only generated module. Its twin's %init has to have run,
// or GEN_VERSION is a NULL ScrStr the first retain dereferences.
console.log(GEN_VERSION, GEN_VERSION.length, GEN_LIMITS.frame, GEN_LIMITS.retries);
// The CJS-whole-export generated module (spec/wire). Its declaration
// names exports the twin holds only as PROPERTIES of the object its last
// line hands to `module.exports`; with no binding of that name anywhere,
// the static call through the declaration had no body to reach.
console.log(describeWire());
