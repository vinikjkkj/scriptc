// A state machine in mysql2's shape, compiled as an npm-static package
// (`--npm-static mrefsm`). The package's handlers are untyped JavaScript, so
// they are implicit-any MONOMORPHIZED members, and `return this.readRow` is a
// method read of a generic member. On base every such read is refused with
// SC1090 ("bound method references (call 'readRow' directly) are not
// supported yet"), which is the class mysql2's command state machine trips.
import { run, identity, detached, viaCall, beforeThis } from "mrefsm";

const conn = { log: [] as string[] };
console.log("plain", run("plain", ["a", "b", "end", "z"], conn));
console.log("upper", run("upper", ["x", "y", "end"], conn));
console.log("identity", identity());
console.log("detached", detached(conn));
console.log("viaCall", viaCall(conn));
console.log("beforeThis", beforeThis());
