// An options value of a static record type could drop keys Node reads: only dynamic (any/unknown) options and literals are admitted.
import util from "node:util";

function show(opts: { depth: number; colors: boolean }): string {
  return util.inspect({ a: 1 }, opts);
}
console.log(show({ depth: 1, colors: false }));
