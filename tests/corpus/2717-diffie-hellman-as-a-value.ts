// `diffieHellman` bound as a VALUE, then called through it.
//
// Builtin functions lower to a libCall at their call sites and have no
// closure representation, so the bare identifier fenced. That is fine for
// most of them, but it breaks a shape a real consumer uses: bind the
// function at module scope, then PROBE later -- inside a try -- for a
// callback-taking form this runtime may not have. Node's bind succeeds
// and the probe answers; fencing the bind turns a probe the program is
// prepared to lose into a throw at import time.
//
// The lift follows performance.now.bind(performance): a real function over
// the same libCall.
import { diffieHellman, generateKeyPairSync, type KeyObject } from "node:crypto";

type Opts = { privateKey: KeyObject; publicKey: KeyObject };

const a = generateKeyPairSync("x25519");
const b = generateKeyPairSync("x25519");

// The plain value, called directly.
const dh = diffieHellman;
const s1 = dh({ privateKey: a.privateKey, publicKey: b.publicKey });
const s2 = dh({ privateKey: b.privateKey, publicKey: a.publicKey });
console.log(s1.length, s2.length);
console.log(Buffer.from(s1).toString("hex") === Buffer.from(s2).toString("hex"));

// Through a bound options record rather than a literal, the spelling a
// caller uses when the same options also feed another path.
const opts: Opts = { privateKey: a.privateKey, publicKey: b.publicKey };
console.log(dh(opts).length);

// Passed on as an argument -- the value crossing a call boundary.
function agree(f: (o: Opts) => Buffer, o: Opts): number {
  return f(o).length;
}
console.log(agree(dh, opts));

// The probe shape itself: cast to a callback-taking signature and called
// with the extra argument. What matters here is that BINDING and CALLING
// both succeed -- that is the whole point of the lift, since the consumer
// probes at module scope and is prepared to lose.
//
// A DIVERGENCE the lift does not close, measured rather than assumed:
// Node's diffieHellman does have a callback form, so there `r` comes back
// undefined and the callback fires. The lifted value is the one-argument
// synchronous form, so `r` is the secret. A consumer written against both
// (probe, then promisify if the callback form exists) therefore takes its
// synchronous branch here and its asynchronous branch under Node -- same
// secret either way, which is why this case pins the reachability rather
// than the return value.
const withCallback = diffieHellman as unknown as (
  o: Opts,
  cb: (err: Error | null, secret: Buffer) => void,
) => Buffer | undefined;

let verdict = "not-called";
try {
  withCallback(opts, () => {});
  verdict = "called";
} catch {
  verdict = "threw";
}
console.log(verdict);

// The value is the same function every read -- one lift, memoized.
const again = diffieHellman;
console.log(again(opts).length === dh(opts).length);
