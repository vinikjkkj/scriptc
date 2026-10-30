// A toString ACCESSOR whose getter returns a function. ToPrimitive reads
// toString through Get, which runs the getter, and then calls the function it
// returned. Node: String(d) is "G", d + "" is "G", and d.toString() is "G".
class G {
  get toString() {
    return () => "G";
  }
}

const d: any = new G();
console.log("String", String(d));
console.log("plus", d + "");
console.log("method", d.toString());
