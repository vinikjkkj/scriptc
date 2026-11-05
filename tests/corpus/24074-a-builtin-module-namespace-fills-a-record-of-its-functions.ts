// A builtin module namespace handed to a slot typed as a record of that module's functions (the adapter shape a package declares:
// Pick<typeof os, ...>): the fields ARE the members' own values, so identity with os.x holds, and a literal of the same shape fills the slot too.
import * as os from "os";
type OsAdapter = Pick<typeof os, "release" | "platform" | "arch" | "type">;
function pick(o?: OsAdapter): OsAdapter {
  return o ?? os;
}
const a = pick();
console.log(typeof a.release(), a.release === os.release, a.arch() === os.arch(), a.type() === os.type(), a.platform() === os.platform());
const b = pick({ release: () => "R", platform: () => "P", arch: () => "A", type: () => "T" });
console.log(b.release(), b.platform(), b.arch(), b.type(), b.release === os.release);
const c: OsAdapter = os;
console.log(c.release === a.release, c.type === os.type);
