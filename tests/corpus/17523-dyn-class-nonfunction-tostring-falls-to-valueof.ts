// A toString FIELD holding a string is not callable, so ToPrimitive skips it
// and asks valueOf next. Here valueOf is a method answering 42, so String(d)
// is "42", not "[object Object]", and d + "" is "42". Node: String(d) is "42",
// d + "" is "42", and `${d}` is "42". The field is skipped because it is not
// callable; it does not end the chain.
class S {
  toString = "str";
  valueOf(): number {
    return 42;
  }
}

const d: any = new S();
console.log("String", String(d));
console.log("plus", d + "");
console.log("template", `${d}`);
