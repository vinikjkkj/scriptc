// voip's package entry. The DOM declarations come from the tsconfig's
// `"lib": ["ES2020", "DOM"]` and MUST NOT be referenced as a copied file.
//
// This entry used to carry `/// <reference path="./dom-lib.d.ts" />` over a
// byte-identical copy of typescript's own lib.dom.d.ts, and that one line
// produced SIX false refusals, because `Lowerer.isStdlibFile` is a PATH
// identity (`program.isSourceFileDefaultLibrary`) and every stdlib type
// mapping in types.ts is gated on it. Measured, same app, same tsconfig,
// same @types/node, one variable:
//
//   flagless, --provenance-sources:   19 errors  ->  3
//   --best-effort:                     4 errors  ->  2
//
// The sixteen that went away were TextEncoder and TextDecoder (SC2020, at the
// DECLARATION of a stored codec -- @types/node's global resolves through
// `typeof globalThis extends { onmessage: any; ... }` and DOM supplies
// `onmessage`, so the type becomes DOM's interface), plus URL.protocol,
// URL.hostname, AbortSignal.aborted and AbortController.signal (SC1090).
// They were the instrument's, not zapo's, and one of them cost a block a
// session chasing a TextEncoder lowering that has existed since b4472610.
export * from '../pkgs/voip/index'
