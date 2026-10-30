// Own FIELDS that hold a non-callable value shadow the prototype methods of
// the same name, and ToPrimitive skips them (Node's OrdinaryToPrimitive calls
// only a callable Get result). A toString field holding 5 and a valueOf field
// holding "x" leave the chain with no primitive answer: String(d) and d + ""
// both throw TypeError "Cannot convert object to primitive value". format's
// %s sees a toString that is not a function and inspects the instance.
import { format } from "node:util";

class N {
  toString = 5;
  valueOf = "x";
}

const d: any = new N();
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
console.log("format", format("%s", d));
