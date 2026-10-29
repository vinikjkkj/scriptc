// A class-instance optional member cast to unknown: the absent branch and the
// present branch both answer exactly.
class Tag {
  name: string;
  constructor(name: string) {
    this.name = name;
  }
}
const a: { tag?: Tag; id: number } = { id: 1 };
const av = (a as { tag?: unknown; id: number }).tag;
console.log(av === undefined, a.id);
const b: { tag?: Tag; id: number } = { id: 2, tag: new Tag('t') };
const bv = (b as { tag?: unknown }).tag;
console.log(bv === undefined, (bv as Tag).name);
