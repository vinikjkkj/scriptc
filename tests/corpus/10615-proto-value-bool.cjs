// A boolean prototype datum with a typed own write over it.
class Flag {
  constructor(n) { this.n = n; }
  on() { this.flag = true; }
}
Flag.prototype.flag = false;
const f1 = new Flag(1);
const f2 = new Flag(2);
f2.on();
console.log(f1.flag, f2.flag, f1.flag ? 'yes' : 'no', f2.flag ? 'yes' : 'no');
