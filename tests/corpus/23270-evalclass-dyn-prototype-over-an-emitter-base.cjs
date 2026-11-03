// pg's real shape: the evaluated BoundPool extends a program class that extends EventEmitter; the prototype chain ends in EventEmitter.prototype.
const EventEmitter = require("events");
function anyv(x) { return x; }
class Pool extends EventEmitter { constructor(o) { super(); this.o = o; this._q = [1]; } get waitingCount() { return this._q.length; } run() { return "run" + this.o; } }
const poolFactory = (Client) => class BoundPool extends Pool { constructor(options) { super(options); this.Client = Client; } };
const PG = function (c) { this.Client = c; this.Pool = poolFactory(c); };
const pg = new PG(1);
const BP = pg.Pool;
const P = BP.prototype;
console.log(P.constructor === BP, Object.keys(P), typeof P.on, P.on === P.addListener, typeof P.run, P.run === anyv(Pool).prototype.run);
const p = new BP("o");
let got = 0; p.on("x", (v) => { got += v; }); p.emit("x", 3);
console.log(got, P.run.call(p), p instanceof BP, p instanceof Pool, p instanceof EventEmitter, P["isPrototypeOf"](p));
console.log(Object.keys(anyv(Pool).prototype), Object.getOwnPropertyNames(anyv(Pool).prototype));
