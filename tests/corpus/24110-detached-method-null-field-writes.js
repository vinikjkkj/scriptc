"use strict";
// Methods run DETACHED (a method value called with another receiver, or none): `this.f = null` / `= undefined` writes inside them.
// The right side is a unit value with no storage of its own; pg's Client#_handleAuthSASLFinal / _handleReadyForQuery do exactly this.
const trace = [];
function note(x) { trace.push(x); return x; }
class Client {
  constructor() { this.saslSession = null; this._activeQuery = null; this._connected = false; this.cb = null; this.log = []; this.opt = undefined; this.pending = null; this.gone = undefined; }
  begin() { this.saslSession = { s: 1 }; this._activeQuery = { q: 1 }; this.cb = () => 1; this.opt = 5; }
  final(msg) {
    try { this.log.push("final:" + msg); this.saslSession = null; } catch (err) { this.log.push("err"); }
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
const table = { final: c.final, ready: c.ready };
table.final.call(c, "m1");
table.ready.call(c, "m2");
console.log(c.log.join(","), c.saslSession, c._activeQuery, c._connected, c.cb, c.opt, c.pending, c.gone);
const d = new Client();
d.begin();
console.log(trace.length, d.opt, d.saslSession);
for (const recv of [undefined, null]) {
  try { table.ready.call(recv, "m3"); console.log("no throw"); } catch (e) { console.log(e.name, e.message); }
}
console.log(trace.join(","));
