// A record member typed as an object union read into an `unknown` binding, then tested.
class Tag {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
const r: { tag?: Tag } = {};
const u: unknown = r.tag;
console.log(u === undefined, typeof u);
const r2: { tag?: Tag } = { tag: new Tag('x') };
const u2: unknown = r2.tag;
console.log(u2 === undefined, (u2 as Tag).name);
