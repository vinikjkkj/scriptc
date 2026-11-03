// Base-typed callers lowered before the factory evaluates still dispatch to each evaluation's override.
class Base {
  describe(): string { return "base"; }
  static kind(): string { return "BK"; }
}
function use(b: Base): string { return b.describe(); }
function tell(b: Base): string { return b.describe() + "/" + (b instanceof Base ? "y" : "n"); }
function derive(tag: string) {
  return class extends Base {
    describe(): string { return tag + super.describe(); }
  };
}
const D1 = derive("one:");
const D2 = derive("two:");
console.log(use(new Base()), use(new D1()), use(new D2()), tell(new D1()));
const arr: Base[] = [new D2(), new Base(), new D1()];
console.log(arr.map(use).join("|"));
