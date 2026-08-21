// A null [[Prototype]] is a fact about the INSTANCE, and a record shape is
// STRUCTURAL, so the two kinds of instance of one shape must answer
// differently: os.userInfo() builds its result with Object.create(null) and
// Node prefixes it `[Object: null prototype]`, while `JSON.parse(s) as
// os.UserInfo` shares the shape and carries an ordinary prototype.
//
// 5826 pins the half that was invented -- the compiler must not claim the
// prefix for the CROSSED value -- and states as a divergence that a module
// with a crossing then printed the runtime-built one plain too, because the
// claim was retracted for the whole armed shape. This file is the other
// half, and it is the half that was SILENT: the record->dyn walker took the
// same decision, so ScrDyn.null_proto went unset, and deepStrictEqual gates
// on that field before it walks any entry. `deepStrictEqual(os.userInfo(),
// { ...the same five members })` therefore PASSED, where Node throws.
//
// A silent pass on an assertion that must fail is the one trade this
// project does not make, so the question is now asked of the instance: the
// own-key mask's byte 0 carries the source object's own [[Prototype]]-is-
// null fact (OWNMASK_SRC_NULL_PROTO), and both surfaces -- the record->dyn
// walker and util.inspect's static renderer -- read it.
//
// Nothing machine-dependent reaches stdout: only booleans and the shape of
// a rendering, never a uid or a home directory.
import * as assert from "node:assert";
import * as os from "node:os";
import * as util from "node:util";

function dse(tag: string, x: unknown, y: unknown): void {
  try {
    assert.deepStrictEqual(x, y);
    console.log(tag + " EQUAL");
  } catch {
    console.log(tag + " NOT-EQUAL");
  }
}

// The CROSSING. Its presence is what arms the shape, and everything below
// is about a module that contains one.
const crossed = JSON.parse(
  '{"uid":1,"gid":2,"username":"u","homedir":"h","shell":null}',
) as os.UserInfo;

const real = os.userInfo();
const plainOfReal = {
  uid: real.uid,
  gid: real.gid,
  username: real.username,
  homedir: real.homedir,
  shell: real.shell,
};

// the runtime-built value really IS Object.create(null)'s
dse("real-vs-plain", real, plainOfReal);
console.log("real-prefixed " + String(util.inspect(real).startsWith("[Object: null prototype]")));

// ...and the materialised one really is NOT
const plainOfCrossed = { uid: 1, gid: 2, username: "u", homedir: "h", shell: null };
dse("crossed-vs-plain", crossed, plainOfCrossed);
console.log("crossed-prefixed " + String(util.inspect(crossed).startsWith("[Object: null prototype]")));

// the two are not each other either
dse("real-vs-crossed", real, crossed);

// the crossed value still answers its members and still round-trips
console.log(crossed.uid, crossed.gid, crossed.username, crossed.homedir, crossed.shell);
console.log(JSON.stringify(crossed));
console.log(JSON.stringify(Object.keys(crossed as unknown as Record<string, unknown>)));
const back = (crossed as unknown) as os.UserInfo;
console.log(back.username, typeof back.uid);
