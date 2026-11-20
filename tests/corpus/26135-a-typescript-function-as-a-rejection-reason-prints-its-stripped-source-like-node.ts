// The reason of an unhandled rejection is a TypeScript function: its source text is the
// type-stripped text Node prints (annotations blanked to spaces).
function named(a: number, b: string): number {
  return a + b.length;
}
const arrow = (x: number): number => x * 2;
const seen: string[] = [];
process.on("unhandledRejection", (reason: unknown) => {
  seen.push(String(reason));
  if (seen.length === 3) console.log(seen.join("\n---\n"));
});
Promise.reject(named);
Promise.reject(arrow);
async function later(): Promise<void> {
  throw (function inner(q: boolean): boolean {
    return !q;
  });
}
later();
