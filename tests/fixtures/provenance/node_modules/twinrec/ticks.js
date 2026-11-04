'use strict';
// Promise chains over async methods of JavaScript classes, fire-and-forget, interleaved with awaits.
class Group {
  constructor() {
    this.n = 0;
  }
  async reset(slots, nodes) {
    this.n = slots.length + nodes.length;
  }
  async fail(label) {
    throw new Error('fail ' + label);
  }
  async value(x) {
    return x + 1;
  }
  async twice(x) {
    const a = await this.value(x);
    return this.value(a);
  }
}

class Holder {
  constructor() {
    this.group = new Group();
  }
  run(log) {
    this.group.reset([1], [2]).catch((e) => log('caught ' + e)).then(() => log('A reset done'));
    this.group.value(1).then((v) => log('B value ' + v));
    this.group.fail('x').catch((e) => log('C ' + e.message)).then(() => log('D after fail'));
    this.group.twice(1).then((v) => log('E twice ' + v));
  }
}
exports.Holder = Holder;
