// tls.getCACertificates' argument ladder, pinned on BOTH backends.
//
// This surface is `tls.caCertsChk` in the IR, and it is the one library
// call in its family that ALWAYS throws — Node's type ladder first, then
// the value ladder, then a trailing fence. Because it never returns,
// validate.ts gives the call the type of the expression it REPLACED
// rather than void, while the runtime entry is `void`. That pair is a
// trap for any backend that derives its call signature from the IR
// result type: the LLVM tier did exactly that on its first attempt at
// this row, declared a value return over a void callee, and read a
// result register the callee never set. All five of the errors below
// came back as throws with no name, no code and no message. Nothing
// crashed and nothing warned.
//
// So the assertion is not "getCACertificates validates". It is that the
// THROWN VALUE still arrives as a real Error carrying Node's exact name,
// code and message, through both code generators, on both rungs of the
// ladder — and that the accepting cases still return, so a backend that
// throws for everything cannot pass this by accident.
//
// Store CONTENTS are deliberately never printed. getCACertificates('extra')
// is empty or not according to whether NODE_EXTRA_CA_CERTS is set, and
// 'system' is whatever the host trusts; measured, not assumed — the same
// node run with and without that variable flips exactly that field. Only
// shapes appear here, so this fixture is a property of the compiler.
'use strict';
const tls = require('tls');
const show = (label, fn) => {
  try {
    const v = fn();
    console.log(`${label} | ok | array=${Array.isArray(v)}`);
  } catch (e) {
    console.log(`${label} | ${e.name} | ${e.code} | ${e.message}`);
  }
};

// The TYPE rung: everything that is not a string, with Node's per-kind
// "Received ..." rendering (the parenthesised number and boolean forms,
// and the bare `null`).
show('type number', () => tls.getCACertificates(1));
show('type null', () => tls.getCACertificates(null));
show('type boolean', () => tls.getCACertificates(true));

// The VALUE rung: strings the store does not know. Empty and wrong-case
// are separate cases — both pass the type rung and fail the value one.
show('value test', () => tls.getCACertificates('test'));
show('value empty', () => tls.getCACertificates(''));
show('value upper', () => tls.getCACertificates('BUNDLED'));

// The accepting cases.
show('ok bundled', () => tls.getCACertificates('bundled'));
show('ok default', () => tls.getCACertificates('default'));
show('ok system', () => tls.getCACertificates('system'));
show('ok extra', () => tls.getCACertificates('extra'));

// A catch/rethrow round trip: the error survives as the same object,
// which is what a garbage result register does not.
try {
  try {
    tls.getCACertificates('test');
  } catch (e) {
    throw e;
  }
} catch (e) {
  console.log(`rethrow | ${e.name} | ${e.code} | instanceof=${e instanceof TypeError}`);
}
