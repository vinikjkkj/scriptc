// The mysql2 shape: an untyped driver answers class instances (a ResultSetHeader, row objects) that the
// program reads through its own declared records.
class FieldPacket { name = "f"; type = 3; }
class ResultSetHeader {
  fieldCount = 0;
  affectedRows = 0;
  insertId = 0;
  serverStatus = 2;
  warningStatus = 0;
  info = "";
  changedRows = 0;
  constructor(a: number, i: number) {
    this.affectedRows = a;
    this.insertId = i;
    this.changedRows = a;
  }
}
interface RowDataPacket { id: number; name: string }
interface Header { affectedRows: number; insertId: number; changedRows: number }
async function execute(sql: string): Promise<unknown> {
  if (sql.startsWith("SELECT")) return [[{ id: 1, name: "a", extra: 1 }, { id: 2, name: "b" }], [new FieldPacket()]];
  return [new ResultSetHeader(2, 9), undefined];
}
async function main(): Promise<void> {
  const sel = (await execute("SELECT 1")) as [RowDataPacket[], FieldPacket[]];
  console.log(sel[0].length, sel[0][1]!.name, sel[0][0]!.id, sel[1].length);
  sel[0][0]!.name = "changed";
  console.log(sel[0]);
  const ins = (await execute("INSERT")) as [Header, unknown];
  console.log(ins[0].affectedRows, ins[0].insertId, ins[0].changedRows);
  console.log(ins[0]);
}
main();
