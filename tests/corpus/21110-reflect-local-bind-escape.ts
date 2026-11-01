// A bind stored in a local, typed by the bind's partially applied signature (not any), that
// escapes into a method call on an untyped receiver. The escape is found through the local's
// uses, so the bind is lowered as the runtime bind, and the callback reaches the target.
class Conn {
  _realEnd(cb: (e: any) => void): void {
    cb(null);
  }
}
let count = 0;
function run(): number {
  const endCB = function (err: any): void {
    if (err === null) count++;
  }.bind(null);
  const conn: any = new Conn();
  conn._realEnd(endCB);
  return count;
}
console.log(run());
