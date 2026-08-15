// os.userInfo()'s uid/gid are NOT process.getuid()/getgid(), and this
// program is here so nobody merges them back.
//
// On Windows Node's process object simply has no getuid/getgid members,
// so CALLING them is a TypeError — and os.userInfo() answers -1 for both
// and returns a complete record. Those two facts lived in one runtime
// entry point, so every os.userInfo() call on this host threw instead of
// answering, including one that only wanted `username`. Off Windows the
// pair answers getuid(2)/getgid(2) and this program prints the same
// shapes with different numbers.
//
// The shell field is the same story in the other direction: Node's
// Windows answer is `null`, not `""`, and which arm that is depends on
// the HOST rather than on the build, so it is a runtime branch.
import * as os from "node:os";

const u = os.userInfo();

// Reading ANY field must work: the record assembles every field, so a
// throwing one takes the whole call down.
console.log(u.username.length > 0);
console.log(typeof u.uid, typeof u.gid, typeof u.username, typeof u.homedir);
console.log(u.uid === u.gid, Number.isInteger(u.uid), Number.isInteger(u.gid));
console.log(u.shell === null ? "shell-null" : `shell:${u.shell}`);
console.log(Object.keys(u).join(","));

// Two calls agree — the record is a snapshot, not a cursor.
console.log(os.userInfo().uid === u.uid, os.userInfo().gid === u.gid);

// And the process pair is still absent, still catchable, still by that
// exact message — the call spelled through `process` itself, so Node's
// own message names the same receiver the runtime's does. On POSIX both
// answer a number, so this prints the TYPE rather than the value: one
// fixture, honest on both platforms (2882's rule).
try {
  const uid = process.getuid();
  console.log("uid:", typeof uid);
} catch (e) {
  console.log("uid:", e.name, e.message);
}
try {
  const gid = process.getgid();
  console.log("gid:", typeof gid);
} catch (e) {
  console.log("gid:", e.name, e.message);
}
