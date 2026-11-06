interface RowDataPacket { constructor: { name: string }; [column: string]: any; [column: number]: any }
interface OkPacket { constructor: { name: string }; affectedRows: number }
type Rs = RowDataPacket[][] | RowDataPacket[] | OkPacket;
function touch(r: RowDataPacket, o: OkPacket): number { return Object.keys(r).length + o.affectedRows; }
console.log(touch(JSON.parse('{"constructor":{"name":"x"}}') as RowDataPacket, JSON.parse('{"constructor":{"name":"y"},"affectedRows":1}') as OkPacket));
interface FieldPacket { constructor: { name: string }; catalog: string; decimals: number; flags: number; name: string; orgName: string; orgTable: string; table: string }
import { execute as rawExecute } from "./m.js";
const execute = rawExecute as <T extends Rs>(sql: string, v: unknown) => Promise<[T, FieldPacket[]]>;
type Q = [unknown, FieldPacket[]];
function names(o: Q): string { return o[1].length + ":" + o[1][0]!.catalog + ":" + o[1][0]!.name; }
async function run(): Promise<string> { const o = await execute("select", 1); return names(o); }
run().then((n) => console.log(n), (e) => console.log("ERR", (e as Error).message));
