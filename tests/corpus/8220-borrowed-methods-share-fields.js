'use strict';

class Base {
  constructor() {
    this.log = [];
  }
}

class A extends Base {
  run(x) {
    if (x < 0) {
      this.failure = new Error('negative');
    }
    return this.check();
  }

  check() {
    if (this.failure) {
      this.log.push('failure');
      return 'failed: ' + this.failure.message;
    }
    this.log.push('ok');
    return 'ok';
  }
}

class B extends Base {
  constructor() {
    super();
    this.runs = 0;
  }

  extra() {
    this.runs++;
    return this.runs;
  }
}

B.prototype.run = A.prototype.run;
B.prototype.check = A.prototype.check;

const a = new A();
const b = new B();
console.log(a.run(1), b.run(1));
console.log(a.run(-1), b.run(-1));
console.log(b.extra(), b.extra());
console.log(a.log.join(','), b.log.join(','));
