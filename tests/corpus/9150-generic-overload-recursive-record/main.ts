import type { Chain } from "./dd/chain";
const log: string[] = [];
function build(tag: string): Chain {
  const self: Chain = {
    length: tag.length,
    argrep: (...args: unknown[]): Chain => {
      log.push(tag + ":" + args.length);
      return self;
    },
  } as Chain;
  return self;
}
function run(c: Chain): number {
  c.argrep("k", "x", (e: unknown, r: number): void => {
    log.push("cb:" + String(e) + ":" + r);
  });
  const again = c.argrep("k", "x", "y");
  return again.length + c.length;
}
const c = build("ab");
console.log(run(c), log.join(","));
