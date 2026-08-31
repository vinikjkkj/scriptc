/* The three standard-library surfaces zapo's messaging bench reaches at
 * run time, in the world the target is actually in (@types/node), on the
 * SUPPORTED side. Its fenced twin is stdlib-surfaces-fenced.ts.
 *
 *  - globalThis: a member this host does not have reads `undefined`,
 *    which is Node's answer without --expose-gc and every JS host's answer
 *    for an absent property of the global object;
 *  - process.memoryUsage.rss(): the one field of the memoryUsage() record
 *    a binary with no V8 heap can answer honestly, from the same place
 *    libuv reads Node's;
 *  - process.on('exit'): what DOES run when a throw escapes — the route
 *    the uncaughtException refusal's hint recommends, so it is compiled
 *    and run here rather than asserted in prose. */
console.log(typeof (globalThis as { gc?: () => void }).gc);
console.log((globalThis as { gc?: () => void }).gc === undefined);
const g = (globalThis as { gc?: () => void }).gc;
console.log(g ? "ran gc" : "no gc");

const rss = process.memoryUsage.rss();
console.log(typeof rss, rss > 0, Number.isInteger(rss));
// The peak twin the same hint names, in Node's own units (kilobytes).
const peak = process.resourceUsage().maxRSS;
console.log(typeof peak, peak > 0);

process.on("exit", (code) => {
  console.log("[exit]", code);
});
