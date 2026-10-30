// A class whose valueOf is an arrow-function FIELD, held in `any`. The
// DEFAULT hint (+ and the other operators that use it) asks valueOf first, so d + ""
// is "42" and "x" + d is "x42", while String(d) asks toString first, finds
// only Object.prototype's, and answers "[object Object]". Node: d * 2 is 84,
// d < 50 is true, d == 42 is true, and d.valueOf() is 42.

class V {
  valueOf = () => 42;
}

const d: any = new V();
console.log("String", String(d));
console.log("plus", d + "");
console.log("xplus", "x" + d);
console.log("times", d * 2);
console.log("lt", d < 50);
console.log("eq", d == 42);
console.log("method", d.valueOf());
