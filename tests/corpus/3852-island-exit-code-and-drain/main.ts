// @dynamic
// @exit: 3
// Node's implicit exit status and the island's own job queue — the two
// main-time rows an embedded graph adds beyond the tables themselves.
//
//   - the program has no async function, no generator and no timer of its
//     own, so the ONLY reason its main runs the event loop is that it
//     embeds npm code (the C main's `usesIsland` disjunct). Without that
//     disjunct the process exits between `after` and the island's queued
//     work, and the three lines below it never print;
//   - the package sets process.exitCode and returns normally, which is
//     Node's implicit exit status: main returns it instead of 0.
import { schedule, fail } from "deferlib";

console.log("before");
schedule();
fail();
console.log("after");
