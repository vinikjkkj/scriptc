// A getter read is an operand with an effect: the getter runs.
const o = { get g(): number { console.log("get"); return 1; } };
console.log(o.g !== undefined);
console.log(undefined !== o.g);
console.log(o.g == null);
