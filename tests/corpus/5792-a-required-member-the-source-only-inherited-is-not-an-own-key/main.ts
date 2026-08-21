// The counterexample that decides the own-key mask's ARMING rule.
//
// The first rule armed only shapes carrying an optional member, on the
// reasoning that a REQUIRED member always exists so a per-instance record of
// own-ness could not change its answer. That is false: a required member can
// be one the source object merely INHERITED, and the cast succeeds precisely
// because JS's [[Get]] walks the prototype chain. `Object.keys` must still
// answer one key.
import { fromLow } from "./long.js";

interface Long {
  low: number;
  high: number;
  unsigned: boolean;
}

function sorted(a: string[]): string[] {
  return a.slice().sort((x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0));
}
function keysAcross(v: unknown): string {
  const rec = v as Record<string, unknown>;
  return sorted(Object.keys(rec)).join("+");
}

const l: Long = fromLow(7) as Long;
console.log("keys", sorted(Object.keys(l)).join("+"));
console.log("across", keysAcross(l));
console.log("json", JSON.stringify(l));
console.log("hasOwn.high", String(Object.hasOwn(l, "high")));
// ... and the values are still the prototype's, which is what JS reads.
console.log("read", String(l.low), String(l.high), String(l.unsigned));
