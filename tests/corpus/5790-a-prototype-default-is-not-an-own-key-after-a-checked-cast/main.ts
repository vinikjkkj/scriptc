// A checked cast MATERIALISES a record out of a dynamic value: every declared
// member is read, and a read is JS's [[Get]] — own data, else the PROTOTYPE
// chain. So a prototype-carried default lands in the struct slot, and without
// a per-instance own-key record every enumeration surface then reports it as
// a key the object has. Node reports the object's OWN keys, which is one.
//
// Both halves are pinned here, because each is what the other fix breaks:
// the KEY SET is the source object's own keys, and the VALUE of an inherited
// member is still the inherited value (`t.albumMessage` is `null`, not
// `undefined` — JS answers the prototype's value for a read).
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

// The zapo driver's own spelling (dcmax3.ts normalize): a value flows into
// an `unknown` PARAMETER, is cast back to a string-keyed record there, and
// enumerated. That crossing is where the key list is materialised.
function keysAcross(v: unknown): string {
  const rec = v as Record<string, unknown>;
  return sorted(Object.keys(rec)).join("+");
}
function jsonAcross(v: unknown): string {
  return JSON.stringify(v);
}

const carried: IMsg = decode("hello") as IMsg;
const empty: IMsg = decode(undefined) as IMsg;

console.log("keys.carried", sorted(Object.keys(carried)).join("+"));
console.log("keys.empty", sorted(Object.keys(empty)).join("+"));
console.log("across.carried", keysAcross(carried));
console.log("across.empty", keysAcross(empty));
console.log("json.carried", JSON.stringify(carried));
console.log("json.empty", JSON.stringify(empty));
console.log("jsonAcross.carried", jsonAcross(carried));
console.log("hasOwn.album", String(Object.hasOwn(carried, "albumMessage")));
console.log("hasOwn.conversation", String(Object.hasOwn(carried, "conversation")));

// The VALUE half: an inherited member still reads as the prototype's value.
console.log("read.album", String(carried.albumMessage), String(carried.albumMessage === null));
console.log("read.count", String(carried.count));
console.log("read.conversation", String(carried.conversation));

// A LITERAL of the same shape carries no mask at all, so it answers from its
// declared fields exactly as it always has.
const built: IMsg = { conversation: "own", count: 7 };
console.log("keys.built", sorted(Object.keys(built)).join("+"));
console.log("json.built", JSON.stringify(built));
console.log("across.built", keysAcross(built));
