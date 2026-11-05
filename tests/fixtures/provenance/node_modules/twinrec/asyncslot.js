'use strict';
// ioredis' Commander shape: async methods on a class chain, and an installer that stores a function under a run-time name.
class Commander {
  constructor() {
    this.options = {};
    this.calls = [];
  }
  async ping(x) {
    this.calls.push('ping');
    return 'pong:' + x;
  }
  async total(a, b) {
    return a + b;
  }
  async nothing() {
    this.calls.push('nothing');
  }
  install(name, fn) {
    this[name] = fn;
  }
  run(name, ...args) {
    return this[name](...args);
  }
}
class Redis extends Commander {
  async get(k) {
    this.calls.push('get');
    return 'got:' + k;
  }
  async ping(x) {
    const base = await super.ping(x);
    return base + '!';
  }
}
const original = Commander.prototype.total;

async function scenario(log) {
  const r = new Redis();
  log([await r.ping('a'), await r.get('k'), await r.total(1, 2)].join(' '));
  r.install('get', async (k) => 'replaced:' + k);
  log([await r.get('k'), await r.run('get', 'z')].join(' '));
  r.install('total', (a, b) => a * b);
  log(String(await r.total(3, 4)));
  r.install('ping', () => new Promise((res) => setTimeout(() => res('late'), 3)));
  log(await r.ping('x'));
  r.install('nothing', async () => undefined);
  log(String(await r.nothing()));
  const other = new Redis();
  log([await other.get('k'), await other.ping('o')].join(' '));
  log(r.calls.join() + ' ' + other.calls.join());
  log(String(await original.call(other, 5, 6)));
  Commander.prototype.total = async function (a, b) {
    return 'proto:' + (a - b);
  };
  log([await new Commander().total(9, 4), await other.total(9, 4), await r.total(1, 1)].join(' '));
  const order = [];
  const p = new Redis().get('q').then(() => order.push('get'));
  await null;
  order.push('tick');
  await p;
  log(order.join());
}
exports.scenario = scenario;
