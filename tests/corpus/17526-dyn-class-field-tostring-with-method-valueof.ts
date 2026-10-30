// A toString FIELD combined with a valueOf METHOD: the field answers String()
// and the template span ("F"), the method answers `+` ("7"), and d * 1 is 7.
class FM {
  toString = () => "F";
  valueOf(): number {
    return 7;
  }
}

const d: any = new FM();
console.log("String", String(d));
console.log("template", `${d}`);
console.log("plus", d + "");
console.log("times", d * 1);
console.log("method", d.toString());
