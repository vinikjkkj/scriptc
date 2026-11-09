// The only writer of the mirrored member is the constructor, and it runs after `this` was handed to code that projects it: the record
// must see the write.
interface M { n: number; label(): string; }
const projections: M[] = [];
function register(m: M): void { projections.push(m); }
class Late {
  n = 1;
  constructor() {
    register(this);
    this.n = 5;
  }
  label(): string { return "late" + this.n; }
}
const late = new Late();
console.log(projections[0]!.n, projections[0]!.label(), late.n);
