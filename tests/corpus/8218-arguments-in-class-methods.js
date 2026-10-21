// A method that reads `arguments` while declaring parameters (mysql2's
// RingQueue.push: arguments.length tells push() from push(undefined)).
class Queue {
  constructor() {
    this._items = [];
  }

  push(item) {
    if (arguments.length === 0) {
      return this._items.length;
    }
    this._items.push(item);
    return this._items.length;
  }

  count() {
    return arguments.length + ':' + this._items.length;
  }

  sum(a, b) {
    let n = 0;
    for (let i = 0; i < arguments.length; i++) n += arguments[i];
    return n + ':' + a + ':' + b;
  }
}

class Sub extends Queue {
  push(item) {
    return super.push(item) + 100;
  }
}

const q = new Queue();
console.log(q.push(), q.push(undefined), q.push('x'), q.push(1, 2));
console.log(q.count(), q.count(1, 2, 3));
console.log(q.sum(1, 2), q.sum(1, 2, 3, 4), q.sum(5));
console.log(new Sub().push('y'));
