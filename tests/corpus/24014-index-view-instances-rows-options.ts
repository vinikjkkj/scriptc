class Row { id = 1; name = "n"; extra: number; constructor(e: number) { this.extra = e; } }
type Cols = { [column: string]: unknown };
interface RowData { constructor: { name: string }; [column: string]: unknown }
function make(): unknown { return [new Row(5), { id: 2, name: "m", tail: true }]; }
const rows = make() as Cols[];
console.log(Object.keys(rows[0]!), rows[0]!.name, rows[1]!.tail, rows.length);
rows[0]!.name = "changed";
rows[1]!.added = 1;
console.log(rows[0], rows[1], JSON.stringify(rows));
const first = rows[0]!;
console.log(first === rows[0], "extra" in first, Object.entries(first));
function options(o: unknown): void { (o as Cols).values = (o as Cols).values || [1]; }
const opt: Cols = { sql: "x" };
options(opt);
console.log(opt, opt.values);
