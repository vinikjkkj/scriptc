// Node: an index that names no element reads undefined, so every test that tells undefined from a number holds: strict equality, ??, typeof, String(), a template, console.log,
// Object.is and a parameter declared number | undefined.
const b = new Uint8Array([10, 20, 30, 40]);
let i = 7;
let neg = -1;
let frac = 0.5;
const nan = Number("x");
console.log(b[i], b[neg], b[frac], b[nan], b[Infinity], b[4], b[3], b[-0]);
console.log(b[i] === undefined, b[neg] === undefined, b[frac] === undefined, b[nan] === undefined, b[0] === undefined);
console.log(b[i] !== undefined, b[0] !== undefined, b[i] == null, b[i] != null, b[i] == undefined);
console.log(b[i] ?? 99, b[0] ?? 99, b[neg] ?? -5, b[i] ?? b[1]);
console.log(typeof b[i], typeof b[0], typeof b[nan]);
console.log(String(b[i]), `${b[i]}`, "" + b[i], b[i] + "!", `[${b[0]}]`, JSON.stringify([b[i], b[0]]));
console.log(Object.is(b[i], undefined), Object.is(b[0], 10), b[i] === b[neg], b[i] === b[0]);
function show(x: number | undefined): string { return x === undefined ? "none" : "n" + x; }
console.log(show(b[i]), show(b[2]), show(b[neg]));
