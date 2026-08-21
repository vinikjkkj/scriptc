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
// shape out of a dynamic value arms it, and an armed shape stops claiming
// the prefix for every instance of it, because nothing on the shape tells
// the two kinds apart. That is why the FIRST line below is the plain form
// too -- it is a real os.userInfo() result and Node does prefix it. The
// divergence is stated rather than hidden: this file exists to pin that the
// compiler stops INVENTING one, not that it gets both right.
//
// 5821 is the other half: a module with no crossing keeps the prefix, and
// its deepStrictEqual prototype gate fires exactly as Node's does.
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

// The runtime-built one is REFERENCED but its rendering is NOT compared,
// and that is the divergence stated rather than hidden: because this module
// also crosses into the shape, the shape is armed and stops claiming the
// prefix for every instance, so `util.inspect(real)` prints the plain form
// where Node prints `[Object: null prototype] { ... }`. That line is base's
// answer too, it is wrong on both sides, and 5821 is the module where the
// prefix survives because nothing crosses. What this file pins is the other
// direction: the compiler must not INVENT the prefix for the crossed value.
console.log(typeof real.username, typeof real.uid);
console.log(String(util.inspect(crossed).startsWith("[Object: null prototype]")));

// the crossing still answers its members, and the round trip still works
const u: unknown = crossed;
const back = u as os.UserInfo;
console.log(back.uid, back.gid, back.username, back.homedir, back.shell);
console.log(util.inspect(u));

// a plain literal of the same five members is unaffected either way
console.log(util.inspect({ uid: 1, gid: 2, username: "u", homedir: "h", shell: null }));
