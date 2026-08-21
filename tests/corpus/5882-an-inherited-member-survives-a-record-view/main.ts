// `x as T` is the IDENTITY in JavaScript, so a member the source object
// only INHERITED is still readable through any later view of the value --
// and `in` still answers true for it, because `in` is "own OR inherited".
//
// A record is a monomorphic struct with slots for the members its type
// names and nowhere at all to hold a chain. Once the own-key mask stopped
// writing inherited members as own KEYS, an index-signature capture --
// `v as Record<string, unknown>`, which is the zapo driver's own spelling
// for an `unknown` parameter -- copied only the source's OWN entries into
// the overflow map and the chain ended there: `rec["label"]` answered
// undefined where JS answers "dflt", and `"label" in rec` answered false.
// Ten cells of an eighty-cell population, and the reason the same
// representation could not be right for Object.keys and for a keyed read
// at once.
//
// The record carries the SOURCE's [[Prototype]] now
// (IrRecordShape.srcproto), consulted by the keyed read's MISS path and by
// `in`, after the declared names and the overflow map have both answered
// no. Object.keys still reads the overflow map alone, so the own-key set
// is exactly what it was.
import { decode } from "./msg.js";

interface IMsg {
  conversation: string | null;
  albumMessage: string | null;
  label: string;
}

// the zapo driver's spelling: an `unknown` parameter, cast back to a
// string-keyed record, then read or enumerated (dcmax3.ts normalize()).
function readOf(v: unknown, k: string): string {
  return String((v as Record<string, unknown>)[k]);
}
function inOf(v: unknown, k: string): string {
  return String(k in (v as Record<string, unknown>));
}
function keysOf(v: unknown): string {
  return JSON.stringify(Object.keys(v as Record<string, unknown>).sort());
}

const crossed = decode("hi") as IMsg;
const u: unknown = crossed;

// the OWN half: unchanged, and it is the half the mask exists for
console.log(keysOf(u));
console.log(JSON.stringify(crossed));

// the INHERITED half, through a second crossing into a record VIEW
console.log(readOf(u, "label"), readOf(u, "albumMessage"), readOf(u, "conversation"));
console.log(inOf(u, "label"), inOf(u, "albumMessage"), inOf(u, "conversation"));

// a key nothing carries is still absent on both surfaces
console.log(readOf(u, "nope"), inOf(u, "nope"));

// an OWN key that SHADOWS a prototype default wins, and stays own
const shadow = decode("own") as IMsg;
console.log(readOf(shadow, "conversation"), inOf(shadow, "conversation"), keysOf(shadow));

// the record -> dyn -> record round trip still preserves every value
const back = u as IMsg;
console.log(String(back.conversation), String(back.albumMessage), String(back.label));
