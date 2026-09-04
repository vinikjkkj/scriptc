// A two-module ESM cycle whose members each install a method at top
// level through Object.defineProperty. mongodb's change_stream.ts:1110
// and mongo_client.ts:1040, reduced:
//
//     configureResourceManagement(ChangeStream.prototype);
//
// whose body is
//
//     Symbol.asyncDispose && Object.defineProperty(target,
//       Symbol.asyncDispose, { value: async function () {…}, … })
//
// Two facts are needed and neither was carried. The first is that a call
// whose callee body is inert is itself inert. The second is that
// Object.defineProperty does not INVOKE its descriptor's `value` -- the
// guard that refused any function-shaped argument to a builtin is there
// because most builtins that take one call it, and this one stores it.
//
// The installed method is then CALLED from run(), after both modules
// initialized, so the program also proves the descriptor survived as a
// working method rather than as a name in a table.
import { run } from "./a.ts";

run();
