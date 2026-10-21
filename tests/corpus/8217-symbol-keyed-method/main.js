'use strict';

// ws's Limiter: a job queue whose private step is a symbol-keyed method and
// whose completion callback is a symbol-keyed function field.
const { kRun, kDone } = require('./keys');

class Limiter {
  /** @param {number} [concurrency] */
  constructor(concurrency) {
    this[kDone] = () => {
      this.pending--;
      this[kRun]();
    };
    this.concurrency = concurrency || Infinity;
    this.jobs = [];
    this.pending = 0;
  }

  add(job) {
    this.jobs.push(job);
    this[kRun]();
  }

  [kRun]() {
    if (this.pending === this.concurrency) return;

    if (this.jobs.length) {
      const job = this.jobs.shift();

      this.pending++;
      job(this[kDone]);
    }
  }
}

const order = [];
const limiter = new Limiter(2);
for (let i = 1; i <= 4; i++) {
  limiter.add((done) => {
    order.push('job' + i);
    done();
  });
}
console.log(order.join(','), limiter.pending, limiter.jobs.length);
