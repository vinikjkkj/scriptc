// The undefined a library-declared tuple position holds, iterated or spread: Node's own TypeError text.
import type { FieldPacket, Header } from "./types";

function ddl(): any { return [{ affected: 0 }, undefined]; }
async function exec(): Promise<[Header, FieldPacket[]]> {
  return ddl() as [Header, FieldPacket[]];
}

async function main() {
  const [, f] = await exec();
  try { for (const x of f) console.log(x.name); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  try { const copy = [...f]; console.log(copy.length); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  try { console.log(f.length); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  try { console.log(f[0].name); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  try { f.forEach((x) => console.log(x.name)); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  try { const [first] = f; console.log(first); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  try { console.log(Math.max(...f.map((x) => x.name.length))); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  const pair = await exec();
  try { for (const x of pair[1]) console.log(x.name); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
}
main();
