// A variable-length tuple (optional or rest element) is a NATIVE value in a
// static build: its arity is read at run time, its literal-index reads are
// checked, and it is not routed to the embedded engine.
const opt: [string, number?] = ["x"];
const rest: [string, ...number[]] = ["y", 1, 2];
const bare: [number, string?] = [1];
console.log(opt.length, rest.length, bare.length);
console.log(opt[0], rest[0], rest[2], bare[0]);
console.log(String(opt[1]), String(rest[1]), String(bare[1]));
const r2: [string, ...number[]] = ["z"];
console.log(r2.length, String(r2[1]));
