// A method declared by a subclass and overridden by a class below it: the read answers the function of the receiver's
// deepest declaring class, and the shallower declarer's function stays reachable through its own prototype.
class Machine {
  constructor(name) {
    this.name = name;
    this.next = null;
    this.out = [];
  }
  go(arg) {
    this.next = this.begin;
    while (this.next) {
      this.next = this.next(arg);
    }
    return this.out.join(',');
  }
}
class Mid extends Machine {
  begin(arg) {
    this.out.push('mid:' + this.name + ':' + arg);
    return this.finish;
  }
  finish(arg) {
    this.out.push('midfinish');
    return null;
  }
}
class Deep extends Mid {
  begin(arg) {
    this.out.push('deep:' + this.name + ':' + arg);
    return this.finish;
  }
}
class Deeper extends Deep {
  finish(arg) {
    this.out.push('deeperfinish');
    return null;
  }
}
class Other extends Machine {
  begin(arg) {
    this.out.push('other');
    return null;
  }
}
console.log(new Mid('m').go(1));
console.log(new Deep('d').go(2));
console.log(new Deeper('e').go(3));
console.log(new Other('o').go(4));
const d = new Deep('x');
d.go(0);
console.log(Mid.prototype.begin === Deep.prototype.begin, Deep.prototype.finish === Mid.prototype.finish, Deeper.prototype.finish === Deep.prototype.finish);
console.log(Mid.prototype.begin.call(d, 'viaMid'), d.out.join(','));
