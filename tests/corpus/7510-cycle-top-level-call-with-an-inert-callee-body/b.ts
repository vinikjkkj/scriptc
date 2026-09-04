// The cycle-closing edge. `aTag` is read only from inside a function
// body, so the read happens after both modules finished initializing.
import { aTag } from "./a.ts";
import { makeTagger } from "./tag.ts";

console.log("b: body");

export const bTag = makeTagger("b");

export function bEcho(): string {
  return "b sees " + aTag(3);
}
