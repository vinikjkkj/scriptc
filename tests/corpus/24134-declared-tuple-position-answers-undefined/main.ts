// A declaration promises `[result, FieldPacket[]]` and the implementation
// answers `[result, undefined]` for a statement without a result set (the
// shape a database driver's promise API declares). The undefined crosses as
// undefined: a pass-through prints it, a dereference throws the TypeError
// Node throws, and nothing throws at the boundary.
import type { FieldPacket, Header, Row } from "./types";

function ddl(): any { return [{ affected: 0 }, undefined]; }
function sel(): any { return [[{ id: 1 }, { id: 2 }], [{ name: "id" }]]; }

async function exec(sql: string): Promise<[Header, FieldPacket[]]> {
  return ddl() as [Header, FieldPacket[]];
}
async function query(sql: string): Promise<[Row[], FieldPacket[]]> {
  return sel() as [Row[], FieldPacket[]];
}

async function main() {
  const [h, f] = await exec("ddl");
  console.log(h.affected, f);
  const r = await query("sel");
  console.log(r[0][1]!.id, r[1].length, r[1][0]!.name);
  const [rows, fields] = await query("sel");
  console.log(rows.length, fields.map((x) => x.name));
  const [, f2] = await exec("ddl");
  try { console.log(f2.length); } catch (e) { console.log((e as Error).message); }
  const r2 = await exec("ddl");
  console.log(r2[1], r2.length);
  const r3 = await exec("ddl");
  const f3 = r3[1];
  console.log(f3);
  try { console.log(f3[0]!.name); } catch (e) { console.log((e as Error).message); }
  console.log(JSON.stringify(r3));
  console.log(Array.isArray(f3), f3 === undefined, (f3 ?? []).length);
}
main();
