// @ts-nocheck
// A void-returning function behind `F | null | undefined`: the call statement runs; nullish throws.
let log: string[] = [];
function note(s: string): void {
  log.push("note:" + s);
}
function pick(flag: number): ((s: string) => void) | null | undefined {
  return flag === 1 ? note : flag === 2 ? null : undefined;
}
pick(1).call(null, "one");
pick(1).apply(null, ["two"]);
console.log(log.join(" "));
for (const n of [2, 3]) {
  try {
    pick(n).call(null, "x");
  } catch (e) {
    console.log("caught", (e as Error).name, (e as Error).message);
  }
}
console.log(log.length);
