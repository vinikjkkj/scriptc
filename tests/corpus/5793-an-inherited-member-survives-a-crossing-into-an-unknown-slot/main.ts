// The other half of the own-key mask, and the one a fixture had to pin
// because the first cut of the fix passed every ENUMERATION test and still
// broke zapo.
//
// Making the record→dyn crossing answer the source object's own keys is only
// right if the members it does NOT list are still THERE. JS loses nothing:
// `x as T` is the identity and `[[Get]]` walks the prototype chain, so a
// prototype-carried default is readable through every later view of the
// value. A crossing that DELETES it instead makes Object.keys right and every
// later read wrong — which, on zapo, cost the app-state sync its keys and
// made a receipt read throw `expected object | undefined at $, got object`.
//
// So the conversion DEMOTES rather than deletes: own members become keys of
// the fresh object, inherited ones become members of a prototype object
// linked behind it. This program crosses a value into an `unknown` slot and
// then asks both questions of it.
import { decode } from "./msg.js";

interface IMsg {
  conversation?: string | null;
  albumMessage?: string | null;
  audioMessage?: string | null;
  count?: number;
}

function sorted(a: string[]): string[] {
  return a.slice().sort((x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0));
}

// The KEY question, asked of the crossed value.
function keysAcross(v: unknown): string {
  const rec = v as Record<string, unknown>;
  return sorted(Object.keys(rec)).join("+");
}
// The VALUE question, asked of the same crossed value: a second checked cast
// back to the record type reads each member through JS's [[Get]], so the
// prototype the conversion rebuilt is what answers.
function backAcross(v: unknown): string {
  const back = v as IMsg;
  return String(back.conversation) + "/" + String(back.albumMessage) + "/" +
    String(back.audioMessage) + "/" + String(back.count);
}
function jsonAcross(v: unknown): string {
  return JSON.stringify(v);
}

const carried: IMsg = decode("hello") as IMsg;
const empty: IMsg = decode(undefined) as IMsg;

console.log("keys.carried", keysAcross(carried));
console.log("keys.empty", keysAcross(empty));
console.log("json.carried", jsonAcross(carried));
console.log("json.empty", jsonAcross(empty));
// The round trip: every member still readable, inherited ones included.
console.log("back.carried", backAcross(carried));
console.log("back.empty", backAcross(empty));
// And one more hop: crossing the ROUND-TRIPPED value keeps both answers.
const again: IMsg = decode("hello") as IMsg;
console.log("again.keys", keysAcross(again));
console.log("again.back", backAcross(again));
