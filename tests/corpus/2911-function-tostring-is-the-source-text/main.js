// Function.prototype.toString answers a function's SOURCE TEXT, exactly
// as written — comments, line breaks and all. `[native code]` is the
// answer for a function that HAS no source: an engine builtin, or the
// result of `Function#bind`. A compiled program that prints the native
// form for a function it compiled from source is wrong, and wrong in the
// worst way: exit 0, no diagnostic, nobody notices.
//
// The finding this case was written for said the divergence was "across a
// module edge". It is not. The edge decides nothing; what decides is
// whether the function value has crossed into `unknown`. A value that
// stays statically typed hits the compile-time fence (loud), and a value
// that has been boxed into the checked-dynamic tree is the one that used
// to answer `function name() { [native code] }` — module edge or not. The
// first two cases below are the same wrong answer, one across an edge and
// one in this very file.
//
// A JavaScript entry, and it has to be: Node runs a `.ts` program through
// type STRIPPING, so `toString` there answers the erased text (each
// annotation replaced by spaces of its own width), which is not what the
// file says. TypeScript function values keep their compile-time fence
// instead of carrying a text that would be wrong invisibly.

import { crossEdge, readsLater } from "./mod.js";

// `show` takes an implicit-any parameter, so every value below crosses
// into the dynamic tree before it is stringified — the exact path that
// used to answer `[native code]`.
function show(tag, v) { console.log(tag + "|" + String(v)); }

// ── the reported shape: across a module edge ────────────────────────────
show("crossEdge", crossEdge);
// …and the same shape with no edge at all.
function sameFile(a, b) { /* a comment survives */ return a + b; }
show("sameFile", sameFile);

// The four ways to write a function value, each keeping its own text: an
// arrow prints no `function`, an anonymous expression prints the keyword
// with no name, and a NAMED function expression prints the name it was
// created with, not the binding it was stored in.
const arrow = (z) => z + 1;
const anon = function (z) { return z; };
const named = function itsOwnName(z) { return z; };
show("arrow", arrow);
show("anon", anon);
show("named", named);

// An alias is the SAME function, so it prints the same text — JS fixes a
// function's source once, at creation, exactly as it fixes its name.
const alias = sameFile;
show("alias", alias);

// The text survives every hop the value takes: through a parameter, out
// of a call, and back off a property.
function through(f) { return String(f); }
console.log("param|" + through(sameFile));

function makeInner() { return function inner() { return 7; }; }
show("callResult", makeInner());

const holder = { held: sameFile, shorthand(y) { return y; }, field: (y) => y };
show("holder", holder.held);
show("shorthand", holder.shorthand);
show("field", holder.field);

// `export` belongs to the declaration, not to the function, so it is not
// part of the text — and neither is `static`. `async`, `get`, `*` would
// be, since they change what the function IS.
class K { static stat() { return 1; } }
show("staticMethod", K.stat);

// Whitespace, comments and non-ASCII are reproduced byte for byte: the
// answer is the source, not a re-print of a parse.
function shaped(a,
                b) {
  // a line comment with "quotes" and a \ backslash
  /* block
     comment ★ */
  return a + b + "\t\n\"x\"";
}
show("shaped", shaped);
// Twice, through two separate boxes of one function: one value, one answer.
show("shapedAgain", shaped);

// ── where `[native code]` is the RIGHT answer ───────────────────────────
// A bound function has no source. Note it prints with NO name: its
// `.name` is "bound sameFile", but its toString is the nameless form, and
// a rebind changes neither.
show("bound", sameFile.bind(null));
show("boundTwice", sameFile.bind(null).bind(null));

// The exact four lines the finding was filed on: an anonymous function
// expression held by a module-scope `var`, handed out by a function
// declared above the declarator. By the time anything calls `readsLater`
// the initialiser has run, so the value is the function — and its text is
// the answer, through the module edge and through the `var` both.
console.log("moduleVar|" + String(readsLater()));
