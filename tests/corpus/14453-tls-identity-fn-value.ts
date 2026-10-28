import * as Tls from "tls";
// tls.checkServerIdentity as a VALUE: the function object is one interned
// closure (=== holds), a call through the value answers like the direct call,
// and it is a valid checkServerIdentity option for tls.connect's options record.
const f = Tls.checkServerIdentity;
console.log(typeof f, f === Tls.checkServerIdentity);
const ok = f("example.com", { subjectaltname: "DNS:example.com" } as any);
const bad = f("example.com", { subjectaltname: "DNS:other.com" } as any);
console.log(ok === undefined, bad === undefined, (bad as any).code);
const opts = { checkServerIdentity: Tls.checkServerIdentity, rejectUnauthorized: true };
console.log(typeof opts.checkServerIdentity);
