"use strict";
// pg Client: `password` is a collected field (a callback assigns it) AND the constructor defines it hidden with Object.defineProperty(this, ...). One property, one storage:
// the define is the field store, an async method and a callback read it back, and the value may be a string, null or absent.
function cont(session, password, data) {
  if (typeof password !== "string") throw new Error("client password must be a string");
  return session + ":" + password + ":" + data;
}
class Client {
  constructor(config) {
    this.user = config.user;
    this.saslSession = "s1";
    Object.defineProperty(this, "password", { configurable: true, enumerable: false, writable: true, value: config.password });
  }
  _getPassword(cb) {
    if (typeof this.password === "function") { cb(); }
    else if (this.password !== null) { cb(); }
    else {
      const pass = "from-pgpass";
      this.password = pass;
      cb();
    }
  }
  async _cont(msg) {
    try { return cont(this.saslSession, this.password, msg.data); } catch (err) { return "err:" + err.message; }
  }
}
(async () => {
  const c = new Client({ user: "u", password: "pw" });
  console.log(await c._cont({ data: "d" }), typeof c.password);
  const d = new Client({ user: "u", password: null });
  d._getPassword(() => {});
  console.log(await d._cont({ data: "d2" }));
  const e = new Client({ user: "u" });
  console.log(await e._cont({ data: "d3" }));
})();
