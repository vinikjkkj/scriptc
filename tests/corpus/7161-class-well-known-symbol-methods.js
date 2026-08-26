/* A class that declares [Symbol.dispose] / [Symbol.asyncDispose] compiles,
 * and the methods are never reached — this program writes no `using`, so
 * Node never calls them either and the two outputs agree. mysql2 hangs its
 * Connection, Pool, PoolConnection and PromiseConnection on exactly this:
 * before the reserved slot, the DECLARATION alone refused the whole file
 * with SC1090 "computed method names", and the two `extends` refusals
 * behind it were that fence poisoning the base module's binding.
 *
 * The explicit access `r[Symbol.dispose]` keeps the symbol-keyed-access
 * fence — the slot is declarable, not addressable. */
'use strict';

class Res {
  constructor(name) {
    this.name = name;
    this.closed = false;
  }

  [Symbol.dispose]() {
    this.closed = true;
    console.log('disposed', this.name);
  }

  async [Symbol.asyncDispose]() {
    this.closed = true;
  }

  open() {
    return 'open:' + this.name;
  }
}

class PooledRes extends Res {
  [Symbol.dispose]() {
    console.log('released', this.name);
  }

  open() {
    return 'pooled:' + this.name;
  }
}

const r = new Res('a');
console.log(r.open());
console.log(r.closed);

const p = new PooledRes('b');
console.log(p.open());
console.log(p.closed);
