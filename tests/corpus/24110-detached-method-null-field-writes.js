"use strict";
// Methods run DETACHED (a method value called with another receiver, or none): `this.f = null` / `= undefined` writes inside them.
// The right side is a unit value with no storage of its own; pg's Client#_handleAuthSASLFinal / _handleReadyForQuery do exactly this.
const trace = [];
function note(x) { trace.push(x); return x; }
class Client {
  constructor() { this.saslSession = null; this._activeQuery = null; this._connected = false; this.cb = null; this.log = []; this.opt = undefined; this.pending = null; this.gone = undefined; this.queryTimeout = null; }
  begin() { this.saslSession = { s: 1 }; this._activeQuery = { q: 1 }; this.cb = () => 1; this.opt = 5; this.queryTimeout = setTimeout(() => {}, 1000); }
  final(msg) {
    try { this.log.push("final:" + msg); this.saslSession = null; } catch (err) { this.log.push("err"); }
  }
  // mysql2 Execute#start: a failed write clears the timer field in a catch branch of a method that runs detached
  start(packet) {
    try {
      if (packet === "boom") throw new Error("write failed");
    } catch (error) {
      if (this.queryTimeout) {
        clearTimeout(this.queryTimeout);
        this.queryTimeout = null;
      }
      this.log.push("start:" + error.message);
      return null;
    }
    return "started";
  }
  ready(msg) {
    this._activeQuery = null;
    this._connected = true;
    if (this.cb) { this.cb(); this.cb = null; }
    this.opt = undefined;
    this.pending = null;
    this.gone = undefined;
    this.log.push("ready:" + msg);
  }
}
const c = new Client();
c.begin();
const table = { final: c.final, ready: c.ready, start: c.start };
table.final.call(c, "m1");
table.ready.call(c, "m2");
console.log(table.start.call(c, "ok"), table.start.call(c, "boom"), c.queryTimeout === null);
console.log(c.log.join(","), c.saslSession, c._activeQuery, c._connected, c.cb, c.opt, c.pending, c.gone);
const d = new Client();
d.begin();
console.log(trace.length, d.opt, d.saslSession);
for (const recv of [undefined, null]) {
  try { table.ready.call(recv, "m3"); console.log("no throw"); } catch (e) { console.log(e.name, e.message); }
}
console.log(trace.join(","));
