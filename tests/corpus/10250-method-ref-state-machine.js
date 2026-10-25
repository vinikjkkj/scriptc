// A command state machine in mysql2's shape: each handler returns the NEXT
// handler as an unbound method reference (`return this.readRow;`), and a
// driver stores it back into a field and invokes it with a plain method-style
// call (`this.next = this.next(packet, conn);`). Nothing is bound. The read
// `this.readRow` takes the function of the receiver's RUNTIME class, so an
// Upper instance hands back Upper's handler; a function value, once read, runs
// the body it names whatever receiver `.call` is given.

class Command {
  constructor() {
    this.next = null;
    this.rows = 0;
  }

  start(packet, conn) {
    conn.log.push("start:" + packet);
    return this.readRow;
  }

  readRow(packet, conn) {
    this.rows++;
    conn.log.push("row:" + packet);
    return packet === "end" ? null : this.readRow;
  }

  execute(packet, conn) {
    if (!this.next) {
      this.next = this.start;
    }
    this.next = this.next(packet, conn);
    return this.next !== null;
  }
}

class Upper extends Command {
  readRow(packet, conn) {
    this.rows++;
    conn.log.push("upper:" + packet);
    return packet === "end" ? null : this.readRow;
  }
}

function drive(cmd, packets, conn) {
  let steps = 0;
  for (const p of packets) {
    steps++;
    if (!cmd.execute(p, conn)) break;
  }
  return steps;
}

const conn = { log: [] };
const plain = new Command();
const upper = new Upper();

console.log("plain steps", drive(plain, ["a", "b", "end", "z"], conn));
console.log("upper steps", drive(upper, ["x", "y", "end"], conn));
console.log(conn.log.join(","));
console.log("rows", plain.rows, upper.rows);

// A later run restarts from `start`, because the driver saw next === null.
const conn3 = { log: [] };
console.log("again", drive(plain, ["q", "end"], conn3), conn3.log.join(","));

// `.call` does not re-dispatch: the value read from Command.prototype runs
// Command's body with `this` = upper, and that body's own `this.readRow` read
// is where Upper's override is reached.
const h = plain.readRow;
const log2 = [];
const conn2 = { log: log2 };
console.log("call-plain", h.call(plain, "p1", conn2) === plain.readRow, h.call(upper, "p2", conn2) === upper.readRow);
console.log(log2.join(","), plain.rows, upper.rows);
