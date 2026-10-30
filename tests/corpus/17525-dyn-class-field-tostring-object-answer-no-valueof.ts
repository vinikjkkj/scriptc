// A toString FIELD answering an object, with no valueOf anywhere, exhausts
// ToPrimitive: Object.prototype.valueOf answers the object itself, so both
// String(d) and d + "" throw TypeError "Cannot convert object to primitive
// value". Node prints that message for both.
class O {
  toString = () => ({});
}

const d: any = new O();
try {
  console.log("String", String(d));
} catch (e: any) {
  console.log("String threw", e.constructor.name, e.message);
}
try {
  console.log("plus", d + "");
} catch (e: any) {
  console.log("plus threw", e.constructor.name, e.message);
}
