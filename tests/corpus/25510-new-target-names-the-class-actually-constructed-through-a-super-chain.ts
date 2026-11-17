// new.target is the constructor the program invoked: the base constructor sees the most-derived class, before and after super() and from an arrow inside it.
class Base {
  kind: string;
  early: string;
  constructor() {
    this.kind = new.target.name;
    this.early = (() => new.target.name)();
  }
}
class Mid extends Base {
  tag: string;
  constructor() {
    const before = new.target.name;
    super();
    this.tag = before + ":" + new.target.name;
  }
}
class Leaf extends Mid {}
class Other extends Base {}
const all: Base[] = [new Base(), new Mid(), new Leaf(), new Other()];
for (const o of all) console.log(o.kind, o.early, o instanceof Mid ? o.tag : "-");
