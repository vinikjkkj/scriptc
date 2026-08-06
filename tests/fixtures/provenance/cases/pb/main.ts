import { describe, describeTable, GEN_VERSION, GEN_LIMITS } from "pbgen";

console.log(await describe(new Uint8Array([1, 2, 3, 4])));
console.log(describeTable());
// The re-export-only generated module. Its twin's %init has to have run,
// or GEN_VERSION is a NULL ScrStr the first retain dereferences.
console.log(GEN_VERSION, GEN_VERSION.length, GEN_LIMITS.frame, GEN_LIMITS.retries);
