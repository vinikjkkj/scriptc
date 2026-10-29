// A statically typed record crosses into the replacer walk as a dyn root:
// the output keeps declared member order, NaN becomes null, and an optional
// absent member is omitted.
type Pt = { label: string; x: number; y?: number; tags: string[] };
const pt: Pt = { label: 'o"r\u00e9', x: NaN, tags: ["a", "b"] };
console.log(JSON.stringify(pt, ["tags", "x", "label"]));
console.log(JSON.stringify(pt, (k: string, v: unknown) => v, "\t"));
const rows: Pt[] = [pt, { label: "z", x: Infinity, y: 2, tags: [] }];
console.log(JSON.stringify(rows, (k: string, v: unknown) => v, 1));
