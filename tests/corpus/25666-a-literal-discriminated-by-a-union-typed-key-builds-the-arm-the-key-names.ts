// zapo's `{ kind: key, value } as WaHistorySyncItem`: `key` is a union of the arms' discriminant literals, `value` arrives as `unknown`. The arm is picked by the run-time value of
// `key` and `value` is validated as that arm's value type (the conversion any assertion from `unknown` takes).
type Item =
  | { kind: "a"; value: number }
  | { kind: "b"; value: { x: string; y?: number } }
  | { kind: "c"; value: string[] };
type Kind = Item["kind"];
function show(it: Item): string {
  if (it.kind === "a") return "a:" + (it.value + 1);
  if (it.kind === "b") return "b:" + it.value.x + "/" + (it.value.y === undefined ? "-" : String(it.value.y));
  return "c:" + it.value.join("+");
}
function build(key: Kind, value: unknown): Item { return { kind: key, value } as Item; }
const items: Item[] = [build("a", 41), build("b", { x: "q" }), build("b", { x: "r", y: 7 }), build("c", ["m", "n"]), build("c", [])];
console.log(items.map(show).join(" "));
console.log(JSON.stringify(items));
console.log(items[0]!.kind, items.length);
