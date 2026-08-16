// A builtin function BOUND AT MODULE SCOPE under real @types/node.
//
// `const dh = diffieHellman` is the callback-probe shape: a consumer binds
// the builtin once at module scope and only calls it later, so the binding
// itself must have a representation even in the branch that never calls it.
// tests/corpus/2717-diffie-hellman-as-a-value.ts pins the same shape -- but
// the corpus has no tsconfig.json above it, so 2717 compiles against the
// SHIPPED FALLBACK declarations, where crypto.diffieHellman has exactly one
// call signature. Real @types/node declares two (the synchronous options
// form and the callback form), and an overload set is precisely what made
// the binding's TYPE fence: SC2020 on the declaration, SC2004 on every use.
//
// So 2717 was green in the world the corpus is in and red in the world zapo
// is in, and only a fixture in THIS directory can tell the two apart. That
// is the whole reason this file exists rather than another corpus program.
//
// Both binding positions are exercised, because they are decided by
// different code: the file-scope one by collectGlobals (which picks a slot
// before any initializer is lowered) and the function-scope one by
// lowerVarDecl's type ladder. The first fix alone left the second fence.
import { diffieHellman, generateKeyPairSync } from "node:crypto";

type Opts = { privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"]; publicKey: ReturnType<typeof generateKeyPairSync>["publicKey"] };

const a = generateKeyPairSync("x25519");
const b = generateKeyPairSync("x25519");

// FILE SCOPE: the module-global slot.
const dh = diffieHellman;

const optsAB: Opts = { privateKey: a.privateKey, publicKey: b.publicKey };
const optsBA: Opts = { privateKey: b.privateKey, publicKey: a.publicKey };

const s1 = dh(optsAB);
const s2 = dh(optsBA);
console.log(s1.length, s2.length);
console.log(Buffer.from(s1).toString("hex") === Buffer.from(s2).toString("hex"));

// The value crosses a call boundary as an argument.
function agree(f: (o: Opts) => Buffer, o: Opts): number {
  return f(o).length;
}
console.log(agree(dh, optsAB));

// FUNCTION SCOPE: lowerVarDecl's ladder, the same overload set.
function inner(): boolean {
  const local = diffieHellman;
  return local(optsAB).length === local(optsBA).length;
}
console.log(inner());

// One lift, memoized: every read is the same function.
const again = diffieHellman;
console.log(again(optsAB).length === dh(optsAB).length);
