// The mysql2 shape: a JS constructor stores an untyped options value and writes
// an expando onto a nested class instance through it (pool.js:45).
'use strict';
class Config {
  constructor(o) { this.host = o.host; this.port = 3306; }
  get desc() { return this.host + ":" + this.port; }
}
class Pool {
  constructor(options) {
    this.config = options.config;
    this.config.connectionConfig.pool = this;
    this.n = 1;
  }
  who() { return "pool" + this.n; }
}
const cfgObj = new Config({ host: "h" });
const carrier = { connectionConfig: cfgObj };
const p = new Pool({ config: carrier });
console.log(typeof cfgObj.connectionConfig, p.n);
console.log(p.config.connectionConfig === cfgObj, cfgObj.desc);
console.log(p.who(), p.config.connectionConfig.pool === p);
