// The dyn read of an array field of a class instance aliases the native
// array: a write through the dyn handle is visible to every other reader.
class Cfg {
  flags: string[];
  constructor() {
    this.flags = ["a"];
  }
}
function pass(x: any): any {
  return x;
}
const r = pass(new Cfg());
r.flags.push("b");
console.log(r.flags.length, r.flags.join(","));
const obj = pass({ flags: ["a"] });
obj.flags.push("b");
console.log(obj.flags.length, obj.flags.join(","));
