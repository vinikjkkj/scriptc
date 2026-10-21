// A void function's result is JS's undefined wherever it is used as a value:
// console.log arguments (in order with their siblings), template and String()
// conversions, typeof, a strict comparison against undefined, and a binding.
// The call still runs, once, in evaluation order. Node is the oracle.
const trace = [];
function noop() { trace.push("noop"); }
const quiet = () => { trace.push("quiet"); };
function mark(x) { trace.push("mark" + x); return x; }

console.log(noop());
console.log(mark(1), quiet(), mark(2), noop());
console.log(`[${noop()}]`, String(quiet()));
console.log(typeof noop(), noop() === undefined, quiet() !== undefined);
const v = noop();
console.log(v, v === undefined, typeof v);
console.log(trace.join(","));
