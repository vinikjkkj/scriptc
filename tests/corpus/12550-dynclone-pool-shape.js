// Repro of the mysql2 pool shape: the config is stored from an untyped
// parameter, so the clone source is dyn. A runtime-keyed property is defined
// on the instance (the class's own property table), then the pool is written
// onto it through the untyped path.
class ConnConfig {
  constructor(host, port) {
    this.host = host;
    this.port = port;
    this.flags = ["a"];
  }
  url() {
    return this.host + ":" + this.port;
  }
  addFlag(f) {
    this.flags.push(f);
    return this.flags.length;
  }
  attach(name, value) {
    Object.defineProperty(this, name, { value: value, enumerable: true, writable: true, configurable: true });
  }
}

class Pool {
  constructor(options) {
    this.config = options.config;
    this.config.connectionConfig.pool = this;
  }
  copyConfig() {
    const { connectionConfig } = this.config;
    return Object.create(Object.getPrototypeOf(connectionConfig), Object.getOwnPropertyDescriptors(connectionConfig));
  }
}

function holder(x) {
  return x;
}
const cc = new ConnConfig("db", 3306);
cc.attach("tag", "t1");
const pool = new Pool({ config: { connectionConfig: cc } });
const copy = pool.copyConfig();
console.log(copy instanceof ConnConfig);
console.log(copy.url(), copy.host, copy.port);
copy.port = 4000;
console.log(cc.port, copy.port);
console.log(copy.addFlag("b"), cc.flags.join(","), copy.flags.length);
const h = holder(copy);
const hc = holder(cc);
console.log(h.tag, hc.tag, h.pool === pool, hc.pool === pool);
h.tag = "t2";
console.log(h.tag, hc.tag);
console.log(copy.constructor === ConnConfig);
