// A row class read through an index-signature record: every own enumerable key of the instance
// is the overflow, the declared key keeps its type, a getter answers when it is named.
class Row {
  id = 1;
  name = "n";
  extra = true;
  get computed(): string {
    return this.name + this.id;
  }
}
interface RowDataPacket {
  [column: string]: any;
}
interface Typed {
  id: number;
  [k: string]: unknown;
}
interface WithGetter {
  computed: string;
  id: number;
  [k: string]: unknown;
}
const u: unknown = new Row();
const r = u as RowDataPacket;
console.log(r.id, r.name, r.extra, r.nothing);
console.log(Object.keys(r));
const t = u as Typed;
console.log(t.id, Object.keys(t), t["name"]);
const g = u as WithGetter;
console.log(g.computed, g.id);
const rows: unknown = [new Row(), new Row()];
const rr = rows as RowDataPacket[];
console.log(rr.length, rr[1]!.name);
interface Empty {}
console.log(typeof (u as Empty));
