// The program that says the own-key mask's exemption is declaredOrder and
// not the '%' SPELLING, and it is here because a merge found it rather than
// a diff. 5702 says a spelling filter would be wrong for the INTERNAL-SLOT
// table; this says the same thing for the per-instance own-key MASK, which
// is the other half of the same boundary and the half that arms.
//
// The shape below is a dynCheck TARGET, so its mask arms. A '%'-spelled
// field that is in declaredOrder is an ordinary KEY: the dyn->record
// builder has to stamp its bit and the record->dyn walker has to read the
// same bit. Skip the stamp by spelling and keep the mask by declaredOrder
// and the two disagree in exactly one direction -- the key is DEMOTED to
// the prototype on every crossing. Measured, with the spelling test
// restored on an otherwise identical tree: keys and the crossing both
// answered "name", JSON.stringify dropped the key, Object.hasOwn answered
// false, and the READ still answered 7, which is the demotion's signature.
interface Row {
  "%dtype": number;
  name: string;
}

// The zapo driver's spelling: a value through an `unknown` PARAMETER, cast
// back to a string-keyed record there. That crossing MATERIALISES the key
// list, so it is where a mask the builder never wrote shows up.
function keysAcross(v: unknown): string {
  const rec = v as Record<string, unknown>;
  const ks = Object.keys(rec);
  return ks.slice().sort((a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0)).join("+");
}
function jsonAcross(v: unknown): string {
  return JSON.stringify(v);
}
function sorted(a: string[]): string {
  return a.slice().sort((x: string, y: string): number => (x < y ? -1 : x > y ? 1 : 0)).join("+");
}

const parsed = JSON.parse('{"%dtype":7,"name":"n"}') as Row;
console.log("keys", sorted(Object.keys(parsed)));
console.log("json", JSON.stringify(parsed));
console.log("across", keysAcross(parsed));
console.log("jsonAcross", jsonAcross(parsed));
console.log("read", String(parsed["%dtype"]), parsed.name);
console.log("hasOwn", String(Object.hasOwn(parsed, "%dtype")));

// The other half: the same key genuinely ABSENT on the source object stays
// absent, so the mask is doing work rather than being ignored.
const partial = JSON.parse('{"name":"n"}') as { "%dtype"?: number; name: string };
console.log("partial.keys", sorted(Object.keys(partial)));
console.log("partial.json", JSON.stringify(partial));
console.log("partial.across", keysAcross(partial));
