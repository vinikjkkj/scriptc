// An own property exists from the write that creates it, so a field written only
// under a condition lists between the fields written before and after it
// (Object.keys, util.inspect). It listed after every unconditional field.
class R {
  constructor(m, tag) {
    this.tag = 't';
    if (m) { this.later = 1; }
    this.z = 2;
    if (tag) this.extra = 'e' + tag;
    this.last = true;
  }
}
const off = new R(false);
const on = new R(true, 'x');
console.log(off, on);
console.log(Object.keys(off), Object.keys(on));
console.log('later' in off, 'later' in on, 'extra' in on);

class Base {
  constructor(flag) {
    this.id = 1;
    if (flag) this.base = 'b';
    this.after = 2;
  }
}
class Derived extends Base {
  constructor(flag, other) {
    super(flag);
    this.own = 3;
    if (other) this.mid = 4;
    this.end = 5;
  }
}
console.log(new Derived(true, true), new Derived(false, false));
console.log(Object.keys(new Derived(true, false)), Object.keys(new Derived(false, true)));
