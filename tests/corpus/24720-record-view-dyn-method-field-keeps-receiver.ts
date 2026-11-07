// A class instance held as unknown and cast to a record whose method field is `any` (pg's `{ query: PoolClient['query'] }`
// executor shape, minus the package): the record is a view of the instance, so calling `rec.query(...)` or `rec["query"](...)`
// runs the method with `this` = the instance, and a write to the instance after the cast is read by the next call.
class Pool {
  tag = "pool";
  query(text: string, values?: unknown[]): string {
    return this.tag + ":" + text + ":" + JSON.stringify(values ?? []);
  }
}
function hold(): unknown {
  return new Pool();
}
const p = hold();
const e = p as { query: any };
console.log(e.query("a", [1]));
console.log(e["query"]("b"));
(p as { tag: string }).tag = "renamed";
console.log(e.query("c"));
