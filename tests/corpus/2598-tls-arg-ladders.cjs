// The tls option-bag validation ladders: misuse of the implemented tls
// surface answers Node's exact typed errors instead of fencing — the
// createSecureContext/createServer string contracts (ciphers, passphrase,
// ecdhCurve), the engine trio's string-or-null-or-undefined clause, the
// number contracts (handshakeTimeout, sessionTimeout with validateInt32's
// range), ticketKeys' view contract and exact-48-bytes value ladder,
// minVersion/maxVersion's ERR_TLS_INVALID_PROTOCOL_VERSION with %j
// rendering, tls.connect's checkServerIdentity function contract (a
// PRESENT key replaces the builtin verifier even holding undefined —
// Node's defaults spread), and getCACertificates' value ladder. (A
// getCACertificates argument that is a DYNAMIC value is refused at compile
// time: tests/diagnostics/js-tls-getcacertificates-over-a-dynamic-argument.cjs.)
'use strict';
const tls = require('tls');
const show = (fn) => { try { fn(); console.log('ok'); } catch (e) { console.log(`${e.name}|${e.code}|${e.message}`); } };
show(() => { tls.createSecureContext({ ciphers: 1 }); });
show(() => { tls.createServer({ ciphers: 1 }); });
show(() => { tls.createSecureContext({ key: 'dummykey', passphrase: 1 }); });
show(() => { tls.createServer({ key: 'dummykey', passphrase: 1 }); });
show(() => { tls.createServer({ ecdhCurve: 1 }); });
show(() => { tls.createServer({ handshakeTimeout: 'abcd' }); });
show(() => { tls.createServer({ sessionTimeout: 'abcd' }); });
show(() => { tls.createServer({ ticketKeys: 'abcd' }); });
show(() => { tls.createServer({ ticketKeys: Buffer.alloc(0) }); });
show(() => { tls.createServer({ ticketKeys: Buffer.alloc(51) }); });
show(() => { tls.createSecureContext({ clientCertEngine: 0 }); });
show(() => { tls.createSecureContext({ privateKeyEngine: 0, privateKeyIdentifier: 'key' }); });
show(() => { tls.createSecureContext({ privateKeyEngine: 'engine', privateKeyIdentifier: 0 }); });
show(() => { tls.createSecureContext({ minVersion: 'fhqwhgads' }); });
show(() => { tls.createSecureContext({ maxVersion: 'fhqwhgads' }); });
show(() => { tls.createSecureContext({ minVersion: 42 }); });
show(() => { tls.createSecureContext({ sessionTimeout: -1 }); });
show(() => { tls.createSecureContext({ sessionTimeout: 2 ** 31 }); });
show(() => { tls.createSecureContext({ sessionTimeout: 1.5 }); });
for (const checkServerIdentity of [undefined, null, 1, true]) {
  show(() => { tls.connect({ checkServerIdentity }); });
}
for (const invalid of [1, null, () => {}, true]) {
  show(() => tls.getCACertificates(invalid));
}
show(() => tls.getCACertificates('test'));
