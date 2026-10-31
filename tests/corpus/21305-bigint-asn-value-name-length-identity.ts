// A BigInt static read as a value: its name and length, and identity between
// two reads (both are the one interned closure, so === holds).
console.log(BigInt.asUintN.name, BigInt.asUintN.length, BigInt.asIntN.name, BigInt.asIntN.length);
console.log(typeof BigInt.asUintN, BigInt.asUintN === BigInt.asUintN, BigInt.asIntN === BigInt.asUintN);
const pair = [BigInt.asIntN, BigInt.asIntN];
console.log(pair[0] === pair[1], pair[0](8, 130n), pair[1](8, -130n));
