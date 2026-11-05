// The zapo store-mysql call shape (appstate.store.ts:414): an executor typed as the pool connection's `execute` (mysql2 declares
// `Promise<[T, FieldPacket[]]>` over an erased generic), its result passed to helpers that take the [rows, fields] tuple. A SELECT
// answers [rows, fields]; an INSERT or UPDATE answers [ResultSetHeader, undefined]. The library's tuple position and the helper's
// must meet exactly, and every statement kind must flow through. No server: the executor is a stand-in answering each kind.
import type { FieldPacket, PoolConnection } from "mysql2/promise";

type QueryOutput = [unknown, FieldPacket[]];
function queryRows(output: QueryOutput): Record<string, unknown>[] {
  return output[0] as Record<string, unknown>[];
}
function describe(output: QueryOutput): string {
  const f = output[1] as unknown;
  if (Array.isArray(f)) return "array:" + f.length;
  if (f === undefined) return "undefined";
  return "other";
}
function affected(output: QueryOutput): number {
  return (output[0] as { affectedRows: number }).affectedRows;
}
async function run(label: string, kind: string, produce: () => unknown): Promise<void> {
  const executor = { execute: (async () => produce()) as unknown as PoolConnection["execute"] };
  try {
    const out = await executor.execute("SQL", [1]);
    if (kind === "rows") console.log(label, "rows", queryRows(out).length, describe(out));
    else console.log(label, "affected", affected(out), describe(out));
    if (kind === "rows") console.log(label, "direct", queryRows(await executor.execute("SQL", [1])).length);
    else console.log(label, "direct", affected(await executor.execute("SQL", [1])));
  } catch (e) {
    console.log(label, "threw", (e as Error).name, (e as Error).message);
  }
}
const ctor = { name: "Object" };
function row(a: number): unknown { return { a, constructor: ctor }; }
function header(affected: number, insertId: number): unknown {
  return { affectedRows: affected, changedRows: 0, fieldCount: 0, info: "", insertId, serverStatus: 2, warningStatus: 0, constructor: ctor };
}
function field(name: string): unknown {
  return { catalog: "def", characterSet: 63, charsetNr: 63, columnLength: 11, columnType: 3, constructor: ctor, db: "d", decimals: 0, default: null, encoding: "binary", extendedFormat: undefined, extendedTypeName: undefined, flags: 0, length: 11, name, orgName: name, orgTable: "t", protocol41: true, schema: "d", table: "t", type: 3, typeName: "LONG", zerofill: false };
}
async function main(): Promise<void> {
  await run("select", "rows", () => [[row(1), row(2)], [field("a")]]);
  await run("insert", "affected", () => [header(1, 7), undefined]);
  await run("update", "affected", () => [header(2, 0), undefined]);
}
main();
