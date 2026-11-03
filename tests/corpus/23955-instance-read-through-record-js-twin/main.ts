// A driver in plain JavaScript answers class instances; the program declares the answer's shape
// with records. The checked cast reads every declared member off the instance, the way Node does
// when it never checks, accessor properties and methods included.
import { execute } from "./lib.js";

interface ResultSetHeader {
  fieldCount: number;
  affectedRows: number;
  insertId: number;
  info: string;
  serverStatus: number;
  warningStatus: number;
}
interface Row {
  id: number;
  label: string;
}
interface Field {
  name: string;
  table: string;
  inspectName(): string;
}
type Answer = ResultSetHeader | Row[];

async function run(kind: string): Promise<void> {
  const raw: unknown = await execute(kind);
  const pair = raw as [Answer, Field[]];
  const res = pair[0];
  const fields = pair[1];
  if (Array.isArray(res)) {
    console.log("rows", res.map((r) => r.id + ":" + r.label).join(","));
  } else {
    console.log("header", res.affectedRows, res.insertId, res.serverStatus, JSON.stringify(res.info));
  }
  console.log("fields", fields.length, fields.map((f) => f.name + "@" + f.table + "/" + f.inspectName()).join(" "));
}
async function main(): Promise<void> {
  await run("write");
  await run("read");
}
void main();
