// A wide record read through a narrower interface is the SAME object in Node: Object.values and Object.entries list every member it holds, an unset one as undefined (null in JSON).
interface Wide { id: string; name: string; secret?: string; note?: string }
interface Narrow { readonly id: string; readonly name: string }
function make(i: number, extra: string | undefined): Wide { return { id: "id" + i, name: "n" + i, secret: extra, note: extra === undefined ? undefined : extra + "!" }; }
function narrow(w: Wide): Narrow { const n: Narrow = w; return n; }
function send(payload: unknown): string { return JSON.stringify(payload); }
const rows = [narrow(make(1, process.argv.length > 99 ? undefined : "hidden")), narrow(make(2, undefined))];
for (const r of rows) {
  console.log(send(r));
  console.log(Object.keys(r).join(","));
  console.log(JSON.stringify(Object.values(r)));
  console.log(JSON.stringify(Object.entries(r)));
  console.log(r);
  for (const k in r) console.log("key", k);
}
