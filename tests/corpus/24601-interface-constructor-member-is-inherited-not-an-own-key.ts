// mysql2's result row type declares `constructor: { name: "RowDataPacket" }` on an INTERFACE. A real row is a plain object with no
// own `constructor` key (Node's `constructor` there is Object.prototype's), so the check-and-extract of a parsed row into the
// result union must not demand the member as own data. Node never checks; this used to throw
// "expected array | ... at $[0], got array" on both backends.
interface RowDataPacket { constructor: { name: "RowDataPacket" }; [column: string]: any; [column: number]: any }
interface OkPacket { constructor: { name: "OkPacket" }; fieldCount: number; affectedRows: number; changedRows: number; insertId: number; serverStatus: number; warningCount: number; message: string; procotol41: boolean }
interface ResultSetHeader { constructor: { name: "ResultSetHeader" }; fieldCount: number; affectedRows: number; insertId: number; info: string; serverStatus: number; warningStatus: number; changedRows: number }
type QueryResult = OkPacket | ResultSetHeader | ResultSetHeader[] | RowDataPacket[][] | RowDataPacket[] | OkPacket[];
function fake(json: string): Promise<unknown> { return Promise.resolve(JSON.parse(json)); }
(async () => {
  const r = (await fake('[[{"x":1,"y":"a"},{"x":2,"y":"b"}],[1,2]]')) as [QueryResult, number[]];
  const rows = r[0] as RowDataPacket[];
  console.log(rows.length, JSON.stringify(rows), Object.keys(rows[0]!).join(","), rows[0]!.x + rows[1]!.x);
  const ok = (await fake('[{"constructor":{"name":"OkPacket"},"fieldCount":0,"affectedRows":3,"changedRows":0,"insertId":9,"serverStatus":2,"warningCount":0,"message":"","procotol41":true},[1]]')) as [QueryResult, number[]];
  console.log(Array.isArray(ok[0]) ? "array" : (ok[0] as OkPacket).affectedRows);
})().catch((e) => console.log("ERR", (e as Error).message));
