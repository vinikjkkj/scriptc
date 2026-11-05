// The undefined a library-declared tuple position holds flows on into
// declared array slots: a parameter, a field, a record member, an annotated
// local and a return. Node hands it along; only a dereference throws.
import type { FieldPacket, Header } from "./types";

function ddl(): any { return [{ affected: 0 }, undefined]; }
function sel(): any { return [{ affected: 2 }, [{ name: "id" }]]; }
async function exec(sql: string): Promise<[Header, FieldPacket[]]> {
  return (sql === "ddl" ? ddl() : sel()) as [Header, FieldPacket[]];
}

function describe(tag: string, f: FieldPacket[]): string {
  return tag + ":" + (f === undefined ? "none" : String(f.length));
}
function useIt(f: FieldPacket[]): number {
  return f.length;
}
function passThrough(f: FieldPacket[]): FieldPacket[] {
  return f;
}
class Holder {
  fields: FieldPacket[];
  constructor(f: FieldPacket[]) { this.fields = f; }
  count(): number { return this.fields.length; }
}
interface Bag { fields: FieldPacket[]; tag: string }

async function main() {
  for (const sql of ["sel", "ddl"]) {
    const [, f] = await exec(sql);
    console.log(describe(sql, f));
    const kept: FieldPacket[] = f;
    console.log(kept === undefined);
    const back = passThrough(f);
    console.log(back === undefined);
    const h = new Holder(f);
    console.log(h.fields === undefined);
    const bag: Bag = { fields: f, tag: sql };
    console.log(bag.fields === undefined, bag.tag);
    try { console.log(useIt(f)); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
    try { console.log(h.count()); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
    try { console.log(bag.fields.map((x) => x.name)); } catch (e) { console.log((e as Error).constructor.name, (e as Error).message); }
  }
}
main();
