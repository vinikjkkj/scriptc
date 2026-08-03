// `diffieHellman(opts)` where the options are a BOUND record rather than an
// object literal at the call. A caller writes it that way when the same
// options also feed a promisified path -- X25519 key agreement in a Noise
// handshake does exactly this, probing for the callback form and keeping
// the sync call as its fallback.
//
// The two keys read off the record. A bare identifier read is pure, so
// reading it twice is unobservable -- the repeatability rule the compound-
// assignment and spread paths already use.
//
// Both spellings are here and their secrets are compared byte for byte:
// the point is not that each compiles but that they agree, and with Node.

import { diffieHellman, generateKeyPairSync } from "node:crypto";
const a = generateKeyPairSync("x25519");
const b = generateKeyPairSync("x25519");
// literal (ja funcionava)
const s1 = diffieHellman({ privateKey: a.privateKey, publicKey: b.publicKey });
// record LIGADO (o que o zapo escreve)
const opts = { privateKey: b.privateKey, publicKey: a.publicKey };
const s2 = diffieHellman(opts);
console.log(s1.length, s2.length, s1.length === 32, Buffer.from(s1).equals(Buffer.from(s2)));
