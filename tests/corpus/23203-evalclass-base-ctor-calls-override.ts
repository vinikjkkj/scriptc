// The base constructor runs an override that reads a captured binding: the
// evaluation must be installed before super() runs (a ctor-less derived class).
class Base {
  label: string;
  n: number;
  constructor(n: number) {
    this.n = n;
    this.label = this.makeLabel();
  }
  makeLabel(): string {
    return "base" + this.n;
  }
}
function derive(prefix: string, suffix: string) {
  return class extends Base {
    makeLabel(): string {
      return prefix + this.n + suffix;
    }
    get twice(): number {
      return this.n * 2;
    }
    later(): () => string {
      return () => prefix + "|" + this.label;
    }
  };
}
const D1 = derive("<", ">");
const D2 = derive("[", "]");
const x = new D1(5);
const y = new D2(7);
console.log(x.label, y.label, x.twice, y.twice);
console.log(x.later()(), y.later()());
console.log(D1.name === "", D2.name === "");
const arr = [x, y, new Base(1)];
console.log(arr.map((v) => v instanceof D1).join(","), arr.map((v) => v instanceof D2).join(","), arr.map((v) => v instanceof Base).join(","));
console.log(x);
console.log(D1);
