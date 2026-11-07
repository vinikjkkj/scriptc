// mysql2 shape: command classes store a method as the NEXT state and call it later, one subclass copies methods from another with
// `Sub.prototype.m = Base.prototype.m`; the program ALSO writes computed prototype members on an UNRELATED class.
class Command { constructor() { this.next = null; this.log = []; } }
class Query extends Command {
  start() { this.log.push("start"); return this.resultsetHeader; }
  resultsetHeader(packet) { this.log.push("header " + packet); return this.row; }
  row(packet) { this.log.push("row " + packet); return null; }
  _handleTimeoutError() { this.log.push("timeout"); }
}
class Execute extends Command {
  start() { this.log.push("estart"); return this.resultsetHeader; }
}
Execute.prototype.resultsetHeader = Query.prototype.resultsetHeader;
Execute.prototype.row = Query.prototype.row;
class PromisePool { constructor() { this.pool = { q: function () { return "q"; } }; } }
["q"].forEach(function (func) { PromisePool.prototype[func] = function () { return "pool " + func; }; });
const pp = new PromisePool();
const q = new Query();
q.next = q.start();
q.next(1);
const e = new Execute();
e.next = e.start();
e.next(2);
const t = q._handleTimeoutError;
t.call(q);
console.log(q.log.join(","), e.log.join(","), typeof q.next, pp.q());
