// `+` concatenation with a unit operand on either side
console.log("a" + null);
console.log(null + "b");
console.log("c" + undefined);
console.log(undefined + "d");
const n: null = null;
const u: undefined = undefined;
console.log("e" + n);
console.log(n + "f");
console.log("g" + u);
console.log(u + "h");
let acc = "";
acc += null;
acc += undefined;
console.log(acc);
