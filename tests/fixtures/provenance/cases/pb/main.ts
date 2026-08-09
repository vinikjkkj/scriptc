import { describe, describeBundle, describeTable, describeWire, GEN_VERSION, GEN_LIMITS } from "pbgen";

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
// The BUNDLER spelling of the same module (spec/bundle): the root is a
// `var` the twin keeps as an init local and the export is a comma operand,
// so neither the declared export nor the root has a binding anywhere. Only
// the module's own export OBJECT can answer, which is what `module.exports
// = <root>` registers.
console.log(describeBundle());
