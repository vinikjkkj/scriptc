// The enumeration answer of a narrowed record reaches console.log and a for-of of the pairs, not only JSON.
interface Wide { id: string; hidden?: string; other?: number }
interface Narrow { readonly id: string }
function narrow(w: Wide): Narrow { const n: Narrow = w; return n; }
function send(payload: unknown): string { return JSON.stringify(payload); }
for (const w of [{ id: "1", hidden: undefined, other: 5 }, { id: "2" }] as Wide[]) {
  const r = narrow(w);
  console.log(send(r));
  console.log(Object.entries(r));
  console.log(Object.values(r));
  for (const e of Object.entries(r)) console.log(JSON.stringify(e));
}
