interface RowDataPacket { constructor: { name: string }; [column: string]: any; [column: number]: any }
interface OkPacket { constructor: { name: string }; affectedRows: number }
interface FieldPacket { constructor: { name: string }; catalog: string; name: string }
import { execute as rawExecute } from "./m.js";
type Rs = RowDataPacket[][] | RowDataPacket[] | OkPacket;
const execute = rawExecute as <T extends Rs>(sql: string, v: unknown) => Promise<[T, FieldPacket[]]>;
type Q = [unknown, FieldPacket[]];
function nf(o: Q): number { return o[1].length; }
async function run(): Promise<number> { const o = await execute("s", 1); return nf(o); }
run().then((n) => console.log(n), (e) => console.log("ERR", (e as Error).message));
