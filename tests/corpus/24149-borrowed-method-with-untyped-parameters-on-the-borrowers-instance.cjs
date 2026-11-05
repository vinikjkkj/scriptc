// The borrowed function of 24148 with untyped parameters that are read through members (mysql2's
// Query.row(packet, connection)): the shared function value still runs against the borrower's instance.
class Command {
  constructor() { this.next = null; this.log = []; }
  execute(packet, connection) {
    this.next = this.next(packet, connection);
    return !!this.next;
  }
}
class Query extends Command {
  constructor() { super(); this.next = Query.prototype.start; }
  start(packet, connection) { this.log.push("start" + connection.id); return Query.prototype.row; }
  row(packet, connection) {
    if (packet.isEOF()) return this.done();
    this.log.push("row" + packet.n + connection.id);
    return Query.prototype.row;
  }
  done() { this.log.push("done"); return null; }
}
class Execute extends Command {
  constructor() { super(); this.next = Execute.prototype.start; }
  start(packet, connection) { this.log.push("estart" + connection.id); return Execute.prototype.row; }
}
Execute.prototype.row = Query.prototype.row;
Execute.prototype.done = Query.prototype.done;
const conn = { id: "#" };
const pk = (n) => ({ n, isEOF() { return n === 0; } });
function run(e) {
  e.execute(pk(1), conn); e.execute(pk(2), conn); e.execute(pk(3), conn); e.execute(pk(0), conn);
  console.log(e.constructor.name, e.log.join(","), e.next);
}
run(new Query());
run(new Execute());
