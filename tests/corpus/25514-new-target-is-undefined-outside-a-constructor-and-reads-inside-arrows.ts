// A plain call has no new.target; an arrow inside a constructor shares the constructor's; an arrow stored and called later still sees it.
function plain(): string { return String(new.target) + "/" + typeof new.target; }
console.log(plain());
class K {
  out: string;
  later: () => string;
  constructor() {
    const f = () => new.target.name;
    this.later = () => "later:" + new.target.name;
    this.out = f();
  }
}
class K2 extends K {}
const a = new K();
const b = new K2();
console.log(a.out, b.out, a.later(), b.later());
