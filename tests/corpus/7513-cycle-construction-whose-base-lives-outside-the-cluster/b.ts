// The cycle-closing edge. aName is read only from inside a function body.
import { aName } from "./a.ts";

console.log("b: body");

export const bName = "B";

export function bSees(): string {
  return "b sees " + aName;
}
