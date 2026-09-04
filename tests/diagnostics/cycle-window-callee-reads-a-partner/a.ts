import { bTag } from "./b.ts";

console.log("a: body");

export const aSeed = 5;

export function run(): void {
  console.log("a.run:", bTag(1));
}
