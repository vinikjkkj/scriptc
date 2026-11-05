// The undefined a declared tuple position holds travels like any value:
// bound, printed, tested, narrowed, optional-chained, dereferenced.
import type { FieldPacket, Header } from "./types";

function ddl(): any { return [{ affected: 0 }, undefined]; }
const shared = [{ name: "id" }, { name: "v" }];
function sel(): any { return [{ affected: 2 }, shared]; }

async function exec(sql: string): Promise<[Header, FieldPacket[]]> {
  return (sql === "ddl" ? ddl() : sel()) as [Header, FieldPacket[]];
}

async function main() {
  const [, a] = await exec("ddl");
  console.log(a);
  const [, b] = await exec("sel");
  console.log(b.length);
  const [h, f] = await exec("sel");
  if (f) console.log("has fields", f.length);
  else console.log("no fields");
  const [h2, f2] = await exec("ddl");
  if (f2) console.log("has fields", f2.length);
  else console.log("no fields", h2.affected);
  console.log(typeof f2, typeof f, h.affected);
  console.log(f2?.length, f?.length);
  try { console.log(f2.map((x) => x.name)); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  try { f2.push({ name: "x" }); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  const r = await exec("sel");
  console.log(JSON.stringify(r));
  const r2 = await exec("ddl");
  console.log(JSON.stringify(r2));
}
main();
