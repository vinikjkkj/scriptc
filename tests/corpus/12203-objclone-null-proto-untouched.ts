// The null-prototype dictionary (Object.create(null)) keeps its own lowering
// next to the class-instance clone idiom, which must not intercept it.
class Memo {
  table: Record<string, number>;
  constructor() {
    this.table = Object.create(null);
  }
}
const dict = Object.create(null);
dict["a"] = 1;
dict["b"] = 2;
const m = new Memo();
m.table["x"] = 9;
console.log(Object.keys(dict).join(","), dict["a"] + dict["b"], Object.keys(m.table).join(","), m.table["x"]);
console.log(m instanceof Memo, "a" in dict, Object.keys(Object.create(null)).length);
