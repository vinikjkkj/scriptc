interface V { n: number; bump(): void }
class C {
  n = 1;
  bump(): void { this.n++; }
  toString(): string { return "C#" + String(this.n); }
}
function take(v: V): string { v.bump(); return String(v) + "|" + `${v}` + "|" + v.n; }
console.log(take(new C()));
const keep: V[] = [];
function stash(v: V): void { keep.push(v); }
const c = new C();
stash(c);
c.bump();
console.log(String(keep[0]), keep[0]!.n);
