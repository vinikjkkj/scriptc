// A toString METHOD combined with a valueOf FIELD: `+` asks valueOf first
// and reads the field's 42, while String(d) reads the method's "M".
class MF {
  toString(): string {
    return "M";
  }
  valueOf = () => 42;
}

const d: any = new MF();
console.log("String", String(d));
console.log("plus", d + "");
console.log("xplus", "x" + d);
console.log("method", d.toString());
