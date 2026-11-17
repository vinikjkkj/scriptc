// Arm values with optional fields, nested records and an undefined-armed field: converted from `unknown` as the arm's own type, absent fields staying absent.
type Ev =
  | { kind: "text"; value: { body: string; reply?: string | null } }
  | { kind: "pair"; value: { left: { id: number }; right: { id: number; tags?: string[] } } }
  | { kind: "none"; value: undefined };
function build(kind: Ev["kind"], value: unknown): Ev { return { kind, value } as Ev; }
function show(e: Ev): string {
  if (e.kind === "text") return "text:" + e.value.body + "|" + String(e.value.reply) + "|" + ("reply" in e.value);
  if (e.kind === "pair") return "pair:" + e.value.left.id + "," + e.value.right.id + "," + (e.value.right.tags === undefined ? "-" : e.value.right.tags.join("+"));
  return "none:" + String(e.value);
}
const list = [
  build("text", { body: "hi" }),
  build("text", { body: "yo", reply: null }),
  build("text", { body: "ok", reply: "re" }),
  build("pair", { left: { id: 1 }, right: { id: 2 } }),
  build("pair", { left: { id: 3 }, right: { id: 4, tags: ["u", "v"] } }),
  build("none", undefined),
];
console.log(list.map(show).join("\n"));
