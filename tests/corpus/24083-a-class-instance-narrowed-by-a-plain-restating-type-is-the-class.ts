// A primitive intersected with a class instance is that primitive at run time: a cast that puts "local" in a slot typed
// (Level | ReadConcern) & ReadConcern flows exactly as in Node.
type Level = "local" | "majority" | "snapshot";
class ReadConcern {
  level: Level | string;
  constructor(level: string) { this.level = level; }
  describe(): string { return "rc:" + this.level; }
}
type Like = ReadConcern | { level: Level } | Level;
interface Opts { readConcern?: (Like & ReadConcern) | undefined; n: number }
const o: Opts = { n: 1 };
console.log(o.n, o.readConcern === undefined);
const rc = new ReadConcern("majority") as { level: Level } & ReadConcern;
o.readConcern = rc;
console.log(o.readConcern.level, o.readConcern === rc, o.readConcern.describe());
const cast = "local" as unknown as Level & ReadConcern;
o.readConcern = cast;
const back: unknown = o.readConcern;
console.log(typeof back, back === "local", String(back));
o.readConcern = undefined;
console.log(o.readConcern === undefined);
