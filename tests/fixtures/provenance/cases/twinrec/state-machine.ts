// mysql2's Command state machine: every state is a method that answers the NEXT state, itself a method of its own
// class (`return Query.prototype.readField`), read as a value and called by the base class's execute. Nothing here
// is typed by the twin's author: the methods are untyped JavaScript, and the Execute subclass overrides two states.
import { Query, Execute, Handshake } from "twinrec/machine";
import type { Command, Connection } from "twinrec/machine";
const conn: Connection = {
  protocolError(message: string): null {
    console.log("protocolError", message);
    return null;
  },
};
function drive(cmd: Command, packets: string[]): string {
  const done: string[] = [];
  for (const p of packets) done.push(String(cmd.execute(p, conn)));
  return done.join(",") + " | " + cmd.log.join(",");
}
console.log(drive(new Query(2), ["start", "h", "a", "b", "eof", "r1", "r2", "end"]));
console.log(drive(new Execute(3), ["start", "h", "a", "b", "c", "eof", "r1", "end"]));
console.log(drive(new Query(2), ["start", "h", "a", "b", "nope"]));
console.log(drive(new Query(2), ["start", "err"]));
console.log(drive(new Handshake(), ["start", "ping", "query", "quit"]));
