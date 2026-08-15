// The fences the `signal` option and the OPTIONAL option values keep.
// The positive half — every shape that lowers — is
// tests/corpus/3791-http-client-abort-signal.ts and
// tests/corpus/3792-http-client-optional-options.ts.
//
// Two admitted shapes and no others: an AbortSignal, and an
// `AbortSignal | undefined` (or `| null`) whose absent arm means "no
// signal", which is what Node does with `signal: undefined`. A union with
// any THIRD arm has no answer here — narrowing it would need a runtime
// test the compiler cannot write — and a value that is not a signal at
// all is the plain type fence.
import * as http from "node:http";
import type { IncomingMessage } from "node:http";

const cb = (res: IncomingMessage) => { console.log(res.statusCode); };
const url = "http://127.0.0.1:9/";

// Not a signal: the option's own type fence, naming what it saw.
http.request(url, { signal: 5 as unknown as AbortSignal }, cb);
http.request(url, { signal: "later" as unknown as AbortSignal }, cb);

// A union with a THIRD arm has no diagnostic here and does not need one:
// the ambient's parameter is `AbortSignal | undefined`, so such a value
// can only arrive through a cast — and a cast off a union goes through
// the checked narrowedArmHelper bridge, which extracts the signal arm and
// THROWS catchably on any other. Verified on the emitted C rather than
// assumed (the call is sc_f_union_narrow_0, not a reinterpreted pointer).

// The optional HEADERS record: the arms have to be a record plus units,
// and that record's values still have to be the env.pairs matrix
// (strings, numbers, string[] — a boolean is none of them).
interface Bad { readonly headers?: Readonly<Record<string, boolean>> }
const bad: Bad = {};
http.request(url, { headers: bad.headers as unknown as Record<string, string> }, cb);

// agent: false injects Connection: close into a LITERAL headers object,
// so it cannot be combined with a record the compiler cannot read — the
// pre-existing fence, reachable now that an OPTIONAL record lowers.
interface Init { readonly headers?: Readonly<Record<string, string>> }
const init: Init = {};
http.request(url, { headers: init.headers, agent: false }, cb);
