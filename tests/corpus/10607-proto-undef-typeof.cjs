// typeof and equality against undefined answer the prototype's undefined and the own value alike.
class Opt {
  constructor(k) { this.k = k; }
  set() { this.val = 12; }
}
Opt.prototype.val = undefined;
const o = new Opt('a');
console.log(typeof o.val, o.val === undefined, o.val !== undefined);
o.set();
console.log(typeof o.val, o.val === undefined, o.val + 1);
