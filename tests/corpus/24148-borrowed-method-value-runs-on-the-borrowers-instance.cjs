// `Execute.prototype.row = Query.prototype.row` shares ONE function: a state machine that returns
// `Query.prototype.row` and is then called on an Execute instance (mysql2's text and binary
// protocol commands) runs the body against that instance.
class Command {
  constructor() { this.next = null; this.log = []; }
  execute(p) {
    this.next = this.next(p);
    return !!this.next;
  }
}
class Query extends Command {
  constructor() { super(); this.next = Query.prototype.start; }
  start(p) { this.log.push("start"); return Query.prototype.row; }
  row(p) { if (p === 0) return this.done(); this.log.push("row" + p); return Query.prototype.row; }
  done() { this.log.push("done"); return null; }
}
class Execute extends Command {
  constructor() { super(); this.next = Execute.prototype.start; }
  start(p) { this.log.push("estart"); return Execute.prototype.row; }
}
Execute.prototype.row = Query.prototype.row;
Execute.prototype.done = Query.prototype.done;
function run(e) {
  e.execute(1); e.execute(2); e.execute(3); e.execute(0);
  console.log(e.constructor.name, e.log.join(","), e.next);
}
run(new Query());
run(new Execute());
