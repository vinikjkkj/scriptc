// mysql2 execute shape: a command class declares `start(packet, connection)` (implicit-any parameters), a callback replaces it on ONE
// instance (`executeCommand.start = function () { return null }`), and the class copies methods from a sibling with
// `Execute.prototype.m = Query.prototype.m`. The own function answers on that instance only; the copies stay late methods.
class Command {
  constructor() { this.next = null; this.log = []; }
}
class Query extends Command {
  start(packet, connection) { this.log.push("qstart " + packet.id + connection.name); return this.done; }
  done() { this.log.push("done"); return null; }
  resultsetHeader(packet) { this.log.push("header " + packet.id); return this.done; }
}
class Execute extends Command {
  constructor(opts) { super(); this.opts = opts; this.next = this.start; }
  start(packet, connection) { this.log.push("estart " + packet.id + connection.name); return this.done; }
}
Execute.prototype.done = Query.prototype.done;
Execute.prototype.resultsetHeader = Query.prototype.resultsetHeader;
function run(failing) {
  const executeCommand = new Execute("o");
  if (failing) {
    executeCommand.start = function () {
      return null;
    };
  }
  const first = executeCommand.start({ id: failing ? "f" : "ok" }, { name: "c" });
  executeCommand.resultsetHeader({ id: "h" });
  return [executeCommand.log.join(","), typeof first];
}
console.log(run(false), run(true));
