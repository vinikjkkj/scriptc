// Three arms and a narrowing reader over what the dispatch built, on values read back through a Map and an array: the arm the key named is the arm the reader sees.
type Shape = { type: "circle"; spec: { r: number } } | { type: "rect"; spec: { w: number; h: number } } | { type: "dot"; spec: { at: number } };
function make(type: Shape["type"], spec: unknown): Shape { return { type, spec } as Shape; }
function area(s: Shape): number {
  switch (s.type) {
    case "circle": return Math.round(3.14159 * s.spec.r * s.spec.r * 100) / 100;
    case "rect": return s.spec.w * s.spec.h;
    default: return s.spec.at;
  }
}
const byName = new Map<string, Shape>();
byName.set("c", make("circle", { r: 2 }));
byName.set("r", make("rect", { w: 3, h: 4 }));
byName.set("d", make("dot", { at: 9 }));
const order: string[] = ["r", "d", "c", "r"];
console.log(order.map((k) => byName.get(k)!).map((s) => s.type + "=" + area(s)).join(" "));
const arr: Shape[] = [];
for (const t of ["dot", "circle", "rect"] as const) arr.push(make(t, t === "dot" ? { at: 1 } : t === "circle" ? { r: 1 } : { w: 2, h: 5 }));
console.log(JSON.stringify(arr), arr.map(area).join(","));
