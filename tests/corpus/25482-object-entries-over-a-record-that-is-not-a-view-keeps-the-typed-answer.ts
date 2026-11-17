// The same shapes with NO width copy in between: the record is its own object, the typed walk answers, and a typed consumer reads string values.
interface Rec { id: string; name: string; secret?: string }
function make(i: number, secret: string | undefined): Rec { return { id: "id" + i, name: "n" + i, secret }; }
const rows = [make(1, "s1"), make(2, undefined)];
for (const r of rows) {
  console.log(Object.keys(r).join(","));
  console.log(Object.values(r).map((v) => String(v)).join("|"));
  let n = 0;
  for (const [k, v] of Object.entries(r)) if (v !== undefined) n += k.length + v.length;
  console.log(n);
}
