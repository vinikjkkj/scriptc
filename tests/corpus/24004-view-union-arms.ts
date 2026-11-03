// A union with array and record arms picks the arm by the object's shape and keeps the object's identity.
interface Header { affectedRows: number; insertId: number }
interface Row { id: number; name: string }
type Res = Row[] | Header;
class ResultSetHeader { affectedRows = 2; insertId = 9; fieldCount = 0; info = "i"; }
function pick(raw: unknown): void {
  const r = raw as Res;
  if (Array.isArray(r)) console.log("rows", r.length, r.map((x) => x.id));
  else console.log("header", r.insertId, r.affectedRows);
}
pick([{ id: 1, name: "a", more: 1 }, { id: 2, name: "b" }]);
pick(new ResultSetHeader());
pick({ affectedRows: 5, insertId: 6, other: true });
const hdr = new ResultSetHeader() as unknown;
const u = hdr as Res;
(hdr as ResultSetHeader).insertId = 77;
if (!Array.isArray(u)) console.log(u.insertId);
