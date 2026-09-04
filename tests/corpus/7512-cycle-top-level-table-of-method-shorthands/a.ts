import { B_TABLE, bApply } from "./b.ts";

console.log("a: body");

// Every entry written in METHOD SHORTHAND. Nothing here executes: the
// table is definitions, exactly as `transform: function (raw) {…}` would
// be -- and that spelling was already admitted at a cycle top level.
export const A_TABLE = {
  width: {
    kind: "int",
    transform(raw: string): string {
      return "a-int:" + String(raw.length);
    },
  },
  label: {
    kind: "string",
    transform(raw: string): string {
      return "a-str:" + raw.toUpperCase();
    },
  },
};

export function aApply(key: "label" | "width", raw: string): string {
  return A_TABLE[key].transform(raw);
}

export function run(): void {
  console.log("A_TABLE.width.kind:", A_TABLE.width.kind);
  console.log("aApply label:", aApply("label", "hi"));
  console.log("aApply width:", aApply("width", "hi"));
  console.log("B_TABLE.depth.kind:", B_TABLE.depth.kind);
  console.log("bApply:", bApply("name", "hi"));
}
