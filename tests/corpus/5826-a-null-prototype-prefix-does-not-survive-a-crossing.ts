// os.userInfo()'s result is built with Object.create(null), so Node renders
// it `[Object: null prototype] { ... }` and the SHAPE says so
// (IrRecordShape.builtin.nullProto). A record shape is STRUCTURAL, and this
// program holds the counterexample the shape cannot answer: a value
// MATERIALISED out of a dynamic one shares the shape and does NOT share the
// prototype, because its source was a JSON object with an ordinary one.
//
// Node prints the crossed value as a plain object. Before this was gated,
// the compiler printed `[Object: null prototype]` over it -- a rendering
// invented from a static type, on a value that never had that prototype.
//
// The gate is the own-key mask's ARMING: a module that materialises this
// shape out of a dynamic value arms it, and an armed shape asks the
// INSTANCE rather than claiming the prefix for all of them.
//
// It used to RETRACT the claim for the whole armed shape instead, and this
// comment used to state that as a divergence -- os.userInfo()'s own result
// printed plain here where Node prefixes it. That is no longer true, and
// the reason to close it was not the rendering: the record->dyn walker took
// the same decision, ScrDyn.null_proto went unset with it, and
// deepStrictEqual gates on that field before it walks any entry, so
// `deepStrictEqual(os.userInfo(), { ...the same five members })` PASSED
// where Node throws. 5880 is that program; byte 0 of the own-key mask now
// carries the source object's own [[Prototype]]-is-null fact and both
// surfaces read it.
//
// 5821 is the third of the set: a module with no crossing keeps the prefix
// as a compile-time constant, and its deepStrictEqual prototype gate fires
// exactly as Node's does.
//
// Nothing machine-dependent reaches stdout: only the shape of the
// rendering, never a uid or a home directory.
import * as os from "node:os";
import * as util from "node:util";

const real = os.userInfo();
const crossed = JSON.parse(
  '{"uid":1,"gid":2,"username":"u","homedir":"h","shell":null}',
) as os.UserInfo;

// the crossed value, in full -- every member is a literal from the JSON above
console.log(util.inspect(crossed));
console.log(JSON.stringify(crossed));
console.log(JSON.stringify(Object.keys(crossed as unknown as Record<string, unknown>)));

// The runtime-built one is REFERENCED but its rendering is not compared
// HERE -- 5880 compares it, in a module shaped exactly like this one, and
// that is the divergence this file used to state and no longer has. What
// this file pins is its own direction: the compiler must not INVENT the
// prefix for the crossed value.
console.log(typeof real.username, typeof real.uid);
console.log(String(util.inspect(crossed).startsWith("[Object: null prototype]")));

// the crossing still answers its members, and the round trip still works
const u: unknown = crossed;
const back = u as os.UserInfo;
console.log(back.uid, back.gid, back.username, back.homedir, back.shell);
console.log(util.inspect(u));

// a plain literal of the same five members is unaffected either way
console.log(util.inspect({ uid: 1, gid: 2, username: "u", homedir: "h", shell: null }));
