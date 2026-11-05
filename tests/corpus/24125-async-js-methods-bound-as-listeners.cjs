"use strict";
// An async method of a JavaScript class read as a value (`this._m.bind(this)`, pg: con.on("authenticationSASLContinue", this._handleAuthSASLContinue.bind(this))): it is the method, never undefined.
const EventEmitter = require("events");
class Client extends EventEmitter {
  constructor() { super(); this.log = []; }
  attach(con) {
    con.on("plain", this._plain.bind(this));
    con.on("later", this._later.bind(this));
    con.on("later2", this._later2.bind(this));
  }
  _plain(msg) { this.log.push("plain:" + msg); }
  async _later(msg) { await null; this.log.push("later:" + msg); }
  async _later2(msg) { this.log.push("later2:" + msg); }
}
const c = new Client();
const con = new EventEmitter();
c.attach(con);
con.emit("plain", 1);
con.emit("later", 2);
con.emit("later2", 3);
setTimeout(() => console.log(c.log.join(",")), 5);
