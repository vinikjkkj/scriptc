// The cycle-closing edge: A_TABLE is read only from inside a method
// body, so the read happens after both modules finished initializing.
import { A_TABLE } from "./a.ts";

console.log("b: body");

export const B_TABLE = {
  depth: {
    kind: "int",
    transform(raw: string): string {
      return "b-int:" + String(raw.length);
    },
  },
  name: {
    kind: "string",
    transform(raw: string): string {
      return "b-str:" + raw + "/" + A_TABLE.width.kind;
    },
  },
};

export function bApply(key: "name" | "depth", raw: string): string {
  return B_TABLE[key].transform(raw);
}
