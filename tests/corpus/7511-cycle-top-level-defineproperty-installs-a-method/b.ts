// The cycle-closing edge: aLabel and key are read only from inside a
// function body.
import { aLabel, key } from "./a.ts";
import { attach, Cell } from "./attach.ts";

console.log("b: body");

export const gauge = new Cell("b");
attach(gauge, "extra", "b");

export const bLabel = "B";

export function bSees(): string {
  const rg = gauge as unknown as Record<string, unknown>;
  return "b sees " + aLabel + " / " + gauge.show() + " / " + String(rg[key()]);
}
