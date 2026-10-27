// unit-typed operands that are impure: the operand runs first (side effects in order), then the text is "null" / "undefined"
let calls = 0;
let slot: null = null;
let uslot: undefined = undefined;
console.log(`[${(calls++, null)}]`, calls);
console.log("<" + (slot = null) + ">", String(slot = null));
console.log("(" + (calls++, undefined) + ")", calls);
console.log(String((uslot = undefined)), calls);
console.log(`${(calls = calls + 10, null)}`, calls);
