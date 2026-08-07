// npm-static pilot: an UNTYPED CJS package whose API is attached as
// members of a module-level function — the pre-ES6 namespace-object
// idiom.
//
// A function member is a module global keyed by (function symbol × member
// key). Both spellings of the receiver reach that one storage: the local
// NAME inside the declaring file (`parse.VERSION` read from inside
// `parse.describe`), and the CJS export table's member from here
// (`fnmembers.parse.VERSION`) — the export table is alias plumbing, so
// both name the same function object. Untyped members take the same
// checked-dynamic per-piece fallback the JS file-scope bindings take, so
// their calls stay direct and this whole program is static.
import fnmembers from "fnmembers";

console.log(fnmembers.parse("a,b").join("+"));
console.log(fnmembers.parse.VERSION);
console.log(fnmembers.parse.limit);
console.log(fnmembers.parse.describe());
console.log(fnmembers.parse.strict("x,y").join("+"));
