// A two-module ESM cycle whose members each run a CALL at top level.
// mongodb's connection_string.ts:66, reduced:
//
//     const resolveSrv = retryDNSTimeoutFor('resolveSrv');
//
// The cycle fence admitted only module bodies made of declarations and
// expressions that cannot call user code, and a call to a user function
// is a call to a user function. But retryDNSTimeoutFor's whole body is
// `return async function (…) {…}` -- it BUILDS a closure and returns it,
// reaching nothing. A call whose callee body is itself inert runs
// exactly the builtins the whitelist already admits, so the call is as
// inert as the body.
//
// The output is ORDER-SENSITIVE by construction: `b` is `a`'s first
// import, so Node evaluates b's body before a's, and b's own back edge
// into a is a cache hit against a module that has not run a line. Every
// use of a cycle-crossing binding sits in a function body, so nothing
// reads a half-initialized slot -- which is exactly the claim the
// admission makes, and this program is what falsifies it if the guarded
// %init calls come out in a different order.
import { run } from "./a.ts";

run();
