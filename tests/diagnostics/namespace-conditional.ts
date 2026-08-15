// The fences a runtime-chosen module NAMESPACE keeps. The positive half
// is tests/corpus/3762-namespace-conditional-transport.ts and
// tests/fixtures/server/cases/namespace-conditional-transport.
//
// The binding holds a SELECTOR — the condition, evaluated once at the
// declaration — and member calls through it lower once per arm. Anything
// that would READ the binding as a module object has no lowering, and
// says so by name rather than answering the bool the slot holds.
import * as http from "node:http";
import * as https from "node:https";
import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import type { IncomingMessage } from "node:http";

const cb = (res: IncomingMessage) => { console.log(res.statusCode); };
const flag = process.argv.length > 99;

// A `let` binding: a later assignment could name an unrelated module, and
// the selector is fixed at the declaration.
function reassignable(): void {
  let t = flag ? https : http;
  t.request("https://127.0.0.1:9/", { method: "GET" }, cb);
}
reassignable();

// The conditional OUTSIDE a const declaration: there is no slot to hold
// the selector.
function noSlot(): void {
  console.log(typeof (flag ? https : http));
}
noSlot();

// The binding as a VALUE — every shape of it.
function asValue(): void {
  const t = flag ? https : http;
  console.log(t);
}
asValue();

function aliased(): void {
  const t = flag ? https : http;
  const other = t;
  console.log(typeof other);
}
aliased();

function memberAsValue(): void {
  const t = flag ? https : http;
  const f = t.request;
  console.log(typeof f);
}
memberAsValue();

// A pair of modules whose member SETS differ: the arm that has no
// lowering for the called member fences naming that module, so a call
// can never silently lower on one arm only.
function mixedArms(): void {
  const t = flag ? fs : fsp;
  console.log(typeof t);
}
mixedArms();
