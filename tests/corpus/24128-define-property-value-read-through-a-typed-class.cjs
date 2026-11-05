"use strict";
// Object.defineProperty(this, "password", { value }) hides a value from enumeration; it is read back through a typed receiver that is not a plain name (pg: this.connectionParameters.password).
const defaults = { user: "d", password: null };
const val = function (key, config) { if (config[key]) return config[key]; return defaults[key]; };
class Params {
  constructor(config) {
    config = typeof config === "string" ? {} : config || {};
    this.user = val("user", config);
    Object.defineProperty(this, "password", { configurable: true, enumerable: false, writable: true, value: val("password", config) });
    this.binary = val("binary", config);
  }
}
class Client {
  constructor(config) {
    this.connectionParameters = new Params(config);
    Object.defineProperty(this, "password", { configurable: true, enumerable: false, writable: true, value: this.connectionParameters.password });
  }
  check() {
    if (typeof this.password === "function") return "fn";
    else if (this.password !== null) return "str:" + typeof this.password + ":" + this.password;
    return "null";
  }
}
const c = new Client({ user: "u", password: "p" });
console.log(c.check(), c.connectionParameters.password, typeof c.password);
const d = new Client({});
console.log(d.check());

class P2 {
  constructor(pw) {
    this.user = "u";
    Object.defineProperty(this, "password", { configurable: true, enumerable: false, writable: true, value: pw });
  }
  show() { return typeof this.password + ":" + this.password; }
}
const p2 = new P2("secret");
console.log(p2.show(), p2.password);
p2.password = "changed";
console.log(p2.password, p2.show());
class Q {
  constructor(params) {
    this.params = params;
    Object.defineProperty(this, "password", { configurable: true, enumerable: false, writable: true, value: this.params.password });
  }
  read() { return this.password; }
}
const q = new Q(p2);
console.log(q.read(), typeof q.read(), q.password);
