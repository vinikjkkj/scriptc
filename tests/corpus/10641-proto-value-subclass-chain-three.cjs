// Three levels of subclassing; the datum is on the root and the middle class declares no field of the name.
class Root {
  constructor() { this.r = 1; }
}
Root.prototype.kindOf = 'root';
class Mid extends Root {
  constructor() { super(); this.m = 2; }
}
class Leaf extends Mid {
  constructor() { super(); this.l = 3; }
  adopt() { this.kindOf = 'leaf'; }
}
const lf = new Leaf();
const md = new Mid();
console.log(lf.kindOf, md.kindOf);
lf.adopt();
const lf2 = new Leaf();
console.log(lf.kindOf, md.kindOf, lf2.kindOf);
