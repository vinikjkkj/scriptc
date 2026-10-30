// The class instance's `+` asks ToPrimitive with the DEFAULT hint, which
// runs valueOf before toString; String(), a template span and `==` against
// a string take the other order. Held in `any`, each spelling reaches the
// user method through the box's member table. Node: "" + d is "42",
// String(d) is "T", `${d}` is "T", "x" + d is "x42", d == 42 is true,
// d == "T" is false, and d * 1 is 42.
class Both {
  toString(): string {
    return "T";
  }
  valueOf(): number {
    return 42;
  }
}

const d: any = new Both();
console.log("plus", d + "");
console.log("string", String(d));
console.log("template", `${d}`);
console.log("xplus", "x" + d);
console.log("eq42", d == 42);
console.log("eqT", d == "T");
console.log("times", d * 1);
console.log("method", d.toString());
